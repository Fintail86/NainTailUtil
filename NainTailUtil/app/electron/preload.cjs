"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const channels = Object.freeze({
  ADDON_LIST: "host:addons:list",
  ADDON_OPEN: "host:addons:open",
  HOME: "host:navigate-home",
  HANDOFF: "host:addons:handoff",
});

contextBridge.exposeInMainWorld("nainTailHost", Object.freeze({
  listAddons: () => ipcRenderer.invoke(channels.ADDON_LIST),
  openAddon: (id, handoff = null) => ipcRenderer.invoke(channels.ADDON_OPEN, { id, handoff }),
  goHome: () => ipcRenderer.invoke(channels.HOME),
  onHandoff: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on(channels.HANDOFF, handler);
    return () => ipcRenderer.removeListener(channels.HANDOFF, handler);
  },
}));
