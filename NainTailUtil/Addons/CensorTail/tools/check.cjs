#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const addonRoot = path.resolve(__dirname, "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(addonRoot, relativePath), "utf8"));
}

function main() {
  const version = fs.readFileSync(path.join(addonRoot, "VERSION"), "utf8").trim();
  const addon = readJson("addon.json");
  const packageInfo = readJson("package.json");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`VERSION is not valid semver: ${version}`);
  }
  if (addon.version !== version || packageInfo.version !== version) {
    throw new Error(`Version mismatch: VERSION=${version}, addon=${addon.version}, package=${packageInfo.version}`);
  }
  if (Array.isArray(addon.requires) && addon.requires.length) {
    throw new Error(`${addon.id} must not require another addon.`);
  }
  for (const relativePath of [
    "electron/shared-assets.cjs",
    "electron/runtime-locator.cjs",
    "electron/runtime-installer.cjs",
    "electron/censor-service.cjs",
    "electron/main.cjs",
    "mcp/adapter.cjs",
    "standalone/main.cjs",
  ]) {
    const result = spawnSync(process.execPath, ["--check", path.join(addonRoot, relativePath)], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.status !== 0) {
      throw new Error(`Syntax check failed: ${relativePath}\n${result.stderr || result.stdout}`);
    }
  }
  process.stdout.write(`CensorTail source check passed (v${version}).\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`[CensorTail check] ${error.stack || error.message}\n`);
  process.exitCode = 1;
}
