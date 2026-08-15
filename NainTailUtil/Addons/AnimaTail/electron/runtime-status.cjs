"use strict";

const { locateRuntime, locateSupportAssets } = require("./runtime-locator.cjs");

function readRuntimeStatus(appRoot) {
  const { state, runtimeId, source } = locateRuntime(appRoot);
  return {
    state,
    runtimeId,
    source,
    supportAssetsReady: Boolean(locateSupportAssets(appRoot)),
  };
}

module.exports = { readRuntimeStatus };
