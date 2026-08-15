"use strict";

const path = require("node:path");
const { AddonRegistry } = require("../host/addon-registry.cjs");
const { callFederationTool, createFederationTools } = require("./federation-tools.cjs");
const { FederationRouter } = require("./federation-router.cjs");
const { McpStdioServer } = require("./protocol.cjs");

let activeRuntime = null;
let closing = false;

process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") void shutdown();
  else throw error;
});

async function shutdown() {
  if (closing) return;
  closing = true;
  activeRuntime?.server?.close?.();
  await activeRuntime?.router?.close?.();
  activeRuntime?.entry?.shutdown?.();
  activeRuntime = null;
}

function createRegistry(productRoot) {
  const registry = new AddonRegistry(productRoot);
  registry.discover();
  return registry;
}

function startSelectedAddon(registry, addonId) {
  const addon = registry.get(addonId);
  if (!addon) throw new Error(`애드온을 찾을 수 없습니다: ${addonId}`);
  const missing = registry.missingRequirements(addon);
  if (missing.length) throw new Error(`필수 애드온이 없습니다: ${missing.join(", ")}`);
  const entry = registry.load(addon, "mcp");
  if (!entry || typeof entry.start !== "function") throw new Error(`MCP entry가 없습니다: ${addon.id}`);
  const server = entry.start({
    hostRoot: registry.productRoot,
    productRoot: addon.directory,
    dataRoot: addon.directory,
    manifest: addon,
  });
  activeRuntime = { mode: "selected-addon", addonId: addon.id, entry, server };
  return activeRuntime;
}

function startFederation(registry, options = {}) {
  const router = new FederationRouter(registry, { hostRoot: registry.productRoot });
  const tools = createFederationTools(router);
  const server = new McpStdioServer({
    input: options.input,
    output: options.output,
    log: options.log,
    name: "naintail",
    version: "0.1.0",
    tools,
    callTool: callFederationTool,
    instructions: [
      "Use naintail_addons_list only when the addon ID is unknown.",
      "Use naintail_addon_get for one addon's details, then naintail_addon_tools_list for selection and naintail_addon_tool_get for one full schema.",
      "Call naintail_addon_call with the selected addonId, toolName, and arguments.",
      "Addon tool content, structuredContent, resources, and errors are returned without summary loss.",
      "Paid and destructive addon operations retain their own confirmation and validation rules.",
    ].join(" "),
  }).start();
  activeRuntime = { mode: "federation", router, server };
  return activeRuntime;
}

function main(options = {}) {
  closing = false;
  const productRoot = options.productRoot || path.resolve(__dirname, "..", "..");
  const registry = options.registry || createRegistry(productRoot);
  const addonId = String(options.addonId ?? process.env.NAINTAIL_ADDON_ID ?? "").trim();
  const runtime = addonId ? startSelectedAddon(registry, addonId) : startFederation(registry, options);
  if (runtime.mode === "federation") {
    process.stdin.once("end", () => { void shutdown(); });
    process.once("SIGINT", () => { void shutdown(); });
    process.once("SIGTERM", () => { void shutdown(); });
  }
  return runtime;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[NainTail MCP host] ${error.stack || error.message}\n`);
    process.exitCode = 1;
    void shutdown();
  }
}

module.exports = { createRegistry, main, shutdown, startFederation, startSelectedAddon };
