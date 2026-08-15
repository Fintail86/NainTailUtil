"use strict";

const path = require("node:path");
const { NainTailError } = require("./errors.cjs");

const MAX_VIBES = 16;

function normalizeVibes(input = []) {
  const vibes = Array.isArray(input) ? input : [];
  if (vibes.length > MAX_VIBES) throw new NainTailError("TOO_MANY_VIBES", `Vibe Transfer는 최대 ${MAX_VIBES}개까지 사용할 수 있습니다.`);
  return vibes.map((vibe, index) => {
    const relativePath = String(vibe?.relativePath || "").replace(/\\/gu, "/");
    if (!relativePath.startsWith("References/vibes/") || !/\/[a-f0-9]{64}\.png$/u.test(relativePath)) {
      throw new NainTailError("INVALID_VIBE", `${index + 1}번 Vibe 자산 경로가 올바르지 않습니다.`);
    }
    const strength = Number(vibe?.strength ?? 0.6);
    const informationExtracted = Number(vibe?.informationExtracted ?? 1);
    if (!Number.isFinite(strength) || strength < 0 || strength > 1) throw new NainTailError("INVALID_VIBE", "Vibe Strength는 0.00–1.00 범위여야 합니다.");
    if (!Number.isFinite(informationExtracted) || informationExtracted < 0.01 || informationExtracted > 1) throw new NainTailError("INVALID_VIBE", "Information Extracted는 0.01–1.00 범위여야 합니다.");
    return {
      id: String(vibe?.id || `vibe-${index + 1}`),
      name: String(vibe?.name || `Vibe ${index + 1}`).slice(0, 120),
      relativePath,
      width: Math.max(1, Math.trunc(Number(vibe?.width) || 1)),
      height: Math.max(1, Math.trunc(Number(vibe?.height) || 1)),
      strength: Math.round(strength * 100) / 100,
      informationExtracted: Math.round(informationExtracted * 100) / 100,
    };
  });
}

function vibeCacheFileName(vibe, model) {
  const imageHash = path.basename(vibe.relativePath, ".png");
  const modelKey = String(model || "unknown").replace(/[^a-z0-9]+/giu, "-").replace(/^-|-$/gu, "").toLowerCase();
  const informationKey = String(Math.round(Number(vibe.informationExtracted) * 100)).padStart(3, "0");
  return `${imageHash}_${modelKey}_${informationKey}.vibe`;
}

module.exports = { MAX_VIBES, normalizeVibes, vibeCacheFileName };
