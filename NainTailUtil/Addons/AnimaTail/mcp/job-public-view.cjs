"use strict";

const path = require("node:path");

function safeOutputPath(appRoot, relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0) return null;
  const outputRoot = path.resolve(appRoot, "outputs");
  const candidate = path.resolve(outputRoot, relativePath);
  const prefix = `${outputRoot}${path.sep}`.toLowerCase();
  return candidate.toLowerCase().startsWith(prefix) ? candidate : null;
}

function publicResult(appRoot, result) {
  if (!result || typeof result !== "object") return null;
  return {
    status: result.status,
    groupId: result.groupId || null,
    counts: result.counts || null,
    outputs: Array.isArray(result.results) ? result.results.map((item) => ({
      absolutePath: safeOutputPath(appRoot, item.relativePath),
      seed: item.seed,
      width: item.width,
      height: item.height,
      seconds: item.seconds,
      ordinal: item.ordinal,
      slot: item.subPrompt?.ordinal ?? null,
      subPromptId: item.subPrompt?.id || null,
    })) : [],
  };
}

function publicJobSummary(job) {
  return {
    jobId: job.id,
    mode: job.mode,
    status: job.status,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    progress: job.progress,
  };
}

function publicJob(job) {
  return {
    ...publicJobSummary(job),
    result: job.result,
    error: job.error,
  };
}

module.exports = {
  publicJob,
  publicJobSummary,
  publicResult,
  safeOutputPath,
};
