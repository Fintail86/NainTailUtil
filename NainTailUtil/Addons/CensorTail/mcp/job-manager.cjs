"use strict";

const { EventEmitter } = require("node:events");
const { randomUUID } = require("node:crypto");
const { CensorMcpError } = require("./errors.cjs");

const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);
const DEFAULT_WAIT_MS = 30_000;
const MAX_WAIT_MS = 60_000;

function detectionCounts(detections) {
  const byLabel = {};
  for (const detection of Array.isArray(detections) ? detections : []) {
    if (detection.enabled === false) continue;
    const label = String(detection.label || "unknown");
    byLabel[label] = (byLabel[label] || 0) + 1;
  }
  return byLabel;
}

function publicDetection(detection) {
  const { mask, ...plain } = detection || {};
  return {
    ...plain,
    mask: mask && typeof mask === "object" ? {
      encoding: mask.encoding,
      width: mask.width,
      height: mask.height,
      box: mask.box || null,
      embedded: false,
    } : null,
  };
}

class CensorMcpJobManager {
  constructor(service, options = {}) {
    this.service = service;
    this.maxActive = Number(options.maxActive) || 20;
    this.maxHistory = Number(options.maxHistory) || 100;
    this.defaultWaitMs = Number(options.defaultWaitMs) || DEFAULT_WAIT_MS;
    this.maxWaitMs = Number(options.maxWaitMs) || MAX_WAIT_MS;
    this.records = new Map();
    this.pending = [];
    this.activeId = null;
    this.events = new EventEmitter();
    this.closed = false;
  }

  activeCount() {
    return [...this.records.values()].filter((record) => !TERMINAL_STATES.has(record.status)).length;
  }

  queueStatus() {
    return {
      state: this.activeId ? "running" : this.pending.length ? "queued" : "idle",
      activeJobId: this.activeId,
      pending: this.pending.length,
      active: this.activeCount(),
      history: this.records.size,
      capacity: this.maxActive,
    };
  }

  requireJob(jobId) {
    const record = this.records.get(String(jobId || ""));
    if (!record) throw new CensorMcpError("CENSOR_JOB_NOT_FOUND", `CensorTail 작업을 찾을 수 없습니다: ${jobId}`);
    return record;
  }

  prune() {
    if (this.records.size < this.maxHistory) return;
    for (const record of [...this.records.values()]) {
      if (!TERMINAL_STATES.has(record.status)) continue;
      this.records.delete(record.id);
      if (this.records.size < this.maxHistory) break;
    }
  }

  create(type, request) {
    if (this.closed) throw new CensorMcpError("CENSOR_MANAGER_CLOSED", "CensorTail MCP 작업 관리자가 종료되었습니다.");
    if (this.activeCount() >= this.maxActive) {
      throw new CensorMcpError("CENSOR_QUEUE_FULL", `활성 검열 작업은 최대 ${this.maxActive}개입니다.`, { retryable: true });
    }
    this.prune();
    const record = {
      id: randomUUID(),
      type,
      status: "queued",
      queuedAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      progress: { completed: 0, total: type === "scan" ? request.ids.length : request.imageIds.length },
      request,
      result: null,
      error: null,
    };
    this.records.set(record.id, record);
    this.pending.push(record.id);
    queueMicrotask(() => void this.pump());
    return this.publicJob(record, false);
  }

  submitScan(request) {
    return this.create("scan", request);
  }

  submitSave(request) {
    const scan = this.requireJob(request.scanJobId);
    if (scan.type !== "scan" || scan.status !== "completed" || !scan.result) {
      throw new CensorMcpError("CENSOR_SCAN_NOT_READY", "완료된 scanJobId가 필요합니다.", { retryable: scan.status !== "failed" });
    }
    const available = new Set(scan.result.images.map((image) => image.id));
    const imageIds = Array.isArray(request.imageIds) && request.imageIds.length
      ? [...new Set(request.imageIds.map(String))]
      : [...available];
    if (imageIds.some((id) => !available.has(id))) {
      throw new CensorMcpError("CENSOR_IMAGE_NOT_FOUND", "scan 결과에 없는 imageId가 포함됐습니다.");
    }
    return this.create("save", { ...request, imageIds });
  }

  handleEvent(event) {
    if (event?.event !== "progress" || !this.activeId) return;
    const record = this.records.get(this.activeId);
    if (!record) return;
    const total = Math.max(record.progress.total, Number(event.total) || 0);
    record.progress = { completed: Math.min(total, Number(event.index) || 0), total };
    this.events.emit("change", record.id);
  }

  async pump() {
    if (this.closed || this.activeId || !this.pending.length) return;
    const jobId = this.pending.shift();
    const record = this.records.get(jobId);
    if (!record || record.status !== "queued") return void this.pump();
    this.activeId = record.id;
    record.status = "running";
    record.startedAt = new Date().toISOString();
    this.events.emit("change", record.id);
    try {
      record.result = record.type === "scan"
        ? await this.service.scan(record.request)
        : await this.runSave(record.request);
      record.status = "completed";
      record.progress = { completed: record.progress.total, total: record.progress.total };
    } catch (error) {
      record.status = "failed";
      record.error = {
        code: error?.code || "CENSOR_JOB_FAILED",
        message: error?.message || String(error),
        retryable: error?.retryable === true,
      };
    } finally {
      record.finishedAt = new Date().toISOString();
      this.activeId = null;
      this.events.emit("change", record.id);
      queueMicrotask(() => void this.pump());
    }
  }

  async runSave(request) {
    const scan = this.requireJob(request.scanJobId);
    const selected = new Set(request.imageIds);
    const disabled = new Set((request.disabledDetectionIds || []).map(String));
    const records = scan.result.images
      .filter((image) => selected.has(image.id))
      .map((image) => ({
        id: image.id,
        detections: image.detections.map((detection) => ({
          ...detection,
          enabled: detection.enabled !== false && !disabled.has(String(detection.id)),
        })),
      }))
      .filter((image) => request.includeNoDetections === true || image.detections.some((detection) => detection.enabled !== false));
    if (!records.length) {
      throw new CensorMcpError("CENSOR_NO_DETECTIONS", "저장할 활성 검열 영역이 없습니다.");
    }
    const saved = await this.service.save({ records, options: request.options });
    return {
      ...saved,
      images: saved.images.map((output) => {
        const source = scan.result.images.find((image) => image.id === output.id);
        return { ...output, width: source?.width || null, height: source?.height || null };
      }),
    };
  }

  publicJob(recordOrId, includeTerminal = true) {
    const record = typeof recordOrId === "string" ? this.requireJob(recordOrId) : recordOrId;
    const result = {
      jobId: record.id,
      type: record.type,
      status: record.status,
      queuedAt: record.queuedAt,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      progress: { ...record.progress },
    };
    if (!includeTerminal || !TERMINAL_STATES.has(record.status)) return result;
    if (record.error) result.error = { ...record.error };
    if (record.status !== "completed" || !record.result) return result;
    if (record.type === "scan") {
      result.images = record.result.images.map((image) => ({
        imageId: image.id,
        width: image.width,
        height: image.height,
        detectionCount: Array.isArray(image.detections) ? image.detections.filter((item) => item.enabled !== false).length : 0,
        detectionsByLabel: detectionCounts(image.detections),
        inferenceSeconds: image.inferenceSeconds,
        provider: image.provider,
      }));
    } else {
      result.outputs = record.result.images.map((image) => ({
        imageId: image.id,
        absolutePath: image.path,
        fileName: image.fileName,
        relativePath: image.relativePath,
        width: image.width,
        height: image.height,
        detectionCount: image.detections,
      }));
    }
    return result;
  }

  list(activeOnly = false) {
    return [...this.records.values()].reverse()
      .filter((record) => !activeOnly || !TERMINAL_STATES.has(record.status))
      .map((record) => this.publicJob(record, false));
  }

  get(jobId) {
    return this.publicJob(jobId, true);
  }

  resultGet(jobId, imageId) {
    const record = this.requireJob(jobId);
    if (record.type !== "scan" || record.status !== "completed" || !record.result) {
      throw new CensorMcpError("CENSOR_SCAN_NOT_READY", "완료된 scan 작업 결과가 필요합니다.", { retryable: record.status !== "failed" });
    }
    const image = record.result.images.find((item) => item.id === String(imageId || ""));
    if (!image) throw new CensorMcpError("CENSOR_IMAGE_NOT_FOUND", `검출 결과 이미지를 찾을 수 없습니다: ${imageId}`);
    return {
      jobId: record.id,
      imageId: image.id,
      width: image.width,
      height: image.height,
      inferenceSeconds: image.inferenceSeconds,
      provider: image.provider,
      detections: image.detections.map(publicDetection),
    };
  }

  async wait(jobId, timeoutSeconds) {
    const current = this.requireJob(jobId);
    if (TERMINAL_STATES.has(current.status)) return { ...this.publicJob(current, true), wait: { timedOut: false, timeoutMs: 0 } };
    const timeoutMs = timeoutSeconds === undefined
      ? this.defaultWaitMs
      : Math.max(1_000, Math.min(this.maxWaitMs, Math.trunc(Number(timeoutSeconds) * 1000)));
    const timedOut = await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.events.off("change", onChange);
        resolve(value);
      };
      const onChange = (changedId) => {
        if (changedId === current.id && TERMINAL_STATES.has(current.status)) finish(false);
      };
      const timer = setTimeout(() => finish(true), timeoutMs);
      this.events.on("change", onChange);
      onChange(current.id);
    });
    return {
      ...this.publicJob(current, !timedOut),
      wait: { timedOut, timeoutMs },
    };
  }

  cancel(jobId) {
    const record = this.requireJob(jobId);
    if (record.status === "queued") {
      this.pending = this.pending.filter((id) => id !== record.id);
      record.status = "cancelled";
      record.finishedAt = new Date().toISOString();
      this.events.emit("change", record.id);
      return { jobId: record.id, cancelled: true, activeContinues: false, job: this.publicJob(record, true) };
    }
    if (record.status === "running") {
      return { jobId: record.id, cancelled: false, activeContinues: true, job: this.publicJob(record, false) };
    }
    return { jobId: record.id, cancelled: false, activeContinues: false, job: this.publicJob(record, true) };
  }

  async releaseModel() {
    if (this.activeCount() || this.service.isBusy()) {
      throw new CensorMcpError("CENSOR_MODEL_BUSY", "검열 작업이 대기 또는 실행 중이라 모델을 해제할 수 없습니다.", { retryable: true });
    }
    return this.service.releaseModel();
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const jobId of this.pending.splice(0)) {
      const record = this.records.get(jobId);
      if (record?.status === "queued") {
        record.status = "cancelled";
        record.finishedAt = new Date().toISOString();
      }
    }
    this.events.removeAllListeners();
    this.service.shutdown();
  }
}

module.exports = {
  CensorMcpJobManager,
  DEFAULT_WAIT_MS,
  MAX_WAIT_MS,
  TERMINAL_STATES,
  detectionCounts,
  publicDetection,
};
