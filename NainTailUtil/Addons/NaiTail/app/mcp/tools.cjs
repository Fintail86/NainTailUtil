"use strict";

const { asPublicError, NainTailError } = require("../core/errors.cjs");

const emptySchema = { type: "object", additionalProperties: false };
const idSchema = (name) => ({ type: "object", properties: { [name]: { type: "string", minLength: 1 } }, required: [name], additionalProperties: false });
const paidProperties = {
  allowPaidAnlas: { type: "boolean", description: "유료 예상 작업을 승인합니다. 첫 호출에서는 생략하세요." },
  maxAnlas: { type: "integer", minimum: 1, maximum: 100000, description: "승인할 최대 예상 Anlas. allowPaidAnlas=true일 때 필요합니다." },
};
const jobProperties = { jobId: { type: "string", minLength: 1 } };

function success(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

function failure(error) {
  const value = asPublicError(error);
  return { isError: true, content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

function annotations(readOnly, destructive = false, idempotent = readOnly) {
  return { readOnlyHint: readOnly, destructiveHint: destructive, idempotentHint: idempotent, openWorldHint: false };
}

function define(name, title, description, inputSchema, handler, toolAnnotations) {
  return { definition: { name, title, description, inputSchema, annotations: toolAnnotations }, handler };
}

function requireObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new NainTailError("MCP_INPUT_INVALID", `${field} 객체가 필요합니다.`);
  return value;
}

function createTools(app, manager) {
  const tools = [
    define("naintail_status", "NainTailUtil 상태", "토큰·NAI worker·Core 큐와 MCP 작업 수를 간략히 확인합니다.", emptySchema, async () => {
      const live = await app.liveStatus();
      const workerReady = live.worker?.ready === true;
      const ready = workerReady && live.tokenConfigured === true;
      return {
        name: live.name,
        addonId: "naitail",
        version: live.version,
        ready,
        state: ready ? "ready" : workerReady ? "degraded" : "unavailable",
        issues: [
          ...(workerReady ? [] : [{ code: "NAI_WORKER_NOT_READY", message: "NAI Worker가 준비되지 않았습니다.", retryable: true }]),
          ...(live.tokenConfigured ? [] : [{ code: "NAI_TOKEN_MISSING", message: "NovelAI 토큰이 설정되지 않았습니다.", retryable: true }]),
        ],
        tokenConfigured: live.tokenConfigured,
        worker: live.worker,
        counts: { projects: live.projects, subSlotPresets: live.subSlotPresets, examplePresets: live.examplePresets },
        coreQueue: { state: live.queue.state, activeJobId: live.queue.activeJobId, pending: live.queue.jobs.filter((job) => job.state === "pending").length },
        mcpJobs: { active: manager.activeCount(), history: manager.records.size, capacity: manager.maxActive },
      };
    }, annotations(true)),
    define("naintail_projects_list", "작품 목록", "작품 선택에 필요한 ID·이름·카드/슬롯 수만 반환합니다. 상세 내용은 naintail_project_get을 사용하세요.", emptySchema, () => app.listProjects().map((item) => ({ id: item.id, name: item.name, characterCount: item.characterCount, generalSlotCount: item.generalSlotCount })), annotations(true)),
    define("naintail_project_get", "작품 상세", "작품 ID로 Prompt·UC·설정·캐릭터 카드·슬롯을 포함한 전체 작품 데이터를 읽습니다.", idSchema("projectId"), ({ projectId }) => app.getProject(projectId), annotations(true)),
    define("naintail_presets_list", "프리셋 목록", "프리셋 선택에 필요한 ID·이름·타입·항목 수만 반환합니다. 본문은 naintail_preset_get을 사용하세요.", {
      type: "object", properties: { type: { type: "string", enum: ["sub-slot", "example"] } }, additionalProperties: false,
    }, ({ type } = {}) => app.listPresets().filter((item) => !type || item.type === type).map((item) => ({ id: item.id, name: item.name, type: item.type, itemCount: item.itemCount })), annotations(true)),
    define("naintail_preset_get", "프리셋 상세", "프리셋 ID로 Prompt·UC 또는 서브슬롯 전체 내용을 읽습니다.", idSchema("presetId"), ({ presetId }) => app.getPreset(presetId), annotations(true)),
    define("naintail_artist_study_get", "작례 연구 설정", "저장된 작례 Prompt·UC·캐릭터·작가 슬라이더와 생성 설정 전체를 읽습니다.", emptySchema, () => app.getArtistStudy(), annotations(true)),
    define("naintail_generate_single", "싱글 생성 등록", "싱글 요청을 검증·비용 확인 후 로컬 순차 큐에 등록하고 즉시 jobId를 반환합니다.", {
      type: "object", properties: { request: { type: "object", description: "naintail single 입력 객체" }, ...paidProperties }, required: ["request"], additionalProperties: false,
    }, async ({ request, ...options }) => manager.submit("single", requireObject(request, "request"), options), annotations(false, false, false)),
    define("naintail_generate_multi", "멀티 생성 등록", "공통값과 활성 슬롯을 검증·비용 확인 후 큐에 등록하고 즉시 jobId를 반환합니다.", {
      type: "object", properties: { request: { type: "object", description: "naintail multi 입력 객체" }, ...paidProperties }, required: ["request"], additionalProperties: false,
    }, async ({ request, ...options }) => manager.submit("multi", requireObject(request, "request"), options), annotations(false, false, false)),
    define("naintail_generate_artist_study", "작례 연구 생성 등록", "저장된 연구 설정 또는 전달한 설정으로 한 장을 비용 확인 후 등록합니다.", {
      type: "object", properties: { request: { type: "object", description: "생략하면 저장된 연구 설정 사용" }, ...paidProperties }, additionalProperties: false,
    }, async ({ request, ...options } = {}) => manager.submit("artist-study", request ? requireObject(request, "request") : app.getArtistStudy(), options), annotations(false, false, false)),
    define("naintail_generate_project", "작품 슬롯 생성 등록", "작품의 일반·캐릭터·전체 활성 슬롯을 비용 확인 후 한 장 단위 큐에 등록합니다.", {
      type: "object",
      properties: {
        projectId: { type: "string", minLength: 1 },
        scope: { type: "string", enum: ["all", "general", "character"], default: "all" },
        characterId: { type: "string", minLength: 1 },
        ...paidProperties,
      },
      required: ["projectId"], additionalProperties: false,
    }, async ({ projectId, scope = "all", characterId, ...options }) => manager.submit("project", null, { ...options, projectId, scope, characterId }), annotations(false, false, false)),
    define("naintail_jobs_list", "MCP 작업 목록", "현재 MCP 세션 작업의 ID·모드·상태·간략 진행률만 반환합니다. 결과 상세는 status/wait을 사용하세요.", {
      type: "object", properties: { activeOnly: { type: "boolean", default: false } }, additionalProperties: false,
    }, ({ activeOnly = false } = {}) => manager.list().filter((job) => !activeOnly || !["completed", "partial", "failed", "cancelled"].includes(job.status)), annotations(true)),
    define("naintail_job_status", "MCP 작업 상태", "jobId의 현재 상태를 한 번 조회합니다. 완료 대기는 반복 조회 대신 naintail_job_wait을 사용하세요.", idSchema("jobId"), ({ jobId }) => manager.get(jobId), annotations(true)),
    define("naintail_job_wait", "MCP 작업 완료 대기", "작업 종료를 30~60초 기다립니다. timeout이면 결과 본문 없이 축약 상태만 반환하므로 같은 도구를 다시 호출하세요.", {
      type: "object", properties: { ...jobProperties, timeoutSeconds: { type: "integer", minimum: 1, maximum: 60 } }, required: ["jobId"], additionalProperties: false,
    }, ({ jobId, timeoutSeconds }) => manager.wait(jobId, timeoutSeconds), annotations(true)),
    define("naintail_job_cancel", "MCP 작업 취소", "해당 Run의 미전송 이미지를 취소합니다. 이미 NAI에 전송된 한 장은 완료·저장됩니다.", idSchema("jobId"), ({ jobId }) => manager.cancel(jobId), annotations(false, true, false)),
    define("naintail_queue_clear", "대기열 비우기", "모든 Run에서 아직 NAI에 전송하지 않은 Core 작업을 취소합니다. 전송된 한 장은 완료됩니다.", emptySchema, () => {
      const result = app.clearQueue();
      return { cancelled: result.cancelled, activeContinues: result.activeContinues, state: result.queue.state, pending: result.queue.jobs.filter((job) => job.state === "pending").length };
    }, annotations(false, true, false)),
    define("naintail_queue_resume", "대기열 재개", "실패로 일시정지된 Core 큐를 재개합니다.", emptySchema, () => {
      const queue = app.resumeQueue();
      return { state: queue.state, activeJobId: queue.activeJobId, pending: queue.jobs.filter((job) => job.state === "pending").length };
    }, annotations(false, false, true)),
  ];
  return new Map(tools.map((tool) => [tool.definition.name, tool]));
}

async function callTool(tool, args) {
  try {
    return success(await tool.handler(args || {}));
  } catch (error) {
    return failure(error);
  }
}

module.exports = { annotations, callTool, createTools, define, emptySchema, failure, success };
