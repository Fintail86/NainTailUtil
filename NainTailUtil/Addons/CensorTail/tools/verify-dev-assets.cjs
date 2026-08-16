"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { resolveAssetPaths } = require("../electron/shared-assets.cjs");
const { locateRuntime } = require("../electron/runtime-locator.cjs");

test("development asset config keeps source local and resolves shared heavy assets", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "censortail-dev-assets-"));
  const shared = fs.mkdtempSync(path.join(os.tmpdir(), "censortail-shared-assets-"));
  try {
    fs.mkdirSync(path.join(root, "config"), { recursive: true });
    fs.writeFileSync(path.join(root, "config", "dev-assets.local.json"), JSON.stringify({
      schemaVersion: 1,
      sharedRoot: shared,
    }));
    const assets = resolveAssetPaths(root, {});
    assert.equal(assets.source, "shared");
    assert.equal(assets.runtimeRoot, path.join(shared, "runtime"));
    assert.equal(assets.modelRoot, path.join(shared, "Models", "censor"));
    assert.equal(assets.electronPath, path.join(shared, "runtime", "electron", "electron.exe"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(shared, { recursive: true, force: true });
  }
});
test("runtime manifest comes from the worktree while runtime bytes come from the shared root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "censortail-runtime-source-"));
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "censortail-runtime-bytes-"));
  const runtimeId = "shared-test-r1";
  const digest = "a".repeat(64);
  try {
    fs.writeFileSync(path.join(root, "runtime-manifest.json"), JSON.stringify({
      runtimeId,
      entrypoint: "python.exe",
      integrity: digest,
    }));
    const versionRoot = path.join(runtimeRoot, "versions", runtimeId);
    fs.mkdirSync(versionRoot, { recursive: true });
    fs.writeFileSync(path.join(versionRoot, "python.exe"), "stub");
    fs.writeFileSync(path.join(versionRoot, ".runtime-ready"), `${runtimeId}\n${digest}\n`);
    const runtime = locateRuntime(root, { runtimeRoot });
    assert.equal(runtime.state, "ready");
    assert.equal(runtime.source, "product");
    assert.equal(runtime.pythonPath, path.join(versionRoot, "python.exe"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

