"use strict";

const path = require("node:path");

function usesPythonCuda(addon) {
  const capabilities = new Set(Array.isArray(addon?.capabilities) ? addon.capabilities : []);
  return capabilities.has("python") || capabilities.has("cuda");
}

function hostedRuntimeDependencies(productRoot, addon) {
  if (!usesPythonCuda(addon)) return Object.freeze({});
  return Object.freeze({
    runtimeOwner: "naintail",
    runtimeRoot: path.join(path.resolve(productRoot), "runtime"),
  });
}

module.exports = { hostedRuntimeDependencies, usesPythonCuda };
