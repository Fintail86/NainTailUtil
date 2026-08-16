"use strict";

const path = require("node:path");
const { shutdown, start } = require("../mcp/main.cjs");

try {
  start({
    productRoot: path.resolve(__dirname, ".."),
    outputRoot: path.resolve(__dirname, "..", "outputs"),
  });
} catch (error) {
  process.stderr.write(`[NaiTail standalone MCP] ${error.stack || error.message}\n`);
  process.exitCode = 1;
  shutdown();
}
