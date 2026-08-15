"use strict";

const fs = require("node:fs");
const path = require("node:path");

const LOCALE_ID_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;
const MAX_MESSAGES = 4000;
const MAX_MESSAGE_LENGTH = 8000;

function localeDirectory(appRoot) {
  return path.join(path.resolve(appRoot), "locales");
}

function sanitizeMessages(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > MAX_MESSAGES) return null;
  const messages = Object.create(null);
  for (const [source, translation] of entries) {
    if (!source || source.length > MAX_MESSAGE_LENGTH || typeof translation !== "string"
      || translation.length > MAX_MESSAGE_LENGTH || ["__proto__", "prototype", "constructor"].includes(source)) {
      return null;
    }
    messages[source] = translation;
  }
  return messages;
}

function parseLocaleFile(filePath) {
  const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const id = String(value?.id || "").trim();
  const name = String(value?.name || "").trim();
  const messages = sanitizeMessages(value?.messages);
  if (!LOCALE_ID_PATTERN.test(id) || !name || name.length > 60 || !messages) {
    throw new Error("로케일 파일 형식이 잘못됐습니다.");
  }
  return { id, name, messages, fileName: path.basename(filePath) };
}

function listLocales(appRoot) {
  const directory = localeDirectory(appRoot);
  const locales = [];
  const errors = [];
  let entries = [];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    return { locales: [{ id: "ko", name: "한국어", messages: {}, fileName: null }], errors: [error.message] };
  }
  const seen = new Set();
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".json") continue;
    try {
      const locale = parseLocaleFile(path.join(directory, entry.name));
      const key = locale.id.toLowerCase();
      if (seen.has(key)) throw new Error(`중복 locale id: ${locale.id}`);
      seen.add(key);
      locales.push(locale);
    } catch (error) {
      errors.push(`${entry.name}: ${error.message}`);
    }
  }
  if (!seen.has("ko")) locales.unshift({ id: "ko", name: "한국어", messages: {}, fileName: null });
  locales.sort((left, right) => {
    const priority = (id) => ({ ko: 0, en: 1 })[id.toLowerCase()] ?? 2;
    return priority(left.id) - priority(right.id) || left.name.localeCompare(right.name);
  });
  return { locales, errors };
}

module.exports = { listLocales, localeDirectory, parseLocaleFile };
