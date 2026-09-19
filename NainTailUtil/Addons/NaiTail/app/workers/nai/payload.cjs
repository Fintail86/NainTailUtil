"use strict";

const { randomInt } = require("node:crypto");
const { activeCharacterPrompts, composeCharacterPrompt, positionToCenter } = require("../../core/character-prompt.cjs");
const { requireModelDefinition } = require("../../core/nai-models.cjs");

// Exact V4.5 suffixes observed in NovelAI's public web client build
// c410ef7-production (2026-08-11). The prose docs can lag this wire contract.
const QUALITY_SUFFIX = Object.freeze({
  "nai-diffusion-4-5-full": ", very aesthetic, masterpiece, no text",
  "nai-diffusion-4-5-curated": ", very aesthetic, masterpiece, no text, -0.8::feet::, rating:general",
  "nai-diffusion-5-full": ", very aesthetic, masterpiece, no text",
  "nai-diffusion-5-curated": ", very aesthetic, masterpiece, no text",
});

const QUALITY_PRESETS = Object.freeze({
  "nai-diffusion-5-full": Object.freeze({ Standard: QUALITY_SUFFIX["nai-diffusion-5-full"], Light: ", very aesthetic, amazing quality, no text", None: "" }),
  "nai-diffusion-5-curated": Object.freeze({ Standard: QUALITY_SUFFIX["nai-diffusion-5-curated"], Light: ", very aesthetic, amazing quality, no text", None: "" }),
});

const UC_PRESETS = Object.freeze({
  "nai-diffusion-4-5-full": [
    ["Heavy", "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page"],
    ["Light", "lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page"],
    ["Furry Focus", "{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, blurred foreground, chromatic aberration, sketch, everyone, simple, flat colors, outline, multiple scenes"],
    ["Human Focus", "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy"],
    ["None", ""],
  ],
  "nai-diffusion-4-5-curated": [
    ["Heavy", "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page"],
    ["Light", "blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page"],
    ["Human Focus", "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page"],
    ["None", ""],
  ],
  "nai-diffusion-5-full": [
    ["Heavy", "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page"],
    ["Light", "lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::"],
    ["Furry Focus", "{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, blurred foreground, chromatic aberration, sketch, everyone, simple, flat colors, outline, multiple scenes"],
    ["Human Focus", "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy"],
    ["None", ""],
  ],
  "nai-diffusion-5-curated": [
    ["Heavy", "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page"],
    ["Light", "lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::"],
    ["Furry Focus", "{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, blurred foreground, chromatic aberration, sketch, everyone, simple, flat colors, outline, multiple scenes"],
    ["Human Focus", "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy"],
    ["None", ""],
  ],
});

const NO_NSFW_PREFIX = new Set(["nai-diffusion-4-5-curated", "nai-diffusion-5-curated"]);
const TEXT_CLAUSE = /(?:^|\s|[,.:\[\]{}、。])text:(?!:)/iu;
const TRANSPARENCY_PROMPT_TAGS = Object.freeze({
  "transparent-background": "transparent background",
  "has-alpha": "has alpha",
  "alpha-transparency": "alpha transparency",
});

function appendBeforeTextClause(prompt, addition) {
  const match = TEXT_CLAUSE.exec(prompt);
  if (!match) return `${prompt}${addition}`;
  const before = prompt.slice(0, match.index).trimEnd().replace(/[,\s]+$/gu, "");
  const tags = addition.trim().replace(/^,\s*/u, "");
  const textClause = prompt.slice(match.index).trimStart().replace(/^,\s*/u, "");
  return [before, tags, textClause].filter(Boolean).join(", ");
}

function resolveUc(model, presetName, prompt, userNegative) {
  const presets = UC_PRESETS[model] || UC_PRESETS["nai-diffusion-4-5-full"];
  const index = resolveUcPresetIndex(presets, presetName);
  let text = presets[index]?.[1] || "";
  if (text && !NO_NSFW_PREFIX.has(model) && !prompt.toLowerCase().includes("nsfw")) text = `nsfw, ${text}`;
  return [text, String(userNegative || "").trim()].filter(Boolean).join(", ");
}

function resolveUcPresetIndex(presets, presetName) {
  const requested = presets.findIndex(([name]) => name === presetName);
  if (requested >= 0) return requested;
  return Math.max(0, presets.findIndex(([name]) => name === "None"));
}

function createPayload(request) {
  if (!request || request.schema !== "naintail.generate/v1") throw new Error("지원하지 않는 생성 요청 schema입니다.");
  const characters = activeCharacterPrompts(request.characters, request.settings.model).map((character) => ({
    ...character,
    prompt: composeCharacterPrompt(character),
    negativePrompt: character.negativePrompt.trim(),
    center: positionToCenter(character.position),
  }));
  if (!String(request.prompt || "").trim() && !characters.length) throw new Error("프롬프트와 활성 캐릭터가 모두 비어 있습니다.");
  if (request.nSamples !== 1) throw new Error("NAI 요청은 항상 한 장이어야 합니다.");

  const settings = request.settings;
  const model = settings.model;
  const definition = requireModelDefinition(model);
  let prompt = String(request.prompt || "").trim();
  const qualityPreset = settings.qualityPreset || (settings.qualityTags === false ? "None" : "Standard");
  if (qualityPreset !== "None") {
    const suffix = QUALITY_PRESETS[model]?.[qualityPreset] || QUALITY_SUFFIX[model] || QUALITY_SUFFIX["nai-diffusion-4-5-full"];
    prompt = appendBeforeTextClause(prompt, suffix);
  }
  const transparencyMode = settings.transparencyMode || (settings.transparentBackground ? "transparent-background" : "none");
  const transparencyTag = TRANSPARENCY_PROMPT_TAGS[transparencyMode] || "";
  if (transparencyTag && !prompt.toLowerCase().includes(transparencyTag)) prompt = appendBeforeTextClause(prompt, `, ${transparencyTag}`);
  const negative = resolveUc(model, settings.ucPreset, prompt, request.negativePrompt);
  const seed = settings.seed === null ? randomInt(0, 0xffffffff) : settings.seed;
  const presets = UC_PRESETS[model] || UC_PRESETS["nai-diffusion-4-5-full"];
  const ucPresetIndex = resolveUcPresetIndex(presets, settings.ucPreset);
  const useCoords = characters.some((character) => character.position);
  const params = {
    params_version: definition.paramsVersion,
    width: settings.width,
    height: settings.height,
    scale: settings.guidance,
    sampler: settings.sampler,
    steps: settings.steps,
    seed,
    n_samples: 1,
    dynamic_thresholding: definition.capabilities.decrisper && settings.decrisper === true,
    controlnet_strength: 1,
    legacy: false,
    add_original_image: true,
    cfg_rescale: settings.cfgRescale,
    noise_schedule: definition.capabilities.scheduler ? settings.scheduler : "karras",
    legacy_v3_extend: false,
    negative_prompt: negative,
    prompt,
    image_format: "png",
    inpaintImg2ImgStrength: 1,
    legacy_uc: false,
    normalize_reference_strength_multiple: request.normalizeVibeStrengths !== false,
    // The current V4/V4.5 web request removes legacy sm/sm_dyn and disables Auto SMEA.
    autoSmea: false,
    use_coords: useCoords,
    characterPrompts: characters.map((character) => ({ prompt: character.prompt, uc: character.negativePrompt, center: character.center, enabled: true })),
    v4_prompt: {
      use_coords: useCoords,
      use_order: true,
      caption: { base_caption: prompt, char_captions: characters.map((character) => ({ char_caption: character.prompt, centers: [character.center] })) },
    },
    v4_negative_prompt: {
      legacy_uc: false,
      caption: { base_caption: negative, char_captions: characters.map((character) => ({ char_caption: character.negativePrompt, centers: [character.center] })) },
    },
  };
  if (definition.generation >= 5) {
    params.tag_hint_qt = qualityPreset === "Standard" ? 1 : qualityPreset === "Light" ? 3 : 0;
    params.tag_hint_uc_preset = ucPresetIndex;
    params.tag_hint_transparent_background = Boolean(transparencyTag);
  } else {
    params.ucPreset = ucPresetIndex;
    params.qualityToggle = qualityPreset !== "None";
  }
  if (settings.sampler === "k_euler_ancestral" && params.noise_schedule !== "native") {
    params.deliberate_euler_ancestral_bug = false;
    params.prefer_brownian = true;
  }
  const preciseReferences = Array.isArray(request.preciseReferences) ? request.preciseReferences : [];
  if (preciseReferences.length) {
    if (!definition.capabilities.preciseReference) throw new Error("Precise Reference는 현재 NAI V4.5 모델에서만 사용할 수 있습니다.");
    if (preciseReferences.some((reference) => !reference.image)) throw new Error("Precise Reference 이미지 데이터가 없습니다.");
    params.director_reference_images = preciseReferences.map((reference) => reference.image);
    params.director_reference_information_extracted = preciseReferences.map(() => 1);
    params.director_reference_strength_values = preciseReferences.map((reference) => Number(reference.strength));
    params.director_reference_secondary_strength_values = preciseReferences.map((reference) => Math.round((1 - Number(reference.fidelity)) * 100) / 100);
    params.director_reference_descriptions = preciseReferences.map((reference) => ({
      caption: { base_caption: reference.mode, char_captions: [] },
      legacy_uc: false,
    }));
  }
  const vibes = Array.isArray(request.vibes) ? request.vibes : [];
  if (vibes.length) {
    if (!definition.capabilities.vibe) throw new Error("Vibe Transfer는 현재 NAI V4.5 모델에서만 사용할 수 있습니다.");
    if (preciseReferences.length) throw new Error("Vibe Transfer와 Precise Reference는 동시에 사용할 수 없습니다.");
    if (vibes.some((vibe) => !vibe.encoded)) throw new Error("V4 Vibe 인코딩 데이터가 없습니다.");
    let strengths = vibes.map((vibe) => Number(vibe.strength));
    if (params.normalize_reference_strength_multiple && strengths.length > 1) {
      const total = strengths.reduce((sum, value) => sum + Math.abs(value), 0);
      if (total > 1) strengths = strengths.map((value) => value / total);
    }
    params.reference_image_multiple = vibes.map((vibe) => vibe.encoded);
    params.reference_strength_multiple = strengths;
  }
  return {
    payload: { input: prompt, model, action: "generate", use_new_shared_trial: true, parameters: params },
    resolved: { prompt, negativePrompt: negative, characters: characters.map(({ id, name, prompt: characterPrompt, negativePrompt, position, center }) => ({ id, name, prompt: characterPrompt, negativePrompt, position, center })), preciseReferences: preciseReferences.map(({ image, ...reference }) => reference), vibes: vibes.map(({ image, encoded, ...vibe }) => vibe), seed, model, width: settings.width, height: settings.height },
  };
}

module.exports = { QUALITY_PRESETS, QUALITY_SUFFIX, UC_PRESETS, appendBeforeTextClause, createPayload, resolveUc };
