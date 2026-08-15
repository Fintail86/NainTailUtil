"use strict";

const path = require("node:path");
const { spawn } = require("node:child_process");
const { createId } = require("./ids.cjs");
const { NainTailError } = require("./errors.cjs");
const { defaultProductRoot } = require("./paths.cjs");

const MAX_LINE_BYTES = 64 * 1024 * 1024;
const MAX_STDERR_BYTES = 1024 * 1024;

class NaiWorkerClient {
  constructor(options = {}) {
    this.productRoot = options.productRoot || defaultProductRoot();
    this.execPath = options.execPath || process.execPath;
    this.workerPath = options.workerPath || path.join(this.productRoot, "app", "workers", "nai", "worker.cjs");
    this.child = null;
    this.buffer = "";
    this.stderr = "";
    this.pending = new Map();
    this.busy = false;
  }

  ensureWorker() {
    if (this.child && !this.child.killed) return;
    const env = { ...process.env };
    if (process.versions.electron || /electron\.exe$/iu.test(this.execPath)) env.ELECTRON_RUN_AS_NODE = "1";
    this.child = spawn(this.execPath, [this.workerPath], {
      cwd: this.productRoot,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.onStdout(chunk));
    this.child.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-MAX_STDERR_BYTES);
    });
    this.child.on("exit", (code) => {
      const error = new NainTailError("WORKER_EXITED", `NAI worker가 종료되었습니다. exit=${code}`, { stderr: this.stderr.slice(-4000) });
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
      this.busy = false;
      this.child = null;
    });
  }

  onStdout(chunk) {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer, "utf8") > MAX_LINE_BYTES) {
      this.shutdown();
      return;
    }
    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const request = this.pending.get(message.id);
      if (!request) continue;
      this.pending.delete(message.id);
      if (message.type === "error") {
        request.reject(new NainTailError(message.error?.code || "WORKER_ERROR", message.error?.message || "NAI worker 오류", message.error));
      } else request.resolve(message.result);
    }
  }

  request(method, params = {}) {
    this.ensureWorker();
    const id = createId("worker-request");
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, "utf8", (error) => {
        if (!error) return;
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  async ping() {
    return this.request("ping");
  }

  async subscription(token) {
    return this.request("subscription", { token });
  }

  async generate(request, token) {
    if (this.busy) throw new NainTailError("WORKER_BUSY", "NAI worker가 이미 한 장을 생성 중입니다.");
    this.busy = true;
    try {
      return await this.request("generate", { request, token });
    } finally {
      this.busy = false;
    }
  }

  isBusy() {
    return this.busy;
  }

  shutdown() {
    if (this.child && !this.child.killed) this.child.kill();
    this.child = null;
  }
}

module.exports = { MAX_LINE_BYTES, NaiWorkerClient };

