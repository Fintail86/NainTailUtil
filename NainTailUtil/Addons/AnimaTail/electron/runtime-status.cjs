"use strict";

const { locateRuntime, locateSupportAssets } = require("./runtime-locator.cjs");

function readRuntimeStatus(appRoot, options = {}) {
  const { state, runtimeId, source } = locateRuntime(appRoot, options);
  return {
    state,
    runtimeId,
    source,
    supportAssetsReady: Boolean(locateSupportAssets(appRoot)),
  };
}

module.exports = { readRuntimeStatus };
