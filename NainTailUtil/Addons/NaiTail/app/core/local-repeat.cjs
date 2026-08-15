"use strict";

const { NainTailError } = require("./errors.cjs");

const MAX_LOCAL_BATCH = 8;
const MAX_LOCAL_QUEUE = 20;
const MAX_LOCAL_TASKS = 100;

function boundedCount(value, fallback, maximum, field) {
  const count = Number(value ?? fallback);
  if (!Number.isInteger(count) || count < 1 || count > maximum) throw new NainTailError("INVALID_LOCAL_COUNT", `${field} 값은 1–${maximum} 범위의 정수여야 합니다.`);
  return count;
}

function normalizeLocalRepeat(input = {}, variationCount = 1) {
  const batchCount = boundedCount(input.batchCount, 1, MAX_LOCAL_BATCH, "로컬 배치");
  const queueCount = boundedCount(input.queueCount, 1, MAX_LOCAL_QUEUE, "큐 반복");
  const totalTasks = Math.max(0, Number(variationCount) || 0) * batchCount * queueCount;
  if (totalTasks > MAX_LOCAL_TASKS) throw new NainTailError("LOCAL_TASK_LIMIT", `한 번에 등록할 수 있는 로컬 생성 작업은 최대 ${MAX_LOCAL_TASKS}장입니다.`);
  return { batchCount, queueCount, totalTasks };
}

module.exports = { MAX_LOCAL_BATCH, MAX_LOCAL_QUEUE, MAX_LOCAL_TASKS, normalizeLocalRepeat };
