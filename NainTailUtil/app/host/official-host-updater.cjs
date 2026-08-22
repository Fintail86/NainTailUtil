"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pipeline } = require("node:stream/promises");
const { Readable } = require("node:stream");
const { compareVersions } = require("./official-addon-installer.cjs");

const REPOSITORY = "Fintail86/NainTailUtil";
const RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const REMOTE_HOST_ASSET = "official-host.json";
const HOST_SCHEMA = "naintail.official-host/v1";
const TRANSACTION_SCHEMA = "naintail.host-update-transaction/v1";
const VERSION = /^(\d+)\.(\d+)\.(\d+)$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const PRESERVE_PATHS = Object.freeze(["Addons", "config", "outputs", "runtime"]);

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024 * 1024) return `${Math.max(1, Math.ceil(value / 1024))} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function trustedAssetUrl(value, tag, assetName) {
  const url = new URL(String(value || ""));
  const expected = `/${REPOSITORY}/releases/download/${tag}/${assetName}`;
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.pathname !== expected) {
    throw new Error(`공식 GitHub 호스트 릴리즈 경로가 아닙니다: ${assetName}`);
  }
  return url.href;
}

function parseOfficialHost(document) {
  if (!document || document.schema !== HOST_SCHEMA || document.repository !== REPOSITORY) {
    throw new Error("공식 호스트 업데이트 계약이 올바르지 않습니다.");
  }
  const version = String(document.version || "");
  const releaseTag = String(document.releaseTag || "");
  const assetName = String(document.assetName || "");
  const bytes = Number(document.bytes);
  const sha256 = String(document.sha256 || "").toLowerCase();
  if (!VERSION.test(version) || releaseTag !== `host-v${version}`) {
    throw new Error("공식 호스트 버전 또는 릴리즈 태그가 올바르지 않습니다.");
  }
  if (assetName !== `NainTail-v${version}-win-x64.zip`) {
    throw new Error("공식 호스트 ZIP 파일명이 버전과 일치하지 않습니다.");
  }
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_ARCHIVE_BYTES || !SHA256.test(sha256)) {
    throw new Error("공식 호스트 무결성 정보가 올바르지 않습니다.");
  }
  return Object.freeze({
    schema: HOST_SCHEMA,
    repository: REPOSITORY,
    version,
    releaseTag,
    assetName,
    bytes,
    sizeLabel: formatBytes(bytes),
    sha256,
    publishedAt: document.publishedAt ? String(document.publishedAt) : null,
    downloadUrl: trustedAssetUrl(
      `https://github.com/${REPOSITORY}/releases/download/${releaseTag}/${assetName}`,
      releaseTag,
      assetName,
    ),
  });
}

async function fetchLatestRelease(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new Error("이 런타임에서는 호스트 업데이트 조회를 지원하지 않습니다.");
  const response = await fetchImpl(RELEASE_API, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "NainTail-Host-Updater" },
    redirect: "error",
  });
  if (!response.ok) throw new Error(`공식 호스트 릴리즈 조회 실패 (HTTP ${response.status})`);
  return response.json();
}

async function fetchBytes(url, maximumBytes, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(url, {
    headers: { Accept: "application/octet-stream", "User-Agent": "NainTail-Host-Updater" },
    redirect: "follow",
  });
  if (!response.ok || !response.body) throw new Error(`공식 호스트 파일 다운로드 실패 (HTTP ${response.status})`);
  const statedLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(statedLength) && statedLength > maximumBytes) throw new Error("공식 호스트 파일이 허용 크기를 초과합니다.");
  const chunks = [];
  let total = 0;
  for await (const chunk of Readable.fromWeb(response.body)) {
    total += chunk.length;
    if (total > maximumBytes) throw new Error("공식 호스트 파일이 허용 크기를 초과합니다.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

async function downloadFile(asset, destination, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(asset.downloadUrl, {
    headers: { Accept: "application/octet-stream", "User-Agent": "NainTail-Host-Updater" },
    redirect: "follow",
  });
  if (!response.ok || !response.body) throw new Error(`호스트 업데이트 다운로드 실패 (HTTP ${response.status})`);
  const statedLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(statedLength) && statedLength !== asset.bytes) throw new Error("호스트 업데이트 크기가 manifest와 다릅니다.");
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination, { flags: "wx" }));
  if (fs.statSync(destination).size !== asset.bytes) throw new Error("호스트 업데이트 다운로드가 완전하지 않습니다.");
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest("hex");
}

function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  const previous = `${filePath}.previous`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  fs.rmSync(previous, { force: true });
  if (fs.existsSync(filePath)) fs.renameSync(filePath, previous);
  try {
    fs.renameSync(temporary, filePath);
    fs.rmSync(previous, { force: true });
  } catch (error) {
    if (fs.existsSync(previous) && !fs.existsSync(filePath)) fs.renameSync(previous, filePath);
    throw error;
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function runExtractor(scriptPath, archivePath, destinationRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", scriptPath, "-ArchivePath", archivePath, "-DestinationRoot", destinationRoot, "-ExpectedRoot", "NainTail",
    ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `호스트 압축 해제 실패 (code ${code})`)));
  });
}

function publicStatus(currentVersion, available, source, warning) {
  const comparison = available ? compareVersions(currentVersion, available.version) : null;
  const state = !available ? "unavailable"
    : comparison === 0 ? "current"
      : comparison === -1 ? "update"
        : comparison === 1 ? "local-newer" : "unknown";
  return {
    currentVersion,
    availableVersion: available?.version || null,
    releaseTag: available?.releaseTag || null,
    assetName: available?.assetName || null,
    size: available?.bytes || null,
    sizeLabel: available?.sizeLabel || null,
    publishedAt: available?.publishedAt || null,
    source,
    warning: warning || null,
    state,
    action: state === "update" ? "update" : null,
  };
}

class OfficialHostUpdater {
  constructor(productRoot, options = {}) {
    this.productRoot = path.resolve(productRoot);
    this.productParent = path.dirname(this.productRoot);
    this.productName = path.basename(this.productRoot);
    this.packagePath = options.packagePath || path.join(this.productRoot, "package.json");
    this.currentVersion = String(options.currentVersion || JSON.parse(fs.readFileSync(this.packagePath, "utf8")).version || "");
    if (!VERSION.test(this.currentVersion)) throw new Error("현재 호스트 버전이 올바르지 않습니다.");
    this.cachePath = options.cachePath || path.join(this.productRoot, "runtime", "catalog", REMOTE_HOST_ASSET);
    this.extractScript = options.extractScript || path.join(this.productRoot, "app", "workers", "extract-official-addon.ps1");
    this.applyScript = options.applyScript || path.join(this.productRoot, "bootstrap", "apply-host-update.ps1");
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.fetchRelease = options.fetchRelease || (() => fetchLatestRelease(this.fetchImpl));
    this.download = options.download || ((asset, destination) => downloadFile(asset, destination, this.fetchImpl));
    this.extract = options.extract || ((archive, destination) => runExtractor(this.extractScript, archive, destination));
    this.snapshot = this.readCachedManifest();
    this.source = this.snapshot ? "cache" : "none";
    this.lastRefreshError = null;
    this.refreshPromise = null;
  }

  readCachedManifest() {
    if (!fs.existsSync(this.cachePath)) return null;
    try {
      return parseOfficialHost(JSON.parse(fs.readFileSync(this.cachePath, "utf8")));
    } catch {
      return null;
    }
  }

  writeCache(manifest) {
    writeJsonAtomic(this.cachePath, {
      schema: manifest.schema,
      repository: manifest.repository,
      version: manifest.version,
      releaseTag: manifest.releaseTag,
      assetName: manifest.assetName,
      bytes: manifest.bytes,
      sha256: manifest.sha256,
      publishedAt: manifest.publishedAt,
    });
  }

  async refresh(force = false) {
    if (this.refreshPromise) return this.refreshPromise;
    if (!force && this.source === "remote") return this.status(false);
    this.refreshPromise = (async () => {
      try {
        const release = await this.fetchRelease();
        if (!release || release.draft === true || release.prerelease === true) throw new Error("확인 가능한 공식 정식 릴리즈가 없습니다.");
        const asset = (Array.isArray(release.assets) ? release.assets : []).find((item) => item?.name === REMOTE_HOST_ASSET && item.state === "uploaded");
        const digest = String(asset?.digest || "").match(/^sha256:([a-f0-9]{64})$/u)?.[1];
        const bytes = Number(asset?.size);
        if (!asset || !digest || !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_MANIFEST_BYTES) {
          throw new Error("최신 릴리즈에 검증 가능한 호스트 업데이트 manifest가 없습니다.");
        }
        const url = trustedAssetUrl(asset.browser_download_url, String(release.tag_name || ""), REMOTE_HOST_ASSET);
        const payload = await fetchBytes(url, MAX_MANIFEST_BYTES, this.fetchImpl);
        if (payload.length !== bytes || crypto.createHash("sha256").update(payload).digest("hex") !== digest) {
          throw new Error("호스트 업데이트 manifest 무결성 검증에 실패했습니다.");
        }
        const manifest = parseOfficialHost(JSON.parse(payload.toString("utf8")));
        if (this.snapshot && compareVersions(manifest.version, this.snapshot.version) === -1) {
          throw new Error("공식 호스트 업데이트 정보가 마지막 정상 버전보다 오래되었습니다.");
        }
        this.writeCache(manifest);
        this.snapshot = manifest;
        this.source = "remote";
        this.lastRefreshError = null;
      } catch (error) {
        this.lastRefreshError = error instanceof Error ? error.message : String(error);
      }
      return this.status(false);
    })().finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }

  async status(refresh = true) {
    if (refresh) return this.refresh();
    return publicStatus(this.currentVersion, this.snapshot, this.source, this.lastRefreshError);
  }

  transactionPath() {
    return path.join(this.productParent, `.${this.productName}.host-update.json`);
  }

  async prepare(expectedVersion = null) {
    let status = await this.status(false);
    if (!this.snapshot) status = await this.refresh(true);
    if (status.state !== "update" || !this.snapshot) {
      throw new Error(status.state === "current" ? "NainTail 호스트가 이미 최신 버전입니다." : "설치 가능한 호스트 업데이트가 없습니다.");
    }
    if (expectedVersion && this.snapshot.version !== expectedVersion) {
      throw new Error("확인한 호스트 업데이트 버전이 변경되었습니다. 다시 확인하세요.");
    }
    const transactionPath = this.transactionPath();
    if (fs.existsSync(transactionPath)) throw new Error("완료되지 않은 호스트 업데이트가 있습니다. NainTail을 다시 실행해 복구하세요.");
    const workRoot = fs.mkdtempSync(path.join(this.productParent, `.${this.productName}.host-update-`));
    const archivePath = path.join(workRoot, this.snapshot.assetName);
    const extractedRoot = path.join(workRoot, "extracted");
    let transactionWritten = false;
    try {
      fs.mkdirSync(extractedRoot);
      await this.download(this.snapshot, archivePath);
      if (await sha256File(archivePath) !== this.snapshot.sha256) throw new Error("호스트 업데이트 ZIP의 SHA-256이 공식 manifest와 다릅니다.");
      await this.extract(archivePath, extractedRoot);
      const stagedRoot = path.join(extractedRoot, "NainTail");
      const packagePath = path.join(stagedRoot, "package.json");
      if (!fs.existsSync(packagePath)) throw new Error("호스트 업데이트에 package.json이 없습니다.");
      const packageInfo = JSON.parse(fs.readFileSync(packagePath, "utf8"));
      if (packageInfo.name !== "naintailutil" || packageInfo.version !== this.snapshot.version) {
        throw new Error("호스트 업데이트 package 버전이 공식 manifest와 일치하지 않습니다.");
      }
      for (const required of ["NainTailUtil.bat", "app/electron/main.cjs", "bootstrap/apply-host-update.ps1"]) {
        if (!fs.existsSync(path.join(stagedRoot, ...required.split("/")))) throw new Error(`호스트 업데이트 필수 파일이 없습니다: ${required}`);
      }
      const transaction = {
        schema: TRANSACTION_SCHEMA,
        phase: "prepared",
        productRoot: this.productRoot,
        stagedRoot,
        workRoot,
        backupRoot: path.join(this.productParent, `.${this.productName}.host-backup`),
        preservePaths: [...PRESERVE_PATHS],
        targetVersion: this.snapshot.version,
        launcher: "NainTailUtil.bat",
        createdAt: new Date().toISOString(),
      };
      writeJsonAtomic(transactionPath, transaction);
      transactionWritten = true;
      return { ...status, prepared: true, transactionPath };
    } finally {
      if (!transactionWritten) fs.rmSync(workRoot, { recursive: true, force: true });
    }
  }

  launch(transactionPath, waitForPid = process.pid) {
    if (!fs.existsSync(this.applyScript)) throw new Error("호스트 업데이트 적용 스크립트가 없습니다.");
    const child = spawn("powershell.exe", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", this.applyScript,
      "-TransactionPath", path.resolve(transactionPath),
      "-WaitForPid", String(waitForPid),
      "-Restart",
    ], { detached: true, windowsHide: true, stdio: "ignore" });
    child.unref();
    return { launched: true, targetVersion: this.snapshot?.version || null };
  }
}

module.exports = {
  HOST_SCHEMA,
  OfficialHostUpdater,
  PRESERVE_PATHS,
  REMOTE_HOST_ASSET,
  TRANSACTION_SCHEMA,
  parseOfficialHost,
  publicStatus,
};
