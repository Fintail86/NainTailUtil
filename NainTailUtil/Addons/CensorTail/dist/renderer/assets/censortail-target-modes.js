export const TARGET_MODE_OPTIONS = Object.freeze([
  { value: "", label: "공통 방식 사용" },
  { value: "mosaic", label: "모자이크" },
  { value: "color", label: "색상 박스" },
  { value: "shape", label: "형태 칠하기" },
  { value: "gradient", label: "그라데이션" },
  { value: "fog", label: "포그" },
]);

const TARGETS = ["anus", "nipple", "penis", "vagina", "pubic hair"];
const STORAGE_KEY = "censortail.target-modes.v1";

export function normalizeTargetModes(value) {
  return Object.fromEntries(TARGETS.flatMap((label) => {
    const mode = value?.[label];
    return TARGET_MODE_OPTIONS.some((option) => option.value && option.value === mode)
      ? [[label, mode]] : [];
  }));
}

export function readTargetModes() {
  try {
    return normalizeTargetModes(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"));
  } catch {
    return {};
  }
}

export function writeTargetModes(value) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeTargetModes(value)));
}

export function resolveTargetOptions(detection, options) {
  const mode = !detection?.manual && options.targetModes?.[detection?.label];
  const defaults = mode ? { ...options, mode } : options;
  return detection?.effectOverride ? { ...defaults, ...detection.effectOverride } : defaults;
}

export const DEFAULT_BOX_SCALES = Object.freeze({
  mosaic: 1, color: 1, shape: 1, gradient: 1, fog: 1.25,
});
const BOX_SCALES_KEY = "censortail.initial-box-scales.v1";

export function normalizeBoxScales(value) {
  return Object.fromEntries(Object.entries(DEFAULT_BOX_SCALES).map(([mode, fallback]) => {
    const number = Number(value?.[mode]);
    const scale = value?.[mode] !== "" && value?.[mode] != null && Number.isFinite(number)
      ? Math.max(0.5, Math.min(3, number)) : fallback;
    return [mode, scale];
  }));
}

export function readBoxScales() {
  try {
    return normalizeBoxScales(JSON.parse(localStorage.getItem(BOX_SCALES_KEY) || "{}"));
  } catch {
    return { ...DEFAULT_BOX_SCALES };
  }
}

export function writeBoxScales(value) {
  localStorage.setItem(BOX_SCALES_KEY, JSON.stringify(normalizeBoxScales(value)));
}

export function fitInitialRegion(detection, mode, scales) {
  if (detection.manual) return detection;
  const source = detection.sourceBox || {
    x: detection.x, y: detection.y, width: detection.width, height: detection.height,
  };
  const base = mode === "shape" ? detection.mask?.box || source : source;
  const scale = normalizeBoxScales(scales)[mode] || 1;
  // Always fit from original bounds, so switching modes cannot accumulate scale.
  const paddingX = base.width * (scale - 1) / 2;
  const paddingY = base.height * (scale - 1) / 2;
  return {
    ...detection,
    sourceBox: source,
    x: base.x - paddingX,
    y: base.y - paddingY,
    width: base.width * scale,
    height: base.height * scale,
  };
}

export function fitFogRegion(detection) {
  return fitInitialRegion(detection, "fog");
}

export function applyRegionEdit(detection, patch, effectiveOptions) {
  const geometryKeys = ["x", "y", "width", "height", "rotation", "classId", "label"];
  const changed = geometryKeys.some((key) => Object.hasOwn(patch, key) && patch[key] !== detection[key]);
  const result = { ...detection, ...patch };
  if (changed && !Object.hasOwn(patch, "effectOverride") && !detection.effectOverride) {
    const { targetModes, overwrite, ...effect } = effectiveOptions;
    result.effectOverride = effect;
  }
  return result;
}
