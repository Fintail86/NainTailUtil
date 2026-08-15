"use strict";

const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

function parseGpuMemory(output) {
  const line = String(output || "").split(/\r?\n/u).find((value) => value.trim());
  if (!line) return null;
  const parts = line.split(",").map((value) => value.trim());
  if (parts.length < 5) return null;
  const index = Number(parts.shift());
  const usedMiB = Number(parts.pop());
  const freeMiB = Number(parts.pop());
  const totalMiB = Number(parts.pop());
  const name = parts.join(", ");
  if (![index, usedMiB, freeMiB, totalMiB].every(Number.isFinite) || totalMiB <= 0) return null;
  return { available: true, index, name, totalMiB, freeMiB, usedMiB };
}

async function queryGpuMemory(run = execFileAsync) {
  try {
    const { stdout } = await run("nvidia-smi.exe", [
      "--query-gpu=index,name,memory.total,memory.free,memory.used",
      "--format=csv,noheader,nounits",
      "--id=0",
    ], {
      windowsHide: true,
      timeout: 3000,
      encoding: "utf8",
    });
    return parseGpuMemory(stdout) || { available: false, reason: "invalid-output" };
  } catch (error) {
    return { available: false, reason: error.code || "query-failed" };
  }
}

module.exports = { parseGpuMemory, queryGpuMemory };
