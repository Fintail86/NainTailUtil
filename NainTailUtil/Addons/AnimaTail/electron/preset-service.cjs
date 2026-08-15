"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const generationProfile = require("./generation-profile.cjs");
const { normalizeOutputSegment } = require("./output-naming.cjs");

const PRESET_CATEGORIES = Object.freeze({
  base: Object.freeze({ folder: "base", kind: "text" }),
  prompts: Object.freeze({ folder: "prompts", kind: "text" }),
  negativePrompts: Object.freeze({ folder: "negative_prompts", kind: "text" }),
  subPrompts: Object.freeze({ folder: "sub_prompts", kind: "list" }),
  environments: Object.freeze({ folder: "environments", kind: "environment" }),
});

const PRESET_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,120}$/;
const MAX_NAME_LENGTH = 80;
const MAX_PROMPT_LENGTH = 4000;
const MAX_SUB_PROMPTS = 20;

function categoryConfig(category) {
  const config = PRESET_CATEGORIES[category];
  if (!config) throw new Error("지원하지 않는 프리셋 분류입니다.");
  return config;
}

function presetsRoot(appRoot) {
  return path.join(appRoot, "Presets");
}

function ensurePresetFolders(appRoot) {
  const root = presetsRoot(appRoot);
  for (const config of Object.values(PRESET_CATEGORIES)) {
    fs.mkdirSync(path.join(root, config.folder), { recursive: true });
  }
  return root;
}

function normalizeName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > MAX_NAME_LENGTH) {
    throw new Error(`프리셋 이름은 1~${MAX_NAME_LENGTH}자로 입력해 주세요.`);
  }
  return name;
}

function normalizePrompt(value, label, allowEmpty = false) {
  const prompt = typeof value === "string" ? value.trim() : "";
  if ((!allowEmpty && !prompt) || prompt.length > MAX_PROMPT_LENGTH) {
    const minimum = allowEmpty ? 0 : 1;
    throw new Error(`${label}은 ${minimum}~${MAX_PROMPT_LENGTH}자로 입력해 주세요.`);
  }
  return prompt;
}

function normalizeItems(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_SUB_PROMPTS) {
    throw new Error(`서브 프롬프트 리스트는 1~${MAX_SUB_PROMPTS}개 항목이어야 합니다.`);
  }
  return value.map((item, index) => {
    const prompt = normalizePrompt(item?.prompt, `서브 프롬프트 ${index + 1}`, true);
    const negativePrompt = normalizePrompt(
      item?.negativePrompt,
      `서브 부정 프롬프트 ${index + 1}`,
      true,
    );
    if (!prompt && !negativePrompt) {
      throw new Error(`서브 프롬프트 ${index + 1}의 내용을 입력해 주세요.`);
    }
    return { prompt, negativePrompt };
  });
}

function normalizeCatalogId(value, prefix, label) {
  const id = typeof value === "string" ? value.trim() : "";
  const expectedPrefix = `${prefix}:`;
  const relativePath = id.startsWith(expectedPrefix) ? id.slice(expectedPrefix.length) : "";
  if (
    !relativePath
    || relativePath.includes("\\")
    || path.isAbsolute(relativePath)
    || relativePath.split("/").some((segment) => !segment || segment === "." || segment === "..")
    || path.extname(relativePath).toLowerCase() !== ".safetensors"
  ) {
    throw new Error(`${label} catalog ID 형식이 잘못됐습니다.`);
  }
  return id;
}

function normalizeNumber(value, limits, label, integer = false) {
  const number = Number(value);
  if (!Number.isFinite(number) || (integer && !Number.isInteger(number))) {
    throw new Error(`${label} 값이 올바르지 않습니다.`);
  }
  if (number < limits.min || number > limits.max) {
    throw new Error(`${label} 값은 ${limits.min}~${limits.max} 범위여야 합니다.`);
  }
  return number;
}

function normalizeEnvironment(value) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const width = normalizeNumber(raw.width, generationProfile.limits.dimension, "Width", true);
  const height = normalizeNumber(raw.height, generationProfile.limits.dimension, "Height", true);
  if (
    width % generationProfile.limits.dimension.step !== 0
    || height % generationProfile.limits.dimension.step !== 0
  ) {
    throw new Error(`이미지 크기는 ${generationProfile.limits.dimension.step}px 단위여야 합니다.`);
  }

  const loras = Array.isArray(raw.loras) ? raw.loras : [];
  if (loras.length > generationProfile.limits.lorasPerJob.max) {
    throw new Error(`공용 LoRA는 최대 ${generationProfile.limits.lorasPerJob.max}개까지 저장할 수 있습니다.`);
  }
  const normalizedLoras = loras.map((lora, index) => ({
    id: normalizeCatalogId(lora?.id, "loras", `LoRA ${index + 1}`),
    strength: normalizeNumber(
      lora?.strength,
      generationProfile.limits.loraStrength,
      `LoRA ${index + 1} 강도`,
    ),
  }));
  if (new Set(normalizedLoras.map((lora) => lora.id)).size !== normalizedLoras.length) {
    throw new Error("환경 프리셋에 같은 LoRA를 두 번 저장할 수 없습니다.");
  }
  const turboCount = normalizedLoras.filter((lora) => (
    lora.id.slice("loras:".length).startsWith(generationProfile.turboLoraPrefix)
  )).length;
  if (turboCount > 1) throw new Error("환경 프리셋에는 Turbo LoRA를 하나만 저장할 수 있습니다.");

  const sampler = generationProfile.sampling.samplers.includes(raw.sampler)
    ? raw.sampler
    : null;
  const scheduler = generationProfile.sampling.schedulers.includes(raw.scheduler)
    ? raw.scheduler
    : null;
  if (!sampler) throw new Error("지원하지 않는 샘플러입니다.");
  if (!scheduler) throw new Error("지원하지 않는 스케줄러입니다.");
  const steps = normalizeNumber(raw.steps, generationProfile.limits.steps, "Steps", true);
  const minimumSteps = generationProfile.sampling.minimumSteps[sampler] || 1;
  if (steps < minimumSteps) throw new Error(`${sampler} 샘플러는 최소 ${minimumSteps} Steps가 필요합니다.`);

  const randomSeed = raw.randomSeed !== false;
  return {
    modelId: normalizeCatalogId(raw.modelId, "diffusion_models", "디퓨전 모델"),
    loras: normalizedLoras,
    width,
    height,
    steps,
    cfg: normalizeNumber(raw.cfg, generationProfile.limits.cfg, "CFG"),
    sampler,
    scheduler,
    batchSize: normalizeNumber(raw.batchSize, generationProfile.limits.batch, "배치", true),
    queueCount: normalizeNumber(raw.queueCount, generationProfile.limits.queue, "큐", true),
    randomSeed,
    seed: randomSeed
      ? null
      : normalizeNumber(raw.seed, generationProfile.limits.seed, "Seed", true),
    outputPrefix: normalizeOutputSegment(
      raw.outputPrefix,
      "Prefix",
      generationProfile.outputNaming.defaultPrefix,
    ),
  };
}

function normalizeId(value) {
  const id = typeof value === "string" ? value : "";
  if (!PRESET_ID_PATTERN.test(id)) throw new Error("프리셋 ID 형식이 잘못됐습니다.");
  return id;
}

function slugify(name) {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "preset";
}

function resolvePresetPath(appRoot, category, id) {
  const config = categoryConfig(category);
  const safeId = normalizeId(id);
  const categoryRoot = path.resolve(ensurePresetFolders(appRoot), config.folder);
  const target = path.resolve(categoryRoot, `${safeId}.json`);
  const relative = path.relative(categoryRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("허용되지 않은 프리셋 경로입니다.");
  }
  return target;
}

function normalizeStoredPreset(raw, category, id) {
  const config = categoryConfig(category);
  const preset = {
    schemaVersion: 1,
    id,
    category,
    name: normalizeName(raw?.name),
    createdAt: typeof raw?.createdAt === "string" ? raw.createdAt : null,
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : null,
  };
  if (config.kind === "text") {
    preset.content = normalizePrompt(raw?.content, "프롬프트");
  } else if (config.kind === "list") {
    preset.items = normalizeItems(raw?.items);
  } else {
    preset.settings = normalizeEnvironment(raw?.settings);
  }
  return preset;
}

function readPreset(appRoot, category, id) {
  const target = resolvePresetPath(appRoot, category, id);
  if (!fs.existsSync(target)) throw new Error("프리셋 파일을 찾을 수 없습니다.");
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch {
    throw new Error("프리셋 JSON을 읽을 수 없습니다.");
  }
  return normalizeStoredPreset(raw, category, normalizeId(id));
}

function presetReferenceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function readPresetReference(appRoot, category, reference) {
  if (typeof reference === "string") return readPreset(appRoot, category, reference);
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
    throw presetReferenceError("PRESET_REFERENCE_INVALID", "프리셋 참조 형식이 잘못됐습니다.");
  }
  const keys = Object.keys(reference);
  if (keys.length !== 1 || !["id", "name"].includes(keys[0])) {
    throw presetReferenceError(
      "PRESET_REFERENCE_INVALID",
      "프리셋 참조에는 id 또는 name 중 하나만 지정해 주세요.",
    );
  }
  if (keys[0] === "id") return readPreset(appRoot, category, reference.id);

  const name = normalizeName(reference.name);
  const matches = listPresets(appRoot)[category].filter((preset) => preset.name === name);
  if (matches.length === 0) {
    throw presetReferenceError("PRESET_NAME_NOT_FOUND", `이름이 일치하는 프리셋이 없습니다: ${name}`);
  }
  if (matches.length > 1) {
    throw presetReferenceError(
      "PRESET_NAME_AMBIGUOUS",
      `같은 이름의 프리셋이 여러 개입니다: ${name} (${matches.map((preset) => preset.id).join(", ")})`,
    );
  }
  return readPreset(appRoot, category, matches[0].id);
}

function summary(preset) {
  if (preset.settings) {
    return {
      id: preset.id,
      category: preset.category,
      name: preset.name,
      updatedAt: preset.updatedAt,
      preview: preset.settings.modelId,
      itemCount: preset.settings.loras.length,
      width: preset.settings.width,
      height: preset.settings.height,
    };
  }
  return {
    id: preset.id,
    category: preset.category,
    name: preset.name,
    updatedAt: preset.updatedAt,
    preview: preset.content || preset.items?.[0]?.prompt || preset.items?.[0]?.negativePrompt || "",
    itemCount: preset.items?.length || 1,
  };
}

function listPresets(appRoot) {
  ensurePresetFolders(appRoot);
  const result = {
    ...Object.fromEntries(Object.keys(PRESET_CATEGORIES).map((category) => [category, []])),
    errors: [],
  };
  for (const [category, config] of Object.entries(PRESET_CATEGORIES)) {
    const folder = path.join(presetsRoot(appRoot), config.folder);
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".json") continue;
      const id = path.basename(entry.name, ".json");
      try {
        result[category].push(summary(readPreset(appRoot, category, id)));
      } catch (error) {
        result.errors.push({ category, fileName: entry.name, error: error.message });
      }
    }
    result[category].sort((left, right) => (
      String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""))
    ));
  }
  return result;
}

function savePreset(appRoot, request) {
  const category = typeof request?.category === "string" ? request.category : "";
  const config = categoryConfig(category);
  const name = normalizeName(request?.name);
  const id = request?.id
    ? normalizeId(request.id)
    : `${slugify(name)}-${randomUUID().slice(0, 8)}`;
  const target = resolvePresetPath(appRoot, category, id);
  let previous = null;
  if (fs.existsSync(target)) previous = readPreset(appRoot, category, id);
  const now = new Date().toISOString();
  const preset = {
    schemaVersion: 1,
    id,
    category,
    name,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
  };
  if (config.kind === "text") {
    preset.content = normalizePrompt(request?.content, "프롬프트");
  } else if (config.kind === "list") {
    preset.items = normalizeItems(request?.items);
  } else {
    preset.settings = normalizeEnvironment(request?.settings);
  }

  const temporary = `${target}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(preset, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return preset;
}

module.exports = {
  PRESET_CATEGORIES,
  ensurePresetFolders,
  listPresets,
  normalizeEnvironment,
  readPreset,
  readPresetReference,
  resolvePresetPath,
  savePreset,
};
