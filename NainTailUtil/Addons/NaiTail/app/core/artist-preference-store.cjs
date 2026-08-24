"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { NainTailError } = require("./errors.cjs");
const { createId } = require("./ids.cjs");
const { readJson, safeFileStem, writeJsonAtomic } = require("./json-store.cjs");
const { ensureProductDirectories, resolveInside } = require("./paths.cjs");

const ARTIST_PREFERENCE_SCHEMA = "naintail.artist-preference/v1";
const ARTIST_PREFERENCE_SCHEMA_VERSION = 1;
const ARTIST_POUNDING_ROUND_SCHEMA = "naintail.artist-pounding-round/v1";
const ARTIST_POUNDING_ROUND_SCHEMA_VERSION = 1;
const ARTIST_POUNDING_ROUND_INDEX_SCHEMA = "naintail.artist-pounding-round-index/v1";
const SCORE_POOL = 10_000;
const WEIGHT_STEP = 0.05;
const WEIGHT_BUCKET_SIZE = 0.2;
const MIN_ADAPTIVE_FEEDBACK = 3;
const MIN_ADAPTIVE_WIDTH = 0.3;
const MAX_TRIALS = 2_000;
const MAX_ROUND_JSON_BYTES = 10 * 1024 * 1024;
const FINAL_WEIGHT_MIN = 0.4;
const FINAL_WEIGHT_MAX = 1.6;
const DEFAULT_FINALIZE_SETTINGS = Object.freeze({
  minScore: 0,
  maxScore: SCORE_POOL * 2,
  minWeight: FINAL_WEIGHT_MIN,
  maxWeight: FINAL_WEIGHT_MAX,
});

const DEFAULT_SETTINGS = Object.freeze({
  minArtists: 2,
  maxArtists: 4,
  explorationRate: 0.2,
  globalMinWeight: 0.4,
  globalMaxWeight: 1.6,
});

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function roundWeight(value) {
  return Number((Math.round(Number(value) / WEIGHT_STEP) * WEIGHT_STEP).toFixed(2));
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.trunc(number)) : fallback;
}

function normalizeSettings(input = {}) {
  const requestedMaxArtists = positiveInteger(input.maxArtists, DEFAULT_SETTINGS.maxArtists);
  const requestedMinArtists = positiveInteger(input.minArtists, DEFAULT_SETTINGS.minArtists);
  const globalMinWeight = roundWeight(clamp(input.globalMinWeight, 0, 2, DEFAULT_SETTINGS.globalMinWeight));
  const globalMaxWeight = roundWeight(clamp(input.globalMaxWeight, 0, 2, DEFAULT_SETTINGS.globalMaxWeight));
  return {
    minArtists: Math.min(requestedMinArtists, requestedMaxArtists),
    maxArtists: requestedMaxArtists,
    explorationRate: Number(clamp(input.explorationRate, 0.05, 0.5, DEFAULT_SETTINGS.explorationRate).toFixed(2)),
    globalMinWeight: Math.min(globalMinWeight, globalMaxWeight),
    globalMaxWeight: Math.max(globalMinWeight, globalMaxWeight),
  };
}

function normalizeFinalizeSettings(input = {}) {
  const requestedMinScore = Number(input.minScore);
  const requestedMaxScore = Number(input.maxScore);
  return {
    minScore: Math.min(
      SCORE_POOL - 1,
      Number.isFinite(requestedMinScore) ? Math.trunc(requestedMinScore) : DEFAULT_FINALIZE_SETTINGS.minScore,
    ),
    maxScore: Math.max(
      SCORE_POOL + 1,
      Number.isFinite(requestedMaxScore) ? Math.trunc(requestedMaxScore) : DEFAULT_FINALIZE_SETTINGS.maxScore,
    ),
    minWeight: roundWeight(clamp(input.minWeight, 0, 1, DEFAULT_FINALIZE_SETTINGS.minWeight)),
    maxWeight: roundWeight(clamp(input.maxWeight, 1, 2, DEFAULT_FINALIZE_SETTINGS.maxWeight)),
  };
}

function finalizeWeightForScore(score, input = {}) {
  const settings = normalizeFinalizeSettings(input);
  const value = Number(score) || 0;
  if (value <= settings.minScore) return settings.minWeight;
  if (value >= settings.maxScore) return settings.maxWeight;
  if (value === SCORE_POOL) return 1;
  if (value < SCORE_POOL) {
    const ratio = (value - settings.minScore) / (SCORE_POOL - settings.minScore);
    return roundWeight(settings.minWeight + ratio * (1 - settings.minWeight));
  }
  const ratio = (value - SCORE_POOL) / (settings.maxScore - SCORE_POOL);
  return roundWeight(1 + ratio * (settings.maxWeight - 1));
}

function emptyDatabase() {
  return {
    schema: ARTIST_PREFERENCE_SCHEMA,
    schemaVersion: ARTIST_PREFERENCE_SCHEMA_VERSION,
    roundId: createId("pounding_round"),
    updatedAt: null,
    settings: { ...DEFAULT_SETTINGS },
    artists: [],
    trials: [],
  };
}

function validateDatabase(value) {
  if (!value || value.schema !== ARTIST_PREFERENCE_SCHEMA || value.schemaVersion !== ARTIST_PREFERENCE_SCHEMA_VERSION || !Array.isArray(value.artists) || !Array.isArray(value.trials)) {
    throw new NainTailError("INVALID_ARTIST_PREFERENCE", "지원하지 않는 파운딩 선호도 DB 형식입니다.");
  }
  if (value.trials.length > MAX_TRIALS || value.artists.length > MAX_TRIALS * 6) {
    throw new NainTailError("INVALID_ARTIST_PREFERENCE", "파운딩 라운드 데이터가 허용된 크기를 초과합니다.");
  }
  return { ...value, roundId: String(value.roundId || createId("pounding_round")), settings: normalizeSettings(value.settings) };
}

function roundArchive(database, exportedAt = new Date().toISOString(), roundId = database.roundId || createId("pounding_round")) {
  return {
    schema: ARTIST_POUNDING_ROUND_SCHEMA,
    schemaVersion: ARTIST_POUNDING_ROUND_SCHEMA_VERSION,
    roundId,
    exportedAt,
    preference: database,
  };
}

function databaseFromRound(value) {
  if (value?.schema === ARTIST_POUNDING_ROUND_SCHEMA && value?.schemaVersion === ARTIST_POUNDING_ROUND_SCHEMA_VERSION) {
    return validateDatabase({ ...value.preference, roundId: value.roundId || value.preference?.roundId });
  }
  return validateDatabase(value);
}

function finalizeArtists(database, requestedCount, finalizeSettings = {}) {
  const ranked = validateDatabase(database).artists.map((artist) => ({
    favoriteKey: artist.key,
    name: artist.name,
    score: scoreFor(artist),
    feedbackCount: Number(artist.feedbackCount || 0),
  })).filter((artist) => artist.favoriteKey && artist.name && artist.feedbackCount > 0)
    .sort((left, right) => right.score - left.score || right.feedbackCount - left.feedbackCount || left.name.localeCompare(right.name));
  if (!ranked.length) throw new NainTailError("EMPTY_ARTIST_POUNDING_FINALIZE", "파이널라이즈할 평가 작가가 없습니다.");
  const count = Math.min(ranked.length, Math.max(1, Math.trunc(Number(requestedCount) || 1)));
  const selected = ranked.slice(0, count);
  return selected.map((artist, index) => ({
    ...artist,
    rank: index + 1,
    weight: finalizeWeightForScore(artist.score, finalizeSettings),
  }));
}

function ratingFor(stat = {}) {
  const exposure = Number(stat.exposurePoints || 0);
  return exposure > 0 ? (Number(stat.positivePoints || 0) - Number(stat.negativePoints || 0)) / exposure : 0;
}

function scoreFor(stat = {}) {
  return Math.round(Number(stat.positivePoints || 0) - Number(stat.negativePoints || 0));
}

function randomInteger(minimum, maximum, random) {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

function randomWeight(minimum, maximum, random) {
  const lowerStep = Math.ceil((minimum - 1e-9) / WEIGHT_STEP);
  const upperStep = Math.floor((maximum + 1e-9) / WEIGHT_STEP);
  return Number(((lowerStep + Math.floor(random() * Math.max(1, upperStep - lowerStep + 1))) * WEIGHT_STEP).toFixed(2));
}

function weightedPick(candidates, weightFor, random) {
  const weights = candidates.map((candidate) => Math.max(0.01, Number(weightFor(candidate)) || 0.01));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = random() * total;
  for (let index = 0; index < candidates.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) return index;
  }
  return candidates.length - 1;
}

function allocateScore(artists) {
  const totalWeight = artists.reduce((sum, artist) => sum + artist.weight, 0);
  const rows = artists.map((artist) => {
    const exact = totalWeight > 0 ? SCORE_POOL * artist.weight / totalWeight : SCORE_POOL / artists.length;
    return { ...artist, share: totalWeight > 0 ? artist.weight / totalWeight : 1 / artists.length, allocatedPoints: Math.floor(exact), fraction: exact - Math.floor(exact) };
  });
  let remainder = SCORE_POOL - rows.reduce((sum, artist) => sum + artist.allocatedPoints, 0);
  for (const row of [...rows].sort((left, right) => right.fraction - left.fraction)) {
    if (remainder <= 0) break;
    row.allocatedPoints += 1;
    remainder -= 1;
  }
  return rows.map(({ fraction, ...artist }) => ({ ...artist, share: Number(artist.share.toFixed(6)) }));
}

function bucketForWeight(weight) {
  const minimum = Number((Math.floor((Number(weight) + 1e-9) / WEIGHT_BUCKET_SIZE) * WEIGHT_BUCKET_SIZE).toFixed(2));
  return { key: minimum.toFixed(2), min: minimum, max: Number(Math.min(2, minimum + WEIGHT_BUCKET_SIZE).toFixed(2)) };
}

function adaptRange(stat, settings) {
  if (Number(stat.feedbackCount || 0) < MIN_ADAPTIVE_FEEDBACK || Number(stat.positivePoints || 0) <= 0) return;
  const eligible = (stat.weightBuckets || []).filter((bucket) => Number(bucket.exposurePoints || 0) > 0);
  if (!eligible.length) return;
  const best = [...eligible].sort((left, right) => {
    const leftQuality = (Number(left.positivePoints || 0) + 1_000) / (Number(left.exposurePoints || 0) + 2_000);
    const rightQuality = (Number(right.positivePoints || 0) + 1_000) / (Number(right.exposurePoints || 0) + 2_000);
    return rightQuality - leftQuality || Number(right.feedbackCount || 0) - Number(left.feedbackCount || 0);
  })[0];
  const currentMin = Number.isFinite(Number(stat.rangeMin)) ? Number(stat.rangeMin) : settings.globalMinWeight;
  const currentMax = Number.isFinite(Number(stat.rangeMax)) ? Number(stat.rangeMax) : settings.globalMaxWeight;
  const currentCenter = (currentMin + currentMax) / 2;
  const targetCenter = (best.min + best.max) / 2;
  const nextCenter = currentCenter * 0.65 + targetCenter * 0.35;
  const nextWidth = Math.max(MIN_ADAPTIVE_WIDTH, (currentMax - currentMin) * 0.9);
  let nextMin = Math.max(settings.globalMinWeight, nextCenter - nextWidth / 2);
  let nextMax = Math.min(settings.globalMaxWeight, nextCenter + nextWidth / 2);
  if (nextMax - nextMin < MIN_ADAPTIVE_WIDTH) {
    if (nextMin <= settings.globalMinWeight) nextMax = Math.min(settings.globalMaxWeight, nextMin + MIN_ADAPTIVE_WIDTH);
    else nextMin = Math.max(settings.globalMinWeight, nextMax - MIN_ADAPTIVE_WIDTH);
  }
  stat.rangeMin = roundWeight(nextMin);
  stat.rangeMax = roundWeight(nextMax);
}

function publicState(database) {
  return {
    schema: database.schema,
    schemaVersion: database.schemaVersion,
    roundId: database.roundId,
    updatedAt: database.updatedAt,
    settings: database.settings,
    artists: database.artists.map((artist) => ({
      key: artist.key,
      name: artist.name,
      score: scoreFor(artist),
      rating: Number(ratingFor(artist).toFixed(4)),
      positivePoints: artist.positivePoints,
      negativePoints: artist.negativePoints,
      exposurePoints: artist.exposurePoints,
      feedbackCount: artist.feedbackCount,
      rangeMin: artist.rangeMin,
      rangeMax: artist.rangeMax,
      weightBuckets: artist.weightBuckets,
    })).sort((left, right) => right.score - left.score || right.feedbackCount - left.feedbackCount || left.name.localeCompare(right.name)),
    trials: database.trials.slice(-100).reverse(),
  };
}

class ArtistPreferenceStore {
  constructor(productRoot, options = {}) {
    this.productRoot = ensureProductDirectories(productRoot);
    this.favoritesRoot = resolveInside(this.productRoot, "Favorites");
    this.root = resolveInside(this.favoritesRoot, "Pounding");
    this.filePath = resolveInside(this.root, "preference.json");
    this.roundIndexPath = resolveInside(this.root, "round-index.json");
    this.random = options.random || Math.random;
    fs.mkdirSync(this.root, { recursive: true });
    this.migrateLegacyStore();
  }

  migrateLegacyStore() {
    const legacyFilePath = resolveInside(this.favoritesRoot, "preference.json");
    if (!fs.existsSync(legacyFilePath) || fs.existsSync(this.filePath)) return;
    validateDatabase(readJson(legacyFilePath, "INVALID_ARTIST_PREFERENCE"));
    fs.renameSync(legacyFilePath, this.filePath);
  }

  getDatabase() {
    if (!fs.existsSync(this.filePath)) return emptyDatabase();
    const stored = readJson(this.filePath, "INVALID_ARTIST_PREFERENCE");
    const database = validateDatabase(stored);
    if (!stored.roundId) writeJsonAtomic(this.filePath, database);
    return database;
  }

  get() {
    return publicState(this.getDatabase());
  }

  getRoundIndex() {
    if (!fs.existsSync(this.roundIndexPath)) return { schema: ARTIST_POUNDING_ROUND_INDEX_SCHEMA, schemaVersion: 1, rounds: [] };
    const value = readJson(this.roundIndexPath, "INVALID_ARTIST_POUNDING_ROUND_INDEX");
    if (value?.schema !== ARTIST_POUNDING_ROUND_INDEX_SCHEMA || value?.schemaVersion !== 1 || !Array.isArray(value.rounds)) {
      throw new NainTailError("INVALID_ARTIST_POUNDING_ROUND_INDEX", "파운딩 라운드 목록 형식이 올바르지 않습니다.");
    }
    return value;
  }

  roundEntryPath(entry) {
    if (entry.relativePath) return resolveInside(this.productRoot, entry.relativePath);
    if (entry.absolutePath) return path.resolve(String(entry.absolutePath));
    return null;
  }

  registerRound(filePath, archive, database) {
    const index = this.getRoundIndex();
    const relative = path.relative(this.productRoot, filePath);
    const portable = relative && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
    const entry = {
      id: String(archive.roundId || createId("pounding_round")),
      fileName: path.basename(filePath),
      exportedAt: archive.exportedAt || database.updatedAt || new Date().toISOString(),
      artistCount: database.artists.length,
      trialCount: database.trials.length,
      topScore: database.artists.length ? Math.max(...database.artists.map(scoreFor)) : 0,
      ...(portable ? { relativePath: relative.replaceAll(path.sep, "/") } : { absolutePath: path.resolve(filePath) }),
    };
    index.rounds = [entry, ...index.rounds.filter((item) => item.id !== entry.id && this.roundEntryPath(item) !== path.resolve(filePath))].slice(0, 500);
    writeJsonAtomic(this.roundIndexPath, index);
    return entry;
  }

  listRounds() {
    return this.getRoundIndex().rounds.map((entry) => ({
      id: entry.id,
      fileName: entry.fileName,
      exportedAt: entry.exportedAt,
      artistCount: entry.artistCount,
      trialCount: entry.trialCount,
      topScore: entry.topScore,
      available: Boolean(this.roundEntryPath(entry) && fs.existsSync(this.roundEntryPath(entry))),
    }));
  }

  getRound(roundId, topCount = 4, finalizeSettings = {}) {
    const entry = this.getRoundIndex().rounds.find((item) => item.id === String(roundId || ""));
    if (!entry) throw new NainTailError("ARTIST_POUNDING_ROUND_NOT_FOUND", "저장된 파운딩 라운드를 찾을 수 없습니다.");
    const filePath = this.roundEntryPath(entry);
    if (!filePath || !fs.existsSync(filePath)) throw new NainTailError("ARTIST_POUNDING_ROUND_NOT_FOUND", "파운딩 라운드 JSON 파일이 이동되었거나 삭제되었습니다.");
    const value = readJson(filePath, "INVALID_ARTIST_POUNDING_ROUND");
    const database = databaseFromRound(value);
    return {
      round: { ...entry, available: true, absolutePath: undefined, relativePath: undefined },
      preference: publicState(database),
      finalizeSettings: normalizeFinalizeSettings(finalizeSettings),
      artists: finalizeArtists(database, topCount, finalizeSettings),
    };
  }

  resetRound() {
    const database = this.getDatabase();
    const reset = emptyDatabase();
    reset.updatedAt = new Date().toISOString();
    writeJsonAtomic(this.filePath, reset);
    return {
      discardedArtistCount: database.artists.length,
      discardedTrialCount: database.trials.length,
      preference: publicState(reset),
    };
  }

  finishRound(exportPath) {
    const targetPath = path.resolve(String(exportPath || ""));
    if (!targetPath || path.extname(targetPath).toLowerCase() !== ".json") {
      throw new NainTailError("INVALID_ARTIST_POUNDING_ROUND_PATH", "파운딩 라운드는 JSON 파일로 저장해야 합니다.");
    }
    if (targetPath === this.filePath) {
      throw new NainTailError("INVALID_ARTIST_POUNDING_ROUND_PATH", "현재 라운드 DB인 preference.json에는 내보낼 수 없습니다.");
    }
    const database = this.getDatabase();
    if (!database.trials.length && !database.artists.length) {
      throw new NainTailError("EMPTY_ARTIST_POUNDING_ROUND", "저장할 파운딩 라운드 데이터가 없습니다.");
    }
    const exportedAt = new Date().toISOString();
    const archive = roundArchive(database, exportedAt);
    writeJsonAtomic(targetPath, archive);
    const round = this.registerRound(targetPath, archive, database);
    const reset = emptyDatabase();
    reset.updatedAt = exportedAt;
    writeJsonAtomic(this.filePath, reset);
    return {
      canceled: false,
      fileName: path.basename(targetPath),
      exportedAt,
      archivedArtistCount: database.artists.length,
      archivedTrialCount: database.trials.length,
      round,
      preference: publicState(reset),
    };
  }

  loadRound(importPath) {
    const sourcePath = path.resolve(String(importPath || ""));
    if (!sourcePath || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      throw new NainTailError("ARTIST_POUNDING_ROUND_NOT_FOUND", "불러올 파운딩 라운드 JSON 파일을 찾을 수 없습니다.");
    }
    if (fs.statSync(sourcePath).size > MAX_ROUND_JSON_BYTES) {
      throw new NainTailError("INVALID_ARTIST_POUNDING_ROUND", "파운딩 라운드 JSON은 10MB 이하여야 합니다.");
    }
    const value = readJson(sourcePath, "INVALID_ARTIST_POUNDING_ROUND");
    const database = databaseFromRound(value);
    const archive = value?.schema === ARTIST_POUNDING_ROUND_SCHEMA ? value : roundArchive(database, database.updatedAt || new Date().toISOString());
    const round = this.registerRound(sourcePath, archive, database);
    writeJsonAtomic(this.filePath, database);
    return {
      canceled: false,
      fileName: path.basename(sourcePath),
      round,
      preference: publicState(database),
    };
  }

  getTrial(trialId) {
    const trial = this.getDatabase().trials.find((item) => item.id === String(trialId || ""));
    if (!trial) throw new NainTailError("ARTIST_POUNDING_TRIAL_NOT_FOUND", "파운딩 평가 회차를 찾을 수 없습니다.");
    return trial;
  }

  saveLikedImage(database, trial, input, now) {
    const sourcePath = path.resolve(String(input.sourcePath || ""));
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      throw new NainTailError("OUTPUT_NOT_FOUND", "파운딩 좋아요로 저장할 이미지 파일을 찾을 수 없습니다.");
    }
    const imageBytes = fs.readFileSync(sourcePath);
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (!imageBytes.subarray(0, 8).equals(pngSignature)) {
      throw new NainTailError("INVALID_FAVORITE_IMAGE", "파운딩 생성 결과 PNG만 좋아요 이미지로 저장할 수 있습니다.");
    }
    const sha256 = crypto.createHash("sha256").update(imageBytes).digest("hex");
    const duplicate = database.trials.find((item) => item.favoriteImage?.sha256 === sha256)?.favoriteImage;
    if (duplicate) return { image: duplicate, createdPath: null };

    const trialStem = safeFileStem(trial.id, "pounding").slice(-40);
    const fileName = `${now.replace(/[-:.]/gu, "")}_${trialStem}_${sha256.slice(0, 8)}.png`;
    const targetPath = resolveInside(this.root, fileName);
    fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
    return {
      createdPath: targetPath,
      image: {
        file: path.relative(this.productRoot, targetPath).replaceAll(path.sep, "/"),
        sha256,
        sourceResultId: trial.resultId,
        sourceRelativePath: trial.relativePath,
        createdAt: now,
      },
    };
  }

  createTrial(favorites, input = {}) {
    const candidates = Array.isArray(favorites) ? favorites.filter((artist) => artist?.key && artist?.name) : [];
    if (!candidates.length) throw new NainTailError("ARTIST_FAVORITES_REQUIRED", "파운딩을 시작하려면 Searching에서 작가를 Favorites에 먼저 등록해야 합니다.");
    const database = this.getDatabase();
    database.settings = normalizeSettings({ ...database.settings, ...(input.settings || input) });
    const settings = database.settings;
    for (const stat of database.artists) {
      const rangeMin = roundWeight(clamp(stat.rangeMin, settings.globalMinWeight, settings.globalMaxWeight, settings.globalMinWeight));
      const rangeMax = roundWeight(clamp(stat.rangeMax, settings.globalMinWeight, settings.globalMaxWeight, settings.globalMaxWeight));
      stat.rangeMin = Math.min(rangeMin, rangeMax);
      stat.rangeMax = Math.max(rangeMin, rangeMax);
    }
    const minimum = Math.min(settings.minArtists, candidates.length);
    const maximum = Math.min(settings.maxArtists, candidates.length);
    const selectedCount = randomInteger(minimum, maximum, this.random);
    const stats = new Map(database.artists.map((artist) => [artist.key, artist]));
    const pool = [...candidates];
    const selected = [];

    while (selected.length < selectedCount && pool.length) {
      const exploreSelection = this.random() < settings.explorationRate;
      const index = weightedPick(pool, (favorite) => {
        if (exploreSelection) return 1;
        const stat = stats.get(favorite.key);
        const rating = stat ? ratingFor(stat) : 0;
        const underexposed = 0.35 / Math.sqrt(Number(stat?.feedbackCount || 0) + 1);
        return Math.max(0.1, 1 + rating * 0.75 + underexposed);
      }, this.random);
      const [favorite] = pool.splice(index, 1);
      const stat = stats.get(favorite.key);
      const exploreWeight = !stat || Number(stat.feedbackCount || 0) < MIN_ADAPTIVE_FEEDBACK || this.random() < settings.explorationRate;
      const rangeMin = exploreWeight ? settings.globalMinWeight : Number(stat.rangeMin ?? settings.globalMinWeight);
      const rangeMax = exploreWeight ? settings.globalMaxWeight : Number(stat.rangeMax ?? settings.globalMaxWeight);
      selected.push({ favoriteKey: favorite.key, name: favorite.name, weight: randomWeight(rangeMin, rangeMax, this.random) });
    }

    const now = new Date().toISOString();
    const trial = {
      id: createId("pounding"),
      createdAt: now,
      completedAt: null,
      evaluatedAt: null,
      resultId: null,
      relativePath: null,
      feedback: null,
      scorePool: SCORE_POOL,
      artists: allocateScore(selected),
    };
    database.trials.push(trial);
    if (database.trials.length > MAX_TRIALS) database.trials.splice(0, database.trials.length - MAX_TRIALS);
    database.updatedAt = now;
    writeJsonAtomic(this.filePath, database);
    return { trial, preference: publicState(database) };
  }

  attachResult(trialId, result = {}) {
    const database = this.getDatabase();
    const trial = database.trials.find((item) => item.id === trialId);
    if (!trial) throw new NainTailError("ARTIST_POUNDING_TRIAL_NOT_FOUND", "파운딩 평가 회차를 찾을 수 없습니다.");
    trial.resultId = String(result.id || trial.resultId || "") || null;
    trial.relativePath = String(result.relativePath || trial.relativePath || "") || null;
    trial.completedAt = result.createdAt || new Date().toISOString();
    database.updatedAt = new Date().toISOString();
    writeJsonAtomic(this.filePath, database);
    return publicState(database);
  }

  rateTrial(input = {}) {
    const feedback = String(input.feedback || "");
    if (!["like", "dislike", "skip"].includes(feedback)) throw new NainTailError("INVALID_ARTIST_POUNDING_FEEDBACK", "파운딩 평가는 좋아요, 싫어요 또는 건너뛰기여야 합니다.");
    const database = this.getDatabase();
    const trial = database.trials.find((item) => item.id === String(input.trialId || ""));
    if (!trial) throw new NainTailError("ARTIST_POUNDING_TRIAL_NOT_FOUND", "파운딩 평가 회차를 찾을 수 없습니다.");
    if (!trial.resultId && !input.resultId) throw new NainTailError("ARTIST_POUNDING_RESULT_REQUIRED", "생성이 완료된 파운딩 결과만 평가할 수 있습니다.");
    if (trial.resultId && input.resultId && trial.resultId !== String(input.resultId)) throw new NainTailError("ARTIST_POUNDING_RESULT_MISMATCH", "파운딩 회차와 생성 결과가 일치하지 않습니다.");
    if (trial.feedback) throw new NainTailError("ARTIST_POUNDING_ALREADY_RATED", "이미 평가한 파운딩 결과입니다.");

    const now = new Date().toISOString();
    const likedImage = feedback === "like" ? this.saveLikedImage(database, trial, input, now) : null;
    trial.feedback = feedback;
    trial.resultId = String(input.resultId || trial.resultId || "") || null;
    trial.evaluatedAt = now;
    if (likedImage) trial.favoriteImage = likedImage.image;
    if (feedback !== "skip") {
      for (const trialArtist of trial.artists) {
        let stat = database.artists.find((artist) => artist.key === trialArtist.favoriteKey);
        if (!stat) {
          stat = {
            key: trialArtist.favoriteKey,
            name: trialArtist.name,
            positivePoints: 0,
            negativePoints: 0,
            exposurePoints: 0,
            feedbackCount: 0,
            rangeMin: database.settings.globalMinWeight,
            rangeMax: database.settings.globalMaxWeight,
            weightBuckets: [],
          };
          database.artists.push(stat);
        }
        stat.name = trialArtist.name;
        stat.exposurePoints += trialArtist.allocatedPoints;
        stat.feedbackCount += 1;
        if (feedback === "like") stat.positivePoints += trialArtist.allocatedPoints;
        else stat.negativePoints += trialArtist.allocatedPoints;
        const definition = bucketForWeight(trialArtist.weight);
        let bucket = stat.weightBuckets.find((item) => item.key === definition.key);
        if (!bucket) {
          bucket = { ...definition, positivePoints: 0, negativePoints: 0, exposurePoints: 0, feedbackCount: 0 };
          stat.weightBuckets.push(bucket);
        }
        bucket.exposurePoints += trialArtist.allocatedPoints;
        bucket.feedbackCount += 1;
        if (feedback === "like") bucket.positivePoints += trialArtist.allocatedPoints;
        else bucket.negativePoints += trialArtist.allocatedPoints;
        adaptRange(stat, database.settings);
      }
    }
    database.updatedAt = now;
    try {
      writeJsonAtomic(this.filePath, database);
    } catch (error) {
      if (likedImage?.createdPath) fs.rmSync(likedImage.createdPath, { force: true });
      throw error;
    }
    return publicState(database);
  }
}

module.exports = {
  ARTIST_POUNDING_ROUND_SCHEMA,
  ARTIST_POUNDING_ROUND_SCHEMA_VERSION,
  ARTIST_PREFERENCE_SCHEMA,
  ARTIST_PREFERENCE_SCHEMA_VERSION,
  ArtistPreferenceStore,
  DEFAULT_FINALIZE_SETTINGS,
  DEFAULT_SETTINGS,
  MIN_ADAPTIVE_FEEDBACK,
  SCORE_POOL,
  allocateScore,
  databaseFromRound,
  finalizeArtists,
  finalizeWeightForScore,
  normalizeFinalizeSettings,
  normalizeSettings,
  ratingFor,
  roundArchive,
  scoreFor,
};
