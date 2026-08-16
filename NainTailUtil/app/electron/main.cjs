"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain, protocol, safeStorage, shell } = require("electron");
const { AddonRegistry } = require("../host/addon-registry.cjs");
const { HostOutputSettings } = require("../host/output-settings.cjs");
const { hostedRuntimeDependencies } = require("../host/runtime-dependencies.cjs");

const HOST_ADDON_LIST = "host:addons:list";
const HOST_ADDON_OPEN = "host:addons:open";
const HOST_HOME = "host:navigate-home";
const HOST_ADDON_HANDOFF = "host:addons:handoff";
const HOST_OUTPUT_GET = "host:outputs:get";
const HOST_OUTPUT_SELECT = "host:outputs:select";
const HOST_OUTPUT_RESET = "host:outputs:reset";
const HOST_OUTPUT_OPEN = "host:outputs:open";
const productRoot = path.resolve(__dirname, "..", "..");
const hostRenderer = path.join(productRoot, "app", "renderer", "index.html");
const hostPreload = path.join(productRoot, "app", "electron", "preload.cjs");
const smokeMode = process.argv.includes("--smoke");
const smokeAddonId = process.argv.find((value) => value.startsWith("--smoke-addon="))?.slice("--smoke-addon=".length) || "";
const smokeResultPath = process.argv.find((value) => value.startsWith("--smoke-result="))?.slice("--smoke-result=".length) || "";
const smokeCaptureDirectory = process.argv.find((value) => value.startsWith("--smoke-capture-dir="))?.slice("--smoke-capture-dir=".length) || "";
if (smokeMode) app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "naintail-addon-smoke-")));
const registry = new AddonRegistry(productRoot);
const outputSettings = new HostOutputSettings(productRoot);
registry.discover();
const addonProtocols = registry.protocols();
if (addonProtocols.length) protocol.registerSchemesAsPrivileged(addonProtocols);

let homeWindow = null;
let addonWindow = null;
let foregroundWindow = null;
let activeAddon = null;
let isQuitting = false;
let smokeTimer = null;

function writeSmokeResult(result) {
  if (!smokeResultPath) return;
  try {
    fs.writeFileSync(smokeResultPath, JSON.stringify(result), "utf8");
  } catch {
    // The smoke run still reports through stderr/exit code when its optional marker cannot be written.
  }
}

function publicError(error) {
  return { code: "HOST_ADDON_ERROR", message: error instanceof Error ? error.message : String(error) };
}

function reply(fn) {
  return async (event, payload) => {
    try {
      return { ok: true, result: await fn(event, payload) };
    } catch (error) {
      return { ok: false, error: publicError(error) };
    }
  };
}

function addonBroadcast(channel, payload) {
  if (addonWindow && !addonWindow.isDestroyed()) addonWindow.webContents.send(channel, payload);
}

function closeActiveAddon() {
  activeAddon?.runtime?.close?.();
  activeAddon = null;
  if (addonWindow && !addonWindow.isDestroyed()) addonWindow.destroy();
  addonWindow = null;
}

function activateAddon(manifest) {
  if (activeAddon?.manifest.id === manifest.id) return activeAddon;
  closeActiveAddon();

  const module = registry.load(manifest, "electron");
  if (!module || typeof module.activate !== "function") throw new Error(`Electron activate entry가 없습니다: ${manifest.id}`);
  const outputRoot = outputSettings.resolveAddonOutputRoot(manifest.id);
  const runtime = module.activate({
    hostRoot: productRoot,
    productRoot: manifest.directory,
    dataRoot: manifest.directory,
    outputRoot,
    manifest,
    dependencies: hostedRuntimeDependencies(productRoot, manifest),
    getWindow: () => addonWindow || foregroundWindow,
    broadcast: addonBroadcast,
    services: {
      dialog,
      ipcMain,
      safeStorage,
      shell,
      resolveAddonDirectory: (id) => registry.get(id)?.directory || null,
      resolveAddonOutputRoot: (id) => outputSettings.resolveAddonOutputRoot(id),
    },
  });
  activeAddon = { manifest, runtime };
  return activeAddon;
}

function currentBounds() {
  const source = foregroundWindow && !foregroundWindow.isDestroyed() ? foregroundWindow : null;
  return source ? source.getBounds() : { width: 1480, height: 940 };
}

function windowOptions(preload, manifest = null) {
  const bounds = currentBounds();
  return {
    ...bounds,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#0c0e12",
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: manifest?.window?.backgroundThrottling !== false,
    },
  };
}

function manageWindow(window) {
  window.removeMenu();
  window.on("close", () => {
    if (!isQuitting) {
      isQuitting = true;
      app.quit();
    }
  });
  return window;
}

function showWindow(window, previous) {
  if (!window || window.isDestroyed()) return;
  if (previous && !previous.isDestroyed() && previous !== window) {
    const bounds = previous.getBounds();
    const maximized = previous.isMaximized();
    previous.hide();
    window.setBounds(bounds);
    if (maximized) window.maximize();
    else if (window.isMaximized()) window.unmaximize();
  }
  foregroundWindow = window;
  if (!smokeMode) {
    window.show();
    window.focus();
  }
}

async function ensureHomeWindow() {
  if (homeWindow && !homeWindow.isDestroyed()) return homeWindow;
  homeWindow = manageWindow(new BrowserWindow(windowOptions(hostPreload)));
  homeWindow.on("closed", () => {
    if (foregroundWindow === homeWindow) foregroundWindow = null;
    homeWindow = null;
  });
  await homeWindow.loadFile(hostRenderer);
  return homeWindow;
}

async function ensureAddonWindow(manifest) {
  if (addonWindow && !addonWindow.isDestroyed() && activeAddon?.manifest.id === manifest.id) return addonWindow;
  const preload = registry.resolveEntry(manifest, "preload");
  const renderer = registry.resolveEntry(manifest, "renderer");
  addonWindow = manageWindow(new BrowserWindow(windowOptions(preload, manifest)));
  addonWindow.on("closed", () => {
    if (foregroundWindow === addonWindow) foregroundWindow = null;
    addonWindow = null;
  });
  await addonWindow.loadFile(renderer);
  return addonWindow;
}

async function openHome() {
  const previous = foregroundWindow;
  const window = await ensureHomeWindow();
  showWindow(window, previous);
  return { view: "home" };
}

async function openAddon(id, handoff = null) {
  const manifest = registry.get(id);
  if (!manifest) throw new Error(`애드온을 찾을 수 없습니다: ${id}`);
  const missing = registry.missingRequirements(manifest);
  if (missing.length) throw new Error(`필수 애드온이 없습니다: ${missing.join(", ")}`);
  const previous = foregroundWindow;
  activateAddon(manifest);
  const window = await ensureAddonWindow(manifest);
  showWindow(window, previous);
  if (handoff && typeof handoff === "object") window.webContents.send(HOST_ADDON_HANDOFF, handoff);
  return { view: "addon", id: manifest.id, name: manifest.name };
}

function registerHostIpc() {
  ipcMain.handle(HOST_ADDON_LIST, reply(() => {
    registry.discover();
    return registry.list();
  }));
  ipcMain.handle(HOST_ADDON_OPEN, reply((_event, payload) => (
    openAddon(String(payload?.id || ""), payload?.handoff || null)
  )));
  ipcMain.handle(HOST_HOME, reply(() => openHome()));
  ipcMain.handle(HOST_OUTPUT_GET, reply(() => outputSettings.status()));
  ipcMain.handle(HOST_OUTPUT_SELECT, reply(() => {
    const selected = dialog.showOpenDialogSync(homeWindow || foregroundWindow, {
      title: "NainTail 출력 폴더 선택",
      defaultPath: outputSettings.outputRoot(),
      properties: ["openDirectory", "createDirectory"],
    });
    if (!selected?.[0]) return outputSettings.status();
    const status = outputSettings.setOutputRoot(selected[0]);
    closeActiveAddon();
    return status;
  }));
  ipcMain.handle(HOST_OUTPUT_RESET, reply(() => {
    const status = outputSettings.reset();
    closeActiveAddon();
    return status;
  }));
  ipcMain.handle(HOST_OUTPUT_OPEN, reply(async () => {
    const outputRoot = outputSettings.outputRoot();
    const error = await shell.openPath(outputRoot);
    if (error) throw new Error(error);
    return outputSettings.status();
  }));
}

async function runAddonRoundTrip(manifest) {
  await homeWindow.webContents.executeJavaScript(`document.querySelector('[data-addon-id="${manifest.id}"]').click()`);
  for (let attempt = 0; foregroundWindow !== addonWindow && attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (foregroundWindow !== addonWindow) throw new Error(`host addon card navigation failed: ${manifest.id}`);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const ready = activeAddon.runtime?.smokeCheck
    ? await activeAddon.runtime.smokeCheck(addonWindow.webContents)
    : false;
  if (!ready) throw new Error(`addon renderer contract missing: ${manifest.id}`);
  if (smokeCaptureDirectory) {
    fs.mkdirSync(smokeCaptureDirectory, { recursive: true });
    const capture = await addonWindow.webContents.capturePage();
    fs.writeFileSync(path.join(smokeCaptureDirectory, `gui-addon-${manifest.id}.png`), capture.toPNG());
  }
  await addonWindow.webContents.executeJavaScript("window.__nainTailRoundTrip = 'preserved'; document.querySelector('#hostHomeButton').click()");
  await new Promise((resolve) => setTimeout(resolve, 150));
  if (foregroundWindow !== homeWindow) throw new Error(`addon home navigation failed: ${manifest.id}`);
  const cardEnabled = await homeWindow.webContents.executeJavaScript(`document.querySelector('[data-addon-id="${manifest.id}"]')?.disabled === false`);
  if (!cardEnabled) throw new Error(`host addon card stayed disabled after returning home: ${manifest.id}`);
  await homeWindow.webContents.executeJavaScript(`document.querySelector('[data-addon-id="${manifest.id}"]').click()`);
  for (let attempt = 0; foregroundWindow !== addonWindow && attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (foregroundWindow !== addonWindow) throw new Error(`host addon card re-entry failed: ${manifest.id}`);
  const preserved = await addonWindow.webContents.executeJavaScript("window.__nainTailRoundTrip === 'preserved'");
  if (!preserved) throw new Error(`addon renderer state was not preserved across home navigation: ${manifest.id}`);
  const homeButtonEnabled = await addonWindow.webContents.executeJavaScript("document.querySelector('#hostHomeButton')?.disabled === false");
  if (!homeButtonEnabled) throw new Error(`addon home button stayed disabled after re-entry: ${manifest.id}`);
  await addonWindow.webContents.executeJavaScript("document.querySelector('#hostHomeButton').click()");
  for (let attempt = 0; foregroundWindow !== homeWindow && attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (foregroundWindow !== homeWindow) throw new Error(`addon repeated home navigation failed: ${manifest.id}`);
}

async function runSmoke() {
  const manifests = smokeAddonId === "all"
    ? registry.list().map((item) => registry.get(item.id))
    : [smokeAddonId ? registry.get(smokeAddonId) : registry.getDefault()].filter(Boolean);
  if (smokeAddonId && smokeAddonId !== "all" && !manifests.length) {
    throw new Error(`smoke 애드온을 찾을 수 없습니다: ${smokeAddonId}`);
  }
  const host = await ensureHomeWindow();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const expectedSlotCount = Math.max(3, registry.list().length);
  const hostReady = await host.webContents.executeJavaScript(
    `Boolean(document.querySelector('[data-host-home]')
      && document.querySelectorAll('[data-addon-slot]').length === ${expectedSlotCount}
      && ${manifests.map((manifest) => `document.querySelector('[data-addon-id="${manifest.id}"]')`).join(" && ") || "true"})`,
  );
  if (!hostReady) throw new Error("host renderer contract missing");
  for (const manifest of manifests) await runAddonRoundTrip(manifest);
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
else {
  app.on("second-instance", () => {
    if (!foregroundWindow || foregroundWindow.isDestroyed()) return;
    if (foregroundWindow.isMinimized()) foregroundWindow.restore();
    foregroundWindow.show();
    foregroundWindow.focus();
  });
  app.whenReady().then(async () => {
    try {
      registry.discover();
      registerHostIpc();
      if (smokeMode) {
        smokeTimer = setTimeout(() => {
          writeSmokeResult({ ok: false, error: "timeout" });
          process.exitCode = 1;
          app.quit();
        }, 15000);
        await runSmoke();
        clearTimeout(smokeTimer);
        smokeTimer = null;
        writeSmokeResult({ ok: true, addons: registry.list().map((item) => item.id) });
        app.quit();
      } else {
        await openHome();
      }
    } catch (error) {
      writeSmokeResult({ ok: false, error: error.message });
      process.stderr.write(`[NainTail host] ${error.stack || error.message}\n`);
      process.exitCode = 1;
      app.quit();
    }
  });
  app.on("before-quit", () => {
    isQuitting = true;
    if (smokeTimer) clearTimeout(smokeTimer);
    closeActiveAddon();
  });
  app.on("window-all-closed", () => app.quit());
}
