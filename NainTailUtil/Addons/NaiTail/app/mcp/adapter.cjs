"use strict";

const { NainTailApplication } = require("../core/application.cjs");
const { defaultProductRoot } = require("../core/paths.cjs");
const { NainTailError } = require("../core/errors.cjs");
const { McpJobManager } = require("./job-manager.cjs");
const { callTool, createTools, failure } = require("./tools.cjs");

const ADAPTER_SCHEMA = "naintail.addon-mcp-profile/v1";

function createAdapter(options = {}) {
  const core = options.core || new NainTailApplication({
    productRoot: options.dataRoot || options.productRoot || defaultProductRoot(),
    outputRoot: options.outputRoot,
    version: options.manifest?.version,
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
