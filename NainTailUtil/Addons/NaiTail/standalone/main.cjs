"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  safeStorage,
  shell,
} = require("electron");

const addonRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(addonRoot, "addon.json");
const rawManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const manifest = Object.freeze({ ...rawManifest, directory: addonRoot, manifestPath });
const smokeMode = process.argv.includes("--smoke");
const smokeResultPath = process.argv.find((value) => value.startsWith("--smoke-result="))
  ?.slice("--smoke-result=".length) || "";
const profileRoot = smokeMode
  ? fs.mkdtempSync(path.join(os.tmpdir(), `${manifest.id}-standalone-smoke-`))
  : path.join(addonRoot, "config", "electron-profile");

fs.mkdirSync(profileRoot, { recursive: true });
app.setPath("userData", profileRoot);

const protocolEntries = Array.isArray(manifest.protocols) ? manifest.protocols : [];
if (protocolEntries.length) {
  protocol.registerSchemesAsPrivileged(protocolEntries.map((entry) => ({
    scheme: String(entry.scheme),
    privileges: { ...(entry.privileges || {}) },
  })));
}

let mainWindow = null;
let addonRuntime = null;
let quitting = false;

function inside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveEntry(kind) {
  const relativePath = manifest.entries?.[kind];
  if (!relativePath) throw new Error(`${kind} entry가 없습니다.`);
  const resolved = path.resolve(addonRoot, relativePath);
  if (!inside(addonRoot, resolved) || !fs.existsSync(resolved)) {
    throw new Error(`애드온 경계를 벗어나거나 존재하지 않는 entry입니다: ${kind}`);
  }
  return resolved;
}

function writeSmokeResult(result) {
  if (!smokeResultPath) return;
  try {
    fs.writeFileSync(smokeResultPath, JSON.stringify(result), "utf8");
  } catch {}
}

function broadcast(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function activateAddon() {
  const electronEntry = require(resolveEntry("electron"));
  if (!electronEntry || typeof electronEntry.activate !== "function") {
    throw new Error("standalone Electron activate entry가 없습니다.");
  }
  addonRuntime = electronEntry.activate({
    hostRoot: null,
    productRoot: addonRoot,
    dataRoot: addonRoot,
    outputRoot: path.join(addonRoot, "outputs"),
    manifest,
    standalone: true,
    getWindow: () => mainWindow,
    broadcast,
    services: {
      dialog,
      ipcMain,
      safeStorage,
      shell,
      resolveAddonDirectory: (id) => String(id) === manifest.id ? addonRoot : null,
    },
  });
}

async function createWindow() {
  activateAddon();
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    backgroundColor: "#0c0e12",
    webPreferences: {
      preload: resolveEntry("preload"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: manifest.window?.backgroundThrottling !== false,
      additionalArguments: ["--addon-standalone"],
    },
  });
  mainWindow.removeMenu();
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  await mainWindow.loadFile(resolveEntry("renderer"));

  if (smokeMode) {
    const apiGlobal = manifest.id === "animatail" ? "animaUtil" : "nainTail";
    const state = await mainWindow.webContents.executeJavaScript(
      `(() => {
        const home = document.querySelector('#hostHomeButton');
        return {
          ready: Boolean(window[${JSON.stringify(apiGlobal)}] && document.querySelector('.app-shell, .shell')),
          hostHomeVisible: Boolean(home && !home.hidden && home.getClientRects().length),
        };
      })()`,
    );
    if (!state.ready || state.hostHomeVisible) throw new Error("standalone renderer contract가 준비되지 않았습니다.");
    writeSmokeResult({ ok: true, addon: manifest.id, root: path.basename(addonRoot), hostHomeVisible: false });
    app.quit();
    return;
  }
  mainWindow.show();
  mainWindow.focus();
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(createWindow).catch((error) => {
    writeSmokeResult({ ok: false, addon: manifest.id, error: error.message });
    process.stderr.write(`[${manifest.name} standalone] ${error.stack || error.message}\n`);
    if (!smokeMode) dialog.showErrorBox(`${manifest.name} 실행 오류`, error.message);
    process.exitCode = 1;
    app.quit();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    if (quitting) return;
    quitting = true;
    addonRuntime?.close?.();
  });
}
