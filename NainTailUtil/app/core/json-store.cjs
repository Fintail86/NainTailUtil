"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { NainTailError } = require("./errors.cjs");

function safeFileStem(value, fallback = "item") {
  const normalized = String(value || "")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_")
    .replace(/[. ]+$/gu, "")
    .trim()
    .slice(0, 80);
  return normalized || fallback;
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const body = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(tempPath, body, { encoding: "utf8", flag: "wx" });
  try {
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      if (fs.existsSync(filePath)) fs.rmSync(filePath);
      fs.renameSync(tempPath, filePath);
    } catch {
      if (fs.existsSync(tempPath)) fs.rmSync(tempPath);
      throw error;
    }
  }
}

function readJson(filePath, code = "INVALID_JSON") {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new NainTailError(code, `JSON 파일을 읽을 수 없습니다: ${path.basename(filePath)}`, {
      cause: error.message,
    });
  }
}

module.exports = { readJson, safeFileStem, writeJsonAtomic };

