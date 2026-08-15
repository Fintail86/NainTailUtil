"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { vibeCacheFileName } = require("../../core/vibe-reference.cjs");

const ENCODE_VIBE_ENDPOINT = "https://image.novelai.net/ai/encode-vibe";
const MAX_ENCODED_VIBE_BYTES = 64 * 1024 * 1024;

async function encodeVibe(vibe, model, token, productRoot) {
  const cacheDirectory = path.join(productRoot, "cache", "vibes");
  fs.mkdirSync(cacheDirectory, { recursive: true });
  const cachePath = path.join(cacheDirectory, vibeCacheFileName(vibe, model));
  if (fs.existsSync(cachePath)) {
    const cached = fs.readFileSync(cachePath);
    if (cached.length > 0 && cached.length <= MAX_ENCODED_VIBE_BYTES) return { ...vibe, encoded: cached.toString("base64"), cacheHit: true };
  }
  const response = await fetch(ENCODE_VIBE_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ image: vibe.image, information_extracted: vibe.informationExtracted, model }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 1000);
    const error = new Error(`NAI Vibe 인코딩 오류 ${response.status}: ${body}`);
    error.code = "NAI_VIBE_ENCODING_ERROR";
    error.status = response.status;
    throw error;
  }
  const encoded = Buffer.from(await response.arrayBuffer());
  if (!encoded.length || encoded.length > MAX_ENCODED_VIBE_BYTES) throw Object.assign(new Error("NAI Vibe 인코딩 응답 크기가 올바르지 않습니다."), { code: "INVALID_VIBE_ENCODING" });
  fs.writeFileSync(cachePath, encoded);
  return { ...vibe, encoded: encoded.toString("base64"), cacheHit: false };
}

async function prepareVibes(request, token, productRoot) {
  const vibes = Array.isArray(request?.vibes) ? request.vibes : [];
  if (!vibes.length) return request;
  if (request.preciseReferences?.length) throw Object.assign(new Error("Vibe Transfer와 Precise Reference는 동시에 사용할 수 없습니다."), { code: "INCOMPATIBLE_REFERENCES" });
  const model = request.settings?.model;
  if (!String(model).includes("diffusion-4")) throw Object.assign(new Error("현재 Vibe 인코딩은 NAI V4 이상 모델만 지원합니다."), { code: "UNSUPPORTED_VIBE_MODEL" });
  const prepared = [];
  for (const vibe of vibes) prepared.push(await encodeVibe(vibe, model, token, productRoot));
  return { ...request, vibes: prepared };
}

module.exports = { ENCODE_VIBE_ENDPOINT, encodeVibe, prepareVibes };
