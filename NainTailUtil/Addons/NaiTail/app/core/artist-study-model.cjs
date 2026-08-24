"use strict";

const { createId } = require("./ids.cjs");
const { NainTailError } = require("./errors.cjs");
const { normalizeGenerationSettings } = require("./generation-profile.cjs");
const { joinPrompt } = require("./request-resolver.cjs");
const { activeCharacterPrompts, normalizeCharacterPrompt } = require("./character-prompt.cjs");
const { normalizeLocalRepeat } = require("./local-repeat.cjs");

const ARTIST_STUDY_SCHEMA = "naintail.artist-study/v1";
const WEIGHT_MIN = 0;
const WEIGHT_MAX = 2;
const WEIGHT_STEP = 0.05;
const ARTIST_SEARCH_MAX_TASKS = 100;

function asString(value) { return typeof value === "string" ? value : ""; }
function clampWeight(value, fallback = 1) {
  const number = Number(value);
  const resolved = Number.isFinite(number) ? number : fallback;
  return Number((Math.round(Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, resolved)) / WEIGHT_STEP) * WEIGHT_STEP).toFixed(2));
}

function normalizeArtist(input = {}) {
  return {
    id: asString(input.id) || createId("artist"),
    name: asString(input.name).replace(/^artist\s*:/iu, "").trim(),
    enabled: input.enabled !== false,
    weight: clampWeight(input.weight),
  };
}

function normalizeMixingArtist(input = {}) {
  return {
    ...normalizeArtist(input),
    favoriteKey: asString(input.favoriteKey).trim(),
  };
}

function normalizeArtistStudy(input = {}) {
  const randomMin = clampWeight(input.randomMin, 0.4);
  const randomMax = clampWeight(input.randomMax, 1.6);
  const repeat = normalizeLocalRepeat(input, 1);
  return {
    schema: ARTIST_STUDY_SCHEMA,
    basePrompt: asString(input.basePrompt),
    negativePrompt: asString(input.negativePrompt),
    examplePrompt: asString(input.examplePrompt),
    exampleNegativePrompt: asString(input.exampleNegativePrompt),
    batchCount: repeat.batchCount,
    queueCount: repeat.queueCount,
    characters: Array.isArray(input.characters) ? input.characters.map(normalizeCharacterPrompt) : [],
    settings: normalizeGenerationSettings(input.settings || {}),
    randomMin: Math.min(randomMin, randomMax),
    randomMax: Math.max(randomMin, randomMax),
    artists: Array.isArray(input.artists) ? input.artists.map(normalizeArtist) : [],
    mixingArtists: Array.isArray(input.mixingArtists) ? input.mixingArtists.map(normalizeMixingArtist) : [],
  };
}

function repeatArtistTasks(baseTasks, study) {
  const repeat = normalizeLocalRepeat(study, baseTasks.length);
  const runId = createId("run");
  const tasks = [];
  for (let queueIndex = 1; queueIndex <= repeat.queueCount; queueIndex += 1) {
    for (const baseTask of baseTasks) {
      for (let batchIndex = 1; batchIndex <= repeat.batchCount; batchIndex += 1) {
        tasks.push({
          ...baseTask,
          id: createId("task"),
          runId,
          ordinal: tasks.length + 1,
          source: {
            ...baseTask.source,
            batchIndex,
            batchCount: repeat.batchCount,
            queueIndex,
            queueCount: repeat.queueCount,
          },
        });
      }
    }
  }
  return tasks;
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
  return repeatArtistTasks([{
    projectId: null,
    projectName: null,
    source: { type: "artist-study", characterId: null, slotId: null, slotName: "작례 연구기", slotIndex: 1, artists: activeArtists },
    request: { schema: "naintail.generate/v1", prompt, negativePrompt: joinPrompt(study.exampleNegativePrompt, study.negativePrompt), characters, settings: study.settings, nSamples: 1 },
  }], study);
}

function materializeArtistSearch(input) {
  const study = normalizeArtistStudy(input);
  const artists = study.artists.filter((artist) => artist.enabled && artist.name);
  if (!artists.length) throw new NainTailError("EMPTY_ARTIST_SEARCH", "비교 생성할 활성 작가가 없습니다.");
  if (artists.length > ARTIST_SEARCH_MAX_TASKS) {
    throw new NainTailError("ARTIST_SEARCH_LIMIT", `작가 서칭은 한 번에 최대 ${ARTIST_SEARCH_MAX_TASKS}명까지 생성할 수 있습니다.`);
  }
  const characters = activeCharacterPrompts(study.characters);
  const baseTasks = artists.map((artist, index) => {
    const fixedArtist = { ...artist, enabled: true, weight: 1 };
    return {
      projectId: null,
      projectName: null,
      source: {
        type: "artist-study",
        studyMode: "searching",
        characterId: null,
        slotId: artist.id,
        slotName: artist.name,
        slotIndex: index + 1,
        artists: [{ name: artist.name, weight: 1 }],
      },
      request: {
        schema: "naintail.generate/v1",
        prompt: joinPrompt(serializeArtistPrompt([fixedArtist]), study.basePrompt),
        negativePrompt: study.negativePrompt.trim(),
        characters,
        settings: study.settings,
        nSamples: 1,
      },
    };
  });
  return repeatArtistTasks(baseTasks, study);
}

function materializeArtistMixing(input) {
  const study = normalizeArtistStudy(input);
  const activeArtists = study.mixingArtists.filter((artist) => artist.enabled && artist.name);
  if (!activeArtists.length) throw new NainTailError("EMPTY_ARTIST_MIXING", "믹싱할 활성 Favorites 작가가 없습니다.");
  const artistPrompt = serializeArtistPrompt(activeArtists);
  const characters = activeCharacterPrompts(study.characters);
  const prompt = joinPrompt(artistPrompt, study.basePrompt);
  if (!prompt && !characters.length) throw new NainTailError("EMPTY_ARTIST_MIXING_PROMPT", "믹싱 프롬프트가 비어 있습니다.");
  return repeatArtistTasks([{
    projectId: null,
    projectName: null,
    source: {
      type: "artist-study",
      studyMode: "mixing",
      characterId: null,
      slotId: null,
      slotName: "Artist Mixing",
      slotIndex: 1,
      artists: activeArtists.map((artist) => ({ name: artist.name, weight: artist.weight })),
    },
    request: {
      schema: "naintail.generate/v1",
      prompt,
      negativePrompt: study.negativePrompt.trim(),
      characters,
      settings: study.settings,
      nSamples: 1,
    },
  }], study);
}

function materializeArtistPounding(input, trial) {
  const study = normalizeArtistStudy(input);
  const trialArtists = Array.isArray(trial?.artists) ? trial.artists.filter((artist) => artist.favoriteKey && artist.name) : [];
  if (!trial?.id || !trialArtists.length) throw new NainTailError("INVALID_ARTIST_POUNDING_TRIAL", "생성할 파운딩 작가 조합이 없습니다.");
  const activeArtists = trialArtists.map((artist) => ({ name: artist.name, enabled: true, weight: artist.weight }));
  const characters = activeCharacterPrompts(study.characters);
  const prompt = joinPrompt(serializeArtistPrompt(activeArtists), study.basePrompt);
  if (!prompt && !characters.length) throw new NainTailError("EMPTY_ARTIST_POUNDING_PROMPT", "파운딩 프롬프트가 비어 있습니다.");
  return repeatArtistTasks([{
    projectId: null,
    projectName: null,
    source: {
      type: "artist-study",
      studyMode: "pounding",
      roundId: trial.roundId || null,
      trialId: trial.id,
      characterId: null,
      slotId: null,
      slotName: "파운딩",
      slotIndex: 1,
      artists: trialArtists.map((artist) => ({
        favoriteKey: artist.favoriteKey,
        name: artist.name,
        weight: artist.weight,
        share: artist.share,
        allocatedPoints: artist.allocatedPoints,
      })),
    },
    request: {
      schema: "naintail.generate/v1",
      prompt,
      negativePrompt: study.negativePrompt.trim(),
      characters,
      settings: study.settings,
      nSamples: 1,
    },
  }], study);
}

function materializeArtistFinalize(input, round) {
  const study = normalizeArtistStudy(input);
  const roundArtists = Array.isArray(round?.artists) ? round.artists.filter((artist) => artist.favoriteKey && artist.name) : [];
  if (!round?.roundId || !roundArtists.length) throw new NainTailError("INVALID_ARTIST_FINALIZE_ROUND", "파이널라이즈할 라운드 작가 조합이 없습니다.");
  const activeArtists = roundArtists.map((artist) => ({ name: artist.name, enabled: true, weight: artist.weight }));
  const characters = activeCharacterPrompts(study.characters);
  const prompt = joinPrompt(serializeArtistPrompt(activeArtists), study.basePrompt);
  if (!prompt && !characters.length) throw new NainTailError("EMPTY_ARTIST_FINALIZE_PROMPT", "파이널라이즈 프롬프트가 비어 있습니다.");
  return repeatArtistTasks([{
    projectId: null,
    projectName: null,
    source: {
      type: "artist-study",
      studyMode: "finalize",
      roundId: round.roundId,
      roundFileName: asString(round.fileName),
      characterId: null,
      slotId: null,
      slotName: "Artist Finalize",
      slotIndex: 1,
      artists: roundArtists.map((artist) => ({
        favoriteKey: artist.favoriteKey,
        name: artist.name,
        score: artist.score,
        rank: artist.rank,
        weight: artist.weight,
      })),
    },
    request: {
      schema: "naintail.generate/v1",
      prompt,
      negativePrompt: study.negativePrompt.trim(),
      characters,
      settings: study.settings,
      nSamples: 1,
    },
  }], study);
}

function randomizeMixingArtistWeights(input, random = Math.random) {
  const study = normalizeArtistStudy(input);
  const lowerStep = Math.ceil(study.randomMin / WEIGHT_STEP);
  const upperStep = Math.floor(study.randomMax / WEIGHT_STEP);
  const stepCount = Math.max(1, upperStep - lowerStep + 1);
  return {
    ...study,
    mixingArtists: study.mixingArtists.map((artist) => artist.enabled
      ? { ...artist, weight: (lowerStep + Math.floor(random() * stepCount)) * WEIGHT_STEP }
      : artist),
  };
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
  ARTIST_SEARCH_MAX_TASKS,
  WEIGHT_MAX,
  WEIGHT_MIN,
  WEIGHT_STEP,
  materializeArtistStudy,
  materializeArtistSearch,
  materializeArtistMixing,
  materializeArtistPounding,
  materializeArtistFinalize,
  artistStudyExampleValues,
  normalizeArtistStudy,
  randomizeArtistWeights,
  randomizeMixingArtistWeights,
  serializeArtistPrompt,
};
