"use strict";

const path = require("node:path");

const { start } = require("../mcp/entry.cjs");
const { AddonOutputSettings } = require("../electron/output-settings.cjs");

const productRoot = path.resolve(__dirname, "..");
const outputSettings = new AddonOutputSettings({ addonRoot: productRoot, standalone: true });

start({
  productRoot,
  outputRoot: outputSettings.outputRoot(),
}).catch((error) => {
  process.stderr.write(`[AnimaTail standalone MCP] ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
