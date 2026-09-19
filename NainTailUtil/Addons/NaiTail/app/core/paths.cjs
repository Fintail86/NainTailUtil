"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PRODUCT_DIRECTORIES = Object.freeze([
  "runtime",
  "Presets/sub-slots",
  "Presets/examples",
  "Presets/characters",
  "References/precise",
  "References/vibes",
  "Projects",
  "Favorites",
  "Favorites/Searching",
  "Favorites/Pounding",
  "outputs",
  "cache",
  "cache/vibes",
  "config",
  "logs",
  "licenses",
]);

function defaultProductRoot() {
  return path.resolve(__dirname, "..", "..");
}

function resolveProductRoot(explicitRoot) {
  return path.resolve(explicitRoot || defaultProductRoot());
}

function ensureProductDirectories(productRoot) {
  const root = resolveProductRoot(productRoot);
  for (const relativePath of PRODUCT_DIRECTORIES) {
    fs.mkdirSync(path.join(root, relativePath), { recursive: true });
  }
  return root;
}

function resolveInside(root, ...segments) {
  const base = path.resolve(root);
  const candidate = path.resolve(base, ...segments);
  const relative = path.relative(base, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`제품 루트 바깥 경로는 사용할 수 없습니다: ${candidate}`);
  }
  return candidate;
}

module.exports = {
  PRODUCT_DIRECTORIES,
  defaultProductRoot,
  ensureProductDirectories,
  resolveInside,
  resolveProductRoot,
};
