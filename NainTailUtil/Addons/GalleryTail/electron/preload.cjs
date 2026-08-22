"use strict";

const { contextBridge, ipcRenderer } = require("electron");
const channels = Object.freeze({
  LIST: "gallerytail:list",
  REVEAL: "gallerytail:reveal",
  TRASH: "gallerytail:trash",
  OPEN_FOLDER: "gallerytail:open-folder",
  OPEN_WORKSPACE_FOLDER: "gallerytail:open-workspace-folder",
  SOURCES_GET: "gallerytail:sources-get",
  SOURCE_SELECT: "gallerytail:source-select",
  OUTPUT_SETTINGS_GET: "gallerytail:output-settings-get",
  OUTPUT_SETTINGS_SELECT: "gallerytail:output-settings-select",
  OUTPUT_SETTINGS_RESET: "gallerytail:output-settings-reset",
  HOME: "host:navigate-home",
  ADDON_OPEN: "host:addons:open",
});

contextBridge.exposeInMainWorld("galleryTail", Object.freeze({
  list: (directory = "") => ipcRenderer.invoke(channels.LIST, directory),
  reveal: (id) => ipcRenderer.invoke(channels.REVEAL, id),
  trash: (id) => ipcRenderer.invoke(channels.TRASH, id),
  openFolder: () => ipcRenderer.invoke(channels.OPEN_FOLDER),
  openWorkspaceFolder: () => ipcRenderer.invoke(channels.OPEN_WORKSPACE_FOLDER),
  getSources: () => ipcRenderer.invoke(channels.SOURCES_GET),
  selectSource: (sourceId) => ipcRenderer.invoke(channels.SOURCE_SELECT, sourceId),
  getOutputSettings: () => ipcRenderer.invoke(channels.OUTPUT_SETTINGS_GET),
  selectOutputFolder: () => ipcRenderer.invoke(channels.OUTPUT_SETTINGS_SELECT),
  resetOutputFolder: () => ipcRenderer.invoke(channels.OUTPUT_SETTINGS_RESET),
}));

contextBridge.exposeInMainWorld("nainTailHost", Object.freeze({
  goHome: () => ipcRenderer.invoke(channels.HOME),
  openAddon: (id, handoff = null) => ipcRenderer.invoke(channels.ADDON_OPEN, { id, handoff }),
}));
