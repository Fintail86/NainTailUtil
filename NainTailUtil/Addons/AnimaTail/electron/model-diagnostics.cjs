"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { locateRuntime } = require("./runtime-locator.cjs");
const { workerEnvironment } = require("./inference-service.cjs");

const DIAGNOSTICS_RELATIVE_PATH = path.join("Models", "diagnostics", "compatibility.json");

function diagnosticsPath(appRoot) {
  return path.join(path.resolve(appRoot), DIAGNOSTICS_RELATIVE_PATH);
}

function validDiagnostics(value) {
  return value
    && typeof value === "object"
    && value.schemaVersion === 1
    && typeof value.generatedAt === "string"
    && Array.isArray(value.models)
    && Array.isArray(value.loras);
}

function readModelDiagnostics(appRoot) {
  const destination = diagnosticsPath(appRoot);
  for (const candidate of [destination, `${destination}.bak`]) {
    try {
      const value = JSON.parse(fs.readFileSync(candidate, "utf8"));
      if (validDiagnostics(value)) return value;
    } catch {
      // Try the backup left by an interrupted replacement.
    }
  }
  return null;
}

async function writeModelDiagnostics(appRoot, diagnostics) {
  if (!validDiagnostics(diagnostics)) throw new Error("저장할 모델 진단 결과 형식이 잘못됐습니다.");
  const destination = diagnosticsPath(appRoot);
  const temporary = `${destination}.${process.pid}.tmp`;
  const backup = `${destination}.bak`;
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  let movedExisting = false;
  try {
    await fs.promises.writeFile(temporary, `${JSON.stringify(diagnostics, null, 2)}\n`, "utf8");
    await fs.promises.rm(backup, { force: true });
    if (fs.existsSync(destination)) {
      await fs.promises.rename(destination, backup);
      movedExisting = true;
    }
    try {
      await fs.promises.rename(temporary, destination);
    } catch (error) {
      if (movedExisting && !fs.existsSync(destination)) {
        await fs.promises.rename(backup, destination);
      }
      throw error;
    }
    await fs.promises.rm(backup, { force: true });
  } finally {
    await fs.promises.rm(temporary, { force: true });
  }
  return diagnostics;
}

function diagnoseModels(appRoot, options = {}) {
  const runtimeLocator = options.runtimeLocator || locateRuntime;
  const executor = options.executor || execFile;
  const runtime = runtimeLocator(appRoot, {
    runtimeRoot: options.runtimeRoot,
    runtimeManifestPath: options.runtimeManifestPath,
  });
  if (runtime.state !== "ready" || !runtime.pythonPath) {
    return Promise.reject(new Error("모델 진단에 사용할 사설 Python 런타임이 없습니다."));
  }
  return new Promise((resolve, reject) => {
    executor(
      runtime.pythonPath,
      [path.join(appRoot, "app", "model_diagnostics.py"), "--app-root", appRoot],
      {
        cwd: appRoot,
        windowsHide: true,
        env: workerEnvironment(runtime.pythonPath),
        timeout: 120000,
        maxBuffer: 4 * 1024 * 1024,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        try {
          const lines = stdout.trim().split(/\r?\n/);
          const result = JSON.parse(lines.at(-1));
          writeModelDiagnostics(appRoot, result).then(resolve, reject);
        } catch (parseError) {
          reject(new Error(`모델 진단 결과를 읽을 수 없습니다: ${parseError.message}`));
        }
      },
    );
  });
}

module.exports = {
  DIAGNOSTICS_RELATIVE_PATH,
  diagnoseModels,
  diagnosticsPath,
  readModelDiagnostics,
  writeModelDiagnostics,
};
