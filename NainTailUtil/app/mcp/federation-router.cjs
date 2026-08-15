"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { inside } = require("../host/addon-registry.cjs");
const { artifactError, validateArtifactRef } = require("../host/artifact-ref.cjs");
const { inspectMcpAdapter, validateMcpAdapter } = require("../host/mcp-adapter.cjs");

function routerError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function mcpMode(addon) {
  if (addon?.entries?.mcpAdapter) return "federated";
  if (addon?.entries?.mcp) return "standalone";
  return "none";
}

class FederationRouter {
  constructor(registry, context = {}) {
    this.registry = registry;
    this.hostRoot = context.hostRoot || registry.productRoot;
    this.adapters = new Map();
    this.activating = new Map();
    this.closed = false;
  }

  ensureOpen() {
    if (this.closed) throw routerError("MCP_ROUTER_CLOSED", "NainTail MCP router가 종료되었습니다.");
  }

  requireAddon(addonId) {
    this.ensureOpen();
    const id = String(addonId || "").trim();
    const addon = this.registry.get(id);
    if (!addon) throw routerError("HOST_ADDON_NOT_FOUND", `애드온을 찾을 수 없습니다: ${id}`, { addonId: id });
    return addon;
  }

  addonsList() {
    this.ensureOpen();
    return this.registry.list().map((item) => {
      const addon = this.registry.get(item.id);
      const missing = this.registry.missingRequirements(addon);
      return {
        id: item.id,
        name: item.name,
        available: missing.length === 0,
        mcp: mcpMode(addon),
      };
    });
  }

  async addonGet(addonId) {
    const addon = this.requireAddon(addonId);
    const missingRequirements = this.registry.missingRequirements(addon);
    const result = {
      id: addon.id,
      name: addon.name,
      version: addon.version,
      builtIn: addon.builtIn === true,
      default: addon.default === true,
      requires: Array.isArray(addon.requires) ? [...addon.requires] : [],
      missingRequirements,
      capabilities: Array.isArray(addon.capabilities) ? [...addon.capabilities] : [],
      mcp: mcpMode(addon),
    };
    if (result.mcp === "federated" && missingRequirements.length === 0) {
      const adapter = await this.activate(addon.id);
      result.adapter = await adapter.info();
    }
    return result;
  }

  async activate(addonId) {
    const addon = this.requireAddon(addonId);
    if (this.adapters.has(addon.id)) return this.adapters.get(addon.id);
    if (this.activating.has(addon.id)) return this.activating.get(addon.id);
    const activation = (async () => {
      const missing = this.registry.missingRequirements(addon);
      if (missing.length) throw routerError("HOST_ADDON_REQUIREMENT_MISSING", `필수 애드온이 없습니다: ${missing.join(", ")}`, { addonId: addon.id, missing });
      if (!addon.entries?.mcpAdapter) throw routerError("MCP_ADAPTER_NOT_AVAILABLE", `연합 MCP adapter가 없습니다: ${addon.id}`, { addonId: addon.id, mcp: mcpMode(addon) });
      const module = this.registry.load(addon, "mcpAdapter");
      if (!module || typeof module.createAdapter !== "function") throw routerError("MCP_ADAPTER_INVALID", `MCP adapter entry에 createAdapter가 없습니다: ${addon.id}`);
      const adapter = validateMcpAdapter(await module.createAdapter({
        hostRoot: this.hostRoot,
        productRoot: addon.directory,
        dataRoot: addon.directory,
        manifest: addon,
        hosted: true,
        dependencyRoots: Object.fromEntries((Array.isArray(addon.requires) ? addon.requires : [])
          .map((id) => [id, this.registry.get(id)?.directory || null])
          .filter(([, directory]) => directory)),
        resolveArtifact: (reference) => this.resolveArtifact(reference, addon.id),
      }), addon);
      try {
        await inspectMcpAdapter(adapter, addon);
      } catch (error) {
        await Promise.resolve().then(() => adapter.close?.());
        throw error;
      }
      if (this.closed) {
        await Promise.resolve().then(() => adapter.close());
        throw routerError("MCP_ROUTER_CLOSED", "NainTail MCP router가 종료되었습니다.");
      }
      this.adapters.set(addon.id, adapter);
      return adapter;
    })();
    this.activating.set(addon.id, activation);
    try {
      return await activation;
    } finally {
      this.activating.delete(addon.id);
    }
  }

  async toolsList(addonId) {
    const adapter = await this.activate(addonId);
    const definitions = await adapter.toolsList();
    return definitions.map((definition) => ({
      name: definition.name,
      title: definition.title || definition.name,
      description: definition.description || "",
    }));
  }

  async toolGet(addonId, toolName) {
    const adapter = await this.activate(addonId);
    const definition = await adapter.toolGet(toolName);
    if (!definition) throw routerError("MCP_TOOL_NOT_FOUND", `애드온 MCP 도구를 찾을 수 없습니다: ${addonId}/${toolName}`, { addonId, toolName });
    return definition;
  }

  async callTool(addonId, toolName, args = {}) {
    const adapter = await this.activate(addonId);
    const definition = await adapter.toolGet(toolName);
    if (!definition) throw routerError("MCP_TOOL_NOT_FOUND", `애드온 MCP 도구를 찾을 수 없습니다: ${addonId}/${toolName}`, { addonId, toolName });
    const result = await adapter.callTool(toolName, args);
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw routerError("MCP_ADAPTER_RESULT_INVALID", `애드온 MCP 결과가 객체가 아닙니다: ${addonId}/${toolName}`);
    }
    return {
      ...result,
      _meta: {
        ...(result._meta || {}),
        naintail: { addonId, toolName },
      },
    };
  }

  async resolveArtifact(reference, consumerAddonId) {
    const artifactRef = validateArtifactRef(reference);
    const provider = this.requireAddon(artifactRef.addonId);
    const consumer = this.requireAddon(consumerAddonId);
    const permitted = provider.id === consumer.id
      || (Array.isArray(consumer.requires) && consumer.requires.includes(provider.id));
    if (!permitted) {
      throw artifactError(
        "ARTIFACT_ACCESS_DENIED",
        `애드온 간 artifact 접근이 허용되지 않았습니다: ${provider.id} -> ${consumer.id}`,
        { providerAddonId: provider.id, consumerAddonId: consumer.id },
      );
    }
    const adapter = await this.activate(provider.id);
    if (typeof adapter.artifactResolve !== "function") {
      throw artifactError("ARTIFACT_PROVIDER_UNAVAILABLE", `artifact provider가 아닙니다: ${provider.id}`);
    }
    const resolved = await adapter.artifactResolve(artifactRef);
    const absolutePath = path.resolve(String(resolved?.absolutePath || ""));
    if (!inside(provider.directory, absolutePath) || !fs.existsSync(absolutePath)) {
      throw artifactError(
        "ARTIFACT_PATH_INVALID",
        `artifact 경로가 provider 경계를 벗어났거나 존재하지 않습니다: ${provider.id}`,
        { providerAddonId: provider.id },
      );
    }
    return {
      artifactRef,
      absolutePath,
      kind: String(resolved.kind || artifactRef.kind),
      width: Number(resolved.width) || null,
      height: Number(resolved.height) || null,
    };
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await Promise.allSettled([...this.activating.values()]);
    const adapters = [...this.adapters.values()];
    this.adapters.clear();
    await Promise.allSettled(adapters.map((adapter) => Promise.resolve().then(() => adapter.close())));
  }
}

module.exports = { FederationRouter, mcpMode, routerError };
