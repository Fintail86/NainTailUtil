"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, nativeImage, net, protocol } = require("electron");
const channels = require("./channels.cjs");
const { RuntimeInstaller } = require("./runtime-installer.cjs");
const { listModels } = require("./model-catalog.cjs");
const { InferenceService } = require("./inference-service.cjs");
const { normalizeGenerationRequest: normalizeSharedGenerationRequest } = require("./generation-request.cjs");
const { JobQueue } = require("./job-queue.cjs");
const { listLocales } = require("./locale-service.cjs");
const { diagnoseModels, readModelDiagnostics } = require("./model-diagnostics.cjs");
const { SupportAssetService } = require("./support-asset-service.cjs");
const { AddonOutputSettings } = require("./output-settings.cjs");
const { resolveOutputItem } = require("./output-result-service.cjs");
const { REFINE_IMAGE_EXTENSIONS, RefineInputService } = require("./refine-input-service.cjs");
const packageInfo = require("../package.json");
const {
  ensurePresetFolders,
  listPresets,
  readPreset,
  resolvePresetPath,
  savePreset,
} = require("./preset-service.cjs");

const OUTPUT_IMAGE_SCHEME = "anima";
let inferenceService;
let jobQueue;
let refineInputService;
let supportAssetService;
let runtimeInstaller;
let runtimeRoot;
let runtimeManifestPath;
let outputRoot;
let outputSettings;
let addonContext;

function getAppRoot() {
  return addonContext?.manifest?.directory || path.resolve(__dirname, "..");
}

function getOutputRoot() {
  return outputRoot || path.resolve(getAppRoot(), "outputs");
}

function getAddonVersion() {
  return String(addonContext?.manifest?.version || packageInfo.version);
}

function publicCatalog(catalog) {
  return Object.fromEntries(Object.entries(catalog).map(([key, entries]) => [
    key,
    entries.map(({ absolutePath: _absolutePath, ...entry }) => entry),
  ]));
}

async function publicSupportAssetStatus() {
  return {
    required: supportAssetService.status(),
    optional: [],
  };
}

function normalizeGenerationRequestForApp(request) {
  return normalizeSharedGenerationRequest(request, {
    appRoot: getAppRoot(),
    appVersion: getAddonVersion(),
    electronVersion: process.versions.electron,
    refineInputService,
  });
}

function sendToAll(channel, payload) {
  addonContext?.broadcast(channel, payload);
}

function outputImageUrl(fileName) {
  return `${OUTPUT_IMAGE_SCHEME}://outputs/${encodeURIComponent(fileName)}`;
}

function registerOutputImageProtocol() {
  protocol.handle(OUTPUT_IMAGE_SCHEME, (request) => {
    const url = new URL(request.url);
    if (url.host !== "outputs") return new Response(null, { status: 404 });
    const fileName = decodeURIComponent(url.pathname.replace(/^\//, ""));
    const root = getOutputRoot();
    const filePath = path.resolve(root, fileName);
    const relativePath = path.relative(root, filePath);
    const extension = path.extname(filePath).toLowerCase();
    if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)
      || ![".png", ".jpg", ".jpeg", ".webp"].includes(extension)) {
      return new Response(null, { status: 403 });
    }
    if (!fs.existsSync(filePath)) return new Response(null, { status: 404 });
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function resizedImageData(image, maximum, quality = "good") {
  const size = image.getSize();
  if (Math.max(size.width, size.height) <= maximum) return image;
  return size.width >= size.height
    ? image.resize({ width: maximum, quality })
    : image.resize({ height: maximum, quality });
}

function publicRefineInput(item) {
  const image = nativeImage.createFromPath(item.absolutePath);
  if (image.isEmpty()) throw new Error("리파인 입력 이미지를 읽을 수 없습니다.");
  const size = image.getSize();
  const rendered = resizedImageData(image, 1600);
  return {
    id: item.id,
    fileName: item.fileName,
    bytes: item.bytes,
    modifiedAt: item.modifiedAt,
    width: size.width,
    height: size.height,
    imageDataUrl: rendered.toDataURL(),
  };
}

function queueResultGalleryItem(request) {
  const jobId = typeof request?.jobId === "string" ? request.jobId : "";
  const resultIndex = Number(request?.resultIndex);
  if (!jobId || !Number.isInteger(resultIndex) || resultIndex < 0 || resultIndex > 7) {
    throw new Error("작업 결과 요청 형식이 잘못됐습니다.");
  }
  const result = jobQueue.getResult(jobId, resultIndex);
  const root = getOutputRoot();
  const relativePath = result?.relativePath || (result?.path
    ? path.relative(root, result.path).split(path.sep).join("/")
    : "");
  const item = relativePath ? resolveOutputItem(root, relativePath) : null;
  if (!item) throw new Error("작업 결과 파일을 찾을 수 없습니다.");
  return { jobId, resultIndex, item };
}

function registerIpcHandlers() {
  const { dialog, ipcMain, shell } = addonContext.services;
  ipcMain.handle(channels.APP_GET_INFO, () => ({
    appVersion: getAddonVersion(),
    electronVersion: process.versions.electron,
    platform: process.platform,
  }));
  ipcMain.handle(channels.LOCALES_LIST, () => listLocales(getAppRoot()));

  ipcMain.handle(channels.RUNTIME_GET_STATUS, () => runtimeInstaller.status());
  ipcMain.handle(channels.RUNTIME_INSTALL, () => runtimeInstaller.install());
  ipcMain.handle(channels.RUNTIME_CANCEL_INSTALL, () => runtimeInstaller.cancel());
  ipcMain.handle(channels.MODELS_LIST, () => publicCatalog(listModels(getAppRoot())));
  ipcMain.handle(channels.MODELS_GET_DIAGNOSTICS, () => readModelDiagnostics(getAppRoot()));
  ipcMain.handle(channels.MODELS_DIAGNOSE, () => diagnoseModels(getAppRoot(), {
    runtimeRoot,
    runtimeManifestPath,
  }));
  ipcMain.handle(channels.MODELS_OPEN_FOLDER, () => shell.openPath(path.join(getAppRoot(), "Models")));
  ipcMain.handle(channels.OUTPUT_SETTINGS_GET, () => outputSettings.status());
  ipcMain.handle(channels.OUTPUT_SETTINGS_SELECT, async () => {
    const current = outputSettings.status();
    if (current.locked) throw new Error("Hosted 모드에서는 호스트 출력 폴더를 사용합니다.");
    const queue = jobQueue.snapshot();
    if (queue.activeJobId || queue.jobs.some((job) => ["pending", "running"].includes(job.state))) {
      throw new Error("출력 폴더는 생성 큐가 비어 있을 때 변경할 수 있습니다.");
    }
    const picked = await dialog.showOpenDialog(addonContext.getWindow(), {
      title: "AnimaTail 출력 폴더 선택",
      defaultPath: current.outputRoot,
      properties: ["openDirectory", "createDirectory"],
    });
    if (picked.canceled || !picked.filePaths[0]) return current;
    const status = outputSettings.setOutputRoot(picked.filePaths[0]);
    inferenceService.shutdown();
    outputRoot = status.outputRoot;
    inferenceService.outputRoot = outputRoot;
    return status;
  });
  ipcMain.handle(channels.OUTPUT_SETTINGS_RESET, () => {
    const queue = jobQueue.snapshot();
    if (queue.activeJobId || queue.jobs.some((job) => ["pending", "running"].includes(job.state))) {
      throw new Error("출력 폴더는 생성 큐가 비어 있을 때 변경할 수 있습니다.");
    }
    const status = outputSettings.reset();
    inferenceService.shutdown();
    outputRoot = status.outputRoot;
    inferenceService.outputRoot = outputRoot;
    return status;
  });
  ipcMain.handle(channels.OUTPUTS_OPEN, () => shell.openPath(outputRoot));
  ipcMain.handle(channels.SUPPORT_ASSETS_GET_STATUS, () => publicSupportAssetStatus());
  ipcMain.handle(channels.SUPPORT_ASSETS_INSTALL, async (_event, request) => {
    const kind = request?.kind === "optional" ? "optional" : "required";
    const assetId = String(request?.assetId || "");
    if (kind === "optional") throw new Error("이 애드온에서는 선택 보조 자산을 관리하지 않습니다.");
    await supportAssetService.install(assetId);
    return publicSupportAssetStatus();
  });
  ipcMain.handle(channels.GENERATION_START, (_event, request) => (
    jobQueue.add(normalizeGenerationRequestForApp(request))
  ));
  ipcMain.handle(channels.GENERATION_CANCEL, () => jobQueue.cancelActive());
  ipcMain.handle(channels.QUEUE_GET_STATE, () => jobQueue.snapshot());
  ipcMain.handle(channels.QUEUE_CANCEL_ALL, () => jobQueue.cancelAll());
  ipcMain.handle(channels.QUEUE_REMOVE, (_event, jobId) => jobQueue.remove(String(jobId)));
  ipcMain.handle(channels.QUEUE_MOVE, (_event, request) => {
    const direction = request?.direction === "up" ? -1 : request?.direction === "down" ? 1 : 0;
    return direction !== 0 && jobQueue.move(String(request.jobId), direction);
  });
  ipcMain.handle(channels.QUEUE_CLEAR_FINISHED, () => jobQueue.clearFinished());
  ipcMain.handle(channels.QUEUE_REVEAL_RESULT, (_event, request) => {
    const { item } = queueResultGalleryItem(request);
    shell.showItemInFolder(item.absolutePath);
    return true;
  });
  ipcMain.handle(channels.QUEUE_TRASH_RESULT, async (_event, request) => {
    const { jobId, resultIndex, item } = queueResultGalleryItem(request);
    if (jobQueue.getJobState(jobId) === "running") {
      throw new Error("실행 중인 작업의 결과는 완료된 뒤 휴지통으로 이동해 주세요.");
    }
    await shell.trashItem(item.absolutePath);
    if (item.legacySidecarPath && fs.existsSync(item.legacySidecarPath)) {
      await shell.trashItem(item.legacySidecarPath);
    }
    if (!jobQueue.removeResult(jobId, resultIndex)) {
      throw new Error("작업 목록에서 결과를 제거할 수 없습니다.");
    }
    return jobQueue.snapshot();
  });
  ipcMain.handle(channels.REFINE_SELECT_IMAGE, async () => {
    const activeWindow = addonContext.getWindow();
    const result = await dialog.showOpenDialog(activeWindow, {
      title: "리파인할 이미지 선택",
      properties: ["openFile"],
      filters: [{
        name: "이미지",
        extensions: [...REFINE_IMAGE_EXTENSIONS].map((extension) => extension.slice(1)),
      }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return publicRefineInput(refineInputService.register(result.filePaths[0]));
  });
  ipcMain.handle(channels.REFINE_ADD_DROPPED_IMAGE, (_event, inputPath) => (
    publicRefineInput(refineInputService.register(String(inputPath || "")))
  ));
  ipcMain.handle(channels.PRESETS_LIST, () => listPresets(getAppRoot()));
  ipcMain.handle(channels.PRESETS_READ, (_event, request) => (
    readPreset(getAppRoot(), request?.category, request?.id)
  ));
  ipcMain.handle(channels.PRESETS_SAVE, (_event, request) => {
    const preset = savePreset(getAppRoot(), request);
    return { preset, library: listPresets(getAppRoot()) };
  });
  ipcMain.handle(channels.PRESETS_TRASH, async (_event, request) => {
    const target = resolvePresetPath(getAppRoot(), request?.category, request?.id);
    if (!fs.existsSync(target)) throw new Error("프리셋 파일을 찾을 수 없습니다.");
    await shell.trashItem(target);
    return listPresets(getAppRoot());
  });
  ipcMain.handle(channels.PRESETS_OPEN_FOLDER, () => {
    const root = ensurePresetFolders(getAppRoot());
    return shell.openPath(root);
  });
}

function activate(context) {
  addonContext = context;
  const { ipcMain } = context.services;
  if (!context.standalone && !context.dependencies?.runtimeRoot) {
    throw new Error("Hosted AnimaTail에 NainTail runtimeRoot가 주입되지 않았습니다.");
  }
  runtimeRoot = path.resolve(context.dependencies?.runtimeRoot || path.join(getAppRoot(), "runtime"));
  runtimeManifestPath = context.dependencies?.runtimeManifestPath
    ? path.resolve(context.dependencies.runtimeManifestPath)
    : null;
  outputSettings = new AddonOutputSettings({
    addonRoot: getAppRoot(),
    standalone: context.standalone === true,
    hostedOutputRoot: context.outputRoot,
  });
  outputRoot = outputSettings.outputRoot();
  runtimeInstaller = new RuntimeInstaller(getAppRoot(), (event) => (
    sendToAll(channels.RUNTIME_EVENT, event)
  ), { allowFileUrls: !app.isPackaged, runtimeRoot, runtimeManifestPath });
  inferenceService = new InferenceService(getAppRoot(), (event) => {
    jobQueue?.handleWorkerEvent(event);
    sendToAll(channels.GENERATION_EVENT, event);
  }, { runtimeRoot, runtimeManifestPath, outputRoot });
  supportAssetService = new SupportAssetService(getAppRoot(), (event) => (
    sendToAll(channels.SUPPORT_ASSETS_EVENT, event)
  ));
  refineInputService = new RefineInputService();
  jobQueue = new JobQueue(inferenceService, (state) => sendToAll(channels.QUEUE_EVENT, state));
  registerOutputImageProtocol();
  registerIpcHandlers();

  return {
    id: context.manifest.id,
    async smokeCheck(webContents) {
      return webContents.executeJavaScript(
        `(async () => {
          let settingsTab = null;
          for (let attempt = 0; attempt < 40; attempt += 1) {
            settingsTab = Array.from(document.querySelectorAll('.tab-item')).find((item) => item.textContent.includes('설정'));
            if (settingsTab && !settingsTab.disabled) break;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          settingsTab?.click();
          await new Promise((resolve) => setTimeout(resolve, 800));
          const status = await window.animaUtil?.getOutputSettings?.();
          return Boolean(window.animaUtil
            && document.querySelector('.app-header')
            && document.querySelector('.brand')
            && settingsTab?.classList.contains('active')
            && document.querySelector('.feature-page.settings-page')
            && status?.mode === 'hosted' && status?.locked === true
            && document.querySelector('[data-addon-output-settings]')
            && document.querySelector('#animaOutputSelect')?.disabled
            && document.querySelector('#animaOutputReset')?.disabled
            && !document.body.textContent.includes('오류가 발생'));
        })()`,
      );
    },
    close() {
      runtimeInstaller?.cancel();
      inferenceService?.shutdown();
      for (const channel of new Set(Object.values(channels))) ipcMain.removeHandler(channel);
      try { protocol.unhandle(OUTPUT_IMAGE_SCHEME); } catch {}
      inferenceService = null;
      jobQueue = null;
      refineInputService = null;
      supportAssetService = null;
      runtimeInstaller = null;
      runtimeRoot = null;
      runtimeManifestPath = null;
      outputRoot = null;
      outputSettings = null;
      addonContext = null;
    },
  };
}

module.exports = { activate };
