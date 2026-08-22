"use strict";

const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function start(options = {}) {
  const module = await import(pathToFileURL(path.join(__dirname, "server.mjs")).href);
  return module.start({
    appRoot: path.resolve(options.productRoot || options.appRoot || path.resolve(__dirname, "..")),
    dependencies: options.dependencies,
    hosted: options.hosted === true,
    manifest: options.manifest,
    runtimeRoot: options.runtimeRoot || options.dependencies?.runtimeRoot,
    runtimeManifestPath: options.runtimeManifestPath || options.dependencies?.runtimeManifestPath,
    outputRoot: options.outputRoot,
  });
}

module.exports = { start };
