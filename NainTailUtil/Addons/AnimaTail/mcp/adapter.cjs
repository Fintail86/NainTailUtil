"use strict";

const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function createAdapter(options = {}) {
  const module = await import(pathToFileURL(path.join(__dirname, "server.mjs")).href);
  return module.createAdapter({
    ...options,
    appRoot: options.dataRoot || options.productRoot || path.resolve(__dirname, ".."),
  });
}

module.exports = { createAdapter };
