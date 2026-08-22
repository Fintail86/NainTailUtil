"use strict";

(() => {
  const api = window.galleryTail;
  let currentSettings = null;
  let settingsActive = false;

  function button(label, id, className = "") {
    const element = document.createElement("button");
    element.type = "button";
    element.id = id;
    element.className = className;
    element.textContent = label;
    return element;
  }

  function render(card, settings) {
    currentSettings = settings;
    const hosted = settings.mode === "hosted";
    const custom = settings.source === "custom";
    const badge = card.querySelector("[data-output-badge]");
    badge.textContent = hosted ? "호스트 상속" : custom ? "사용자 지정" : "Standalone 기본값";
    badge.className = `addon-output-badge${hosted ? " hosted" : ""}`;
    card.querySelector("[data-output-description]").textContent = hosted
      ? "NainTail 호스트에서 지정한 공용 출력 위치를 상속합니다. Hosted 모드에서는 변경할 수 없습니다."
      : "GalleryTail이 탐색할 출력 위치입니다. 기본값은 GalleryTail 폴더의 outputs입니다.";
    const pathValue = card.querySelector("[data-output-path]");
    pathValue.textContent = settings.outputRoot;
    pathValue.title = settings.outputRoot;
    card.querySelector("#galleryOutputSelect").disabled = settings.locked;
    card.querySelector("#galleryOutputReset").disabled = settings.locked || !custom;
  }

  function message(card, text, error = false) {
    const status = card.querySelector("[data-output-status]");
    status.textContent = text || "";
    status.className = `addon-output-status${error ? " error" : ""}`;
    status.hidden = !text;
  }

  async function run(card, work, success) {
    card.setAttribute("aria-busy", "true");
    card.querySelectorAll("button").forEach((item) => { item.disabled = true; });
    message(card, "처리 중…");
    try {
      const settings = await work();
      if (settings?.outputRoot) render(card, settings);
      message(card, success);
    } catch (error) {
      message(card, error.message || "출력 폴더 설정을 처리하지 못했습니다.", true);
    } finally {
      card.setAttribute("aria-busy", "false");
      if (currentSettings) render(card, currentSettings);
    }
  }

  function createSettingsPage() {
    const page = document.createElement("section");
    page.className = "addon-settings-page";
    page.dataset.addonSettingsPage = "";
    page.innerHTML = `
      <header class="topbar addon-settings-topbar">
        <div><p class="eyebrow">APPLICATION</p><h1>설정</h1></div>
      </header>
      <section class="addon-output-settings panel" data-addon-output-settings>
        <div class="addon-output-heading">
          <div><strong>출력 폴더</strong><span data-output-description>출력 이미지를 탐색할 위치를 관리합니다.</span></div>
          <b class="addon-output-badge" data-output-badge>확인 중</b>
        </div>
        <div class="addon-output-path-row">
          <code data-output-path data-localize="off">불러오는 중…</code>
          <button type="button" id="galleryOutputOpen">폴더 열기</button>
        </div>
        <div class="addon-output-actions">
          <button type="button" id="galleryOutputReset">기본 위치로 복원</button>
          <button type="button" id="galleryOutputSelect" class="primary">위치 변경</button>
        </div>
        <p class="addon-output-status" data-output-status role="status" hidden></p>
      </section>`;
    const card = page.querySelector("[data-addon-output-settings]");
    card.querySelector("#galleryOutputOpen").addEventListener("click", () => run(card, () => api.openWorkspaceFolder(), "워크스페이스 출력 폴더를 열었습니다."));
    card.querySelector("#galleryOutputSelect").addEventListener("click", () => run(card, () => api.selectOutputFolder(), "출력 폴더를 변경했습니다."));
    card.querySelector("#galleryOutputReset").addEventListener("click", () => run(card, () => api.resetOutputFolder(), "애드온 기본 출력 폴더로 복원했습니다."));
    return page;
  }

  async function refresh(page) {
    const card = page.querySelector("[data-addon-output-settings]");
    try {
      render(card, await api.getOutputSettings());
      message(card, "");
    } catch (error) {
      message(card, error.message || "출력 폴더 설정을 읽지 못했습니다.", true);
    }
  }

  function removeLegacyProviderControls(shell) {
    const versionChip = shell.querySelector(".version-chip");
    if (versionChip && versionChip.textContent !== "Host outputs") versionChip.textContent = "Host outputs";
    shell.querySelectorAll("button").forEach((item) => {
      if (item.textContent.trim() === "설정 불러오기") item.remove();
    });
    shell.querySelectorAll("p.no-metadata").forEach((item) => {
      const label = "호환되는 생성 메타데이터가 없는 이미지입니다.";
      if (item.textContent !== label) item.textContent = label;
    });
  }

  function install() {
    const shell = document.querySelector(".app-shell");
    const nav = shell?.querySelector(".app-header .tab-nav");
    const main = shell?.querySelector(":scope > main");
    const defaultTab = nav?.querySelector(".tab-item:not([data-addon-settings-tab])");
    if (!shell || !nav || !main || !defaultTab) return false;
    removeLegacyProviderControls(shell);

    let settingsTab = nav.querySelector("[data-addon-settings-tab]");
    let settingsPage = document.querySelector("body > [data-addon-settings-page]");
    let createdPage = false;
    if (!settingsPage) {
      settingsPage = createSettingsPage();
      document.body.appendChild(settingsPage);
      createdPage = true;
    }
    if (!settingsTab) {
      settingsTab = button("설정", "gallerySettingsTab", "tab-item");
      settingsTab.dataset.addonSettingsTab = "";
      const icon = document.createElement("span");
      icon.className = "tab-icon";
      icon.textContent = "⚙";
      settingsTab.prepend(icon);
      nav.appendChild(settingsTab);
      settingsTab.addEventListener("click", () => {
        settingsActive = true;
        document.body.classList.add("addon-settings-active");
        defaultTab.classList.remove("active");
        settingsTab.classList.add("active");
        void refresh(settingsPage);
      });
    }
    if (!defaultTab.dataset.addonSettingsBound) {
      defaultTab.dataset.addonSettingsBound = "true";
      defaultTab.setAttribute("role", "button");
      defaultTab.tabIndex = 0;
      const showDefault = () => {
        settingsActive = false;
        document.body.classList.remove("addon-settings-active");
        settingsTab.classList.remove("active");
        defaultTab.classList.add("active");
      };
      defaultTab.addEventListener("click", showDefault);
      defaultTab.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") showDefault();
      });
    }
    document.body.classList.toggle("addon-settings-active", settingsActive);
    settingsTab.classList.toggle("active", settingsActive);
    defaultTab.classList.toggle("active", !settingsActive);
    if (createdPage) void refresh(settingsPage);
    return true;
  }

  const observer = new MutationObserver(() => install());
  const start = () => {
    install();
    observer.observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
