#!/usr/bin/env node
"use strict";

const { createAdapter } = require("./adapter.cjs");
const { McpStdioServer } = require("./protocol.cjs");

let adapter = null;
let server = null;
let closing = false;

process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") void shutdown();
  else throw error;
});

async function shutdown() {
  if (closing) return;
  closing = true;
  server?.close();
  await adapter?.close();
}

function start(options = {}) {
  adapter = createAdapter({ ...options, hosted: options.hosted === true });
  const info = adapter.info();
  const tools = new Map(adapter.toolsList().map((definition) => [definition.name, { definition }]));
  server = new McpStdioServer({
    name: "censortail",
    version: info.version,
    tools,
    callTool: (tool, args) => adapter.callTool(tool.definition.name, args),
    instructions: [
      "Call censortail_status when runtime or model readiness is unknown.",
      "Hosted CensorTail accepts artifactRefs from another addon; standalone CensorTail accepts local inputPaths.",
      "censortail_scan returns immediately with jobId. Prefer censortail_job_wait over repeated status polling.",
      "Completed scan waits return one summary per image; call censortail_result_get only for an image whose detection coordinates are needed.",
      "Use censortail_save with the completed scanJobId. It saves images with active detections and returns new CensorTail artifactRefs.",
      "Cancelling a queued job succeeds. A running ONNX or save request cannot be interrupted and returns activeContinues=true.",
      "Use censortail_model_unload only while the queue is idle; it preserves the MCP connection and completed job history.",
    ].join(" "),
  }).start();
  process.stdin.once("end", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  return server;
}

if (require.main === module) {
  try {
    start();
  } catch (error) {
    process.stderr.write(`[CensorTail MCP] ${error.stack || error.message}\n`);
    process.exitCode = 1;
    void shutdown();
  }
}

module.exports = { shutdown, start };
