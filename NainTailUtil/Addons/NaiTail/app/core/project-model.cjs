"use strict";

const { createId } = require("./ids.cjs");
const { NainTailError } = require("./errors.cjs");
const { normalizeGenerationSettings } = require("./generation-profile.cjs");
const { normalizeCharacterPosition } = require("./character-prompt.cjs");

const PROJECT_SCHEMA = "naintail.project/v1";
const PRESET_SCHEMA = "naintail.sub-slot-preset/v1";
const EXAMPLE_PRESET_SCHEMA = "naintail.example-preset/v1";

function nowIso() {
  return new Date().toISOString();
}

function asString(value) {
  return typeof value === "string" ? value : "";
}

function createSlot(input = {}) {
  return {
    id: asString(input.id) || createId("slot"),
    name: asString(input.name) || "새 슬롯",
    prompt: asString(input.prompt),
    negativePrompt: asString(input.negativePrompt),
    enabled: input.enabled !== false,
    settings: input.settings && typeof input.settings === "object" && !Array.isArray(input.settings)
      ? { ...input.settings }
      : {},
  };
}

function createCharacterCard(input = {}) {
  return {
    id: asString(input.id) || createId("character"),
    name: asString(input.name) || "새 캐릭터",
    prompt: asString(input.prompt),
    negativePrompt: asString(input.negativePrompt),
    enabled: input.enabled !== false,
    position: normalizeCharacterPosition(input.position),
    settings: input.settings && typeof input.settings === "object" && !Array.isArray(input.settings)
      ? { ...input.settings }
      : {},
    slots: Array.isArray(input.slots) ? input.slots.map(createSlot) : [],
  };
}

function createProject(input = {}) {
  const createdAt = asString(input.createdAt) || nowIso();
  return {
    schema: PROJECT_SCHEMA,
    id: asString(input.id) || createId("project"),
    name: asString(input.name) || "새 작품",
    createdAt,
    updatedAt: asString(input.updatedAt) || createdAt,
    commonPrompt: asString(input.commonPrompt),
    commonNegativePrompt: asString(input.commonNegativePrompt),
    commonSettings: normalizeGenerationSettings(input.commonSettings || {}),
    generalSlots: Array.isArray(input.generalSlots) ? input.generalSlots.map(createSlot) : [],
    characters: Array.isArray(input.characters) ? input.characters.map(createCharacterCard) : [],
    results: Array.isArray(input.results)
      ? input.results.filter((item) => item && typeof item === "object").map((item) => ({ ...item }))
      : [],
  };
}

function createSubSlotPreset(input = {}) {
  return {
    schema: PRESET_SCHEMA,
    type: "sub-slot",
    id: asString(input.id) || createId("preset"),
    name: asString(input.name) || "새 서브슬롯 프리셋",
    createdAt: asString(input.createdAt) || nowIso(),
    updatedAt: asString(input.updatedAt) || nowIso(),
    items: Array.isArray(input.items) ? input.items.map((item) => ({
      name: asString(item?.name) || "새 슬롯",
      prompt: asString(item?.prompt),
      negativePrompt: asString(item?.negativePrompt),
      settings: item?.settings && typeof item.settings === "object" && !Array.isArray(item.settings)
        ? { ...item.settings }
        : {},
    })) : [],
  };
}

function createExamplePreset(input = {}) {
  return {
    schema: EXAMPLE_PRESET_SCHEMA,
    type: "example",
    id: asString(input.id) || createId("example"),
    name: asString(input.name) || "새 작례 프리셋",
    createdAt: asString(input.createdAt) || nowIso(),
    updatedAt: asString(input.updatedAt) || nowIso(),
    prompt: asString(input.prompt),
    negativePrompt: asString(input.negativePrompt),
  };
}

function assertUniqueIds(items, label) {
  const ids = new Set();
  for (const item of items) {
    if (!item.id || ids.has(item.id)) {
      throw new NainTailError("INVALID_PROJECT", `${label} ID가 없거나 중복되었습니다.`);
    }
    ids.add(item.id);
  }
}

function validateProject(project) {
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    throw new NainTailError("INVALID_PROJECT", "작품 데이터가 객체가 아닙니다.");
  }
  if (project.schema && project.schema !== PROJECT_SCHEMA) {
    throw new NainTailError("UNSUPPORTED_PROJECT_SCHEMA", `지원하지 않는 작품 schema입니다: ${project.schema}`);
  }
  const normalized = createProject(project);
  assertUniqueIds(normalized.generalSlots, "일반 슬롯");
  assertUniqueIds(normalized.characters, "캐릭터 카드");
  for (const character of normalized.characters) assertUniqueIds(character.slots, `${character.name} 슬롯`);
  return normalized;
}

function appendPresetItems(slots, preset) {
  if (preset?.schema && preset.schema !== PRESET_SCHEMA) {
    throw new NainTailError("INVALID_PRESET_TYPE", "서브슬롯 리스트에는 서브슬롯 프리셋만 Append할 수 있습니다.");
  }
  const normalizedPreset = createSubSlotPreset(preset);
  return [
    ...(Array.isArray(slots) ? slots.map(createSlot) : []),
    ...normalizedPreset.items.map((item) => createSlot(item)),
  ];
}

module.exports = {
  EXAMPLE_PRESET_SCHEMA,
  PRESET_SCHEMA,
  PROJECT_SCHEMA,
  appendPresetItems,
  createCharacterCard,
  createExamplePreset,
  createProject,
  createSlot,
  createSubSlotPreset,
  validateProject,
};
