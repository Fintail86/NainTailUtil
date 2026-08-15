"use strict";

const fs = require("node:fs");
const path = require("node:path");

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function resolveOutputItem(appRoot, id) {
  const outputRoot = path.resolve(appRoot, "outputs");
  const normalized = String(id || "").replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "");
  const absolutePath = path.resolve(outputRoot, ...normalized.split("/").filter(Boolean));
  const relativePath = path.relative(outputRoot, absolutePath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) return null;
  if (!IMAGE_EXTENSIONS.has(path.extname(absolutePath).toLowerCase())) return null;
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) return null;
  const sidecar = absolutePath.slice(0, -path.extname(absolutePath).length) + ".json";
  return {
    absolutePath,
    legacySidecarPath: fs.existsSync(sidecar) ? sidecar : null,
  };
}

module.exports = { resolveOutputItem };
