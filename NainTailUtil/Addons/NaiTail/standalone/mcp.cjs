"use strict";

const path = require("node:path");
const { shutdown, start } = require("../mcp/main.cjs");
const { AddonOutputSettings } = require("../electron/output-settings.cjs");

const productRoot = path.resolve(__dirname, "..");
const outputSettings = new AddonOutputSettings({ addonRoot: productRoot, standalone: true });

try {
  start({
    productRoot,
    outputRoot: outputSettings.outputRoot(),
  });
} catch (error) {
  process.stderr.write(`[NaiTail standalone MCP] ${error.stack || error.message}\n`);
  process.exitCode = 1;
  shutdown();
}
