from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Mapping

import torch
from safetensors import safe_open

from diffsynth.configs import MODEL_CONFIGS
from diffsynth.core.loader import hash_model_file
from diffsynth.models.anima_dit import AnimaDiT


ANIMA_TURBO_STRUCTURE_HASH = "476bcc03a42f058737788c1d2d67d596"


def normalize_checkpoint_key(key: str) -> str:
    return key.removeprefix("model.diffusion_model.").removeprefix("net.")


@lru_cache(maxsize=1)
def anima_checkpoint_structure() -> dict[str, tuple[int, ...]]:
    with torch.device("meta"):
        return {
            key: tuple(value.shape) for key, value in AnimaDiT().state_dict().items()
        }


def anima_state_dict_converter(state_dict):
    expected = anima_checkpoint_structure()
    converted = {}
    sources = {}
    for source_key in state_dict:
        key = normalize_checkpoint_key(source_key)
        if key not in expected:
            continue
        if key in converted:
            raise RuntimeError(
                "Anima 체크포인트 키가 정규화 후 충돌합니다: "
                f"{sources[key]}, {source_key} -> {key}"
            )
        converted[key] = state_dict[source_key]
        sources[key] = source_key
    return converted


def checkpoint_structure(path: Path) -> dict[str, tuple[int, ...]]:
    with safe_open(path, framework="pt", device="cpu") as file:
        structure = {}
        sources = {}
        for source_key in file.keys():
            key = normalize_checkpoint_key(source_key)
            if key in structure:
                raise RuntimeError(
                    "Anima 체크포인트 키가 정규화 후 충돌합니다: "
                    f"{sources[key]}, {source_key} -> {key}"
                )
            structure[key] = tuple(file.get_slice(source_key).get_shape())
            sources[key] = source_key
        return structure


def validate_checkpoint_structure(path: Path) -> dict[str, object]:
    actual = checkpoint_structure(path)
    expected = anima_checkpoint_structure()

    missing = set(expected) - set(actual)
    unexpected = set(actual) - set(expected)
    mismatched = {
        key for key in actual.keys() & expected.keys() if actual[key] != expected[key]
    }
    if missing or mismatched:
        raise RuntimeError(
            "Anima 체크포인트 구조가 현재 DiffSynth AnimaDiT와 맞지 않습니다: "
            f"missing={len(missing)}, unexpected={len(unexpected)}, "
            f"shape_mismatch={len(mismatched)}"
        )

    return {
        "actual_keys": len(actual),
        "expected_keys": len(expected),
        "matched_keys": len(expected),
        "missing": 0,
        "unexpected": len(unexpected),
        "extra_keys": len(unexpected),
        "extra_key_names": sorted(unexpected),
        "shape_mismatch": 0,
    }


@lru_cache(maxsize=1)
def anima_lora_targets() -> tuple[dict[str, str], dict[str, tuple[int, ...]]]:
    with torch.device("meta"):
        model = AnimaDiT()
    modules = dict(model.named_modules())
    target_shapes = {
        name: tuple(module.weight.shape)
        for name, module in modules.items()
        if hasattr(module, "weight") and module.weight is not None
    }
    encoded_targets: dict[str, str] = {}
    for target in target_shapes:
        encoded = target.replace(".", "_")
        if encoded in encoded_targets and encoded_targets[encoded] != target:
            raise RuntimeError(f"AnimaDiT LoRA 대상 이름이 충돌합니다: {encoded}")
        encoded_targets[encoded] = target
    return encoded_targets, target_shapes


def _diffsynth_target(key: str) -> str:
    return (
        key.removeprefix("model.diffusion_model.")
        .removeprefix("diffusion_model.")
        .removesuffix(".lora_B.weight")
    )


def _kohya_target(key: str, encoded_targets: Mapping[str, str]) -> str | None:
    encoded = key.removesuffix(".lora_up.weight").removeprefix("lora_unet_")
    return encoded_targets.get(encoded)


def normalize_anima_lora_state_dict(state_dict: Mapping[str, torch.Tensor]) -> dict[str, torch.Tensor]:
    keys = set(state_dict)
    has_diffsynth = any(key.endswith(".lora_B.weight") for key in keys)
    has_kohya = any(key.endswith(".lora_up.weight") for key in keys)
    if has_diffsynth and has_kohya:
        raise RuntimeError("DiffSynth와 Kohya LoRA 키 형식이 한 파일에 혼합되어 있습니다.")
    if has_diffsynth:
        return dict(state_dict)
    if not has_kohya:
        raise RuntimeError("지원되는 LoRA weight 쌍을 찾지 못했습니다.")

    encoded_targets, _ = anima_lora_targets()
    normalized: dict[str, torch.Tensor] = {}
    missing_pairs: list[str] = []
    sources: dict[str, str] = {}
    for up_key in sorted(key for key in keys if key.endswith(".lora_up.weight")):
        down_key = up_key.replace(".lora_up.weight", ".lora_down.weight")
        alpha_key = up_key.replace(".lora_up.weight", ".alpha")
        target = _kohya_target(up_key, encoded_targets)
        if down_key not in state_dict:
            missing_pairs.append(up_key)
            continue
        if target is None:
            continue
        if target in sources:
            raise RuntimeError(
                "Kohya Anima LoRA 대상이 정규화 후 충돌합니다: "
                f"{sources[target]}, {up_key} -> {target}"
            )
        normalized[f"{target}.lora_B.weight"] = state_dict[up_key]
        normalized[f"{target}.lora_A.weight"] = state_dict[down_key]
        sources[target] = up_key
        if alpha_key in state_dict:
            normalized[f"{target}.alpha"] = state_dict[alpha_key]
    if missing_pairs:
        raise RuntimeError(
            "Kohya Anima LoRA weight 쌍이 완전하지 않습니다: "
            f"missing_pairs={len(missing_pairs)}, first={missing_pairs[0]}"
        )
    if not normalized:
        raise RuntimeError("AnimaDiT에 적용할 수 있는 Kohya LoRA weight 쌍을 찾지 못했습니다.")
    return normalized


def validate_lora_structure(path: Path) -> dict[str, object]:
    encoded_targets, target_shapes = anima_lora_targets()
    with safe_open(path, framework="pt", device="cpu") as file:
        keys = set(file.keys())
        pairs = 0
        invalid_shapes = 0
        targets: set[str] = set()
        has_diffsynth = any(key.endswith(".lora_B.weight") for key in keys)
        has_kohya = any(key.endswith(".lora_up.weight") for key in keys)
        if has_diffsynth and has_kohya:
            raise RuntimeError("DiffSynth와 Kohya LoRA 키 형식이 한 파일에 혼합되어 있습니다.")
        lora_format = "diffsynth" if has_diffsynth else "kohya" if has_kohya else "unknown"
        up_suffix = ".lora_B.weight" if has_diffsynth else ".lora_up.weight"
        down_suffix = ".lora_A.weight" if has_diffsynth else ".lora_down.weight"

        up_keys = {key for key in keys if key.endswith(up_suffix)}
        down_keys = {key for key in keys if key.endswith(down_suffix)}
        missing_pairs = 0
        unmatched_keys: list[str] = []
        duplicate_keys: list[str] = []
        target_sources: dict[str, str] = {}
        for key in up_keys:
            down_key = key.replace(up_suffix, down_suffix)
            if down_key not in down_keys:
                missing_pairs += 1
                continue
            target = _diffsynth_target(key) if has_diffsynth else _kohya_target(key, encoded_targets)
            if target is None:
                unmatched_keys.append(key)
                continue
            up_shape = tuple(file.get_slice(key).get_shape())
            down_shape = tuple(file.get_slice(down_key).get_shape())
            expected_shape = target_shapes.get(target)
            if (
                len(up_shape) != 2
                or len(down_shape) != 2
                or up_shape[1] != down_shape[0]
                or expected_shape != (up_shape[0], down_shape[1])
            ):
                invalid_shapes += 1
                continue
            if target in target_sources:
                duplicate_keys.append(key)
                continue
            target_sources[target] = key
            targets.add(target)
            pairs += 1
        missing_pairs += len({key.replace(down_suffix, up_suffix) for key in down_keys} - up_keys)

    matched = len(targets & set(target_shapes))
    unmatched = len(unmatched_keys)
    duplicates = len(duplicate_keys)
    reject_unmatched = has_diffsynth and unmatched > 0
    if pairs == 0 or missing_pairs or invalid_shapes or duplicates or reject_unmatched:
        raise RuntimeError(
            "LoRA 구조가 현재 AnimaDiT와 맞지 않습니다: "
            f"format={lora_format}, pairs={pairs}, matched={matched}, unmatched={unmatched}, "
            f"missing_pairs={missing_pairs}, invalid_shapes={invalid_shapes}, "
            f"duplicate_targets={duplicates}"
        )
    return {
        "format": lora_format,
        "tensor_pairs": pairs,
        "matched_targets": matched,
        "unmatched_targets": unmatched,
        "ignored_unmatched_targets": unmatched if has_kohya else 0,
        "unmatched_target_names": sorted(unmatched_keys)[:20],
        "missing_pairs": 0,
        "invalid_shapes": 0,
        "duplicate_targets": 0,
    }


def register_anima_checkpoint(path: Path | None = None) -> None:
    hashes = {ANIMA_TURBO_STRUCTURE_HASH}
    if path is not None:
        hashes.add(hash_model_file(str(path)))
    registered = {config["model_hash"] for config in MODEL_CONFIGS}
    for model_hash in hashes - registered:
        MODEL_CONFIGS.append(
            {
                "model_hash": model_hash,
                "model_name": "anima_dit",
                "model_class": "diffsynth.models.anima_dit.AnimaDiT",
                "state_dict_converter": "anima_adapter.anima_state_dict_converter",
            }
        )
