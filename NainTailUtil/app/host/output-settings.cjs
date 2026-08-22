"use strict";

const fs = require("node:fs");
const path = require("node:path");

const OUTPUT_SETTINGS_SCHEMA = "naintail.output-settings/v1";
const ADDON_OUTPUT_SETTINGS_SCHEMA = "naintail.addon-output-settings/v1";
const ADDON_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;

function validateOutputRoot(outputRoot, label = "출력 폴더") {
  const normalized = String(outputRoot || "").trim();
  if (!normalized || !path.isAbsolute(normalized)) throw new Error(`${label}는 절대경로여야 합니다.`);
  const resolved = path.resolve(normalized);
  if (resolved === path.parse(resolved).root) throw new Error(`드라이브 루트는 ${label}로 지정할 수 없습니다.`);
  return resolved;
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
}

class HostOutputSettings {
  constructor(productRoot) {
    this.productRoot = path.resolve(productRoot);
    this.defaultOutputRoot = path.join(this.productRoot, "outputs");
    this.settingsPath = path.join(this.productRoot, "config", "output-settings.json");
  }

  read() {
    if (!fs.existsSync(this.settingsPath)) return { schema: OUTPUT_SETTINGS_SCHEMA, outputRoot: null };
    let value;
    try {
      value = JSON.parse(fs.readFileSync(this.settingsPath, "utf8"));
    } catch (error) {
      throw new Error(`출력 폴더 설정을 읽을 수 없습니다: ${error.message}`);
    }
    if (value?.schema !== OUTPUT_SETTINGS_SCHEMA) throw new Error("지원하지 않는 출력 폴더 설정 형식입니다.");
    const outputRoot = value.outputRoot == null ? null : String(value.outputRoot).trim();
    if (outputRoot && !path.isAbsolute(outputRoot)) throw new Error("저장된 출력 폴더는 절대경로여야 합니다.");
    return { schema: OUTPUT_SETTINGS_SCHEMA, outputRoot: outputRoot || null };
  }

  outputRoot(ensure = true) {
    const configured = this.read().outputRoot;
    const outputRoot = path.resolve(configured || this.defaultOutputRoot);
    if (ensure) fs.mkdirSync(outputRoot, { recursive: true });
    return outputRoot;
  }

  status() {
    const configured = this.read().outputRoot;
    const outputRoot = this.outputRoot();
    return {
      schema: OUTPUT_SETTINGS_SCHEMA,
      mode: configured ? "custom" : "default",
      outputRoot,
      defaultOutputRoot: this.defaultOutputRoot,
    };
  }

  setOutputRoot(outputRoot) {
    const resolved = validateOutputRoot(outputRoot);
    fs.mkdirSync(resolved, { recursive: true });
    writeJsonAtomic(this.settingsPath, { schema: OUTPUT_SETTINGS_SCHEMA, outputRoot: resolved });
    return this.status();
  }

  reset() {
    writeJsonAtomic(this.settingsPath, { schema: OUTPUT_SETTINGS_SCHEMA, outputRoot: null });
    return this.status();
  }

  resolveAddonOutputRoot(addonId) {
    const id = String(addonId || "").trim().toLowerCase();
    if (!ADDON_ID_PATTERN.test(id)) throw new Error(`출력 네임스페이스로 사용할 수 없는 애드온 ID입니다: ${addonId}`);
    return path.join(this.outputRoot(false), id);
  }

  resolveManifestOutputRoot(manifest) {
    if (manifest?.outputRootScope === "host") return this.outputRoot(false);
    return this.resolveAddonOutputRoot(manifest?.id);
  }

  resolvePortableAddonOutputStatus(manifest) {
    const id = String(manifest?.id || "").trim().toLowerCase();
    if (!ADDON_ID_PATTERN.test(id) || !manifest?.directory) {
      throw new Error("포터블 출력 경로를 확인할 애드온 manifest가 올바르지 않습니다.");
    }
    const defaultOutputRoot = path.join(path.resolve(manifest.directory), "outputs");
    const settingsPath = path.join(path.resolve(manifest.directory), "config", "output-settings.json");
    if (!fs.existsSync(settingsPath)) {
      return { outputRoot: defaultOutputRoot, defaultOutputRoot, source: "default" };
    }
    let value;
    try {
      value = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    } catch (error) {
      throw new Error(`${manifest.name || id} 출력 폴더 설정을 읽을 수 없습니다: ${error.message}`);
    }
    if (value?.schema !== ADDON_OUTPUT_SETTINGS_SCHEMA) {
      throw new Error(`${manifest.name || id}의 출력 폴더 설정 형식이 올바르지 않습니다.`);
    }
    const configured = value.outputRoot == null
      ? null
      : validateOutputRoot(value.outputRoot, `${manifest.name || id} 출력 폴더`);
    return {
      outputRoot: configured || defaultOutputRoot,
      defaultOutputRoot,
      source: configured ? "custom" : "default",
    };
  }
}

module.exports = {
  ADDON_OUTPUT_SETTINGS_SCHEMA,
  HostOutputSettings,
  OUTPUT_SETTINGS_SCHEMA,
  validateOutputRoot,
  writeJsonAtomic,
};
