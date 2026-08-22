"use strict";

const path = require("node:path");

function usesPythonCuda(addon) {
  const capabilities = new Set(Array.isArray(addon?.capabilities) ? addon.capabilities : []);
  return capabilities.has("python") || capabilities.has("cuda");
}

function hostedRuntimeDependencies(productRoot, addon) {
  if (!usesPythonCuda(addon)) return Object.freeze({});
  const hostRoot = path.resolve(productRoot);
  return Object.freeze({
    runtimeOwner: "naintail",
    runtimeRoot: path.join(hostRoot, "runtime"),
    runtimeManifestPath: path.join(hostRoot, "python-runtime-manifest.json"),
  });
}

module.exports = { hostedRuntimeDependencies, usesPythonCuda };
