import * as z from "zod/v4";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PRESET_CATEGORIES } = require("../electron/preset-service.cjs");
const presetCategory = z.enum(Object.keys(PRESET_CATEGORIES));

const prompt = z.string().max(4000);
const presetReference = z.union([
  z.string().min(1).describe("기존 호환용 preset ID"),
  z.object({ id: z.string().min(1) }).strict(),
  z.object({ name: z.string().min(1).max(80) }).strict(),
]).describe("preset ID 또는 정확한 표시 이름. 이름이 중복되면 오류입니다.");
const lora = z.object({
  id: z.string().min(1).describe("anima_models_list에서 얻은 LoRA catalog ID"),
  strength: z.number().min(0).max(2),
}).strict();
const subPrompt = z.object({
  id: z.string().optional(),
  prompt: prompt.optional(),
  negativePrompt: prompt.optional(),
  enabled: z.boolean().optional(),
  loras: z.array(lora).max(16).optional(),
}).strict();
const subPromptOverride = z.object({
  slot: z.number().int().min(1).max(20),
  id: z.string().optional(),
  prompt: prompt.optional(),
  negativePrompt: prompt.optional(),
  enabled: z.boolean().optional(),
  loras: z.array(lora).max(16).optional(),
}).strict();

const commonShape = {
  requestId: z.string().min(1).optional().describe("생략하면 서버가 UUID를 생성합니다."),
  presets: z.object({
    environment: presetReference.optional(),
    base: presetReference.optional(),
    prompt: presetReference.optional(),
    negativePrompt: presetReference.optional(),
    subPrompts: presetReference.optional(),
  }).strict().optional(),
  promptOverrides: z.object({
    basePrompt: prompt.optional(),
    prompt: prompt.optional(),
    negativePrompt: prompt.optional(),
  }).strict().optional(),
  basePrompt: prompt.optional(),
  prompt: prompt.optional(),
  negativePrompt: prompt.optional(),
  modelId: z.string().min(1).optional().describe("anima_models_list에서 얻은 diffusion model catalog ID. 환경 프리셋 사용 시 생략할 수 있습니다."),
  loras: z.array(lora).max(16).optional(),
  loraLoadMode: z.enum(["fused", "hotload"]).optional(),
  outputPrefix: z.string().min(1).max(64).optional(),
  outputSubPrefix: z.string().max(64).optional(),
  width: z.number().int().min(512).max(1536).optional(),
  height: z.number().int().min(512).max(1536).optional(),
  steps: z.number().int().min(1).max(100).optional(),
  cfg: z.number().min(1).max(20).optional(),
  sampler: z.enum(["er_sde", "res_multistep", "euler_a", "euler", "uni_pc"]).optional(),
  scheduler: z.enum(["simple", "beta", "ddim_uniform"]).optional(),
  batchSize: z.number().int().min(1).max(8).optional(),
  queueCount: z.number().int().min(1).max(20).optional(),
  randomSeed: z.boolean().optional(),
  seed: z.number().int().min(0).max(2147483647).optional(),
};

function hasModelSource(value) {
  return Boolean(value.modelId || value.presets?.environment);
}

export const singleGenerationInput = z.object(commonShape).strict().refine(hasModelSource, {
  message: "modelId 또는 presets.environment가 필요합니다.",
});

export const multiGenerationInput = z.object({
  ...commonShape,
  subPrompts: z.array(subPrompt).max(20).optional(),
  subPromptOverrides: z.array(subPromptOverride).max(20).optional(),
  selectedSlots: z.array(z.number().int().min(1).max(20)).min(1).max(20)
    .refine((slots) => new Set(slots).size === slots.length, "selectedSlots에 중복 슬롯을 지정할 수 없습니다.")
    .describe("출력할 one-based 서브 프롬프트 슬롯만 지정합니다. 원래 슬롯 번호가 출력명에 유지됩니다.")
    .optional(),
}).strict().refine(hasModelSource, {
  message: "modelId 또는 presets.environment가 필요합니다.",
});

export const jobStatusInput = z.object({
  jobId: z.string().min(1),
}).strict();

export const jobWaitInput = z.object({
  jobId: z.string().min(1),
  timeoutSeconds: z.number().int().min(1).max(60).optional()
    .describe("작업 종료를 기다릴 최대 시간입니다. 생략하면 예상 이미지 수 × 5초를 기준으로 30~60초를 자동 선택합니다."),
}).strict();

export const emptyInput = z.object({}).strict();

export const presetListInput = z.object({
  category: presetCategory.optional(),
}).strict();

export const presetGetInput = z.object({
  category: presetCategory,
  id: z.string().min(1).optional(),
  name: z.string().min(1).max(80).optional(),
}).strict().refine((value) => Boolean(value.id) !== Boolean(value.name), {
  message: "id 또는 name 중 하나만 지정해 주세요.",
});
