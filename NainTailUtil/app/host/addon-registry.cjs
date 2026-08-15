"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ADDON_SCHEMA = "naintail.addon/v1";
const ADDON_ID = /^[a-z][a-z0-9.-]*$/u;
const ENTRY_KINDS = new Set(["electron", "preload", "renderer", "cli", "mcp", "mcpAdapter"]);
const PROTOCOL_SCHEME = /^[a-z][a-z0-9+.-]*$/u;

function inside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function readAddon(directory) {
  const manifestPath = path.join(directory, "addon.json");
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.schema !== ADDON_SCHEMA) throw new Error(`지원하지 않는 애드온 manifest입니다: ${manifestPath}`);
  if (!ADDON_ID.test(String(manifest.id || ""))) throw new Error(`애드온 ID가 올바르지 않습니다: ${manifestPath}`);
  if (!manifest.entries || typeof manifest.entries !== "object") throw new Error(`애드온 entry가 없습니다: ${manifest.id}`);
  return Object.freeze({ ...manifest, directory: path.resolve(directory), manifestPath });
}

class AddonRegistry {
  constructor(productRoot) {
    this.productRoot = path.resolve(productRoot);
    this.addonsRoot = path.join(this.productRoot, "Addons");
    this.addons = [];
  }

  discover() {
    if (!fs.existsSync(this.addonsRoot)) {
      this.addons = [];
      return this.addons;
    }
    const seen = new Set();
    this.addons = fs.readdirSync(this.addonsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => readAddon(path.join(this.addonsRoot, entry.name)))
      .filter(Boolean)
      .sort((left, right) => Number(right.default === true) - Number(left.default === true)
        || Number(left.order ?? Number.MAX_SAFE_INTEGER) - Number(right.order ?? Number.MAX_SAFE_INTEGER)
        || left.name.localeCompare(right.name))
      .map((addon) => {
        if (seen.has(addon.id)) throw new Error(`중복 애드온 ID입니다: ${addon.id}`);
        seen.add(addon.id);
        return addon;
      });
    return this.addons;
  }

  list() {
    return this.addons.map((addon) => ({
      id: addon.id,
      name: addon.name,
      version: addon.version,
      builtIn: addon.builtIn === true,
      default: addon.default === true,
      order: Number.isFinite(Number(addon.order)) ? Number(addon.order) : null,
      requires: Array.isArray(addon.requires) ? [...addon.requires] : [],
      capabilities: Array.isArray(addon.capabilities) ? [...addon.capabilities] : [],
    }));
  }

  get(id) {
    return this.addons.find((addon) => addon.id === id) || null;
  }

  getDefault() {
    return this.addons.find((addon) => addon.default === true) || this.addons[0] || null;
  }

  missingRequirements(addon) {
    if (!addon) return [];
    return (Array.isArray(addon.requires) ? addon.requires : [])
      .map(String)
      .filter((id) => !this.get(id));
  }

  protocols() {
    const seen = new Set();
    return this.addons.flatMap((addon) => (Array.isArray(addon.protocols) ? addon.protocols : []).map((entry) => {
      const scheme = String(entry?.scheme || "");
      if (!PROTOCOL_SCHEME.test(scheme)) throw new Error(`애드온 protocol scheme이 올바르지 않습니다: ${addon.id}`);
      if (seen.has(scheme)) throw new Error(`중복 애드온 protocol scheme입니다: ${scheme}`);
      seen.add(scheme);
      return { scheme, privileges: { ...(entry.privileges || {}) } };
    }));
  }

  resolveEntry(addon, kind) {
    if (!addon || !ENTRY_KINDS.has(kind)) throw new Error(`지원하지 않는 애드온 entry 종류입니다: ${kind}`);
    const relativePath = addon.entries[kind];
    if (!relativePath || typeof relativePath !== "string") return null;
    const resolved = path.resolve(addon.directory, relativePath);
    if (!inside(addon.directory, resolved)) throw new Error(`애드온 경계를 벗어난 entry입니다: ${addon.id}/${kind}`);
    if (!fs.existsSync(resolved)) throw new Error(`애드온 entry 파일이 없습니다: ${addon.id}/${kind}`);
    return resolved;
  }

  load(addon, kind) {
    const entry = this.resolveEntry(addon, kind);
    return entry ? require(entry) : null;
  }
}

module.exports = { ADDON_SCHEMA, AddonRegistry, inside, readAddon };
