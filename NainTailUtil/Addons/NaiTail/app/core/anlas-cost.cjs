"use strict";

const { NainTailError } = require("./errors.cjs");
const { normalizeGenerationSettings } = require("./generation-profile.cjs");

// Extracted from NovelAI's public web client pricing formula on 2026-08-11.
// Keep the version visible because this is a prediction, not a server quote.
const FORMULA_VERSION = "nai-web-2026-08-11";
const COST_A = 2.951823174884865e-6;
const COST_B = 5.753298233447344e-7;
const OPUS_FREE_PIXELS = 1024 * 1024;
const MAX_COST_PER_IMAGE = 140;
const PRECISE_REFERENCE_COST = 5;
const VIBE_ENCODING_COST = 2;
const FREE_VIBE_COUNT = 4;
const EXTRA_VIBE_COST = 2;

function count(value, fallback, field) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < 0 || number > 10_000) {
    throw new NainTailError("INVALID_ANLAS_ESTIMATE", `${field} 값이 올바르지 않습니다.`);
  }
  return number;
}

function imageSampleCost(settings) {
  const normalized = normalizeGenerationSettings(settings);
  const pixels = normalized.width * normalized.height;
  return Math.max(Math.ceil(COST_A * pixels + COST_B * pixels * normalized.steps), 2);
}

function normalizeVariants(settings, options) {
  if (!Array.isArray(options.settingsVariants) || !options.settingsVariants.length) {
    return [{ settings: normalizeGenerationSettings(settings), count: count(options.generationCount, 1, "생성 장수") }];
  }
  return options.settingsVariants.map((variant) => ({
    settings: normalizeGenerationSettings(variant?.settings || settings),
    count: count(variant?.count, 1, "설정별 생성 장수"),
  })).filter((variant) => variant.count > 0);
}

function estimateAnlasCost(settings, options = {}) {
  const variants = normalizeVariants(settings, options);
  const generationCount = variants.reduce((sum, variant) => sum + variant.count, 0);
  const preciseReferenceCount = count(options.preciseReferenceCount, 0, "Precise Reference 수");
  const vibeCount = count(options.vibeCount, 0, "Vibe 수");
  const vibeEncodingCount = count(options.vibeEncodingCount, 0, "미인코딩 Vibe 수");
  const subscriptionKnown = options.subscriptionKnown === true;
  const isOpus = subscriptionKnown && options.isOpus === true;
  const perImageExtras = preciseReferenceCount * PRECISE_REFERENCE_COST + Math.max(0, vibeCount - FREE_VIBE_COUNT) * EXTRA_VIBE_COST;
  let baseGenerationCost = 0;
  let maximumPerImageCost = 0;

  for (const variant of variants) {
    const sampleCost = imageSampleCost(variant.settings);
    const opusFree = isOpus
      && !options.hasBaseImage
      && variant.settings.width * variant.settings.height <= OPUS_FREE_PIXELS
      && variant.settings.steps <= 28;
    const baseCost = opusFree ? 0 : sampleCost;
    baseGenerationCost += baseCost * variant.count;
    maximumPerImageCost = Math.max(maximumPerImageCost, baseCost + perImageExtras);
  }

  const preciseReferenceCost = preciseReferenceCount * PRECISE_REFERENCE_COST * generationCount;
  const vibeGenerationCost = Math.max(0, vibeCount - FREE_VIBE_COUNT) * EXTRA_VIBE_COST * generationCount;
  const vibeEncodingCost = vibeEncodingCount * VIBE_ENCODING_COST;
  const totalCost = baseGenerationCost + preciseReferenceCost + vibeGenerationCost + vibeEncodingCost;
  const reasons = [];
  if (!subscriptionKnown) reasons.push("구독 등급 미확인: 비Opus 기준 최대 예상입니다.");
  if (baseGenerationCost) reasons.push(`기본 생성 ${baseGenerationCost} Anlas`);
  if (preciseReferenceCost) reasons.push(`Precise ${preciseReferenceCost} Anlas`);
  if (vibeGenerationCost) reasons.push(`Vibe 생성 가산 ${vibeGenerationCost} Anlas`);
  if (vibeEncodingCost) reasons.push(`Vibe 인코딩 ${vibeEncodingCost} Anlas`);

  return {
    formulaVersion: FORMULA_VERSION,
    subscriptionKnown,
    isOpus,
    generationCount,
    baseGenerationCost,
    preciseReferenceCost,
    vibeGenerationCost,
    vibeEncodingCost,
    totalCost,
    isFree: totalCost === 0,
    eligible: totalCost === 0,
    overLimit: maximumPerImageCost > MAX_COST_PER_IMAGE,
    maximumPerImageCost,
    reasons,
    nSamples: 1,
    concurrency: 1,
  };
}

module.exports = {
  FORMULA_VERSION,
  imageSampleCost,
  estimateAnlasCost,
};
