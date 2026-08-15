"use strict";

const { contextBridge, ipcRenderer } = require("electron");
const channels = Object.freeze({
  LIST: "gallerytail:list",
  REVEAL: "gallerytail:reveal",
  TRASH: "gallerytail:trash",
  OPEN_FOLDER: "gallerytail:open-folder",
  HOME: "host:navigate-home",
  ADDON_OPEN: "host:addons:open",
});

contextBridge.exposeInMainWorld("galleryTail", Object.freeze({
  list: (directory = "") => ipcRenderer.invoke(channels.LIST, directory),
  reveal: (id) => ipcRenderer.invoke(channels.REVEAL, id),
  trash: (id) => ipcRenderer.invoke(channels.TRASH, id),
  openFolder: () => ipcRenderer.invoke(channels.OPEN_FOLDER),
}));

contextBridge.exposeInMainWorld("nainTailHost", Object.freeze({
  goHome: () => ipcRenderer.invoke(channels.HOME),
  openAddon: (id, handoff = null) => ipcRenderer.invoke(channels.ADDON_OPEN, { id, handoff }),
}));
