"use strict";

const path = require("node:path");
const { shutdown, start } = require("../mcp/main.cjs");
const { AddonOutputSettings } = require("../electron/output-settings.cjs");

try {
  const productRoot = path.resolve(__dirname, "..");
  const outputSettings = new AddonOutputSettings({ addonRoot: productRoot, standalone: true });
  start({
    productRoot,
    outputRoot: outputSettings.outputRoot(),
    standalone: true,
  });
} catch (error) {
  process.stderr.write(`[CensorTail standalone MCP] ${error.stack || error.message}\n`);
  process.exitCode = 1;
  shutdown();
}
