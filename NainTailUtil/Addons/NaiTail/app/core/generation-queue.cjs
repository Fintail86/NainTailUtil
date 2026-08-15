"use strict";

const { EventEmitter } = require("node:events");
const { NainTailError, asPublicError } = require("./errors.cjs");

const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);

class GenerationQueue extends EventEmitter {
  constructor(executor) {
    super();
    if (typeof executor !== "function") throw new TypeError("executor가 필요합니다.");
    this.executor = executor;
    this.jobs = [];
    this.activeJobId = null;
    this.haltAfterActive = false;
    this.paused = false;
    this.processingPromise = null;
  }

  snapshot() {
    return {
      state: this.activeJobId ? "running" : this.paused ? "paused" : "idle",
      activeJobId: this.activeJobId,
      haltAfterActive: this.haltAfterActive,
      jobs: this.jobs.map((job) => ({
        ...job,
        task: { ...job.task, request: { ...job.task.request, settings: { ...job.task.request.settings } } },
      })),
    };
  }

  emitState(reason) {
    this.emit("state", { reason, queue: this.snapshot() });
  }

  enqueue(tasks) {
    if (!Array.isArray(tasks) || tasks.length === 0) {
      throw new NainTailError("EMPTY_QUEUE_REQUEST", "생성할 슬롯이 없습니다.");
    }
    if (this.haltAfterActive) {
      throw new NainTailError("QUEUE_STOPPING", "현재 이미지 후 중단 처리 중입니다.");
    }
    for (const task of tasks) {
      this.jobs.push({
        id: task.id,
        runId: task.runId,
        state: "pending",
        task,
        result: null,
        error: null,
        createdAt: new Date().toISOString(),
        startedAt: null,
        finishedAt: null,
      });
    }
    this.emitState("enqueued");
    this.schedule();
    return this.snapshot();
  }

  schedule() {
    if (this.processingPromise || this.paused || this.haltAfterActive) return;
    this.processingPromise = this.processLoop().finally(() => {
      this.processingPromise = null;
      if (!this.paused && !this.haltAfterActive && this.jobs.some((job) => job.state === "pending")) {
        this.schedule();
      }
    });
  }

  async processLoop() {
    while (!this.paused && !this.haltAfterActive) {
      const job = this.jobs.find((candidate) => candidate.state === "pending");
      if (!job) break;
      job.state = "in_flight";
      job.startedAt = new Date().toISOString();
      this.activeJobId = job.id;
      this.emitState("dispatched");
      try {
        job.result = await this.executor(job.task);
        job.state = "completed";
      } catch (error) {
        job.error = asPublicError(error);
        job.state = "failed";
        for (const pending of this.jobs) {
          if (pending.runId !== job.runId || pending.state !== "pending") continue;
          pending.state = "cancelled";
          pending.error = {
            code: "RUN_STOPPED_AFTER_FAILURE",
            message: "같은 생성 Run의 앞선 요청이 실패해 NAI에 전송하지 않았습니다.",
            details: { failedJobId: job.id },
          };
          pending.finishedAt = new Date().toISOString();
        }
        this.paused = true;
      } finally {
        job.finishedAt = new Date().toISOString();
        this.activeJobId = null;
        this.emitState(job.state);
      }
    }

    if (this.haltAfterActive) {
      this.haltAfterActive = false;
      this.emitState("stopped-after-current");
    } else if (!this.paused) {
      this.emitState("idle");
    }
  }

  cancelPending(reason = "queue-cleared") {
    let count = 0;
    for (const job of this.jobs) {
      if (job.state !== "pending") continue;
      job.state = "cancelled";
      job.error = { code: "CANCELLED", message: "NAI에 전송되기 전에 취소되었습니다.", details: { reason } };
      job.finishedAt = new Date().toISOString();
      count += 1;
    }
    if (this.activeJobId) this.haltAfterActive = true;
    this.emitState(reason);
    return { cancelled: count, activeContinues: Boolean(this.activeJobId), queue: this.snapshot() };
  }

  clearQueue() {
    return this.cancelPending("queue-cleared");
  }

  stopAfterCurrent() {
    return this.cancelPending("stop-requested");
  }

  cancelRun(runId) {
    const jobs = this.jobs.filter((job) => job.runId === runId);
    if (!jobs.length) throw new NainTailError("RUN_NOT_FOUND", `생성 Run을 찾을 수 없습니다: ${runId}`);
    if (jobs.every((job) => TERMINAL_STATES.has(job.state))) {
      throw new NainTailError("RUN_ALREADY_FINISHED", `이미 종료된 생성 Run입니다: ${runId}`);
    }
    let cancelled = 0;
    for (const job of jobs) {
      if (job.state !== "pending") continue;
      job.state = "cancelled";
      job.error = { code: "CANCELLED", message: "MCP 작업 취소로 NAI에 전송하지 않았습니다.", details: { reason: "run-cancelled" } };
      job.finishedAt = new Date().toISOString();
      cancelled += 1;
    }
    const activeContinues = jobs.some((job) => job.id === this.activeJobId);
    if (activeContinues) this.haltAfterActive = true;
    this.emitState("run-cancelled");
    return { runId, cancelled, activeContinues, queue: this.snapshot() };
  }

  resume() {
    if (this.activeJobId) return this.snapshot();
    this.paused = false;
    this.emitState("resumed");
    this.schedule();
    return this.snapshot();
  }

  waitForRun(runId) {
    const summarize = () => {
      const jobs = this.jobs.filter((job) => job.runId === runId);
      if (jobs.length === 0 || !jobs.every((job) => TERMINAL_STATES.has(job.state))) return null;
      const completed = jobs.filter((job) => job.state === "completed");
      const failed = jobs.filter((job) => job.state === "failed");
      const cancelled = jobs.filter((job) => job.state === "cancelled");
      return {
        runId,
        status: failed.length ? (completed.length ? "partial" : "failed")
          : cancelled.length ? (completed.length ? "partial" : "cancelled")
            : "completed",
        jobs,
      };
    };
    const current = summarize();
    if (current) return Promise.resolve(current);
    return new Promise((resolve) => {
      const listener = () => {
        const summary = summarize();
        if (!summary) return;
        this.off("state", listener);
        resolve(summary);
      };
      this.on("state", listener);
    });
  }
}

module.exports = { GenerationQueue, TERMINAL_STATES };
