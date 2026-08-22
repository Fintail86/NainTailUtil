"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const packageInfo = require("../package.json");
const { CensorService, collectCensorInputFiles } = require("../electron/censor-service.cjs");
const { resolveAssetPaths } = require("../electron/shared-assets.cjs");
const { CensorMcpError } = require("./errors.cjs");
const { CensorMcpJobManager } = require("./job-manager.cjs");
const { callTool, createTools } = require("./tools.cjs");

const ADAPTER_SCHEMA = "naintail.addon-mcp-profile/v1";
const ARTIFACT_SCHEMA = "naintail.artifact-ref/v1";

function inside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function artifactPublisher(outputDirectory, hosted, privateRoots = []) {
  const outputRoot = path.resolve(outputDirectory);
  const redactions = [...new Set([outputRoot, ...privateRoots].filter(Boolean).map((root) => path.resolve(root)))]
    .map((root) => new RegExp(root.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "giu"));
  const byId = new Map();
  const byPath = new Map();

  function register(output) {
    if (!output || typeof output.absolutePath !== "string") return null;
    const absolutePath = path.resolve(output.absolutePath);
    if (!inside(outputRoot, absolutePath)) return null;
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
    return { schema: ARTIFACT_SCHEMA, addonId: "censortail", artifactId, kind: "image", scope: "session" };
  }

  function transform(value) {
    if (Array.isArray(value)) return value.map(transform);
    if (hosted && typeof value === "string") {
      return redactions.reduce((text, pattern) => text.replace(pattern, "[private-root]"), value);
    }
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
    let replaced = false;
    const content = Array.isArray(result.content) ? result.content.map((block) => {
      if (!replaced && block?.type === "text") {
        replaced = true;
        return { ...block, text: JSON.stringify(structuredContent, null, 2) };
      }
      return block;
    }) : result.content;
    return { ...result, content, structuredContent };
  }

  function resolve(reference) {
    if (reference?.schema !== ARTIFACT_SCHEMA || reference?.addonId !== "censortail" || reference?.scope !== "session") {
      throw new CensorMcpError("ARTIFACT_REF_INVALID", "CensorTail artifact 참조가 올바르지 않습니다.");
    }
    const record = byId.get(String(reference.artifactId || ""));
    if (!record || !fs.existsSync(record.absolutePath)) {
      throw new CensorMcpError("ARTIFACT_NOT_FOUND", `CensorTail artifact를 찾을 수 없습니다: ${reference.artifactId || ""}`);
    }
    return { artifactRef: { ...reference }, ...record };
  }

  return { publish, resolve };
}

function createAdapter(options = {}) {
  const appRoot = path.resolve(options.dataRoot || options.productRoot || path.resolve(__dirname, ".."));
  const hosted = options.hosted === true;
  if (hosted && !options.runtimeRoot && !options.dependencies?.runtimeRoot) {
    throw new CensorMcpError("HOST_RUNTIME_REQUIRED", "Hosted CensorTail MCP에 NainTail runtimeRoot가 주입되지 않았습니다.");
  }
  const resourceRoot = path.resolve(options.resourceRoot
    || appRoot);
  const standaloneAssets = hosted ? null : resolveAssetPaths(appRoot);
  const runtimeRoot = path.resolve(options.runtimeRoot
    || options.dependencies?.runtimeRoot
    || standaloneAssets?.runtimeRoot
    || path.join(resourceRoot, "runtime"));
  const runtimeManifestPath = options.runtimeManifestPath
    || options.dependencies?.runtimeManifestPath
    || (hosted ? path.join(resourceRoot, "hosted-runtime-requirements.json") : null);
  const modelRoot = path.resolve(options.modelRoot
    || standaloneAssets?.modelRoot
    || path.join(resourceRoot, "Models", "censor"));
  const outputRoot = path.resolve(options.outputRoot || path.join(appRoot, "outputs"));
  let manager = options.manager || null;
  const service = options.service || new CensorService(appRoot, (event) => manager?.handleEvent(event), {
    resourceRoot,
    runtimeRoot,
    runtimeManifestPath,
    modelRoot,
    outputRoot,
  });
  manager ||= new CensorMcpJobManager(service, options);
  const artifacts = artifactPublisher(outputRoot, hosted, [appRoot, resourceRoot]);
  const resolveHostArtifact = options.resolveArtifact;
  const manifest = options.manifest || {};
  let closed = false;

  async function resolveInputs(args) {
    const artifactRefs = Array.isArray(args.artifactRefs) ? args.artifactRefs : [];
    const inputPaths = Array.isArray(args.inputPaths) ? args.inputPaths : [];
    if (artifactRefs.length && inputPaths.length) {
      throw new CensorMcpError("MCP_INPUT_INVALID", "artifactRefs와 inputPaths는 동시에 사용할 수 없습니다.");
    }
    if (hosted && inputPaths.length) {
      throw new CensorMcpError("MCP_INPUT_MODE_INVALID", "Hosted CensorTail은 절대경로 대신 artifactRefs만 받습니다.");
    }
    if (!artifactRefs.length && !inputPaths.length) {
      throw new CensorMcpError("MCP_INPUT_INVALID", "검열할 artifactRefs 또는 Standalone inputPaths가 필요합니다.");
    }
    let files;
    if (artifactRefs.length) {
      if (typeof resolveHostArtifact !== "function") {
        throw new CensorMcpError("ARTIFACT_RESOLVER_UNAVAILABLE", "현재 실행 형태에서는 외부 artifactRef를 해석할 수 없습니다.");
      }
      files = [];
      for (const reference of artifactRefs.slice(0, 200)) files.push(await resolveHostArtifact(reference));
      service.registerArtifacts(files);
    } else {
      files = collectCensorInputFiles(inputPaths, 200);
      service.registerImageBatch(files);
    }
    const ids = [...new Set(files.map((file) => service.imageIdForPath(file.absolutePath)).filter(Boolean))];
    if (!ids.length) throw new CensorMcpError("CENSOR_INPUT_NOT_FOUND", "읽을 수 있는 검열 입력 이미지를 찾지 못했습니다.");
    return ids;
  }

  const tools = createTools(service, manager, resolveInputs, manifest.version || packageInfo.version);
  const ensureOpen = () => {
    if (!closed) return;
    throw new CensorMcpError("MCP_ADAPTER_CLOSED", "CensorTail MCP adapter가 종료되었습니다.");
  };

  return {
    schema: ADAPTER_SCHEMA,
    info() {
      ensureOpen();
      return {
        schema: ADAPTER_SCHEMA,
        addonId: "censortail",
        name: manifest.name || "CensorTail",
        version: manifest.version || packageInfo.version,
        profiles: ["base", "async-job", "artifact-consumer", "artifact-provider"],
        capabilities: Array.isArray(manifest.capabilities) ? [...manifest.capabilities] : ["auto-censor", "batch", "mcp"],
        toolCount: tools.size,
      };
    },
    toolsList() {
      ensureOpen();
      return [...tools.values()].map((tool) => tool.definition);
    },
    toolGet(name) {
      ensureOpen();
      return tools.get(String(name || ""))?.definition || null;
    },
    async callTool(name, args = {}) {
      ensureOpen();
      const tool = tools.get(String(name || ""));
      if (!tool) return callTool({ handler: () => { throw new CensorMcpError("MCP_TOOL_NOT_FOUND", `CensorTail MCP 도구를 찾을 수 없습니다: ${name}`); } }, args);
      return artifacts.publish(await callTool(tool, args));
    },
    artifactResolve(reference) {
      ensureOpen();
      return artifacts.resolve(reference);
    },
    async close() {
      if (closed) return;
      closed = true;
      await manager.close();
    },
  };
}

module.exports = { ADAPTER_SCHEMA, ARTIFACT_SCHEMA, artifactPublisher, createAdapter, inside };
