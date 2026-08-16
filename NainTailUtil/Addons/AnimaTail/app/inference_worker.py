from __future__ import annotations

import argparse
import gc
import json
import os
import secrets
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path


os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("DIFFSYNTH_SKIP_DOWNLOAD", "true")

import torch  # noqa: E402
from diffsynth.core import load_state_dict  # noqa: E402
from diffsynth.pipelines.anima_image import AnimaImagePipeline, ModelConfig  # noqa: E402
from PIL import Image, ImageOps, PngImagePlugin  # noqa: E402

from anima_adapter import (  # noqa: E402
    normalize_anima_lora_state_dict,
    register_anima_checkpoint,
    validate_checkpoint_structure,
    validate_lora_structure,
)
from anima_sampling import (  # noqa: E402
    DEFAULT_SAMPLER,
    DEFAULT_SCHEDULER,
    SAMPLERS,
    SCHEDULERS,
    generate_image,
)
from generation_profile import is_turbo_lora_path  # noqa: E402
from output_naming import allocate_output_paths  # noqa: E402


class WorkerError(RuntimeError):
    pass


def emit(event: str, **payload: object) -> None:
    print(json.dumps({"event": event, **payload}, ensure_ascii=False), flush=True)


def require_file(path: Path, label: str) -> Path:
    if not path.is_file():
        raise WorkerError(f"{label} 파일이 없습니다: {path}")
    return path


def require_dir(path: Path, label: str) -> Path:
    if not path.is_dir():
        raise WorkerError(f"{label} 폴더가 없습니다: {path}")
    return path


class SamplingProgress:
    def __init__(self, request_id: str, image_index: int, total_images: int):
        self.request_id = request_id
        self.image_index = image_index
        self.total_images = total_images

    def __call__(self, step: int, total_steps: int) -> None:
        emit(
            "progress",
            requestId=self.request_id,
            imageIndex=self.image_index,
            totalImages=self.total_images,
            step=step,
            totalSteps=total_steps,
        )


class InferenceWorker:
    def __init__(self, app_root: Path, support_root: Path, output_root: Path):
        self.app_root = app_root.resolve()
        self.support_root = support_root.resolve()
        self.output_root = output_root.resolve()
        self.pipeline: AnimaImagePipeline | None = None
        self.pipeline_signature: tuple[object, ...] | None = None
        self.hotload_lora_signature: tuple[tuple[str, float], ...] | None = None
        self.validated_loras: set[str] = set()
        self.pipeline_load_count = 0
        self.lora_swap_count = 0

    def assert_user_asset(self, raw_path: str, category: str) -> Path:
        path = Path(raw_path).resolve()
        allowed_root = (self.app_root / "Models" / category).resolve()
        try:
            path.relative_to(allowed_root)
        except ValueError as error:
            raise WorkerError(f"허용되지 않은 모델 경로입니다: {path}") from error
        return require_file(path, category)

    def support_paths(self) -> dict[str, Path]:
        return {
            "text_encoder": require_file(
                self.support_root / "text_encoders/qwen_3_06b_base.safetensors",
                "Qwen text encoder",
            ),
            "vae": require_file(
                self.support_root / "vae/qwen_image_vae.safetensors",
                "Qwen-Image VAE",
            ),
            "qwen_tokenizer": require_dir(
                self.support_root / "tokenizers/qwen3_0.6b", "Qwen tokenizer"
            ),
            "t5_tokenizer": require_dir(
                self.support_root / "tokenizers/t5_v1_1_xxl", "T5 tokenizer"
            ),
        }

    def unload_pipeline(self) -> None:
        if self.pipeline is None:
            return
        self.pipeline = None
        self.pipeline_signature = None
        self.hotload_lora_signature = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        emit("model", state="unloaded")

    def validate_loras(self, loras: list[tuple[Path, float]]) -> None:
        for lora_path, _ in loras:
            key = str(lora_path)
            if key not in self.validated_loras:
                validate_lora_structure(lora_path)
                self.validated_loras.add(key)

    def load_lora_state_dict(self, path: Path) -> dict[str, torch.Tensor]:
        state_dict = load_state_dict(
            str(path),
            torch_dtype=torch.bfloat16,
            device="cuda",
            verbose=0,
        )
        return normalize_anima_lora_state_dict(state_dict)

    def ensure_pipeline(
        self,
        request_id: str,
        model_path: Path,
        loras: list[tuple[Path, float]],
        load_mode: str,
    ) -> AnimaImagePipeline:
        fused_signature = tuple((str(path), strength) for path, strength in loras)
        signature = (load_mode, str(model_path), fused_signature if load_mode == "fused" else ())
        if self.pipeline is not None and signature == self.pipeline_signature:
            return self.pipeline

        self.unload_pipeline()
        emit("loading", requestId=request_id, phase="checkpoint-validation")
        validate_checkpoint_structure(model_path)
        self.validate_loras(loras)
        support = self.support_paths()

        emit("loading", requestId=request_id, phase="pipeline")
        register_anima_checkpoint(model_path)
        pipeline = AnimaImagePipeline.from_pretrained(
            torch_dtype=torch.bfloat16,
            device="cuda",
            model_configs=[
                ModelConfig(path=str(model_path)),
                ModelConfig(path=str(support["text_encoder"])),
                ModelConfig(path=str(support["vae"])),
            ],
            tokenizer_config=ModelConfig(path=str(support["qwen_tokenizer"])),
            tokenizer_t5xxl_config=ModelConfig(path=str(support["t5_tokenizer"])),
        )

        if load_mode == "hotload":
            emit("loading", requestId=request_id, phase="lora-hotload-wrapper")
            pipeline.dit = pipeline.enable_lora_hot_loading(pipeline.dit)
            pipeline.vram_management_enabled = pipeline.check_vram_management_state()
        else:
            for lora_path, strength in loras:
                emit("loading", requestId=request_id, phase="lora", name=lora_path.name)
                pipeline.load_lora(
                    pipeline.dit,
                    alpha=strength,
                    hotload=False,
                    state_dict=self.load_lora_state_dict(lora_path),
                    verbose=0,
                )

        self.pipeline = pipeline
        self.pipeline_signature = signature
        self.pipeline_load_count += 1
        emit("model", requestId=request_id, state="loaded", model=model_path.name)
        return pipeline

    def apply_hotload_loras(
        self,
        request_id: str,
        pipeline: AnimaImagePipeline,
        loras: list[tuple[Path, float]],
    ) -> None:
        signature = tuple((str(path), strength) for path, strength in loras)
        if signature == self.hotload_lora_signature:
            return
        emit("loading", requestId=request_id, phase="lora-clear")
        pipeline.clear_lora(verbose=0)
        try:
            for lora_path, strength in loras:
                emit("loading", requestId=request_id, phase="lora-hotload", name=lora_path.name)
                pipeline.load_lora(
                    pipeline.dit,
                    alpha=strength,
                    hotload=True,
                    state_dict=self.load_lora_state_dict(lora_path),
                    verbose=0,
                )
        except Exception:
            pipeline.clear_lora(verbose=0)
            self.hotload_lora_signature = None
            raise
        self.hotload_lora_signature = signature
        self.lora_swap_count += 1

    def generate(self, request_id: str, payload: dict[str, object]) -> dict[str, object]:
        if not torch.cuda.is_available():
            raise WorkerError("CUDA GPU를 사용할 수 없습니다.")

        model_path = self.assert_user_asset(str(payload["modelPath"]), "diffusion_models")
        lora_payloads = list(payload.get("loras", []))
        loras = [
            (
                self.assert_user_asset(str(item["path"]), "loras"),
                float(item["strength"]),
            )
            for item in lora_payloads
        ]
        load_mode = "hotload" if payload.get("loraLoadMode") == "hotload" else "fused"
        self.validate_loras(loras)
        pipe = self.ensure_pipeline(request_id, model_path, loras, load_mode)
        if load_mode == "hotload":
            self.apply_hotload_loras(request_id, pipe, loras)

        prompt = str(payload["prompt"]).strip()
        negative_prompt = str(payload.get("negativePrompt", "")).strip()
        width = int(payload["width"])
        height = int(payload["height"])
        steps = int(payload["steps"])
        cfg = float(payload["cfg"])
        sampler = str(payload.get("sampler", DEFAULT_SAMPLER))
        scheduler = str(payload.get("scheduler", DEFAULT_SCHEDULER))
        if sampler not in SAMPLERS:
            raise WorkerError(f"지원하지 않는 샘플러입니다: {sampler}")
        if scheduler not in SCHEDULERS:
            raise WorkerError(f"지원하지 않는 스케줄러입니다: {scheduler}")
        if sampler == "uni_pc" and steps < 2:
            raise WorkerError("uni_pc 샘플러는 최소 2 Steps가 필요합니다.")
        batch_size = int(payload["batchSize"])
        queue_count = int(payload["queueCount"])
        total_images = batch_size * queue_count
        random_seed = bool(payload["randomSeed"])
        base_seed = secrets.randbelow(2**31) if random_seed else int(payload["seed"])
        generation_mode = str(payload.get("generationMode", "standard"))
        input_image = None
        denoising_strength = 1.0
        if generation_mode == "refine":
            input_path = require_file(Path(str(payload.get("inputImagePath", ""))), "리파인 입력 이미지")
            with Image.open(input_path) as raw:
                input_image = ImageOps.exif_transpose(raw).convert("RGB").resize(
                    (width, height),
                    Image.Resampling.LANCZOS,
                )
            denoising_strength = max(
                0.05,
                min(1.0, float(payload.get("denoisingStrength", 0.3))),
            )
        output_root = self.output_root
        output_root.mkdir(parents=True, exist_ok=True)
        try:
            output_paths = allocate_output_paths(
                output_root,
                payload.get("outputPrefix"),
                payload.get("outputSubPrefix"),
                total_images,
                payload.get("outputSlotNumber") if generation_mode == "sub-prompt" else None,
                payload.get("outputDirectory", "") if generation_mode == "sub-prompt" else "",
            )
        except ValueError as error:
            raise WorkerError(str(error)) from error

        results: list[dict[str, object]] = []
        for index in range(total_images):
            seed = (base_seed + index) % (2**31)
            output_path, output_number = output_paths[index]
            output_relative_path = output_path.relative_to(output_root).as_posix()
            torch.cuda.reset_peak_memory_stats()
            started = time.perf_counter()
            image = generate_image(
                pipe,
                prompt=prompt,
                negative_prompt=negative_prompt,
                cfg_scale=cfg,
                width=width,
                height=height,
                seed=seed,
                num_inference_steps=steps,
                sampler=sampler,
                scheduler=scheduler,
                input_image=input_image,
                denoising_strength=denoising_strength,
                progress=SamplingProgress(request_id, index + 1, total_images),
            )
            torch.cuda.synchronize()
            generated_at = datetime.now(timezone.utc).isoformat()
            job_metadata = payload.get("job", {})
            metadata = {
                "schemaVersion": 1,
                "application": "AnimaUtil",
                "jobId": job_metadata.get("id", request_id),
                "job": {
                    "id": job_metadata.get("id", request_id),
                    "groupId": job_metadata.get("groupId"),
                    "ordinal": job_metadata.get("ordinal", 1),
                    "groupSize": job_metadata.get("groupSize", 1),
                    "queueOrdinal": job_metadata.get("queueOrdinal", 1),
                    "queueCount": job_metadata.get("queueCount", 1),
                    "variationOrdinal": job_metadata.get("variationOrdinal", 1),
                    "variationCount": job_metadata.get("variationCount", 1),
                },
                "createdAt": job_metadata.get("createdAt"),
                "generatedAt": generated_at,
                "prompt": prompt,
                "negativePrompt": negative_prompt,
                "generationMode": payload.get("generationMode", "standard"),
                **({
                    "refine": {
                        "mode": payload.get("refineMode", "detail"),
                        "denoisingStrength": denoising_strength,
                        "upscaleScale": float(payload.get("upscaleScale", 1)),
                        "sourceImage": payload.get("sourceImage"),
                    }
                } if generation_mode == "refine" else {}),
                "loraLoadMode": load_mode,
                "basePrompt": payload.get("basePrompt", prompt),
                "mainPrompt": payload.get("mainPrompt", ""),
                "baseNegativePrompt": payload.get("baseNegativePrompt", ""),
                "baseLoras": [
                    {
                        "id": item.get("id"),
                        "name": item.get("name"),
                        "fileName": item.get("fileName"),
                        "relativePath": item.get("relativePath"),
                        "strength": item.get("strength"),
                        "turbo": bool(item.get("turbo", False)),
                    }
                    for item in payload.get("baseLoras", lora_payloads)
                ],
                "subPrompt": payload.get("subPrompt"),
                "model": payload.get(
                    "model",
                    {
                        "fileName": model_path.name,
                        "relativePath": model_path.relative_to(
                            self.app_root / "Models" / "diffusion_models"
                        ).as_posix(),
                    },
                ),
                "loras": [
                    {
                        "id": item.get("id"),
                        "name": item.get("name", path.stem),
                        "fileName": item.get("fileName", path.name),
                        "relativePath": item.get(
                            "relativePath",
                            path.relative_to(self.app_root / "Models" / "loras").as_posix(),
                        ),
                        "strength": strength,
                        "turbo": bool(
                            item.get(
                                "turbo",
                                is_turbo_lora_path(
                                    path.relative_to(self.app_root / "Models" / "loras").as_posix()
                                ),
                            )
                        ),
                    }
                    for item, (path, strength) in zip(lora_payloads, loras)
                ],
                "settings": {
                    "outputPrefix": payload.get("outputPrefix"),
                    "outputSubPrefix": payload.get("outputSubPrefix", ""),
                    "outputDirectory": payload.get("outputDirectory", ""),
                    "outputSlotNumber": payload.get("outputSlotNumber"),
                    "width": width,
                    "height": height,
                    "steps": steps,
                    "cfg": cfg,
                    "sampler": sampler,
                    "scheduler": scheduler,
                    "seed": seed,
                    "randomSeedRequested": random_seed,
                    "batchSize": batch_size,
                    "queueCount": int(payload["queueCount"]),
                    "queueRepeatRequested": int(job_metadata.get("groupSize", 1)),
                    **({
                        "denoisingStrength": denoising_strength,
                        "refineMode": payload.get("refineMode", "detail"),
                        "upscaleScale": float(payload.get("upscaleScale", 1)),
                    } if generation_mode == "refine" else {}),
                },
                "runtime": {
                    **payload.get("runtime", {}),
                    "pythonVersion": sys.version.split()[0],
                    "torchVersion": torch.__version__,
                    "cudaRuntime": torch.version.cuda,
                    "device": torch.cuda.get_device_name(0),
                    "loraLoadMode": load_mode,
                    "pipelineLoadCount": self.pipeline_load_count,
                    "loraSwapCount": self.lora_swap_count,
                },
                "result": {
                    "fileName": output_path.name,
                    "relativePath": output_relative_path,
                    "outputNumber": output_number,
                    "imageIndex": index + 1,
                    "totalImages": total_images,
                },
            }
            png_info = PngImagePlugin.PngInfo()
            png_info.add_text("AnimaUtil", json.dumps(metadata, ensure_ascii=False))
            png_info.add_text(
                "parameters",
                f"{prompt}\n"
                + (f"Negative prompt: {negative_prompt}\n" if negative_prompt else "")
                + f"Steps: {steps}, Sampler: {sampler}, Scheduler: {scheduler}, "
                + f"CFG scale: {cfg:g}, Seed: {seed}, "
                f"Size: {width}x{height}, Model: {metadata['model'].get('fileName', model_path.name)}",
            )
            image.save(output_path, pnginfo=png_info)
            result = {
                "path": str(output_path),
                "relativePath": output_relative_path,
                "seed": seed,
                "width": width,
                "height": height,
                "seconds": round(time.perf_counter() - started, 3),
                "peakCudaMiB": round(torch.cuda.max_memory_allocated() / 1024**2, 1),
                "metadata": metadata,
            }
            results.append(result)
            emit(
                "image",
                requestId=request_id,
                imageIndex=index + 1,
                totalImages=total_images,
                result=result,
            )

        return {
            "model": model_path.name,
            "loras": [{"name": path.name, "strength": strength} for path, strength in loras],
            "images": results,
            "device": torch.cuda.get_device_name(0),
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-root", type=Path, required=True)
    parser.add_argument("--support-root", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    worker = InferenceWorker(args.app_root, args.support_root, args.output_root)
    emit(
        "ready",
        python=sys.version.split()[0],
        torch=torch.__version__,
        cuda=torch.version.cuda,
        cudaAvailable=torch.cuda.is_available(),
    )
    for line in sys.stdin:
        try:
            message = json.loads(line)
            request_id = str(message["requestId"])
            if message.get("command") != "generate":
                raise WorkerError(f"지원하지 않는 명령입니다: {message.get('command')}")
            result = worker.generate(request_id, dict(message["payload"]))
            emit("complete", requestId=request_id, result=result)
        except Exception as error:  # worker must report and remain available when possible
            emit(
                "error",
                requestId=str(locals().get("message", {}).get("requestId", "unknown")),
                message=str(error),
                detail="".join(traceback.format_exception_only(type(error), error)).strip(),
            )
    worker.unload_pipeline()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
