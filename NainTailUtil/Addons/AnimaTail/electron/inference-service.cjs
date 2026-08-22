"use strict";

const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { locateRuntime, locateSupportAssets } = require("./runtime-locator.cjs");

const DEFAULT_WORKER_START_TIMEOUT_MS = 120000;

function waitForExit(child, timeoutMs = 3000) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(finish, timeoutMs);
    timeout.unref();
    child.once("exit", finish);
  });
}

function workerEnvironment(pythonPath) {
  const runtimeRoot = path.dirname(pythonPath);
  const windowsRoot = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
  return {
    SystemRoot: windowsRoot,
    WINDIR: windowsRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    PATH: [
      runtimeRoot,
      path.join(runtimeRoot, "Lib", "site-packages", "torch", "lib"),
      path.join(windowsRoot, "System32"),
      windowsRoot,
    ].join(path.delimiter),
    PYTHONUTF8: "1",
    PYTHONUNBUFFERED: "1",
    HF_HUB_OFFLINE: "1",
    TRANSFORMERS_OFFLINE: "1",
    DIFFSYNTH_SKIP_DOWNLOAD: "true",
  };
}

class InferenceService {
  constructor(appRoot, sendEvent = () => {}, options = {}) {
    this.appRoot = path.resolve(appRoot);
    this.runtimeRoot = path.resolve(options.runtimeRoot || path.join(this.appRoot, "runtime"));
    this.runtimeManifestPath = options.runtimeManifestPath
      ? path.resolve(options.runtimeManifestPath)
      : null;
    this.outputRoot = path.resolve(options.outputRoot || path.join(this.appRoot, "outputs"));
    this.sendEvent = sendEvent;
    this.workerStartTimeoutMs = Number.isFinite(options.workerStartTimeoutMs)
      && options.workerStartTimeoutMs > 0
      ? options.workerStartTimeoutMs
      : DEFAULT_WORKER_START_TIMEOUT_MS;
    this.spawnProcess = options.spawnProcess || spawn;
    this.runtimeLocator = options.runtimeLocator || locateRuntime;
    this.supportLocator = options.supportLocator || locateSupportAssets;
    this.child = null;
    this.readyPromise = null;
    this.pending = null;
    this.modelLoaded = false;
  }

  ensureWorker() {
    if (this.child && this.readyPromise) return this.readyPromise;
    const runtime = this.runtimeLocator(this.appRoot, {
      runtimeRoot: this.runtimeRoot,
      runtimeManifestPath: this.runtimeManifestPath,
    });
    if (runtime.state !== "ready" || !runtime.pythonPath) {
      return Promise.reject(new Error("사설 Python/CUDA 런타임이 준비되지 않았습니다."));
    }
    const supportRoot = this.supportLocator(this.appRoot);
    if (!supportRoot) {
      return Promise.reject(new Error("Anima 보조 자산(VAE·텍스트 인코더·토크나이저)이 없습니다."));
    }

    const workerPath = path.join(this.appRoot, "app", "inference_worker.py");
    const child = this.spawnProcess(runtime.pythonPath, [
      "-B",
      "-u",
      workerPath,
      "--app-root",
      this.appRoot,
      "--support-root",
      supportRoot,
      "--output-root",
      this.outputRoot,
    ], {
      cwd: this.appRoot,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: workerEnvironment(runtime.pythonPath),
    });
    this.child = child;
    this.sendEvent({ event: "loading", phase: "worker-start" });

    let resolveStartup;
    let rejectStartup;
    let startupSettled = false;
    const readyPromise = new Promise((resolve, reject) => {
      resolveStartup = resolve;
      rejectStartup = reject;
    });
    this.readyPromise = readyPromise;

    const lines = readline.createInterface({ input: child.stdout });
    const resetWorker = () => {
      if (this.child !== child) return;
      this.child = null;
      this.readyPromise = null;
      this.modelLoaded = false;
    };
    const failStartup = (error, terminate = false) => {
      if (startupSettled) return;
      startupSettled = true;
      clearTimeout(timeout);
      resetWorker();
      rejectStartup(error);
      if (terminate && child.exitCode === null) child.kill();
    };
    const timeout = setTimeout(() => {
      lines.close();
      failStartup(
        new Error(`추론 워커 시작 시간이 ${Math.ceil(this.workerStartTimeoutMs / 1000)}초를 초과했습니다.`),
        true,
      );
    }, this.workerStartTimeoutMs);

    lines.on("line", (line) => {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        this.sendEvent({ type: "log", message: line });
        return;
      }
      if (event.event === "ready") {
        if (startupSettled) return;
        startupSettled = true;
        clearTimeout(timeout);
        resolveStartup(event);
        return;
      }
      this.handleWorkerEvent(event);
    });
    child.stderr.on("data", (chunk) => {
      this.sendEvent({ type: "log", message: chunk.toString("utf8").trim() });
    });
    child.once("error", (error) => {
      failStartup(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      failStartup(new Error(`추론 워커가 준비 전에 종료됐습니다. (code ${code})`));
      const pending = this.pending;
      resetWorker();
      this.pending = null;
      if (pending) pending.reject(new Error(`추론 워커가 종료됐습니다. (code ${code})`));
    });
    return readyPromise;
  }

  handleWorkerEvent(event) {
    this.sendEvent(event);
    if (event.event === "model") {
      this.modelLoaded = event.state === "loaded";
    }
    if (!this.pending || event.requestId !== this.pending.requestId) return;
    if (event.event === "complete") {
      const pending = this.pending;
      this.pending = null;
      pending.resolve(event.result);
    } else if (event.event === "error") {
      const pending = this.pending;
      this.pending = null;
      pending.reject(new Error(event.message || "이미지 생성에 실패했습니다."));
    }
  }

  async generate(payload) {
    if (this.pending) throw new Error("이미 생성 작업이 실행 중입니다.");
    await this.ensureWorker();
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      this.pending = { requestId, resolve, reject };
      this.child.stdin.write(`${JSON.stringify({ command: "generate", requestId, payload })}\n`);
    });
  }

  cancel() {
    if (!this.child || !this.pending) return false;
    const pending = this.pending;
    this.pending = null;
    this.child.kill();
    pending.reject(new Error("사용자가 생성을 취소했습니다."));
    this.sendEvent({ event: "cancelled", requestId: pending.requestId });
    return true;
  }

  isModelLoaded() {
    return Boolean(this.child && this.modelLoaded);
  }

  isBusy() {
    return Boolean(this.pending);
  }

  async releaseModel() {
    if (this.pending) throw new Error("이미지 생성 작업이 실행 중이라 생성 모델을 해제할 수 없습니다.");
    const released = this.isModelLoaded();
    const child = this.child;
    const exited = waitForExit(child);
    this.shutdown();
    await exited;
    return { released, model: "generation" };
  }

  shutdown() {
    if (this.child) this.child.kill();
    this.child = null;
    this.readyPromise = null;
    this.pending = null;
    this.modelLoaded = false;
  }
}

module.exports = {
  DEFAULT_WORKER_START_TIMEOUT_MS,
  InferenceService,
  waitForExit,
  workerEnvironment,
};
