"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CONFIG_RELATIVE_PATH = path.join("config", "dev-assets.local.json");

function configuredAbsolutePath(value, field, configPath) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new Error(`${field} must be an absolute path in ${configPath}.`);
  }
  return path.resolve(value);
}

function readDevelopmentAssetConfig(addonRoot) {
  const configPath = path.join(path.resolve(addonRoot), CONFIG_RELATIVE_PATH);
  if (!fs.existsSync(configPath)) return { configPath, config: null };
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`CensorTail development asset config is invalid: ${error.message}`);
  }
  if (!config || Array.isArray(config) || config.schemaVersion !== 1) {
    throw new Error(`Unsupported CensorTail development asset config: ${configPath}`);
  }
  return { configPath, config };
}

function resolveAssetPaths(addonRoot, environment = process.env) {
  const localRoot = path.resolve(addonRoot);
  const { configPath, config } = readDevelopmentAssetConfig(localRoot);
  const envPath = (name) => configuredAbsolutePath(environment[name], name, "environment");
  const configPathValue = (name) => configuredAbsolutePath(config?.[name], name, configPath);
  const sharedRoot = envPath("CENSORTAIL_SHARED_ROOT")
    || configPathValue("sharedRoot")
    || localRoot;
  const runtimeRoot = envPath("CENSORTAIL_RUNTIME_ROOT")
    || configPathValue("runtimeRoot")
    || path.join(sharedRoot, "runtime");
  const modelRoot = envPath("CENSORTAIL_MODEL_ROOT")
    || configPathValue("modelRoot")
    || path.join(sharedRoot, "Models", "censor");
  const electronPath = envPath("CENSORTAIL_ELECTRON")
    || configPathValue("electronPath")
    || path.join(sharedRoot, "runtime", "electron", "electron.exe");
  const source = [runtimeRoot, modelRoot, electronPath]
    .every((candidate) => candidate.toLowerCase().startsWith(`${localRoot.toLowerCase()}${path.sep}`))
    ? "local"
    : "shared";
  return Object.freeze({
    configPath,
    electronPath,
    localRoot,
    modelRoot,
    runtimeRoot,
    sharedRoot,
    source,
  });
}

module.exports = { CONFIG_RELATIVE_PATH, readDevelopmentAssetConfig, resolveAssetPaths };
