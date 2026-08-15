"use strict";

const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const MAX_DROPPED_IMAGE_BYTES = 256 * 1024 * 1024;

function normalizedOutputPath(input) {
  let outputRelativePath = String(input?.outputRelativePath || "").replace(/^[/\\]+/, "");
  outputRelativePath = path.normalize(outputRelativePath);
  if (!outputRelativePath
    || path.isAbsolute(outputRelativePath)
    || outputRelativePath.split(path.sep).includes("..")) return null;
  return outputRelativePath;
}

function usableDroppedPath(value) {
  if (typeof value !== "string" || !path.isAbsolute(value)) return "";
  const absolutePath = path.resolve(value);
  try {
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) return "";
    fs.accessSync(absolutePath, fs.constants.R_OK);
    return absolutePath;
  } catch {
    return "";
  }
}

function explicitDroppedFile(input) {
  if (!input || typeof input !== "object") return null;
  const absolutePath = usableDroppedPath(input.absolutePath);
  const outputRelativePath = normalizedOutputPath(input);
  if (!absolutePath || !IMAGE_EXTENSIONS.has(path.extname(absolutePath).toLowerCase()) || !outputRelativePath) return null;
  try {
    if (!fs.statSync(absolutePath).isFile()) return null;
  } catch {
    return null;
  }
  return { absolutePath, outputRelativePath };
}

function materializeDroppedFile(input, cacheRoot) {
  if (!input || typeof input !== "object" || !cacheRoot) return null;
  const outputRelativePath = normalizedOutputPath(input);
  const extension = path.extname(outputRelativePath || String(input.fileName || "")).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension) || !outputRelativePath) return null;

  let bytes;
  try {
    bytes = Buffer.from(input.bytes || []);
  } catch {
    return null;
  }
  if (bytes.length === 0 || bytes.length > MAX_DROPPED_IMAGE_BYTES) return null;

  const digest = createHash("sha256").update(bytes).digest("hex");
  const absolutePath = path.join(path.resolve(cacheRoot), `${digest}${extension}`);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  if (!fs.existsSync(absolutePath)) fs.writeFileSync(absolutePath, bytes);
  return { absolutePath, outputRelativePath };
}

module.exports = { explicitDroppedFile, materializeDroppedFile, usableDroppedPath };
