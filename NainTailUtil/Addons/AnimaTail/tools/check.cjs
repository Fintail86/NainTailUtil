#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const addonRoot = path.resolve(__dirname, "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(addonRoot, relativePath), "utf8"));
}

try {
  const version = fs.readFileSync(path.join(addonRoot, "VERSION"), "utf8").trim();
  const addon = readJson("addon.json");
  const packageInfo = readJson("package.json");
  const standalone = readJson("standalone-manifest.json");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`VERSION is not valid semver: ${version}`);
  if (addon.version !== version || packageInfo.version !== version) {
    throw new Error(`Version mismatch: VERSION=${version}, addon=${addon.version}, package=${packageInfo.version}`);
  }
  if (Array.isArray(addon.requires) && addon.requires.length) throw new Error(`${addon.id} must not require another addon.`);
  for (const relativePath of [...Object.values(addon.entries || {}), standalone.gui, standalone.cli, standalone.mcp]) {
    if (!relativePath || !fs.existsSync(path.join(addonRoot, relativePath))) throw new Error(`Missing portable entry: ${relativePath || "(empty)"}`);
  }
  process.stdout.write(`${addon.name} source check passed (v${version}).\n`);
} catch (error) {
  process.stderr.write(`[AnimaTail check] ${error.stack || error.message}\n`);
  process.exitCode = 1;
}
