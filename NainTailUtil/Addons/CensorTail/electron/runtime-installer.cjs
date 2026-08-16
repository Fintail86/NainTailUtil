"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const { Readable } = require("node:stream");
const { spawn } = require("node:child_process");
const { locateRuntime } = require("./runtime-locator.cjs");

function readRuntimeStatus(appRoot, runtimeRoot) {
  const { state, runtimeId, source } = locateRuntime(appRoot, { runtimeRoot });
  return { state, runtimeId, source };
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const RUNTIME_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const ASSET_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const BOOTSTRAP_ROLES = Object.freeze(["python", "uv", "diffsynth"]);
const BOOTSTRAP_FORMATS = Object.freeze(["zip", "tar.gz"]);
const DOWNLOAD_MARGIN_BYTES = 512 * 1024 * 1024;

function safeRelativePath(value, field) {
  if (typeof value !== "string" || !value.trim() || path.isAbsolute(value)) {
    throw new Error(`${field} must be a non-empty relative path.`);
  }
  const normalized = value.replaceAll("/", path.sep);
  if (normalized.split(path.sep).some((segment) => !segment || segment === "..")) {
    throw new Error(`${field} contains an unsafe path segment.`);
  }
  return normalized;
}

function requireSha256(value, field) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(`${field} must be a SHA-256 hex digest.`);
  }
  return value.toLowerCase();
}

function normalizeArchivePart(part, index, allowFileUrls) {
  if (!part || typeof part !== "object") throw new Error(`archiveParts[${index}] is invalid.`);
  let url;
  try {
    url = new URL(part.url);
  } catch {
    throw new Error(`archiveParts[${index}].url is invalid.`);
  }
  if (url.protocol !== "https:" && !(allowFileUrls && url.protocol === "file:")) {
    throw new Error(`archiveParts[${index}].url must use HTTPS.`);
  }
  const bytes = Number(part.bytes);
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new Error(`archiveParts[${index}].bytes must be a positive safe integer.`);
  }
  return Object.freeze({
    url: url.href,
    bytes,
    sha256: requireSha256(part.sha256, `archiveParts[${index}].sha256`),
  });
}

function normalizeBootstrapAsset(asset, index, allowFileUrls) {
  if (!asset || typeof asset !== "object") throw new Error(`assets[${index}] is invalid.`);
  if (typeof asset.id !== "string" || !ASSET_ID_PATTERN.test(asset.id)) {
    throw new Error(`assets[${index}].id is invalid.`);
  }
  if (!BOOTSTRAP_ROLES.includes(asset.role)) {
    throw new Error(`assets[${index}].role is invalid.`);
  }
  if (!BOOTSTRAP_FORMATS.includes(asset.format)) {
    throw new Error(`assets[${index}].format is invalid.`);
  }
  const normalized = normalizeArchivePart(asset, index, allowFileUrls);
  return Object.freeze({
    ...normalized,
    id: asset.id,
    role: asset.role,
    format: asset.format,
  });
}

function normalizeVerifiedFiles(rawFiles) {
  if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
    throw new Error("at least one verified runtime file is required.");
  }
  return Object.freeze(rawFiles.map((file, index) => {
    const bytes = Number(file?.bytes);
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new Error(`files[${index}].bytes is invalid.`);
    }
    return Object.freeze({
      path: safeRelativePath(file.path, `files[${index}].path`),
      bytes,
      sha256: requireSha256(file.sha256, `files[${index}].sha256`),
    });
  }));
}

function normalizeRuntimeManifest(raw, options = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("runtime manifest must be an object.");
  }
  if (![1, 2, 3].includes(raw.schemaVersion)) {
    throw new Error(`unsupported runtime manifest schema: ${raw.schemaVersion}`);
  }
  if (typeof raw.runtimeId !== "string" || !RUNTIME_ID_PATTERN.test(raw.runtimeId)) {
    throw new Error("runtimeId is invalid.");
  }
  if (raw.platform !== "win-x64") throw new Error(`unsupported runtime platform: ${raw.platform}`);

  const files = normalizeVerifiedFiles(raw.files);
  const expandedBytes = Number(raw.expandedBytes);
  if (!Number.isSafeInteger(expandedBytes) || expandedBytes <= 0) {
    throw new Error("expandedBytes must be a positive safe integer.");
  }

  if (raw.schemaVersion === 3) {
    if (raw.installMode !== "bootstrap") {
      throw new Error(`unsupported runtime install mode: ${raw.installMode}`);
    }
    const estimatedDownloadBytes = Number(raw.estimatedDownloadBytes);
    if (!Number.isSafeInteger(estimatedDownloadBytes) || estimatedDownloadBytes <= 0) {
      throw new Error("estimatedDownloadBytes must be a positive safe integer.");
    }
    if (!Array.isArray(raw.assets) || raw.assets.length === 0) {
      throw new Error("bootstrap runtime assets are required.");
    }
    const assets = Object.freeze(raw.assets.map((asset, index) => normalizeBootstrapAsset(
      asset,
      index,
      Boolean(options.allowFileUrls),
    )));
    for (const role of BOOTSTRAP_ROLES) {
      if (assets.filter((asset) => asset.role === role).length !== 1) {
        throw new Error(`bootstrap runtime requires exactly one ${role} asset.`);
      }
    }
    return Object.freeze({
      schemaVersion: raw.schemaVersion,
      runtimeId: raw.runtimeId,
      platform: raw.platform,
      installMode: "bootstrap",
      markerDigest: requireSha256(raw.integrity, "integrity"),
      downloadBytes: estimatedDownloadBytes,
      expandedBytes,
      entrypoint: safeRelativePath(raw.entrypoint || "python.exe", "entrypoint"),
      requirementsPath: safeRelativePath(raw.requirementsPath, "requirementsPath"),
      assets,
      files,
    });
  }

  const archiveBytes = Number(raw.archiveBytes);
  if (!Number.isSafeInteger(archiveBytes) || archiveBytes <= 0) {
    throw new Error("archiveBytes must be a positive safe integer.");
  }

  const rawParts = Array.isArray(raw.archiveParts) && raw.archiveParts.length > 0
    ? raw.archiveParts
    : [{ url: raw.archiveUrl, bytes: archiveBytes, sha256: raw.archiveSha256 }];
  const archiveParts = rawParts.map((part, index) => normalizeArchivePart(
    part,
    index,
    Boolean(options.allowFileUrls),
  ));
  if (archiveParts.reduce((sum, part) => sum + part.bytes, 0) !== archiveBytes) {
    throw new Error("archiveParts byte total does not match archiveBytes.");
  }

  const archiveSha256 = requireSha256(raw.archiveSha256, "archiveSha256");
  return Object.freeze({
    schemaVersion: raw.schemaVersion,
    runtimeId: raw.runtimeId,
    platform: raw.platform,
    installMode: "archive",
    markerDigest: archiveSha256,
    downloadBytes: archiveBytes,
    archiveBytes,
    archiveSha256,
    archiveParts: Object.freeze(archiveParts),
    expandedBytes,
    entrypoint: safeRelativePath(raw.entrypoint || "python.exe", "entrypoint"),
    files: Object.freeze(files),
  });
}

function loadRuntimeManifest(appRoot, options = {}) {
  const root = path.resolve(appRoot);
  const manifestPath = path.join(root, "runtime-manifest.json");
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`runtime-manifest.json을 읽을 수 없습니다: ${error.message}`);
  }
  return normalizeRuntimeManifest(raw, options);
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

async function verifyFile(filePath, expectedBytes, expectedSha256) {
  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile() || stat.size !== expectedBytes) return false;
    return await sha256File(filePath) === expectedSha256;
  } catch {
    return false;
  }
}

async function availableBytes(targetPath) {
  if (typeof fs.promises.statfs !== "function") return null;
  const stats = await fs.promises.statfs(targetPath, { bigint: true });
  return stats.bavail * stats.bsize;
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

class RuntimeInstaller {
  constructor(appRoot, sendEvent = () => {}, options = {}) {
    this.appRoot = path.resolve(appRoot);
    this.runtimeRoot = path.resolve(options.runtimeRoot || path.join(this.appRoot, "runtime"));
    this.sendEvent = sendEvent;
    this.fetch = options.fetch || globalThis.fetch;
    this.extract = options.extract || null;
    this.extractTar = options.extractTar || null;
    this.bootstrap = options.bootstrap || null;
    this.runCommand = options.runCommand || null;
    this.allowFileUrls = Boolean(options.allowFileUrls);
    this.installing = null;
    this.abortController = null;
    this.activeChild = null;
    this.cancelRequested = false;
  }

  status() {
    let manifest = null;
    let manifestError = null;
    try {
      manifest = loadRuntimeManifest(this.appRoot, { allowFileUrls: this.allowFileUrls });
    } catch (error) {
      manifestError = error.message;
    }
    return {
      ...readRuntimeStatus(this.appRoot, this.runtimeRoot),
      installing: Boolean(this.installing),
      installMode: manifest?.installMode || null,
      archiveBytes: manifest?.downloadBytes || null,
      expandedBytes: manifest?.expandedBytes || null,
      partCount: manifest?.archiveParts?.length || manifest?.assets?.length || 0,
      manifestError,
    };
  }

  install() {
    if (this.installing) return this.installing;
    this.cancelRequested = false;
    this.abortController = new AbortController();
    this.installing = this.installRuntime()
      .finally(() => {
        this.installing = null;
        this.abortController = null;
      })
      .then(() => this.status());
    return this.installing;
  }

  cancel() {
    if (!this.installing) return false;
    this.cancelRequested = true;
    this.abortController?.abort();
    this.activeChild?.kill();
    return true;
  }

  throwIfCancelled() {
    if (this.cancelRequested) {
      const error = new Error("런타임 설치가 취소되었습니다.");
      error.code = "RUNTIME_INSTALL_CANCELLED";
      throw error;
    }
  }

  async acquireInstallLock(runtimeRoot) {
    const lockPath = path.join(runtimeRoot, ".install.lock");
    await fs.promises.mkdir(runtimeRoot, { recursive: true });
    let existing = null;
    try {
      existing = JSON.parse(await fs.promises.readFile(lockPath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    if (processIsAlive(Number(existing?.pid))) {
      throw new Error("다른 NainTail 런타임 설치 프로세스가 실행 중입니다.");
    }
    await fs.promises.rm(lockPath, { force: true });
    const handle = await fs.promises.open(lockPath, "wx");
    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    return async () => {
      await handle.close().catch(() => {});
      await fs.promises.rm(lockPath, { force: true }).catch(() => {});
    };
  }

  async installRuntime() {
    let releaseLock = null;
    try {
      const manifest = loadRuntimeManifest(this.appRoot, { allowFileUrls: this.allowFileUrls });
      const runtimeRoot = this.runtimeRoot;
      const versionsRoot = path.join(runtimeRoot, "versions");
      const finalRoot = path.join(versionsRoot, manifest.runtimeId);
      await fs.promises.mkdir(versionsRoot, { recursive: true });
      releaseLock = await this.acquireInstallLock(runtimeRoot);

      if (await this.verifyInstalledRuntime(finalRoot, manifest, false)) return this.status();
      if (fs.existsSync(finalRoot)) await this.quarantineRuntime(runtimeRoot, finalRoot, manifest.runtimeId);
      await this.checkFreeSpace(runtimeRoot, manifest);

      this.sendEvent({ event: "install", stage: "starting", progress: 0, ...this.publicManifest(manifest) });
      const stagingRoot = path.join(versionsRoot, `.staging-${manifest.runtimeId}-${process.pid}`);
      await fs.promises.rm(stagingRoot, { recursive: true, force: true });
      await fs.promises.mkdir(stagingRoot, { recursive: true });

      try {
        if (manifest.installMode === "bootstrap") {
          await this.bootstrapRuntime(runtimeRoot, stagingRoot, manifest);
        } else {
          const archivePath = await this.prepareArchive(runtimeRoot, manifest);
          this.throwIfCancelled();
          this.sendEvent({ event: "install", stage: "extracting", progress: 100 });
          await this.extractZipArchive(archivePath, stagingRoot);
          await fs.promises.rm(archivePath, { force: true }).catch(() => {});
        }
        this.throwIfCancelled();
        await this.verifyInstalledRuntime(stagingRoot, manifest, true);
        await fs.promises.writeFile(
          path.join(stagingRoot, ".runtime-ready"),
          `${manifest.runtimeId}\n${manifest.markerDigest}\n`,
          "utf8",
        );
        await fs.promises.rename(stagingRoot, finalRoot);
      } catch (error) {
        await fs.promises.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
        throw error;
      }

      this.sendEvent({ event: "install", stage: "complete", progress: 100, runtimeId: manifest.runtimeId });
      return this.status();
    } catch (error) {
      const cancelled = this.cancelRequested
        || error?.code === "RUNTIME_INSTALL_CANCELLED"
        || error?.name === "AbortError";
      this.sendEvent({
        event: "install",
        stage: cancelled ? "cancelled" : "error",
        message: cancelled ? "런타임 설치가 취소되었습니다." : error.message,
      });
      if (cancelled) return this.status();
      throw error;
    } finally {
      if (releaseLock) await releaseLock();
    }
  }

  publicManifest(manifest) {
    return {
      runtimeId: manifest.runtimeId,
      installMode: manifest.installMode,
      archiveBytes: manifest.downloadBytes,
      expandedBytes: manifest.expandedBytes,
      partCount: manifest.archiveParts?.length || manifest.assets?.length || 0,
    };
  }

  async checkFreeSpace(runtimeRoot, manifest) {
    const free = await availableBytes(runtimeRoot);
    if (free === null) return;
    const required = BigInt(manifest.downloadBytes + manifest.expandedBytes + DOWNLOAD_MARGIN_BYTES);
    if (free < required) {
      throw new Error(`런타임 설치 공간이 부족합니다. 필요 ${required} bytes, 사용 가능 ${free} bytes`);
    }
  }

  async quarantineRuntime(runtimeRoot, finalRoot, runtimeId) {
    const quarantineRoot = path.join(runtimeRoot, "quarantine");
    await fs.promises.mkdir(quarantineRoot, { recursive: true });
    const suffix = `${new Date().toISOString().replace(/[-:.TZ]/g, "")}-${process.pid}`;
    await fs.promises.rename(finalRoot, path.join(quarantineRoot, `${runtimeId}-${suffix}`));
  }

  async bootstrapRuntime(runtimeRoot, stagingRoot, manifest) {
    if (this.bootstrap) {
      await this.bootstrap({ runtimeRoot, stagingRoot, manifest, installer: this });
      return;
    }

    const downloadRoot = path.join(runtimeRoot, ".downloads", manifest.runtimeId);
    const workRoot = path.join(runtimeRoot, `.bootstrap-${process.pid}`);
    await fs.promises.mkdir(downloadRoot, { recursive: true });
    await fs.promises.rm(workRoot, { recursive: true, force: true });
    await fs.promises.mkdir(workRoot, { recursive: true });

    try {
      const assetBytes = manifest.assets.reduce((sum, asset) => sum + asset.bytes, 0);
      const assetPaths = new Map();
      let completedBytes = 0;
      for (let index = 0; index < manifest.assets.length; index += 1) {
        const asset = manifest.assets[index];
        const extension = asset.format === "tar.gz" ? "tar.gz" : "zip";
        const assetPath = path.join(downloadRoot, `${asset.id}.${extension}`);
        await this.downloadPart(
          asset,
          assetPath,
          completedBytes,
          assetBytes,
          index,
          manifest.assets.length,
          { progressStart: 0, progressEnd: 20, assetId: asset.id },
        );
        completedBytes += asset.bytes;
        assetPaths.set(asset.role, assetPath);
      }
      this.throwIfCancelled();

      this.sendEvent({ event: "install", stage: "preparing-python", progress: 22 });
      const pythonExtractRoot = path.join(workRoot, "p");
      await fs.promises.mkdir(pythonExtractRoot, { recursive: true });
      await this.extractTarArchive(assetPaths.get("python"), pythonExtractRoot);
      const extractedPython = await this.findPath(
        pythonExtractRoot,
        (entry) => entry.name.toLowerCase() === "python.exe" && entry.isFile(),
      );
      if (!extractedPython) throw new Error("Python standalone archive does not contain python.exe.");
      await this.copyDirectoryContents(path.dirname(extractedPython), stagingRoot);
      const pythonExe = path.join(stagingRoot, "python.exe");
      if (!fs.existsSync(pythonExe)) throw new Error("Python standalone extraction failed.");

      this.sendEvent({ event: "install", stage: "preparing-installer", progress: 27 });
      const uvExtractRoot = path.join(workRoot, "u");
      await fs.promises.mkdir(uvExtractRoot, { recursive: true });
      await this.extractZipArchive(assetPaths.get("uv"), uvExtractRoot);
      const uvExe = await this.findPath(
        uvExtractRoot,
        (entry) => entry.name.toLowerCase() === "uv.exe" && entry.isFile(),
      );
      if (!uvExe) throw new Error("uv archive does not contain uv.exe.");

      const requirementsPath = path.resolve(this.appRoot, manifest.requirementsPath);
      const requirementsBoundary = `${this.appRoot}${path.sep}`;
      if (!requirementsPath.startsWith(requirementsBoundary) || !fs.existsSync(requirementsPath)) {
        throw new Error("runtime requirements lock is missing or outside the app root.");
      }
      const environment = this.bootstrapEnvironment(stagingRoot, downloadRoot);

      this.sendEvent({ event: "install", stage: "installing-packages", progress: 32 });
      await this.executeCommand(
        uvExe,
        ["pip", "install", "--python", pythonExe, "-r", requirementsPath],
        {
          cwd: this.appRoot,
          env: environment,
          stage: "installing-packages",
          progress: 62,
        },
      );
      this.throwIfCancelled();

      this.sendEvent({ event: "install", stage: "installing-diffsynth", progress: 82 });
      const diffSynthExtractRoot = path.join(workRoot, "d");
      await fs.promises.mkdir(diffSynthExtractRoot, { recursive: true });
      await this.extractZipArchive(assetPaths.get("diffsynth"), diffSynthExtractRoot);
      const pyproject = await this.findPath(
        diffSynthExtractRoot,
        (entry) => entry.name === "pyproject.toml" && entry.isFile(),
      );
      const diffSynthRoot = pyproject ? path.dirname(pyproject) : null;
      const diffSynthPackage = diffSynthRoot ? path.join(diffSynthRoot, "diffsynth") : null;
      if (!diffSynthPackage || !fs.existsSync(path.join(diffSynthPackage, "__init__.py"))) {
        throw new Error("DiffSynth source archive has an unexpected layout.");
      }
      const installedDiffSynth = path.join(stagingRoot, "Lib", "site-packages", "diffsynth");
      await fs.promises.rm(installedDiffSynth, { recursive: true, force: true });
      await fs.promises.cp(diffSynthPackage, installedDiffSynth, { recursive: true, force: true });
      const diffSynthLicense = path.join(diffSynthRoot, "LICENSE");
      if (fs.existsSync(diffSynthLicense)) {
        const licensesRoot = path.join(stagingRoot, "licenses");
        await fs.promises.mkdir(licensesRoot, { recursive: true });
        await fs.promises.copyFile(
          diffSynthLicense,
          path.join(licensesRoot, "DiffSynth-Studio-LICENSE"),
        );
      }

      this.sendEvent({ event: "install", stage: "probing", progress: 92 });
      await this.executeCommand(
        pythonExe,
        [
          "-I",
          "-c",
          [
            "import torch, onnxruntime, diffsynth",
            "assert torch.cuda.is_available(), 'PyTorch CUDA is unavailable'",
            "assert 'CUDAExecutionProvider' in onnxruntime.get_available_providers(), 'ONNX CUDA provider is unavailable'",
            "x=torch.ones((64,64), device='cuda', dtype=torch.bfloat16)",
            "assert bool(torch.isfinite(x @ x).all())",
            "print(torch.__version__, torch.version.cuda, torch.cuda.get_device_name(0))",
          ].join(";"),
        ],
        {
          cwd: this.appRoot,
          env: environment,
          stage: "probing",
          progress: 96,
        },
      );
      await this.removeTransientPythonFiles(stagingRoot);
      await fs.promises.rm(downloadRoot, { recursive: true, force: true });
    } finally {
      await fs.promises.rm(workRoot, { recursive: true, force: true }).catch(() => {});
    }
  }

  bootstrapEnvironment(stagingRoot, downloadRoot) {
    const environment = { ...process.env };
    for (const name of ["PYTHONHOME", "PYTHONPATH", "CUDA_PATH", "CUDA_HOME"]) {
      delete environment[name];
    }
    environment.PYTHONNOUSERSITE = "1";
    environment.PYTHONSAFEPATH = "1";
    environment.PYTHONDONTWRITEBYTECODE = "1";
    environment.PYTHONUTF8 = "1";
    environment.UV_PYTHON_DOWNLOADS = "never";
    environment.UV_NO_CONFIG = "1";
    environment.UV_LINK_MODE = "copy";
    environment.UV_CACHE_DIR = path.join(downloadRoot, "uv-cache");
    environment.PATH = [
      stagingRoot,
      path.join(stagingRoot, "Lib", "site-packages", "torch", "lib"),
      path.join(stagingRoot, "Lib", "site-packages", "onnxruntime", "capi"),
      path.join(process.env.SystemRoot || "C:\\Windows", "System32"),
      process.env.SystemRoot || "C:\\Windows",
    ].join(path.delimiter);
    return environment;
  }

  async extractTarArchive(archivePath, destination) {
    if (this.extractTar) {
      await this.extractTar(archivePath, destination);
      return;
    }
    await this.executeCommand(
      "tar.exe",
      ["-xzf", archivePath, "-C", destination],
      {
        cwd: this.appRoot,
        env: this.bootstrapEnvironment(destination, path.dirname(archivePath)),
        stage: "preparing-python",
        progress: 25,
      },
    );
  }

  async extractZipArchive(archivePath, destination) {
    if (this.extract) {
      await this.extract(archivePath, { dir: destination });
      return;
    }
    await this.executeCommand(
      "tar.exe",
      ["-xf", archivePath, "-C", destination],
      {
        cwd: this.appRoot,
        env: this.bootstrapEnvironment(destination, path.dirname(archivePath)),
        stage: "extracting",
        progress: 26,
      },
    );
  }

  async executeCommand(command, args, options = {}) {
    if (this.runCommand) {
      await this.runCommand(command, args, options);
      this.throwIfCancelled();
      return;
    }
    this.throwIfCancelled();
    await new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd || this.appRoot,
        env: options.env || process.env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.activeChild = child;
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        callback(value);
      };
      let tail = "";
      const collect = (chunk) => {
        tail = `${tail}${chunk.toString("utf8")}`.slice(-4000);
        const message = tail.trim().split(/\r?\n/).at(-1)?.slice(0, 240);
        if (message) {
          this.sendEvent({
            event: "install",
            stage: options.stage || "installing-packages",
            progress: options.progress,
            message,
          });
        }
      };
      child.stdout?.on("data", collect);
      child.stderr?.on("data", collect);
      child.once("error", (error) => finish(reject, error));
      child.once("close", (code) => {
        if (this.cancelRequested) {
          const error = new Error("런타임 설치가 취소되었습니다.");
          error.code = "RUNTIME_INSTALL_CANCELLED";
          finish(reject, error);
        } else if (code === 0) {
          finish(resolve);
        } else {
          finish(reject, new Error(`${path.basename(command)} failed with exit code ${code}: ${tail.trim()}`));
        }
      });
    }).finally(() => {
      this.activeChild = null;
    });
    this.throwIfCancelled();
  }

  async findPath(root, predicate) {
    const pending = [root];
    while (pending.length > 0) {
      this.throwIfCancelled();
      const current = pending.shift();
      const entries = await fs.promises.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const candidate = path.join(current, entry.name);
        if (predicate(entry, candidate)) return candidate;
        if (entry.isDirectory()) pending.push(candidate);
      }
    }
    return null;
  }

  async copyDirectoryContents(source, destination) {
    for (const entry of await fs.promises.readdir(source, { withFileTypes: true })) {
      this.throwIfCancelled();
      await fs.promises.cp(
        path.join(source, entry.name),
        path.join(destination, entry.name),
        { recursive: entry.isDirectory(), force: true },
      );
    }
  }

  async removeTransientPythonFiles(root) {
    const pending = [root];
    const directories = [];
    while (pending.length > 0) {
      const current = pending.shift();
      for (const entry of await fs.promises.readdir(current, { withFileTypes: true })) {
        const candidate = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (["__pycache__", ".pytest_cache"].includes(entry.name)) directories.push(candidate);
          else pending.push(candidate);
        } else if ([".pyc", ".pyo"].includes(path.extname(entry.name))) {
          await fs.promises.rm(candidate, { force: true });
        }
      }
    }
    directories.sort((left, right) => right.length - left.length);
    for (const directory of directories) {
      await fs.promises.rm(directory, { recursive: true, force: true });
    }
  }

  async prepareArchive(runtimeRoot, manifest) {
    const downloadRoot = path.join(runtimeRoot, ".downloads");
    await fs.promises.mkdir(downloadRoot, { recursive: true });
    const partPaths = [];
    let completedBytes = 0;
    for (let index = 0; index < manifest.archiveParts.length; index += 1) {
      const part = manifest.archiveParts[index];
      const partPath = path.join(downloadRoot, `${manifest.runtimeId}.part-${String(index + 1).padStart(3, "0")}`);
      await this.downloadPart(part, partPath, completedBytes, manifest.archiveBytes, index, manifest.archiveParts.length);
      completedBytes += part.bytes;
      partPaths.push(partPath);
    }
    this.throwIfCancelled();

    const archivePath = path.join(downloadRoot, `${manifest.runtimeId}.zip.part`);
    await fs.promises.rm(archivePath, { force: true });
    const archiveHash = createHash("sha256");
    const output = fs.createWriteStream(archivePath, { flags: "wx" });
    let assembledBytes = 0;
    try {
      for (let index = 0; index < partPaths.length; index += 1) {
        this.throwIfCancelled();
        const input = fs.createReadStream(partPaths[index]);
        for await (const chunk of input) {
          this.throwIfCancelled();
          archiveHash.update(chunk);
          assembledBytes += chunk.length;
          if (!output.write(chunk)) await new Promise((resolve) => output.once("drain", resolve));
        }
        await fs.promises.rm(partPaths[index], { force: true });
        this.sendEvent({
          event: "install",
          stage: "assembling",
          partIndex: index + 1,
          partCount: partPaths.length,
          received: assembledBytes,
          total: manifest.archiveBytes,
          progress: Math.round((assembledBytes / manifest.archiveBytes) * 100),
        });
      }
    } finally {
      await new Promise((resolve, reject) => output.end((error) => (error ? reject(error) : resolve())));
    }
    if (assembledBytes !== manifest.archiveBytes || archiveHash.digest("hex") !== manifest.archiveSha256) {
      await fs.promises.rm(archivePath, { force: true });
      throw new Error("결합된 런타임 ZIP의 크기 또는 SHA-256이 manifest와 다릅니다.");
    }
    return archivePath;
  }

  async downloadPart(
    part,
    partPath,
    completedBytes,
    totalBytes,
    partIndex,
    partCount,
    options = {},
  ) {
    if (await verifyFile(partPath, part.bytes, part.sha256)) return;
    let offset = 0;
    try {
      offset = (await fs.promises.stat(partPath)).size;
      if (offset > part.bytes) {
        await fs.promises.rm(partPath, { force: true });
        offset = 0;
      }
    } catch {}

    const url = new URL(part.url);
    if (url.protocol === "file:") {
      const { fileURLToPath } = require("node:url");
      const sourcePath = fileURLToPath(url);
      await fs.promises.copyFile(sourcePath, partPath);
    } else {
      const headers = offset > 0 ? { Range: `bytes=${offset}-` } : {};
      const response = await this.fetch(part.url, {
        headers,
        redirect: "follow",
        signal: this.abortController.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`런타임 다운로드 서버가 ${response.status} 상태를 반환했습니다.`);
      }
      const append = offset > 0 && response.status === 206;
      if (!append) offset = 0;
      const output = fs.createWriteStream(partPath, { flags: append ? "a" : "w" });
      let received = offset;
      let lastProgress = -1;
      const progressStart = Number.isFinite(options.progressStart) ? options.progressStart : 0;
      const progressEnd = Number.isFinite(options.progressEnd) ? options.progressEnd : 99;
      const source = Readable.fromWeb(response.body);
      source.on("data", (chunk) => {
        received += chunk.length;
        const ratio = Math.min(1, (completedBytes + received) / totalBytes);
        const progress = Math.min(
          progressEnd,
          Math.round(progressStart + (ratio * (progressEnd - progressStart))),
        );
        if (progress !== lastProgress) {
          lastProgress = progress;
          this.sendEvent({
            event: "install",
            stage: "downloading",
            partIndex: partIndex + 1,
            partCount,
            received: completedBytes + received,
            total: totalBytes,
            progress,
            assetId: options.assetId || null,
          });
        }
      });
      await pipeline(source, output);
    }
    if (!await verifyFile(partPath, part.bytes, part.sha256)) {
      await fs.promises.rm(partPath, { force: true });
      throw new Error(`런타임 조각 ${partIndex + 1}/${partCount}의 크기 또는 SHA-256이 manifest와 다릅니다.`);
    }
  }

  async verifyInstalledRuntime(runtimeRoot, manifest, throwOnFailure) {
    try {
      const entrypoint = path.join(runtimeRoot, manifest.entrypoint);
      if (!fs.existsSync(entrypoint)) throw new Error("runtime entrypoint is missing.");
      for (let index = 0; index < manifest.files.length; index += 1) {
        this.throwIfCancelled();
        const file = manifest.files[index];
        this.sendEvent({
          event: "install",
          stage: "verifying",
          fileIndex: index + 1,
          fileCount: manifest.files.length,
          progress: Math.round(((index + 1) / manifest.files.length) * 100),
        });
        if (!await verifyFile(path.join(runtimeRoot, file.path), file.bytes, file.sha256)) {
          throw new Error(`runtime file verification failed: ${file.path}`);
        }
      }
      return true;
    } catch (error) {
      if (throwOnFailure) throw error;
      return false;
    }
  }
}

module.exports = {
  RuntimeInstaller,
  loadRuntimeManifest,
  normalizeRuntimeManifest,
  sha256File,
  verifyFile,
};
