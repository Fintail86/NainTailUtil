"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { NainTailError } = require("./errors.cjs");
const {
  createExamplePreset,
  createSubSlotPreset,
  EXAMPLE_PRESET_SCHEMA,
  PRESET_SCHEMA,
} = require("./project-model.cjs");
const { readJson, safeFileStem, writeJsonAtomic } = require("./json-store.cjs");
const { ensureProductDirectories, resolveInside } = require("./paths.cjs");

class PresetStore {
  constructor(productRoot) {
    this.productRoot = ensureProductDirectories(productRoot);
    this.directories = {
      "sub-slot": resolveInside(this.productRoot, "Presets", "sub-slots"),
      example: resolveInside(this.productRoot, "Presets", "examples"),
    };
  }

  listDirectory(type, schema) {
    const directory = this.directories[type];
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
      .map((entry) => {
        try {
          const preset = readJson(path.join(directory, entry.name), "INVALID_PRESET");
          if (preset.schema !== schema) throw new Error("지원하지 않는 schema");
          return {
            id: preset.id,
            name: preset.name,
            type,
            itemCount: type === "sub-slot" ? preset.items?.length || 0 : 1,
            ...(type === "example" ? {
              hasPrompt: Boolean(String(preset.prompt || "").trim()),
              hasNegativePrompt: Boolean(String(preset.negativePrompt || "").trim()),
            } : {}),
            fileName: entry.name,
          };
        } catch (error) {
          return { id: null, name: entry.name, type, itemCount: 0, fileName: entry.name, error: error.message };
        }
      });
  }

  list() {
    return [
      ...this.listDirectory("sub-slot", PRESET_SCHEMA),
      ...this.listDirectory("example", EXAMPLE_PRESET_SCHEMA),
    ]
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }

  findRecordById(id) {
    return this.list().find((entry) => entry.id === id) || null;
  }

  get(id) {
    const record = this.findRecordById(id);
    if (!record) throw new NainTailError("PRESET_NOT_FOUND", `프리셋을 찾을 수 없습니다: ${id}`);
    const preset = readJson(path.join(this.directories[record.type], record.fileName), "INVALID_PRESET");
    if (record.type === "sub-slot" && preset.schema === PRESET_SCHEMA) return createSubSlotPreset(preset);
    if (record.type === "example" && preset.schema === EXAMPLE_PRESET_SCHEMA) return createExamplePreset(preset);
    throw new NainTailError("INVALID_PRESET", "지원하지 않는 프리셋 schema입니다.");
  }

  save(input) {
    const currentRecord = input?.id ? this.findRecordById(input.id) : null;
    const existing = currentRecord ? this.get(input.id) : null;
    const type = existing?.type || (input?.type === "example" || input?.schema === EXAMPLE_PRESET_SCHEMA ? "example" : "sub-slot");
    const normalize = type === "example" ? createExamplePreset : createSubSlotPreset;
    const preset = normalize({ ...existing, ...input, type, createdAt: existing?.createdAt || input?.createdAt });
    const directory = this.directories[type];
    const fileName = `${safeFileStem(preset.name, "preset")}_${preset.id.slice(-8)}.json`;
    writeJsonAtomic(resolveInside(directory, fileName), preset);
    if (currentRecord && (currentRecord.type !== type || currentRecord.fileName !== fileName)) {
      fs.rmSync(resolveInside(this.directories[currentRecord.type], currentRecord.fileName));
    }
    return preset;
  }

  delete(id) {
    const record = this.findRecordById(id);
    if (!record) throw new NainTailError("PRESET_NOT_FOUND", `프리셋을 찾을 수 없습니다: ${id}`);
    fs.rmSync(resolveInside(this.directories[record.type], record.fileName));
    return { deleted: true, id };
  }
}

module.exports = { PresetStore };
