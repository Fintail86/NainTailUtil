"use strict";

const fs = require("node:fs");
const path = require("node:path");
const channels = require("./channels.cjs");
const { CredentialService } = require("./credential-service.cjs");
const { AddonOutputSettings } = require("./output-settings.cjs");
const { NainTailApplication } = require("../app/core/application.cjs");
const { NainTailError, asPublicError } = require("../app/core/errors.cjs");

function reply(fn) {
  return async (_event, payload) => {
    try {
      return { ok: true, result: await fn(payload) };
    } catch (error) {
      return { ok: false, error: asPublicError(error) };
    }
  };
}

function activate(context) {
  const { dialog, ipcMain, safeStorage, shell } = context.services;
  const dataRoot = path.resolve(context.dataRoot || context.manifest.directory);
  const outputSettings = new AddonOutputSettings({
    addonRoot: dataRoot,
    standalone: context.standalone === true,
    hostedOutputRoot: context.outputRoot,
  });
  let outputRoot = outputSettings.outputRoot();
  const credentials = new CredentialService(dataRoot, safeStorage);
  const core = new NainTailApplication({
    productRoot: dataRoot,
    version: context.manifest.version,
    outputRoot,
    getToken: async () => credentials.getToken(),
  });

  async function pickReferenceImage() {
    const picked = await dialog.showOpenDialog(context.getWindow(), {
      title: "참조 이미지 선택",
      properties: ["openFile"],
      filters: [{ name: "Raster image", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return null;
    const filePath = picked.filePaths[0];
    const data = fs.readFileSync(filePath);
    if (!data.length || data.length > 20 * 1024 * 1024) throw new NainTailError("INVALID_REFERENCE_IMAGE", "이미지 참조 원본은 20MB 이하여야 합니다.");
    const png = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
    const webp = data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP";
    const mimeType = png ? "image/png" : jpeg ? "image/jpeg" : webp ? "image/webp" : null;
    if (!mimeType) throw new NainTailError("INVALID_REFERENCE_IMAGE", "PNG, JPEG 또는 WebP 이미지만 사용할 수 있습니다.");
    return { name: path.basename(filePath), mimeType, imageBase64: data.toString("base64") };
  }

  ipcMain.handle(channels.APP_INFO, reply(() => core.info()));
  ipcMain.handle(channels.APP_LIVE_STATUS, reply(() => core.liveStatus()));
  ipcMain.handle(channels.CREDENTIAL_STATUS, reply(() => credentials.status()));
  ipcMain.handle(channels.CREDENTIAL_SAVE, reply((payload) => credentials.saveToken(payload?.token)));
  ipcMain.handle(channels.CREDENTIAL_CLEAR, reply(() => credentials.clear()));
  ipcMain.handle(channels.SUBSCRIPTION_GET, reply(() => core.subscription()));
  ipcMain.handle(channels.PROJECT_LIST, reply(() => core.listProjects()));
  ipcMain.handle(channels.PROJECT_CREATE, reply((payload) => core.createProject(payload)));
  ipcMain.handle(channels.PROJECT_GET, reply((payload) => core.getProject(payload?.id)));
  ipcMain.handle(channels.PROJECT_SAVE, reply((payload) => core.saveProject(payload)));
  ipcMain.handle(channels.PROJECT_APPEND_PRESET, reply((payload) => core.appendPreset(payload?.projectId, payload?.presetId, payload?.target)));
  ipcMain.handle(channels.PRESET_LIST, reply(() => core.listPresets()));
  ipcMain.handle(channels.PRESET_GET, reply((payload) => core.getPreset(payload?.id)));
  ipcMain.handle(channels.PRESET_SAVE, reply((payload) => core.savePreset(payload)));
  ipcMain.handle(channels.PRESET_DELETE, reply((payload) => core.deletePreset(payload?.id)));
  ipcMain.handle(channels.GENERATION_ESTIMATE, reply((payload) => core.estimate(payload?.request || {}, payload?.options || {})));
  ipcMain.handle(channels.GENERATION_SINGLE, reply((payload) => core.enqueueSingle(payload)));
  ipcMain.handle(channels.GENERATION_MULTI, reply((payload) => core.enqueueMulti(payload)));
  ipcMain.handle(channels.GENERATION_ARTIST_STUDY, reply((payload) => core.enqueueArtistStudy(payload)));
  ipcMain.handle(channels.GENERATION_PROJECT, reply((payload) => core.enqueueProject(payload?.projectId, payload?.options || {})));
  ipcMain.handle(channels.ARTIST_STUDY_GET, reply(() => core.getArtistStudy()));
  ipcMain.handle(channels.ARTIST_STUDY_SAVE, reply((payload) => core.saveArtistStudy(payload)));
  ipcMain.handle(channels.ARTIST_STUDY_RANDOMIZE, reply((payload) => core.randomizeArtistStudy(payload)));
  ipcMain.handle(channels.ARTIST_STUDY_EXAMPLE_SAVE, reply((payload) => core.saveArtistStudyExample(payload?.study, payload?.name)));
  ipcMain.handle(channels.REFERENCE_IMAGE_PICK, reply(() => pickReferenceImage()));
  ipcMain.handle(channels.REFERENCE_IMAGE_SAVE, reply((payload) => core.saveReferenceImage(payload)));
  ipcMain.handle(channels.VIBE_IMAGE_SAVE, reply((payload) => core.saveVibeImage(payload)));
  ipcMain.handle(channels.VIBE_CACHE_STATUS, reply((payload) => core.vibeCacheStatus(payload)));
  ipcMain.handle(channels.QUEUE_STATE, reply(() => core.queue.snapshot()));
  ipcMain.handle(channels.QUEUE_CLEAR, reply(() => core.clearQueue()));
  ipcMain.handle(channels.QUEUE_STOP, reply(() => core.stopAfterCurrent()));
  ipcMain.handle(channels.QUEUE_RESUME, reply(() => core.resumeQueue()));
  ipcMain.handle(channels.OUTPUT_SETTINGS_GET, reply(() => outputSettings.status()));
  ipcMain.handle(channels.OUTPUT_SETTINGS_SELECT, reply(async () => {
    if (outputSettings.status().locked) throw new Error("Hosted 모드에서는 호스트 출력 폴더를 사용합니다.");
    const queue = core.queue.snapshot();
    if (queue.activeJobId || queue.jobs.some((job) => ["pending", "in_flight"].includes(job.state))) {
      throw new Error("출력 폴더는 생성 큐가 비어 있을 때 변경할 수 있습니다.");
    }
    const picked = await dialog.showOpenDialog(context.getWindow(), {
      title: "NaiTail 출력 폴더 선택",
      defaultPath: outputRoot,
      properties: ["openDirectory", "createDirectory"],
    });
    if (picked.canceled || !picked.filePaths[0]) return outputSettings.status();
    const status = outputSettings.setOutputRoot(picked.filePaths[0]);
    outputRoot = status.outputRoot;
    core.setOutputRoot(outputRoot);
    return status;
  }));
  ipcMain.handle(channels.OUTPUT_SETTINGS_RESET, reply(() => {
    const queue = core.queue.snapshot();
    if (queue.activeJobId || queue.jobs.some((job) => ["pending", "in_flight"].includes(job.state))) {
      throw new Error("출력 폴더는 생성 큐가 비어 있을 때 변경할 수 있습니다.");
    }
    const status = outputSettings.reset();
    outputRoot = status.outputRoot;
    core.setOutputRoot(outputRoot);
    return status;
  }));
  ipcMain.handle(channels.OUTPUTS_OPEN, reply(() => shell.openPath(outputRoot)));
  ipcMain.handle(channels.OUTPUT_REVEAL, reply((payload) => {
    shell.showItemInFolder(core.resolveOutputPath(payload?.relativePath));
    return { revealed: true };
  }));
  ipcMain.handle(channels.OUTPUT_TRASH, reply(async (payload) => {
    await shell.trashItem(core.resolveOutputPath(payload?.relativePath));
    return core.removeResultReference(payload?.projectId, payload?.id);
  }));

  core.on("queue", (event) => context.broadcast(channels.QUEUE_EVENT, event));
  core.on("result", (result) => context.broadcast(channels.RESULT_EVENT, result));

  return {
    id: context.manifest.id,
    async smokeCheck(webContents) {
      return webContents.executeJavaScript(
        `(async () => {
          const settingsTab = document.querySelector('[data-tab="settings"]');
          settingsTab?.click();
          await new Promise((resolve) => setTimeout(resolve, 80));
          const status = await window.nainTail?.getOutputSettings?.();
          return Boolean(window.nainTail
            && document.querySelector('#singleForm')
            && document.querySelector('#multiForm')
            && document.querySelector('#artistStudyForm')
            && document.querySelectorAll('[data-tab]').length === 6
            && status?.ok && status.result?.mode === 'hosted' && status.result?.locked === true
            && document.querySelector('#selectOutputFolder')?.disabled
            && document.querySelector('#resetOutputFolder')?.disabled
            && !document.querySelector('#notice.error'));
        })()`,
      );
    },
    close() {
      core.close();
      for (const channel of new Set(Object.values(channels))) ipcMain.removeHandler(channel);
    },
  };
}

module.exports = { activate };
