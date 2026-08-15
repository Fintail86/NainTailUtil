"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { nativeImage } = require("electron");
const channels = require("./channels.cjs");
const {
  CENSOR_BATCH_SIZE,
  CensorService,
  IMAGE_EXTENSIONS,
  collectCensorInputFiles,
} = require("./censor-service.cjs");
const { RuntimeInstaller } = require("./runtime-installer.cjs");

let addonContext = null;
let censorService = null;
let resourceRoot = null;
let runtimeInstaller = null;

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

function imagePayload(id, maximum = 1600) {
  const item = censorService.resolveImage(id);
  if (!item) throw new Error("자동검열 입력 이미지를 찾을 수 없습니다.");
  const image = nativeImage.createFromPath(item.absolutePath);
  if (image.isEmpty()) throw new Error("자동검열 입력 이미지를 읽을 수 없습니다.");
  const rendered = resizedImageData(image, maximum);
  const size = rendered.getSize();
  return { dataUrl: rendered.toDataURL(), width: size.width, height: size.height };
}

function publicSaveResult(result) {
  return {
    ...result,
    images: result.images.map(({ path: absolutePath, ...item }) => {
      const image = nativeImage.createFromPath(absolutePath);
      const thumbnailDataUrl = image.isEmpty() ? null : resizedImageData(image, 180).toDataURL();
      return { ...item, thumbnailDataUrl };
    }),
  };
}

function explicitDroppedFile(input) {
  if (!input || typeof input !== "object") return null;
  const absolutePath = path.resolve(String(input.absolutePath || ""));
  const extension = path.extname(absolutePath).toLowerCase();
  let outputRelativePath = String(input.outputRelativePath || "").replace(/^[/\\]+/, "");
  outputRelativePath = path.normalize(outputRelativePath);
  if (!IMAGE_EXTENSIONS.has(extension)
    || !outputRelativePath
    || path.isAbsolute(outputRelativePath)
    || outputRelativePath.split(path.sep).includes("..")) return null;
  try {
    if (!fs.statSync(absolutePath).isFile()) return null;
  } catch {
    return null;
  }
  return { absolutePath, outputRelativePath };
}

async function registerInputPaths(inputPaths) {
  const filesystemPaths = [];
  const explicitFiles = [];
  for (const input of inputPaths) {
    if (typeof input === "string") filesystemPaths.push(input);
    else {
      const explicit = explicitDroppedFile(input);
      if (explicit) explicitFiles.push(explicit);
    }
  }
  const discovered = [...collectCensorInputFiles(filesystemPaths), ...explicitFiles];
  let imported = 0;
  for (let offset = 0; offset < discovered.length; offset += CENSOR_BATCH_SIZE) {
    const batch = discovered.slice(offset, offset + CENSOR_BATCH_SIZE);
    const files = batch.map(({ absolutePath, outputRelativePath }) => {
      const image = nativeImage.createFromPath(absolutePath);
      if (image.isEmpty()) return null;
      const size = image.getSize();
      return {
        absolutePath,
        outputRelativePath,
        width: size.width,
        height: size.height,
        thumbnailDataUrl: resizedImageData(image, 160).toDataURL(),
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
  const { dialog, ipcMain, resolveAddonDirectory, shell } = context.services;
  resourceRoot = context.dependencies?.resourceRoot
    || (context.standalone ? context.manifest.directory : resolveAddonDirectory("animatail"));
  if (!resourceRoot) throw new Error("CensorTail에 필요한 Python/CUDA runtime과 검열 모델을 찾을 수 없습니다.");
  censorService = new CensorService(context.manifest.directory, sendEvent, { resourceRoot });
  runtimeInstaller = new RuntimeInstaller(resourceRoot, sendRuntimeEvent);

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
    const sourceOutputRoot = path.join(resourceRoot, "outputs");
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
    const sourceOutputRoot = path.join(resourceRoot, "outputs");
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
    smokeCheck(webContents) {
      return webContents.executeJavaScript(
        "Boolean(window.censorTail && document.querySelector('.censor-page') && document.querySelector('#hostHomeButton'))",
      );
    },
    close() {
      runtimeInstaller?.cancel();
      censorService?.shutdown();
      for (const channel of Object.values(channels)) ipcMain.removeHandler(channel);
      censorService = null;
      runtimeInstaller = null;
      resourceRoot = null;
      addonContext = null;
    },
  };
}

module.exports = { activate };
