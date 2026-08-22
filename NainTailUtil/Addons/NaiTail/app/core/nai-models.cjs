"use strict";

const MODEL_DEFINITIONS = Object.freeze({
  "nai-diffusion-5-curated": Object.freeze({
    label: "NAI Diffusion V5 Curated",
    generation: 5,
    paramsVersion: 4,
    defaults: Object.freeze({ steps: 23, guidance: 7, sampler: "k_euler_ancestral", scheduler: "karras" }),
    capabilities: Object.freeze({ scheduler: false, decrisper: false, vibe: false, preciseReference: false, transparency: true, lightQuality: true }),
  }),
  "nai-diffusion-5-full": Object.freeze({
    label: "NAI Diffusion V5 Full",
    generation: 5,
    paramsVersion: 4,
    defaults: Object.freeze({ steps: 23, guidance: 7, sampler: "k_euler_ancestral", scheduler: "karras" }),
    capabilities: Object.freeze({ scheduler: false, decrisper: false, vibe: false, preciseReference: false, transparency: true, lightQuality: true }),
  }),
  "nai-diffusion-4-5-full": Object.freeze({
    label: "NAI Diffusion V4.5 Full",
    generation: 4.5,
    paramsVersion: 3,
    defaults: Object.freeze({ steps: 28, guidance: 5, sampler: "k_euler_ancestral", scheduler: "karras" }),
    capabilities: Object.freeze({ scheduler: true, decrisper: true, vibe: true, preciseReference: true, transparency: false, lightQuality: false }),
  }),
  "nai-diffusion-4-5-curated": Object.freeze({
    label: "NAI Diffusion V4.5 Curated",
    generation: 4.5,
    paramsVersion: 3,
    defaults: Object.freeze({ steps: 28, guidance: 5, sampler: "k_euler_ancestral", scheduler: "karras" }),
    capabilities: Object.freeze({ scheduler: true, decrisper: true, vibe: true, preciseReference: true, transparency: false, lightQuality: false }),
  }),
});

const DEFAULT_MODEL = "nai-diffusion-4-5-full";

function modelDefinition(model) {
  return MODEL_DEFINITIONS[String(model || "")] || null;
}

function requireModelDefinition(model) {
  const definition = modelDefinition(model);
  if (!definition) {
    const error = new Error(`지원하지 않는 NovelAI 모델입니다: ${model || "(비어 있음)"}`);
    error.code = "UNSUPPORTED_NAI_MODEL";
    throw error;
  }
  return definition;
}

module.exports = { DEFAULT_MODEL, MODEL_DEFINITIONS, modelDefinition, requireModelDefinition };
