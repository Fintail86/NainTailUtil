"use strict";

const { contextBridge, ipcRenderer, webUtils } = require("electron");
const standaloneMode = process.argv.includes("--addon-standalone");

// Sandboxed preload scripts can only require a limited set of built-in modules.
const channels = Object.freeze({
  APP_GET_INFO: "app:get-info",
  LOCALES_LIST: "locales:list",
  RUNTIME_GET_STATUS: "runtime:get-status",
  RUNTIME_INSTALL: "runtime:install",
  RUNTIME_CANCEL_INSTALL: "runtime:cancel-install",
  RUNTIME_EVENT: "runtime:event",
  MODELS_LIST: "models:list",
  MODELS_GET_DIAGNOSTICS: "models:get-diagnostics",
  GENERATION_START: "generation:start",
  GENERATION_CANCEL: "generation:cancel",
  GENERATION_EVENT: "generation:event",
  QUEUE_GET_STATE: "queue:get-state",
  QUEUE_CANCEL_ALL: "queue:cancel-all",
  QUEUE_REMOVE: "queue:remove",
  QUEUE_MOVE: "queue:move",
  QUEUE_CLEAR_FINISHED: "queue:clear-finished",
  QUEUE_REVEAL_RESULT: "queue:reveal-result",
  QUEUE_TRASH_RESULT: "queue:trash-result",
  QUEUE_EVENT: "queue:event",
  MODELS_DIAGNOSE: "models:diagnose",
  MODELS_OPEN_FOLDER: "models:open-folder",
  OUTPUT_SETTINGS_GET: "output-settings:get",
  OUTPUT_SETTINGS_SELECT: "output-settings:select",
  OUTPUT_SETTINGS_RESET: "output-settings:reset",
  OUTPUTS_OPEN: "outputs:open",
  SUPPORT_ASSETS_GET_STATUS: "support-assets:get-status",
  SUPPORT_ASSETS_INSTALL: "support-assets:install",
  SUPPORT_ASSETS_EVENT: "support-assets:event",
  REFINE_SELECT_IMAGE: "refine:select-image",
  REFINE_ADD_DROPPED_IMAGE: "refine:add-dropped-image",
  PRESETS_LIST: "presets:list",
  PRESETS_READ: "presets:read",
  PRESETS_SAVE: "presets:save",
  PRESETS_TRASH: "presets:trash",
  PRESETS_OPEN_FOLDER: "presets:open-folder",
});

const hostChannels = Object.freeze({
  HOME: "host:navigate-home",
  HANDOFF: "host:addons:handoff",
});
let pendingHostHandoff = null;
let hostHandoffListener = null;
ipcRenderer.on(hostChannels.HANDOFF, (_event, payload) => {
  if (hostHandoffListener) hostHandoffListener(payload);
  else pendingHostHandoff = payload;
});

contextBridge.exposeInMainWorld("animaUtil", Object.freeze({
  getAppInfo: () => ipcRenderer.invoke(channels.APP_GET_INFO),
  listLocales: () => ipcRenderer.invoke(channels.LOCALES_LIST),
  getRuntimeStatus: () => ipcRenderer.invoke(channels.RUNTIME_GET_STATUS),
  installRuntime: () => ipcRenderer.invoke(channels.RUNTIME_INSTALL),
  cancelRuntimeInstall: () => ipcRenderer.invoke(channels.RUNTIME_CANCEL_INSTALL),
  listModels: () => ipcRenderer.invoke(channels.MODELS_LIST),
  getModelDiagnostics: () => ipcRenderer.invoke(channels.MODELS_GET_DIAGNOSTICS),
  startGeneration: (request) => ipcRenderer.invoke(channels.GENERATION_START, request),
  cancelGeneration: () => ipcRenderer.invoke(channels.GENERATION_CANCEL),
  getQueueState: () => ipcRenderer.invoke(channels.QUEUE_GET_STATE),
  cancelAllGenerationJobs: () => ipcRenderer.invoke(channels.QUEUE_CANCEL_ALL),
  removeQueuedJob: (jobId) => ipcRenderer.invoke(channels.QUEUE_REMOVE, jobId),
  moveQueuedJob: (jobId, direction) => ipcRenderer.invoke(channels.QUEUE_MOVE, { jobId, direction }),
  clearFinishedJobs: () => ipcRenderer.invoke(channels.QUEUE_CLEAR_FINISHED),
  revealQueueResult: (jobId, resultIndex) => ipcRenderer.invoke(
    channels.QUEUE_REVEAL_RESULT,
    { jobId, resultIndex },
  ),
  trashQueueResult: (jobId, resultIndex) => ipcRenderer.invoke(
    channels.QUEUE_TRASH_RESULT,
    { jobId, resultIndex },
  ),
  diagnoseModels: () => ipcRenderer.invoke(channels.MODELS_DIAGNOSE),
  openModelsFolder: () => ipcRenderer.invoke(channels.MODELS_OPEN_FOLDER),
  getOutputSettings: () => ipcRenderer.invoke(channels.OUTPUT_SETTINGS_GET),
  selectOutputFolder: () => ipcRenderer.invoke(channels.OUTPUT_SETTINGS_SELECT),
  resetOutputFolder: () => ipcRenderer.invoke(channels.OUTPUT_SETTINGS_RESET),
  openOutputs: () => ipcRenderer.invoke(channels.OUTPUTS_OPEN),
  getSupportAssetsStatus: () => ipcRenderer.invoke(channels.SUPPORT_ASSETS_GET_STATUS),
  installSupportAsset: (kind, assetId) => ipcRenderer.invoke(
    channels.SUPPORT_ASSETS_INSTALL,
    { kind, assetId },
  ),
  selectRefineImage: () => ipcRenderer.invoke(channels.REFINE_SELECT_IMAGE),
  addDroppedRefineImage: (file) => ipcRenderer.invoke(
    channels.REFINE_ADD_DROPPED_IMAGE,
    webUtils.getPathForFile(file),
  ),
  listPresets: () => ipcRenderer.invoke(channels.PRESETS_LIST),
  readPreset: (category, id) => ipcRenderer.invoke(channels.PRESETS_READ, { category, id }),
  savePreset: (request) => ipcRenderer.invoke(channels.PRESETS_SAVE, request),
  trashPreset: (category, id) => ipcRenderer.invoke(channels.PRESETS_TRASH, { category, id }),
  openPresetsFolder: () => ipcRenderer.invoke(channels.PRESETS_OPEN_FOLDER),
  onGenerationEvent: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on(channels.GENERATION_EVENT, handler);
    return () => ipcRenderer.removeListener(channels.GENERATION_EVENT, handler);
  },
  onQueueEvent: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on(channels.QUEUE_EVENT, handler);
    return () => ipcRenderer.removeListener(channels.QUEUE_EVENT, handler);
  },
  onSupportAssetEvent: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on(channels.SUPPORT_ASSETS_EVENT, handler);
    return () => ipcRenderer.removeListener(channels.SUPPORT_ASSETS_EVENT, handler);
  },
  onRuntimeEvent: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on(channels.RUNTIME_EVENT, handler);
    return () => ipcRenderer.removeListener(channels.RUNTIME_EVENT, handler);
  },
}));

if (!standaloneMode) {
  contextBridge.exposeInMainWorld("nainTailHost", Object.freeze({
    goHome: () => ipcRenderer.invoke(hostChannels.HOME),
    onHandoff: (listener) => {
      hostHandoffListener = listener;
      if (pendingHostHandoff) {
        const payload = pendingHostHandoff;
        pendingHostHandoff = null;
        Promise.resolve().then(() => {
          if (hostHandoffListener === listener) listener(payload);
        });
      }
      return () => {
        if (hostHandoffListener === listener) hostHandoffListener = null;
      };
    },
  }));
}

function installHostControls() {
  const brand = document.querySelector(".app-header .brand");
  if (!brand) return false;
  const title = brand.querySelector("strong");
  if (title) title.textContent = "AnimaTail";
  const subtitle = brand.querySelector("span");
  if (standaloneMode && subtitle) subtitle.textContent = "STANDALONE LOCAL STUDIO";
  if (standaloneMode || brand.querySelector("[data-host-home-button]")) return true;

  const style = document.createElement("style");
  style.textContent = `
    .animatail-host-home {
      display: flex; align-items: center; gap: 5px; min-height: 32px; margin-left: 3px;
      padding: 6px 9px; border: 1px solid var(--line); border-radius: 9px;
      background: rgba(255,255,255,.025); color: var(--text-secondary);
      font: inherit; font-size: var(--font-size-min); white-space: nowrap; cursor: pointer;
    }
    .animatail-host-home:hover { border-color: rgba(var(--accent-border-rgb),.42); color: var(--text-primary); background: rgba(var(--accent-bg-rgb),.08); }
    .animatail-host-home > b { color: var(--accent); font-size: var(--font-size-body); }
  `;
  document.head.append(style);

  const button = document.createElement("button");
  button.type = "button";
  button.id = "hostHomeButton";
  button.className = "animatail-host-home";
  button.dataset.hostHomeButton = "";
  button.setAttribute("aria-label", "NainTail 홈으로 돌아가기");
  const icon = document.createElement("b");
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "⌂";
  button.append(icon, document.createTextNode(" 홈"));
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await ipcRenderer.invoke(hostChannels.HOME);
    } finally {
      button.disabled = false;
    }
  });
  brand.append(button);
  return true;
}

window.addEventListener("DOMContentLoaded", () => {
  if (installHostControls()) return;
  const observer = new MutationObserver(() => {
    if (installHostControls()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
});
