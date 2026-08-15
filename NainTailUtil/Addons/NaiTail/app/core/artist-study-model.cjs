"use strict";

const { createId } = require("./ids.cjs");
const { NainTailError } = require("./errors.cjs");
const { normalizeGenerationSettings } = require("./generation-profile.cjs");
const { joinPrompt } = require("./request-resolver.cjs");
const { activeCharacterPrompts, normalizeCharacterPrompt } = require("./character-prompt.cjs");

const ARTIST_STUDY_SCHEMA = "naintail.artist-study/v1";
const WEIGHT_MIN = 0;
const WEIGHT_MAX = 2;
const WEIGHT_STEP = 0.05;

function asString(value) { return typeof value === "string" ? value : ""; }
function clampWeight(value, fallback = 1) {
  const number = Number(value);
  const resolved = Number.isFinite(number) ? number : fallback;
  return Math.round(Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, resolved)) / WEIGHT_STEP) * WEIGHT_STEP;
}

function normalizeArtist(input = {}) {
  return {
    id: asString(input.id) || createId("artist"),
    name: asString(input.name).replace(/^artist\s*:/iu, "").trim(),
    enabled: input.enabled !== false,
    weight: clampWeight(input.weight),
  };
}

function normalizeArtistStudy(input = {}) {
  const randomMin = clampWeight(input.randomMin, 0.4);
  const randomMax = clampWeight(input.randomMax, 1.6);
  return {
    schema: ARTIST_STUDY_SCHEMA,
    basePrompt: asString(input.basePrompt),
    negativePrompt: asString(input.negativePrompt),
    examplePrompt: asString(input.examplePrompt),
    exampleNegativePrompt: asString(input.exampleNegativePrompt),
    characters: Array.isArray(input.characters) ? input.characters.map(normalizeCharacterPrompt) : [],
    settings: normalizeGenerationSettings(input.settings || {}),
    randomMin: Math.min(randomMin, randomMax),
    randomMax: Math.max(randomMin, randomMax),
    artists: Array.isArray(input.artists) ? input.artists.map(normalizeArtist) : [],
  };
}

function formatWeight(value) {
  return clampWeight(value).toFixed(2).replace(/0+$/u, "").replace(/\.$/u, "");
}

function serializeArtistPrompt(artists) {
  return (Array.isArray(artists) ? artists : [])
    .map(normalizeArtist)
    .filter((artist) => artist.enabled && artist.name)
    .map((artist) => `${formatWeight(artist.weight)}::artist:${artist.name}::`)
    .join(", ");
}

function randomizeArtistWeights(input, random = Math.random) {
  const study = normalizeArtistStudy(input);
  const lowerStep = Math.ceil(study.randomMin / WEIGHT_STEP);
  const upperStep = Math.floor(study.randomMax / WEIGHT_STEP);
  const stepCount = Math.max(1, upperStep - lowerStep + 1);
  return {
    ...study,
    artists: study.artists.map((artist) => artist.enabled
      ? { ...artist, weight: (lowerStep + Math.floor(random() * stepCount)) * WEIGHT_STEP }
      : artist),
  };
}

function materializeArtistStudy(input) {
  const study = normalizeArtistStudy(input);
  const artistPrompt = serializeArtistPrompt(study.artists);
  const prompt = joinPrompt(study.examplePrompt, artistPrompt, study.basePrompt);
  const characters = activeCharacterPrompts(study.characters);
  if (!prompt && !characters.length) throw new NainTailError("EMPTY_ARTIST_STUDY_PROMPT", "활성 작가, 현재 프롬프트와 캐릭터가 모두 비어 있습니다.");
  const activeArtists = study.artists.filter((artist) => artist.enabled && artist.name).map((artist) => ({ name: artist.name, weight: artist.weight }));
  const runId = createId("run");
  return [{
    id: createId("task"),
    runId,
    ordinal: 1,
    projectId: null,
    projectName: null,
    source: { type: "artist-study", characterId: null, slotId: null, slotName: "작례 연구기", slotIndex: 1, artists: activeArtists },
    request: { schema: "naintail.generate/v1", prompt, negativePrompt: joinPrompt(study.exampleNegativePrompt, study.negativePrompt), characters, settings: study.settings, nSamples: 1 },
  }];
}

function artistStudyExampleValues(input) {
  const study = normalizeArtistStudy(input);
  return {
    prompt: joinPrompt(study.examplePrompt, serializeArtistPrompt(study.artists)),
    negativePrompt: study.exampleNegativePrompt.trim(),
  };
}

module.exports = {
  ARTIST_STUDY_SCHEMA,
  WEIGHT_MAX,
  WEIGHT_MIN,
  WEIGHT_STEP,
  materializeArtistStudy,
  artistStudyExampleValues,
  normalizeArtistStudy,
  randomizeArtistWeights,
  serializeArtistPrompt,
};
