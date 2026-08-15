"use strict";

const { createId } = require("./ids.cjs");
const { NainTailError } = require("./errors.cjs");

const MAX_CHARACTER_PROMPTS = 6;
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
  return {
    id: asString(input.id) || createId("character"),
    name: asString(input.name) || "새 캐릭터",
    prompt: asString(input.prompt),
    negativePrompt: asString(input.negativePrompt),
    enabled: input.enabled !== false,
    position: normalizeCharacterPosition(input.position),
  };
}

function activeCharacterPrompts(input = []) {
  const characters = (Array.isArray(input) ? input : []).map(normalizeCharacterPrompt).filter((character) => character.enabled && character.prompt.trim());
  if (characters.length > MAX_CHARACTER_PROMPTS) {
    throw new NainTailError("TOO_MANY_CHARACTERS", `NAI V4 캐릭터 프롬프트는 최대 ${MAX_CHARACTER_PROMPTS}개입니다.`);
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
  MAX_CHARACTER_PROMPTS,
  POSITION_VALUES,
  activeCharacterPrompts,
  normalizeCharacterPosition,
  normalizeCharacterPrompt,
  positionToCenter,
};
