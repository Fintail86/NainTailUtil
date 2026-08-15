"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { requiredSupportAssetsReady } = require("./support-asset-service.cjs");

function readManifestRuntime(appRoot, manifestPath, runtimeRoot, source) {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (typeof manifest.runtimeId !== "string" || manifest.runtimeId.length === 0) {
      return { state: "manifest-invalid", runtimeId: null, pythonPath: null, source };
    }
    const pythonPath = path.join(
      runtimeRoot,
      "versions",
      manifest.runtimeId,
      manifest.entrypoint || "python.exe",
    );
    let ready = fs.existsSync(pythonPath);
    const expectedMarker = manifest.integrity || manifest.archiveSha256;
    if (ready && typeof expectedMarker === "string") {
      const markerPath = path.join(path.dirname(pythonPath), ".runtime-ready");
      try {
        const marker = fs.readFileSync(markerPath, "utf8").trim().split(/\r?\n/);
        ready = marker[0] === manifest.runtimeId && marker[1] === expectedMarker;
      } catch {
        ready = false;
      }
    }
    return {
      state: ready ? "ready" : "not-installed",
      runtimeId: manifest.runtimeId,
      pythonPath,
      source,
    };
  } catch {
    return { state: "manifest-invalid", runtimeId: null, pythonPath: null, source };
  }
}

function locateRuntime(appRoot) {
  const localManifest = path.join(appRoot, "runtime-manifest.local.json");
  if (fs.existsSync(localManifest)) {
    return readManifestRuntime(
      appRoot,
      localManifest,
      path.join(appRoot, "runtime"),
      "local",
    );
  }

  const productManifest = path.join(appRoot, "runtime-manifest.json");
  if (fs.existsSync(productManifest)) {
    return readManifestRuntime(
      appRoot,
      productManifest,
      path.join(appRoot, "runtime"),
      "product",
    );
  }

  return {
    state: "manifest-missing",
    runtimeId: null,
    pythonPath: null,
    source: null,
  };
}

function locateSupportAssets(appRoot) {
  const modelsRoot = path.join(appRoot, "Models");
  return requiredSupportAssetsReady(appRoot) ? modelsRoot : null;
}

module.exports = { locateRuntime, locateSupportAssets };
