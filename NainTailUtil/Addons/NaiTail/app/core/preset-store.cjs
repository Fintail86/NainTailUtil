"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { NainTailError } = require("./errors.cjs");
const { createCharacterPreset, CHARACTER_PRESET_SCHEMA, createExamplePreset, createSubSlotPreset, EXAMPLE_PRESET_SCHEMA, PRESET_SCHEMA } = require("./project-model.cjs");
const { readJson, safeFileStem, writeJsonAtomic } = require("./json-store.cjs");
const { ensureProductDirectories, resolveInside } = require("./paths.cjs");
const { presetName, nameKey, presetType } = require("./preset-name.cjs");
const DEFINITIONS = {
  "sub-slot": { folder: "sub-slots", schema: PRESET_SCHEMA, normalize: createSubSlotPreset },
  example: { folder: "examples", schema: EXAMPLE_PRESET_SCHEMA, normalize: createExamplePreset },
  character: { folder: "characters", schema: CHARACTER_PRESET_SCHEMA, normalize: createCharacterPreset },
};
class PresetStore {
  constructor(productRoot) {
    this.productRoot = ensureProductDirectories(productRoot);
    this.directories = Object.fromEntries(Object.entries(DEFINITIONS).map(([type, def]) => [type, resolveInside(this.productRoot, "Presets", def.folder)]));
    try { this.migration = this.migrateLegacyNames(); }
    catch (error) {
      if (!["DUPLICATE_PRESET_NAME", "INVALID_PRESET_NAME", "PRESET_STORE_BUSY"].includes(error.code)) throw error;
      // A preset-library conflict must not prevent direct generation or other libraries.
      this.migrationError = error;
      this.migration = { migrated: 0, backup: null, error: { code: error.code, message: error.message } };
    }
  }
  withWriteLock(work) {
    const lock = resolveInside(this.productRoot, "Presets", ".preset-write.lock");
    let descriptor;
    try { descriptor = fs.openSync(lock, "wx"); }
    catch (error) {
      if (error.code === "EEXIST") throw new NainTailError("PRESET_STORE_BUSY", "다른 프리셋 저장 작업이 진행 중입니다. 잠시 후 다시 시도하세요.");
      throw error;
    }
    try { return work(); }
    finally { fs.closeSync(descriptor); fs.unlinkSync(lock); }
  }
  migrateLegacyNames() {
    return this.withWriteLock(() => {
      const plan = [];
      for (const [type, directory] of Object.entries(this.directories)) {
        const names = new Set();
        for (const fileName of fs.readdirSync(directory).filter((name) => name.toLowerCase().endsWith(".json"))) {
          let data;
          try { data = readJson(path.join(directory, fileName)); } catch { continue; }
          if (data.schema !== DEFINITIONS[type].schema) continue;
          const legacy = data.id && fileName === `${safeFileStem(data.name, "preset")}_${data.id.slice(-8)}.json`;
          const name = presetName(legacy ? data.name : fileName.slice(0, -5));
          const key = nameKey(name);
          if (names.has(key)) throw new NainTailError("DUPLICATE_PRESET_NAME", `${type} 프리셋 이름이 중복됩니다: ${name}. 원본 파일은 변경하지 않았습니다.`);
          names.add(key);
          if (legacy) {
            const target = resolveInside(directory, `${name}.json`);
            if (fs.existsSync(target)) throw new NainTailError("DUPLICATE_PRESET_NAME", `이미 존재하는 프리셋 파일입니다: ${name}.json`);
            plan.push({ type, source: resolveInside(directory, fileName), target, fileName });
          }
        }
      }
      if (!plan.length) return { migrated: 0, backup: null };
      const backup = resolveInside(this.productRoot, "Presets", ".name-migration-backup", `${Date.now()}-${process.pid}`);
      // Back up every source before changing any active filename.
      for (const item of plan) {
        const folder = resolveInside(backup, item.type);
        fs.mkdirSync(folder, { recursive: true });
        fs.copyFileSync(item.source, resolveInside(folder, item.fileName), fs.constants.COPYFILE_EXCL);
      }
      const copied = [];
      try {
        for (const item of plan) { fs.copyFileSync(item.source, item.target, fs.constants.COPYFILE_EXCL); copied.push(item); }
      } catch (error) {
        for (const item of copied) fs.unlinkSync(item.target);
        throw error;
      }
      for (const item of plan) fs.unlinkSync(item.source);
      return { migrated: plan.length, backup };
    });
  }
  listDirectory(type) {
    const directory = this.directories[type];
    return fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json")).map((entry) => {
      try {
        const preset = readJson(path.join(directory, entry.name), "INVALID_PRESET");
        if (preset.schema !== DEFINITIONS[type].schema) throw new Error("지원하지 않는 schema");
        const legacy = preset.id && entry.name === `${safeFileStem(preset.name, "preset")}_${preset.id.slice(-8)}.json`;
        const name = presetName(legacy ? preset.name : entry.name.slice(0, -5));
        return {
          id: preset.id, name, type,
          itemCount: type === "sub-slot" ? preset.items?.length || 0 : 1,
          ...(type === "example" ? { hasPrompt: Boolean(String(preset.prompt || "").trim()), hasNegativePrompt: Boolean(String(preset.negativePrompt || "").trim()) } : {}),
          ...(type === "character" ? { outfitCount: preset.outfits?.length || 0, outfits: (preset.outfits || []).map((outfit) => outfit.name) } : {}),
          fileName: entry.name,
        };
      } catch (error) { return { id: null, name: entry.name, type, itemCount: 0, fileName: entry.name, error: error.message }; }
    });
  }
  list() { return Object.keys(DEFINITIONS).flatMap((type) => this.listDirectory(type)).sort((a, b) => a.name.localeCompare(b.name, "ko")); }
  findRecordById(id) { return this.list().find((entry) => entry.id === id) || null; }
  findRecord(selector) {
    if (typeof selector === "string") return this.findRecordById(selector); // Legacy GUI/ID compatibility.
    const type = presetType(selector?.type);
    const key = nameKey(selector?.name);
    const matches = this.listDirectory(type).filter((item) => !item.error && nameKey(item.name) === key);
    if (matches.length > 1) throw new NainTailError("DUPLICATE_PRESET_NAME", `프리셋 이름이 중복됩니다: ${selector.name}`);
    return matches[0] || null;
  }
  get(selector) {
    const record = this.findRecord(selector);
    if (!record) throw new NainTailError("PRESET_NOT_FOUND", `프리셋을 찾을 수 없습니다: ${typeof selector === "string" ? selector : `${selector?.type}:${selector?.name}`}`);
    const preset = readJson(resolveInside(this.directories[record.type], record.fileName), "INVALID_PRESET");
    return DEFINITIONS[record.type].normalize({ ...preset, name: record.name });
  }
  save(input) {
    if (this.migrationError) throw this.migrationError;
    return this.withWriteLock(() => {
      const current = input?.id ? this.findRecordById(input.id) : null;
      const existing = current ? this.get(input.id) : null;
      const inferred = Object.entries(DEFINITIONS).find(([, def]) => def.schema === input?.schema)?.[0];
      const type = presetType(existing?.type || input?.type || inferred || "sub-slot");
      const preset = DEFINITIONS[type].normalize({ ...existing, ...input, type, createdAt: existing?.createdAt || input?.createdAt, updatedAt: new Date().toISOString() });
      preset.name = presetName(preset.name);
      const duplicate = this.findRecord({ type, name: preset.name });
      if (duplicate && duplicate.id !== preset.id) throw new NainTailError("DUPLICATE_PRESET_NAME", `같은 타입의 프리셋 이름이 이미 있습니다: ${preset.name}`);
      const directory = this.directories[type];
      const fileName = `${preset.name}.json`;
      const target = resolveInside(directory, fileName);
      // Also protect unparseable files from being overwritten by a new preset.
      if (fs.existsSync(target) && (!current || nameKey(current.name) !== nameKey(preset.name))) throw new NainTailError("DUPLICATE_PRESET_NAME", `이미 존재하는 파일입니다: ${fileName}`);
      if (current && nameKey(current.name) === nameKey(preset.name) && current.fileName !== fileName) fs.renameSync(resolveInside(directory, current.fileName), target);
      writeJsonAtomic(target, preset);
      if (current && nameKey(current.name) !== nameKey(preset.name)) fs.unlinkSync(resolveInside(this.directories[current.type], current.fileName));
      return preset;
    });
  }
  delete(selector) {
    if (this.migrationError) throw this.migrationError;
    return this.withWriteLock(() => {
      const record = this.findRecord(selector);
      if (!record) throw new NainTailError("PRESET_NOT_FOUND", "프리셋을 찾을 수 없습니다.");
      fs.unlinkSync(resolveInside(this.directories[record.type], record.fileName));
      return { deleted: true, id: record.id, type: record.type, name: record.name };
    });
  }
}
module.exports = { PresetStore };
