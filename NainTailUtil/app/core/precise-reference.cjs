"use strict";

const { NainTailError } = require("./errors.cjs");

const PRECISE_REFERENCE_MODES = new Set(["character&style", "character", "style"]);
const MAX_PRECISE_REFERENCES = 16;

function valueInRange(value, fallback, field) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number < -1 || number > 1) {
    throw new NainTailError("INVALID_PRECISE_REFERENCE", `${field} 값은 -1.00–1.00 범위여야 합니다.`);
  }
  return Math.round(number * 100) / 100;
}

function normalizePreciseReferences(input = []) {
  const references = Array.isArray(input) ? input : [];
  if (references.length > MAX_PRECISE_REFERENCES) {
    throw new NainTailError("TOO_MANY_PRECISE_REFERENCES", `이미지 참조는 한 요청에 최대 ${MAX_PRECISE_REFERENCES}개까지 사용할 수 있습니다.`);
  }
  return references.map((reference, index) => {
    const relativePath = String(reference?.relativePath || "").replace(/\\/gu, "/");
    if (!relativePath.startsWith("References/precise/") || !relativePath.endsWith(".png")) {
      throw new NainTailError("INVALID_PRECISE_REFERENCE", `${index + 1}번 이미지 참조 경로가 올바르지 않습니다.`);
    }
    const mode = String(reference?.mode || "character&style");
    if (!PRECISE_REFERENCE_MODES.has(mode)) {
      throw new NainTailError("INVALID_PRECISE_REFERENCE", `${index + 1}번 이미지 참조 종류가 올바르지 않습니다.`);
    }
    return {
      id: String(reference?.id || `reference-${index + 1}`),
      name: String(reference?.name || `이미지 참조 ${index + 1}`).slice(0, 120),
      relativePath,
      width: Math.max(1, Math.trunc(Number(reference?.width) || 1)),
      height: Math.max(1, Math.trunc(Number(reference?.height) || 1)),
      mode,
      strength: valueInRange(reference?.strength, 1, "Strength"),
      fidelity: valueInRange(reference?.fidelity, 1, "Fidelity"),
    };
  });
}

module.exports = { MAX_PRECISE_REFERENCES, PRECISE_REFERENCE_MODES, normalizePreciseReferences };
