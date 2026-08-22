"use strict";

(() => {
  const api = window.animaUtil;
  let observing = false;

  function createButton(label, id, className = "") {
    const element = document.createElement("button");
    element.type = "button";
    element.id = id;
    element.className = className;
    element.textContent = label;
    return element;
  }

  function render(card, settings) {
    const hosted = settings.mode === "hosted";
    const custom = settings.source === "custom";
    const badge = card.querySelector("[data-output-badge]");
    const description = card.querySelector("[data-output-description]");
    const pathValue = card.querySelector("[data-output-path]");
    badge.textContent = hosted ? "호스트 상속" : custom ? "사용자 지정" : "Standalone 기본값";
    badge.className = `addon-output-badge${hosted ? " hosted" : ""}`;
    description.textContent = hosted
      ? "NainTail 호스트의 공용 출력 위치를 상속합니다. Hosted 모드에서는 변경할 수 없습니다."
      : "Standalone 생성 결과를 저장할 위치입니다. 기본값은 AnimaTail 폴더의 outputs입니다.";
    pathValue.textContent = settings.outputRoot;
    pathValue.title = settings.outputRoot;
    card.querySelector("#animaOutputSelect").disabled = settings.locked;
    card.querySelector("#animaOutputReset").disabled = settings.locked || !custom;
    card.dataset.mode = settings.mode;
    card.dataset.source = settings.source;
  }

  function showMessage(card, message, error = false) {
    const status = card.querySelector("[data-output-status]");
    status.textContent = message || "";
    status.className = `addon-output-status${error ? " error" : ""}`;
    status.hidden = !message;
  }

  function setBusy(card, busy) {
    card.setAttribute("aria-busy", String(busy));
    card.querySelectorAll("button").forEach((button) => { button.disabled = busy; });
  }

  async function refresh(card) {
    try {
      render(card, await api.getOutputSettings());
      showMessage(card, "");
    } catch (error) {
      showMessage(card, error.message || "출력 폴더 설정을 읽지 못했습니다.", true);
    }
  }

  async function run(card, work, success) {
    setBusy(card, true);
    showMessage(card, "처리 중…");
    try {
      const settings = await work();
      if (settings?.outputRoot) render(card, settings);
      showMessage(card, success);
    } catch (error) {
      showMessage(card, error.message || "출력 폴더 설정을 처리하지 못했습니다.", true);
    } finally {
      setBusy(card, false);
      const hosted = card.dataset.mode === "hosted";
      card.querySelector("#animaOutputSelect").disabled = hosted;
      card.querySelector("#animaOutputReset").disabled = hosted || card.dataset.source !== "custom";
    }
  }

  function createCard() {
    const card = document.createElement("section");
    card.className = "addon-output-settings panel";
    card.dataset.addonOutputSettings = "";

    const heading = document.createElement("div");
    heading.className = "addon-output-heading";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = "출력 폴더";
    const description = document.createElement("span");
    description.dataset.outputDescription = "";
    description.textContent = "생성 결과를 저장할 위치를 관리합니다.";
    copy.append(title, description);
    const badge = document.createElement("b");
    badge.dataset.outputBadge = "";
    badge.className = "addon-output-badge";
    badge.textContent = "확인 중";
    heading.append(copy, badge);

    const pathRow = document.createElement("div");
    pathRow.className = "addon-output-path-row";
    const pathValue = document.createElement("code");
    pathValue.dataset.outputPath = "";
    pathValue.dataset.localize = "off";
    pathValue.textContent = "불러오는 중…";
    const open = createButton("폴더 열기", "animaOutputOpen");
    pathRow.append(pathValue, open);

    const actions = document.createElement("div");
    actions.className = "addon-output-actions";
    const reset = createButton("기본 위치로 복원", "animaOutputReset");
    const select = createButton("위치 변경", "animaOutputSelect", "primary");
    actions.append(reset, select);

    const status = document.createElement("p");
    status.dataset.outputStatus = "";
    status.className = "addon-output-status";
    status.setAttribute("role", "status");
    status.hidden = true;
    card.append(heading, pathRow, actions, status);

    open.addEventListener("click", () => run(card, () => api.openOutputs(), "출력 폴더를 열었습니다."));
    select.addEventListener("click", () => run(card, () => api.selectOutputFolder(), "출력 폴더를 변경했습니다."));
    reset.addEventListener("click", () => run(card, () => api.resetOutputFolder(), "애드온 기본 출력 폴더로 복원했습니다."));
    return card;
  }

  function install() {
    const page = document.querySelector(".feature-page.settings-page");
    if (!page || page.querySelector("[data-addon-output-settings]")) return false;
    const card = createCard();
    page.prepend(card);
    void refresh(card);
    return true;
  }

  function observe() {
    if (observing) return;
    observing = true;
    install();
    const observer = new MutationObserver(() => install());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", observe, { once: true });
  else observe();
})();
