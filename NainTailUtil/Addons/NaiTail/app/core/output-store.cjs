"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createId } = require("./ids.cjs");
const { safeFileStem } = require("./json-store.cjs");
const { ensureProductDirectories, resolveInside } = require("./paths.cjs");
const { withJsonMetadata, readJsonMetadata } = require("./png-metadata.cjs");
const { NainTailError } = require("./errors.cjs");

function compactTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
}

class OutputStore {
  constructor(productRoot) {
    this.productRoot = ensureProductDirectories(productRoot);
    this.directory = resolveInside(this.productRoot, "outputs");
  }

  directoryForTask(task) {
    if (task.source.type === "artist-study") return resolveInside(this.directory, "artist-study");
    if (task.source.type === "multi") return resolveInside(this.directory, "multi");
    if (!task.projectId) return resolveInside(this.directory, "single");
    const projectFolder = `${safeFileStem(task.projectName, "project")}_${task.projectId.slice(-8)}`;
    if (task.source.type === "character") {
      const characterFolder = `${safeFileStem(task.source.characterName, "character")}_${task.source.characterId.slice(-8)}`;
      return resolveInside(this.directory, "projects", projectFolder, "characters", characterFolder);
    }
    return resolveInside(this.directory, "projects", projectFolder, "general");
  }

  save(task, workerResult) {
    const raw = Buffer.from(workerResult.imageBase64, "base64");
    const outputDirectory = this.directoryForTask(task);
    fs.mkdirSync(outputDirectory, { recursive: true });
    const sourcePrefix = ["single", "artist-study"].includes(task.source.type)
      ? task.source.type
      : `${String(task.source.slotIndex || 1).padStart(3, "0")}_${safeFileStem(task.source.slotName, "slot")}`;
    const fileName = `${sourcePrefix}_${compactTimestamp()}_${createId("img").slice(-8)}.png`;
    const absolutePath = resolveInside(outputDirectory, fileName);
    const metadata = {
      schema: "naintail.image/v1",
      createdAt: new Date().toISOString(),
      runId: task.runId,
      taskId: task.id,
      projectId: task.projectId,
      source: task.source,
      request: task.request,
      result: {
        seed: workerResult.seed,
        width: workerResult.width,
        height: workerResult.height,
        model: workerResult.model,
      },
    };
    const encoded = withJsonMetadata(raw, "NainTailUtil", metadata);
    fs.writeFileSync(absolutePath, encoded, { flag: "wx" });
    const relativePath = path.relative(this.productRoot, absolutePath);
    return {
      id: createId("result"),
      runId: task.runId,
      taskId: task.id,
      projectId: task.projectId,
      source: task.source,
      relativePath,
      absolutePath,
      outputUrl: pathToFileURL(absolutePath).href,
      seed: workerResult.seed,
      width: workerResult.width,
      height: workerResult.height,
      model: workerResult.model,
      request: task.request,
      createdAt: metadata.createdAt,
    };
  }

  resolveOutputPath(relativePath) {
    const absolutePath = resolveInside(this.productRoot, String(relativePath || ""));
    const relativeToOutputs = path.relative(this.directory, absolutePath);
    if (!relativeToOutputs || relativeToOutputs.startsWith("..") || path.isAbsolute(relativeToOutputs)) {
      throw new NainTailError("INVALID_OUTPUT_PATH", "outputs 폴더 안의 이미지 경로만 사용할 수 있습니다.");
    }
    if (!fs.existsSync(absolutePath)) throw new NainTailError("OUTPUT_NOT_FOUND", "선택한 이미지 파일을 찾을 수 없습니다.");
    return absolutePath;
  }

  readMetadata(relativePath) {
    return readJsonMetadata(this.resolveOutputPath(relativePath));
  }
}

module.exports = { OutputStore, compactTimestamp };
