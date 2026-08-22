"use strict";

(() => {
  const api = window.galleryTail;
  const state = {
    mode: "all",
    catalog: null,
    loading: false,
  };
  let overlay = null;
  let overlayResizeObserver = null;

  function element(tag, className = "", text = "") {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  }

  function sourceButton(source) {
    const button = element("button", "gallery-source-card");
    button.type = "button";
    button.dataset.gallerySourceId = source.id;
    button.classList.toggle("active", state.catalog?.activeSourceId === source.id);
    const copy = element("span", "gallery-source-card-copy");
    copy.append(element("strong", "", source.name));
    const detail = source.kind === "workspace"
      ? "호스트 공용 출력"
      : `${source.addonId} · ${source.source === "custom" ? "사용자 지정" : "애드온 기본값"}`;
    copy.append(element("small", "", detail));
    const path = element("code", "gallery-source-card-path", source.outputRoot);
    path.title = source.outputRoot;
    button.append(copy, path);
    return button;
  }

  function sourceLayer(kind, title, description, sources) {
    const section = element("section", `gallery-source-layer ${kind}`);
    const heading = element("div", "gallery-source-layer-heading");
    const copy = element("span");
    copy.append(element("strong", "", title), element("small", "", description));
    heading.append(copy, element("b", "", String(sources.length)));
    const list = element("div", "gallery-source-card-list");
    if (sources.length) sources.forEach((source) => list.append(sourceButton(source)));
    else list.append(element("p", "gallery-source-empty", "표시할 포터블 출력 위치가 없습니다."));
    section.append(heading, list);
    return section;
  }

  function render() {
    if (!overlay || !state.catalog) return;
    overlay.querySelectorAll("[data-gallery-view-mode]").forEach((button) => {
      button.classList.toggle("active", button.dataset.galleryViewMode === state.mode);
    });
    const layers = overlay.querySelector("[data-gallery-source-layers]");
    layers.replaceChildren();
    const workspace = state.catalog.sources.filter((source) => source.kind === "workspace");
    const portable = state.catalog.sources.filter((source) => source.kind === "portable");
    if (state.mode === "all" || state.mode === "workspace") {
      layers.append(sourceLayer("workspace", "워크스페이스", "NainTail 공용 출력 위치", workspace));
    }
    if (state.mode === "all" || state.mode === "portable") {
      layers.append(sourceLayer("portable", "포터블 모드 자체 경로", "애드온별 Standalone 출력 위치", portable));
    }
    updateBreadcrumb();
    requestAnimationFrame(updatePosition);
  }

  function updateBreadcrumb() {
    const source = state.catalog?.sources.find((item) => item.id === state.catalog.activeSourceId);
    const root = document.querySelector(".gallery-breadcrumbs button");
    if (root && source && root.textContent !== source.name) root.textContent = source.name;
  }

  function resetBrowserRoot() {
    const root = document.querySelector(".gallery-breadcrumbs button");
    if (root) root.click();
    else document.querySelector('.gallery-browser-actions button[title="새로고침"]')?.click();
  }

  async function selectSource(sourceId) {
    if (!sourceId || state.catalog?.activeSourceId === sourceId) return;
    overlay?.setAttribute("aria-busy", "true");
    try {
      state.catalog = await api.selectSource(sourceId);
      render();
      resetBrowserRoot();
    } finally {
      overlay?.setAttribute("aria-busy", "false");
    }
  }

  async function selectMode(mode) {
    if (!new Set(["all", "workspace", "portable"]).has(mode)) return;
    state.mode = mode;
    const sources = state.catalog?.sources || [];
    if (mode === "workspace") {
      await selectSource("workspace");
    } else if (mode === "portable" && !String(state.catalog?.activeSourceId || "").startsWith("portable:")) {
      await selectSource(sources.find((source) => source.kind === "portable")?.id);
    }
    render();
  }

  function createOverlay() {
    const section = element("section", "gallery-source-overlay");
    section.dataset.gallerySourceOverlay = "";
    section.setAttribute("aria-label", "갤러리 저장 위치 선택");
    const tabs = element("nav", "gallery-view-tabs");
    tabs.setAttribute("aria-label", "갤러리 보기 범위");
    for (const [mode, label] of [
      ["all", "전체 보기"],
      ["workspace", "워크스페이스"],
      ["portable", "포터블 모드 자체 경로"],
    ]) {
      const button = element("button", "gallery-view-tab", label);
      button.type = "button";
      button.dataset.galleryViewMode = mode;
      tabs.append(button);
    }
    const layers = element("div", "gallery-source-layers");
    layers.dataset.gallerySourceLayers = "";
    section.append(tabs, layers);
    section.addEventListener("click", (event) => {
      const modeButton = event.target.closest("[data-gallery-view-mode]");
      if (modeButton) {
        void selectMode(modeButton.dataset.galleryViewMode);
        return;
      }
      const source = event.target.closest("[data-gallery-source-id]");
      if (source) void selectSource(source.dataset.gallerySourceId);
    });
    document.body.append(section);
    return section;
  }

  function updatePosition() {
    if (!overlay) return;
    const browser = document.querySelector(".gallery-browser");
    const hidden = !browser || document.body.classList.contains("addon-settings-active");
    overlay.hidden = hidden;
    if (hidden) return;
    const rect = browser.getBoundingClientRect();
    overlay.style.left = `${Math.round(rect.left + 14)}px`;
    overlay.style.top = `${Math.round(rect.top + 14)}px`;
    overlay.style.width = `${Math.max(0, Math.round(rect.width - 28))}px`;
    document.documentElement.style.setProperty(
      "--gallery-source-inset",
      `${Math.ceil(overlay.getBoundingClientRect().height) + 24}px`,
    );
  }

  async function refreshCatalog() {
    if (state.loading) return;
    state.loading = true;
    try {
      state.catalog = await api.getSources();
      render();
    } finally {
      state.loading = false;
    }
  }

  function install() {
    if (!document.querySelector(".gallery-browser")) return false;
    if (!overlay) {
      overlay = createOverlay();
      overlayResizeObserver = new ResizeObserver(updatePosition);
      overlayResizeObserver.observe(overlay);
      void refreshCatalog();
    }
    updateBreadcrumb();
    updatePosition();
    return true;
  }

  const observer = new MutationObserver(install);
  const start = () => {
    install();
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", updatePosition);
  };
  if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
