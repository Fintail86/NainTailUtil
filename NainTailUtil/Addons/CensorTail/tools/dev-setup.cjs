#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { resolveAssetPaths } = require("../electron/shared-assets.cjs");
const { locateRuntime } = require("../electron/runtime-locator.cjs");

const addonRoot = path.resolve(__dirname, "..");
const modelFileName = "nsfw-anime-xl-x1280.onnx";
const modelBytes = 126350117;

function argumentValue(name) {
  const exactIndex = process.argv.indexOf(name);
  if (exactIndex >= 0) return process.argv[exactIndex + 1] || "";
  const prefix = `${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || "";
}

function asAddonRoot(candidate) {
  const absolute = path.resolve(candidate);
  for (const value of [
    absolute,
    path.join(absolute, "NainTailUtil", "Addons", "CensorTail"),
    path.join(absolute, "Addons", "CensorTail"),
  ]) {
    if (fs.existsSync(path.join(value, "addon.json"))) return value;
  }
  return absolute;
}

function discoverSharedRoot() {
  const requested = argumentValue("--source") || process.env.CENSORTAIL_SHARED_ROOT;
  if (requested) return asAddonRoot(requested);
  const commonDirectory = execFileSync(
    "git",
    ["-C", addonRoot, "rev-parse", "--path-format=absolute", "--git-common-dir"],
    { encoding: "utf8", windowsHide: true },
  ).trim();
  return path.join(path.dirname(commonDirectory), "NainTailUtil", "Addons", "CensorTail");
}

function versionStatus() {
  const version = fs.readFileSync(path.join(addonRoot, "VERSION"), "utf8").trim();
  const addonVersion = JSON.parse(fs.readFileSync(path.join(addonRoot, "addon.json"), "utf8")).version;
  const packageVersion = JSON.parse(fs.readFileSync(path.join(addonRoot, "package.json"), "utf8")).version;
  return { version, addonVersion, packageVersion, ready: version === addonVersion && version === packageVersion };
}

function developmentStatus() {
  const assets = resolveAssetPaths(addonRoot);
  const runtime = locateRuntime(addonRoot, { runtimeRoot: assets.runtimeRoot });
  const dependencyPath = runtime.pythonPath
    ? path.join(path.dirname(runtime.pythonPath), "Lib", "site-packages", "onnxruntime", "__init__.py")
    : null;
  const modelPath = path.join(assets.modelRoot, modelFileName);
  let modelReady = false;
  try {
    modelReady = fs.statSync(modelPath).size === modelBytes;
  } catch {}
  const status = {
    version: versionStatus(),
    assets: {
      source: assets.source,
      configPath: assets.configPath,
      sharedRoot: assets.sharedRoot,
      electronPath: assets.electronPath,
      runtimeRoot: assets.runtimeRoot,
      modelRoot: assets.modelRoot,
    },
    electronReady: fs.existsSync(assets.electronPath),
    runtimeReady: runtime.state === "ready",
    runtimeId: runtime.runtimeId,
    runtimeManifest: runtime.source,
    dependencyReady: Boolean(dependencyPath && fs.existsSync(dependencyPath)),
    modelReady,
  };
  status.ready = status.version.ready
    && status.electronReady
    && status.runtimeReady
    && status.dependencyReady
    && status.modelReady;
  return status;
}

function writeConfig(sharedRoot) {
  if (!fs.existsSync(path.join(sharedRoot, "addon.json"))) {
    throw new Error(`Shared CensorTail source was not found: ${sharedRoot}`);
  }
  const configDirectory = path.join(addonRoot, "config");
  const config = {
    schemaVersion: 1,
    sharedRoot,
    runtimeRoot: path.join(sharedRoot, "runtime"),
    modelRoot: path.join(sharedRoot, "Models", "censor"),
    electronPath: path.join(sharedRoot, "runtime", "electron", "electron.exe"),
  };
  fs.mkdirSync(configDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(configDirectory, "dev-assets.local.json"),
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8",
  );
  const batchValue = (value) => value.replaceAll("%", "%%");
  fs.writeFileSync(
    path.join(configDirectory, "dev-assets.local.cmd"),
    [
      "@echo off",
      `set "CENSORTAIL_SHARED_ROOT=${batchValue(config.sharedRoot)}"`,
      `set "CENSORTAIL_RUNTIME_ROOT=${batchValue(config.runtimeRoot)}"`,
      `set "CENSORTAIL_MODEL_ROOT=${batchValue(config.modelRoot)}"`,
      `set "CENSORTAIL_ELECTRON=${batchValue(config.electronPath)}"`,
      "",
    ].join("\r\n"),
    "utf8",
  );
}

function printStatus(status) {
  const mark = (ready) => ready ? "OK" : "MISSING";
  process.stdout.write([
    `CensorTail ${status.version.version} (${status.assets.source} assets)`,
    `  version     ${mark(status.version.ready)}`,
    `  electron    ${mark(status.electronReady)}  ${status.assets.electronPath}`,
    `  runtime     ${mark(status.runtimeReady)}  ${status.runtimeId || "manifest missing"}`,
    `  dependency  ${mark(status.dependencyReady)}  onnxruntime`,
    `  model       ${mark(status.modelReady)}  ${status.assets.modelRoot}`,
    `  config      ${status.assets.configPath}`,
    `  overall     ${status.ready ? "READY" : "NOT READY"}`,
    "",
  ].join("\n"));
}

try {
  if (!process.argv.includes("--check")) writeConfig(discoverSharedRoot());
  const status = developmentStatus();
  if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  else printStatus(status);
  if (!status.ready) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`[CensorTail dev setup] ${error.stack || error.message}\n`);
  process.exitCode = 1;
}
