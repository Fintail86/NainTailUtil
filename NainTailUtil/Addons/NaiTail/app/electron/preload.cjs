"use strict";

const { contextBridge, ipcRenderer } = require("electron");
const standaloneMode = process.argv.includes("--addon-standalone");
// Sandboxed preload scripts cannot require arbitrary local modules. Keep this
// small allow-list duplicated here so the renderer never receives raw IPC.
const channels = Object.freeze({
  APP_INFO: "app:info",
  APP_LIVE_STATUS: "app:live-status",
  CREDENTIAL_STATUS: "credential:status",
  CREDENTIAL_SAVE: "credential:save",
  CREDENTIAL_CLEAR: "credential:clear",
  SUBSCRIPTION_GET: "subscription:get",
  PROJECT_LIST: "project:list",
  PROJECT_CREATE: "project:create",
  PROJECT_GET: "project:get",
  PROJECT_SAVE: "project:save",
  PROJECT_APPEND_PRESET: "project:append-preset",
  PRESET_LIST: "preset:list",
  PRESET_GET: "preset:get",
  PRESET_SAVE: "preset:save",
  PRESET_DELETE: "preset:delete",
  GENERATION_ESTIMATE: "generation:estimate",
  GENERATION_SINGLE: "generation:single",
  GENERATION_MULTI: "generation:multi",
  GENERATION_ARTIST_STUDY: "generation:artist-study",
  GENERATION_PROJECT: "generation:project",
  ARTIST_STUDY_GET: "artist-study:get",
  ARTIST_STUDY_SAVE: "artist-study:save",
  ARTIST_STUDY_RANDOMIZE: "artist-study:randomize",
  ARTIST_STUDY_EXAMPLE_SAVE: "artist-study:example-save",
  REFERENCE_IMAGE_PICK: "reference-image:pick",
  REFERENCE_IMAGE_SAVE: "reference-image:save",
  VIBE_IMAGE_SAVE: "vibe-image:save",
  VIBE_CACHE_STATUS: "vibe:cache-status",
  QUEUE_STATE: "queue:state",
  QUEUE_CLEAR: "queue:clear",
  QUEUE_STOP: "queue:stop",
  QUEUE_RESUME: "queue:resume",
  OUTPUTS_OPEN: "outputs:open",
  OUTPUT_REVEAL: "output:reveal",
  OUTPUT_TRASH: "output:trash",
  QUEUE_EVENT: "queue:event",
  RESULT_EVENT: "result:event",
});

const hostChannels = Object.freeze({
  HOME: "host:navigate-home",
});

function invoke(channel, payload) {
  return ipcRenderer.invoke(channel, payload);
}

contextBridge.exposeInMainWorld("nainTail", Object.freeze({
  getInfo: () => invoke(channels.APP_INFO),
  getLiveStatus: () => invoke(channels.APP_LIVE_STATUS),
  getCredentialStatus: () => invoke(channels.CREDENTIAL_STATUS),
  saveCredential: (token) => invoke(channels.CREDENTIAL_SAVE, { token }),
  clearCredential: () => invoke(channels.CREDENTIAL_CLEAR),
  getSubscription: () => invoke(channels.SUBSCRIPTION_GET),
  listProjects: () => invoke(channels.PROJECT_LIST),
  createProject: (input) => invoke(channels.PROJECT_CREATE, input),
  getProject: (id) => invoke(channels.PROJECT_GET, { id }),
  saveProject: (project) => invoke(channels.PROJECT_SAVE, project),
  appendPreset: (projectId, presetId, target) => invoke(channels.PROJECT_APPEND_PRESET, { projectId, presetId, target }),
  listPresets: () => invoke(channels.PRESET_LIST),
  getPreset: (id) => invoke(channels.PRESET_GET, { id }),
  savePreset: (preset) => invoke(channels.PRESET_SAVE, preset),
  deletePreset: (id) => invoke(channels.PRESET_DELETE, { id }),
  estimateGeneration: (request, options) => invoke(channels.GENERATION_ESTIMATE, { request, options }),
  generateSingle: (request) => invoke(channels.GENERATION_SINGLE, request),
  generateMulti: (request) => invoke(channels.GENERATION_MULTI, request),
  generateArtistStudy: (request) => invoke(channels.GENERATION_ARTIST_STUDY, request),
  generateProject: (projectId, options) => invoke(channels.GENERATION_PROJECT, { projectId, options }),
  getArtistStudy: () => invoke(channels.ARTIST_STUDY_GET),
  saveArtistStudy: (study) => invoke(channels.ARTIST_STUDY_SAVE, study),
  randomizeArtistStudy: (study) => invoke(channels.ARTIST_STUDY_RANDOMIZE, study),
  saveArtistStudyExample: (study, name) => invoke(channels.ARTIST_STUDY_EXAMPLE_SAVE, { study, name }),
  pickReferenceImage: () => invoke(channels.REFERENCE_IMAGE_PICK),
  saveReferenceImage: (image) => invoke(channels.REFERENCE_IMAGE_SAVE, image),
  saveVibeImage: (image) => invoke(channels.VIBE_IMAGE_SAVE, image),
  getVibeCacheStatus: (vibes, model) => invoke(channels.VIBE_CACHE_STATUS, { vibes, model }),
  getQueue: () => invoke(channels.QUEUE_STATE),
  clearQueue: () => invoke(channels.QUEUE_CLEAR),
  stopAfterCurrent: () => invoke(channels.QUEUE_STOP),
  resumeQueue: () => invoke(channels.QUEUE_RESUME),
  openOutputs: () => invoke(channels.OUTPUTS_OPEN),
  revealOutput: (result) => invoke(channels.OUTPUT_REVEAL, result),
  trashOutput: (result) => invoke(channels.OUTPUT_TRASH, result),
  onQueue: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on(channels.QUEUE_EVENT, handler);
    return () => ipcRenderer.removeListener(channels.QUEUE_EVENT, handler);
  },
  onResult: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on(channels.RESULT_EVENT, handler);
    return () => ipcRenderer.removeListener(channels.RESULT_EVENT, handler);
  },
}));

if (!standaloneMode) {
  contextBridge.exposeInMainWorld("nainTailHost", Object.freeze({
    goHome: () => invoke(hostChannels.HOME),
  }));
} else {
  window.addEventListener("DOMContentLoaded", () => {
    const homeButton = document.querySelector("#hostHomeButton");
    if (homeButton) homeButton.hidden = true;
    const subtitle = document.querySelector(".brand-copy small");
    if (subtitle) subtitle.textContent = "NaiTail · Standalone portable utility";
  });
}
