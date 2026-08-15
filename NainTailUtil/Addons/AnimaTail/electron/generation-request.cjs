"use strict";

const generationProfile = require("./generation-profile.cjs");
const { listModels, resolveCatalogEntry } = require("./model-catalog.cjs");
const { normalizeOutputNaming } = require("./output-naming.cjs");
const { readRuntimeStatus } = require("./runtime-status.cjs");
const { selectedSubPromptEntries } = require("./sub-prompt-selection.cjs");

function integerInRange(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} 값이 허용 범위를 벗어났습니다.`);
  }
  return value;
}

function numberInRange(value, minimum, maximum, label) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} 값이 허용 범위를 벗어났습니다.`);
  }
  return value;
}

function promptText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function combinePrompt(base, addition) {
  return [base, addition].filter(Boolean).join(", ");
}

const SUPPORTED_SAMPLERS = new Set(generationProfile.sampling.samplers);
const SUPPORTED_SCHEDULERS = new Set(generationProfile.sampling.schedulers);

function samplingChoice(value, supported, fallback, label) {
  const normalized = typeof value === "string" && value.length > 0 ? value : fallback;
  if (!supported.has(normalized)) throw new Error(`지원하지 않는 ${label}입니다: ${normalized}`);
  return normalized;
}

function publicLora(lora) {
  const { path: _path, ...value } = lora;
  return value;
}

function normalizeLoras(catalog, selections, label, forbiddenIds = new Set(), allowTurbo = true) {
  const requested = Array.isArray(selections) ? selections : [];
  const seen = new Set();
  return requested.map((selection) => {
    if (seen.has(selection.id) || forbiddenIds.has(selection.id)) {
      throw new Error(`${label}에 같은 LoRA를 중복 적용할 수 없습니다.`);
    }
    seen.add(selection.id);
    const lora = resolveCatalogEntry(catalog, selection.id, "loras");
    const turbo = lora.relativePath.startsWith(generationProfile.turboLoraPrefix);
    if (turbo && !allowTurbo) throw new Error("Turbo LoRA는 공통 생성 설정에서만 사용할 수 있습니다.");
    const strength = Number(selection.strength);
    const strengthLimits = generationProfile.limits.loraStrength;
    if (!Number.isFinite(strength) || strength < strengthLimits.min || strength > strengthLimits.max) {
      throw new Error(`LoRA 강도는 ${strengthLimits.min}~${strengthLimits.max} 사이여야 합니다.`);
    }
    return {
      id: lora.id,
      name: lora.name,
      fileName: lora.fileName,
      relativePath: lora.relativePath,
      turbo,
      path: lora.absolutePath,
      strength,
    };
  });
}

function normalizeGenerationRequest(request, dependencies = {}) {
  if (!request || typeof request !== "object") throw new Error("생성 요청 형식이 잘못됐습니다.");
  const appRoot = dependencies.appRoot;
  if (typeof appRoot !== "string" || appRoot.length === 0) {
    throw new Error("생성 요청의 앱 루트가 지정되지 않았습니다.");
  }
  const catalogReader = dependencies.catalogReader || listModels;
  const runtimeStatusReader = dependencies.runtimeStatusReader || readRuntimeStatus;
  const basePrompt = promptText(request.basePrompt);
  const mainPrompt = promptText(request.prompt);
  const prompt = combinePrompt(basePrompt, mainPrompt);
  const promptLimit = generationProfile.limits.promptCharacters.max;
  if (basePrompt.length > promptLimit) throw new Error(`Base 프롬프트는 최대 ${promptLimit}자까지 입력할 수 있습니다.`);
  if (mainPrompt.length > promptLimit) throw new Error(`프롬프트는 최대 ${promptLimit}자까지 입력할 수 있습니다.`);
  if (prompt.length === 0 || prompt.length > promptLimit) {
    throw new Error(`Base 프롬프트와 프롬프트를 합쳐 1~${promptLimit}자로 입력해 주세요.`);
  }
  const negativePrompt = promptText(request.negativePrompt);
  if (negativePrompt.length > promptLimit) throw new Error(`부정 프롬프트는 최대 ${promptLimit}자까지 입력할 수 있습니다.`);

  const generationMode = request.generationMode === "sub-prompt"
    ? "sub-prompt"
    : request.generationMode === "refine" ? "refine" : "standard";
  const { outputPrefix, outputSubPrefix } = normalizeOutputNaming(request, generationMode);
  const requestedSubPrompts = generationMode === "sub-prompt" && Array.isArray(request.subPrompts)
    ? request.subPrompts
    : [];
  const subPromptLimit = generationProfile.limits.subPrompts.max;
  if (requestedSubPrompts.length > subPromptLimit) throw new Error(`서브 프롬프트는 최대 ${subPromptLimit}개까지 추가할 수 있습니다.`);
  const catalog = catalogReader(appRoot);
  const model = resolveCatalogEntry(catalog, request.modelId, "models");
  const requestedLoras = Array.isArray(request.loras) ? request.loras : [];
  const loraLimit = generationProfile.limits.lorasPerJob.max;
  if (requestedLoras.length > loraLimit) throw new Error(`한 작업에는 LoRA를 최대 ${loraLimit}개까지 적용할 수 있습니다.`);
  const loras = normalizeLoras(catalog, requestedLoras, "공통 설정");
  const globalLoraIds = new Set(loras.map((lora) => lora.id));
  const selectedSubPrompts = selectedSubPromptEntries(requestedSubPrompts);
  if (requestedSubPrompts.length > 0 && selectedSubPrompts.length === 0) {
    throw new Error("출력할 서브 프롬프트를 하나 이상 선택해 주세요.");
  }
  const normalizedSubPrompts = selectedSubPrompts.map(({ item, slotNumber }) => {
    const subPrompt = promptText(item?.prompt);
    const subNegativePrompt = promptText(item?.negativePrompt);
    const combinedPrompt = combinePrompt(prompt, subPrompt);
    const combinedNegativePrompt = combinePrompt(negativePrompt, subNegativePrompt);
    if (combinedPrompt.length > promptLimit || combinedNegativePrompt.length > promptLimit) {
      throw new Error(`서브 프롬프트 ${slotNumber}을 결합한 내용은 ${promptLimit}자를 넘을 수 없습니다.`);
    }
    const localLoras = normalizeLoras(
      catalog,
      item?.loras,
      `서브 프롬프트 ${slotNumber}`,
      globalLoraIds,
      false,
    );
    if (loras.length + localLoras.length > loraLimit) {
      throw new Error(`서브 프롬프트 ${slotNumber}은 공통 LoRA와 합쳐 최대 ${loraLimit}개까지 적용할 수 있습니다.`);
    }
    return {
      id: typeof item?.id === "string" && item.id.length <= 80 ? item.id : `sub-${slotNumber}`,
      ordinal: slotNumber,
      count: requestedSubPrompts.length,
      prompt: subPrompt,
      negativePrompt: subNegativePrompt,
      combinedPrompt,
      combinedNegativePrompt,
      localLoras,
    };
  });

  const { dimension, batch, queue, seed: seedLimits, steps: stepLimits } = generationProfile.limits;
  const width = integerInRange(Number(request.width), dimension.min, dimension.max, "가로");
  const height = integerInRange(Number(request.height), dimension.min, dimension.max, "세로");
  if (width % dimension.step !== 0 || height % dimension.step !== 0) {
    throw new Error(`이미지 크기는 ${dimension.step}의 배수여야 합니다.`);
  }
  const batchSize = integerInRange(Number(request.batchSize), batch.min, batch.max, "배치");
  const queueCount = integerInRange(Number(request.queueCount), queue.min, queue.max, "큐");
  const randomSeed = Boolean(request.randomSeed);
  const seed = randomSeed ? seedLimits.min : integerInRange(
    Number(request.seed),
    seedLimits.min,
    seedLimits.max,
    "Seed",
  );
  const sampler = samplingChoice(
    request.sampler,
    SUPPORTED_SAMPLERS,
    generationProfile.sampling.defaultSampler,
    "샘플러",
  );
  const scheduler = samplingChoice(
    request.scheduler,
    SUPPORTED_SCHEDULERS,
    generationProfile.sampling.defaultScheduler,
    "스케줄러",
  );
  const steps = integerInRange(Number(request.steps), stepLimits.min, stepLimits.max, "Steps");
  const samplerMinimumSteps = generationProfile.sampling.minimumSteps[sampler];
  if (samplerMinimumSteps && steps < samplerMinimumSteps) {
    throw new Error(`${sampler} 샘플러는 최소 ${samplerMinimumSteps} Steps가 필요합니다.`);
  }

  let refine = null;
  if (generationMode === "refine") {
    const source = dependencies.refineInputService?.resolve(String(request.inputImageId || ""));
    if (!source) throw new Error("리파인할 입력 이미지를 다시 선택해 주세요.");
    const refineMode = ["variation", "detail", "hires"].includes(request.refineMode)
      ? request.refineMode
      : "detail";
    const sourceWidth = integerInRange(Number(request.sourceWidth), 1, 65535, "원본 가로");
    const sourceHeight = integerInRange(Number(request.sourceHeight), 1, 65535, "원본 세로");
    const denoisingStrength = numberInRange(
      Number(request.denoisingStrength),
      0.05,
      1,
      "변화 강도",
    );
    const sourceRatio = sourceWidth / sourceHeight;
    const outputRatio = width / height;
    if (Math.abs(Math.log(sourceRatio / outputRatio)) > 0.025) {
      throw new Error("리파인 출력 크기는 원본 이미지 비율을 유지해야 합니다.");
    }
    refine = {
      inputImagePath: source.absolutePath,
      sourceImage: {
        fileName: source.fileName,
        bytes: source.bytes,
        modifiedAt: source.modifiedAt,
        width: sourceWidth,
        height: sourceHeight,
      },
      refineMode,
      denoisingStrength,
      upscaleScale: numberInRange(Number(request.upscaleScale || 1), 1, 4, "확대 배율"),
    };
  }

  return {
    schemaVersion: 1,
    prompt,
    negativePrompt,
    generationMode,
    outputPrefix,
    outputSubPrefix,
    loraLoadMode: generationMode === "sub-prompt" && request.loraLoadMode === "hotload"
      ? "hotload"
      : "fused",
    basePrompt,
    mainPrompt,
    baseNegativePrompt: negativePrompt,
    baseLoras: loras,
    ...(refine || {}),
    ...(generationMode === "sub-prompt" ? {
      variants: normalizedSubPrompts.length > 0
        ? normalizedSubPrompts.map((subPrompt) => ({
          outputSlotNumber: subPrompt.ordinal,
          prompt: subPrompt.combinedPrompt,
          negativePrompt: subPrompt.combinedNegativePrompt,
          loras: [...loras, ...subPrompt.localLoras],
          subPrompt: {
            id: subPrompt.id,
            ordinal: subPrompt.ordinal,
            count: subPrompt.count,
            prompt: subPrompt.prompt,
            negativePrompt: subPrompt.negativePrompt,
            loras: subPrompt.localLoras.map(publicLora),
          },
        }))
        : [{ prompt, negativePrompt, subPrompt: null }],
    } : {}),
    modelPath: model.absolutePath,
    model: {
      id: model.id,
      name: model.name,
      fileName: model.fileName,
      relativePath: model.relativePath,
    },
    loras,
    width,
    height,
    steps,
    cfg: numberInRange(
      Number(request.cfg ?? generationProfile.limits.cfg.min),
      generationProfile.limits.cfg.min,
      generationProfile.limits.cfg.max,
      "CFG",
    ),
    sampler,
    scheduler,
    batchSize,
    queueCount,
    randomSeed,
    seed,
    runtime: {
      appVersion: dependencies.appVersion || "0.0.0",
      electronVersion: dependencies.electronVersion || process.versions.electron || null,
      runtimeId: runtimeStatusReader(appRoot).runtimeId,
    },
  };
}

module.exports = {
  combinePrompt,
  integerInRange,
  normalizeGenerationRequest,
  normalizeLoras,
  numberInRange,
  promptText,
};
