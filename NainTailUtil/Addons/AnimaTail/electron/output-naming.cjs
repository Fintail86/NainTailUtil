"use strict";

const generationProfile = require("./generation-profile.cjs");

const INVALID_SEGMENT = /[<>:"/\\|?*\u0000-\u001f]/u;

function normalizeOutputSegment(value, label, fallback = "") {
  const segment = (typeof value === "string" ? value.trim() : "") || fallback;
  if (!segment) return "";
  if (segment.length > generationProfile.outputNaming.segmentMaxLength) {
    throw new Error(`${label}는 최대 ${generationProfile.outputNaming.segmentMaxLength}자까지 입력할 수 있습니다.`);
  }
  if (segment === "." || segment === ".." || INVALID_SEGMENT.test(segment)) {
    throw new Error(`${label}에 파일명으로 사용할 수 없는 문자가 있습니다.`);
  }
  return segment;
}

function normalizeOutputNaming(request, generationMode) {
  return {
    outputPrefix: normalizeOutputSegment(
      request?.outputPrefix,
      "Prefix",
      generationProfile.outputNaming.defaultPrefix,
    ),
    outputSubPrefix: generationMode === "sub-prompt"
      ? normalizeOutputSegment(request?.outputSubPrefix, "SubPrefix")
      : "",
  };
}

function multiOutputDirectory(createdAt, groupId) {
  const timestamp = String(createdAt || "").replace(/\D/g, "").slice(0, 17);
  const shortId = String(groupId || "").replace(/[^a-f0-9]/giu, "").slice(0, 8);
  if (!timestamp || !shortId) throw new Error("멀티 생성 출력 폴더 식별자를 만들 수 없습니다.");
  return `multi_${timestamp}_${shortId}`;
}

module.exports = {
  multiOutputDirectory,
  normalizeOutputNaming,
  normalizeOutputSegment,
};
