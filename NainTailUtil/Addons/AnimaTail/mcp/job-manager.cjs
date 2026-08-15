"use strict";

const { randomUUID } = require("node:crypto");
const { GenerationApplication } = require("../electron/generation-application.cjs");
const { expectedGenerationImageCount } = require("../electron/generation-count.cjs");
const { resolveGenerationConfig } = require("../cli/generation-config.cjs");
const {
  publicJob,
  publicJobSummary,
  publicResult,
} = require("./job-public-view.cjs");

const TERMINAL_STATES = new Set(["completed", "partial", "failed", "cancelled"]);
const DEFAULT_WAIT_MS = 30_000;
const WAIT_PER_IMAGE_MS = 5_000;
const MAX_WAIT_MS = 60_000;

class McpJobError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "McpJobError";
    this.code = code;
  }
}

function isoNow(now) {
  return now().toISOString();
}

function recommendedWaitMs(request) {
  return Math.min(
    MAX_WAIT_MS,
    Math.max(DEFAULT_WAIT_MS, expectedGenerationImageCount(request) * WAIT_PER_IMAGE_MS),
  );
}

class McpGenerationJobManager {
  constructor(options) {
    this.appRoot = options.appRoot;
    this.appVersion = options.appVersion || "0.0.0";
    this.electronVersion = options.electronVersion || process.versions.electron || null;
    this.now = options.now || (() => new Date());
    this.maxJobs = options.maxJobs || 100;
    this.maxPending = options.maxPending || 20;
    this.log = options.log || ((message) => process.stderr.write(`[AnimaTail worker] ${message}\n`));
    this.jobs = new Map();
    this.pending = [];
    this.terminalWaiters = new Map();
    this.running = false;
    this.closed = false;
    const applicationFactory = options.applicationFactory || ((applicationOptions) => (
      new GenerationApplication(applicationOptions)
    ));
    this.application = applicationFactory({
      appRoot: this.appRoot,
      appVersion: this.appVersion,
      electronVersion: this.electronVersion,
      onEvent: (event) => this.handleApplicationEvent(event),
    });
  }

  activeCount() {
    return [...this.jobs.values()].filter((job) => !TERMINAL_STATES.has(job.status)).length;
  }

  prune() {
    if (this.jobs.size < this.maxJobs) return;
    const terminal = [...this.jobs.values()]
      .filter((job) => TERMINAL_STATES.has(job.status))
      .sort((left, right) => String(left.finishedAt).localeCompare(String(right.finishedAt)));
    while (this.jobs.size >= this.maxJobs && terminal.length > 0) {
      this.jobs.delete(terminal.shift().id);
    }
  }

  submit(mode, rawConfig) {
    if (this.closed) throw new McpJobError("MCP_SERVER_CLOSED", "MCP 생성 서버가 종료 중입니다.");
    if (!['single', 'multi'].includes(mode)) {
      throw new McpJobError("MCP_MODE_INVALID", `지원하지 않는 생성 모드입니다: ${mode}`);
    }
    if (this.activeCount() >= this.maxPending) {
      throw new McpJobError("MCP_QUEUE_FULL", `MCP 작업 대기열은 최대 ${this.maxPending}개입니다.`);
    }
    const config = {
      ...rawConfig,
      schemaVersion: 1,
      mode,
    };
    const resolved = resolveGenerationConfig(this.appRoot, config, mode);
    const id = resolved.requestId || randomUUID();
    if (this.jobs.has(id)) {
      throw new McpJobError("MCP_JOB_ID_DUPLICATED", `이미 존재하는 requestId입니다: ${id}`);
    }
    this.prune();
    if (this.jobs.size >= this.maxJobs) {
      throw new McpJobError("MCP_JOB_HISTORY_FULL", "완료되지 않은 MCP 작업이 너무 많습니다.");
    }
    const job = {
      id,
      mode,
      request: resolved.request,
      status: "queued",
      queuedAt: isoNow(this.now),
      startedAt: null,
      finishedAt: null,
      progress: { event: "queued" },
      result: null,
      error: null,
    };
    this.jobs.set(id, job);
    this.pending.push(id);
    queueMicrotask(() => void this.drain());
    return publicJob(job);
  }

  get(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) throw new McpJobError("MCP_JOB_NOT_FOUND", `작업을 찾을 수 없습니다: ${jobId}`);
    return publicJob(job);
  }

  wait(jobId, timeoutMs) {
    const job = this.jobs.get(jobId);
    if (!job) throw new McpJobError("MCP_JOB_NOT_FOUND", `작업을 찾을 수 없습니다: ${jobId}`);
    const automatic = timeoutMs === undefined || timeoutMs === null;
    const normalizedTimeoutMs = automatic
      ? recommendedWaitMs(job.request)
      : Math.max(1, Math.min(MAX_WAIT_MS, Number(timeoutMs) || DEFAULT_WAIT_MS));
    const waitPolicy = {
      automatic,
      expectedImages: expectedGenerationImageCount(job.request),
    };
    if (TERMINAL_STATES.has(job.status)) {
      return Promise.resolve({
        ...publicJob(job),
        wait: { timedOut: false, timeoutMs: 0, ...waitPolicy },
      });
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (timedOut) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const waiters = this.terminalWaiters.get(jobId);
        waiters?.delete(onTerminal);
        if (waiters?.size === 0) this.terminalWaiters.delete(jobId);
        const current = this.jobs.get(jobId) || job;
        resolve({
          ...(timedOut ? publicJobSummary(current) : publicJob(current)),
          wait: { timedOut, timeoutMs: normalizedTimeoutMs, ...waitPolicy },
        });
      };
      const onTerminal = () => finish(false);
      const timer = setTimeout(() => finish(true), normalizedTimeoutMs);
      const waiters = this.terminalWaiters.get(jobId) || new Set();
      waiters.add(onTerminal);
      this.terminalWaiters.set(jobId, waiters);
    });
  }

  notifyTerminal(jobId) {
    const waiters = this.terminalWaiters.get(jobId);
    if (!waiters) return;
    this.terminalWaiters.delete(jobId);
    for (const notify of waiters) notify();
  }

  finishJob(job, { status, result, error, progress = { event: status } }) {
    if (!TERMINAL_STATES.has(status)) {
      throw new McpJobError("MCP_JOB_STATUS_INVALID", `종료 상태가 아닙니다: ${status}`);
    }
    job.status = status;
    if (result !== undefined) job.result = result;
    if (error !== undefined) job.error = error;
    job.finishedAt = isoNow(this.now);
    job.progress = progress;
    this.notifyTerminal(job.id);
    return publicJob(job);
  }

  queueStatus() {
    const running = [...this.jobs.values()].find((job) => job.status === "running") || null;
    const queueDepth = this.pending.filter((id) => this.jobs.get(id)?.status === "queued").length;
    const activeCount = this.activeCount();
    return {
      activeJob: running ? {
        jobId: running.id,
        mode: running.mode,
        status: running.status,
        startedAt: running.startedAt,
        progress: running.progress,
      } : null,
      queueDepth,
      activeCount,
      capacity: this.maxPending,
      acceptingJobs: !this.closed && activeCount < this.maxPending,
      modelLoaded: Boolean(this.application.isModelLoaded?.()),
    };
  }

  async releaseModel() {
    if (this.closed) throw new McpJobError("MCP_SERVER_CLOSED", "MCP 생성 서버가 종료 중입니다.");
    if (this.activeCount() > 0 || this.pending.length > 0) {
      throw new McpJobError(
        "MCP_MODEL_BUSY",
        "대기 중이거나 실행 중인 MCP 생성 작업이 있어 모델을 해제할 수 없습니다.",
      );
    }
    const result = typeof this.application.releaseModel === "function"
      ? await this.application.releaseModel()
      : { released: false, model: "generation" };
    return {
      ...result,
      serverReady: !this.closed,
      queue: this.queueStatus(),
    };
  }

  cancel(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) throw new McpJobError("MCP_JOB_NOT_FOUND", `작업을 찾을 수 없습니다: ${jobId}`);
    if (TERMINAL_STATES.has(job.status)) {
      throw new McpJobError("MCP_JOB_ALREADY_FINISHED", `이미 종료된 작업입니다: ${jobId}`);
    }
    if (job.status === "queued") {
      this.pending = this.pending.filter((id) => id !== jobId);
      return this.finishJob(job, { status: "cancelled" });
    }
    if (job.progress?.event !== "cancelling") {
      job.progress = { ...job.progress, event: "cancelling" };
      this.application.cancel?.();
    }
    return publicJob(job);
  }

  handleApplicationEvent(event) {
    if (event?.event === "log") {
      if (event.data?.message) this.log(event.data.message);
      return;
    }
    this.handleEvent(event);
  }

  handleEvent({ event, requestId, data }) {
    const job = this.jobs.get(requestId);
    if (!job) return;
    job.progress = {
      event,
      ...(data?.phase ? { phase: data.phase } : {}),
      ...(Number.isInteger(data?.imageIndex) ? { imageIndex: data.imageIndex } : {}),
      ...(Number.isInteger(data?.totalImages) ? { totalImages: data.totalImages } : {}),
      ...(Number.isInteger(data?.step) ? { step: data.step } : {}),
      ...(Number.isInteger(data?.totalSteps) ? { totalSteps: data.totalSteps } : {}),
      ...(data?.result?.relativePath ? { latestImage: data.result.relativePath } : {}),
    };
  }

  async drain() {
    if (this.running || this.closed) return;
    this.running = true;
    try {
      while (!this.closed && this.pending.length > 0) {
        const id = this.pending.shift();
        const job = this.jobs.get(id);
        if (!job || job.status !== "queued") continue;
        job.status = "running";
        job.startedAt = isoNow(this.now);
        job.progress = { event: "starting" };
        try {
          const result = await this.application.run(job.request, job.id);
          this.finishJob(job, {
            status: result.status,
            result: publicResult(this.appRoot, result),
          });
        } catch (error) {
          this.finishJob(job, {
            status: "failed",
            error: {
              code: error?.code || "MCP_GENERATION_FAILED",
              message: error?.message || String(error),
            },
          });
        }
      }
    } finally {
      this.running = false;
      if (!this.closed && this.pending.length > 0) queueMicrotask(() => void this.drain());
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const id of this.pending.splice(0)) {
      const job = this.jobs.get(id);
      if (!job || job.status !== "queued") continue;
      this.finishJob(job, { status: "cancelled" });
    }
    this.application.cancel?.();
    await this.application.close?.();
  }
}

module.exports = {
  McpGenerationJobManager,
  McpJobError,
  recommendedWaitMs,
};
