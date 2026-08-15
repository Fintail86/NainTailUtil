"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { NainTailError } = require("../core/errors.cjs");
const { resolveInside } = require("../core/paths.cjs");
const { writeJsonAtomic } = require("../core/json-store.cjs");

class CredentialService {
  constructor(productRoot, safeStorage) {
    this.safeStorage = safeStorage;
    this.filePath = resolveInside(productRoot, "config", "credentials.json");
  }

  inspectToken() {
    const stored = fs.existsSync(this.filePath);
    const encryptionAvailable = Boolean(this.safeStorage?.isEncryptionAvailable?.());
    if (!encryptionAvailable) return { state: "unavailable", stored, encryptionAvailable, token: "" };
    if (!stored) return { state: "missing", stored: false, encryptionAvailable, token: "" };
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      if (data.schema !== "naintail.credentials/v1" || !data.encryptedToken) {
        return { state: "invalid", stored: true, encryptionAvailable, token: "" };
      }
      const token = String(this.safeStorage.decryptString(Buffer.from(data.encryptedToken, "base64")) || "").trim();
      return token
        ? { state: "ready", stored: true, encryptionAvailable, token }
        : { state: "invalid", stored: true, encryptionAvailable, token: "" };
    } catch {
      return { state: "invalid", stored: true, encryptionAvailable, token: "" };
    }
  }

  status() {
    const { token, ...inspection } = this.inspectToken();
    return { ...inspection, configured: inspection.state === "ready" };
  }

  saveToken(token) {
    const value = String(token || "").trim();
    if (!value) throw new NainTailError("INVALID_TOKEN", "저장할 NovelAI 토큰이 비어 있습니다.");
    if (!this.safeStorage?.isEncryptionAvailable?.()) {
      throw new NainTailError("CREDENTIAL_ENCRYPTION_UNAVAILABLE", "Windows 보호 저장소를 사용할 수 없습니다.");
    }
    let encrypted;
    try {
      encrypted = this.safeStorage.encryptString(value);
      const verified = this.safeStorage.decryptString(encrypted);
      if (verified !== value) throw new Error("round-trip mismatch");
    } catch {
      throw new NainTailError("CREDENTIAL_ENCRYPTION_FAILED", "토큰 암호화 검증에 실패했습니다. 저장하지 않았습니다.");
    }
    writeJsonAtomic(this.filePath, {
      schema: "naintail.credentials/v1",
      provider: "novelai",
      encryptedToken: encrypted.toString("base64"),
      updatedAt: new Date().toISOString(),
    });
    const status = this.status();
    if (!status.configured) {
      throw new NainTailError("CREDENTIAL_DECRYPT_FAILED", "저장한 토큰을 다시 읽을 수 없습니다. 토큰을 다시 저장해 주세요.");
    }
    return status;
  }

  getToken() {
    return this.inspectToken().token;
  }

  clear() {
    if (fs.existsSync(this.filePath)) fs.rmSync(this.filePath);
    return this.status();
  }
}

module.exports = { CredentialService };
