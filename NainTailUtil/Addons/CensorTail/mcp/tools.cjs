"use strict";

const { CENSOR_TARGET_CLASSES } = require("../electron/censor-service.cjs");
const { CensorMcpError, publicError } = require("./errors.cjs");

const emptySchema = { type: "object", additionalProperties: false };
const artifactRefSchema = {
  type: "object",
  properties: {
    schema: { const: "naintail.artifact-ref/v1" },
    addonId: { type: "string", minLength: 1 },
    artifactId: { type: "string", minLength: 1 },
    kind: { const: "image" },
    scope: { const: "session" },
  },
  required: ["schema", "addonId", "artifactId", "kind", "scope"],
  additionalProperties: false,
};
const targetProperties = Object.fromEntries(CENSOR_TARGET_CLASSES.map((label) => [label, { type: "boolean" }]));
const thresholdProperties = Object.fromEntries(CENSOR_TARGET_CLASSES.map((label) => [label, { type: "number", minimum: 0.01, maximum: 0.99 }]));
const optionsSchema = {
  type: "object",
  properties: {
    mode: { type: "string", enum: ["mosaic", "color", "shape", "gradient", "fog"] },
    targetModes: {
      type: "object",
      properties: Object.fromEntries(CENSOR_TARGET_CLASSES.map((label) => [label,
        { type: "string", enum: ["mosaic", "color", "shape", "gradient", "fog"] }])),
      additionalProperties: false,
    },
    color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
    expand: { type: "integer", minimum: 0, maximum: 100 },
    shapeExpand: { type: "integer", minimum: 0, maximum: 100 },
    feather: { type: "integer", minimum: 0, maximum: 50 },
    mosaicSize: { type: "integer", minimum: 4, maximum: 64 },
    opacity: { type: "number", minimum: 0.1, maximum: 1 },
    fadeInner: { type: "number", minimum: 0.1, maximum: 0.8 },
    fogBrightness: { type: "integer", minimum: 0, maximum: 100 },
    fogOpacity: { type: "number", minimum: 0.1, maximum: 1 },
    fogDensity: { type: "integer", minimum: 0, maximum: 100 },
    spread: { type: "integer", minimum: 0, maximum: 100 },
    maskThreshold: { type: "number", minimum: 0.05, maximum: 0.95 },
    maskEdgeSoftness: { type: "number", minimum: 0, maximum: 0.5 },
    overwrite: { type: "boolean" },
  },
  additionalProperties: false,
};

function success(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

function failure(error) {
  const value = publicError(error);
  return { isError: true, content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

function annotations(readOnly, destructive = false, idempotent = readOnly) {
  return { readOnlyHint: readOnly, destructiveHint: destructive, idempotentHint: idempotent, openWorldHint: false };
}

function define(name, title, description, inputSchema, handler, toolAnnotations) {
  return { definition: { name, title, description, inputSchema, annotations: toolAnnotations }, handler };
}

function objectInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CensorMcpError("MCP_INPUT_INVALID", "도구 입력 객체가 필요합니다.");
  }
  return value;
}

function stringInput(value, name) {
  const text = String(value || "").trim();
  if (!text) throw new CensorMcpError("MCP_INPUT_INVALID", `${name} 값이 필요합니다.`);
  return text;
}

function stringArray(value, name, maximum = 200) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximum || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new CensorMcpError("MCP_INPUT_INVALID", `${name} 배열이 올바르지 않습니다.`);
  }
  return value.map((item) => item.trim());
}

function validateSchema(schema, value, field = "arguments") {
  if (!schema || typeof schema !== "object") return;
  if (schema.const !== undefined && value !== schema.const) {
    throw new CensorMcpError("MCP_INPUT_INVALID", `${field} 값이 허용된 상수와 다릅니다.`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    throw new CensorMcpError("MCP_INPUT_INVALID", `${field} 값이 허용 목록에 없습니다.`);
  }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new CensorMcpError("MCP_INPUT_INVALID", `${field} 객체가 필요합니다.`);
    }
    for (const required of schema.required || []) {
      if (!(required in value)) throw new CensorMcpError("MCP_INPUT_INVALID", `${field}.${required} 값이 필요합니다.`);
    }
    const properties = schema.properties || {};
    if (schema.additionalProperties === false) {
      const unknown = Object.keys(value).find((key) => !(key in properties));
      if (unknown) throw new CensorMcpError("MCP_INPUT_INVALID", `${field}.${unknown} 필드는 지원하지 않습니다.`);
    }
    for (const [key, child] of Object.entries(value)) {
      if (properties[key]) validateSchema(properties[key], child, `${field}.${key}`);
    }
    return;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) throw new CensorMcpError("MCP_INPUT_INVALID", `${field} 배열이 필요합니다.`);
    if (schema.minItems !== undefined && value.length < schema.minItems) throw new CensorMcpError("MCP_INPUT_INVALID", `${field} 항목이 너무 적습니다.`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) throw new CensorMcpError("MCP_INPUT_INVALID", `${field} 항목이 너무 많습니다.`);
    value.forEach((item, index) => validateSchema(schema.items, item, `${field}[${index}]`));
    return;
  }
  if (schema.type === "string") {
    if (typeof value !== "string") throw new CensorMcpError("MCP_INPUT_INVALID", `${field} 문자열이 필요합니다.`);
    if (schema.minLength !== undefined && value.length < schema.minLength) throw new CensorMcpError("MCP_INPUT_INVALID", `${field} 문자열이 너무 짧습니다.`);
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) throw new CensorMcpError("MCP_INPUT_INVALID", `${field} 형식이 올바르지 않습니다.`);
    return;
  }
  if (schema.type === "boolean" && typeof value !== "boolean") {
    throw new CensorMcpError("MCP_INPUT_INVALID", `${field} boolean 값이 필요합니다.`);
  }
  if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value) || (schema.type === "integer" && !Number.isInteger(value))) {
      throw new CensorMcpError("MCP_INPUT_INVALID", `${field} ${schema.type} 값이 필요합니다.`);
    }
    if (schema.minimum !== undefined && value < schema.minimum) throw new CensorMcpError("MCP_INPUT_INVALID", `${field} 값이 최소값보다 작습니다.`);
    if (schema.maximum !== undefined && value > schema.maximum) throw new CensorMcpError("MCP_INPUT_INVALID", `${field} 값이 최대값보다 큽니다.`);
  }
}

function createTools(service, manager, resolveInputs, version) {
  const tools = [
    define("censortail_status", "CensorTail 상태", "Python/CUDA runtime, ONNX dependency, 검열 모델과 MCP 작업 큐의 준비 상태를 간략히 확인합니다.", emptySchema, async () => {
      const status = await service.status();
      const ready = status.runtimeReady === true && status.dependencyReady === true && status.model?.downloaded === true;
      const issues = [
        ...(status.runtimeReady ? [] : [{ code: "CENSOR_RUNTIME_NOT_READY", message: "CensorTail Python/CUDA runtime이 준비되지 않았습니다.", retryable: true }]),
        ...(status.dependencyReady ? [] : [{ code: "CENSOR_DEPENDENCY_NOT_READY", message: "ONNX Runtime dependency가 준비되지 않았습니다.", retryable: true }]),
        ...(status.model?.downloaded ? [] : [{ code: "CENSOR_MODEL_NOT_READY", message: "검열 모델이 준비되지 않았습니다. GUI에서 설치를 완료하세요.", retryable: true }]),
      ];
      return {
        addonId: "censortail",
        version,
        ready,
        state: ready ? (manager.activeCount() ? "busy" : "ready") : status.runtimeReady ? "degraded" : "unavailable",
        issues,
        runtimeReady: status.runtimeReady,
        dependencyReady: status.dependencyReady,
        model: {
          id: status.model?.id,
          downloaded: status.model?.downloaded === true,
          loaded: status.model?.loaded === true,
          loading: status.model?.loading === true,
          provider: status.model?.provider || null,
        },
        targets: [...CENSOR_TARGET_CLASSES],
        queue: manager.queueStatus(),
      };
    }, annotations(true)),
    define("censortail_scan", "검열 스캔 등록", "이미지 artifactRef를 등록하고 검열 영역 검출 작업을 순차 큐에 넣어 즉시 jobId를 반환합니다. Standalone MCP에서만 inputPaths도 허용됩니다.", {
      type: "object",
      properties: {
        artifactRefs: { type: "array", minItems: 1, maxItems: 200, items: artifactRefSchema },
        inputPaths: { type: "array", minItems: 1, maxItems: 200, items: { type: "string", minLength: 1 }, description: "Standalone MCP 전용 절대 파일·폴더 경로" },
        targets: { type: "object", properties: targetProperties, additionalProperties: false },
        thresholds: { type: "object", properties: thresholdProperties, additionalProperties: false },
      },
      additionalProperties: false,
    }, async (args = {}) => {
      objectInput(args);
      if (args.artifactRefs !== undefined && (!Array.isArray(args.artifactRefs) || args.artifactRefs.length < 1 || args.artifactRefs.length > 200)) {
        throw new CensorMcpError("MCP_INPUT_INVALID", "artifactRefs는 1~200개 배열이어야 합니다.");
      }
      if (args.inputPaths !== undefined) stringArray(args.inputPaths, "inputPaths");
      const ids = await resolveInputs(args);
      return manager.submitScan({ ids, targets: args.targets, thresholds: args.thresholds });
    }, annotations(false, false, false)),
    define("censortail_save", "검열 결과 저장 등록", "완료된 scan 작업의 검출 결과를 선택한 효과로 저장 큐에 넣습니다. 기본값은 검출 영역이 있는 모든 이미지입니다.", {
      type: "object",
      properties: {
        scanJobId: { type: "string", minLength: 1 },
        imageIds: { type: "array", maxItems: 200, items: { type: "string", minLength: 1 } },
        disabledDetectionIds: { type: "array", maxItems: 1000, items: { type: "string", minLength: 1 } },
        includeNoDetections: { type: "boolean", default: false },
        options: optionsSchema,
      },
      required: ["scanJobId"],
      additionalProperties: false,
    }, (args = {}) => {
      objectInput(args);
      return manager.submitSave({
        scanJobId: stringInput(args.scanJobId, "scanJobId"),
        imageIds: stringArray(args.imageIds, "imageIds"),
        disabledDetectionIds: stringArray(args.disabledDetectionIds, "disabledDetectionIds", 1000),
        includeNoDetections: args.includeNoDetections === true,
        options: args.options && typeof args.options === "object" && !Array.isArray(args.options) ? args.options : {},
      });
    }, annotations(false, true, false)),
    define("censortail_jobs_list", "검열 작업 목록", "현재 MCP 세션 작업의 ID·종류·상태·축약 진행률만 반환합니다. 결과는 status/wait 또는 result_get을 사용하세요.", {
      type: "object", properties: { activeOnly: { type: "boolean", default: false } }, additionalProperties: false,
    }, ({ activeOnly = false } = {}) => manager.list(activeOnly === true), annotations(true)),
    define("censortail_job_status", "검열 작업 상태", "jobId의 현재 상태를 한 번 조회합니다. 완료 대기는 반복 조회 대신 censortail_job_wait을 사용하세요.", {
      type: "object", properties: { jobId: { type: "string", minLength: 1 } }, required: ["jobId"], additionalProperties: false,
    }, ({ jobId } = {}) => manager.get(stringInput(jobId, "jobId")), annotations(true)),
    define("censortail_job_wait", "검열 작업 완료 대기", "작업 종료를 최대 60초 기다립니다. timeout 응답은 결과 본문을 생략하므로 같은 도구를 다시 호출하세요.", {
      type: "object",
      properties: { jobId: { type: "string", minLength: 1 }, timeoutSeconds: { type: "integer", minimum: 1, maximum: 60 } },
      required: ["jobId"], additionalProperties: false,
    }, ({ jobId, timeoutSeconds } = {}) => {
      if (timeoutSeconds !== undefined && (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 60)) {
        throw new CensorMcpError("MCP_INPUT_INVALID", "timeoutSeconds는 1~60 정수여야 합니다.");
      }
      return manager.wait(stringInput(jobId, "jobId"), timeoutSeconds);
    }, annotations(true)),
    define("censortail_job_cancel", "검열 작업 취소", "대기 중인 작업은 취소합니다. 이미 실행 중인 단일 엔진 호출은 끝까지 진행되며 결과에 activeContinues=true를 표시합니다.", {
      type: "object", properties: { jobId: { type: "string", minLength: 1 } }, required: ["jobId"], additionalProperties: false,
    }, ({ jobId } = {}) => manager.cancel(stringInput(jobId, "jobId")), annotations(false, true, false)),
    define("censortail_result_get", "이미지 검출 상세", "완료된 scan job에서 이미지 한 장의 검출 좌표·분류·신뢰도를 읽습니다. 대형 mask payload는 반환하지 않습니다.", {
      type: "object",
      properties: { jobId: { type: "string", minLength: 1 }, imageId: { type: "string", minLength: 1 } },
      required: ["jobId", "imageId"], additionalProperties: false,
    }, ({ jobId, imageId } = {}) => manager.resultGet(stringInput(jobId, "jobId"), stringInput(imageId, "imageId")), annotations(true)),
    define("censortail_model_unload", "검열 모델 언로드", "MCP 연결과 완료 작업 기록은 유지한 채 idle 검열 Worker를 종료해 VRAM을 해제합니다. 대기·실행 작업이 있으면 거부합니다.", emptySchema, () => manager.releaseModel(), annotations(false, false, true)),
  ];
  return new Map(tools.map((tool) => [tool.definition.name, tool]));
}

async function callTool(tool, args) {
  try {
    validateSchema(tool.definition?.inputSchema, args || {});
    return success(await tool.handler(args || {}));
  } catch (error) {
    return failure(error);
  }
}

module.exports = {
  annotations,
  artifactRefSchema,
  callTool,
  createTools,
  define,
  emptySchema,
  failure,
  optionsSchema,
  success,
  validateSchema,
};
