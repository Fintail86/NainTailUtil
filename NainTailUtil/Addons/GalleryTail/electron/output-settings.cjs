"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ADDON_OUTPUT_SETTINGS_SCHEMA = "naintail.addon-output-settings/v1";

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
}

function validateOutputRoot(outputRoot) {
  const normalized = String(outputRoot || "").trim();
  if (!normalized || !path.isAbsolute(normalized)) {
    throw new Error("출력 폴더는 절대경로로 지정해야 합니다.");
  }
  const resolved = path.resolve(normalized);
  if (resolved === path.parse(resolved).root) {
    throw new Error("드라이브 루트는 출력 폴더로 지정할 수 없습니다.");
  }
  return resolved;
}

class AddonOutputSettings {
  constructor(options = {}) {
    this.addonRoot = path.resolve(options.addonRoot);
    this.defaultOutputRoot = path.join(this.addonRoot, "outputs");
    this.settingsPath = path.join(this.addonRoot, "config", "output-settings.json");
    this.standalone = options.standalone !== false;
    this.hostedOutputRoot = this.standalone ? null : validateOutputRoot(options.hostedOutputRoot);
  }

  read() {
    if (!fs.existsSync(this.settingsPath)) {
      return { schema: ADDON_OUTPUT_SETTINGS_SCHEMA, outputRoot: null };
    }
    let value;
    try {
      value = JSON.parse(fs.readFileSync(this.settingsPath, "utf8"));
    } catch (error) {
      throw new Error(`출력 폴더 설정을 읽을 수 없습니다: ${error.message}`);
    }
    if (value?.schema !== ADDON_OUTPUT_SETTINGS_SCHEMA) {
      throw new Error("지원하지 않는 애드온 출력 폴더 설정 형식입니다.");
    }
    const outputRoot = value.outputRoot == null ? null : validateOutputRoot(value.outputRoot);
    return { schema: ADDON_OUTPUT_SETTINGS_SCHEMA, outputRoot };
  }

  outputRoot(ensure = true) {
    const configured = this.standalone ? this.read().outputRoot : null;
    const outputRoot = path.resolve(this.hostedOutputRoot || configured || this.defaultOutputRoot);
    if (ensure) fs.mkdirSync(outputRoot, { recursive: true });
    return outputRoot;
  }

  status() {
    const configured = this.standalone ? this.read().outputRoot : null;
    return {
      schema: ADDON_OUTPUT_SETTINGS_SCHEMA,
      mode: this.standalone ? "standalone" : "hosted",
      source: this.standalone ? (configured ? "custom" : "default") : "host",
      outputRoot: this.outputRoot(),
      defaultOutputRoot: this.defaultOutputRoot,
      locked: !this.standalone,
    };
  }

  setOutputRoot(outputRoot) {
    if (!this.standalone) throw new Error("Hosted 모드에서는 호스트 출력 폴더를 사용합니다.");
    const resolved = validateOutputRoot(outputRoot);
    fs.mkdirSync(resolved, { recursive: true });
    writeJsonAtomic(this.settingsPath, {
      schema: ADDON_OUTPUT_SETTINGS_SCHEMA,
      outputRoot: resolved,
    });
    return this.status();
  }

  reset() {
    if (!this.standalone) throw new Error("Hosted 모드에서는 호스트 출력 폴더를 사용합니다.");
    writeJsonAtomic(this.settingsPath, {
      schema: ADDON_OUTPUT_SETTINGS_SCHEMA,
      outputRoot: null,
    });
    return this.status();
  }
}

module.exports = {
  ADDON_OUTPUT_SETTINGS_SCHEMA,
  AddonOutputSettings,
  validateOutputRoot,
  writeJsonAtomic,
};
