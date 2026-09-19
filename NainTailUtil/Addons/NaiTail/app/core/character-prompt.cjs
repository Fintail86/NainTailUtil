"use strict";

const { createId } = require("./ids.cjs");
const { NainTailError } = require("./errors.cjs");
const { DEFAULT_MODEL, requireModelDefinition } = require("./nai-models.cjs");

const POSITION_PATTERN = /^[a-e][1-5]$/u;
const POSITION_VALUES = Object.freeze([0.1, 0.3, 0.5, 0.7, 0.9]);

function asString(value) { return typeof value === "string" ? value : ""; }

function normalizeCharacterPosition(value) {
  if (value === null || value === undefined || value === "") return null;
  const position = asString(value).trim().toLowerCase();
  if (!POSITION_PATTERN.test(position)) {
    throw new NainTailError("INVALID_CHARACTER_POSITION", `캐릭터 위치가 5×5 범위를 벗어났습니다: ${value}`);
  }
  return position;
}

function normalizeCharacterPrompt(input = {}) {
  const outfits = (Array.isArray(input.outfits) ? input.outfits : []).map((outfit) => ({
    id: asString(outfit?.id) || createId("outfit"),
    name: asString(outfit?.name) || "새 의상",
    prompt: asString(outfit?.prompt),
  }));
  if (new Set(outfits.map((outfit) => outfit.id)).size !== outfits.length) {
    throw new NainTailError("DUPLICATE_OUTFIT_ID", "캐릭터 의상 ID가 중복되었습니다.");
  }
  const selectedOutfitId = asString(input.selectedOutfitId) || null;
  if (selectedOutfitId && !outfits.some((outfit) => outfit.id === selectedOutfitId)) {
    throw new NainTailError("INVALID_SELECTED_OUTFIT", "선택한 캐릭터 의상이 목록에 없습니다.");
  }
  return {
    id: asString(input.id) || createId("character"),
    name: asString(input.name) || "새 캐릭터",
    prompt: asString(input.prompt),
    outfits,
    selectedOutfitId,
    negativePrompt: asString(input.negativePrompt),
    enabled: input.enabled !== false,
    position: normalizeCharacterPosition(input.position),
  };
}

// Keep the editable base and wardrobe in requests; compose only for the NAI payload.
function composeCharacterPrompt(character) {
  const outfits = character.outfits || [];
  const selected = outfits.find((outfit) => outfit.id === character.selectedOutfitId);
  const outfitPrompt = selected ? selected.prompt : outfits.length ? "undressed, nude" : "";
  return [character.prompt, outfitPrompt].map((part) => asString(part).trim()).filter(Boolean).join(", ");
}

function activeCharacterPrompts(input = [], model = DEFAULT_MODEL) {
  const definition = requireModelDefinition(model);
  const characters = (Array.isArray(input) ? input : []).map(normalizeCharacterPrompt).filter((character) => character.enabled && composeCharacterPrompt(character));
  if (characters.length > definition.maxCharacterPrompts) {
    throw new NainTailError("TOO_MANY_CHARACTERS", `${definition.label}의 활성 캐릭터 프롬프트는 최대 ${definition.maxCharacterPrompts}개입니다. (현재 ${characters.length}개)`);
  }
  return characters;
}

function positionToCenter(position) {
  const normalized = normalizeCharacterPosition(position);
  if (!normalized) return { x: 0.5, y: 0.5 };
  return {
    x: POSITION_VALUES[normalized.charCodeAt(0) - 97],
    y: POSITION_VALUES[Number(normalized[1]) - 1],
  };
}

module.exports = {
  POSITION_VALUES,
  activeCharacterPrompts,
  composeCharacterPrompt,
  normalizeCharacterPosition,
  normalizeCharacterPrompt,
  positionToCenter,
};
