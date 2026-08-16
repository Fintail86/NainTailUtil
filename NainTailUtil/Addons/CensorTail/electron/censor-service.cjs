"use strict";

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");
const { createHash, randomUUID } = require("node:crypto");
const { locateRuntime } = require("./runtime-locator.cjs");

const CENSOR_MODEL = Object.freeze({
  id: "anime-nsfw-segm-yolo26-xl",
  name: "Anime NSFW YOLO26 XL",
  fileName: "nsfw-anime-xl-x1280.onnx",
  revision: "1697d5d1827b6a818b350b44bf3ec27f08837a2a",
  url: "https://huggingface.co/01miku/anime-nsfw-segm-yolo26/resolve/1697d5d1827b6a818b350b44bf3ec27f08837a2a/nsfw-anime-xl-x1280.onnx",
  bytes: 126350117,
  sha256: "92046f77852b3e3d3a3ddf74575dd9d11f79f832af8d2d3e7eac186ba379194a",
  repository: "01miku/anime-nsfw-segm-yolo26",
  repositoryLicense: "MIT",
  embeddedLicense: "AGPL-3.0",
  classes: ["anus", "nipple", "penis", "vagina", "female face", "male face", "pubic hair"],
});

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const CENSOR_BATCH_SIZE = 200;
const CENSOR_TARGET_CLASSES = Object.freeze(["anus", "nipple", "penis", "vagina", "pubic hair"]);

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

function normalizeOutputRelativePath(value) {
  if (typeof value !== "string" || value.trim().length === 0 || path.isAbsolute(value)) return null;
  const normalized = path.normalize(value);
  const parts = normalized.split(path.sep).filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === ".." || part === ".")) return null;
  return parts.join(path.sep);
}

function collectCensorInputFiles(inputPaths, maximum = Number.POSITIVE_INFINITY) {
  const results = [];
  const seen = new Set();
  const limit = Number.isFinite(maximum) && maximum >= 0
    ? Math.floor(maximum)
    : Number.POSITIVE_INFINITY;

  const addFile = (absolutePath, outputRelativePath = null) => {
    if (results.length >= limit) return;
    const extension = path.extname(absolutePath).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension)) return;
    const key = absolutePath.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    results.push({
      absolutePath,
      outputRelativePath: normalizeOutputRelativePath(outputRelativePath),
    });
  };

  const walkDirectory = (rootPath, currentPath, rootName) => {
    if (results.length >= limit) return;
    let entries;
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= limit) break;
      if (entry.isSymbolicLink()) continue;
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walkDirectory(rootPath, absolutePath, rootName);
      } else if (entry.isFile()) {
        addFile(absolutePath, path.join(rootName, path.relative(rootPath, absolutePath)));
      }
    }
  };

  for (const inputPath of Array.isArray(inputPaths) ? inputPaths : []) {
    if (results.length >= limit) break;
    if (typeof inputPath !== "string" || !path.isAbsolute(inputPath)) continue;
    const absolutePath = path.resolve(inputPath);
    let stat;
    try {
      stat = fs.lstatSync(absolutePath);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    if (stat.isFile()) {
      addFile(absolutePath);
    } else if (stat.isDirectory()) {
      walkDirectory(absolutePath, absolutePath, path.basename(absolutePath));
    }
  }
  return results;
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
  };
}

function fileMatchesModel(filePath) {
  try {
    return fs.statSync(filePath).size === CENSOR_MODEL.bytes;
  } catch {
    return false;
  }
}

async function verifyModelFile(filePath) {
  if (!fileMatchesModel(filePath)) return false;
  const hash = createHash("sha256");
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex") === CENSOR_MODEL.sha256));
  });
}

function sanitizeBox(box) {
  const number = (value) => Number(value);
  const result = {
    id: typeof box?.id === "string" && box.id.length <= 100 ? box.id : randomUUID(),
    classId: Number.isInteger(number(box?.classId)) ? number(box.classId) : 0,
    label: typeof box?.label === "string" ? box.label.slice(0, 40) : CENSOR_MODEL.classes[0],
    confidence: Number.isFinite(number(box?.confidence)) ? number(box.confidence) : 1,
    x: number(box?.x),
    y: number(box?.y),
    width: number(box?.width),
    height: number(box?.height),
    rotation: 0,
    enabled: box?.enabled !== false,
    manual: Boolean(box?.manual),
    mask: null,
    sourceBox: null,
    effectOverride: null,
  };
  if (![result.x, result.y, result.width, result.height].every(Number.isFinite)) {
    throw new Error("검열 박스 좌표가 잘못됐습니다.");
  }
  if (result.width <= 0 || result.height <= 0) throw new Error("검열 박스 크기가 잘못됐습니다.");
  const rotation = number(box?.rotation);
  if (Number.isFinite(rotation)) {
    result.rotation = ((((rotation + 180) % 360) + 360) % 360) - 180;
  }
  if (result.classId < 0 || result.classId >= CENSOR_MODEL.classes.length) {
    throw new Error("검열 박스 분류가 잘못됐습니다.");
  }
  result.label = CENSOR_MODEL.classes[result.classId];
  if (!CENSOR_TARGET_CLASSES.includes(result.label)) {
    throw new Error("얼굴 class는 주요 부위 검열 대상으로 사용할 수 없습니다.");
  }
  const sourceBox = box?.sourceBox;
  if (sourceBox && [sourceBox.x, sourceBox.y, sourceBox.width, sourceBox.height]
    .map(Number).every(Number.isFinite)
    && Number(sourceBox.width) > 0 && Number(sourceBox.height) > 0) {
    result.sourceBox = {
      x: Number(sourceBox.x),
      y: Number(sourceBox.y),
      width: Number(sourceBox.width),
      height: Number(sourceBox.height),
    };
  }
  if (box?.mask && typeof box.mask === "object") {
    const maskWidth = Number(box.mask.width);
    const maskHeight = Number(box.mask.height);
    const maskData = box.mask.data;
    if (box.mask.encoding === "png-base64"
      && Number.isInteger(maskWidth) && maskWidth > 0 && maskWidth <= 1024
      && Number.isInteger(maskHeight) && maskHeight > 0 && maskHeight <= 1024
      && typeof maskData === "string" && maskData.length > 0 && maskData.length <= 1_000_000
      && /^[A-Za-z0-9+/]+={0,2}$/.test(maskData)) {
      result.mask = {
        encoding: "png-base64",
        width: maskWidth,
        height: maskHeight,
        data: maskData,
      };
      const maskBox = box.mask.box;
      if (maskBox && [maskBox.x, maskBox.y, maskBox.width, maskBox.height]
        .map(Number).every(Number.isFinite)
        && Number(maskBox.width) > 0 && Number(maskBox.height) > 0) {
        result.mask.box = {
          x: Number(maskBox.x),
          y: Number(maskBox.y),
          width: Number(maskBox.width),
          height: Number(maskBox.height),
        };
      }
    }
  }
  if (box?.effectOverride && typeof box.effectOverride === "object") {
    const { overwrite: _overwrite, ...effectOverride } = sanitizeOptions(box.effectOverride);
    result.effectOverride = effectOverride;
  }
  return result;
}

function sanitizeOptions(options) {
  let mode = ["mosaic", "color", "shape", "gradient", "fog"].includes(options?.mode)
    ? options.mode
    : "shape";
  const clamp = (value, minimum, maximum, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
  };
  let color = /^#[0-9a-f]{6}$/i.test(options?.color || "") ? options.color : "#ffffff";
  if (options?.mode === "black" || options?.mode === "white") {
    mode = "color";
    color = options.mode === "black" ? "#000000" : "#ffffff";
  }
  return {
    mode,
    color,
    expand: Math.round(clamp(options?.expand, 0, 100, 8)),
    shapeExpand: Math.round(clamp(options?.shapeExpand, 0, 100, 15)),
    feather: Math.round(clamp(options?.feather, 0, 50, 10)),
    mosaicSize: Math.round(clamp(options?.mosaicSize, 4, 64, 18)),
    opacity: clamp(options?.opacity, 0.1, 1, 1),
    fadeInner: clamp(options?.fadeInner, 0.1, 0.8, 0.45),
    fogBrightness: Math.round(clamp(options?.fogBrightness, 0, 100, 100)),
    fogOpacity: clamp(options?.fogOpacity, 0.1, 1, 1),
    fogDensity: Math.round(clamp(options?.fogDensity, 0, 100, 70)),
    spread: Math.round(clamp(options?.spread, 0, 100, 20)),
    maskThreshold: clamp(options?.maskThreshold, 0.05, 0.95, 0.65),
    maskEdgeSoftness: clamp(options?.maskEdgeSoftness, 0, 0.5, 0.05),
    overwrite: Boolean(options?.overwrite),
  };
}

function normalizeTargetSettings(request) {
  const targets = {};
  const thresholds = {};
  for (const label of CENSOR_MODEL.classes) {
    targets[label] = CENSOR_TARGET_CLASSES.includes(label) && request?.targets?.[label] !== false;
    const threshold = Number(request?.thresholds?.[label]);
    thresholds[label] = Number.isFinite(threshold) ? Math.min(0.99, Math.max(0.01, threshold)) : 0.35;
  }
  return { targets, thresholds };
}

class CensorService {
  constructor(appRoot, sendEvent = () => {}, options = {}) {
    this.appRoot = path.resolve(appRoot);
    this.resourceRoot = path.resolve(options.resourceRoot || appRoot);
    this.runtimeRoot = path.resolve(options.runtimeRoot || path.join(this.resourceRoot, "runtime"));
    this.modelRoot = path.resolve(options.modelRoot || path.join(this.resourceRoot, "Models", "censor"));
    this.sendEvent = sendEvent;
    this.items = new Map();
    this.child = null;
    this.readyPromise = null;
    this.pending = null;
    this.installing = null;
    this.warming = null;
    this.warmedModelPath = null;
    this.warmedProvider = null;
  }

  modelPath() {
    return path.join(this.modelRoot, CENSOR_MODEL.fileName);
  }

  outputRoot() {
    return path.join(this.appRoot, "outputs", "censored");
  }

  resolveOutput(relativePath) {
    const safePath = normalizeOutputRelativePath(String(relativePath));
    if (!safePath) return null;
    const outputRoot = path.resolve(this.outputRoot());
    const candidate = path.resolve(outputRoot, safePath);
    const relative = path.relative(outputRoot, candidate);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
    return fs.existsSync(candidate) ? candidate : null;
  }

  async status() {
    const runtime = locateRuntime(this.resourceRoot, { runtimeRoot: this.runtimeRoot });
    const dependencyPath = runtime.pythonPath
      ? path.join(path.dirname(runtime.pythonPath), "Lib", "site-packages", "onnxruntime", "__init__.py")
      : null;
    return {
      runtimeReady: runtime.state === "ready",
      dependencyReady: Boolean(dependencyPath && fs.existsSync(dependencyPath)),
      installing: Boolean(this.installing),
      model: {
        ...CENSOR_MODEL,
        downloaded: await verifyModelFile(this.modelPath()),
        loaded: Boolean(this.child && this.warmedModelPath === this.modelPath()),
        loading: Boolean(this.warming),
        provider: this.warmedProvider,
      },
    };
  }

  registerImageBatch(files) {
    let added = 0;
    const knownPaths = new Map([...this.items.values()].map((item) => [item.absolutePath.toLowerCase(), item]));
    for (const file of files) {
      const absolutePath = path.resolve(file.absolutePath);
      const extension = path.extname(absolutePath).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(extension) || !fs.existsSync(absolutePath)) continue;
      const known = knownPaths.get(absolutePath.toLowerCase());
      const outputRelativePath = normalizeOutputRelativePath(file.outputRelativePath);
      if (known) {
        if (!known.sourceArtifactRef && (file.sourceArtifactRef || file.artifactRef)) {
          known.sourceArtifactRef = file.sourceArtifactRef || file.artifactRef;
        }
        if (outputRelativePath && !known.outputRelativePath) {
          known.outputRelativePath = outputRelativePath;
          known.relativePath = outputRelativePath.split(path.sep).join("/");
        }
        continue;
      }
      const item = {
        id: randomUUID(),
        absolutePath,
        sourceArtifactRef: file.sourceArtifactRef || file.artifactRef || null,
        fileName: path.basename(absolutePath),
        outputRelativePath,
        relativePath: outputRelativePath?.split(path.sep).join("/") || path.basename(absolutePath),
        width: Number(file.width),
        height: Number(file.height),
        thumbnailDataUrl: file.thumbnailDataUrl || null,
      };
      this.items.set(item.id, item);
      knownPaths.set(absolutePath.toLowerCase(), item);
      added += 1;
    }
    return added;
  }

  imageIdForPath(absolutePath) {
    const key = path.resolve(String(absolutePath || "")).toLowerCase();
    return [...this.items.values()].find((item) => item.absolutePath.toLowerCase() === key)?.id || null;
  }

  registerImages(files) {
    this.registerImageBatch(files);
    return this.listImages();
  }

  registerArtifacts(artifacts) {
    const files = (Array.isArray(artifacts) ? artifacts : []).map((artifact) => {
      if (!artifact?.artifactRef || typeof artifact.absolutePath !== "string") {
        throw new Error("호스트가 해석한 artifact 입력이 올바르지 않습니다.");
      }
      return {
        absolutePath: artifact.absolutePath,
        sourceArtifactRef: { ...artifact.artifactRef },
        width: artifact.width,
        height: artifact.height,
      };
    });
    this.registerImageBatch(files);
    return this.listImages();
  }

  listImages() {
    return [...this.items.values()].map(({
      absolutePath: _absolutePath,
      outputRelativePath: _outputRelativePath,
      ...item
    }) => ({ ...item }));
  }

  resolveImage(id) {
    return this.items.get(String(id)) || null;
  }

  removeImage(id) {
    this.items.delete(String(id));
    return this.listImages();
  }

  clearImages() {
    this.items.clear();
    return [];
  }

  async installModel() {
    if (await verifyModelFile(this.modelPath())) return this.status();
    if (this.installing) return this.installing;
    this.installing = this.downloadModel().finally(() => {
      this.installing = null;
    });
    return this.installing;
  }

  async downloadModel() {
    const destination = this.modelPath();
    const partPath = `${destination}.part`;
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    await fs.promises.rm(partPath, { force: true });
    this.sendEvent({ event: "download", stage: "starting", progress: 0 });
    try {
      const response = await fetch(CENSOR_MODEL.url, { redirect: "follow" });
      if (!response.ok || !response.body) {
        throw new Error(`모델 다운로드 서버가 ${response.status} 상태를 반환했습니다.`);
      }
      const reader = response.body.getReader();
      const handle = await fs.promises.open(partPath, "w");
      const hash = createHash("sha256");
      let received = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          received += chunk.length;
          hash.update(chunk);
          await handle.write(chunk);
          this.sendEvent({
            event: "download",
            stage: "downloading",
            received,
            total: CENSOR_MODEL.bytes,
            progress: Math.min(99, Math.round((received / CENSOR_MODEL.bytes) * 100)),
          });
        }
      } finally {
        await handle.close();
      }
      const digest = hash.digest("hex");
      if (received !== CENSOR_MODEL.bytes || digest !== CENSOR_MODEL.sha256) {
        throw new Error("다운로드한 검열 모델의 크기 또는 SHA-256이 고정 manifest와 다릅니다.");
      }
      await fs.promises.rm(destination, { force: true });
      await fs.promises.rename(partPath, destination);
      this.sendEvent({ event: "download", stage: "complete", progress: 100 });
      return this.status();
    } catch (error) {
      await fs.promises.rm(partPath, { force: true });
      this.sendEvent({ event: "download", stage: "error", message: error.message });
      throw error;
    }
  }

  ensureWorker() {
    if (this.child && this.readyPromise) return this.readyPromise;
    const runtime = locateRuntime(this.resourceRoot, { runtimeRoot: this.runtimeRoot });
    if (runtime.state !== "ready" || !runtime.pythonPath) {
      return Promise.reject(new Error("사설 Python 런타임이 준비되지 않았습니다."));
    }
    const workerPath = path.join(this.appRoot, "app", "censor_worker.py");
    this.child = spawn(runtime.pythonPath, ["-u", workerPath, "--app-root", this.appRoot], {
      cwd: this.appRoot,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: workerEnvironment(runtime.pythonPath),
    });
    this.readyPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("자동검열 워커 시작 시간이 초과됐습니다.")), 30000);
      const lines = readline.createInterface({ input: this.child.stdout });
      lines.on("line", (line) => {
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          this.sendEvent({ event: "log", message: line });
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
        const message = chunk.toString("utf8").trim();
        if (message) this.sendEvent({ event: "log", message });
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
        this.warming = null;
        this.warmedModelPath = null;
        this.warmedProvider = null;
        if (pending) pending.reject(new Error(`자동검열 워커가 종료됐습니다. (code ${code})`));
      });
    });
    return this.readyPromise;
  }

  handleWorkerEvent(event) {
    this.sendEvent(event);
    if (!this.pending || event.requestId !== this.pending.requestId) return;
    if (event.event === "complete") {
      const pending = this.pending;
      this.pending = null;
      pending.resolve(event.result);
    } else if (event.event === "error") {
      const pending = this.pending;
      this.pending = null;
      pending.reject(new Error(event.message || "자동검열 처리에 실패했습니다."));
    }
  }

  async request(command, payload) {
    if (this.pending) throw new Error("다른 자동검열 작업이 실행 중입니다.");
    await this.ensureWorker();
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      this.pending = { requestId, resolve, reject };
      this.child.stdin.write(`${JSON.stringify({ command, requestId, payload })}\n`);
    });
  }

  async warmup() {
    const modelPath = this.modelPath();
    if (!await verifyModelFile(modelPath)) {
      return { loaded: false, reason: "model-missing", provider: null };
    }
    if (this.child && this.warmedModelPath === modelPath) {
      return { loaded: true, cached: true, provider: this.warmedProvider };
    }
    if (this.warming) return this.warming;
    this.warming = this.request("warmup", { modelPath })
      .then((result) => {
        this.warmedModelPath = modelPath;
        this.warmedProvider = result.provider || null;
        return { ...result, loaded: true, cached: false };
      })
      .finally(() => {
        this.warming = null;
      });
    return this.warming;
  }

  async scan(request) {
    if (!await verifyModelFile(this.modelPath())) {
      throw new Error("자동검열 모델이 없거나 SHA-256 검증에 실패했습니다. 모델을 다시 다운로드해 주세요.");
    }
    const ids = Array.isArray(request?.ids) ? request.ids : [];
    const images = ids.map((id) => {
      const item = this.resolveImage(id);
      if (!item) throw new Error("선택한 검열 입력 이미지를 찾을 수 없습니다.");
      return { id: item.id, path: item.absolutePath };
    });
    if (images.length === 0) throw new Error("검열할 이미지를 추가해 주세요.");
    const { targets, thresholds } = normalizeTargetSettings(request);
    await this.warmup();
    const results = [];
    for (let offset = 0; offset < images.length; offset += CENSOR_BATCH_SIZE) {
      const batch = images.slice(offset, offset + CENSOR_BATCH_SIZE);
      const result = await this.request("detect", {
        modelPath: this.modelPath(),
        images: batch,
        targets,
        thresholds,
        progressOffset: offset,
        progressTotal: images.length,
      });
      results.push(...result.images);
    }
    return { images: results };
  }

  async preview(request) {
    const item = this.resolveImage(request?.id);
    if (!item) throw new Error("검열 미리보기 원본 이미지를 찾을 수 없습니다.");
    const detections = Array.isArray(request?.detections)
      ? request.detections.slice(0, 500).map(sanitizeBox)
      : [];
    if (!detections.some((detection) => detection.enabled)) {
      throw new Error("미리 볼 검열 영역이 없습니다.");
    }
    return this.request("preview", {
      image: { id: item.id, path: item.absolutePath },
      detections,
      options: sanitizeOptions(request?.options),
      maximum: 1600,
    });
  }

  async save(request) {
    const records = Array.isArray(request?.records) ? request.records : [];
    if (records.length === 0) throw new Error("저장할 검열 결과가 없습니다.");
    const images = records.map((record) => {
      const item = this.resolveImage(record.id);
      if (!item) throw new Error("검열 원본 이미지를 찾을 수 없습니다.");
      const detections = Array.isArray(record.detections)
        ? record.detections.slice(0, 500).map(sanitizeBox)
        : [];
      return {
        id: item.id,
        path: item.absolutePath,
        outputRelativePath: item.outputRelativePath,
        detections,
      };
    });
    const outputRoot = this.outputRoot();
    const options = sanitizeOptions(request?.options);
    const model = {
      id: CENSOR_MODEL.id,
      fileName: CENSOR_MODEL.fileName,
      revision: CENSOR_MODEL.revision,
      sha256: CENSOR_MODEL.sha256,
    };
    const results = [];
    for (let offset = 0; offset < images.length; offset += CENSOR_BATCH_SIZE) {
      const batch = images.slice(offset, offset + CENSOR_BATCH_SIZE);
      const result = await this.request("save", {
        images: batch,
        outputRoot,
        options,
        model,
        progressOffset: offset,
        progressTotal: images.length,
      });
      results.push(...result.images);
    }
    return { images: results, outputRoot };
  }

  isModelLoaded() {
    return Boolean(
      this.child
      && this.warmedModelPath === this.modelPath()
      && this.warmedProvider === "CUDAExecutionProvider"
    );
  }

  isBusy() {
    return Boolean(this.pending || this.warming);
  }

  async releaseModel() {
    if (this.isBusy()) throw new Error("자동검열 작업이 실행 중이라 검열 모델을 해제할 수 없습니다.");
    const released = this.isModelLoaded();
    const child = this.child;
    const exited = waitForExit(child);
    this.shutdown();
    await exited;
    return { released, model: "censor" };
  }

  shutdown() {
    if (this.child) this.child.kill();
    this.child = null;
    this.readyPromise = null;
    this.pending = null;
    this.warming = null;
    this.warmedModelPath = null;
    this.warmedProvider = null;
  }
}

module.exports = {
  CENSOR_MODEL,
  CENSOR_TARGET_CLASSES,
  CENSOR_BATCH_SIZE,
  CensorService,
  IMAGE_EXTENSIONS,
  collectCensorInputFiles,
  fileMatchesModel,
  normalizeOutputRelativePath,
  normalizeTargetSettings,
  sanitizeBox,
  sanitizeOptions,
  verifyModelFile,
  waitForExit,
  workerEnvironment,
};
