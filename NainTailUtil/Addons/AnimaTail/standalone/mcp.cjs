"use strict";

const path = require("node:path");

const { start } = require("../mcp/entry.cjs");

start({
  productRoot: path.resolve(__dirname, ".."),
  outputRoot: path.resolve(__dirname, "..", "outputs"),
}).catch((error) => {
  process.stderr.write(`[AnimaTail standalone MCP] ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
