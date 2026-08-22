"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pipeline } = require("node:stream/promises");
const { Readable } = require("node:stream");
const { inside, readAddon } = require("./addon-registry.cjs");

const REPOSITORY = "Fintail86/NainTailUtil";
const RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const REMOTE_CATALOG_ASSET = "official-addons.json";
const CATALOG_SCHEMA = "naintail.official-addons/v1";
const ADDON_ID = /^[a-z][a-z0-9.-]*$/u;
const ADDON_NAME = /^[A-Za-z][A-Za-z0-9.-]*$/u;
const VERSION = /^(\d+)\.(\d+)\.(\d+)$/u;
const VERSION_TAG = /^v\d+\.\d+\.\d+$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024 * 1024;
const MAX_CATALOG_BYTES = 1024 * 1024;

const LEGACY_OFFICIAL_ADDONS = Object.freeze({
  NaiTail: { id: "naitail", name: "NaiTail", order: 1, description: "NovelAI 이미지 생성 애드온" },
  AnimaTail: { id: "animatail", name: "AnimaTail", order: 2, description: "로컬 이미지 생성 스튜디오" },
  GalleryTail: { id: "gallerytail", name: "GalleryTail", order: 3, description: "공용·포터블 출력 탐색기" },
  CensorTail: { id: "censortail", name: "CensorTail", order: 4, description: "로컬 이미지 검열 도구" },
});
const LEGACY_ASSET_PATTERN = /^(NaiTail|AnimaTail|GalleryTail|CensorTail)-v(\d+\.\d+\.\d+)-win-x64\.zip$/u;

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024 * 1024) return `${Math.max(1, Math.ceil(value / 1024))} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function compareVersions(left, right) {
  const leftMatch = String(left || "").match(VERSION);
  const rightMatch = String(right || "").match(VERSION);
  if (!leftMatch || !rightMatch) return null;
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(leftMatch[index]) - Number(rightMatch[index]);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

function trustedAssetUrl(value, tag, assetName) {
  const url = new URL(String(value || ""));
  const expected = `/${REPOSITORY}/releases/download/${tag}/${assetName}`;
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.pathname !== expected) {
    throw new Error(`공식 GitHub 릴리즈 경로가 아닌 파일입니다: ${assetName}`);
  }
  return url.href;
}

function officialDownloadUrl(tag, assetName) {
  if (!VERSION_TAG.test(String(tag || ""))) throw new Error(`릴리즈 태그가 올바르지 않습니다: ${tag}`);
  return trustedAssetUrl(`https://github.com/${REPOSITORY}/releases/download/${tag}/${assetName}`, tag, assetName);
}

function normalizePreservePath(value, addonId) {
  const normalized = String(value || "").replaceAll("\\", "/").replace(/^\.\//u, "");
  const segments = normalized.split("/");
  if (!normalized || path.posix.isAbsolute(normalized) || segments.some((part) => !part || part === "." || part === ".." || part.includes(":"))) {
    throw new Error(`보존 경로가 올바르지 않습니다: ${addonId}/${value}`);
  }
  return normalized;
}

function parseOfficialCatalog(document) {
  if (!document || document.schema !== CATALOG_SCHEMA || document.repository !== REPOSITORY) {
    throw new Error("공식 애드온 카탈로그 계약이 올바르지 않습니다.");
  }
  if (!Number.isInteger(document.catalogVersion) || document.catalogVersion < 1) {
    throw new Error("공식 애드온 카탈로그 버전이 올바르지 않습니다.");
  }
  if (!Array.isArray(document.addons) || !document.addons.length || document.addons.length > 100) {
    throw new Error("공식 애드온 카탈로그 목록이 올바르지 않습니다.");
  }
  const seenIds = new Set();
  const seenAssets = new Set();
  const addons = document.addons.map((raw) => {
    const id = String(raw?.id || "");
    const name = String(raw?.name || "");
    const version = String(raw?.version || "");
    const releaseTag = String(raw?.releaseTag || "");
    const assetName = String(raw?.assetName || "");
    const bytes = Number(raw?.bytes);
    const sha256 = String(raw?.sha256 || "").toLowerCase();
    if (!ADDON_ID.test(id) || !ADDON_NAME.test(name) || !VERSION.test(version) || !VERSION_TAG.test(releaseTag)) {
      throw new Error(`공식 애드온 식별 정보가 올바르지 않습니다: ${id || name || "unknown"}`);
    }
    if (assetName !== `${name}-v${version}-win-x64.zip`) throw new Error(`공식 애드온 파일명이 버전과 일치하지 않습니다: ${id}`);
    if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_ARCHIVE_BYTES || !SHA256.test(sha256)) {
      throw new Error(`공식 애드온 무결성 정보가 올바르지 않습니다: ${id}`);
    }
    if (seenIds.has(id) || seenAssets.has(`${releaseTag}/${assetName}`)) throw new Error(`중복된 공식 애드온입니다: ${id}`);
    seenIds.add(id);
    seenAssets.add(`${releaseTag}/${assetName}`);
    const preservePaths = Array.isArray(raw.preservePaths)
      ? [...new Set(raw.preservePaths.map((item) => normalizePreservePath(item, id)))]
      : [];
    return Object.freeze({
      id,
      name,
      description: String(raw.description || "공식 NainTail 애드온").slice(0, 200),
      order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : Number.MAX_SAFE_INTEGER,
      version,
      releaseTag,
      assetName,
      size: bytes,
      sizeLabel: formatBytes(bytes),
      sha256,
      preservePaths,
      downloadUrl: officialDownloadUrl(releaseTag, assetName),
    });
  });
  addons.sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));
  return Object.freeze({ schema: CATALOG_SCHEMA, catalogVersion: document.catalogVersion, repository: REPOSITORY, addons: Object.freeze(addons) });
}

function parseRelease(release) {
  if (!release || release.draft === true || release.prerelease === true) throw new Error("설치 가능한 공식 정식 릴리즈가 없습니다.");
  const version = String(release.tag_name || "").match(/^v(\d+\.\d+\.\d+)$/u)?.[1];
  if (!version) throw new Error("공식 릴리즈 버전을 확인할 수 없습니다.");
  const seen = new Set();
  const addons = [];
  for (const asset of Array.isArray(release.assets) ? release.assets : []) {
    const match = String(asset?.name || "").match(LEGACY_ASSET_PATTERN);
    if (!match || match[2] !== version || asset.state !== "uploaded") continue;
    const definition = LEGACY_OFFICIAL_ADDONS[match[1]];
    const digest = String(asset.digest || "").match(/^sha256:([a-f0-9]{64})$/u)?.[1];
    const size = Number(asset.size);
    if (!definition || !digest || !Number.isSafeInteger(size) || size <= 0 || size > MAX_ARCHIVE_BYTES) continue;
    if (seen.has(definition.id)) throw new Error(`중복된 공식 애드온 파일입니다: ${definition.name}`);
    seen.add(definition.id);
    addons.push({
      ...definition,
      version,
      releaseTag: release.tag_name,
      assetName: asset.name,
      size,
      sizeLabel: formatBytes(size),
      sha256: digest,
      preservePaths: [],
      downloadUrl: trustedAssetUrl(asset.browser_download_url, release.tag_name, asset.name),
    });
  }
  addons.sort((left, right) => left.order - right.order);
  if (!addons.length) throw new Error("무결성 정보가 포함된 공식 애드온 파일을 찾지 못했습니다.");
  return { version, tag: release.tag_name, publishedAt: release.published_at || null, addons };
}

async function fetchReleaseDocument(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new Error("이 런타임에서는 공식 릴리즈 조회를 지원하지 않습니다.");
  const response = await fetchImpl(RELEASE_API, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "NainTail-Host" },
    redirect: "error",
  });
  if (!response.ok) throw new Error(`공식 릴리즈 조회 실패 (HTTP ${response.status})`);
  return response.json();
}

async function fetchLatestRelease(fetchImpl = globalThis.fetch) {
  return parseRelease(await fetchReleaseDocument(fetchImpl));
}

async function fetchBytes(url, maximumBytes, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(url, {
    headers: { Accept: "application/octet-stream", "User-Agent": "NainTail-Host" },
    redirect: "follow",
  });
  if (!response.ok || !response.body) throw new Error(`공식 파일 다운로드 실패 (HTTP ${response.status})`);
  const statedLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(statedLength) && statedLength > maximumBytes) throw new Error("공식 파일이 허용 크기를 초과합니다.");
  const chunks = [];
  let total = 0;
  for await (const chunk of Readable.fromWeb(response.body)) {
    total += chunk.length;
    if (total > maximumBytes) throw new Error("공식 파일이 허용 크기를 초과합니다.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest("hex");
}

async function downloadFile(asset, destination, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(asset.downloadUrl, {
    headers: { Accept: "application/octet-stream", "User-Agent": "NainTail-Host" },
    redirect: "follow",
  });
  if (!response.ok || !response.body) throw new Error(`애드온 다운로드 실패 (HTTP ${response.status})`);
  const statedLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(statedLength) && statedLength !== asset.size) throw new Error("다운로드 파일 크기가 카탈로그와 다릅니다.");
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination, { flags: "wx" }));
  if (fs.statSync(destination).size !== asset.size) throw new Error("다운로드가 완전하지 않습니다.");
}

function runExtractor(scriptPath, archivePath, stagingRoot, folderName) {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", scriptPath, "-ArchivePath", archivePath, "-DestinationRoot", stagingRoot, "-ExpectedRoot", folderName,
    ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `애드온 압축 해제 실패 (code ${code})`)));
  });
}

function installedMap(installedAddons) {
  return new Map((Array.isArray(installedAddons) ? installedAddons : []).map((addon) => [String(addon.id), addon]));
}

function publicCatalogAddon(addon, local) {
  const comparison = local ? compareVersions(local.version, addon.version) : null;
  const state = !local ? "missing"
    : comparison === 0 ? "current"
      : comparison === -1 ? "update"
        : comparison === 1 ? "local-newer" : "unknown";
  return {
    id: addon.id,
    name: addon.name,
    description: addon.description,
    order: addon.order,
    version: addon.version,
    localVersion: local?.version || null,
    assetName: addon.assetName,
    size: addon.size,
    sizeLabel: addon.sizeLabel,
    installed: Boolean(local),
    state,
    action: state === "missing" ? "install" : state === "update" ? "update" : null,
  };
}

function movePreservedPaths(previousRoot, nextRoot, preservePaths, moved = []) {
  for (const relativePath of preservePaths) {
    const source = path.resolve(previousRoot, relativePath);
    const destination = path.resolve(nextRoot, relativePath);
    if (!inside(previousRoot, source) || !inside(nextRoot, destination)) throw new Error(`보존 경계가 올바르지 않습니다: ${relativePath}`);
    if (!fs.existsSync(source)) continue;
    if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.renameSync(source, destination);
    moved.push({ source, destination });
  }
  return moved;
}

function rollbackUpdate(target, previousRoot, extractedRoot, moved) {
  try {
    if (fs.existsSync(target) && !fs.existsSync(extractedRoot)) fs.renameSync(target, extractedRoot);
    for (const item of [...moved].reverse()) {
      if (!fs.existsSync(item.destination)) continue;
      fs.mkdirSync(path.dirname(item.source), { recursive: true });
      fs.renameSync(item.destination, item.source);
    }
    if (fs.existsSync(previousRoot) && !fs.existsSync(target)) fs.renameSync(previousRoot, target);
    return fs.existsSync(target);
  } catch {
    return false;
  }
}

class OfficialAddonInstaller {
  constructor(productRoot, options = {}) {
    this.productRoot = path.resolve(productRoot);
    this.addonsRoot = path.join(this.productRoot, "Addons");
    this.bundledCatalogPath = options.bundledCatalogPath || path.join(this.productRoot, "app", "host", "catalog", REMOTE_CATALOG_ASSET);
    this.cachePath = options.cachePath || path.join(this.productRoot, "runtime", "catalog", REMOTE_CATALOG_ASSET);
    this.extractScript = options.extractScript || path.join(this.productRoot, "app", "workers", "extract-official-addon.ps1");
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.fetchRelease = options.fetchRelease || (() => fetchReleaseDocument(this.fetchImpl));
    this.download = options.download || ((asset, destination) => downloadFile(asset, destination, this.fetchImpl));
    this.extract = options.extract || ((archive, staging, folder) => runExtractor(this.extractScript, archive, staging, folder));
    this.catalogSnapshot = this.loadInitialCatalog();
    this.refreshPromise = null;
    this.refreshAttempted = false;
    this.lastRefreshError = null;
  }

  readCatalog(filePath) {
    return parseOfficialCatalog(JSON.parse(fs.readFileSync(filePath, "utf8")));
  }

  loadInitialCatalog() {
    const bundled = this.readCatalog(this.bundledCatalogPath);
    if (fs.existsSync(this.cachePath)) {
      try {
        const cached = this.readCatalog(this.cachePath);
        if (cached.catalogVersion >= bundled.catalogVersion) {
          this.catalogSource = "cache";
          return cached;
        }
      } catch { /* Fall through to the immutable bundled seed. */ }
    }
    this.catalogSource = "bundled";
    return bundled;
  }

  writeCache(catalog) {
    const directory = path.dirname(this.cachePath);
    fs.mkdirSync(directory, { recursive: true });
    const temporary = path.join(directory, `${REMOTE_CATALOG_ASSET}.${process.pid}.tmp`);
    const previous = path.join(directory, `${REMOTE_CATALOG_ASSET}.previous`);
    fs.writeFileSync(temporary, `${JSON.stringify({
      schema: catalog.schema,
      catalogVersion: catalog.catalogVersion,
      repository: catalog.repository,
      addons: catalog.addons.map(({ size, downloadUrl, sizeLabel, ...addon }) => ({ ...addon, bytes: size })),
    }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    if (fs.existsSync(previous)) fs.rmSync(previous, { force: true });
    if (fs.existsSync(this.cachePath)) fs.renameSync(this.cachePath, previous);
    try {
      fs.renameSync(temporary, this.cachePath);
      if (fs.existsSync(previous)) fs.rmSync(previous, { force: true });
    } catch (error) {
      if (fs.existsSync(previous) && !fs.existsSync(this.cachePath)) fs.renameSync(previous, this.cachePath);
      throw error;
    } finally {
      if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    }
  }

  async refreshCatalog(force = false) {
    if (this.refreshPromise) return this.refreshPromise;
    if (this.refreshAttempted && !force) return { source: this.catalogSource, catalog: this.catalogSnapshot, warning: this.lastRefreshError };
    this.refreshAttempted = true;
    this.refreshPromise = (async () => {
      try {
        const release = await this.fetchRelease();
        const asset = (Array.isArray(release.assets) ? release.assets : []).find((item) => item?.name === REMOTE_CATALOG_ASSET && item.state === "uploaded");
        const digest = String(asset?.digest || "").match(/^sha256:([a-f0-9]{64})$/u)?.[1];
        const bytes = Number(asset?.size);
        if (!asset || !digest || !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_CATALOG_BYTES) {
          throw new Error("최신 릴리즈에 검증 가능한 공식 애드온 카탈로그가 없습니다.");
        }
        const url = trustedAssetUrl(asset.browser_download_url, release.tag_name, REMOTE_CATALOG_ASSET);
        const payload = await fetchBytes(url, MAX_CATALOG_BYTES, this.fetchImpl);
        if (payload.length !== bytes || crypto.createHash("sha256").update(payload).digest("hex") !== digest) {
          throw new Error("공식 애드온 카탈로그 무결성 검증에 실패했습니다.");
        }
        const catalog = parseOfficialCatalog(JSON.parse(payload.toString("utf8")));
        if (catalog.catalogVersion < this.catalogSnapshot.catalogVersion) throw new Error("공식 애드온 카탈로그가 현재 버전보다 오래되었습니다.");
        for (const addon of catalog.addons.filter((item) => item.releaseTag === release.tag_name)) {
          const releaseAsset = release.assets.find((item) => item.name === addon.assetName && item.state === "uploaded");
          if (!releaseAsset || releaseAsset.size !== addon.size || releaseAsset.digest !== `sha256:${addon.sha256}`) {
            throw new Error(`카탈로그와 최신 릴리즈 파일이 일치하지 않습니다: ${addon.id}`);
          }
        }
        this.writeCache(catalog);
        this.catalogSnapshot = catalog;
        this.catalogSource = "remote";
        this.lastRefreshError = null;
      } catch (error) {
        this.lastRefreshError = error instanceof Error ? error.message : String(error);
      }
      return { source: this.catalogSource, catalog: this.catalogSnapshot, warning: this.lastRefreshError };
    })().finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }

  async catalog(installedAddons = []) {
    await this.refreshCatalog();
    const installed = installedMap(installedAddons);
    const addons = this.catalogSnapshot.addons.map((addon) => publicCatalogAddon(addon, installed.get(addon.id)));
    return {
      catalogVersion: this.catalogSnapshot.catalogVersion,
      source: this.catalogSource,
      warning: this.lastRefreshError,
      addons,
      summary: {
        missing: addons.filter((addon) => addon.state === "missing").length,
        updates: addons.filter((addon) => addon.state === "update").length,
      },
    };
  }

  async install(id, installedAddons = []) {
    const installed = installedMap(installedAddons);
    const local = installed.get(String(id)) || null;
    const asset = this.catalogSnapshot.addons.find((item) => item.id === id);
    if (!asset) throw new Error(`공식 카탈로그에서 애드온을 찾을 수 없습니다: ${id}`);
    const comparison = local ? compareVersions(local.version, asset.version) : null;
    const action = !local ? "install" : comparison === -1 ? "update" : null;
    if (!action) throw new Error(comparison === 0 ? `이미 최신 버전입니다: ${id}` : `자동 업데이트할 수 없는 버전입니다: ${id}`);

    fs.mkdirSync(this.addonsRoot, { recursive: true });
    const target = local?.directory ? path.resolve(local.directory) : path.join(this.addonsRoot, asset.name);
    if (!inside(this.addonsRoot, target) || path.dirname(target) !== this.addonsRoot) throw new Error(`애드온 설치 위치를 사용할 수 없습니다: ${asset.name}`);
    if (action === "install" && fs.existsSync(target)) throw new Error(`애드온 설치 위치가 이미 존재합니다: ${asset.name}`);
    if (action === "update" && !fs.existsSync(target)) throw new Error(`업데이트할 애드온 폴더가 없습니다: ${asset.name}`);

    const temporaryRoot = fs.mkdtempSync(path.join(this.addonsRoot, ".install-"));
    const archive = path.join(temporaryRoot, asset.assetName);
    const staging = path.join(temporaryRoot, "staging");
    const previousRoot = path.join(temporaryRoot, "previous");
    let preserveTemporary = false;
    try {
      fs.mkdirSync(staging);
      await this.download(asset, archive);
      if (await sha256File(archive) !== asset.sha256) throw new Error("다운로드한 애드온의 SHA-256이 공식 카탈로그와 다릅니다.");
      await this.extract(archive, staging, asset.name);
      const extracted = path.join(staging, asset.name);
      const manifest = readAddon(extracted);
      if (!manifest || manifest.id !== asset.id || manifest.name !== asset.name || manifest.version !== asset.version) {
        throw new Error("애드온 manifest가 공식 카탈로그와 일치하지 않습니다.");
      }
      for (const relativeEntry of Object.values(manifest.entries)) {
        const entry = path.resolve(extracted, relativeEntry);
        if (!inside(extracted, entry) || !fs.existsSync(entry)) throw new Error(`애드온 entry가 올바르지 않습니다: ${relativeEntry}`);
      }

      if (action === "install") {
        fs.renameSync(extracted, target);
      } else {
        fs.renameSync(target, previousRoot);
        const moved = [];
        try {
          movePreservedPaths(previousRoot, extracted, asset.preservePaths, moved);
          fs.renameSync(extracted, target);
        } catch (error) {
          if (!rollbackUpdate(target, previousRoot, extracted, moved)) preserveTemporary = true;
          throw error;
        }
      }
      return {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        action,
        installed: true,
        requiresHostRestart: action === "update" || (Array.isArray(manifest.protocols) && manifest.protocols.length > 0),
      };
    } finally {
      if (!preserveTemporary) fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }
}

module.exports = {
  CATALOG_SCHEMA,
  LEGACY_ASSET_PATTERN,
  LEGACY_OFFICIAL_ADDONS,
  OfficialAddonInstaller,
  compareVersions,
  fetchLatestRelease,
  parseOfficialCatalog,
  parseRelease,
  trustedAssetUrl,
};
