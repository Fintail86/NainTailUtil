#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import {
  emptyInput,
  jobStatusInput,
  jobWaitInput,
  multiGenerationInput,
  presetGetInput,
  presetListInput,
  singleGenerationInput,
} from "./tool-schemas.mjs";

const require = createRequire(import.meta.url);
const packageInfo = require("../package.json");
const { McpDiscoveryService } = require("./discovery-service.cjs");
const { McpGenerationJobManager } = require("./job-manager.cjs");
const { queryGpuMemory } = require("../electron/gpu-status.cjs");

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADAPTER_SCHEMA = "naintail.addon-mcp-profile/v1";
const ARTIFACT_SCHEMA = "naintail.artifact-ref/v1";

function toolSuccess(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function toolFailure(error) {
  const value = {
    code: error?.code || "MCP_TOOL_ERROR",
    message: error?.message || String(error),
  };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function readOnlyAnnotations() {
  return {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
}

function collectTools(manager, discovery, gpuReader = queryGpuMemory) {
  const tools = new Map();
  registerTools({
    registerTool(name, config, handler) {
      const inputSchema = z.toJSONSchema(config.inputSchema, { target: "draft-7" });
      delete inputSchema.$schema;
      tools.set(name, {
        definition: {
          name,
          title: config.title || name,
          description: config.description || "",
          inputSchema,
          annotations: config.annotations || {},
        },
        input: config.inputSchema,
        handler,
      });
    },
  }, manager, discovery, gpuReader);
  return tools;
}

function artifactPublisher(appRoot, hosted) {
  const outputRoot = path.resolve(appRoot, "outputs");
  const byId = new Map();
  const byPath = new Map();

  function register(output) {
    if (!output || typeof output.absolutePath !== "string") return null;
    const absolutePath = path.resolve(output.absolutePath);
    const relative = path.relative(outputRoot, absolutePath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
    const key = absolutePath.toLowerCase();
    let artifactId = byPath.get(key);
    if (!artifactId) {
      artifactId = randomUUID();
      byPath.set(key, artifactId);
      byId.set(artifactId, {
        absolutePath,
        kind: "image",
        width: Number(output.width) || null,
        height: Number(output.height) || null,
      });
    }
    return {
      schema: ARTIFACT_SCHEMA,
      addonId: "animatail",
      artifactId,
      kind: "image",
      scope: "session",
    };
  }

  function transform(value) {
    if (Array.isArray(value)) return value.map(transform);
    if (!value || typeof value !== "object") return value;
    const next = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, transform(child)]));
    const artifactRef = register(value);
    if (artifactRef) {
      next.artifactRef = artifactRef;
      if (hosted) delete next.absolutePath;
    }
    return next;
  }

  function publish(result) {
    if (!result || typeof result !== "object" || result.structuredContent === undefined) return result;
    const structuredContent = transform(result.structuredContent);
    let replacedText = false;
    const content = Array.isArray(result.content) ? result.content.map((block) => {
      if (!replacedText && block?.type === "text") {
        replacedText = true;
        return { ...block, text: JSON.stringify(structuredContent, null, 2) };
      }
      return block;
    }) : result.content;
    return { ...result, content, structuredContent };
  }

  function resolve(reference) {
    if (reference?.schema !== ARTIFACT_SCHEMA || reference?.addonId !== "animatail" || reference?.scope !== "session") {
      const error = new Error("AnimaTail artifact 참조가 올바르지 않습니다.");
      error.code = "ARTIFACT_REF_INVALID";
      throw error;
    }
    const record = byId.get(String(reference.artifactId || ""));
    if (!record || !fs.existsSync(record.absolutePath)) {
      const error = new Error(`AnimaTail artifact를 찾을 수 없습니다: ${reference.artifactId || ""}`);
      error.code = "ARTIFACT_NOT_FOUND";
      throw error;
    }
    return { artifactRef: { ...reference }, ...record };
  }

  return { publish, resolve };
}

function registerTools(server, manager, discovery, gpuReader = queryGpuMemory) {
  server.registerTool("anima_status", {
    title: "AnimaTail 준비 상태",
    description: "생성 전에 앱 전용 런타임, 필수 보조 자산, 모델·프리셋, NVIDIA VRAM과 MCP 작업 대기열 상태를 확인합니다.",
    inputSchema: emptyInput,
    annotations: readOnlyAnnotations(),
  }, async () => {
    try {
      const [status, gpu] = await Promise.all([discovery.status(), gpuReader()]);
      const ready = status.readyForGeneration === true;
      return toolSuccess({
        addonId: "animatail",
        version: status.appVersion,
        ready,
        state: ready ? "ready" : status.runtime?.state === "ready" ? "degraded" : "unavailable",
        issues: ready ? [] : [{
          code: status.runtime?.state === "ready" ? "ANIMA_ASSETS_NOT_READY" : "ANIMA_RUNTIME_NOT_READY",
          message: status.runtime?.state === "ready" ? "모델 또는 필수 보조 자산이 준비되지 않았습니다." : "Anima runtime이 준비되지 않았습니다.",
          retryable: true,
        }],
        ...status,
        gpu,
        queue: manager.queueStatus(),
      });
    } catch (error) {
      return toolFailure(error);
    }
  });

  server.registerTool("anima_models_list", {
    title: "AnimaTail 모델 목록",
    description: "생성 도구의 modelId와 LoRA id 선택에 필요한 최소 catalog 목록을 조회합니다. 이미 ID를 알고 있거나 환경 프리셋을 사용하면 생략할 수 있습니다.",
    inputSchema: emptyInput,
    annotations: readOnlyAnnotations(),
  }, async () => {
    try {
      return toolSuccess(discovery.models());
    } catch (error) {
      return toolFailure(error);
    }
  });

  server.registerTool("anima_model_unload", {
    title: "AnimaTail 생성 모델 언로드",
    description: "MCP 연결은 유지한 채 현재 로드된 생성 모델과 Python worker를 종료해 VRAM을 확보합니다. 대기·실행 작업이 있으면 거부되며 다음 생성 시 자동으로 다시 로드합니다.",
    inputSchema: emptyInput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async () => {
    try {
      return toolSuccess(await manager.releaseModel());
    } catch (error) {
      return toolFailure(error);
    }
  });

  server.registerTool("anima_presets_list", {
    title: "AnimaTail 프리셋 목록",
    description: "Base·일반·네거티브·서브 프롬프트와 환경 프리셋의 ID·이름 목록만 조회합니다. 내용은 anima_preset_get으로만 읽습니다.",
    inputSchema: presetListInput,
    annotations: readOnlyAnnotations(),
  }, async ({ category }) => {
    try {
      return toolSuccess(discovery.presets(category || null));
    } catch (error) {
      return toolFailure(error);
    }
  });

  server.registerTool("anima_preset_get", {
    title: "AnimaTail 프리셋 내용",
    description: "category와 preset id 또는 정확한 표시 이름으로 프롬프트, 서브 프롬프트 목록 또는 생성 환경 설정을 읽습니다.",
    inputSchema: presetGetInput,
    annotations: readOnlyAnnotations(),
  }, async ({ category, id, name }) => {
    try {
      return toolSuccess(discovery.preset(category, id ? { id } : { name }));
    } catch (error) {
      return toolFailure(error);
    }
  });

  server.registerTool("anima_generate_single", {
    title: "AnimaTail 싱글 생성",
    description: "AnimaTail에 싱글 이미지 생성 작업을 등록하고 즉시 jobId를 반환합니다. 완료 여부는 anima_job_status로 확인합니다.",
    inputSchema: singleGenerationInput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  }, async (config) => {
    try {
      return toolSuccess(manager.submit("single", config));
    } catch (error) {
      return toolFailure(error);
    }
  });

  server.registerTool("anima_generate_multi", {
    title: "AnimaTail 멀티 생성",
    description: "공통 프롬프트와 활성 서브 프롬프트 조합을 등록합니다. selectedSlots로 출력할 슬롯만 선택할 수 있으며 즉시 jobId를 반환합니다.",
    inputSchema: multiGenerationInput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  }, async (config) => {
    try {
      return toolSuccess(manager.submit("multi", config));
    } catch (error) {
      return toolFailure(error);
    }
  });

  server.registerTool("anima_job_status", {
    title: "AnimaTail 작업 상태",
    description: "jobId로 대기·실행·완료 상태, 현재 진행률과 생성된 이미지 경로를 조회합니다.",
    inputSchema: jobStatusInput,
    annotations: readOnlyAnnotations(),
  }, async ({ jobId }) => {
    try {
      return toolSuccess(manager.get(jobId));
    } catch (error) {
      return toolFailure(error);
    }
  });

  server.registerTool("anima_job_wait", {
    title: "AnimaTail 작업 완료 대기",
    description: "jobId의 작업이 끝날 때까지 서버 내부에서 기다립니다. timeoutSeconds를 생략하면 예상 이미지 수에 따라 30~60초를 자동 선택합니다. 반복 상태 조회보다 이 도구를 우선 사용하세요.",
    inputSchema: jobWaitInput,
    annotations: readOnlyAnnotations(),
  }, async ({ jobId, timeoutSeconds }) => {
    try {
      return toolSuccess(await manager.wait(jobId, timeoutSeconds === undefined ? undefined : timeoutSeconds * 1000));
    } catch (error) {
      return toolFailure(error);
    }
  });

  server.registerTool("anima_job_cancel", {
    title: "AnimaTail 작업 취소",
    description: "jobId로 대기 중이거나 실행 중인 MCP 생성 요청 전체를 취소합니다.",
    inputSchema: jobStatusInput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  }, async ({ jobId }) => {
    try {
      return toolSuccess(manager.cancel(jobId));
    } catch (error) {
      return toolFailure(error);
    }
  });
}

export function createAdapter(options = {}) {
  const appRoot = options.appRoot || options.dataRoot || options.productRoot || APP_ROOT;
  const manager = options.manager || new McpGenerationJobManager({
    appRoot,
    appVersion: packageInfo.version,
    electronVersion: process.versions.electron || null,
  });
  const discovery = options.discovery || new McpDiscoveryService({ appRoot, appVersion: packageInfo.version });
  const gpuReader = options.gpuReader || queryGpuMemory;
  const tools = collectTools(manager, discovery, gpuReader);
  const artifacts = artifactPublisher(appRoot, options.hosted === true);
  const manifest = options.manifest || {};
  let closed = false;

  function ensureOpen() {
    if (!closed) return;
    const error = new Error("AnimaTail MCP adapter가 종료되었습니다.");
    error.code = "MCP_ADAPTER_CLOSED";
    throw error;
  }

  const adapter = {
    schema: ADAPTER_SCHEMA,
    info() {
      ensureOpen();
      return {
        schema: ADAPTER_SCHEMA,
        addonId: "animatail",
        name: manifest.name || "AnimaTail",
        version: manifest.version || packageInfo.version,
        profiles: ["base", "discovery", "async-job", "artifact-provider"],
        capabilities: Array.isArray(manifest.capabilities)
          ? [...manifest.capabilities]
          : ["single", "multi", "refine", "presets", "python", "cuda"],
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
      if (!tool) return toolFailure(Object.assign(new Error(`AnimaTail MCP 도구를 찾을 수 없습니다: ${toolName}`), { code: "MCP_TOOL_NOT_FOUND" }));
      const parsed = tool.input.safeParse(args || {});
      if (!parsed.success) {
        return toolFailure(Object.assign(new Error(z.prettifyError(parsed.error)), { code: "MCP_INPUT_INVALID" }));
      }
      return artifacts.publish(await tool.handler(parsed.data));
    },
    artifactResolve(reference) {
      ensureOpen();
      return artifacts.resolve(reference);
    },
    async close() {
      if (closed) return;
      closed = true;
      await manager.close?.();
    },
  };
  Object.defineProperties(adapter, {
    _tools: { value: tools },
    _manager: { value: manager },
    _discovery: { value: discovery },
  });
  return adapter;
}

export function createMcpServer(options = {}) {
  const adapter = createAdapter({ ...options, hosted: false });
  const server = new McpServer({
    name: "animatail",
    version: packageInfo.version,
  }, {
    instructions: [
      "Call anima_status when readiness is unknown. Call anima_models_list only when a model or LoRA ID must be discovered.",
      "Use anima_presets_list only to discover preset IDs or names, and anima_preset_get only when preset contents must be inspected. Known exact preset names can be passed directly to generation tools.",
      "Use anima_generate_single or anima_generate_multi to queue generation.",
      "Both tools return immediately; use anima_job_wait rather than frequent anima_job_status polling until completed, partial, failed, or cancelled.",
      "Omit timeoutSeconds so anima_job_wait can choose 30-60 seconds from the expected image count; if it times out, call it again.",
      "Use anima_job_status only for an immediate manual snapshot.",
      "Use anima_job_cancel to stop a queued or running MCP generation request.",
      "Use anima_model_unload only when the MCP queue is idle to free generation-model VRAM without closing the MCP server; the next generation reloads it automatically.",
      "Do not submit concurrent GPU jobs from another AnimaTail GUI or CLI process.",
    ].join(" "),
  });
  for (const [name, tool] of adapter._tools) {
    server.registerTool(name, {
      title: tool.definition.title,
      description: tool.definition.description,
      inputSchema: tool.input,
      annotations: tool.definition.annotations,
    }, async (args) => adapter.callTool(name, args));
  }
  return {
    server,
    adapter,
    manager: adapter._manager,
    discovery: adapter._discovery,
  };
}

export async function start(options = {}) {
  let activeAdapter = null;
  let closing = false;
  const handle = serveStdio(() => {
    const bundle = createMcpServer({ appRoot: options.appRoot || APP_ROOT });
    activeAdapter = bundle.adapter;
    return bundle.server;
  }, {
    onerror: (error) => console.error(`[AnimaTail MCP] ${error.stack || error.message}`),
  });

  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try {
      await activeAdapter?.close();
      await handle.close();
    } finally {
      process.exitCode = 0;
    }
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  process.stdin.once("end", () => void shutdown());
  console.error(`[AnimaTail MCP] stdio server ${packageInfo.version} ready`);
  return { close: shutdown };
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entry === import.meta.url) {
  start().catch((error) => {
    console.error(`[AnimaTail MCP] ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

export { ADAPTER_SCHEMA, APP_ROOT, ARTIFACT_SCHEMA, collectTools, registerTools, toolFailure, toolSuccess };
