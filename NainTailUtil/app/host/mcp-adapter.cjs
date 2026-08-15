"use strict";

const ADDON_MCP_PROFILE = "naintail.addon-mcp-profile/v1";
const REQUIRED_METHODS = ["info", "toolsList", "toolGet", "callTool", "close"];

function adapterError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function validateToolDefinition(definition, addonId) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    throw adapterError("MCP_ADAPTER_INVALID", `MCP 도구 정의가 객체가 아닙니다: ${addonId}`);
  }
  if (!String(definition.name || "").trim()) {
    throw adapterError("MCP_ADAPTER_INVALID", `MCP 도구 이름이 없습니다: ${addonId}`);
  }
  if (!definition.inputSchema || typeof definition.inputSchema !== "object" || Array.isArray(definition.inputSchema)) {
    throw adapterError("MCP_ADAPTER_INVALID", `MCP 도구 inputSchema가 없습니다: ${addonId}/${definition.name}`);
  }
  return definition;
}

function validateMcpAdapter(adapter, addon) {
  const addonId = String(addon?.id || "unknown");
  if (!adapter || typeof adapter !== "object") {
    throw adapterError("MCP_ADAPTER_INVALID", `MCP adapter가 객체가 아닙니다: ${addonId}`);
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof adapter[method] !== "function") {
      throw adapterError("MCP_ADAPTER_INVALID", `MCP adapter 메서드가 없습니다: ${addonId}/${method}`);
    }
  }
  if (adapter.schema !== ADDON_MCP_PROFILE) {
    throw adapterError("MCP_ADAPTER_PROFILE_UNSUPPORTED", `지원하지 않는 MCP adapter profile입니다: ${addonId}`);
  }
  return adapter;
}

async function inspectMcpAdapter(adapter, addon) {
  validateMcpAdapter(adapter, addon);
  const addonId = String(addon?.id || "unknown");
  const info = await adapter.info();
  if (!info || typeof info !== "object" || info.addonId !== addonId) {
    throw adapterError("MCP_ADAPTER_INVALID", `MCP adapter addonId가 manifest와 다릅니다: ${addonId}`);
  }
  const definitions = await adapter.toolsList();
  if (!Array.isArray(definitions)) {
    throw adapterError("MCP_ADAPTER_INVALID", `MCP toolsList 결과가 배열이 아닙니다: ${addonId}`);
  }
  const seen = new Set();
  for (const definition of definitions) {
    validateToolDefinition(definition, addonId);
    if (seen.has(definition.name)) {
      throw adapterError("MCP_ADAPTER_INVALID", `중복 MCP 도구 이름입니다: ${addonId}/${definition.name}`);
    }
    seen.add(definition.name);
  }
  return { info, definitions };
}

module.exports = {
  ADDON_MCP_PROFILE,
  REQUIRED_METHODS,
  adapterError,
  inspectMcpAdapter,
  validateMcpAdapter,
  validateToolDefinition,
};
