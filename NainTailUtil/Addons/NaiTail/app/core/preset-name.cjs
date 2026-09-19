"use strict";
const { NainTailError } = require("./errors.cjs");
const PRESET_TYPES = Object.freeze(["example", "character", "sub-slot"]);
function presetName(value) {
  const name = typeof value === "string" ? value.normalize("NFC").trim() : "";
  if (!name || name.length > 80 || /[<>:"/\\|?*\u0000-\u001f]/u.test(name) || /[. ]$/u.test(name) || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(name)) {
    throw new NainTailError("INVALID_PRESET_NAME", "프리셋 이름은 Windows 파일명으로 사용할 수 있는 1~80자여야 합니다.");
  }
  return name;
}
function nameKey(name) { return presetName(name).toLowerCase(); }
function presetType(type) {
  if (!PRESET_TYPES.includes(type)) throw new NainTailError("INVALID_PRESET_TYPE", `지원하지 않는 프리셋 타입입니다: ${type}`);
  return type;
}
module.exports = { PRESET_TYPES, presetName, nameKey, presetType };
