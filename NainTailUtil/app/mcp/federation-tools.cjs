"use strict";

const emptySchema = { type: "object", additionalProperties: false };
const addonIdProperty = { type: "string", minLength: 1, description: "addon manifest ID" };
const toolNameProperty = { type: "string", minLength: 1, description: "addon MCP tool name" };

function annotations(readOnly, destructive = false, idempotent = readOnly, openWorld = false) {
  return { readOnlyHint: readOnly, destructiveHint: destructive, idempotentHint: idempotent, openWorldHint: openWorld };
}

function define(name, title, description, inputSchema, handler, toolAnnotations, passthrough = false) {
  return { definition: { name, title, description, inputSchema, annotations: toolAnnotations }, handler, passthrough };
}

function success(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

function publicError(error) {
  return {
    code: String(error?.code || "MCP_ROUTER_ERROR"),
    message: error instanceof Error ? error.message : String(error),
    retryable: error?.retryable === true,
    details: error?.details && typeof error.details === "object" ? error.details : {},
  };
}

function failure(error) {
  const value = publicError(error);
  return { isError: true, content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

function createFederationTools(router) {
  const tools = [
    define("naintail_addons_list", "애드온 목록", "애드온 선택에 필요한 ID·이름·가용성·MCP 형태만 반환합니다.", emptySchema, () => router.addonsList(), annotations(true)),
    define("naintail_addon_get", "애드온 상세", "지정한 애드온 하나의 manifest·의존성·capability와 MCP adapter 정보를 반환합니다.", {
      type: "object", properties: { addonId: addonIdProperty }, required: ["addonId"], additionalProperties: false,
    }, ({ addonId }) => router.addonGet(addonId), annotations(true)),
    define("naintail_addon_tools_list", "애드온 도구 목록", "지정한 애드온의 도구명·제목·짧은 설명만 반환합니다. 전체 schema는 tool_get을 사용하세요.", {
      type: "object", properties: { addonId: addonIdProperty }, required: ["addonId"], additionalProperties: false,
    }, ({ addonId }) => router.toolsList(addonId), annotations(true)),
    define("naintail_addon_tool_get", "애드온 도구 상세", "지정한 애드온 도구 하나의 전체 input schema와 annotations를 반환합니다.", {
      type: "object", properties: { addonId: addonIdProperty, toolName: toolNameProperty }, required: ["addonId", "toolName"], additionalProperties: false,
    }, ({ addonId, toolName }) => router.toolGet(addonId, toolName), annotations(true)),
    define("naintail_addon_call", "애드온 도구 호출", "선택한 애드온 MCP 도구를 호출하고 content·structuredContent·오류를 손실 없이 전달합니다.", {
      type: "object",
      properties: {
        addonId: addonIdProperty,
        toolName: toolNameProperty,
        arguments: { type: "object", description: "tool_get에서 확인한 도구 인자", additionalProperties: true },
      },
      required: ["addonId", "toolName"],
      additionalProperties: false,
    }, ({ addonId, toolName, arguments: args = {} }) => router.callTool(addonId, toolName, args), annotations(false, true, false, true), true),
  ];
  return new Map(tools.map((tool) => [tool.definition.name, tool]));
}

async function callFederationTool(tool, args) {
  try {
    const value = await tool.handler(args || {});
    return tool.passthrough ? value : success(value);
  } catch (error) {
    return failure(error);
  }
}

module.exports = { annotations, callFederationTool, createFederationTools, define, failure, publicError, success };
