from __future__ import annotations

import argparse
import json
import os
import site
import sys
import time
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--result")
    args = parser.parse_args()

    executable = Path(sys.executable).resolve()
    runtime_root = Path(os.environ["ANIMAUTIL_RUNTIME_ROOT"]).resolve()

    started = time.perf_counter()
    import torch
    import torchvision
    import transformers
    import diffsynth

    import_seconds = time.perf_counter() - started
    cuda_available = torch.cuda.is_available()
    gpu_name = torch.cuda.get_device_name(0) if cuda_available else None
    capability = list(torch.cuda.get_device_capability(0)) if cuda_available else None
    arch_list = torch.cuda.get_arch_list() if cuda_available else []

    tensor_seconds = None
    finite = None
    if cuda_available:
        torch.cuda.synchronize()
        tensor_started = time.perf_counter()
        left = torch.randn((2048, 2048), device="cuda", dtype=torch.bfloat16)
        right = torch.randn((2048, 2048), device="cuda", dtype=torch.bfloat16)
        output = left @ right
        torch.cuda.synchronize()
        tensor_seconds = time.perf_counter() - tensor_started
        finite = bool(torch.isfinite(output).all().item())

    report = {
        "event": "portable_cuda_probe",
        "executable": str(executable),
        "runtime_root": str(runtime_root),
        "executable_is_private": executable.parent == runtime_root,
        "python": sys.version.split()[0],
        "torch": torch.__version__,
        "torchvision": torchvision.__version__,
        "transformers": transformers.__version__,
        "diffsynth": getattr(diffsynth, "__version__", "2.0.17"),
        "torch_cuda": torch.version.cuda,
        "cuda_available": cuda_available,
        "gpu_name": gpu_name,
        "capability": capability,
        "arch_list": arch_list,
        "sm_120": "sm_120" in arch_list,
        "tensor_finite": finite,
        "import_seconds": import_seconds,
        "tensor_seconds": tensor_seconds,
        "pythonhome": os.environ.get("PYTHONHOME"),
        "pythonpath": os.environ.get("PYTHONPATH"),
        "cuda_path": os.environ.get("CUDA_PATH"),
        "cuda_home": os.environ.get("CUDA_HOME"),
        "python_no_user_site": os.environ.get("PYTHONNOUSERSITE"),
        "enable_user_site": site.ENABLE_USER_SITE,
        "path": os.environ.get("PATH", ""),
    }

    output_json = json.dumps(report, ensure_ascii=False, indent=2)
    print(output_json)
    if args.result:
        Path(args.result).write_text(output_json + "\n", encoding="utf-8")

    expected = all(
        [
            report["executable_is_private"],
            report["python"] == "3.12.13",
            report["torch"] == "2.11.0+cu128",
            report["torchvision"] == "0.26.0+cu128",
            report["cuda_available"],
            report["sm_120"],
            report["tensor_finite"],
            report["pythonhome"] is None,
            report["pythonpath"] is None,
            report["cuda_path"] is None,
            report["cuda_home"] is None,
            report["python_no_user_site"] == "1",
            report["enable_user_site"] is False,
        ]
    )
    return 0 if expected else 42


if __name__ == "__main__":
    raise SystemExit(main())
