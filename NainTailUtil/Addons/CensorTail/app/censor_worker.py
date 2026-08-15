from __future__ import annotations

import argparse
import base64
import io
import json
import math
import sys
import time
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageDraw, ImageFilter, ImageOps, PngImagePlugin

try:
    from .peropix_fog import render_peropix_fog
except ImportError:
    from peropix_fog import render_peropix_fog


INPUT_SIZE = 1280
CLASS_NAMES = ["anus", "nipple", "penis", "vagina", "female face", "male face", "pubic hair"]


class CensorError(RuntimeError):
    pass


def emit(event: str, **payload: object) -> None:
    print(json.dumps({"event": event, **payload}, ensure_ascii=False), flush=True)


def clamp(value: float, minimum: float, maximum: float) -> float:
    return min(maximum, max(minimum, value))


def intersection_over_union(box: np.ndarray, boxes: np.ndarray) -> np.ndarray:
    left = np.maximum(box[0], boxes[:, 0])
    top = np.maximum(box[1], boxes[:, 1])
    right = np.minimum(box[2], boxes[:, 2])
    bottom = np.minimum(box[3], boxes[:, 3])
    intersection = np.maximum(0.0, right - left) * np.maximum(0.0, bottom - top)
    box_area = max(0.0, box[2] - box[0]) * max(0.0, box[3] - box[1])
    areas = np.maximum(0.0, boxes[:, 2] - boxes[:, 0]) * np.maximum(0.0, boxes[:, 3] - boxes[:, 1])
    return intersection / np.maximum(box_area + areas - intersection, 1e-7)


def non_max_suppression(boxes: np.ndarray, scores: np.ndarray, threshold: float = 0.5) -> list[int]:
    order = scores.argsort()[::-1]
    keep: list[int] = []
    while order.size:
        current = int(order[0])
        keep.append(current)
        if order.size == 1:
            break
        remaining = order[1:]
        order = remaining[intersection_over_union(boxes[current], boxes[remaining]) <= threshold]
    return keep


def letterbox(image: Image.Image) -> tuple[np.ndarray, float, int, int]:
    source = np.asarray(image.convert("RGB"), dtype=np.uint8)
    height, width = source.shape[:2]
    scale = min(INPUT_SIZE / width, INPUT_SIZE / height)
    resized_width = max(1, round(width * scale))
    resized_height = max(1, round(height * scale))
    resized = np.asarray(
        Image.fromarray(source).resize((resized_width, resized_height), Image.Resampling.BILINEAR),
        dtype=np.uint8,
    )
    left = (INPUT_SIZE - resized_width) // 2
    top = (INPUT_SIZE - resized_height) // 2
    canvas = np.full((INPUT_SIZE, INPUT_SIZE, 3), 114, dtype=np.uint8)
    canvas[top : top + resized_height, left : left + resized_width] = resized
    tensor = np.ascontiguousarray(canvas.transpose(2, 0, 1)[None], dtype=np.float32) / 255.0
    return tensor, scale, left, top


def edge_has_mask_signal(values: np.ndarray, threshold: float = 0.2) -> bool:
    if values.size == 0:
        return False
    active = np.count_nonzero(values >= threshold)
    return active >= max(2, math.ceil(values.size * 0.06))


def expand_mask_crop_to_signal(
    probability: np.ndarray,
    crop: tuple[int, int, int, int],
    limits: tuple[int, int, int, int],
) -> tuple[int, int, int, int]:
    left, top, right, bottom = crop
    limit_left, limit_top, limit_right, limit_bottom = limits
    step_x = max(2, round((right - left) * 0.08))
    step_y = max(2, round((bottom - top) * 0.08))
    for _ in range(12):
        band = 2
        expand_left = left > limit_left and edge_has_mask_signal(
            probability[top:bottom, left : min(right, left + band)]
        )
        expand_right = right < limit_right and edge_has_mask_signal(
            probability[top:bottom, max(left, right - band) : right]
        )
        expand_top = top > limit_top and edge_has_mask_signal(
            probability[top : min(bottom, top + band), left:right]
        )
        expand_bottom = bottom < limit_bottom and edge_has_mask_signal(
            probability[max(top, bottom - band) : bottom, left:right]
        )
        if not any((expand_left, expand_right, expand_top, expand_bottom)):
            break
        if expand_left:
            left = max(limit_left, left - step_x)
        if expand_right:
            right = min(limit_right, right + step_x)
        if expand_top:
            top = max(limit_top, top - step_y)
        if expand_bottom:
            bottom = min(limit_bottom, bottom + step_y)
    return left, top, right, bottom


def encode_instance_mask(
    coefficients: np.ndarray,
    prototypes: np.ndarray | None,
    input_box: np.ndarray,
    source_size: tuple[int, int],
    letterbox_scale: float,
    pad_left: int,
    pad_top: int,
) -> dict | None:
    if prototypes is None or prototypes.ndim != 3 or coefficients.size != prototypes.shape[0]:
        return None
    channels, mask_height, mask_width = prototypes.shape
    logits = coefficients.astype(np.float32) @ prototypes.reshape(channels, -1).astype(np.float32)
    probability = 1.0 / (1.0 + np.exp(-np.clip(logits, -30.0, 30.0)))
    probability = probability.reshape(mask_height, mask_width)
    scale_x = mask_width / INPUT_SIZE
    scale_y = mask_height / INPUT_SIZE
    box_width = max(1.0, float(input_box[2] - input_box[0]))
    box_height = max(1.0, float(input_box[3] - input_box[1]))
    padding_x = max(8.0, box_width * 0.22)
    padding_y = max(8.0, box_height * 0.22)
    source_width, source_height = source_size
    content_left = max(0, math.floor(pad_left * scale_x))
    content_top = max(0, math.floor(pad_top * scale_y))
    content_right = min(mask_width, math.ceil((pad_left + source_width * letterbox_scale) * scale_x))
    content_bottom = min(mask_height, math.ceil((pad_top + source_height * letterbox_scale) * scale_y))
    left = max(content_left, min(content_right - 1, math.floor((float(input_box[0]) - padding_x) * scale_x)))
    top = max(content_top, min(content_bottom - 1, math.floor((float(input_box[1]) - padding_y) * scale_y)))
    right = max(left + 1, min(content_right, math.ceil((float(input_box[2]) + padding_x) * scale_x)))
    bottom = max(top + 1, min(content_bottom, math.ceil((float(input_box[3]) + padding_y) * scale_y)))
    maximum_padding_x = max(16.0, box_width * 0.55)
    maximum_padding_y = max(16.0, box_height * 0.55)
    limit_left = max(
        content_left,
        math.floor((float(input_box[0]) - maximum_padding_x) * scale_x),
    )
    limit_top = max(
        content_top,
        math.floor((float(input_box[1]) - maximum_padding_y) * scale_y),
    )
    limit_right = min(
        content_right,
        math.ceil((float(input_box[2]) + maximum_padding_x) * scale_x),
    )
    limit_bottom = min(
        content_bottom,
        math.ceil((float(input_box[3]) + maximum_padding_y) * scale_y),
    )
    left, top, right, bottom = expand_mask_crop_to_signal(
        probability,
        (left, top, right, bottom),
        (limit_left, limit_top, limit_right, limit_bottom),
    )
    crop = np.uint8(np.clip(probability[top:bottom, left:right] * 255.0, 0, 255))
    if crop.size == 0:
        return None
    source_left = clamp((left / scale_x - pad_left) / letterbox_scale, 0, source_width)
    source_top = clamp((top / scale_y - pad_top) / letterbox_scale, 0, source_height)
    source_right = clamp((right / scale_x - pad_left) / letterbox_scale, 0, source_width)
    source_bottom = clamp((bottom / scale_y - pad_top) / letterbox_scale, 0, source_height)
    region_width = max(1.0, source_right - source_left)
    region_height = max(1.0, source_bottom - source_top)
    output_scale = min(1.0, 1024.0 / max(region_width, region_height))
    output_width = max(crop.shape[1], round(region_width * output_scale))
    output_height = max(crop.shape[0], round(region_height * output_scale))
    rendered = Image.fromarray(crop, mode="L").resize(
        (output_width, output_height), Image.Resampling.BICUBIC
    )
    buffer = io.BytesIO()
    rendered.save(buffer, format="PNG", optimize=True)
    return {
        "encoding": "png-base64",
        "width": output_width,
        "height": output_height,
        "box": {
            "x": round(source_left, 2),
            "y": round(source_top, 2),
            "width": round(region_width, 2),
            "height": round(region_height, 2),
        },
        "data": base64.b64encode(buffer.getvalue()).decode("ascii"),
    }


class Detector:
    def __init__(self) -> None:
        self.session: ort.InferenceSession | None = None
        self.model_path: Path | None = None

    def ensure_session(self, model_path: Path) -> ort.InferenceSession:
        model_path = model_path.resolve()
        if not model_path.is_file():
            raise CensorError(f"검열 모델 파일이 없습니다: {model_path}")
        if self.session is not None and self.model_path == model_path:
            return self.session
        emit("loading", phase="model", model=str(model_path))
        options = ort.SessionOptions()
        options.log_severity_level = 3
        providers = [
            (
                "CUDAExecutionProvider",
                {
                    # Exhaustive cuDNN search made the first XL scan take about
                    # 50 seconds on the reference PC. Heuristic selection keeps
                    # the persistent worker's warm-up suitable for an app UI.
                    "cudnn_conv_algo_search": "HEURISTIC",
                    "cudnn_conv_use_max_workspace": "0",
                },
            ),
            "CPUExecutionProvider",
        ]
        self.session = ort.InferenceSession(str(model_path), sess_options=options, providers=providers)
        self.model_path = model_path
        if "CUDAExecutionProvider" not in self.session.get_providers():
            emit("warning", message="CUDA provider를 사용할 수 없어 CPU로 자동검열을 실행합니다.")
        return self.session

    def detect(self, model_path: Path, image_path: Path, targets: dict, thresholds: dict) -> dict:
        session = self.ensure_session(model_path)
        with Image.open(image_path) as raw:
            image = ImageOps.exif_transpose(raw).convert("RGB")
            width, height = image.size
            tensor, scale, pad_left, pad_top = letterbox(image)
        started = time.perf_counter()
        outputs = session.run(None, {session.get_inputs()[0].name: tensor})
        output = outputs[0]
        prototypes = outputs[1][0] if len(outputs) > 1 and outputs[1].ndim == 4 else None
        elapsed = time.perf_counter() - started
        predictions = output[0].T
        if predictions.ndim != 2 or predictions.shape[1] < 4 + len(CLASS_NAMES):
            raise CensorError(f"예상하지 못한 모델 출력 형식입니다: {predictions.shape}")

        boxes_xywh = predictions[:, :4]
        class_scores = predictions[:, 4 : 4 + len(CLASS_NAMES)]
        mask_coefficients = predictions[:, 4 + len(CLASS_NAMES) :]
        class_ids = np.argmax(class_scores, axis=1)
        confidences = class_scores[np.arange(class_scores.shape[0]), class_ids]
        selected = np.array(
            [
                bool(targets.get(CLASS_NAMES[int(class_id)], True))
                and float(confidence) >= float(thresholds.get(CLASS_NAMES[int(class_id)], 0.35))
                for class_id, confidence in zip(class_ids, confidences, strict=True)
            ],
            dtype=bool,
        )
        selected &= np.isfinite(boxes_xywh).all(axis=1) & np.isfinite(confidences)
        boxes_xywh = boxes_xywh[selected]
        class_ids = class_ids[selected]
        confidences = confidences[selected]
        mask_coefficients = mask_coefficients[selected]

        boxes = np.empty_like(boxes_xywh)
        boxes[:, 0] = boxes_xywh[:, 0] - boxes_xywh[:, 2] / 2
        boxes[:, 1] = boxes_xywh[:, 1] - boxes_xywh[:, 3] / 2
        boxes[:, 2] = boxes_xywh[:, 0] + boxes_xywh[:, 2] / 2
        boxes[:, 3] = boxes_xywh[:, 1] + boxes_xywh[:, 3] / 2

        keep: list[int] = []
        for class_id in np.unique(class_ids):
            indices = np.flatnonzero(class_ids == class_id)
            class_keep = non_max_suppression(boxes[indices], confidences[indices])
            keep.extend(int(indices[index]) for index in class_keep)
        keep.sort(key=lambda index: float(confidences[index]), reverse=True)

        detections = []
        for index in keep[:500]:
            left = clamp((float(boxes[index, 0]) - pad_left) / scale, 0, width)
            top = clamp((float(boxes[index, 1]) - pad_top) / scale, 0, height)
            right = clamp((float(boxes[index, 2]) - pad_left) / scale, 0, width)
            bottom = clamp((float(boxes[index, 3]) - pad_top) / scale, 0, height)
            if right - left < 2 or bottom - top < 2:
                continue
            class_id = int(class_ids[index])
            detections.append(
                {
                    "id": str(uuid.uuid4()),
                    "classId": class_id,
                    "label": CLASS_NAMES[class_id],
                    "confidence": round(float(confidences[index]), 5),
                    "x": round(left, 2),
                    "y": round(top, 2),
                    "width": round(right - left, 2),
                    "height": round(bottom - top, 2),
                    "sourceBox": {
                        "x": round(left, 2),
                        "y": round(top, 2),
                        "width": round(right - left, 2),
                        "height": round(bottom - top, 2),
                    },
                    "enabled": True,
                    "manual": False,
                    "mask": encode_instance_mask(
                        mask_coefficients[index],
                        prototypes,
                        boxes[index],
                        (width, height),
                        scale,
                        pad_left,
                        pad_top,
                    ),
                }
            )
        return {
            "width": width,
            "height": height,
            "detections": detections,
            "inferenceSeconds": round(elapsed, 4),
            "provider": session.get_providers()[0],
        }


def parse_color(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    if len(value) != 6:
        return 255, 255, 255
    try:
        return tuple(int(value[index : index + 2], 16) for index in (0, 2, 4))
    except ValueError:
        return 255, 255, 255


def effect_region(region: Image.Image, options: dict) -> Image.Image:
    mode = options["mode"]
    if mode == "mosaic":
        block = max(4, int(options["mosaicSize"]))
        small_width = max(1, math.ceil(region.width / block))
        small_height = max(1, math.ceil(region.height / block))
        mosaic = region.resize((small_width, small_height), Image.Resampling.BOX).resize(
            region.size, Image.Resampling.NEAREST
        )
        opacity = float(options["opacity"])
        return Image.blend(region, mosaic, opacity) if opacity < 1 else mosaic
    return Image.new("RGB", region.size, parse_color(options["color"]))


def smooth_falloff(distance: np.ndarray, inner: float, outer: float) -> np.ndarray:
    amount = np.clip((distance - inner) / max(outer - inner, 1e-6), 0.0, 1.0)
    smooth = amount * amount * (3.0 - 2.0 * amount)
    return 1.0 - smooth


def ellipse_distance(
    width: int,
    height: int,
    center_x: float,
    center_y: float,
    core_width: float,
    core_height: float,
) -> np.ndarray:
    y, x = np.mgrid[0:height, 0:width]
    dx = (x - center_x) / max(core_width / 2.0, 1.0)
    dy = (y - center_y) / max(core_height / 2.0, 1.0)
    return np.sqrt(dx * dx + dy * dy)


def gradient_effect(
    size: tuple[int, int],
    center: tuple[float, float],
    core_size: tuple[float, float],
    options: dict,
) -> tuple[Image.Image, Image.Image]:
    width, height = size
    distance = ellipse_distance(width, height, *center, *core_size)
    feather_ratio = (float(options["feather"]) * 2.0) / max(2.0, min(core_size))
    outer = min(2.0, 1.15 + feather_ratio)
    alpha = smooth_falloff(distance, float(options["fadeInner"]), outer)
    alpha *= float(options["fogOpacity"])
    mask = Image.fromarray(np.uint8(np.clip(alpha * 255.0, 0, 255)), mode="L")
    layer = Image.new("RGB", size, parse_color(options["color"]))
    return layer, mask


def fog_effect(
    size: tuple[int, int],
    center: tuple[float, float],
    core_size: tuple[float, float],
    options: dict,
    seed: int,
) -> tuple[Image.Image, Image.Image]:
    return render_peropix_fog(
        size,
        center,
        core_size,
        feather=float(options["feather"]),
        brightness=float(options["fogBrightness"]),
        opacity=float(options["fogOpacity"]),
        density=float(options["fogDensity"]),
        color=parse_color(options["color"]),
        seed=seed,
    )


def decode_detection_mask(detection: dict) -> Image.Image | None:
    payload = detection.get("mask")
    if not isinstance(payload, dict) or payload.get("encoding") != "png-base64":
        return None
    try:
        data = base64.b64decode(str(payload.get("data", "")), validate=True)
        with Image.open(io.BytesIO(data)) as raw:
            return raw.convert("L")
    except Exception:
        return None


def round_morph_mask(mask: Image.Image, radius: int, operation: str) -> Image.Image:
    steps = max(0, int(radius))
    values = np.asarray(mask.convert("L"), dtype=np.uint8)
    if steps == 0:
        return Image.fromarray(values, mode="L")
    reducer = np.maximum.reduce if operation == "dilate" else np.minimum.reduce
    padding = 0 if operation == "dilate" else 255
    diagonal_steps = 0
    for step in range(steps):
        padded = np.pad(values, 1, mode="constant", constant_values=padding)
        candidates = [
            padded[1:-1, 1:-1],
            padded[:-2, 1:-1],
            padded[2:, 1:-1],
            padded[1:-1, :-2],
            padded[1:-1, 2:],
        ]
        next_diagonal_steps = math.floor((step + 1) / math.sqrt(2))
        if next_diagonal_steps > diagonal_steps:
            candidates.extend([
                padded[:-2, :-2],
                padded[:-2, 2:],
                padded[2:, :-2],
                padded[2:, 2:],
            ])
            diagonal_steps = next_diagonal_steps
        values = reducer(candidates)
    return Image.fromarray(values, mode="L")


def close_mask_notches(mask: Image.Image) -> Image.Image:
    radius = clamp(round(min(mask.size) * 0.02), 1, 6)
    expanded = round_morph_mask(mask, int(radius), "dilate")
    return round_morph_mask(expanded, int(radius), "erode")


def dilate_mask(mask: Image.Image, radius: int) -> Image.Image:
    return round_morph_mask(mask, radius, "dilate")


def detection_rotation(detection: dict) -> float:
    try:
        rotation = float(detection.get("rotation", 0))
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(rotation):
        return 0.0
    return ((rotation + 180.0) % 360.0) - 180.0


def rotate_canvas(
    image: Image.Image,
    rotation: float,
    center: tuple[float, float],
    fill: int | tuple[int, int, int],
) -> Image.Image:
    if abs(rotation) < 1.0e-6:
        return image
    return image.rotate(
        -rotation,
        resample=Image.Resampling.BICUBIC,
        center=center,
        fillcolor=fill,
    )


def refine_shape_mask(
    mask: Image.Image,
    threshold: float,
    edge_softness: float,
) -> Image.Image:
    values = np.asarray(mask.convert("L"), dtype=np.float32) / 255.0
    threshold = clamp(float(threshold), 0.05, 0.95)
    softness = clamp(float(edge_softness), 0.0, 0.5)
    if softness <= 1.0e-6:
        alpha = np.where(values >= threshold, 1.0, 0.0)
    else:
        lower = threshold - softness / 2.0
        scaled = np.clip((values - lower) / softness, 0.0, 1.0)
        alpha = scaled * scaled * (3.0 - 2.0 * scaled)

    # Remove isolated single-pixel fragments and close isolated one-pixel holes
    # without applying another blur to the whole contour.
    if min(alpha.shape) >= 3:
        binary = alpha >= 0.5
        padded = np.pad(binary, 1, mode="constant", constant_values=False)
        neighbors = np.zeros(binary.shape, dtype=np.uint8)
        for offset_y in range(3):
            for offset_x in range(3):
                neighbors += padded[
                    offset_y : offset_y + binary.shape[0],
                    offset_x : offset_x + binary.shape[1],
                ]
        alpha[binary & (neighbors <= 2)] = 0.0
        alpha[(~binary) & (neighbors >= 8)] = 1.0
    return Image.fromarray(np.uint8(np.clip(alpha * 255.0, 0, 255)), mode="L")


def apply_shape_fill(
    working: Image.Image,
    detection: dict,
    options: dict,
    source_x: float,
    source_y: float,
    source_width: float,
    source_height: float,
) -> Image.Image | None:
    source_mask = decode_detection_mask(detection)
    if source_mask is None:
        return None
    mask_box = detection.get("mask", {}).get("box")
    if isinstance(mask_box, dict):
        mask_x = float(mask_box.get("x", source_x))
        mask_y = float(mask_box.get("y", source_y))
        mask_width = float(mask_box.get("width", source_width))
        mask_height = float(mask_box.get("height", source_height))
    else:
        mask_x, mask_y, mask_width, mask_height = source_x, source_y, source_width, source_height
    base_left = math.floor(mask_x)
    base_top = math.floor(mask_y)
    base_right = math.ceil(mask_x + mask_width)
    base_bottom = math.ceil(mask_y + mask_height)
    base_width = max(1, base_right - base_left)
    base_height = max(1, base_bottom - base_top)
    source_mask = source_mask.resize((base_width, base_height), Image.Resampling.BICUBIC)
    source_mask = refine_shape_mask(
        source_mask,
        float(options.get("maskThreshold", 0.65)),
        float(options.get("maskEdgeSoftness", 0.05)),
    )
    source_mask = close_mask_notches(source_mask)

    spread = float(options["spread"]) / 100.0
    spread_pixels = round(min(source_width, source_height) * 0.12 * spread)
    dilation = int(options.get("shapeExpand", 15)) + spread_pixels
    feather = int(options["feather"])
    left = max(0, math.floor(source_x) - dilation - feather)
    top = max(0, math.floor(source_y) - dilation - feather)
    right = min(working.width, math.ceil(source_x + source_width) + dilation + feather)
    bottom = min(working.height, math.ceil(source_y + source_height) + dilation + feather)
    if right <= left or bottom <= top:
        return working

    local_mask = Image.new("L", (right - left, bottom - top), 0)
    local_mask.paste(source_mask, (base_left - left, base_top - top))
    if dilation > 0:
        local_mask = dilate_mask(local_mask, dilation)
    if feather > 0:
        local_mask = local_mask.filter(ImageFilter.GaussianBlur(feather))
    opacity = float(options["opacity"])
    if opacity < 1:
        local_mask = local_mask.point(lambda value: round(value * opacity))

    mask = Image.new("L", working.size, 0)
    mask.paste(local_mask, (left, top))
    center = (source_x + source_width / 2.0, source_y + source_height / 2.0)
    mask = rotate_canvas(mask, detection_rotation(detection), center, 0)
    color_layer = Image.new("RGB", working.size, parse_color(options["color"]))
    return Image.composite(color_layer, working, mask)


def apply_censor(image: Image.Image, detections: list[dict], options: dict) -> Image.Image:
    working = image.convert("RGB")
    for detection in detections:
        if not detection.get("enabled", True):
            continue
        effect_options = options
        if isinstance(detection.get("effectOverride"), dict):
            effect_options = {**options, **detection["effectOverride"]}
        expand = int(effect_options["expand"])
        mode = effect_options["mode"]
        source_x = float(detection["x"])
        source_y = float(detection["y"])
        source_width = float(detection["width"])
        source_height = float(detection["height"])
        center_x = source_x + source_width / 2.0
        center_y = source_y + source_height / 2.0
        rotation = detection_rotation(detection)
        core_width = source_width + expand * 2
        core_height = source_height + expand * 2

        if mode == "shape":
            shaped = apply_shape_fill(
                working,
                detection,
                effect_options,
                source_x,
                source_y,
                source_width,
                source_height,
            )
            if shaped is not None:
                working = shaped
                continue

        if mode in {"gradient", "fog"}:
            if mode == "gradient":
                spread_scale = 1.0 + float(effect_options["spread"]) / 100.0 * 0.6
                core_width *= spread_scale
                core_height *= spread_scale
            if mode == "fog":
                box_size = max(2.0, min(source_width, source_height))
                fog_scale = clamp(1.0 + 0.04 * math.log2(box_size), 1.05, 1.5)
                core_width = source_width * fog_scale + expand * 2
                core_height = source_height * fog_scale + expand * 2
                texture_width = math.ceil(core_width * 1.7)
                texture_height = math.ceil(core_height * 1.7)
                margin_x = (texture_width - core_width) / 2.0
                margin_y = (texture_height - core_height) / 2.0
            else:
                margin_x = core_width * 0.12 + int(effect_options["feather"])
                margin_y = core_height * 0.12 + int(effect_options["feather"])
            left = max(0, math.floor(center_x - core_width / 2.0 - margin_x))
            top = max(0, math.floor(center_y - core_height / 2.0 - margin_y))
            right = min(working.width, math.ceil(center_x + core_width / 2.0 + margin_x))
            bottom = min(working.height, math.ceil(center_y + core_height / 2.0 + margin_y))
            if right <= left or bottom <= top:
                continue
            box = (left, top, right, bottom)
            local_center = (center_x - left, center_y - top)
            if mode == "fog":
                seed = math.floor(source_x * 1000.0 + source_y)
                effected, local_mask = fog_effect(
                    (right - left, bottom - top),
                    local_center,
                    (core_width, core_height),
                    effect_options,
                    seed,
                )
            else:
                effected, local_mask = gradient_effect(
                    (right - left, bottom - top),
                    local_center,
                    (core_width, core_height),
                    effect_options,
                )
            layer = Image.new("RGB", working.size, (0, 0, 0))
            layer.paste(effected, box)
            mask = Image.new("L", working.size, 0)
            mask.paste(local_mask, (left, top))
            if abs(rotation) >= 1.0e-6:
                center = (center_x, center_y)
                layer = rotate_canvas(layer, rotation, center, (0, 0, 0))
                mask = rotate_canvas(mask, rotation, center, 0)
            working = Image.composite(layer, working, mask)
            continue

        left = max(0, math.floor(source_x - expand))
        top = max(0, math.floor(source_y - expand))
        right = min(working.width, math.ceil(source_x + source_width + expand))
        bottom = min(working.height, math.ceil(source_y + source_height + expand))
        if right <= left or bottom <= top:
            continue
        box = (left, top, right, bottom)
        mask = Image.new("L", working.size, 0)
        ImageDraw.Draw(mask).rectangle(box, fill=255)
        if abs(rotation) >= 1.0e-6:
            mask = rotate_canvas(mask, rotation, (center_x, center_y), 0)
        if mode == "shape" and float(effect_options["opacity"]) < 1:
            opacity = float(effect_options["opacity"])
            mask = mask.point(lambda value: round(value * opacity))
        feather = int(effect_options["feather"])
        if feather > 0:
            mask = mask.filter(ImageFilter.GaussianBlur(feather))
        effect_box = mask.getbbox()
        if effect_box is None:
            continue
        region = working.crop(effect_box)
        censored = effect_region(region, effect_options)
        layer = working.copy()
        layer.paste(censored, effect_box)
        working = Image.composite(layer, working, mask)
    return working


def output_relative_path(value: object, source: Path) -> Path:
    relative = Path(str(value)) if value else Path(source.name)
    if relative.is_absolute() or relative.drive or not relative.parts:
        raise CensorError(f"허용되지 않은 출력 경로입니다: {value}")
    if any(part in {"", ".", ".."} for part in relative.parts):
        raise CensorError(f"허용되지 않은 출력 경로입니다: {value}")
    return relative


def unique_output_path(
    output_root: Path,
    source: Path,
    overwrite: bool,
    relative_path: object = None,
) -> Path:
    destination = output_root / output_relative_path(relative_path, source)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if overwrite or not destination.exists():
        return destination
    for index in range(2, 10000):
        candidate = destination.with_name(f"{destination.stem}_{index}{destination.suffix}")
        if not candidate.exists():
            return candidate
    raise CensorError(f"출력 이름을 정할 수 없습니다: {source.name}")


def metadata_detection(detection: dict) -> dict:
    public = {key: value for key, value in detection.items() if key != "mask"}
    mask = detection.get("mask")
    if isinstance(mask, dict):
        public["mask"] = {
            "encoding": mask.get("encoding"),
            "width": mask.get("width"),
            "height": mask.get("height"),
            "embedded": False,
        }
    return public


def save_image(
    source_path: Path,
    detections: list[dict],
    output_root: Path,
    options: dict,
    model: dict,
    relative_path: object = None,
) -> dict:
    output_root.mkdir(parents=True, exist_ok=True)
    requested_relative = output_relative_path(relative_path, source_path)
    destination = unique_output_path(
        output_root,
        source_path,
        bool(options["overwrite"]),
        requested_relative,
    )
    destination_relative = destination.relative_to(output_root)
    metadata = {
        "schema": "animautil.censor/v1",
        "application": "AnimaUtil",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "source": {
            "fileName": source_path.name,
            "relativePath": requested_relative.as_posix(),
        },
        "output": {
            "fileName": destination.name,
            "relativePath": destination_relative.as_posix(),
        },
        "model": model,
        "options": options,
        "detections": [metadata_detection(detection) for detection in detections],
    }
    metadata_json = json.dumps(metadata, ensure_ascii=False)
    with Image.open(source_path) as raw:
        source = ImageOps.exif_transpose(raw)
        alpha = source.getchannel("A") if "A" in source.getbands() else None
        result = apply_censor(source, detections, options)
        if alpha is not None and destination.suffix.lower() in {".png", ".webp"}:
            result.putalpha(alpha)
        extension = destination.suffix.lower()
        if extension in {".jpg", ".jpeg"}:
            exif = Image.Exif()
            exif[0x010E] = json.dumps(metadata, ensure_ascii=True)
            exif[0x0131] = "AnimaUtil"
            if result.mode not in {"RGB", "L"}:
                result = result.convert("RGB")
            result.save(destination, quality=95, subsampling=0, exif=exif)
        elif extension == ".webp":
            exif = Image.Exif()
            exif[0x010E] = json.dumps(metadata, ensure_ascii=True)
            exif[0x0131] = "AnimaUtil"
            result.save(destination, quality=95, method=6, exif=exif.tobytes())
        else:
            png_info = PngImagePlugin.PngInfo()
            png_info.add_text("AnimaUtil", metadata_json)
            result.save(destination, pnginfo=png_info)
    return {
        "fileName": destination.name,
        "relativePath": destination_relative.as_posix(),
        "path": str(destination),
        "detections": sum(1 for item in detections if item.get("enabled", True)),
    }


def preview_image(source_path: Path, detections: list[dict], options: dict, maximum: int) -> dict:
    with Image.open(source_path) as raw:
        source = ImageOps.exif_transpose(raw)
        alpha = source.getchannel("A") if "A" in source.getbands() else None
        result = apply_censor(source, detections, options)
        if alpha is not None:
            result.putalpha(alpha)
        result.thumbnail((maximum, maximum), Image.Resampling.LANCZOS)
        buffer = io.BytesIO()
        result.save(buffer, format="PNG")
    return {
        "dataUrl": f"data:image/png;base64,{base64.b64encode(buffer.getvalue()).decode('ascii')}",
        "width": result.width,
        "height": result.height,
    }


def handle_detect(detector: Detector, request_id: str, payload: dict) -> dict:
    model_path = Path(payload["modelPath"])
    images = payload.get("images", [])
    progress_offset = max(0, int(payload.get("progressOffset", 0)))
    progress_total = max(len(images), int(payload.get("progressTotal", len(images))))
    results = []
    for index, item in enumerate(images):
        emit(
            "progress",
            requestId=request_id,
            phase="detect",
            index=progress_offset + index + 1,
            total=progress_total,
            id=item["id"],
        )
        result = detector.detect(model_path, Path(item["path"]), payload.get("targets", {}), payload.get("thresholds", {}))
        results.append({"id": item["id"], **result})
    return {"images": results}


def handle_warmup(detector: Detector, payload: dict) -> dict:
    session = detector.ensure_session(Path(payload["modelPath"]))
    return {
        "provider": session.get_providers()[0],
        "providers": session.get_providers(),
    }


def handle_save(request_id: str, payload: dict) -> dict:
    images = payload.get("images", [])
    output_root = Path(payload["outputRoot"])
    progress_offset = max(0, int(payload.get("progressOffset", 0)))
    progress_total = max(len(images), int(payload.get("progressTotal", len(images))))
    results = []
    for index, item in enumerate(images):
        emit(
            "progress",
            requestId=request_id,
            phase="save",
            index=progress_offset + index + 1,
            total=progress_total,
            id=item["id"],
        )
        result = save_image(
            Path(item["path"]),
            item.get("detections", []),
            output_root,
            payload["options"],
            payload["model"],
            item.get("outputRelativePath"),
        )
        results.append({"id": item["id"], **result})
    return {"images": results, "outputRoot": str(output_root)}


def handle_preview(payload: dict) -> dict:
    item = payload["image"]
    return preview_image(
        Path(item["path"]),
        payload.get("detections", []),
        payload["options"],
        max(320, min(2000, int(payload.get("maximum", 1600)))),
    )


def run(app_root: Path) -> None:
    _ = app_root.resolve()
    try:
        ort.preload_dlls()
    except Exception:
        pass
    detector = Detector()
    emit(
        "ready",
        onnxruntime=ort.__version__,
        providers=ort.get_available_providers(),
        classes=CLASS_NAMES,
    )
    for line in sys.stdin:
        try:
            message = json.loads(line)
            request_id = str(message.get("requestId", ""))
            command = message.get("command")
            if command == "warmup":
                result = handle_warmup(detector, message["payload"])
            elif command == "detect":
                result = handle_detect(detector, request_id, message["payload"])
            elif command == "preview":
                result = handle_preview(message["payload"])
            elif command == "save":
                result = handle_save(request_id, message["payload"])
            else:
                raise CensorError(f"지원하지 않는 자동검열 명령입니다: {command}")
            emit("complete", requestId=request_id, result=result)
        except Exception as error:
            emit(
                "error",
                requestId=locals().get("request_id", ""),
                message=str(error),
                traceback=traceback.format_exc(),
            )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-root", required=True, type=Path)
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_args()
    run(arguments.app_root)
