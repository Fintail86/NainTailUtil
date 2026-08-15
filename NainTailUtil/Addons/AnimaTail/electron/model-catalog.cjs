"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CATEGORIES = Object.freeze({
  diffusion_models: "models",
  loras: "loras",
});

function scanSafetensors(root, category) {
  const categoryRoot = path.join(root, "Models", category);
  if (!fs.existsSync(categoryRoot)) return [];

  const files = [];
  const pending = [categoryRoot];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolutePath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".safetensors")) {
        const stat = fs.statSync(absolutePath);
        const relativePath = path.relative(categoryRoot, absolutePath).split(path.sep).join("/");
        files.push({
          id: `${category}:${relativePath}`,
          name: path.basename(entry.name, path.extname(entry.name)),
          fileName: entry.name,
          relativePath,
          bytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          absolutePath,
        });
      }
    }
  }
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function listModels(root) {
  return Object.fromEntries(
    Object.entries(CATEGORIES).map(([directory, key]) => [key, scanSafetensors(root, directory)]),
  );
}

function resolveCatalogEntry(catalog, id, category) {
  const entry = catalog[category].find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`선택한 ${category === "models" ? "모델" : "LoRA"} 파일을 찾을 수 없습니다.`);
  return entry;
}

module.exports = { listModels, resolveCatalogEntry, scanSafetensors };
