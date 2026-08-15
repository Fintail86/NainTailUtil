"use strict";

const { start } = require("../mcp/entry.cjs");

start().catch((error) => {
  process.stderr.write(`[AnimaTail standalone MCP] ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
