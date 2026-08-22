"use strict";

const { contextBridge, ipcRenderer, webUtils } = require("electron");
const standalone = process.argv.includes("--addon-standalone");
const channels = Object.freeze({
  GET_STATUS: "censortail:get-status",
  INSTALL_RUNTIME: "censortail:install-runtime",
  CANCEL_RUNTIME_INSTALL: "censortail:cancel-runtime-install",
  RUNTIME_EVENT: "censortail:runtime-event",
  WARMUP_MODEL: "censortail:warmup-model",
  INSTALL_MODEL: "censortail:install-model",
  SELECT_IMAGES: "censortail:select-images",
  SELECT_FOLDER: "censortail:select-folder",
  VALIDATE_DROPPED_PATH: "censortail:validate-dropped-path",
  ADD_DROPPED_PATHS: "censortail:add-dropped-paths",
  REMOVE_IMAGE: "censortail:remove-image",
  CLEAR_IMAGES: "censortail:clear-images",
  GET_IMAGE: "censortail:get-image",
  PREVIEW: "censortail:preview",
  SCAN: "censortail:scan",
  SAVE: "censortail:save",
  OUTPUT_SETTINGS_GET: "censortail:output-settings-get",
  OUTPUT_SETTINGS_SELECT: "censortail:output-settings-select",
  OUTPUT_SETTINGS_RESET: "censortail:output-settings-reset",
  OPEN_OUTPUT_FOLDER: "censortail:open-output-folder",
  REVEAL_OUTPUT: "censortail:reveal-output",
  EVENT: "censortail:event",
  HOME: "host:navigate-home",
});

contextBridge.exposeInMainWorld("censorTail", Object.freeze({
  getCensorStatus: () => ipcRenderer.invoke(channels.GET_STATUS),
  installCensorRuntime: () => ipcRenderer.invoke(channels.INSTALL_RUNTIME),
  cancelCensorRuntimeInstall: () => ipcRenderer.invoke(channels.CANCEL_RUNTIME_INSTALL),
  warmupCensorModel: () => ipcRenderer.invoke(channels.WARMUP_MODEL),
  installCensorModel: () => ipcRenderer.invoke(channels.INSTALL_MODEL),
  selectCensorImages: () => ipcRenderer.invoke(channels.SELECT_IMAGES),
  selectCensorFolder: () => ipcRenderer.invoke(channels.SELECT_FOLDER),
  getDroppedPath: (file) => ipcRenderer.sendSync(
    channels.VALIDATE_DROPPED_PATH,
    webUtils.getPathForFile(file),
  ),
  addDroppedCensorPaths: (paths) => ipcRenderer.invoke(channels.ADD_DROPPED_PATHS, paths),
  removeCensorImage: (id) => ipcRenderer.invoke(channels.REMOVE_IMAGE, id),
  clearCensorImages: () => ipcRenderer.invoke(channels.CLEAR_IMAGES),
  getCensorImage: (id) => ipcRenderer.invoke(channels.GET_IMAGE, id),
  previewCensorImage: (request) => ipcRenderer.invoke(channels.PREVIEW, request),
  scanCensorImages: (request) => ipcRenderer.invoke(channels.SCAN, request),
  saveCensorImages: (request) => ipcRenderer.invoke(channels.SAVE, request),
  getOutputSettings: () => ipcRenderer.invoke(channels.OUTPUT_SETTINGS_GET),
  selectOutputFolder: () => ipcRenderer.invoke(channels.OUTPUT_SETTINGS_SELECT),
  resetOutputFolder: () => ipcRenderer.invoke(channels.OUTPUT_SETTINGS_RESET),
  openCensorOutputFolder: () => ipcRenderer.invoke(channels.OPEN_OUTPUT_FOLDER),
  revealCensorOutput: (fileName) => ipcRenderer.invoke(channels.REVEAL_OUTPUT, fileName),
  onCensorEvent: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on(channels.EVENT, handler);
    return () => ipcRenderer.removeListener(channels.EVENT, handler);
  },
  onCensorRuntimeEvent: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on(channels.RUNTIME_EVENT, handler);
    return () => ipcRenderer.removeListener(channels.RUNTIME_EVENT, handler);
  },
}));

if (standalone) {
  window.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.dataset.censortailStandalone = "true";
    style.textContent = "#hostHomeButton { display: none !important; }";
    document.head.appendChild(style);
  }, { once: true });
} else {
  contextBridge.exposeInMainWorld("nainTailHost", Object.freeze({
    goHome: () => ipcRenderer.invoke(channels.HOME),
  }));
}
