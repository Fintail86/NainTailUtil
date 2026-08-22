"use strict";

const readline = require("node:readline");
const { extractFirstPng } = require("./zip.cjs");
const { createPayload } = require("./payload.cjs");
const { prepareVibes } = require("./vibe.cjs");

const IMAGE_ENDPOINT = "https://image.novelai.net/ai/generate-image";
const SUBSCRIPTION_ENDPOINT = "https://image.novelai.net/user/subscription";

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 1000);
    const error = new Error(`NAI API 오류 ${response.status}: ${body}`);
    error.code = "NAI_API_ERROR";
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function generate(params) {
  const token = String(params?.token || "").trim();
  if (!token) {
    const error = new Error("NovelAI 토큰이 설정되지 않았습니다.");
    error.code = "NAI_TOKEN_MISSING";
    throw error;
  }
  const preparedRequest = await prepareVibes(params.request, token, process.cwd());
  const { payload, resolved } = createPayload(preparedRequest);
  const body = new FormData();
  body.append("request", new Blob([JSON.stringify(payload)], { type: "application/json" }), "request.json");
  const response = await fetch(IMAGE_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body,
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 1000);
    const error = new Error(`NAI 이미지 생성 오류 ${response.status}: ${body}`);
    error.code = "NAI_GENERATION_ERROR";
    error.status = response.status;
    throw error;
  }
  const zip = Buffer.from(await response.arrayBuffer());
  const image = extractFirstPng(zip);
  return {
    imageBase64: image.data.toString("base64"),
    mimeType: "image/png",
    seed: resolved.seed,
    width: resolved.width,
    height: resolved.height,
    model: resolved.model,
    resolvedPrompt: resolved.prompt,
    resolvedNegativePrompt: resolved.negativePrompt,
  };
}

async function handle(message) {
  switch (message.method) {
    case "ping": return { ready: true, worker: "nai", protocol: 1 };
    case "subscription": {
      const token = String(message.params?.token || "").trim();
      if (!token) throw Object.assign(new Error("NovelAI 토큰이 설정되지 않았습니다."), { code: "NAI_TOKEN_MISSING" });
      return fetchJson(SUBSCRIPTION_ENDPOINT, token);
    }
    case "generate": return generate(message.params);
    default: throw Object.assign(new Error(`알 수 없는 worker method입니다: ${message.method}`), { code: "UNKNOWN_METHOD" });
  }
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let chain = Promise.resolve();
input.on("line", (line) => {
  chain = chain.then(async () => {
    let message;
    try {
      message = JSON.parse(line);
      const result = await handle(message);
      write({ id: message.id, type: "result", result });
    } catch (error) {
      write({
        id: message?.id || null,
        type: "error",
        error: { code: error.code || "WORKER_ERROR", message: error.message, status: error.status || null },
      });
    }
  });
});
