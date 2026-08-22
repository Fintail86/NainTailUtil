"use strict";

const generationProfile = require("../electron/generation-profile.cjs");
const { listModels } = require("../electron/model-catalog.cjs");
const { listPresets, PRESET_CATEGORIES, readPresetReference } = require("../electron/preset-service.cjs");
const { readRuntimeStatus } = require("../electron/runtime-status.cjs");

class McpDiscoveryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "McpDiscoveryError";
    this.code = code;
  }
}

function publicModelEntry(entry) {
  return {
    id: entry.id,
    name: entry.name,
  };
}

function publicLoraEntry(entry) {
  return {
    ...publicModelEntry(entry),
    turbo: isTurboLora(entry),
  };
}

function publicPresetEntry(entry) {
  return {
    id: entry.id,
    name: entry.name,
    itemCount: entry.itemCount,
  };
}

function publicPresetList(result) {
  return {
    ...Object.fromEntries(Object.keys(PRESET_CATEGORIES).map((category) => (
      [category, result[category].map(publicPresetEntry)]
    ))),
    errors: result.errors,
  };
}

function isTurboLora(entry) {
  const relativePath = String(entry?.relativePath || "").replaceAll("\\", "/").toLowerCase();
  return relativePath.startsWith(generationProfile.turboLoraPrefix.toLowerCase());
}

class McpDiscoveryService {
  constructor(options) {
    this.appRoot = options.appRoot;
    this.runtimeRoot = options.runtimeRoot;
    this.runtimeManifestPath = options.runtimeManifestPath;
    this.appVersion = options.appVersion || "0.0.0";
  }

  status() {
    const runtime = readRuntimeStatus(this.appRoot, {
      runtimeRoot: this.runtimeRoot,
      runtimeManifestPath: this.runtimeManifestPath,
    });
    const catalog = listModels(this.appRoot);
    const presets = listPresets(this.appRoot);
    return {
      appVersion: this.appVersion,
      runtime: {
        state: runtime.state,
        runtimeId: runtime.runtimeId || null,
        source: runtime.source || null,
        supportAssetsReady: Boolean(runtime.supportAssetsReady),
      },
      models: {
        models: catalog.models.length,
        loras: catalog.loras.length,
      },
      presets: {
        ...Object.fromEntries(Object.keys(PRESET_CATEGORIES).map((category) => (
          [category, presets[category].length]
        ))),
        errors: presets.errors.length,
      },
      readyForGeneration: runtime.state === "ready"
        && runtime.supportAssetsReady
        && catalog.models.length > 0,
    };
  }

  models() {
    const catalog = listModels(this.appRoot);
    return {
      models: catalog.models.map(publicModelEntry),
      loras: catalog.loras.map(publicLoraEntry),
    };
  }

  presets(category = null) {
    const result = listPresets(this.appRoot);
    if (category === null) return publicPresetList(result);
    if (!Object.hasOwn(PRESET_CATEGORIES, category)) {
      throw new McpDiscoveryError(
        "MCP_PRESET_CATEGORY_INVALID",
        `지원하지 않는 프리셋 category입니다: ${category}`,
      );
    }
    return {
      category,
      items: result[category].map(publicPresetEntry),
      errors: result.errors.filter((item) => item.category === category),
    };
  }

  preset(category, reference) {
    if (!Object.hasOwn(PRESET_CATEGORIES, category)) {
      throw new McpDiscoveryError(
        "MCP_PRESET_CATEGORY_INVALID",
        `지원하지 않는 프리셋 category입니다: ${category}`,
      );
    }
    try {
      return readPresetReference(this.appRoot, category, reference);
    } catch (error) {
      throw new McpDiscoveryError(
        error?.code ? `MCP_${error.code}` : "MCP_PRESET_NOT_FOUND",
        `프리셋을 읽을 수 없습니다: ${error.message}`,
      );
    }
  }
}

module.exports = {
  McpDiscoveryError,
  McpDiscoveryService,
  isTurboLora,
  publicLoraEntry,
  publicModelEntry,
  publicPresetEntry,
  publicPresetList,
};
