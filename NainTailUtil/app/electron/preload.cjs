"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const channels = Object.freeze({
  ADDON_LIST: "host:addons:list",
  ADDON_OPEN: "host:addons:open",
  ADDON_CATALOG: "host:addons:catalog",
  ADDON_INSTALL: "host:addons:install",
  RESTART: "host:restart",
  HOME: "host:navigate-home",
  HANDOFF: "host:addons:handoff",
  OUTPUT_GET: "host:outputs:get",
  OUTPUT_SELECT: "host:outputs:select",
  OUTPUT_RESET: "host:outputs:reset",
  OUTPUT_OPEN: "host:outputs:open",
});

contextBridge.exposeInMainWorld("nainTailHost", Object.freeze({
  listAddons: () => ipcRenderer.invoke(channels.ADDON_LIST),
  openAddon: (id, handoff = null) => ipcRenderer.invoke(channels.ADDON_OPEN, { id, handoff }),
  listOfficialAddons: () => ipcRenderer.invoke(channels.ADDON_CATALOG),
  installOfficialAddon: (id) => ipcRenderer.invoke(channels.ADDON_INSTALL, { id }),
  restartHost: () => ipcRenderer.invoke(channels.RESTART),
  goHome: () => ipcRenderer.invoke(channels.HOME),
  getOutputSettings: () => ipcRenderer.invoke(channels.OUTPUT_GET),
  selectOutputFolder: () => ipcRenderer.invoke(channels.OUTPUT_SELECT),
  resetOutputFolder: () => ipcRenderer.invoke(channels.OUTPUT_RESET),
  openOutputFolder: () => ipcRenderer.invoke(channels.OUTPUT_OPEN),
  onHandoff: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on(channels.HANDOFF, handler);
    return () => ipcRenderer.removeListener(channels.HANDOFF, handler);
  },
}));
