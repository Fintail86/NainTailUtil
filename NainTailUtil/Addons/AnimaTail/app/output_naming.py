from __future__ import annotations

import re
from pathlib import Path

from generation_profile import OUTPUT_NAMING


DEFAULT_OUTPUT_PREFIX = str(OUTPUT_NAMING["defaultPrefix"])
SEGMENT_MAX_LENGTH = int(OUTPUT_NAMING["segmentMaxLength"])
INVALID_SEGMENT = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def normalize_output_segment(value: object, label: str, fallback: str = "") -> str:
    segment = str(value or "").strip() or fallback
    if not segment:
        return ""
    if len(segment) > SEGMENT_MAX_LENGTH:
        raise ValueError(f"{label}는 최대 {SEGMENT_MAX_LENGTH}자까지 입력할 수 있습니다.")
    if segment in {".", ".."} or INVALID_SEGMENT.search(segment) or segment.endswith((".", " ")):
        raise ValueError(f"{label}에 파일명으로 사용할 수 없는 문자가 있습니다.")
    return segment


def output_name_stem(
    prefix: object,
    sub_prefix: object = "",
    slot_number: object = None,
) -> str:
    normalized_prefix = normalize_output_segment(
        prefix,
        "Prefix",
        DEFAULT_OUTPUT_PREFIX,
    )
    normalized_sub_prefix = normalize_output_segment(sub_prefix, "SubPrefix")
    normalized_slot = ""
    if slot_number is not None:
        try:
            parsed_slot = int(slot_number)
        except (TypeError, ValueError) as error:
            raise ValueError("Slot 번호가 올바르지 않습니다.") from error
        if parsed_slot < 1:
            raise ValueError("Slot 번호가 올바르지 않습니다.")
        normalized_slot = str(parsed_slot)
    return "_".join(
        part for part in (normalized_prefix, normalized_sub_prefix, normalized_slot) if part
    )


def next_output_number(output_root: Path, stem: str) -> int:
    pattern = re.compile(rf"^{re.escape(stem)}_(\d+)\.png$", re.IGNORECASE)
    maximum = 0
    if output_root.is_dir():
        for candidate in output_root.rglob("*"):
            if not candidate.is_file():
                continue
            match = pattern.match(candidate.name)
            if match:
                maximum = max(maximum, int(match.group(1)))
    return maximum + 1


def allocate_output_paths(
    output_root: Path,
    prefix: object,
    sub_prefix: object,
    count: int,
    slot_number: object = None,
    output_directory: object = "",
) -> list[tuple[Path, int]]:
    if count < 1:
        return []
    directory_name = normalize_output_segment(output_directory, "출력 폴더")
    destination_root = output_root / directory_name if directory_name else output_root
    destination_root.mkdir(parents=True, exist_ok=True)
    stem = output_name_stem(prefix, sub_prefix, slot_number)
    number = next_output_number(destination_root, stem)
    paths: list[tuple[Path, int]] = []
    while len(paths) < count:
        candidate = destination_root / f"{stem}_{number}.png"
        if not candidate.exists():
            paths.append((candidate, number))
        number += 1
    return paths
