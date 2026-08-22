from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path


os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("DIFFSYNTH_SKIP_DOWNLOAD", "true")

from anima_adapter import validate_checkpoint_structure, validate_lora_structure  # noqa: E402


def diagnose_files(
    root: Path,
    category: str,
    validator,
    directory_aliases: tuple[str, ...] = (),
) -> list[dict[str, object]]:
    results = []
    seen_ids: set[str] = set()
    for directory in (category, *directory_aliases):
        category_root = root / "Models" / directory
        for path in sorted(category_root.rglob("*.safetensors")):
            relative_path = path.relative_to(category_root).as_posix()
            item_id = f"{category}:{relative_path}"
            if item_id in seen_ids:
                continue
            seen_ids.add(item_id)
            try:
                detail = validator(path)
                warning_count = int(detail.get("extra_keys", 0)) + int(
                    detail.get("ignored_unmatched_targets", 0)
                )
                status = "warning" if warning_count > 0 else "compatible"
                results.append(
                    {
                        "id": item_id,
                        "status": status,
                        "detail": detail,
                    }
                )
            except Exception as error:
                results.append(
                    {
                        "id": item_id,
                        "status": "incompatible",
                        "error": str(error),
                    }
                )
    return results


def support_assets(root: Path) -> list[dict[str, object]]:
    required = [
        ("text_encoder", "text_encoders/qwen_3_06b_base.safetensors"),
        ("vae", "vae/qwen_image_vae.safetensors"),
        ("qwen_tokenizer", "tokenizers/qwen3_0.6b/tokenizer.json"),
        ("t5_tokenizer", "tokenizers/t5_v1_1_xxl/spiece.model"),
    ]
    results = []
    for asset_id, relative_path in required:
        path = root / "Models" / relative_path
        results.append(
            {
                "id": asset_id,
                "relativePath": relative_path,
                "status": "ready" if path.is_file() else "missing",
                "bytes": path.stat().st_size if path.is_file() else 0,
            }
        )
    return results


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-root", type=Path, required=True)
    args = parser.parse_args()
    root = args.app_root.resolve()
    result = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "models": diagnose_files(
            root,
            "diffusion_models",
            validate_checkpoint_structure,
            directory_aliases=("checkpoints",),
        ),
        "loras": diagnose_files(root, "loras", validate_lora_structure),
        "supportAssets": support_assets(root),
    }
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
