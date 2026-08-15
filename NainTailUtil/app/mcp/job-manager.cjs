"use strict";

const { NainTailError } = require("../core/errors.cjs");
const { McpCostGate } = require("./cost-gate.cjs");

const TERMINAL_STATES = new Set(["completed", "partial", "failed", "cancelled"]);
const DEFAULT_WAIT_MS = 30_000;
const MAX_WAIT_MS = 60_000;
const WAIT_PER_IMAGE_MS = 5_000;

function jobState(jobs) {
  if (jobs.some((job) => job.state === "in_flight")) return "running";
  if (jobs.some((job) => job.state === "pending")) return "queued";
  const completed = jobs.filter((job) => job.state === "completed").length;
  const failed = jobs.filter((job) => job.state === "failed").length;
  const cancelled = jobs.filter((job) => job.state === "cancelled").length;
  if (failed) return completed ? "partial" : "failed";
  if (cancelled) return completed ? "partial" : "cancelled";
  return "completed";
}

function outputView(result) {
  if (!result) return null;
  return {
    absolutePath: result.absolutePath,
    relativePath: String(result.relativePath || "").replace(/\\/gu, "/"),
    seed: result.seed,
    width: result.width,
    height: result.height,
    model: result.model,
    ordinal: result.source?.slotIndex || 1,
    slotId: result.source?.slotId || null,
    slotName: result.source?.slotName || null,
    characterId: result.source?.characterId || null,
    characterName: result.source?.characterName || null,
  };
}

class McpJobManager {
  constructor(app, options = {}) {
    this.app = app;
    this.costGate = options.costGate || new McpCostGate(app, options);
    this.maxActive = options.maxActive || 20;
    this.maxHistory = options.maxHistory || 100;
    this.defaultWaitMs = options.defaultWaitMs || DEFAULT_WAIT_MS;
    this.maxWaitMs = options.maxWaitMs || MAX_WAIT_MS;
    this.waitPerImageMs = options.waitPerImageMs || WAIT_PER_IMAGE_MS;
    this.records = new Map();
  }

  activeCount() {
    return [...this.records.values()].filter((record) => !TERMINAL_STATES.has(this.publicJob(record.id, false).status)).length;
  }

  prune() {
    if (this.records.size < this.maxHistory) return;
    for (const record of [...this.records.values()].sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))) {
      if (!TERMINAL_STATES.has(this.publicJob(record.id, false).status)) continue;
      this.records.delete(record.id);
      if (this.records.size < this.maxHistory) return;
    }
  }

  runJobs(jobId) {
    const jobs = this.app.queue.snapshot().jobs.filter((job) => job.runId === jobId);
    if (!jobs.length) throw new NainTailError("MCP_JOB_NOT_FOUND", `MCP 작업을 찾을 수 없습니다: ${jobId}`);
    return jobs;
  }

  publicJob(jobId, includeTerminal = true) {
    const record = this.records.get(jobId);
    if (!record) throw new NainTailError("MCP_JOB_NOT_FOUND", `MCP 작업을 찾을 수 없습니다: ${jobId}`);
    const jobs = this.runJobs(jobId);
    const status = jobState(jobs);
    const completed = jobs.filter((job) => job.state === "completed");
    const failed = jobs.filter((job) => job.state === "failed");
    const cancelled = jobs.filter((job) => job.state === "cancelled");
    const response = {
      jobId,
      mode: record.mode,
      status,
      queuedAt: record.queuedAt,
      startedAt: jobs.find((job) => job.startedAt)?.startedAt || null,
      finishedAt: TERMINAL_STATES.has(status) ? jobs.map((job) => job.finishedAt).filter(Boolean).sort().at(-1) || null : null,
      progress: {
        completed: completed.length,
        total: jobs.length,
        failed: failed.length,
        cancelled: cancelled.length,
        activeOrdinal: Math.max(0, jobs.findIndex((job) => job.state === "in_flight") + 1) || null,
      },
      estimatedAnlas: record.estimate.totalCost,
    };
    if (!includeTerminal || !TERMINAL_STATES.has(status)) return response;
    return {
      ...response,
      outputs: completed.map((job) => outputView(job.result)).filter(Boolean),
      errors: failed.map((job) => ({ jobId: job.id, code: job.error?.code || "GENERATION_FAILED", message: job.error?.message || "생성에 실패했습니다." })),
    };
  }

  list() {
    return [...this.records.values()].reverse().map((record) => this.publicJob(record.id, false));
  }

  async submit(mode, request, options = {}) {
    if (this.activeCount() >= this.maxActive) throw new NainTailError("MCP_QUEUE_FULL", `MCP 활성 작업은 최대 ${this.maxActive}개입니다.`);
    const estimate = await this.costGate.authorize(mode, request, options);
    let queued;
    if (mode === "single") queued = await this.app.enqueueSingle(request);
    else if (mode === "multi") queued = await this.app.enqueueMulti(request);
    else if (mode === "artist-study") queued = await this.app.enqueueArtistStudy(request || this.app.getArtistStudy());
    else if (mode === "project") queued = await this.app.enqueueProject(options.projectId, { scope: options.scope || "all", characterId: options.characterId });
    else throw new NainTailError("MCP_MODE_INVALID", `지원하지 않는 MCP 생성 모드입니다: ${mode}`);
    this.prune();
    const record = { id: queued.runId, mode, queuedAt: new Date().toISOString(), estimate };
    this.records.set(record.id, record);
    return { ...this.publicJob(record.id, false), estimate };
  }

  get(jobId) {
    return this.publicJob(jobId, true);
  }

  async wait(jobId, timeoutSeconds) {
    const current = this.publicJob(jobId, true);
    if (TERMINAL_STATES.has(current.status)) return { ...current, wait: { timedOut: false, timeoutMs: 0 } };
    const timeoutMs = timeoutSeconds === undefined
      ? Math.min(this.maxWaitMs, Math.max(this.defaultWaitMs, current.progress.total * this.waitPerImageMs))
      : Math.max(1_000, Math.min(this.maxWaitMs, Math.trunc(Number(timeoutSeconds) * 1000)));
    const timedOut = await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.app.queue.off("state", onState);
        resolve(value);
      };
      const onState = () => {
        const status = this.publicJob(jobId, false).status;
        if (TERMINAL_STATES.has(status)) finish(false);
      };
      const timer = setTimeout(() => finish(true), timeoutMs);
      this.app.queue.on("state", onState);
      onState();
    });
    const latest = this.publicJob(jobId, !timedOut);
    return { ...latest, wait: { timedOut, timeoutMs } };
  }

  cancel(jobId) {
    this.publicJob(jobId, false);
    const cancelled = this.app.cancelRun(jobId);
    return { jobId, cancelled: cancelled.cancelled, activeContinues: cancelled.activeContinues, job: this.publicJob(jobId, true) };
  }
}

module.exports = { DEFAULT_WAIT_MS, MAX_WAIT_MS, McpJobManager, TERMINAL_STATES, WAIT_PER_IMAGE_MS, jobState, outputView };
