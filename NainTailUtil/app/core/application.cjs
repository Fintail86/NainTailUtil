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
const { artistStudyExampleValues, materializeArtistStudy, randomizeArtistWeights } = require("./artist-study-model.cjs");
const { materializeMulti } = require("./multi-model.cjs");
const { ReferenceImageStore } = require("./reference-image-store.cjs");

class NainTailApplication extends EventEmitter {
  constructor(options = {}) {
    super();
    this.productRoot = ensureProductDirectories(options.productRoot);
    this.projectStore = options.projectStore || new ProjectStore(this.productRoot);
    this.presetStore = options.presetStore || new PresetStore(this.productRoot);
    this.outputStore = options.outputStore || new OutputStore(this.productRoot);
    this.artistStudyStore = options.artistStudyStore || new ArtistStudyStore(this.productRoot);
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
      version: "0.1.0",
      productRoot: this.productRoot,
      architecture: { core: "headless", worker: "stdio-jsonl", naiConcurrency: 1 },
    };
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

  saveArtistStudyExample(input, name) {
    const values = artistStudyExampleValues(input);
    if (!values.prompt && !values.negativePrompt) throw new NainTailError("EMPTY_EXAMPLE_PRESET", "등록할 작례 Prompt와 UC가 비어 있습니다.");
    return this.presetStore.save({ type: "example", name, prompt: values.prompt, negativePrompt: values.negativePrompt });
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
