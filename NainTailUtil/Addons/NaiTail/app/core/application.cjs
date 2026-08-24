"use strict";

const { EventEmitter } = require("node:events");
const { NainTailError } = require("./errors.cjs");
const { appendPresetItems, createProject, validateProject } = require("./project-model.cjs");
const { ProjectStore } = require("./project-store.cjs");
const { PresetStore } = require("./preset-store.cjs");
const { OutputStore } = require("./output-store.cjs");
const { materializeProject, materializeSingle } = require("./request-resolver.cjs");
const { GenerationQueue } = require("./generation-queue.cjs");
const { NaiWorkerClient } = require("./worker-client.cjs");
const { ensureProductDirectories } = require("./paths.cjs");
const { estimateAnlasCost } = require("./anlas-cost.cjs");
const { ArtistStudyStore } = require("./artist-study-store.cjs");
const { ArtistFavoriteStore } = require("./artist-favorite-store.cjs");
const { ArtistPreferenceStore } = require("./artist-preference-store.cjs");
const { artistStudyExampleValues, materializeArtistFinalize, materializeArtistMixing, materializeArtistPounding, materializeArtistSearch, materializeArtistStudy, normalizeArtistStudy, randomizeArtistWeights, randomizeMixingArtistWeights } = require("./artist-study-model.cjs");
const { materializeMulti } = require("./multi-model.cjs");
const { normalizeLocalRepeat } = require("./local-repeat.cjs");
const { ReferenceImageStore } = require("./reference-image-store.cjs");
const packageInfo = require("../../package.json");

class NainTailApplication extends EventEmitter {
  constructor(options = {}) {
    super();
    this.version = String(options.version || packageInfo.version);
    this.productRoot = ensureProductDirectories(options.productRoot);
    this.projectStore = options.projectStore || new ProjectStore(this.productRoot);
    this.presetStore = options.presetStore || new PresetStore(this.productRoot);
    this.outputStore = options.outputStore || new OutputStore(this.productRoot, { outputRoot: options.outputRoot });
    this.artistStudyStore = options.artistStudyStore || new ArtistStudyStore(this.productRoot);
    this.artistFavoriteStore = options.artistFavoriteStore || new ArtistFavoriteStore(this.productRoot);
    this.artistPreferenceStore = options.artistPreferenceStore || new ArtistPreferenceStore(this.productRoot);
    this.referenceImageStore = options.referenceImageStore || new ReferenceImageStore(this.productRoot);
    this.worker = options.worker || new NaiWorkerClient({ productRoot: this.productRoot });
    this.getToken = options.getToken || (async () => process.env.NAINTAIL_NAI_TOKEN || "");
    this.queue = new GenerationQueue((task) => this.executeTask(task));
    this.queue.on("state", (event) => this.emit("queue", event));
  }

  async requireToken() {
    const token = String(await this.getToken() || "").trim();
    if (!token) throw new NainTailError("NAI_TOKEN_MISSING", "NovelAI 토큰이 설정되지 않았습니다.");
    return token;
  }

  info() {
    return {
      name: "NainTailUtil",
      version: this.version,
      productRoot: this.productRoot,
      outputRoot: this.outputStore.directory,
      activeAddon: { id: "naitail", name: "NaiTail", builtIn: true },
      architecture: { host: "NainTail", addon: "NaiTail", core: "headless", worker: "stdio-jsonl", naiConcurrency: 1 },
    };
  }

  setOutputRoot(outputRoot) {
    this.outputStore.setDirectory(outputRoot);
    return this.info();
  }

  status() {
    const presets = this.presetStore.list();
    return {
      ...this.info(),
      tokenConfigured: false,
      projects: this.projectStore.list().length,
      subSlotPresets: presets.filter((preset) => preset.type === "sub-slot").length,
      examplePresets: presets.filter((preset) => preset.type === "example").length,
      queue: this.queue.snapshot(),
    };
  }

  async liveStatus() {
    const token = String(await this.getToken() || "").trim();
    return { ...this.status(), tokenConfigured: Boolean(token), worker: await this.worker.ping() };
  }

  listProjects() {
    return this.projectStore.list();
  }

  createProject(input = {}) {
    return this.projectStore.save(createProject(input));
  }

  getProject(id) {
    return this.projectStore.get(id);
  }

  saveProject(project) {
    return this.projectStore.save(validateProject(project));
  }

  listPresets() {
    return this.presetStore.list();
  }

  getPreset(id) {
    return this.presetStore.get(id);
  }

  savePreset(preset) {
    return this.presetStore.save(preset);
  }

  deletePreset(id) {
    return this.presetStore.delete(id);
  }

  getArtistStudy() {
    return this.artistStudyStore.get();
  }

  saveArtistStudy(input) {
    return this.artistStudyStore.save(input);
  }

  randomizeArtistStudy(input) {
    return randomizeArtistWeights(input);
  }

  listArtistFavorites() {
    return this.artistFavoriteStore.list();
  }

  listArtistFavoriteDetails() {
    return this.artistFavoriteStore.listDetails();
  }

  removeArtistFavoriteImage(input) {
    return this.artistFavoriteStore.removeImage(input);
  }

  removeArtistFavorite(input) {
    return this.artistFavoriteStore.removeArtist(input);
  }

  clearArtistFavorites() {
    return this.artistFavoriteStore.clear();
  }

  getArtistPounding() {
    return this.artistPreferenceStore.get();
  }

  assertArtistPoundingRoundIdle() {
    const active = this.queue.snapshot().jobs.some((job) => ["pending", "in_flight"].includes(job.state) && job.task?.source?.studyMode === "pounding");
    if (active) throw new NainTailError("ARTIST_POUNDING_ROUND_BUSY", "진행 중인 파운딩 생성이 끝난 뒤 라운드를 저장하거나 불러오거나 초기화할 수 있습니다.");
  }

  finishArtistPoundingRound(exportPath) {
    this.assertArtistPoundingRoundIdle();
    return this.artistPreferenceStore.finishRound(exportPath);
  }

  loadArtistPoundingRound(importPath) {
    this.assertArtistPoundingRoundIdle();
    return this.artistPreferenceStore.loadRound(importPath);
  }

  resetArtistPoundingRound() {
    this.assertArtistPoundingRoundIdle();
    return this.artistPreferenceStore.resetRound();
  }

  listArtistPoundingRounds() {
    return this.artistPreferenceStore.listRounds();
  }

  getArtistPoundingRound(roundId, topCount, finalizeSettings) {
    return this.artistPreferenceStore.getRound(roundId, topCount, finalizeSettings);
  }

  rateArtistPounding(input) {
    const payload = { ...input };
    if (String(payload.feedback || "") === "like") {
      const trial = this.artistPreferenceStore.getTrial(payload.trialId);
      payload.sourcePath = this.outputStore.resolveOutputPath(trial.relativePath);
    }
    return this.artistPreferenceStore.rateTrial(payload);
  }

  canonicalizeArtistMixing(input = {}) {
    const favorites = new Map(this.artistFavoriteStore.list().map((artist) => [artist.key, artist]));
    const mixingArtists = Array.isArray(input.mixingArtists) ? input.mixingArtists.map((artist) => {
      const favorite = favorites.get(String(artist.favoriteKey || ""));
      if (!favorite) throw new NainTailError("ARTIST_FAVORITE_REQUIRED", "믹싱에는 Favorites에 등록된 작가만 추가할 수 있습니다.");
      return { ...artist, name: favorite.name, favoriteKey: favorite.key };
    }) : [];
    return { ...input, mixingArtists };
  }

  randomizeArtistMixing(input) {
    return randomizeMixingArtistWeights(this.canonicalizeArtistMixing(input));
  }

  saveArtistStudyExample(input, name) {
    const values = artistStudyExampleValues(input);
    if (!values.prompt && !values.negativePrompt) throw new NainTailError("EMPTY_EXAMPLE_PRESET", "등록할 작례 Prompt와 UC가 비어 있습니다.");
    return this.presetStore.save({ type: "example", name, prompt: values.prompt, negativePrompt: values.negativePrompt });
  }

  saveArtistFavorite(input = {}) {
    const sourcePath = this.outputStore.resolveOutputPath(input.relativePath);
    return this.artistFavoriteStore.save({
      artistName: input.artistName,
      resultId: input.resultId,
      sourcePath,
      sourceRelativePath: input.relativePath,
      seed: input.seed,
    });
  }

  appendPreset(projectId, presetId, target) {
    const project = this.projectStore.get(projectId);
    const preset = this.presetStore.get(presetId);
    if (target?.type === "general") {
      project.generalSlots = appendPresetItems(project.generalSlots, preset);
    } else if (target?.type === "character") {
      const character = project.characters.find((item) => item.id === target.characterId);
      if (!character) throw new NainTailError("CHARACTER_NOT_FOUND", "프리셋을 적용할 캐릭터 카드를 찾을 수 없습니다.");
      character.slots = appendPresetItems(character.slots, preset);
    } else {
      throw new NainTailError("INVALID_PRESET_TARGET", "프리셋 Append 대상이 올바르지 않습니다.");
    }
    return this.projectStore.save(project);
  }

  estimate(request, options = {}) {
    return estimateAnlasCost(request.settings || request, options);
  }

  saveReferenceImage(input) {
    return this.referenceImageStore.save(input);
  }

  saveVibeImage(input) {
    return this.referenceImageStore.saveVibe(input);
  }

  vibeCacheStatus(input) {
    return this.referenceImageStore.vibeCacheStatus(input);
  }

  async subscription() {
    return this.worker.subscription(await this.requireToken());
  }

  async executeTask(task) {
    const token = await this.requireToken();
    const workerResult = await this.worker.generate(this.referenceImageStore.hydrateRequest(task.request), token);
    const result = this.outputStore.save(task, workerResult);
    if (task.projectId) this.projectStore.appendResult(task.projectId, result);
    if (task.source?.studyMode === "pounding" && task.source?.trialId) this.artistPreferenceStore.attachResult(task.source.trialId, result);
    this.emit("result", result);
    return result;
  }

  async enqueueSingle(input) {
    await this.requireToken();
    const tasks = materializeSingle(input);
    this.queue.enqueue(tasks);
    return { runId: tasks[0].runId, tasks: tasks.length, queue: this.queue.snapshot() };
  }

  async enqueueArtistStudy(input) {
    await this.requireToken();
    const tasks = materializeArtistStudy(input);
    this.queue.enqueue(tasks);
    return { runId: tasks[0].runId, tasks: tasks.length, queue: this.queue.snapshot() };
  }

  async enqueueArtistSearch(input) {
    await this.requireToken();
    const tasks = materializeArtistSearch(input);
    this.queue.enqueue(tasks);
    return { runId: tasks[0].runId, tasks: tasks.length, queue: this.queue.snapshot() };
  }

  async enqueueArtistMixing(input) {
    await this.requireToken();
    const tasks = materializeArtistMixing(this.canonicalizeArtistMixing(input));
    this.queue.enqueue(tasks);
    return { runId: tasks[0].runId, tasks: tasks.length, queue: this.queue.snapshot() };
  }

  async enqueueArtistPounding(input = {}) {
    await this.requireToken();
    const study = normalizeArtistStudy(input.study || input);
    const repeat = normalizeLocalRepeat(study, 1);
    const oneImageStudy = { ...study, batchCount: 1, queueCount: 1 };
    const trials = [];
    const tasks = [];
    let preference = this.artistPreferenceStore.get();
    for (let queueIndex = 1; queueIndex <= repeat.queueCount; queueIndex += 1) {
      for (let batchIndex = 1; batchIndex <= repeat.batchCount; batchIndex += 1) {
        const created = this.artistPreferenceStore.createTrial(this.artistFavoriteStore.list(), input.settings || {});
        const trial = { ...created.trial, roundId: created.preference.roundId };
        const [task] = materializeArtistPounding(oneImageStudy, trial);
        trials.push(trial);
        preference = created.preference;
        tasks.push({
          ...task,
          ordinal: tasks.length + 1,
          source: {
            ...task.source,
            batchIndex,
            batchCount: repeat.batchCount,
            queueIndex,
            queueCount: repeat.queueCount,
          },
        });
      }
    }
    const runId = tasks[0].runId;
    tasks.forEach((task) => { task.runId = runId; });
    this.queue.enqueue(tasks);
    return { runId, tasks: tasks.length, trial: trials[0], trials, preference, queue: this.queue.snapshot() };
  }

  async enqueueArtistFinalize(input = {}) {
    await this.requireToken();
    const detail = this.artistPreferenceStore.getRound(input.roundId, input.topCount, input.finalizeSettings);
    const tasks = materializeArtistFinalize(input.study || input, { roundId: detail.round.id, fileName: detail.round.fileName, artists: detail.artists });
    this.queue.enqueue(tasks);
    return { runId: tasks[0].runId, tasks: tasks.length, round: detail.round, artists: detail.artists, queue: this.queue.snapshot() };
  }

  async enqueueMulti(input) {
    await this.requireToken();
    const tasks = materializeMulti(input);
    this.queue.enqueue(tasks);
    return { runId: tasks[0].runId, tasks: tasks.length, queue: this.queue.snapshot() };
  }

  async enqueueProject(projectId, options = {}) {
    await this.requireToken();
    const project = this.projectStore.get(projectId);
    const tasks = materializeProject(project, options);
    if (tasks.length === 0) throw new NainTailError("NO_ENABLED_SLOTS", "생성 대상으로 선택된 슬롯이 없습니다.");
    this.queue.enqueue(tasks);
    return { runId: tasks[0].runId, tasks: tasks.length, queue: this.queue.snapshot() };
  }

  waitForRun(runId) {
    return this.queue.waitForRun(runId);
  }

  clearQueue() {
    return this.queue.clearQueue();
  }

  stopAfterCurrent() {
    return this.queue.stopAfterCurrent();
  }

  cancelRun(runId) {
    return this.queue.cancelRun(runId);
  }

  resumeQueue() {
    return this.queue.resume();
  }

  resolveOutputPath(relativePath) {
    return this.outputStore.resolveOutputPath(relativePath);
  }

  removeResultReference(projectId, resultId) {
    if (!projectId || !resultId) return { removed: false };
    const project = this.projectStore.removeResult(projectId, resultId);
    return { removed: true, projectId: project.id, resultId };
  }

  close() {
    this.worker.shutdown?.();
  }
}

module.exports = { NainTailApplication };
