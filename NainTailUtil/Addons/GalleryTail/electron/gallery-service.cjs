"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readAnimaMetadata } = require("./png-metadata.cjs");

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function readMetadata(imagePath) {
  if (path.extname(imagePath).toLowerCase() !== ".png") return null;
  return readAnimaMetadata(imagePath);
}

function legacySidecarPath(imagePath) {
  const candidate = imagePath.slice(0, -path.extname(imagePath).length) + ".json";
  return fs.existsSync(candidate) ? candidate : null;
}

function outputRootPath(appRoot) {
  return path.resolve(appRoot, "outputs");
}

function normalizeGalleryId(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
}

function resolveGalleryPath(appRoot, id = "", allowDirectory = false) {
  const outputRoot = outputRootPath(appRoot);
  const normalizedId = normalizeGalleryId(id);
  const target = path.resolve(outputRoot, ...normalizedId.split("/").filter(Boolean));
  const relativePath = path.relative(outputRoot, target);
  if (
    relativePath.startsWith("..")
    || path.isAbsolute(relativePath)
    || (!allowDirectory && !relativePath)
  ) {
    return null;
  }
  return target;
}

function galleryItem(appRoot, absolutePath) {
  const outputRoot = outputRootPath(appRoot);
  const stat = fs.statSync(absolutePath);
  const id = path.relative(outputRoot, absolutePath).split(path.sep).join("/");
  const metadata = readMetadata(absolutePath);
  return {
    id,
    fileName: path.basename(absolutePath),
    directory: path.posix.dirname(id) === "." ? "" : path.posix.dirname(id),
    absolutePath,
    bytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    metadata,
    metadataSource: metadata ? "png" : null,
    legacySidecarPath: legacySidecarPath(absolutePath),
  };
}

function listGallery(appRoot, limit = 100) {
  const outputRoot = outputRootPath(appRoot);
  if (!fs.existsSync(outputRoot)) return [];
  return fs.readdirSync(outputRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => galleryItem(appRoot, path.join(outputRoot, entry.name)))
    .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))
    .slice(0, limit);
}

function listGalleryDirectory(appRoot, directoryId = "") {
  const outputRoot = outputRootPath(appRoot);
  const normalizedDirectory = normalizeGalleryId(directoryId);
  const directoryPath = resolveGalleryPath(appRoot, normalizedDirectory, true);
  if (!directoryPath) throw new Error("갤러리 폴더 경로가 올바르지 않습니다.");
  if (!fs.existsSync(outputRoot)) fs.mkdirSync(outputRoot, { recursive: true });
  if (!fs.existsSync(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
    throw new Error("갤러리 폴더를 찾을 수 없습니다.");
  }

  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  const folders = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      id: [normalizedDirectory, entry.name].filter(Boolean).join("/"),
      name: entry.name,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "ko"));
  const items = entries
    .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => galleryItem(appRoot, path.join(directoryPath, entry.name)))
    .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));

  return {
    rootName: "outputs",
    directory: normalizedDirectory,
    parentDirectory: normalizedDirectory.includes("/")
      ? normalizedDirectory.slice(0, normalizedDirectory.lastIndexOf("/"))
      : (normalizedDirectory ? "" : null),
    folders,
    items,
  };
}

function resolveGalleryItem(appRoot, id) {
  const absolutePath = resolveGalleryPath(appRoot, id);
  if (!absolutePath || !fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) return null;
  if (!IMAGE_EXTENSIONS.has(path.extname(absolutePath).toLowerCase())) return null;
  return galleryItem(appRoot, absolutePath);
}

module.exports = {
  legacySidecarPath,
  listGallery,
  listGalleryDirectory,
  normalizeGalleryId,
  readMetadata,
  resolveGalleryItem,
  resolveGalleryPath,
};
