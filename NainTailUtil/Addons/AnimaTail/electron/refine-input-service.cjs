"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const REFINE_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

class RefineInputService {
  constructor() {
    this.items = new Map();
  }

  register(inputPath) {
    if (typeof inputPath !== "string" || !path.isAbsolute(inputPath)) {
      throw new Error("리파인 입력 이미지 경로가 올바르지 않습니다.");
    }
    const absolutePath = path.resolve(inputPath);
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error("리파인 입력은 실제 이미지 파일이어야 합니다.");
    }
    if (!REFINE_IMAGE_EXTENSIONS.has(path.extname(absolutePath).toLowerCase())) {
      throw new Error("PNG, JPG, JPEG, WebP 이미지만 리파인할 수 있습니다.");
    }
    const item = {
      id: randomUUID(),
      absolutePath,
      fileName: path.basename(absolutePath),
      bytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    };
    this.items.clear();
    this.items.set(item.id, item);
    return item;
  }

  resolve(id) {
    const item = this.items.get(String(id)) || null;
    if (!item || !fs.existsSync(item.absolutePath)) return null;
    return item;
  }

  clear() {
    this.items.clear();
  }
}

module.exports = { REFINE_IMAGE_EXTENSIONS, RefineInputService };
