"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { net, protocol } = require("electron");
const channels = require("./channels.cjs");
const { listGalleryDirectory, resolveGalleryItem } = require("./gallery-service.cjs");
const { AddonOutputSettings } = require("./output-settings.cjs");

const IMAGE_SCHEME = "gallerytail";
let addonContext = null;
let addonRoot = null;
let outputSettings = null;
let activeSourceId = "workspace";

function outputRoot() {
  return outputSettings?.outputRoot() || path.resolve(addonRoot, "outputs");
}

function imageUrl(id) {
  return `${IMAGE_SCHEME}://outputs/${encodeURIComponent(id)}`;
}

function sourceCatalog() {
  const workspace = {
    id: "workspace",
    kind: "workspace",
    name: "워크스페이스",
    outputRoot: outputRoot(),
    source: outputSettings?.status().source || "default",
  };
  const portable = (addonContext?.services.listPortableOutputRoots?.() || []).map((entry) => ({
    ...entry,
    id: `portable:${entry.id}`,
    addonId: entry.id,
    kind: "portable",
  }));
  return [workspace, ...portable];
}

function sourceById(sourceId = activeSourceId) {
  return sourceCatalog().find((source) => source.id === sourceId) || null;
}

function activeSource() {
  const source = sourceById();
  if (source) return source;
  activeSourceId = "workspace";
  return sourceById("workspace");
}

function publicSources() {
  const sources = sourceCatalog();
  if (!sources.some((source) => source.id === activeSourceId)) activeSourceId = "workspace";
  return { activeSourceId, sources };
}

function selectSource(sourceId) {
  const normalized = String(sourceId || "");
  if (!sourceById(normalized)) throw new Error("선택한 갤러리 저장 위치를 찾을 수 없습니다.");
  activeSourceId = normalized;
  return publicSources();
}

function encodeItemId(sourceId, itemId) {
  return Buffer.from(JSON.stringify([sourceId, itemId]), "utf8").toString("base64url");
}

function decodeItemId(publicId) {
  try {
    const value = JSON.parse(Buffer.from(String(publicId || ""), "base64url").toString("utf8"));
    if (!Array.isArray(value) || value.length !== 2 || !sourceById(String(value[0]))) return null;
    return { sourceId: String(value[0]), itemId: String(value[1]) };
  } catch {
    return null;
  }
}

function publicGallery(directory = "") {
  const source = activeSource();
  const result = listGalleryDirectory(addonRoot, directory, { outputRoot: source.outputRoot });
  return {
    ...result,
    rootName: source.name,
    source: { id: source.id, kind: source.kind, name: source.name, outputRoot: source.outputRoot },
    items: result.items.map(({ absolutePath: _absolutePath, legacySidecarPath: _legacySidecarPath, ...item }) => ({
      ...item,
      id: encodeItemId(source.id, item.id),
      imageUrl: imageUrl(encodeItemId(source.id, item.id)),
    })),
  };
}

function resolvePublicItem(publicId) {
  const decoded = decodeItemId(publicId);
  if (!decoded) return null;
  const source = sourceById(decoded.sourceId);
  return resolveGalleryItem(addonRoot, decoded.itemId, { outputRoot: source.outputRoot });
}

function registerProtocol() {
  protocol.handle(IMAGE_SCHEME, (request) => {
    const url = new URL(request.url);
    if (url.host !== "outputs") return new Response(null, { status: 404 });
    const id = decodeURIComponent(url.pathname.replace(/^\//u, ""));
    const item = resolvePublicItem(id);
    return item
      ? net.fetch(pathToFileURL(item.absolutePath).toString())
      : new Response(null, { status: 404 });
  });
}

function activate(context) {
  addonContext = context;
  const { ipcMain, shell } = context.services;
  addonRoot = context.manifest.directory;
  outputSettings = new AddonOutputSettings({
    addonRoot,
    standalone: context.standalone === true,
    hostedOutputRoot: context.outputRoot,
  });
  activeSourceId = "workspace";
  registerProtocol();
  ipcMain.handle(channels.LIST, (_event, directory) => publicGallery(String(directory || "")));
  ipcMain.handle(channels.OPEN_FOLDER, () => {
    const source = activeSource();
    fs.mkdirSync(source.outputRoot, { recursive: true });
    return shell.openPath(source.outputRoot);
  });
  ipcMain.handle(channels.OPEN_WORKSPACE_FOLDER, () => {
    fs.mkdirSync(outputRoot(), { recursive: true });
    return shell.openPath(outputRoot());
  });
  ipcMain.handle(channels.SOURCES_GET, () => publicSources());
  ipcMain.handle(channels.SOURCE_SELECT, (_event, sourceId) => selectSource(sourceId));
  ipcMain.handle(channels.OUTPUT_SETTINGS_GET, () => outputSettings.status());
  ipcMain.handle(channels.OUTPUT_SETTINGS_SELECT, async () => {
    if (outputSettings.status().locked) throw new Error("Hosted 모드에서는 호스트 출력 폴더를 사용합니다.");
    const picked = await context.services.dialog.showOpenDialog(context.getWindow(), {
      title: "GalleryTail 출력 폴더 선택",
      defaultPath: outputRoot(),
      properties: ["openDirectory", "createDirectory"],
    });
    if (picked.canceled || !picked.filePaths[0]) return outputSettings.status();
    return outputSettings.setOutputRoot(picked.filePaths[0]);
  });
  ipcMain.handle(channels.OUTPUT_SETTINGS_RESET, () => outputSettings.reset());
  ipcMain.handle(channels.REVEAL, (_event, id) => {
    const item = resolvePublicItem(String(id));
    if (!item) throw new Error("갤러리 파일을 찾을 수 없습니다.");
    shell.showItemInFolder(item.absolutePath);
    return true;
  });
  ipcMain.handle(channels.TRASH, async (_event, id) => {
    const item = resolvePublicItem(String(id));
    if (!item) throw new Error("갤러리 파일을 찾을 수 없습니다.");
    await shell.trashItem(item.absolutePath);
    if (item.legacySidecarPath && fs.existsSync(item.legacySidecarPath)) {
      await shell.trashItem(item.legacySidecarPath);
    }
    return true;
  });
  return {
    id: context.manifest.id,
    async smokeCheck(webContents) {
      return webContents.executeJavaScript(
        `(async () => {
          const settingsTab = document.querySelector('[data-addon-settings-tab]');
          settingsTab?.click();
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const status = await window.galleryTail?.getOutputSettings?.();
          const sources = await window.galleryTail?.getSources?.();
          const listing = await window.galleryTail?.list?.("");
          const settingsReady = Boolean(settingsTab?.classList.contains('active')
            && document.querySelector('[data-addon-output-settings]')
            && document.querySelector('#galleryOutputSelect')?.disabled
            && document.querySelector('#galleryOutputReset')?.disabled);
          document.querySelector('.tab-item:not([data-addon-settings-tab])')?.click();
          document.querySelector('[data-gallery-view-mode="portable"]')?.click();
          await new Promise((resolve) => setTimeout(resolve, 250));
          const portableSources = await window.galleryTail?.getSources?.();
          const portableListing = await window.galleryTail?.list?.("");
          await window.galleryTail?.selectSource?.('workspace');
          return Boolean(window.galleryTail
            && document.querySelector('.gallery-page')
            && document.querySelector('#hostHomeButton')
            && settingsReady
            && status?.mode === 'hosted' && status?.locked === true
            && status?.outputRoot === ${JSON.stringify(outputRoot())}
            && sources?.activeSourceId === 'workspace'
            && sources?.sources?.some((source) => source.id === 'workspace')
            && sources?.sources?.some((source) => source.kind === 'portable')
            && listing?.directory === ''
            && listing?.source?.id === 'workspace'
            && String(portableSources?.activeSourceId || '').startsWith('portable:')
            && portableListing?.source?.kind === 'portable'
            && document.querySelector('[data-gallery-source-overlay]')
            && document.querySelectorAll('[data-gallery-view-mode]').length === 3
            && !Array.from(document.querySelectorAll('button'))
              .some((button) => button.textContent.trim() === '설정 불러오기'));
        })()`,
      );
    },
    close() {
      for (const channel of Object.values(channels)) ipcMain.removeHandler(channel);
      try { protocol.unhandle(IMAGE_SCHEME); } catch {}
      addonContext = null;
      addonRoot = null;
      outputSettings = null;
      activeSourceId = "workspace";
    },
  };
}

module.exports = { activate };
