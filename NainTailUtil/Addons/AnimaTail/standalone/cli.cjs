"use strict";

const path = require("node:path");

const { run } = require("../cli/main.cjs");
const { AddonOutputSettings } = require("../electron/output-settings.cjs");

const productRoot = path.resolve(__dirname, "..");
const outputSettings = new AddonOutputSettings({ addonRoot: productRoot, standalone: true });

run({
  productRoot,
  outputRoot: outputSettings.outputRoot(),
  argv: process.argv.slice(2),
}).catch((error) => {
  process.stderr.write(`[AnimaTail standalone CLI] ${error.stack || error.message}\n`);
  process.exitCode = 2;
});
