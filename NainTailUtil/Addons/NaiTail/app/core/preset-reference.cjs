"use strict";
const { NainTailError } = require("./errors.cjs");
const { presetName, presetType } = require("./preset-name.cjs");
const { createSlot } = require("./project-model.cjs");
const TYPES = { "작례프리셋": "example", "캐릭터프리셋": "character", "서브슬롯프리셋": "sub-slot", example: "example", character: "character", "sub-slot": "sub-slot" };
const present = (value) => value !== undefined && value !== null && value !== "";
const slotReferencePresent = (value) => present(value) && (!Array.isArray(value) || value.length > 0);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const join = (...parts) => parts.filter((part) => typeof part === "string").map((part) => part.trim()).filter(Boolean).join(", ");

function parsePresetReference(value, expectedType) {
  let type = expectedType, name;
  if (typeof value === "string") {
    const token = value.trim().match(/^\[([^:\[\]]+):([^\[\]]+)\]$/u);
    if (token) { type = TYPES[token[1].replace(/\s/gu, "")]; name = token[2]; }
    else if (/[[\]]/u.test(value)) throw new NainTailError("INVALID_PRESET_REFERENCE", `프리셋 참조 형식이 잘못되었습니다: ${value}`);
    else name = value;
  } else if (value && typeof value === "object" && !Array.isArray(value)) {
    type = value.type || expectedType; name = value.name;
  } else throw new NainTailError("INVALID_PRESET_REFERENCE", "프리셋 참조는 이름, [타입:이름] 문자열 또는 {type, name} 객체여야 합니다.");
  presetType(type);
  if (type !== expectedType) throw new NainTailError("INVALID_PRESET_TYPE", `${expectedType} 위치에 ${type} 프리셋을 사용할 수 없습니다.`);
  return { type, name: presetName(name) };
}

function resolvePresetReferences(input, store, mode = "single") {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const hasCharacterReference = Array.isArray(input.characters) && input.characters.some((c) => present(c?.preset) || own(c || {}, "outfit"));
  const hasReferences = present(input.examplePreset) || slotReferencePresent(input.slotPreset) || slotReferencePresent(input.slotPresets) || hasCharacterReference;
  if (!hasReferences) return input; // Direct requests never look up presets.
  if (!["single", "multi"].includes(mode)) throw new NainTailError("PRESET_REFERENCE_MODE", "이름 프리셋 참조는 싱글·멀티 생성에서 지원합니다.");
  const resolved = { ...input };
  const cache = new Map();
  function get(value, type) {
    const ref = parsePresetReference(value, type);
    const key = `${ref.type}:${ref.name.toLowerCase()}`;
    if (!cache.has(key)) cache.set(key, store.get(ref));
    return structuredClone(cache.get(key));
  }
  if (present(input.examplePreset)) {
    const example = get(input.examplePreset, "example");
    resolved.examplePrompt = join(example.prompt, input.examplePrompt);
    resolved.exampleNegativePrompt = join(example.negativePrompt, input.exampleNegativePrompt);
  }
  delete resolved.examplePreset;
  if (Array.isArray(input.characters)) resolved.characters = input.characters.map((character) => {
    if (!character || typeof character !== "object" || Array.isArray(character)) return character;
    const hasPreset = present(character.preset);
    if (!hasPreset && !own(character, "outfit")) return character;
    const preset = hasPreset ? get(character.preset, "character") : {};
    const result = hasPreset ? {
      ...character,
      name: character.name || preset.name,
      prompt: join(preset.prompt, character.prompt),
      negativePrompt: join(preset.negativePrompt, character.negativePrompt),
      outfits: own(character, "outfits") ? structuredClone(character.outfits) : preset.outfits,
      selectedOutfitId: own(character, "selectedOutfitId") ? character.selectedOutfitId : own(character, "outfits") ? null : preset.selectedOutfitId,
    } : structuredClone(character);
    if (own(character, "outfit")) {
      if (own(character, "selectedOutfitId")) throw new NainTailError("AMBIGUOUS_OUTFIT_SELECTION", "outfit과 selectedOutfitId는 함께 지정할 수 없습니다.");
      if (character.outfit === null) result.selectedOutfitId = null;
      else {
        if (typeof character.outfit !== "string" || !character.outfit.trim()) throw new NainTailError("INVALID_OUTFIT_NAME", "의상 이름 또는 null을 지정하세요.");
        const matches = (Array.isArray(result.outfits) ? result.outfits : []).filter((outfit) => String(outfit?.name || "").normalize("NFC").trim().toLowerCase() === character.outfit.normalize("NFC").trim().toLowerCase());
        if (matches.length !== 1) throw new NainTailError(matches.length ? "DUPLICATE_OUTFIT_NAME" : "OUTFIT_NOT_FOUND", `의상을 하나로 찾을 수 없습니다: ${character.outfit}`);
        result.selectedOutfitId = matches[0].id;
      }
    }
    delete result.preset;
    delete result.outfit;
    return result;
  });
  if (slotReferencePresent(input.slotPreset) || slotReferencePresent(input.slotPresets)) {
    if (mode !== "multi") throw new NainTailError("PRESET_REFERENCE_MODE", "서브슬롯 프리셋 참조는 멀티 생성에서 사용하세요.");
    if (slotReferencePresent(input.slotPreset) && slotReferencePresent(input.slotPresets)) throw new NainTailError("INVALID_PRESET_REFERENCE", "slotPreset과 slotPresets는 함께 지정할 수 없습니다.");
    const value = slotReferencePresent(input.slotPresets) ? input.slotPresets : input.slotPreset;
    const references = Array.isArray(value) ? value : [value];
    const slots = references.flatMap((ref) => get(ref, "sub-slot").items.map((item) => createSlot(item)));
    if (!slots.length) throw new NainTailError("EMPTY_SLOT_PRESET", "선택한 서브슬롯 프리셋에 항목이 없습니다.");
    resolved.slots = [...slots, ...(Array.isArray(input.slots) ? input.slots : [])];
  }
  delete resolved.slotPreset;
  delete resolved.slotPresets;
  return resolved;
}
module.exports = { parsePresetReference, resolvePresetReferences };
