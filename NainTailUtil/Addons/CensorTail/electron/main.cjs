"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { nativeImage } = require("electron");
const channels = require("./channels.cjs");
const {
  explicitDroppedFile,
  materializeDroppedFile,
  usableDroppedPath,
} = require("./dropped-input.cjs");
const {
  CENSOR_BATCH_SIZE,
  CensorService,
  IMAGE_EXTENSIONS,
  collectCensorInputFiles,
} = require("./censor-service.cjs");
const { RuntimeInstaller } = require("./runtime-installer.cjs");
const { AddonOutputSettings } = require("./output-settings.cjs");
const { webpDimensions } = require("./webp.cjs");

let addonContext = null;
let censorService = null;
let dropCacheRoot = null;
let modelRoot = null;
let resourceRoot = null;
let runtimeRoot = null;
let runtimeInstaller = null;
let inputDefaultRoot = null;
let outputSettings = null;

function sendEvent(event) {
  addonContext?.broadcast(channels.EVENT, event);
}

function sendRuntimeEvent(event) {
  addonContext?.broadcast(channels.RUNTIME_EVENT, event);
}

async function publicStatus() {
  return {
    ...await censorService.status(),
    runtime: runtimeInstaller.status(),
  };
}

function resizedImageData(image, maximum, quality = "good") {
  const size = image.getSize();
  if (Math.max(size.width, size.height) <= maximum) return image;
  return size.width >= size.height
    ? image.resize({ width: maximum, quality })
    : image.resize({ height: maximum, quality });
}

function readableImageData(absolutePath, maximum) {
  const image = nativeImage.createFromPath(absolutePath);
  if (!image.isEmpty()) {
    const rendered = resizedImageData(image, maximum);
    const size = rendered.getSize();
    return { dataUrl: rendered.toDataURL(), width: size.width, height: size.height };
  }
  if (path.extname(absolutePath).toLowerCase() !== ".webp") return null;
  try {
    const bytes = fs.readFileSync(absolutePath);
    const size = webpDimensions(bytes);
    if (!size) return null;
    return { dataUrl: `data:image/webp;base64,${bytes.toString("base64")}`, ...size };
  } catch {
    return null;
  }
}

function imagePayload(id, maximum = 1600) {
  const item = censorService.resolveImage(id);
  if (!item) throw new Error("자동검열 입력 이미지를 찾을 수 없습니다.");
  const payload = readableImageData(item.absolutePath, maximum);
  if (!payload) throw new Error("자동검열 입력 이미지를 읽을 수 없습니다.");
  return payload;
}

function publicSaveResult(result) {
  return {
    ...result,
    images: result.images.map(({ path: absolutePath, ...item }) => {
      const thumbnailDataUrl = readableImageData(absolutePath, 180)?.dataUrl || null;
      return { ...item, thumbnailDataUrl };
    }),
  };
}

async function registerInputPaths(inputPaths) {
  const filesystemPaths = [];
  const explicitFiles = [];
  for (const input of inputPaths) {
    if (typeof input === "string") filesystemPaths.push(input);
    else {
      const explicit = explicitDroppedFile(input) || materializeDroppedFile(input, dropCacheRoot);
      if (explicit) explicitFiles.push(explicit);
    }
  }
  const discovered = [...collectCensorInputFiles(filesystemPaths), ...explicitFiles];
  let imported = 0;
  for (let offset = 0; offset < discovered.length; offset += CENSOR_BATCH_SIZE) {
    const batch = discovered.slice(offset, offset + CENSOR_BATCH_SIZE);
    const files = batch.map(({ absolutePath, outputRelativePath }) => {
      const image = readableImageData(absolutePath, 160);
      if (!image) return null;
      return {
        absolutePath,
        outputRelativePath,
        width: image.width,
        height: image.height,
        thumbnailDataUrl: image.dataUrl,
      };
    }).filter(Boolean);
    imported += censorService.registerImageBatch(files);
    sendEvent({
      event: "import",
      phase: "import",
      index: Math.min(offset + batch.length, discovered.length),
      total: discovered.length,
      imported,
    });
    await new Promise((resolve) => setImmediate(resolve));
  }
  return censorService.listImages();
}

function activate(context) {
  addonContext = context;
  const { dialog, ipcMain, shell } = context.services;
  if (!context.standalone && !context.dependencies?.runtimeRoot) {
    throw new Error("Hosted CensorTail에 NainTail runtimeRoot가 주입되지 않았습니다.");
  }
  resourceRoot = context.dependencies?.resourceRoot
    || context.manifest.directory;
  if (!resourceRoot) throw new Error("CensorTail에 필요한 Python/CUDA runtime과 검열 모델을 찾을 수 없습니다.");
  runtimeRoot = path.resolve(context.dependencies?.runtimeRoot || path.join(resourceRoot, "runtime"));
  modelRoot = path.resolve(context.dependencies?.modelRoot || path.join(resourceRoot, "Models", "censor"));
  dropCacheRoot = path.join(
    path.resolve(context.dataRoot || context.manifest.directory),
    "data",
    "drop-cache",
  );
  outputSettings = new AddonOutputSettings({
    addonRoot: context.manifest.directory,
    standalone: context.standalone === true,
    hostedOutputRoot: context.outputRoot,
  });
  let outputRoot = outputSettings.outputRoot();
  inputDefaultRoot = !context.standalone && typeof context.services.resolveAddonOutputRoot === "function"
    ? context.services.resolveAddonOutputRoot("animatail")
    : outputRoot;
  fs.rmSync(dropCacheRoot, { recursive: true, force: true });
  censorService = new CensorService(context.manifest.directory, sendEvent, {
    resourceRoot,
    runtimeRoot,
    modelRoot,
    outputRoot,
  });
  runtimeInstaller = new RuntimeInstaller(resourceRoot, sendRuntimeEvent, { runtimeRoot });
  const validateDroppedPath = (event, candidate) => {
    event.returnValue = usableDroppedPath(candidate);
  };

  ipcMain.on(channels.VALIDATE_DROPPED_PATH, validateDroppedPath);
  ipcMain.handle(channels.GET_STATUS, () => publicStatus());
  ipcMain.handle(channels.INSTALL_RUNTIME, async () => {
    await runtimeInstaller.install();
    return publicStatus();
  });
  ipcMain.handle(channels.CANCEL_RUNTIME_INSTALL, () => runtimeInstaller.cancel());
  ipcMain.handle(channels.WARMUP_MODEL, () => censorService.warmup());
  ipcMain.handle(channels.INSTALL_MODEL, async () => {
    await censorService.installModel();
    return publicStatus();
  });
  ipcMain.handle(channels.SELECT_IMAGES, () => {
    const sourceOutputRoot = inputDefaultRoot;
    fs.mkdirSync(sourceOutputRoot, { recursive: true });
    const filePaths = dialog.showOpenDialogSync(context.getWindow(), {
      title: "자동검열할 이미지 선택",
      defaultPath: sourceOutputRoot,
      properties: ["openFile", "multiSelections"],
      filters: [{
        name: "이미지",
        extensions: [...IMAGE_EXTENSIONS].map((extension) => extension.slice(1)),
      }],
    });
    return filePaths?.length ? registerInputPaths(filePaths) : censorService.listImages();
  });
  ipcMain.handle(channels.SELECT_FOLDER, () => {
    const sourceOutputRoot = inputDefaultRoot;
    fs.mkdirSync(sourceOutputRoot, { recursive: true });
    const folderPaths = dialog.showOpenDialogSync(context.getWindow(), {
      title: "자동검열할 이미지 폴더 선택",
      defaultPath: sourceOutputRoot,
      properties: ["openDirectory"],
    });
    return folderPaths?.length ? registerInputPaths(folderPaths) : censorService.listImages();
  });
  ipcMain.handle(channels.ADD_DROPPED_PATHS, (_event, paths) => registerInputPaths(Array.isArray(paths) ? paths : []));
  ipcMain.handle(channels.REMOVE_IMAGE, (_event, id) => censorService.removeImage(id));
  ipcMain.handle(channels.CLEAR_IMAGES, () => censorService.clearImages());
  ipcMain.handle(channels.GET_IMAGE, (_event, id) => imagePayload(String(id)));
  ipcMain.handle(channels.PREVIEW, (_event, request) => censorService.preview(request));
  ipcMain.handle(channels.SCAN, (_event, request) => censorService.scan(request));
  ipcMain.handle(channels.SAVE, async (_event, request) => publicSaveResult(await censorService.save(request)));
  ipcMain.handle(channels.OUTPUT_SETTINGS_GET, () => outputSettings.status());
  ipcMain.handle(channels.OUTPUT_SETTINGS_SELECT, async () => {
    if (outputSettings.status().locked) throw new Error("Hosted 모드에서는 호스트 출력 폴더를 사용합니다.");
    if (censorService.isBusy()) throw new Error("자동검열 작업 중에는 출력 폴더를 변경할 수 없습니다.");
    const picked = await dialog.showOpenDialog(context.getWindow(), {
      title: "CensorTail 출력 폴더 선택",
      defaultPath: outputRoot,
      properties: ["openDirectory", "createDirectory"],
    });
    if (picked.canceled || !picked.filePaths[0]) return outputSettings.status();
    const status = outputSettings.setOutputRoot(picked.filePaths[0]);
    outputRoot = status.outputRoot;
    censorService.setOutputRoot(outputRoot);
    inputDefaultRoot = outputRoot;
    return status;
  });
  ipcMain.handle(channels.OUTPUT_SETTINGS_RESET, () => {
    if (censorService.isBusy()) throw new Error("자동검열 작업 중에는 출력 폴더를 변경할 수 없습니다.");
    const status = outputSettings.reset();
    outputRoot = status.outputRoot;
    censorService.setOutputRoot(outputRoot);
    inputDefaultRoot = outputRoot;
    return status;
  });
  ipcMain.handle(channels.OPEN_OUTPUT_FOLDER, () => {
    const root = censorService.outputRoot();
    fs.mkdirSync(root, { recursive: true });
    return shell.openPath(root);
  });
  ipcMain.handle(channels.REVEAL_OUTPUT, (_event, fileName) => {
    const output = censorService.resolveOutput(fileName);
    if (!output) throw new Error("자동검열 출력 파일을 찾을 수 없습니다.");
    shell.showItemInFolder(output);
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
          const status = await window.censorTail?.getOutputSettings?.();
          return Boolean(window.censorTail
            && document.querySelector('.censor-page')
            && document.querySelector('#hostHomeButton')
            && settingsTab?.classList.contains('active')
            && status?.mode === 'hosted' && status?.locked === true
            && document.querySelector('[data-addon-output-settings]')
            && document.querySelector('#censorOutputSelect')?.disabled
            && document.querySelector('#censorOutputReset')?.disabled);
        })()`,
      );
    },
    close() {
      runtimeInstaller?.cancel();
      censorService?.shutdown();
      if (dropCacheRoot) fs.rmSync(dropCacheRoot, { recursive: true, force: true });
      ipcMain.removeListener(channels.VALIDATE_DROPPED_PATH, validateDroppedPath);
      for (const channel of Object.values(channels)) ipcMain.removeHandler(channel);
      censorService = null;
      dropCacheRoot = null;
      runtimeInstaller = null;
      modelRoot = null;
      resourceRoot = null;
      runtimeRoot = null;
      inputDefaultRoot = null;
      outputSettings = null;
      addonContext = null;
    },
  };
}

module.exports = { activate };
