"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require("electron");
const channels = require("./channels.cjs");
const { CredentialService } = require("./credential-service.cjs");
const { NainTailApplication } = require("../core/application.cjs");
const { NainTailError, asPublicError } = require("../core/errors.cjs");

const productRoot = path.resolve(__dirname, "..", "..");
const smokeMode = process.argv.includes("--smoke");
let mainWindow = null;
let core = null;
let smokeTimer = null;

function reply(fn) {
  return async (_event, payload) => {
    try {
      return { ok: true, result: await fn(payload) };
    } catch (error) {
      return { ok: false, error: asPublicError(error) };
    }
  };
}

function broadcast(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

async function pickReferenceImage() {
  const picked = await dialog.showOpenDialog(mainWindow, {
    title: "참조 이미지 선택",
    properties: ["openFile"],
    filters: [{ name: "Raster image", extensions: ["png", "jpg", "jpeg", "webp"] }],
  });
  if (picked.canceled || !picked.filePaths[0]) return null;
  const filePath = picked.filePaths[0];
  const data = fs.readFileSync(filePath);
  if (!data.length || data.length > 20 * 1024 * 1024) throw new NainTailError("INVALID_REFERENCE_IMAGE", "이미지 참조 원본은 20MB 이하여야 합니다.");
  const png = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  const webp = data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP";
  const mimeType = png ? "image/png" : jpeg ? "image/jpeg" : webp ? "image/webp" : null;
  if (!mimeType) throw new NainTailError("INVALID_REFERENCE_IMAGE", "PNG, JPEG 또는 WebP 이미지만 사용할 수 있습니다.");
  return { name: path.basename(filePath), mimeType, imageBase64: data.toString("base64") };
}

function registerHandlers(credentials) {
  ipcMain.handle(channels.APP_INFO, reply(() => core.info()));
  ipcMain.handle(channels.APP_LIVE_STATUS, reply(() => core.liveStatus()));
  ipcMain.handle(channels.CREDENTIAL_STATUS, reply(() => credentials.status()));
  ipcMain.handle(channels.CREDENTIAL_SAVE, reply((payload) => credentials.saveToken(payload?.token)));
  ipcMain.handle(channels.CREDENTIAL_CLEAR, reply(() => credentials.clear()));
  ipcMain.handle(channels.SUBSCRIPTION_GET, reply(() => core.subscription()));
  ipcMain.handle(channels.PROJECT_LIST, reply(() => core.listProjects()));
  ipcMain.handle(channels.PROJECT_CREATE, reply((payload) => core.createProject(payload)));
  ipcMain.handle(channels.PROJECT_GET, reply((payload) => core.getProject(payload?.id)));
  ipcMain.handle(channels.PROJECT_SAVE, reply((payload) => core.saveProject(payload)));
  ipcMain.handle(channels.PROJECT_APPEND_PRESET, reply((payload) => core.appendPreset(payload?.projectId, payload?.presetId, payload?.target)));
  ipcMain.handle(channels.PRESET_LIST, reply(() => core.listPresets()));
  ipcMain.handle(channels.PRESET_GET, reply((payload) => core.getPreset(payload?.id)));
  ipcMain.handle(channels.PRESET_SAVE, reply((payload) => core.savePreset(payload)));
  ipcMain.handle(channels.PRESET_DELETE, reply((payload) => core.deletePreset(payload?.id)));
  ipcMain.handle(channels.GENERATION_ESTIMATE, reply((payload) => core.estimate(payload?.request || {}, payload?.options || {})));
  ipcMain.handle(channels.GENERATION_SINGLE, reply((payload) => core.enqueueSingle(payload)));
  ipcMain.handle(channels.GENERATION_MULTI, reply((payload) => core.enqueueMulti(payload)));
  ipcMain.handle(channels.GENERATION_ARTIST_STUDY, reply((payload) => core.enqueueArtistStudy(payload)));
  ipcMain.handle(channels.GENERATION_PROJECT, reply((payload) => core.enqueueProject(payload?.projectId, payload?.options || {})));
  ipcMain.handle(channels.ARTIST_STUDY_GET, reply(() => core.getArtistStudy()));
  ipcMain.handle(channels.ARTIST_STUDY_SAVE, reply((payload) => core.saveArtistStudy(payload)));
  ipcMain.handle(channels.ARTIST_STUDY_RANDOMIZE, reply((payload) => core.randomizeArtistStudy(payload)));
  ipcMain.handle(channels.ARTIST_STUDY_EXAMPLE_SAVE, reply((payload) => core.saveArtistStudyExample(payload?.study, payload?.name)));
  ipcMain.handle(channels.REFERENCE_IMAGE_PICK, reply(() => pickReferenceImage()));
  ipcMain.handle(channels.REFERENCE_IMAGE_SAVE, reply((payload) => core.saveReferenceImage(payload)));
  ipcMain.handle(channels.VIBE_IMAGE_SAVE, reply((payload) => core.saveVibeImage(payload)));
  ipcMain.handle(channels.VIBE_CACHE_STATUS, reply((payload) => core.vibeCacheStatus(payload)));
  ipcMain.handle(channels.QUEUE_STATE, reply(() => core.queue.snapshot()));
  ipcMain.handle(channels.QUEUE_CLEAR, reply(() => core.clearQueue()));
  ipcMain.handle(channels.QUEUE_STOP, reply(() => core.stopAfterCurrent()));
  ipcMain.handle(channels.QUEUE_RESUME, reply(() => core.resumeQueue()));
  ipcMain.handle(channels.OUTPUTS_OPEN, reply(() => shell.openPath(path.join(productRoot, "outputs"))));
  ipcMain.handle(channels.OUTPUT_REVEAL, reply((payload) => {
    shell.showItemInFolder(core.resolveOutputPath(payload?.relativePath));
    return { revealed: true };
  }));
  ipcMain.handle(channels.OUTPUT_TRASH, reply(async (payload) => {
    await shell.trashItem(core.resolveOutputPath(payload?.relativePath));
    return core.removeResultReference(payload?.projectId, payload?.id);
  }));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#111318",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.removeMenu();
  const revealWindow = () => {
    if (smokeMode || !mainWindow || mainWindow.isDestroyed() || mainWindow.isVisible()) return;
    mainWindow.show();
    mainWindow.focus();
  };
  if (smokeMode) {
    const failSmoke = () => {
      process.exitCode = 1;
      app.quit();
    };
    smokeTimer = setTimeout(failSmoke, 15000);
    mainWindow.webContents.once("did-fail-load", failSmoke);
    mainWindow.webContents.once("render-process-gone", failSmoke);
    mainWindow.webContents.once("preload-error", failSmoke);
    mainWindow.webContents.once("did-finish-load", async () => {
      try {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const ready = await mainWindow.webContents.executeJavaScript(
          "Boolean(window.nainTail && document.querySelector('#singleForm') && document.querySelector('#multiForm') && document.querySelector('#artistStudyForm') && document.querySelectorAll('[data-tab]').length === 6 && !document.querySelector('#notice.error'))",
        );
        if (!ready) throw new Error("renderer contract missing");
        clearTimeout(smokeTimer);
        smokeTimer = null;
        app.quit();
      } catch {
        failSmoke();
      }
    });
  } else {
    // `ready-to-show` is not guaranteed to arrive on every portable Chromium
    // startup. A successfully loaded renderer is sufficient to reveal the UI.
    mainWindow.once("ready-to-show", revealWindow);
    mainWindow.webContents.once("did-finish-load", revealWindow);
    setTimeout(revealWindow, 3000);
  }
  mainWindow.loadFile(path.join(productRoot, "app", "renderer", "index.html"));
  mainWindow.on("closed", () => { mainWindow = null; });
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(() => {
    const credentials = new CredentialService(productRoot, safeStorage);
    core = new NainTailApplication({ productRoot, getToken: async () => credentials.getToken() });
    core.on("queue", (event) => broadcast(channels.QUEUE_EVENT, event));
    core.on("result", (result) => broadcast(channels.RESULT_EVENT, result));
    registerHandlers(credentials);
    createWindow();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => core?.close());
}
