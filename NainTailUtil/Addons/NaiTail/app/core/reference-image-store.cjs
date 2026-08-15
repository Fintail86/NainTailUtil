"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { NainTailError } = require("./errors.cjs");
const { ensureProductDirectories, resolveInside } = require("./paths.cjs");
const { normalizePreciseReferences } = require("./precise-reference.cjs");
const { normalizeVibes, vibeCacheFileName } = require("./vibe-reference.cjs");

const MAX_REFERENCE_PNG_BYTES = 20 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

class ReferenceImageStore {
  constructor(productRoot) {
    this.productRoot = ensureProductDirectories(productRoot);
    this.preciseDirectory = resolveInside(this.productRoot, "References", "precise");
    this.vibeDirectory = resolveInside(this.productRoot, "References", "vibes");
    this.vibeCacheDirectory = resolveInside(this.productRoot, "cache", "vibes");
    for (const directory of [this.preciseDirectory, this.vibeDirectory, this.vibeCacheDirectory]) fs.mkdirSync(directory, { recursive: true });
  }

  savePng(input, directory, type) {
    const data = Buffer.from(String(input.imageBase64 || ""), "base64");
    if (!data.length || data.length > MAX_REFERENCE_PNG_BYTES || !data.subarray(0, 8).equals(PNG_SIGNATURE)) {
      throw new NainTailError("INVALID_REFERENCE_IMAGE", "처리된 이미지 참조는 20MB 이하 PNG여야 합니다.");
    }
    const hash = createHash("sha256").update(data).digest("hex");
    const fileName = `${hash}.png`;
    const absolutePath = resolveInside(directory, fileName);
    if (!fs.existsSync(absolutePath)) fs.writeFileSync(absolutePath, data, { flag: "wx" });
    return {
      id: `${type}_${hash.slice(0, 16)}`,
      name: path.basename(String(input.name || "이미지 참조")).slice(0, 120),
      relativePath: path.relative(this.productRoot, absolutePath).replace(/\\/gu, "/"),
      width: Math.max(1, Math.trunc(Number(input.width) || 1)),
      height: Math.max(1, Math.trunc(Number(input.height) || 1)),
    };
  }

  save(input = {}) {
    return { ...this.savePng(input, this.preciseDirectory, "reference"), mode: "character&style", strength: 1, fidelity: 1 };
  }

  saveVibe(input = {}) {
    return { ...this.savePng(input, this.vibeDirectory, "vibe"), strength: 0.6, informationExtracted: Number(input.informationExtracted ?? 1) };
  }

  hydrateAssets(items, directory, label) {
    return items.map((item) => {
      const absolutePath = resolveInside(this.productRoot, item.relativePath);
      const relativeToReferences = path.relative(directory, absolutePath);
      if (relativeToReferences.startsWith("..") || path.isAbsolute(relativeToReferences) || !fs.existsSync(absolutePath)) {
        throw new NainTailError("REFERENCE_IMAGE_NOT_FOUND", `${item.name} ${label} 자산을 찾을 수 없습니다.`);
      }
      const realDirectory = fs.realpathSync(directory);
      const realPath = fs.realpathSync(absolutePath);
      const realRelative = path.relative(realDirectory, realPath);
      if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) throw new NainTailError("INVALID_REFERENCE_IMAGE", `${item.name} ${label} 자산이 제품 폴더 밖을 가리킵니다.`);
      const data = fs.readFileSync(absolutePath);
      if (!data.length || data.length > MAX_REFERENCE_PNG_BYTES || !data.subarray(0, 8).equals(PNG_SIGNATURE)) throw new NainTailError("INVALID_REFERENCE_IMAGE", `${item.name} ${label} PNG가 올바르지 않습니다.`);
      const expectedFileName = `${createHash("sha256").update(data).digest("hex")}.png`;
      if (path.basename(realPath) !== expectedFileName) throw new NainTailError("INVALID_REFERENCE_IMAGE", `${item.name} ${label} 해시가 파일 내용과 일치하지 않습니다.`);
      return { ...item, image: data.toString("base64") };
    });
  }

  hydrateRequest(request) {
    const preciseReferences = normalizePreciseReferences(request?.preciseReferences);
    const vibes = normalizeVibes(request?.vibes);
    if (preciseReferences.length && vibes.length) throw new NainTailError("INCOMPATIBLE_REFERENCES", "Vibe Transfer와 Precise Reference는 동시에 사용할 수 없습니다.");
    if (!preciseReferences.length && !vibes.length) return request;
    return {
      ...request,
      preciseReferences: this.hydrateAssets(preciseReferences, this.preciseDirectory, "이미지 참조"),
      vibes: this.hydrateAssets(vibes, this.vibeDirectory, "Vibe"),
    };
  }

  vibeCacheStatus(input = {}) {
    const vibes = normalizeVibes(input.vibes);
    return vibes.map((vibe) => ({ id: vibe.id, cached: fs.existsSync(resolveInside(this.vibeCacheDirectory, vibeCacheFileName(vibe, input.model))) }));
  }
}

module.exports = { MAX_REFERENCE_PNG_BYTES, ReferenceImageStore };
