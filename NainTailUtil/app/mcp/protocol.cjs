"use strict";

const readline = require("node:readline");

const LATEST_PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_PROTOCOL_VERSIONS = new Set([LATEST_PROTOCOL_VERSION, "2025-03-26", "2024-11-05"]);

function rpcError(id, code, message, data) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

class McpStdioServer {
  constructor(options) {
    this.input = options.input || process.stdin;
    this.output = options.output || process.stdout;
    this.log = options.log || ((message) => process.stderr.write(`[NainTail MCP] ${message}\n`));
    this.name = options.name || "naintail";
    this.version = options.version || "0.1.0";
    this.instructions = options.instructions || "";
    this.tools = options.tools;
    this.callTool = options.callTool;
    this.closed = false;
    this.lines = null;
  }

  write(message) {
    if (!this.closed) this.output.write(`${JSON.stringify(message)}\n`);
  }

  async dispatch(message) {
    if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") return rpcError(message?.id, -32600, "Invalid Request");
    if (message.method.startsWith("notifications/")) return null;
    const id = message.id;
    if (message.method === "initialize") {
      const requested = message.params?.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.has(requested) ? requested : LATEST_PROTOCOL_VERSION;
      return { jsonrpc: "2.0", id, result: { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name: this.name, version: this.version }, instructions: this.instructions } };
    }
    if (message.method === "ping") return { jsonrpc: "2.0", id, result: {} };
    if (message.method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: [...this.tools.values()].map((tool) => tool.definition) } };
    if (message.method === "tools/call") {
      const tool = this.tools.get(message.params?.name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${message.params?.name || ""}`);
      return { jsonrpc: "2.0", id, result: await this.callTool(tool, message.params?.arguments || {}) };
    }
    return rpcError(id, -32601, `Method not found: ${message.method}`);
  }

  async handleLine(line) {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.write(rpcError(null, -32700, "Parse error"));
      return;
    }
    try {
      const response = await this.dispatch(message);
      if (response) this.write(response);
    } catch (error) {
      this.write(rpcError(message.id, -32603, error?.message || "Internal error"));
    }
  }

  start() {
    this.lines = readline.createInterface({ input: this.input, crlfDelay: Infinity });
    this.lines.on("line", (line) => { void this.handleLine(line); });
    this.lines.on("close", () => { this.closed = true; });
    this.log(`stdio server ${this.version} ready`);
    return this;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.lines?.close();
  }
}

module.exports = { LATEST_PROTOCOL_VERSION, McpStdioServer, SUPPORTED_PROTOCOL_VERSIONS, rpcError };
