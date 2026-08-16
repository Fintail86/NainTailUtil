"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { net, protocol } = require("electron");
const channels = require("./channels.cjs");
const { listGalleryDirectory, resolveGalleryItem } = require("./gallery-service.cjs");

const IMAGE_SCHEME = "gallerytail";
let addonContext = null;
let sourceRoot = null;
let sourceOutputRoot = null;

function outputRoot() {
  return sourceOutputRoot || path.resolve(sourceRoot, "outputs");
}

function imageUrl(id) {
  return `${IMAGE_SCHEME}://outputs/${encodeURIComponent(id)}`;
}

function publicGallery(directory = "") {
  const result = listGalleryDirectory(sourceRoot, directory, { outputRoot: outputRoot() });
  return {
    ...result,
    items: result.items.map(({ absolutePath: _absolutePath, legacySidecarPath: _legacySidecarPath, ...item }) => ({
      ...item,
      imageUrl: imageUrl(item.id),
    })),
  };
}

function registerProtocol() {
  protocol.handle(IMAGE_SCHEME, (request) => {
    const url = new URL(request.url);
    if (url.host !== "outputs") return new Response(null, { status: 404 });
    const id = decodeURIComponent(url.pathname.replace(/^\//u, ""));
    const item = resolveGalleryItem(sourceRoot, id, { outputRoot: outputRoot() });
    return item
      ? net.fetch(pathToFileURL(item.absolutePath).toString())
      : new Response(null, { status: 404 });
  });
}

function activate(context) {
  addonContext = context;
  const { ipcMain, resolveAddonDirectory, shell } = context.services;
  sourceRoot = resolveAddonDirectory("animatail");
  if (!sourceRoot) throw new Error("GalleryTail에 필요한 AnimaTail을 찾을 수 없습니다.");
  sourceOutputRoot = typeof context.services.resolveAddonOutputRoot === "function"
    ? context.services.resolveAddonOutputRoot("animatail")
    : path.resolve(sourceRoot, "outputs");
  registerProtocol();
  ipcMain.handle(channels.LIST, (_event, directory) => publicGallery(String(directory || "")));
  ipcMain.handle(channels.OPEN_FOLDER, () => {
    fs.mkdirSync(outputRoot(), { recursive: true });
    return shell.openPath(outputRoot());
  });
  ipcMain.handle(channels.REVEAL, (_event, id) => {
    const item = resolveGalleryItem(sourceRoot, String(id), { outputRoot: outputRoot() });
    if (!item) throw new Error("갤러리 파일을 찾을 수 없습니다.");
    shell.showItemInFolder(item.absolutePath);
    return true;
  });
  ipcMain.handle(channels.TRASH, async (_event, id) => {
    const item = resolveGalleryItem(sourceRoot, String(id), { outputRoot: outputRoot() });
    if (!item) throw new Error("갤러리 파일을 찾을 수 없습니다.");
    await shell.trashItem(item.absolutePath);
    if (item.legacySidecarPath && fs.existsSync(item.legacySidecarPath)) {
      await shell.trashItem(item.legacySidecarPath);
    }
    return true;
  });
  return {
    id: context.manifest.id,
    smokeCheck(webContents) {
      return webContents.executeJavaScript(
        "Boolean(window.galleryTail && document.querySelector('.gallery-page') && document.querySelector('#hostHomeButton'))",
      );
    },
    close() {
      for (const channel of Object.values(channels)) ipcMain.removeHandler(channel);
      try { protocol.unhandle(IMAGE_SCHEME); } catch {}
      addonContext = null;
      sourceRoot = null;
      sourceOutputRoot = null;
    },
  };
}

module.exports = { activate };
