"use strict";

const path = require("node:path");
const { run } = require("../app/cli/main.cjs");

run({
  productRoot: path.resolve(__dirname, ".."),
  argv: process.argv.slice(2),
}).catch((error) => {
  process.stdout.write(`${JSON.stringify({ ok: false, error: { code: "STANDALONE_CLI_FAILED", message: error.message } }, null, 2)}\n`);
  process.exitCode = 2;
});
