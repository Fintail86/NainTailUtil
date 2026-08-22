"use strict";

const host = window.nainTailHost;
const track = document.querySelector("#deckTrack");
const viewport = document.querySelector("#deckViewport");
const indexLabel = document.querySelector("#deckIndex");
const previous = document.querySelector("#previousAddon");
const next = document.querySelector("#nextAddon");
const notice = document.querySelector("#hostNotice");
const settingsDialog = document.querySelector("#settingsDialog");
const veil = document.querySelector("#launchVeil");
const veilMark = document.querySelector("#veilMark");
const veilTitle = document.querySelector("#veilTitle");
const outputMode = document.querySelector("#outputMode");
const outputPath = document.querySelector("#outputPath");
const openOutputFolder = document.querySelector("#openOutputFolder");
const selectOutputFolder = document.querySelector("#selectOutputFolder");
const resetOutputFolder = document.querySelector("#resetOutputFolder");
const deckFooter = document.querySelector(".deck-footer");
const installerDialog = document.querySelector("#installerDialog");
const emptyAddonInstall = document.querySelector("#emptyAddonInstall");
const openAddonInstaller = document.querySelector("#openAddonInstaller");
const installerLoading = document.querySelector("#installerLoading");
const officialAddonList = document.querySelector("#officialAddonList");
const openSettings = document.querySelector("#openSettings");
const hostUpdateIndicator = document.querySelector("#hostUpdateIndicator");
const hostUpdateMode = document.querySelector("#hostUpdateMode");
const hostUpdateCopy = document.querySelector("#hostUpdateCopy");
const hostCurrentVersion = document.querySelector("#hostCurrentVersion");
const hostAvailableVersion = document.querySelector("#hostAvailableVersion");
const hostUpdateWarning = document.querySelector("#hostUpdateWarning");
const checkHostUpdate = document.querySelector("#checkHostUpdate");
const applyHostUpdate = document.querySelector("#applyHostUpdate");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const addonRoles = Object.freeze({
  naitail: "NOVELAI ADD-ON",
  animatail: "LOCAL STUDIO",
  gallerytail: "OUTPUT BROWSER",
  censortail: "LOCAL CENSOR",
});

let addons = [];
let selected = 0;
let refreshing = false;
let scrollFrame = 0;
let noticeTimer = 0;
let wheelAccumulator = 0;
let wheelResetTimer = 0;
let wheelLocked = false;
let installerBusy = false;
let installerRestartPending = false;
let hostUpdateBusy = false;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function splitWordmark(name) {
  const match = String(name).match(/^(.*?)(Tail)$/u);
  return match && match[1] ? [match[1], match[2]] : [String(name)];
}

function stateShape(state) {
  const shape = el("span", `state-shape state-${state}`);
  shape.setAttribute("aria-hidden", "true");
  return shape;
}

function addonViewModel(addon, index, installedIds) {
  const missing = (addon.requires || []).filter((id) => !installedIds.has(id));
  return {
    ...addon,
    initial: String(addon.name || addon.id || "?").slice(0, 1).toUpperCase(),
    words: splitWordmark(addon.name || addon.id),
    role: addonRoles[addon.id] || "PORTABLE ADD-ON",
    state: missing.length ? "warning" : "ready",
    status: missing.length ? `필수 애드온 없음 · ${missing.join(", ")}` : "실행 가능",
    meta: `${addon.builtIn ? "내장 애드온" : "연결 애드온"} · v${addon.version}`,
    theme: `theme-${index % 6}`,
  };
}

function showNotice(message, error = false) {
  clearTimeout(noticeTimer);
  notice.textContent = message || "";
  notice.classList.toggle("error", error);
  notice.classList.toggle("show", Boolean(message));
  if (message) noticeTimer = setTimeout(() => notice.classList.remove("show"), 2600);
}

function renderOutputSettings(settings) {
  outputMode.textContent = settings.mode === "custom" ? "사용자 지정" : "기본 위치";
  outputPath.textContent = settings.outputRoot;
  outputPath.title = settings.outputRoot;
  resetOutputFolder.disabled = settings.mode !== "custom";
}

async function refreshOutputSettings() {
  if (!host?.getOutputSettings) return;
  const response = await host.getOutputSettings();
  if (!response?.ok) throw new Error(response?.error?.message || "출력 폴더 설정을 읽지 못했다.");
  renderOutputSettings(response.result);
}

async function runOutputAction(action, successMessage) {
  for (const button of [openOutputFolder, selectOutputFolder, resetOutputFolder]) button.disabled = true;
  try {
    const response = await action();
    if (!response?.ok) throw new Error(response?.error?.message || "출력 폴더를 처리하지 못했다.");
    renderOutputSettings(response.result);
    showNotice(successMessage);
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    openOutputFolder.disabled = false;
    selectOutputFolder.disabled = false;
    resetOutputFolder.disabled = outputMode.textContent !== "사용자 지정";
  }
}

function renderHostUpdate(status) {
  const labels = {
    update: "업데이트 가능",
    current: "최신 버전",
    "local-newer": "로컬 최신",
    unavailable: "확인 불가",
    unknown: "확인 필요",
  };
  hostUpdateMode.textContent = labels[status.state] || "확인 필요";
  hostCurrentVersion.textContent = status.currentVersion ? `v${status.currentVersion}` : "—";
  hostAvailableVersion.textContent = status.availableVersion ? `v${status.availableVersion}` : "—";
  hostUpdateIndicator.hidden = status.state !== "update";
  openSettings.classList.toggle("update-available", status.state === "update");
  hostUpdateWarning.hidden = !status.warning;
  hostUpdateWarning.textContent = status.warning || "";
  applyHostUpdate.disabled = status.state !== "update" || hostUpdateBusy;
  applyHostUpdate.textContent = status.state === "update"
    ? `v${status.availableVersion} 업데이트`
    : status.state === "current" ? "최신 버전" : "업데이트 없음";
  hostUpdateCopy.textContent = status.state === "update"
    ? `${status.sizeLabel || "업데이트 파일"}을 내려받아 검증한 뒤 호스트를 재시작한다.`
    : "공식 릴리즈에서 NainTail 호스트의 새 버전을 확인한다.";
}

async function refreshHostUpdate(force = true) {
  if (!host?.getHostUpdateStatus) return;
  checkHostUpdate.disabled = true;
  try {
    const response = await host.getHostUpdateStatus(force);
    if (!response?.ok) throw new Error(response?.error?.message || "호스트 업데이트를 확인하지 못했다.");
    renderHostUpdate(response.result);
  } catch (error) {
    renderHostUpdate({ state: "unavailable", currentVersion: null, availableVersion: null, warning: error.message });
  } finally {
    checkHostUpdate.disabled = false;
  }
}

async function startHostUpdate() {
  if (hostUpdateBusy || !host?.applyHostUpdate) return;
  let applying = false;
  hostUpdateBusy = true;
  checkHostUpdate.disabled = true;
  applyHostUpdate.disabled = true;
  applyHostUpdate.textContent = "다운로드 및 검증 중…";
  try {
    const response = await host.applyHostUpdate();
    if (!response?.ok) throw new Error(response?.error?.message || "호스트 업데이트를 준비하지 못했다.");
    if (response.result?.cancelled) {
      renderHostUpdate(response.result);
      return;
    }
    if (response.result?.alreadyCurrent) {
      renderHostUpdate(response.result);
      showNotice("NainTail 호스트가 이미 최신 버전이다.");
      return;
    }
    hostUpdateMode.textContent = "적용 중";
    hostUpdateCopy.textContent = "NainTail을 종료하고 업데이트를 적용한 뒤 다시 실행한다.";
    applyHostUpdate.textContent = "재시작 준비 중…";
    applying = true;
  } catch (error) {
    showNotice(error.message, true);
    await refreshHostUpdate(false);
  } finally {
    hostUpdateBusy = false;
    if (!applying) await refreshHostUpdate(false);
  }
}

function addonPanels() {
  return Array.from(track.querySelectorAll(".addon-panel"));
}

function focusItems() {
  return addonPanels();
}

function resolvedDeckWidth(property) {
  const probe = el("span");
  probe.style.cssText = `position:fixed;visibility:hidden;pointer-events:none;width:var(${property});`;
  document.body.append(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width;
}

function animateViewportTo(left, animate = true) {
  cancelAnimationFrame(scrollFrame);
  const startLeft = viewport.scrollLeft;
  const distance = left - startLeft;
  if (!animate || reducedMotion.matches || Math.abs(distance) < 0.5) {
    viewport.scrollLeft = left;
    return;
  }
  const started = performance.now();
  const duration = 300;
  const move = (now) => {
    const progress = Math.min(1, (now - started) / duration);
    const eased = 1 - (1 - progress) ** 3;
    viewport.scrollLeft = startLeft + distance * eased;
    if (progress < 1) scrollFrame = requestAnimationFrame(move);
    else viewport.scrollLeft = left;
  };
  scrollFrame = requestAnimationFrame(move);
}

function centerSelected(focus, animate = true) {
  const item = focusItems()[selected];
  if (!item) return;
  const collapsed = resolvedDeckWidth("--collapsed");
  const expanded = resolvedDeckWidth("--expanded");
  const skewHalf = resolvedDeckWidth("--skew-half");
  const trackStyle = getComputedStyle(track);
  const paddingLeft = Number.parseFloat(trackStyle.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(trackStyle.paddingRight) || 0;
  const baseWidth = paddingLeft + paddingRight + expanded + Math.max(0, addons.length - 1) * collapsed;
  const activeWidth = expanded + Math.max(0, viewport.clientWidth - baseWidth);
  const target = paddingLeft + selected * collapsed + activeWidth / 2 - viewport.clientWidth / 2;
  const limit = Math.max(0, viewport.scrollWidth - viewport.clientWidth - skewHalf);
  const atRightEdge = selected >= addons.length - 2;
  const left = atRightEdge ? limit : Math.max(0, Math.min(target, limit));
  animateViewportTo(left, animate);
  if (focus) {
    item.querySelector(".panel-select")?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
}

function selectAddon(index, focus = false) {
  if (!addons.length) {
    selected = 0;
    indexLabel.textContent = "—";
    previous.disabled = true;
    next.disabled = true;
    return;
  }
  const previousSelected = selected;
  const nextSelected = Math.max(0, Math.min(index, addons.length - 1));
  const preservedScrollLeft = viewport.scrollLeft;
  const preserveRightEdge = nextSelected === addons.length - 1
    && previousSelected === addons.length - 2;
  selected = nextSelected;
  addonPanels().forEach((panel, panelIndex) => {
    const active = panelIndex === selected;
    panel.classList.toggle("active", active);
    panel.querySelector(".panel-select")?.setAttribute("aria-pressed", String(active));
  });
  indexLabel.textContent = `${selected + 1} / ${addons.length}`;
  previous.disabled = selected === 0;
  next.disabled = selected === addons.length - 1;
  if (preserveRightEdge) {
    cancelAnimationFrame(scrollFrame);
    viewport.scrollLeft = preservedScrollLeft;
    if (focus) {
      addonPanels()[selected]?.querySelector(".panel-select")?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
    return;
  }
  centerSelected(focus);
}

function setVeil(addon, on) {
  veil.className = `launch-veil ${addon?.theme || "theme-0"}${on ? " on" : ""}`;
  veil.setAttribute("aria-hidden", String(!on));
  if (addon) {
    veilMark.textContent = addon.initial;
    veilTitle.textContent = `${addon.name} 실행 중…`;
  }
}

async function launchAddon(index) {
  const addon = addons[index];
  if (!addon || !host?.openAddon) return;
  selectAddon(index);
  const button = track.querySelector(`[data-addon-id="${addon.id}"]`);
  if (button?.disabled) return;
  if (button) button.disabled = true;
  setVeil(addon, true);
  try {
    const response = await host.openAddon(addon.id);
    if (!response?.ok) throw new Error(response?.error?.message || "애드온을 열지 못했다.");
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    setVeil(addon, false);
    if (button) button.disabled = false;
  }
}

function renderAddon(addon, index) {
  const item = el("li", `addon-panel ${addon.theme}`);
  item.dataset.addonSlot = String(index);

  const surface = el("article", "panel-surface");
  const select = el("button", "panel-select");
  select.type = "button";
  select.setAttribute("aria-label", `${addon.name} 선택`);
  select.setAttribute("aria-pressed", "false");
  select.addEventListener("click", () => selectAddon(index));

  const wordmark = el("div", "panel-wordmark");
  wordmark.setAttribute("aria-hidden", "true");
  addon.words.forEach((word) => wordmark.append(el("span", "", word)));

  const summary = el("div", "panel-summary");
  summary.append(
    el("span", "summary-mark", addon.initial),
    el("strong", "summary-name", addon.name),
    el("span", "summary-role", addon.role),
  );

  const detail = el("div", "panel-detail");
  const status = el("div", "detail-status");
  status.append(stateShape(addon.state), el("span", "", addon.status));
  const launch = el("button", "launch-button", "런치");
  launch.type = "button";
  launch.dataset.addonId = addon.id;
  launch.addEventListener("click", (event) => {
    event.stopPropagation();
    launchAddon(index);
  });
  detail.append(
    el("div", "detail-mark", addon.initial),
    el("h2", "detail-name", addon.name),
    el("p", "detail-role", addon.role),
    status,
    el("div", "detail-meta", addon.meta),
    launch,
  );
  surface.append(wordmark, summary, detail);
  item.append(surface, select);
  return item;
}

function renderAddons(rawAddons, preferredId = null) {
  const installedIds = new Set(rawAddons.map((addon) => addon.id));
  addons = rawAddons.map((addon, index) => addonViewModel(addon, index, installedIds));
  track.replaceChildren(...addons.map(renderAddon));
  emptyAddonInstall.hidden = addons.length !== 0;
  deckFooter.classList.toggle("empty", addons.length === 0);
  const preferredIndex = addons.findIndex((addon) => addon.id === preferredId);
  selectAddon(preferredIndex >= 0 ? preferredIndex : Math.min(selected, Math.max(0, addons.length - 1)));
}

function renderOfficialAddon(addon) {
  const card = el("article", "official-addon-card");
  const mark = el("span", "official-addon-mark", String(addon.name || "?").slice(0, 1));
  const copy = el("div", "official-addon-copy");
  copy.append(
    el("strong", "", addon.name),
    el("p", "", addon.description),
    el("small", "", addon.state === "update"
      ? `v${addon.localVersion} → v${addon.version} · ${addon.sizeLabel}`
      : `v${addon.version} · ${addon.sizeLabel}`),
  );
  const labels = {
    missing: "설치",
    update: "업데이트",
    current: "설치됨",
    "local-newer": "로컬 최신",
    unknown: "확인 필요",
  };
  const button = el("button", "official-addon-install", labels[addon.state] || "확인 필요");
  button.type = "button";
  button.dataset.installable = String(Boolean(addon.action));
  button.disabled = !addon.action;
  button.addEventListener("click", async () => {
    if (installerBusy || !host?.installOfficialAddon) return;
    installerBusy = true;
    officialAddonList.querySelectorAll("button").forEach((item) => { item.disabled = true; });
    installerDialog.querySelectorAll("[data-close-dialog]").forEach((item) => { item.disabled = true; });
    button.textContent = addon.action === "update" ? "업데이트 중…" : "다운로드 중…";
    try {
      const response = await host.installOfficialAddon(addon.id);
      if (!response?.ok) throw new Error(response?.error?.message || "애드온을 설치하지 못했다.");
      await refreshAddons();
      button.dataset.installable = "false";
      button.textContent = response.result.action === "update" ? "업데이트됨" : "설치됨";
      installerRestartPending ||= response.result.requiresHostRestart;
      if (installerRestartPending) {
        installerLoading.hidden = false;
        installerLoading.textContent = "설치 적용을 위해 이 창을 닫으면 호스트가 다시 시작된다.";
      }
      showNotice(`${response.result.name} v${response.result.version} ${response.result.action === "update" ? "업데이트" : "설치"} 완료`);
      officialAddonList.querySelectorAll("button").forEach((item) => {
        item.disabled = item.dataset.installable !== "true";
      });
    } catch (error) {
      button.textContent = labels[addon.state] || "다시 시도";
      showNotice(error.message, true);
      officialAddonList.querySelectorAll("button").forEach((item) => {
        item.disabled = item.dataset.installable !== "true";
      });
    } finally {
      installerBusy = false;
      installerDialog.querySelectorAll("[data-close-dialog]").forEach((item) => { item.disabled = false; });
    }
  });
  card.append(mark, copy, button);
  return card;
}

async function openOfficialAddonInstaller() {
  if (installerBusy) return;
  installerDialog.showModal();
  installerRestartPending = false;
  installerLoading.hidden = false;
  installerLoading.classList.remove("error");
  installerLoading.textContent = "공식 릴리즈를 확인하는 중…";
  officialAddonList.replaceChildren();
  try {
    const response = await host.listOfficialAddons();
    if (!response?.ok) throw new Error(response?.error?.message || "공식 애드온 목록을 읽지 못했다.");
    const catalog = response.result?.addons || [];
    if (!catalog.length) throw new Error("설치 가능한 공식 애드온이 없다.");
    installerLoading.hidden = response.result?.source === "remote";
    if (!installerLoading.hidden) installerLoading.textContent = "내장 또는 마지막 정상 카탈로그를 사용 중이다.";
    officialAddonList.replaceChildren(...catalog.map(renderOfficialAddon));
  } catch (error) {
    installerLoading.classList.add("error");
    installerLoading.textContent = error.message;
  }
}

async function refreshAddons() {
  if (refreshing) return;
  refreshing = true;
  if (!host?.listAddons || !host?.openAddon) {
    showNotice("호스트 브리지를 불러오지 못했다.", true);
    refreshing = false;
    return;
  }
  const selectedId = addons[selected]?.id || null;
  try {
    const response = await host.listAddons();
    if (!response?.ok) throw new Error(response?.error?.message || "애드온 목록을 읽지 못했다.");
    renderAddons(response.result || [], selectedId);
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    refreshing = false;
  }
}

previous.addEventListener("click", () => selectAddon(selected - 1, true));
next.addEventListener("click", () => selectAddon(selected + 1, true));
emptyAddonInstall.addEventListener("click", openOfficialAddonInstaller);
openAddonInstaller.addEventListener("click", openOfficialAddonInstaller);
installerDialog.addEventListener("close", () => {
  if (installerRestartPending) host.restartHost();
});
openSettings.addEventListener("click", async () => {
  settingsDialog.showModal();
  try {
    await Promise.all([refreshOutputSettings(), refreshHostUpdate(true)]);
  } catch (error) {
    showNotice(error.message, true);
  }
});

document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog").close());
});

document.querySelectorAll("dialog").forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog && !(dialog === installerDialog && installerBusy)) dialog.close();
  });
});

installerDialog.addEventListener("cancel", (event) => {
  if (installerBusy) event.preventDefault();
});

openOutputFolder.addEventListener("click", () => runOutputAction(() => host.openOutputFolder(), "공용 출력 폴더를 열었다."));
selectOutputFolder.addEventListener("click", () => runOutputAction(() => host.selectOutputFolder(), "공용 출력 폴더 설정을 갱신했다."));
resetOutputFolder.addEventListener("click", () => runOutputAction(() => host.resetOutputFolder(), "기본 출력 폴더로 복원했다."));
checkHostUpdate.addEventListener("click", () => refreshHostUpdate(true));
applyHostUpdate.addEventListener("click", startHostUpdate);

viewport.addEventListener("wheel", (event) => {
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (!delta) return;
  event.preventDefault();
  clearTimeout(wheelResetTimer);
  wheelAccumulator += delta;
  wheelResetTimer = setTimeout(() => { wheelAccumulator = 0; }, 140);
  if (wheelLocked || Math.abs(wheelAccumulator) < 44) return;
  const direction = wheelAccumulator > 0 ? 1 : -1;
  wheelAccumulator = 0;
  wheelLocked = true;
  selectAddon(selected + direction, true);
  setTimeout(() => { wheelLocked = false; }, 240);
}, { passive: false });

document.addEventListener("keydown", (event) => {
  if (document.querySelector("dialog[open]")) return;
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    selectAddon(selected - 1, true);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    selectAddon(selected + 1, true);
  } else if (event.key === "Enter" && (!event.target.closest("button") || event.target.matches(".panel-select"))) {
    event.preventDefault();
    launchAddon(selected);
  } else if (/^[1-9]$/u.test(event.key)) {
    const index = Number(event.key) - 1;
    if (index < addons.length) selectAddon(index, true);
  }
});

window.addEventListener("resize", () => centerSelected(false, false));
window.addEventListener("focus", refreshAddons);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshAddons();
});

renderAddons([]);
refreshAddons();
refreshOutputSettings().catch((error) => showNotice(error.message, true));
refreshHostUpdate(true);
