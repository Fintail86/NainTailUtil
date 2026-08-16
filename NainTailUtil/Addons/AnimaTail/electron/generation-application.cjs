"use strict";

const { randomUUID } = require("node:crypto");
const { normalizeGenerationRequest } = require("./generation-request.cjs");
const { InferenceService } = require("./inference-service.cjs");
const { JobQueue } = require("./job-queue.cjs");
const { readRuntimeStatus } = require("./runtime-status.cjs");

const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);

class GenerationApplicationError extends Error {
  constructor(code, message, exitCode = 4) {
    super(message);
    this.name = "GenerationApplicationError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

function publicWorkerResult(result) {
  if (!result || typeof result !== "object") return null;
  return {
    relativePath: result.relativePath || result.fileName || null,
    fileName: result.fileName || (typeof result.path === "string"
      ? result.path.split(/[\\/]/u).pop()
      : null),
    seed: result.seed,
    width: result.width,
    height: result.height,
    seconds: result.seconds,
  };
}

function summarizeGroup(state, groupId) {
  const jobs = state.jobs.filter((job) => job.groupId === groupId);
  const completed = jobs.filter((job) => job.state === "completed");
  const failed = jobs.filter((job) => job.state === "failed");
  const cancelled = jobs.filter((job) => job.state === "cancelled");
  const results = jobs.flatMap((job) => job.results.map((result) => ({
    ...result,
    jobId: job.id,
    ordinal: job.ordinal,
    subPrompt: job.subPrompt,
  })));
  let status = "running";
  if (jobs.length > 0 && jobs.every((job) => TERMINAL_STATES.has(job.state))) {
    if (failed.length > 0 && (completed.length > 0 || results.length > 0)) status = "partial";
    else if (failed.length > 0) status = "failed";
    else if (cancelled.length > 0 && completed.length === 0) status = "cancelled";
    else if (cancelled.length > 0) status = "partial";
    else status = "completed";
  }
  return {
    status,
    groupId,
    jobs,
    results,
    counts: {
      total: jobs.length,
      completed: completed.length,
      failed: failed.length,
      cancelled: cancelled.length,
      images: results.length,
    },
  };
}

class GenerationApplication {
  constructor(options) {
    this.appRoot = options.appRoot;
    this.runtimeRoot = options.runtimeRoot;
    this.outputRoot = options.outputRoot;
    this.appVersion = options.appVersion || "0.0.0";
    this.electronVersion = options.electronVersion || process.versions.electron || null;
    this.onEvent = options.onEvent || (() => {});
    this.preflight = options.preflight !== false;
    this.runtimeStatusReader = options.runtimeStatusReader || ((appRoot) => readRuntimeStatus(
      appRoot,
      { runtimeRoot: this.runtimeRoot },
    ));
    this.normalizer = options.normalizer || normalizeGenerationRequest;
    this.waiters = new Map();
    this.activeRequestId = null;
    this.executor = options.executor || new InferenceService(this.appRoot, (event) => (
      this.handleWorkerEvent(event)
    ), { runtimeRoot: this.runtimeRoot, outputRoot: this.outputRoot });
    this.queue = new JobQueue(this.executor, (state) => this.handleQueueState(state));
  }

  emit(event, data = {}) {
    this.onEvent({ event, requestId: this.activeRequestId, data });
  }

  handleWorkerEvent(event) {
    if (["loading", "progress"].includes(event.event)) {
      this.emit(event.event, {
        phase: event.phase,
        imageIndex: event.imageIndex,
        totalImages: event.totalImages,
        step: event.step,
        totalSteps: event.totalSteps,
      });
    } else if (event.event === "image") {
      this.emit("image", {
        imageIndex: event.imageIndex,
        totalImages: event.totalImages,
        result: publicWorkerResult(event.result),
      });
    } else if (event.type === "log" && event.message) {
      this.onEvent({ event: "log", requestId: this.activeRequestId, data: { message: event.message } });
    }
    this.queue.handleWorkerEvent(event);
  }

  handleQueueState(state) {
    for (const [groupId, waiter] of this.waiters) {
      const summary = summarizeGroup(state, groupId);
      if (summary.status === "running") continue;
      this.waiters.delete(groupId);
      waiter.resolve(summary);
    }
  }

  assertReady() {
    if (!this.preflight) return;
    const status = this.runtimeStatusReader(this.appRoot);
    if (status.state !== "ready") {
      throw new GenerationApplicationError(
        "RUNTIME_NOT_READY",
        `앱 전용 Python/CUDA 런타임이 준비되지 않았습니다: ${status.state}`,
        3,
      );
    }
    if (!status.supportAssetsReady) {
      throw new GenerationApplicationError(
        "SUPPORT_ASSETS_NOT_READY",
        "필수 보조 자산(VAE·텍스트 인코더·토크나이저)이 준비되지 않았습니다.",
        3,
      );
    }
  }

  async run(request, requestId = randomUUID()) {
    if (this.activeRequestId) {
      throw new GenerationApplicationError("GENERATION_BUSY", "이미 CLI 생성 작업이 실행 중입니다.");
    }
    this.activeRequestId = requestId;
    try {
      this.assertReady();
      const normalized = this.normalizer(request, {
        appRoot: this.appRoot,
        appVersion: this.appVersion,
        electronVersion: this.electronVersion,
        runtimeStatusReader: this.runtimeStatusReader,
      });
      this.emit("validated", {
        mode: normalized.generationMode === "sub-prompt" ? "multi" : "single",
        model: normalized.model,
        variants: normalized.variants?.length || 1,
        batchSize: normalized.batchSize,
        queueCount: normalized.queueCount,
      });

      const previousGroupIds = new Set(this.queue.snapshot().jobs.map((job) => job.groupId));
      const state = this.queue.add(normalized);
      const groupId = state.jobs.find((job) => !previousGroupIds.has(job.groupId))?.groupId;
      if (!groupId) throw new GenerationApplicationError("QUEUE_GROUP_MISSING", "생성 작업 그룹을 찾을 수 없습니다.");
      this.emit("queued", { groupId, jobs: state.jobs.filter((job) => job.groupId === groupId).length });
      const completion = new Promise((resolve) => {
        this.waiters.set(groupId, { resolve });
        const current = summarizeGroup(this.queue.snapshot(), groupId);
        if (current.status !== "running") {
          this.waiters.delete(groupId);
          resolve(current);
        }
      });
      return await completion;
    } finally {
      this.activeRequestId = null;
    }
  }

  cancel() {
    return this.queue.cancelAll();
  }

  isModelLoaded() {
    return Boolean(this.executor.isModelLoaded?.());
  }

  async releaseModel() {
    if (this.activeRequestId || this.executor.isBusy?.()) {
      throw new GenerationApplicationError(
        "GENERATION_BUSY",
        "이미지 생성 작업이 실행 중이라 생성 모델을 해제할 수 없습니다.",
      );
    }
    if (typeof this.executor.releaseModel !== "function") {
      return { released: false, model: "generation" };
    }
    return this.executor.releaseModel();
  }

  async close() {
    for (const waiter of this.waiters.values()) {
      waiter.resolve({
        status: "cancelled",
        groupId: null,
        jobs: [],
        results: [],
        counts: { total: 0, completed: 0, failed: 0, cancelled: 0, images: 0 },
      });
    }
    this.waiters.clear();
    if (typeof this.executor.releaseModel === "function" && !this.executor.isBusy?.()) {
      await this.executor.releaseModel();
    } else if (typeof this.executor.shutdown === "function") {
      this.executor.shutdown();
    }
  }
}

module.exports = {
  GenerationApplication,
  GenerationApplicationError,
  publicWorkerResult,
  summarizeGroup,
};
