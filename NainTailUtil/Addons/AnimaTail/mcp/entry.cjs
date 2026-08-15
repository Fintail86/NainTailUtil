"use strict";

const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function start() {
  const module = await import(pathToFileURL(path.join(__dirname, "server.mjs")).href);
  return module.start({ appRoot: path.resolve(__dirname, "..") });
}

module.exports = { start };
