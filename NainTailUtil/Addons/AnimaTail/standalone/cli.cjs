"use strict";

const path = require("node:path");

const { run } = require("../cli/main.cjs");

run({
  productRoot: path.resolve(__dirname, ".."),
  outputRoot: path.resolve(__dirname, "..", "outputs"),
  argv: process.argv.slice(2),
}).catch((error) => {
  process.stderr.write(`[AnimaTail standalone CLI] ${error.stack || error.message}\n`);
  process.exitCode = 2;
});
