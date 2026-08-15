"use strict";

const fs = require("node:fs");
const generationProfile = require("../electron/generation-profile.cjs");
const { readPresetReference } = require("../electron/preset-service.cjs");

const PRESET_FIELDS = Object.freeze({
  environment: "environments",
  base: "base",
  prompt: "prompts",
  negativePrompt: "negativePrompts",
  subPrompts: "subPrompts",
});

const TOP_LEVEL_FIELDS = new Set([
  "schemaVersion",
  "requestId",
  "mode",
  "presets",
  "promptOverrides",
  "subPromptOverrides",
  "selectedSlots",
  "basePrompt",
  "prompt",
  "negativePrompt",
  "subPrompts",
  "modelId",
  "loras",
  "loraLoadMode",
  "outputPrefix",
  "outputSubPrefix",
  "width",
  "height",
  "steps",
  "cfg",
  "sampler",
  "scheduler",
  "batchSize",
  "queueCount",
  "randomSeed",
  "seed",
]);

class CliConfigError extends Error {
  constructor(code, message, exitCode = 2) {
    super(message);
    this.name = "CliConfigError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

function objectValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CliConfigError("INVALID_CONFIG", `${label}은 JSON 객체여야 합니다.`);
  }
  return value;
}

function rejectUnknownFields(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new CliConfigError("UNKNOWN_CONFIG_FIELD", `${label}에 지원하지 않는 필드가 있습니다: ${unknown.join(", ")}`);
  }
}

function readJsonFile(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) {
    throw new CliConfigError("CONFIG_REQUIRED", "--config JSON 파일을 지정해 주세요.");
  }
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new CliConfigError("CONFIG_NOT_FOUND", `설정 파일을 읽을 수 없습니다: ${error.message}`);
  }
  try {
    return objectValue(JSON.parse(text), "설정 파일");
  } catch (error) {
    if (error instanceof CliConfigError) throw error;
    throw new CliConfigError("CONFIG_JSON_INVALID", `설정 JSON 형식이 잘못됐습니다: ${error.message}`);
  }
}

function loadPreset(appRoot, category, reference, label) {
  try {
    return readPresetReference(appRoot, category, reference);
  } catch (error) {
    if (error instanceof CliConfigError) throw error;
    throw new CliConfigError(
      error?.code || "PRESET_NOT_FOUND",
      `${label} 프리셋을 읽을 수 없습니다: ${error.message}`,
      3,
    );
  }
}

function normalizeLoraSelections(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new CliConfigError("INVALID_LORAS", `${label}은 배열이어야 합니다.`);
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new CliConfigError("INVALID_LORA", `${label} ${index + 1} 형식이 잘못됐습니다.`);
    }
    rejectUnknownFields(item, new Set(["id", "strength"]), `${label} ${index + 1}`);
    if (typeof item.id !== "string" || item.id.length === 0
      || typeof item.strength !== "number" || !Number.isFinite(item.strength)) {
      throw new CliConfigError("INVALID_LORA", `${label} ${index + 1}의 id와 strength가 필요합니다.`);
    }
    return { id: item.id, strength: item.strength };
  });
}

function normalizeSubPrompt(item, index) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new CliConfigError("INVALID_SUB_PROMPT", `서브 프롬프트 ${index + 1} 형식이 잘못됐습니다.`);
  }
  rejectUnknownFields(
    item,
    new Set(["id", "prompt", "negativePrompt", "enabled", "loras"]),
    `서브 프롬프트 ${index + 1}`,
  );
  if (item.id !== undefined && typeof item.id !== "string") {
    throw new CliConfigError("INVALID_SUB_PROMPT", `서브 프롬프트 ${index + 1}의 id는 문자열이어야 합니다.`);
  }
  if (item.enabled !== undefined && typeof item.enabled !== "boolean") {
    throw new CliConfigError("INVALID_SUB_PROMPT", `서브 프롬프트 ${index + 1}의 enabled는 Boolean이어야 합니다.`);
  }
  if (item.prompt !== undefined && typeof item.prompt !== "string") {
    throw new CliConfigError("INVALID_SUB_PROMPT", `서브 프롬프트 ${index + 1}의 prompt는 문자열이어야 합니다.`);
  }
  if (item.negativePrompt !== undefined && typeof item.negativePrompt !== "string") {
    throw new CliConfigError("INVALID_SUB_PROMPT", `서브 프롬프트 ${index + 1}의 negativePrompt는 문자열이어야 합니다.`);
  }
  return {
    id: typeof item.id === "string" ? item.id : `sub-${index + 1}`,
    prompt: typeof item.prompt === "string" ? item.prompt : "",
    negativePrompt: typeof item.negativePrompt === "string" ? item.negativePrompt : "",
    enabled: item.enabled !== false,
    loras: normalizeLoraSelections(item.loras, `서브 프롬프트 ${index + 1} LoRA`),
  };
}

function applySubPromptOverrides(items, overrides) {
  if (overrides === undefined) return items;
  if (!Array.isArray(overrides)) {
    throw new CliConfigError("INVALID_SUB_PROMPT_OVERRIDES", "subPromptOverrides는 배열이어야 합니다.");
  }
  const patched = items.map((item) => ({ ...item, loras: [...item.loras] }));
  const seen = new Set();
  for (const override of overrides) {
    if (!override || typeof override !== "object" || Array.isArray(override)) {
      throw new CliConfigError("INVALID_SUB_PROMPT_OVERRIDE", "서브 프롬프트 override 형식이 잘못됐습니다.");
    }
    rejectUnknownFields(
      override,
      new Set(["slot", "enabled", "prompt", "negativePrompt", "loras", "id"]),
      "서브 프롬프트 override",
    );
    const slot = override.slot;
    if (!Number.isInteger(slot) || slot < 1 || slot > patched.length || seen.has(slot)) {
      throw new CliConfigError("INVALID_SUB_PROMPT_SLOT", `유효하지 않거나 중복된 서브 프롬프트 슬롯입니다: ${override.slot}`);
    }
    if (override.enabled !== undefined && typeof override.enabled !== "boolean") {
      throw new CliConfigError("INVALID_SUB_PROMPT_OVERRIDE", `서브 프롬프트 ${slot}의 enabled는 Boolean이어야 합니다.`);
    }
    for (const field of ["id", "prompt", "negativePrompt"]) {
      if (override[field] !== undefined && typeof override[field] !== "string") {
        throw new CliConfigError("INVALID_SUB_PROMPT_OVERRIDE", `서브 프롬프트 ${slot}의 ${field}는 문자열이어야 합니다.`);
      }
    }
    seen.add(slot);
    const current = patched[slot - 1];
    patched[slot - 1] = {
      ...current,
      ...(typeof override.id === "string" ? { id: override.id } : {}),
      ...(typeof override.enabled === "boolean" ? { enabled: override.enabled } : {}),
      ...(typeof override.prompt === "string" ? { prompt: override.prompt } : {}),
      ...(typeof override.negativePrompt === "string" ? { negativePrompt: override.negativePrompt } : {}),
      ...(override.loras !== undefined
        ? { loras: normalizeLoraSelections(override.loras, `서브 프롬프트 ${slot} LoRA`) }
        : {}),
    };
  }
  return patched;
}

function applySelectedSlots(items, selectedSlots, overrides) {
  if (selectedSlots === undefined) return items;
  if (!Array.isArray(selectedSlots) || selectedSlots.length === 0) {
    throw new CliConfigError("INVALID_SELECTED_SLOTS", "selectedSlots에는 출력할 슬롯을 하나 이상 지정해 주세요.");
  }
  if (Array.isArray(overrides) && overrides.some((override) => override?.enabled !== undefined)) {
    throw new CliConfigError(
      "SUB_PROMPT_SELECTION_CONFLICT",
      "selectedSlots와 subPromptOverrides.enabled는 함께 사용할 수 없습니다.",
    );
  }
  const selected = new Set();
  for (const slot of selectedSlots) {
    if (!Number.isInteger(slot) || slot < 1 || slot > items.length || selected.has(slot)) {
      throw new CliConfigError("INVALID_SELECTED_SLOT", `유효하지 않거나 중복된 선택 슬롯입니다: ${slot}`);
    }
    selected.add(slot);
  }
  return items.map((item, index) => ({ ...item, enabled: selected.has(index + 1) }));
}

function resolveGenerationConfig(appRoot, rawConfig, expectedMode = null) {
  const config = objectValue(rawConfig, "생성 설정");
  rejectUnknownFields(config, TOP_LEVEL_FIELDS, "생성 설정");
  if (config.schemaVersion !== 1) {
    throw new CliConfigError("SCHEMA_VERSION_UNSUPPORTED", `지원하지 않는 schemaVersion입니다: ${config.schemaVersion}`);
  }
  if (!["single", "multi"].includes(config.mode)) {
    throw new CliConfigError("MODE_INVALID", "mode는 single 또는 multi여야 합니다.");
  }
  if (config.requestId !== undefined && (typeof config.requestId !== "string" || config.requestId.length === 0)) {
    throw new CliConfigError("REQUEST_ID_INVALID", "requestId는 비어 있지 않은 문자열이어야 합니다.");
  }
  if (config.loraLoadMode !== undefined && !["fused", "hotload"].includes(config.loraLoadMode)) {
    throw new CliConfigError("LORA_LOAD_MODE_INVALID", "loraLoadMode는 fused 또는 hotload여야 합니다.");
  }
  if (config.randomSeed !== undefined && typeof config.randomSeed !== "boolean") {
    throw new CliConfigError("RANDOM_SEED_INVALID", "randomSeed는 Boolean이어야 합니다.");
  }
  for (const field of ["outputPrefix", "outputSubPrefix", "sampler", "scheduler"]) {
    if (config[field] !== undefined && typeof config[field] !== "string") {
      throw new CliConfigError("FIELD_TYPE_INVALID", `${field}는 문자열이어야 합니다.`);
    }
  }
  for (const field of ["width", "height", "steps", "batchSize", "queueCount", "seed"]) {
    if (config[field] !== undefined && !Number.isInteger(config[field])) {
      throw new CliConfigError("FIELD_TYPE_INVALID", `${field}는 정수여야 합니다.`);
    }
  }
  if (config.cfg !== undefined && (typeof config.cfg !== "number" || !Number.isFinite(config.cfg))) {
    throw new CliConfigError("FIELD_TYPE_INVALID", "cfg는 숫자여야 합니다.");
  }
  if (expectedMode && config.mode !== expectedMode) {
    throw new CliConfigError("MODE_MISMATCH", `명령은 ${expectedMode}이지만 설정 mode는 ${config.mode}입니다.`);
  }

  const presets = config.presets === undefined ? {} : objectValue(config.presets, "presets");
  rejectUnknownFields(presets, new Set(Object.keys(PRESET_FIELDS)), "presets");
  const promptOverrides = config.promptOverrides === undefined
    ? {}
    : objectValue(config.promptOverrides, "promptOverrides");
  rejectUnknownFields(
    promptOverrides,
    new Set(["basePrompt", "prompt", "negativePrompt"]),
    "promptOverrides",
  );

  let basePrompt = "";
  let prompt = "";
  let negativePrompt = "";
  let subPrompts = [];
  let environment = null;
  if (presets.environment !== undefined) {
    const preset = loadPreset(appRoot, "environments", presets.environment, "환경");
    environment = preset.settings;
  }
  if (presets.base !== undefined) basePrompt = loadPreset(appRoot, "base", presets.base, "Base").content;
  if (presets.prompt !== undefined) prompt = loadPreset(appRoot, "prompts", presets.prompt, "프롬프트").content;
  if (presets.negativePrompt !== undefined) {
    negativePrompt = loadPreset(appRoot, "negativePrompts", presets.negativePrompt, "네거티브").content;
  }
  if (presets.subPrompts !== undefined) {
    const preset = loadPreset(appRoot, "subPrompts", presets.subPrompts, "서브 프롬프트");
    subPrompts = preset.items.map((item, index) => normalizeSubPrompt({
      id: `${preset.id}-${index + 1}`,
      ...item,
    }, index));
  }

  if (Object.hasOwn(config, "basePrompt")) basePrompt = config.basePrompt;
  if (Object.hasOwn(config, "prompt")) prompt = config.prompt;
  if (Object.hasOwn(config, "negativePrompt")) negativePrompt = config.negativePrompt;
  if (Object.hasOwn(promptOverrides, "basePrompt")) basePrompt = promptOverrides.basePrompt;
  if (Object.hasOwn(promptOverrides, "prompt")) prompt = promptOverrides.prompt;
  if (Object.hasOwn(promptOverrides, "negativePrompt")) negativePrompt = promptOverrides.negativePrompt;
  for (const [label, value] of Object.entries({ basePrompt, prompt, negativePrompt })) {
    if (typeof value !== "string") throw new CliConfigError("PROMPT_INVALID", `${label}는 문자열이어야 합니다.`);
  }

  if (config.subPrompts !== undefined) {
    if (!Array.isArray(config.subPrompts)) {
      throw new CliConfigError("SUB_PROMPTS_INVALID", "subPrompts는 배열이어야 합니다.");
    }
    subPrompts = config.subPrompts.map(normalizeSubPrompt);
  }
  subPrompts = applySubPromptOverrides(subPrompts, config.subPromptOverrides);
  subPrompts = applySelectedSlots(subPrompts, config.selectedSlots, config.subPromptOverrides);
  if (config.mode === "single" && (
    subPrompts.length > 0
    || config.subPromptOverrides !== undefined
    || config.selectedSlots !== undefined
  )) {
    throw new CliConfigError("SINGLE_SUB_PROMPTS_NOT_ALLOWED", "싱글 생성에는 서브 프롬프트를 사용할 수 없습니다.");
  }

  const defaults = {
    outputPrefix: generationProfile.outputNaming.defaultPrefix,
    outputSubPrefix: "",
    loras: [],
    loraLoadMode: "fused",
    width: 1024,
    height: 1024,
    steps: 10,
    cfg: 1,
    sampler: generationProfile.sampling.defaultSampler,
    scheduler: generationProfile.sampling.defaultScheduler,
    batchSize: 1,
    queueCount: 1,
    randomSeed: true,
    seed: 0,
  };
  const environmentDefaults = environment
    ? Object.fromEntries(Object.keys(defaults).map((key) => [
      key,
      key === "seed" ? environment.seed ?? 0 : environment[key],
    ]))
    : {};
  const commonLoras = config.loras !== undefined
    ? normalizeLoraSelections(config.loras, "공통 LoRA")
    : environment?.loras || [];
  const request = {
    ...defaults,
    ...environmentDefaults,
    ...Object.fromEntries(Object.keys(defaults)
      .filter((key) => Object.hasOwn(config, key))
      .map((key) => [key, config[key]])),
    generationMode: config.mode === "multi" ? "sub-prompt" : "standard",
    basePrompt,
    prompt,
    negativePrompt,
    modelId: config.modelId ?? environment?.modelId,
    loras: commonLoras,
    ...(config.mode === "multi" ? { subPrompts } : {}),
  };
  if (typeof request.modelId !== "string" || request.modelId.length === 0) {
    throw new CliConfigError("MODEL_ID_REQUIRED", "modelId를 지정해 주세요.", 3);
  }
  return {
    requestId: typeof config.requestId === "string" && config.requestId.length > 0
      ? config.requestId
      : null,
    request,
  };
}

module.exports = {
  CliConfigError,
  PRESET_FIELDS,
  applySubPromptOverrides,
  readJsonFile,
  resolveGenerationConfig,
};
