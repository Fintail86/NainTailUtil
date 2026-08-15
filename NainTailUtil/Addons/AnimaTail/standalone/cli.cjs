"use strict";

const { run } = require("../cli/main.cjs");

run({ argv: process.argv.slice(2) }).catch((error) => {
  process.stderr.write(`[AnimaTail standalone CLI] ${error.stack || error.message}\n`);
  process.exitCode = 2;
});
