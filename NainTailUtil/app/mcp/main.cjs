"use strict";

const { NainTailApplication } = require("../core/application.cjs");
const { defaultProductRoot } = require("../core/paths.cjs");
const { McpJobManager } = require("./job-manager.cjs");
const { McpStdioServer } = require("./protocol.cjs");
const { callTool, createTools } = require("./tools.cjs");

let core = null;
let server = null;
let closing = false;

process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") shutdown();
  else throw error;
});

function shutdown() {
  if (closing) return;
  closing = true;
  server?.close();
  core?.close();
}

function start() {
  core = new NainTailApplication({ productRoot: defaultProductRoot() });
  const manager = new McpJobManager(core);
  const tools = createTools(core, manager);
  server = new McpStdioServer({
    name: "naintailutil",
    version: core.info().version,
    tools,
    callTool,
    instructions: [
      "Use naintail_status only when readiness is unknown.",
      "List tools return selection identifiers only; call the matching get tool only for the one item whose full content is needed.",
      "Generation tools return immediately with jobId. Prefer naintail_job_wait over repeated naintail_job_status polling.",
      "When wait.timedOut is true, call naintail_job_wait again; timeout responses intentionally omit repeated result and error bodies.",
      "Use naintail_jobs_list to recover a lost jobId without fetching every job result.",
      "Paid generation first returns ANLAS_CONFIRMATION_REQUIRED. Resubmit only after user approval with allowPaidAnlas=true and maxAnlas set to the approved cap.",
      "Cancelling an active job lets the one image already sent to NovelAI finish and cancels only undispatched images.",
      "Set NAINTAIL_NAI_TOKEN in the MCP host environment; GUI safeStorage credentials are intentionally not exposed to the stdio Node process.",
    ].join(" "),
  }).start();
  process.stdin.once("end", shutdown);
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

try {
  start();
} catch (error) {
  process.stderr.write(`[NainTailUtil MCP] ${error.stack || error.message}\n`);
  process.exitCode = 1;
  shutdown();
}

