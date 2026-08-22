"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { requiredSupportAssetsReady } = require("./support-asset-service.cjs");

function readManifestRuntime(appRoot, manifestPath, runtimeRoot, source) {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (manifest?.schemaVersion === 1 && manifest.kind === "addon-runtime-requirements") {
      const manifestRoot = path.dirname(manifestPath);
      const environmentManifestPath = path.resolve(manifestRoot, manifest.environmentManifest || "");
      if (!environmentManifestPath.startsWith(`${manifestRoot}${path.sep}`)) {
        return { state: "manifest-invalid", runtimeId: null, pythonPath: null, source };
      }
      const environment = readManifestRuntime(appRoot, environmentManifestPath, runtimeRoot, source);
      if (environment.state !== "ready") return environment;
      const components = Array.isArray(manifest.components) ? manifest.components : [];
      if (components.length === 0) {
        return { state: "manifest-invalid", runtimeId: null, pythonPath: null, source };
      }
      const environmentRoot = path.dirname(environment.pythonPath);
      const allReady = components.every((component) => {
        if (typeof component?.id !== "string" || typeof component?.integrity !== "string") return false;
        try {
          const marker = fs.readFileSync(
            path.join(environmentRoot, ".components", `${component.id}.ready`),
            "utf8",
          ).trim().split(/\r?\n/);
          return marker[0] === component.id && marker[1] === component.integrity;
        } catch {
          return false;
        }
      });
      return {
        ...environment,
        state: allReady ? "ready" : "not-installed",
        requiredRuntimeIds: [environment.runtimeId, ...components.map((component) => component.id)],
      };
    }
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

function locateRuntime(appRoot, options = {}) {
  const productManifest = path.join(appRoot, "runtime-manifest.json");
  const localManifest = path.join(appRoot, "runtime-manifest.local.json");
  const runtimeRoot = path.resolve(options.runtimeRoot || path.join(appRoot, "runtime"));
  const injectedSource = runtimeRoot === path.resolve(appRoot, "runtime") ? null : "host";

  if (options.runtimeManifestPath) {
    const hostManifest = path.resolve(options.runtimeManifestPath);
    return fs.existsSync(hostManifest)
      ? readManifestRuntime(appRoot, hostManifest, runtimeRoot, "host")
      : { state: "manifest-missing", runtimeId: null, pythonPath: null, source: "host" };
  }

  const product = fs.existsSync(productManifest)
    ? readManifestRuntime(appRoot, productManifest, runtimeRoot, injectedSource || "product")
    : null;
  if (product?.state === "ready") return product;

  const local = fs.existsSync(localManifest)
    ? readManifestRuntime(appRoot, localManifest, runtimeRoot, injectedSource || "local")
    : null;
  if (local?.state === "ready") return local;

  if (product) return product;
  if (local) return local;

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
