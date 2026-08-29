"use strict";

const { NainTailApplication } = require("../app/core/application.cjs");
const { defaultProductRoot } = require("../app/core/paths.cjs");
const { NainTailError } = require("../app/core/errors.cjs");
const { CredentialService } = require("../electron/credential-service.cjs");
const { createWindowsSafeStorageReader } = require("./windows-safe-storage.cjs");
const { McpJobManager } = require("./job-manager.cjs");
const { callTool, createTools, failure } = require("./tools.cjs");

const ADAPTER_SCHEMA = "naintail.addon-mcp-profile/v1";

function createAdapter(options = {}) {
  const productRoot = options.dataRoot || options.productRoot || defaultProductRoot();
  const safeStorage = options.services?.safeStorage || createWindowsSafeStorageReader({
    appName: options.hosted === true ? "naintailutil" : "naitail-standalone",
  });
  const credentials = safeStorage ? new CredentialService(productRoot, safeStorage) : null;
  const getToken = options.getToken || (credentials
    ? async () => String(process.env.NAINTAIL_NAI_TOKEN || "").trim() || credentials.getToken()
    : undefined);
  const core = options.core || new NainTailApplication({
    productRoot,
    outputRoot: options.outputRoot,
    version: options.manifest?.version,
    worker: options.worker,
    ...(getToken ? { getToken } : {}),
  });
  const manager = options.manager || new McpJobManager(core);
  const tools = createTools(core, manager);
  const manifest = options.manifest || {};
  let closed = false;

  function ensureOpen() {
    if (closed) throw new NainTailError("MCP_ADAPTER_CLOSED", "NaiTail MCP adapter가 종료되었습니다.");
  }

  return {
    schema: ADAPTER_SCHEMA,
    info() {
      ensureOpen();
      const application = core.info();
      return {
        schema: ADAPTER_SCHEMA,
        addonId: "naitail",
        name: manifest.name || application.activeAddon?.name || "NaiTail",
        version: manifest.version || application.version,
        profiles: ["base", "discovery", "async-job"],
        capabilities: Array.isArray(manifest.capabilities)
          ? [...manifest.capabilities]
          : ["single", "multi", "artist-study", "projects", "presets"],
        toolCount: tools.size,
      };
    },
    toolsList() {
      ensureOpen();
      return [...tools.values()].map((tool) => tool.definition);
    },
    toolGet(toolName) {
      ensureOpen();
      return tools.get(String(toolName || ""))?.definition || null;
    },
    async callTool(toolName, args = {}) {
      ensureOpen();
      const tool = tools.get(String(toolName || ""));
      if (!tool) return failure(new NainTailError("MCP_TOOL_NOT_FOUND", `NaiTail MCP 도구를 찾을 수 없습니다: ${toolName}`));
      return callTool(tool, args);
    },
    close() {
      if (closed) return;
      closed = true;
      core.close?.();
    },
  };
}

module.exports = { ADAPTER_SCHEMA, createAdapter };
