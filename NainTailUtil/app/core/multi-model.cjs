"use strict";

const { createId } = require("./ids.cjs");
const { NainTailError } = require("./errors.cjs");
const { createSlot } = require("./project-model.cjs");
const { normalizeGenerationSettings } = require("./generation-profile.cjs");
const { activeCharacterPrompts, normalizeCharacterPrompt } = require("./character-prompt.cjs");
const { joinPrompt } = require("./request-resolver.cjs");
const { MAX_LOCAL_BATCH, MAX_LOCAL_QUEUE, MAX_LOCAL_TASKS, normalizeLocalRepeat } = require("./local-repeat.cjs");
const { normalizePreciseReferences } = require("./precise-reference.cjs");
const { normalizeVibes } = require("./vibe-reference.cjs");

const MULTI_SCHEMA = "naintail.multi/v1";
const MAX_MULTI_SLOTS = 20;

function asString(value) { return typeof value === "string" ? value : ""; }

function normalizeMulti(input = {}) {
  const slots = Array.isArray(input.slots) ? input.slots.map(createSlot) : [];
  if (slots.length > MAX_MULTI_SLOTS) throw new NainTailError("TOO_MANY_MULTI_SLOTS", `멀티 슬롯은 최대 ${MAX_MULTI_SLOTS}개입니다.`);
  const ids = new Set();
  for (const slot of slots) {
    if (ids.has(slot.id)) throw new NainTailError("DUPLICATE_MULTI_SLOT", "멀티 슬롯 ID가 중복되었습니다.");
    ids.add(slot.id);
  }
  const preciseReferences = normalizePreciseReferences(input.preciseReferences);
  const vibes = normalizeVibes(input.vibes);
  if (preciseReferences.length && vibes.length) throw new NainTailError("INCOMPATIBLE_REFERENCES", "Vibe Transfer와 Precise Reference는 동시에 사용할 수 없습니다.");
  return {
    schema: MULTI_SCHEMA,
    examplePrompt: asString(input.examplePrompt),
    exampleNegativePrompt: asString(input.exampleNegativePrompt),
    prompt: asString(input.prompt),
    negativePrompt: asString(input.negativePrompt),
    characters: Array.isArray(input.characters) ? input.characters.map(normalizeCharacterPrompt) : [],
    preciseReferences,
    vibes,
    normalizeVibeStrengths: input.normalizeVibeStrengths !== false,
    settings: normalizeGenerationSettings(input.settings || {}),
    batchCount: input.batchCount,
    queueCount: input.queueCount,
    slots,
  };
}

function materializeMulti(input) {
  const multi = normalizeMulti(input);
  const characters = activeCharacterPrompts(multi.characters);
  const candidates = multi.slots.length
    ? multi.slots.map((slot, index) => ({ slot, slotIndex: index + 1 })).filter(({ slot }) => slot.enabled)
    : [{ slot: { id: "multi-base", name: "공통 프롬프트", prompt: "", negativePrompt: "", settings: {} }, slotIndex: 1 }];
  if (!candidates.length) throw new NainTailError("NO_ENABLED_SLOTS", "생성 대상으로 선택된 멀티 슬롯이 없습니다.");

  const repeat = normalizeLocalRepeat(multi, candidates.length);
  multi.batchCount = repeat.batchCount;
  multi.queueCount = repeat.queueCount;

  const runId = createId("run");
  const tasks = [];
  for (let queueIndex = 1; queueIndex <= multi.queueCount; queueIndex += 1) {
    for (const { slot, slotIndex } of candidates) {
      const prompt = joinPrompt(multi.examplePrompt, multi.prompt, slot.prompt);
      if (!prompt && !characters.length) throw new NainTailError("EMPTY_PROMPT", `${slot.name}의 최종 프롬프트와 활성 캐릭터가 모두 비어 있습니다.`);
      for (let batchIndex = 1; batchIndex <= multi.batchCount; batchIndex += 1) {
        tasks.push({
          id: createId("task"),
          runId,
          ordinal: tasks.length + 1,
          projectId: null,
          projectName: null,
          source: { type: "multi", characterId: null, slotId: slot.id, slotName: slot.name, slotIndex, batchIndex, batchCount: multi.batchCount, queueIndex, queueCount: multi.queueCount },
          request: {
            schema: "naintail.generate/v1",
            prompt,
            negativePrompt: joinPrompt(multi.exampleNegativePrompt, multi.negativePrompt, slot.negativePrompt),
            characters,
            preciseReferences: multi.preciseReferences,
            vibes: multi.vibes,
            normalizeVibeStrengths: multi.normalizeVibeStrengths,
            settings: normalizeGenerationSettings({ ...multi.settings, ...slot.settings }),
            nSamples: 1,
          },
        });
      }
    }
  }
  return tasks;
}

module.exports = { MAX_LOCAL_BATCH, MAX_LOCAL_QUEUE, MAX_MULTI_SLOTS, MAX_LOCAL_TASKS, MULTI_SCHEMA, materializeMulti, normalizeMulti };
