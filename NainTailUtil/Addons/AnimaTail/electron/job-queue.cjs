"use strict";

const { randomUUID } = require("node:crypto");
const path = require("node:path");
const { generationJobCount } = require("./generation-count.cjs");
const { multiOutputDirectory } = require("./output-naming.cjs");

const FINISHED_STATES = new Set(["completed", "failed", "cancelled"]);
const MAX_QUEUE_ITEMS = 100;
const PROGRESS_EMIT_INTERVAL_MS = 250;

function publicResult(result) {
  if (!result) return null;
  const relativePath = result.relativePath || (result.path ? path.basename(result.path) : null);
  return {
    fileName: result.path ? path.basename(result.path) : null,
    relativePath,
    seed: result.seed,
    width: result.width,
    height: result.height,
    seconds: result.seconds,
  };
}

function publicJob(job) {
  return {
    id: job.id,
    groupId: job.groupId,
    ordinal: job.ordinal,
    groupSize: job.groupSize,
    state: job.state,
    createdAt: job.createdAt,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
    prompt: job.payload.prompt,
    negativePrompt: job.payload.negativePrompt || "",
    generationMode: job.payload.generationMode || "standard",
    refine: job.payload.generationMode === "refine" ? {
      mode: job.payload.refineMode,
      denoisingStrength: job.payload.denoisingStrength,
      upscaleScale: job.payload.upscaleScale,
      sourceImage: job.payload.sourceImage,
    } : null,
    loraLoadMode: job.payload.loraLoadMode || "fused",
    basePrompt: job.payload.mainPrompt === undefined ? "" : (job.payload.basePrompt || ""),
    mainPrompt: job.payload.mainPrompt ?? job.payload.basePrompt ?? job.payload.prompt,
    baseNegativePrompt: job.payload.baseNegativePrompt || "",
    baseLoras: (job.payload.baseLoras || job.payload.loras).map(({ path: _path, ...lora }) => lora),
    subPrompt: job.payload.subPrompt || null,
    model: job.payload.model,
    loras: job.payload.loras.map(({ path: _path, ...lora }) => lora),
    settings: {
      outputPrefix: job.payload.outputPrefix,
      outputSubPrefix: job.payload.outputSubPrefix || "",
      outputDirectory: job.payload.outputDirectory || "",
      outputSlotNumber: job.payload.outputSlotNumber || null,
      width: job.payload.width,
      height: job.payload.height,
      steps: job.payload.steps,
      cfg: job.payload.cfg,
      sampler: job.payload.sampler || "er_sde",
      scheduler: job.payload.scheduler || "simple",
      batchSize: job.payload.batchSize,
      randomSeed: job.payload.randomSeed,
      seed: job.payload.seed,
      queueOrdinal: job.payload.job.queueOrdinal || job.ordinal,
      queueCount: job.payload.job.queueCount || job.groupSize,
      ...(job.payload.generationMode === "refine" ? {
        denoisingStrength: job.payload.denoisingStrength,
        refineMode: job.payload.refineMode,
        upscaleScale: job.payload.upscaleScale,
      } : {}),
    },
    progress: job.progress || null,
    results: job.results.map(publicResult),
    error: job.error || null,
  };
}

class JobQueue {
  constructor(
    executor,
    onChange = () => {},
    maxItems = MAX_QUEUE_ITEMS,
    progressEmitIntervalMs = PROGRESS_EMIT_INTERVAL_MS,
  ) {
    this.executor = executor;
    this.onChange = onChange;
    this.maxItems = maxItems;
    this.progressEmitIntervalMs = progressEmitIntervalMs;
    this.lastProgressEmitAt = 0;
    this.jobs = [];
    this.active = null;
    this.processing = false;
  }

  snapshot() {
    return {
      activeJobId: this.active?.id || null,
      maxItems: this.maxItems,
      jobs: this.jobs.map(publicJob),
    };
  }

  emit() {
    this.onChange(this.snapshot());
  }

  getResult(jobId, resultIndex) {
    const job = this.jobs.find((candidate) => candidate.id === jobId);
    if (!job || !Number.isInteger(resultIndex) || resultIndex < 0) return null;
    return job.results[resultIndex] || null;
  }

  getJobState(jobId) {
    return this.jobs.find((candidate) => candidate.id === jobId)?.state || null;
  }

  removeResult(jobId, resultIndex) {
    const job = this.jobs.find((candidate) => candidate.id === jobId);
    if (!job || job.state === "running" || !Number.isInteger(resultIndex)
      || resultIndex < 0 || resultIndex >= job.results.length) return false;
    job.results.splice(resultIndex, 1);
    this.emit();
    return true;
  }

  add(request) {
    const groupId = randomUUID();
    const { variants: requestedVariants, ...baseRequest } = request;
    const variants = Array.isArray(requestedVariants) && requestedVariants.length > 0
      ? requestedVariants
      : [{
        prompt: request.prompt,
        negativePrompt: request.negativePrompt || "",
        subPrompt: null,
      }];
    const queueCount = request.queueCount;
    const groupSize = generationJobCount({ queueCount, variants });
    const unfinishedCount = this.jobs.filter((job) => !FINISHED_STATES.has(job.state)).length;
    if (unfinishedCount + groupSize > this.maxItems) {
      const available = Math.max(0, this.maxItems - unfinishedCount);
      throw new Error(
        `작업 대기열은 최대 ${this.maxItems}개입니다. 현재 새로 등록할 수 있는 작업은 ${available}개입니다.`,
      );
    }

    let finishedToRemove = Math.max(0, this.jobs.length + groupSize - this.maxItems);
    if (finishedToRemove > 0) {
      this.jobs = this.jobs.filter((job) => {
        if (finishedToRemove > 0 && FINISHED_STATES.has(job.state)) {
          finishedToRemove -= 1;
          return false;
        }
        return true;
      });
    }

    const createdAt = new Date().toISOString();
    const outputDirectory = request.generationMode === "sub-prompt"
      ? multiOutputDirectory(createdAt, groupId)
      : "";
    let ordinal = 0;
    for (let variantIndex = 0; variantIndex < variants.length; variantIndex += 1) {
      for (let queueIndex = 0; queueIndex < queueCount; queueIndex += 1) {
        ordinal += 1;
        const id = randomUUID();
        const seed = request.randomSeed
          ? 0
          : (request.seed + (queueIndex * request.batchSize)) % 2147483648;
        const payload = {
          ...baseRequest,
          ...variants[variantIndex],
          queueCount: 1,
          seed,
          outputDirectory,
          outputSlotNumber: request.generationMode === "sub-prompt"
            ? Number(variants[variantIndex].outputSlotNumber || variantIndex + 1)
            : null,
          job: {
            schemaVersion: 1,
            id,
            groupId,
            ordinal,
            groupSize,
            queueOrdinal: queueIndex + 1,
            queueCount,
            variationOrdinal: variantIndex + 1,
            variationCount: variants.length,
            createdAt,
          },
        };
        this.jobs.push({
          id,
          groupId,
          ordinal,
          groupSize,
          createdAt,
          state: "pending",
          payload,
          results: [],
        });
      }
    }
    this.emit();
    void this.pump();
    return this.snapshot();
  }

  emitProgress() {
    const now = Date.now();
    if (now - this.lastProgressEmitAt < this.progressEmitIntervalMs) return;
    this.lastProgressEmitAt = now;
    this.emit();
  }

  handleWorkerEvent(event) {
    if (!this.active) return;
    if (event.event === "loading") {
      this.active.progress = { phase: event.phase };
      this.emitProgress();
    } else if (event.event === "progress") {
      this.active.progress = {
        imageIndex: event.imageIndex,
        totalImages: event.totalImages,
        step: event.step,
        totalSteps: event.totalSteps,
      };
      this.emitProgress();
    } else if (event.event === "image" && event.result) {
      this.active.results.push(event.result);
      this.active.progress = {
        ...(this.active.progress || {}),
        imageIndex: event.imageIndex,
        totalImages: event.totalImages,
      };
      this.lastProgressEmitAt = Date.now();
      this.emit();
    }
  }

  remove(id) {
    const index = this.jobs.findIndex((job) => job.id === id);
    if (index === -1 || this.jobs[index].state !== "pending") return false;
    this.jobs.splice(index, 1);
    this.emit();
    return true;
  }

  move(id, direction) {
    const pending = this.jobs.filter((job) => job.state === "pending");
    const pendingIndex = pending.findIndex((job) => job.id === id);
    const targetPendingIndex = pendingIndex + direction;
    if (pendingIndex < 0 || targetPendingIndex < 0 || targetPendingIndex >= pending.length) return false;
    const currentIndex = this.jobs.indexOf(pending[pendingIndex]);
    const targetIndex = this.jobs.indexOf(pending[targetPendingIndex]);
    [this.jobs[currentIndex], this.jobs[targetIndex]] = [this.jobs[targetIndex], this.jobs[currentIndex]];
    this.emit();
    return true;
  }

  cancelActive() {
    if (!this.active) return false;
    this.active.cancelRequested = true;
    return this.executor.cancel();
  }

  cancelAll() {
    const finishedAt = new Date().toISOString();
    let changed = false;
    for (const job of this.jobs) {
      if (job.state !== "pending") continue;
      job.state = "cancelled";
      job.finishedAt = finishedAt;
      job.progress = null;
      changed = true;
    }

    let activeCancellationRequested = false;
    if (this.active) {
      this.active.cancelRequested = true;
      activeCancellationRequested = this.executor.cancel();
      changed = true;
    }
    if (changed) this.emit();
    return {
      cancelled: changed,
      activeCancellationRequested,
      state: this.snapshot(),
    };
  }

  clearFinished() {
    this.jobs = this.jobs.filter((job) => !FINISHED_STATES.has(job.state));
    this.emit();
  }

  async pump() {
    if (this.processing) return;
    this.processing = true;
    try {
      while (true) {
        const job = this.jobs.find((candidate) => candidate.state === "pending");
        if (!job) break;
        this.active = job;
        job.state = "running";
        job.startedAt = new Date().toISOString();
        job.progress = { phase: "worker-start" };
        this.emit();
        try {
          const result = await this.executor.generate(job.payload);
          job.state = "completed";
          if (job.results.length === 0 && Array.isArray(result.images)) {
            job.results = result.images;
          }
        } catch (error) {
          job.state = job.cancelRequested ? "cancelled" : "failed";
          job.error = error.message;
        } finally {
          job.finishedAt = new Date().toISOString();
          job.progress = null;
          this.active = null;
          this.emit();
        }
      }
    } finally {
      this.processing = false;
      if (this.jobs.some((job) => job.state === "pending")) void this.pump();
    }
  }
}

module.exports = { JobQueue, MAX_QUEUE_ITEMS, publicJob };
