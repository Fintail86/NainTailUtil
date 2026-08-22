"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { NainTailError } = require("./errors.cjs");
const { DEFAULT_MODEL, requireModelDefinition } = require("./nai-models.cjs");
const { defaultProductRoot } = require("./paths.cjs");

const FALLBACK_DEFAULTS = Object.freeze({
  model: DEFAULT_MODEL,
  width: 832,
  height: 1216,
  steps: 28,
  guidance: 5,
  sampler: "k_euler_ancestral",
  scheduler: "karras",
  seed: null,
  cfgRescale: 0,
  decrisper: false,
  includeMetadata: true,
  qualityTags: true,
  ucPreset: "Heavy",
});
const TRANSPARENCY_MODES = new Set(["none", "transparent-background", "has-alpha", "alpha-transparency"]);

function readProfile(productRoot = defaultProductRoot()) {
  const profilePath = path.join(productRoot, "config", "generation-profile.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(profilePath, "utf8"));
    return {
      defaults: { ...FALLBACK_DEFAULTS, ...(parsed.defaults || {}) },
      limits: parsed.limits || {},
    };
  } catch {
    return { defaults: { ...FALLBACK_DEFAULTS }, limits: {} };
  }
}

function numberInRange(value, fallback, min, max, field) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new NainTailError("INVALID_GENERATION_SETTING", `${field} 값이 허용 범위를 벗어났습니다.`);
  }
  return number;
}

function align64(value) {
  const lower = Math.floor(value / 64) * 64;
  const upper = Math.ceil(value / 64) * 64;
  const aligned = value - lower < upper - value ? lower : upper;
  return Math.max(64, aligned);
}

function normalizeGenerationSettings(settings = {}, profile = readProfile()) {
  const requested = settings || {};
  const model = String(requested.model || profile.defaults.model || DEFAULT_MODEL);
  const definition = requireModelDefinition(model);
  const modelChangedFromProfile = model !== String(profile.defaults.model || DEFAULT_MODEL);
  const modelDefault = (key) => modelChangedFromProfile && requested[key] === undefined
    ? definition.defaults[key]
    : profile.defaults[key];
  const merged = {
    ...profile.defaults,
    ...requested,
    model,
    steps: requested.steps ?? modelDefault("steps"),
    guidance: requested.guidance ?? modelDefault("guidance"),
    sampler: requested.sampler ?? modelDefault("sampler"),
    scheduler: requested.scheduler ?? modelDefault("scheduler"),
  };
  const width = align64(numberInRange(merged.width, 832, 64, 2048, "width"));
  const height = align64(numberInRange(merged.height, 1216, 64, 2048, "height"));
  const steps = Math.trunc(numberInRange(merged.steps, 28, 1, 50, "steps"));
  const guidance = numberInRange(merged.guidance, 5, 0, 20, "guidance");
  const cfgRescale = numberInRange(merged.cfgRescale, 0, 0, 1, "cfgRescale");
  const seed = merged.seed === null || merged.seed === "" || merged.seed === undefined
    ? null
    : Math.trunc(numberInRange(merged.seed, 0, 0, 0xffffffff - 1, "seed"));
  const requestedQualityPreset = String(merged.qualityPreset || (merged.qualityTags === false ? "None" : "Standard"));
  const allowedQualityPresets = definition.capabilities.lightQuality ? ["Standard", "Light", "None"] : ["Standard", "None"];
  const qualityPreset = allowedQualityPresets.includes(requestedQualityPreset) ? requestedQualityPreset : "Standard";
  const requestedTransparencyMode = String(merged.transparencyMode || (merged.transparentBackground === true ? "transparent-background" : "none"));
  const transparencyMode = definition.capabilities.transparency && TRANSPARENCY_MODES.has(requestedTransparencyMode)
    ? requestedTransparencyMode
    : "none";

  return {
    model,
    width,
    height,
    steps,
    guidance,
    sampler: String(merged.sampler || profile.defaults.sampler),
    scheduler: definition.capabilities.scheduler ? String(merged.scheduler || definition.defaults.scheduler) : "karras",
    seed,
    cfgRescale,
    decrisper: definition.capabilities.decrisper && merged.decrisper === true,
    includeMetadata: merged.includeMetadata !== false,
    qualityPreset,
    qualityTags: qualityPreset !== "None",
    ucPreset: String(merged.ucPreset || "Heavy"),
    transparencyMode,
    transparentBackground: transparencyMode !== "none",
  };
}

function opusFreeEligibility(settings, options = {}) {
  const normalized = normalizeGenerationSettings(settings);
  const reasons = [];
  if (normalized.width * normalized.height > 1024 * 1024) reasons.push("해상도가 1024x1024 범위를 초과합니다.");
  if (normalized.steps > 28) reasons.push("Steps가 28을 초과합니다.");
  if (options.hasBaseImage) reasons.push("Base Image를 사용하는 요청입니다.");
  if ((options.preciseReferenceCount || 0) > 0) reasons.push("Precise Reference 추가 비용이 있습니다.");
  if ((options.vibeEncodingCount || 0) > 0) reasons.push(`Vibe ${options.vibeEncodingCount}개 인코딩 비용이 있습니다.`);
  if ((options.vibeCount || 0) > 4) reasons.push("Vibe 4개 초과 추가 비용이 있습니다.");
  return { eligible: reasons.length === 0, reasons, nSamples: 1, concurrency: 1 };
}

module.exports = {
  FALLBACK_DEFAULTS,
  align64,
  normalizeGenerationSettings,
  opusFreeEligibility,
  readProfile,
};
