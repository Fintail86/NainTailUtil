"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { RuntimeInstaller, loadRuntimeManifest, verifyFile } = require("./runtime-installer.cjs");

const ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const IMPORT_PATTERN = /^[A-Za-z_][A-Za-z0-9_.]*$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

function inside(root, relativePath, field) {
  if (typeof relativePath !== "string" || !relativePath.trim() || path.isAbsolute(relativePath)) {
    throw new Error(`${field} must be a relative path.`);
  }
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${field} escapes the addon root.`);
  }
  return target;
}

function loadRequirementsPlan(appRoot, requirementsPath, allowFileUrls = false) {
  const addonRoot = path.resolve(appRoot);
  const planPath = path.resolve(requirementsPath);
  const planRoot = path.dirname(planPath);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(planPath, "utf8"));
  } catch (error) {
    throw new Error(`hosted runtime requirements를 읽을 수 없습니다: ${error.message}`);
  }
  if (raw?.schemaVersion !== 1 || raw.kind !== "addon-runtime-requirements") {
    throw new Error("unsupported hosted runtime requirements schema.");
  }
  if (raw.platform !== "win-x64") throw new Error(`unsupported runtime platform: ${raw.platform}`);
  const environmentManifestPath = inside(planRoot, raw.environmentManifest, "environmentManifest");
  const environment = loadRuntimeManifest(addonRoot, {
    allowFileUrls,
    runtimeManifestPath: environmentManifestPath,
  });
  if (!Array.isArray(raw.components) || raw.components.length === 0) {
    throw new Error("at least one addon runtime component is required.");
  }
  const components = raw.components.map((component, index) => {
    if (!component || !ID_PATTERN.test(component.id || "")) {
      throw new Error(`components[${index}].id is invalid.`);
    }
    if (!SHA256_PATTERN.test(component.integrity || "")) {
      throw new Error(`components[${index}].integrity is invalid.`);
    }
    const requirementsFile = inside(planRoot, component.requirementsPath, `components[${index}].requirementsPath`);
    if (!fs.existsSync(requirementsFile)) throw new Error(`runtime requirements lock is missing: ${requirementsFile}`);
    const assets = Array.isArray(component.assets) ? component.assets.map((asset, assetIndex) => {
      if (!asset || !ID_PATTERN.test(asset.id || "") || asset.role !== "diffsynth" || asset.format !== "zip") {
        throw new Error(`components[${index}].assets[${assetIndex}] is invalid.`);
      }
      const url = new URL(asset.url);
      if (url.protocol !== "https:" && !(allowFileUrls && url.protocol === "file:")) {
        throw new Error(`components[${index}].assets[${assetIndex}].url must use HTTPS.`);
      }
      if (!Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || !SHA256_PATTERN.test(asset.sha256 || "")) {
        throw new Error(`components[${index}].assets[${assetIndex}] integrity is invalid.`);
      }
      return Object.freeze({ ...asset, url: url.href, sha256: asset.sha256.toLowerCase() });
    }) : [];
    const imports = Array.isArray(component.imports) ? component.imports : [];
    if (imports.length === 0 || imports.some((name) => !IMPORT_PATTERN.test(name))) {
      throw new Error(`components[${index}].imports is invalid.`);
    }
    const files = Array.isArray(component.files) ? component.files.map((file, fileIndex) => {
      if (!Number.isSafeInteger(file?.bytes) || file.bytes < 0 || !SHA256_PATTERN.test(file?.sha256 || "")) {
        throw new Error(`components[${index}].files[${fileIndex}] is invalid.`);
      }
      const absolutePath = inside(path.join("C:\\", "runtime"), file.path, `components[${index}].files[${fileIndex}].path`);
      return Object.freeze({
        path: path.relative(path.join("C:\\", "runtime"), absolutePath),
        bytes: file.bytes,
        sha256: file.sha256.toLowerCase(),
      });
    }) : [];
    const downloadBytes = Number(component.estimatedDownloadBytes);
    const expandedBytes = Number(component.expandedBytes);
    if (!Number.isSafeInteger(downloadBytes) || downloadBytes <= 0
      || !Number.isSafeInteger(expandedBytes) || expandedBytes <= 0) {
      throw new Error(`components[${index}] size estimate is invalid.`);
    }
    return Object.freeze({
      id: component.id,
      integrity: component.integrity.toLowerCase(),
      requirementsFile,
      assets: Object.freeze(assets),
      imports: Object.freeze(imports),
      files: Object.freeze(files),
      downloadBytes,
      expandedBytes,
      requireTorchCuda: component.requireTorchCuda === true,
      requireOnnxCuda: component.requireOnnxCuda === true,
    });
  });
  if (new Set(components.map((item) => item.id)).size !== components.length) {
    throw new Error("hosted runtime component IDs must be unique.");
  }
  return Object.freeze({ planPath, planRoot, environmentManifestPath, environment, components: Object.freeze(components) });
}

function markerPath(environmentRoot, component) {
  return path.join(environmentRoot, ".components", `${component.id}.ready`);
}

function componentMarkerReady(environmentRoot, component) {
  try {
    const marker = fs.readFileSync(markerPath(environmentRoot, component), "utf8").trim().split(/\r?\n/);
    return marker[0] === component.id
      && marker[1] === component.integrity
      && component.files.every((file) => fs.existsSync(path.join(environmentRoot, file.path)));
  } catch {
    return false;
  }
}

async function componentVerified(environmentRoot, component) {
  if (!componentMarkerReady(environmentRoot, component)) return false;
  for (const file of component.files) {
    if (!await verifyFile(path.join(environmentRoot, file.path), file.bytes, file.sha256)) return false;
  }
  return true;
}

class ComponentRuntimeInstaller {
  constructor(appRoot, sendEvent = () => {}, options = {}) {
    this.appRoot = path.resolve(appRoot);
    this.runtimeRoot = path.resolve(options.runtimeRoot);
    this.requirementsPath = path.resolve(options.runtimeManifestPath);
    this.sendEvent = sendEvent;
    this.allowFileUrls = Boolean(options.allowFileUrls);
    this.options = options;
    this.installing = null;
    this.cancelRequested = false;
    this.plan = loadRequirementsPlan(this.appRoot, this.requirementsPath, this.allowFileUrls);
    this.baseInstaller = new RuntimeInstaller(this.appRoot, sendEvent, {
      ...options,
      runtimeRoot: this.runtimeRoot,
      runtimeManifestPath: this.plan.environmentManifestPath,
    });
  }

  environmentRoot() {
    return path.join(this.runtimeRoot, "versions", this.plan.environment.runtimeId);
  }

  status() {
    const base = this.baseInstaller.status();
    const environmentRoot = this.environmentRoot();
    const missingComponents = this.plan.components.filter((component) => !componentMarkerReady(environmentRoot, component));
    const baseMissing = base.state !== "ready";
    return {
      ...base,
      state: !baseMissing && missingComponents.length === 0 ? "ready" : "not-installed",
      source: "host",
      installing: Boolean(this.installing),
      installMode: "components",
      archiveBytes: (baseMissing ? Number(base.archiveBytes || 0) : 0)
        + missingComponents.reduce((sum, component) => sum + component.downloadBytes, 0),
      expandedBytes: (baseMissing ? Number(base.expandedBytes || 0) : 0)
        + missingComponents.reduce((sum, component) => sum + component.expandedBytes, 0),
      partCount: (baseMissing ? Number(base.partCount || 0) : 0)
        + missingComponents.reduce((sum, component) => sum + Math.max(1, component.assets.length), 0),
      requiredRuntimeIds: [this.plan.environment.runtimeId, ...this.plan.components.map((component) => component.id)],
      missingRuntimeIds: [
        ...(baseMissing ? [this.plan.environment.runtimeId] : []),
        ...missingComponents.map((component) => component.id),
      ],
    };
  }

  install() {
    if (this.installing) return this.installing;
    this.cancelRequested = false;
    this.installing = this.installRequiredComponents()
      .finally(() => { this.installing = null; })
      .then(() => this.status());
    return this.installing;
  }

  cancel() {
    if (!this.installing) return false;
    this.cancelRequested = true;
    this.baseInstaller.cancelRequested = true;
    this.baseInstaller.abortController?.abort();
    this.baseInstaller.activeChild?.kill();
    return true;
  }

  throwIfCancelled() {
    if (!this.cancelRequested) return;
    const error = new Error("런타임 설치가 취소되었습니다.");
    error.code = "RUNTIME_INSTALL_CANCELLED";
    throw error;
  }

  async installRequiredComponents() {
    await this.baseInstaller.install();
    this.throwIfCancelled();
    for (const component of this.plan.components) {
      if (!await componentVerified(this.environmentRoot(), component)) {
        await this.installComponent(component);
      }
    }
  }

  async installComponent(component) {
    let releaseLock = null;
    const environmentRoot = this.environmentRoot();
    this.baseInstaller.cancelRequested = false;
    this.baseInstaller.abortController = new AbortController();
    try {
      releaseLock = await this.baseInstaller.acquireInstallLock(this.runtimeRoot);
      if (await componentVerified(environmentRoot, component)) return;
      await this.baseInstaller.checkFreeSpace(this.runtimeRoot, {
        downloadBytes: component.downloadBytes,
        expandedBytes: component.expandedBytes,
      });
      this.sendEvent({
        event: "install",
        stage: "installing-component",
        progress: 0,
        runtimeId: component.id,
      });
      const uvExe = path.join(environmentRoot, "tools", "uv.exe");
      const pythonExe = path.join(environmentRoot, this.plan.environment.entrypoint);
      if (!fs.existsSync(uvExe) || !fs.existsSync(pythonExe)) {
        throw new Error("호스트 런타임 기반 구성의 Python 또는 uv를 찾을 수 없습니다.");
      }
      const downloadRoot = path.join(this.runtimeRoot, ".downloads", component.id);
      const workRoot = path.join(this.runtimeRoot, `.component-${component.id}-${process.pid}`);
      await fs.promises.mkdir(downloadRoot, { recursive: true });
      await fs.promises.rm(workRoot, { recursive: true, force: true });
      await fs.promises.mkdir(workRoot, { recursive: true });
      try {
        const assetPaths = new Map();
        const assetBytes = Math.max(1, component.assets.reduce((sum, asset) => sum + asset.bytes, 0));
        let completedBytes = 0;
        for (let index = 0; index < component.assets.length; index += 1) {
          const asset = component.assets[index];
          const assetPath = path.join(downloadRoot, `${asset.id}.zip`);
          await this.baseInstaller.downloadPart(
            asset,
            assetPath,
            completedBytes,
            assetBytes,
            index,
            component.assets.length,
            { progressStart: 0, progressEnd: 20, assetId: asset.id },
          );
          completedBytes += asset.bytes;
          assetPaths.set(asset.role, assetPath);
        }
        this.throwIfCancelled();
        await this.baseInstaller.executeCommand(
          uvExe,
          ["pip", "install", "--python", pythonExe, "-r", component.requirementsFile],
          {
            cwd: this.appRoot,
            env: this.baseInstaller.bootstrapEnvironment(environmentRoot, downloadRoot),
            stage: "installing-component-packages",
            progress: 70,
          },
        );
        if (assetPaths.has("diffsynth")) {
          await this.installDiffSynth(assetPaths.get("diffsynth"), environmentRoot, workRoot);
        }
        await this.probeComponent(component, pythonExe, downloadRoot);
        for (const file of component.files) {
          if (!await verifyFile(path.join(environmentRoot, file.path), file.bytes, file.sha256)) {
            throw new Error(`runtime component verification failed: ${component.id}/${file.path}`);
          }
        }
        const componentsRoot = path.join(environmentRoot, ".components");
        await fs.promises.mkdir(componentsRoot, { recursive: true });
        await fs.promises.writeFile(markerPath(environmentRoot, component), `${component.id}\n${component.integrity}\n`, "utf8");
        await fs.promises.rm(downloadRoot, { recursive: true, force: true });
      } finally {
        await fs.promises.rm(workRoot, { recursive: true, force: true }).catch(() => {});
      }
      this.sendEvent({ event: "install", stage: "component-complete", progress: 100, runtimeId: component.id });
    } finally {
      this.baseInstaller.abortController = null;
      if (releaseLock) await releaseLock();
    }
  }

  async installDiffSynth(archivePath, environmentRoot, workRoot) {
    const extractRoot = path.join(workRoot, "diffsynth");
    await fs.promises.mkdir(extractRoot, { recursive: true });
    const extractZip = this.options.extract || (await import("@electron-internal/extract-zip")).default;
    await extractZip(archivePath, { dir: extractRoot });
    const pyproject = await this.baseInstaller.findPath(
      extractRoot,
      (entry) => entry.name === "pyproject.toml" && entry.isFile(),
    );
    const sourceRoot = pyproject ? path.dirname(pyproject) : null;
    const sourcePackage = sourceRoot ? path.join(sourceRoot, "diffsynth") : null;
    if (!sourcePackage || !fs.existsSync(path.join(sourcePackage, "__init__.py"))) {
      throw new Error("DiffSynth source archive has an unexpected layout.");
    }
    const target = path.join(environmentRoot, "Lib", "site-packages", "diffsynth");
    await fs.promises.rm(target, { recursive: true, force: true });
    await fs.promises.cp(sourcePackage, target, { recursive: true, force: true });
    const license = path.join(sourceRoot, "LICENSE");
    if (fs.existsSync(license)) {
      const licensesRoot = path.join(environmentRoot, "licenses");
      await fs.promises.mkdir(licensesRoot, { recursive: true });
      await fs.promises.copyFile(license, path.join(licensesRoot, "DiffSynth-Studio-LICENSE"));
    }
  }

  async probeComponent(component, pythonExe, downloadRoot) {
    const statements = [`import ${component.imports.join(", ")}`];
    if (component.requireTorchCuda) {
      statements.push("assert torch.cuda.is_available(), 'PyTorch CUDA is unavailable'");
    }
    if (component.requireOnnxCuda) {
      statements.push("assert 'CUDAExecutionProvider' in onnxruntime.get_available_providers(), 'ONNX CUDA provider is unavailable'");
    }
    await this.baseInstaller.executeCommand(
      pythonExe,
      ["-I", "-c", statements.join(";")],
      {
        cwd: this.appRoot,
        env: this.baseInstaller.bootstrapEnvironment(this.environmentRoot(), downloadRoot),
        stage: "probing-component",
        progress: 92,
      },
    );
  }
}

module.exports = { ComponentRuntimeInstaller, componentMarkerReady, loadRequirementsPlan };

