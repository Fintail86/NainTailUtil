"use strict";

const { createId } = require("./ids.cjs");
const { NainTailError } = require("./errors.cjs");
const { normalizeGenerationSettings } = require("./generation-profile.cjs");
const { validateProject } = require("./project-model.cjs");
const { activeCharacterPrompts } = require("./character-prompt.cjs");
const { normalizeLocalRepeat } = require("./local-repeat.cjs");
const { normalizePreciseReferences } = require("./precise-reference.cjs");
const { normalizeVibes } = require("./vibe-reference.cjs");

function joinPrompt(...parts) {
  return parts.map((part) => String(part || "").trim()).filter(Boolean).join(", ");
}

function createTask(project, source, prompt, negativePrompt, settings, characters = []) {
  const normalizedSettings = normalizeGenerationSettings(settings);
  const resolvedCharacters = activeCharacterPrompts(characters, normalizedSettings.model);
  if (!String(prompt || "").trim() && !resolvedCharacters.length) {
    throw new NainTailError("EMPTY_PROMPT", `${source.slotName || "슬롯"}의 최종 프롬프트가 비어 있습니다.`);
  }
  return {
    id: createId("task"),
    runId: null,
    projectId: project.id,
    projectName: project.name,
    source,
    request: {
      schema: "naintail.generate/v1",
      prompt,
      negativePrompt,
      characters: resolvedCharacters,
      settings: normalizedSettings,
      nSamples: 1,
    },
  };
}

function resolveProjectCharacters(project, ownerCharacterId = null, slot = null) {
  return project.characters.map((character) => ({
    id: character.id,
    name: character.name,
    enabled: character.enabled,
    position: character.position,
    outfits: character.outfits,
    selectedOutfitId: character.selectedOutfitId,
    prompt: joinPrompt(character.prompt, character.id === ownerCharacterId ? slot?.prompt : ""),
    negativePrompt: joinPrompt(character.negativePrompt, character.id === ownerCharacterId ? slot?.negativePrompt : ""),
  }));
}

function materializeProject(input, options = {}) {
  const project = validateProject(input);
  const scope = options.scope || "all";
  const tasks = [];

  if (scope === "all" || scope === "general") {
    project.generalSlots.forEach((slot, index) => {
      if (!slot.enabled) return;
      tasks.push(createTask(
        project,
        { type: "general", characterId: null, characterName: null, slotId: slot.id, slotName: slot.name, slotIndex: index + 1 },
        joinPrompt(project.commonPrompt, slot.prompt),
        joinPrompt(project.commonNegativePrompt, slot.negativePrompt),
        { ...project.commonSettings, ...slot.settings },
        resolveProjectCharacters(project),
      ));
    });
  }

  for (const character of project.characters) {
    if (scope === "general") continue;
    if (!character.enabled) continue;
    if (scope === "character" && options.characterId && character.id !== options.characterId) continue;
    character.slots.forEach((slot, index) => {
      if (!slot.enabled) return;
      tasks.push(createTask(
        project,
        {
          type: "character",
          characterId: character.id,
          characterName: character.name,
          slotId: slot.id,
          slotName: slot.name,
          slotIndex: index + 1,
        },
        project.commonPrompt,
        project.commonNegativePrompt,
        { ...project.commonSettings, ...character.settings, ...slot.settings },
        resolveProjectCharacters(project, character.id, slot),
      ));
    });
  }

  const runId = createId("run");
  return tasks.map((task, index) => ({ ...task, runId, ordinal: index + 1 }));
}

function materializeSingle(input) {
  const prompt = joinPrompt(input?.examplePrompt, input?.prompt);
  const settings = normalizeGenerationSettings(input?.settings || {});
  const characters = activeCharacterPrompts(input?.characters, settings.model);
  if (!prompt && !characters.length) throw new NainTailError("EMPTY_PROMPT", "싱글 생성 프롬프트와 활성 캐릭터가 모두 비어 있습니다.");
  const repeat = normalizeLocalRepeat(input, 1);
  const preciseReferences = normalizePreciseReferences(input?.preciseReferences);
  const vibes = normalizeVibes(input?.vibes);
  if (preciseReferences.length && vibes.length) throw new NainTailError("INCOMPATIBLE_REFERENCES", "Vibe Transfer와 Precise Reference는 동시에 사용할 수 없습니다.");
  const runId = createId("run");
  const tasks = [];
  for (let queueIndex = 1; queueIndex <= repeat.queueCount; queueIndex += 1) {
    for (let batchIndex = 1; batchIndex <= repeat.batchCount; batchIndex += 1) {
      tasks.push({
        id: createId("task"),
        runId,
        ordinal: tasks.length + 1,
        projectId: null,
        projectName: null,
        source: { type: "single", characterId: null, slotId: null, slotName: "싱글 생성", slotIndex: 1, batchIndex, batchCount: repeat.batchCount, queueIndex, queueCount: repeat.queueCount },
        request: {
          schema: "naintail.generate/v1",
          prompt,
          negativePrompt: joinPrompt(input?.exampleNegativePrompt, input?.negativePrompt),
          characters,
          preciseReferences,
          vibes,
          normalizeVibeStrengths: input?.normalizeVibeStrengths !== false,
          settings,
          nSamples: 1,
        },
      });
    }
  }
  return tasks;
}

module.exports = { joinPrompt, materializeProject, materializeSingle };
