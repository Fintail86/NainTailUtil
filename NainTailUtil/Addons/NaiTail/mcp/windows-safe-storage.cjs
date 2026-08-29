"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function decryptSafeStorageValue(value, key) {
  const encrypted = Buffer.from(value);
  const prefix = encrypted.subarray(0, 3).toString("ascii");
  if (prefix !== "v10" && prefix !== "v11") throw new Error("지원하지 않는 Windows safeStorage 형식입니다.");
  if (encrypted.length < 3 + 12 + 16) throw new Error("Windows safeStorage 암호문이 손상되었습니다.");
  const nonce = encrypted.subarray(3, 15);
  const tag = encrypted.subarray(encrypted.length - 16);
  const ciphertext = encrypted.subarray(15, encrypted.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

class WindowsSafeStorageReader {
  constructor(options = {}) {
    const appData = options.appData || process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    this.localStatePath = options.localStatePath || path.join(appData, options.appName || "naintailutil", "Local State");
    this.helperPath = options.helperPath || path.resolve(__dirname, "..", "bootstrap", "unprotect-safe-storage-key.ps1");
    this.powershellPath = options.powershellPath
      || path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    this.key = null;
  }

  isEncryptionAvailable() {
    return process.platform === "win32"
      && fs.existsSync(this.localStatePath)
      && fs.existsSync(this.helperPath)
      && fs.existsSync(this.powershellPath);
  }

  encryptionKey() {
    if (this.key) return this.key;
    if (!this.isEncryptionAvailable()) throw new Error("Windows safeStorage 키를 사용할 수 없습니다.");
    const encoded = execFileSync(this.powershellPath, [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy", "Bypass",
      "-File", this.helperPath,
      "-LocalStatePath", this.localStatePath,
    ], {
      encoding: "utf8",
      maxBuffer: 4096,
      windowsHide: true,
    }).trim();
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32) throw new Error("Windows safeStorage 키 길이가 올바르지 않습니다.");
    this.key = key;
    return this.key;
  }

  decryptString(value) {
    return decryptSafeStorageValue(value, this.encryptionKey()).toString("utf8");
  }
}

function createWindowsSafeStorageReader(options = {}) {
  return new WindowsSafeStorageReader(options);
}

module.exports = { WindowsSafeStorageReader, createWindowsSafeStorageReader, decryptSafeStorageValue };
