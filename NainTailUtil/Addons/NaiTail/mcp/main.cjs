"use strict";

const { createAdapter } = require("./adapter.cjs");
const { McpStdioServer } = require("./protocol.cjs");

let adapter = null;
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
  adapter?.close();
}

function start(options = {}) {
  adapter = createAdapter(options);
  const info = adapter.info();
  const tools = new Map(adapter.toolsList().map((definition) => [definition.name, { definition }]));
  server = new McpStdioServer({
    name: "naintailutil",
    version: info.version,
    tools,
    callTool: (tool, args) => adapter.callTool(tool.definition.name, args),
    instructions: [
      "Use naintail_status only when readiness is unknown.",
      "List tools return selection identifiers only; call the matching get tool only for the one item whose full content is needed.",
      "For single/multi generation, use preset names directly: examplePreset, characters[].preset, and multi slotPreset or slotPresets. Do not fetch preset bodies just to paste them into generation requests; prompt text is not parsed for references.",
      "Omitted/null preset references use direct input. Omitted outfit keeps the saved selection; outfit:null deselects clothing and adds undressed, nude only when the outfit list is nonempty.",
      "Generation tools return immediately with jobId. Prefer naintail_job_wait over repeated naintail_job_status polling.",
      "When wait.timedOut is true, call naintail_job_wait again; timeout responses intentionally omit repeated result and error bodies.",
      "Use naintail_jobs_list to recover a lost jobId without fetching every job result.",
      "Paid generation first returns ANLAS_CONFIRMATION_REQUIRED. Resubmit only after user approval with allowPaidAnlas=true and maxAnlas set to the approved cap.",
      "Cancelling an active job lets the one image already sent to NovelAI finish and cancels only undispatched images.",
      "Use the explicit NAINTAIL_NAI_TOKEN environment value when present; otherwise the local Windows MCP launcher can reuse the GUI safeStorage credential without exposing it in tool results.",
    ].join(" "),
  }).start();
  process.stdin.once("end", shutdown);
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return server;
}

if (require.main === module) {
  try {
    start();
  } catch (error) {
    process.stderr.write(`[NainTailUtil MCP] ${error.stack || error.message}\n`);
    process.exitCode = 1;
    shutdown();
  }
}

module.exports = { shutdown, start };
