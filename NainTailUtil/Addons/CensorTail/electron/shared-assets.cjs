"use strict";

const path = require("node:path");

function resolveAssetPaths(addonRoot) {
  const localRoot = path.resolve(addonRoot);
  return Object.freeze({
    electronPath: path.join(localRoot, "runtime", "electron", "electron.exe"),
    localRoot,
    modelRoot: path.join(localRoot, "Models", "censor"),
    runtimeRoot: path.join(localRoot, "runtime"),
    sharedRoot: localRoot,
    source: "local",
  });
}

module.exports = { resolveAssetPaths };
