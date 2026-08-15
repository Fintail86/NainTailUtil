"use strict";

const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { locateRuntime, locateSupportAssets } = require("./runtime-locator.cjs");

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
  constructor(appRoot, sendEvent = () => {}) {
    this.appRoot = appRoot;
    this.sendEvent = sendEvent;
    this.child = null;
    this.readyPromise = null;
    this.pending = null;
    this.modelLoaded = false;
  }

  ensureWorker() {
    if (this.child && this.readyPromise) return this.readyPromise;
    const runtime = locateRuntime(this.appRoot);
    if (runtime.state !== "ready" || !runtime.pythonPath) {
      return Promise.reject(new Error("사설 Python/CUDA 런타임이 준비되지 않았습니다."));
    }
    const supportRoot = locateSupportAssets(this.appRoot);
    if (!supportRoot) {
      return Promise.reject(new Error("Anima 보조 자산(VAE·텍스트 인코더·토크나이저)이 없습니다."));
    }

    const workerPath = path.join(this.appRoot, "app", "inference_worker.py");
    this.child = spawn(runtime.pythonPath, [
      "-u",
      workerPath,
      "--app-root",
      this.appRoot,
      "--support-root",
      supportRoot,
    ], {
      cwd: this.appRoot,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: workerEnvironment(runtime.pythonPath),
    });

    this.readyPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("추론 워커 시작 시간이 초과됐습니다.")), 30000);
      const lines = readline.createInterface({ input: this.child.stdout });
      lines.on("line", (line) => {
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          this.sendEvent({ type: "log", message: line });
          return;
        }
        if (event.event === "ready") {
          clearTimeout(timeout);
          resolve(event);
          return;
        }
        this.handleWorkerEvent(event);
      });
      this.child.stderr.on("data", (chunk) => {
        this.sendEvent({ type: "log", message: chunk.toString("utf8").trim() });
      });
      this.child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      this.child.once("exit", (code) => {
        clearTimeout(timeout);
        const pending = this.pending;
        this.child = null;
        this.readyPromise = null;
        this.pending = null;
        this.modelLoaded = false;
        if (pending) pending.reject(new Error(`추론 워커가 종료됐습니다. (code ${code})`));
      });
    });
    return this.readyPromise;
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

module.exports = { InferenceService, waitForExit, workerEnvironment };
