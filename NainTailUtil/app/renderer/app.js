"use strict";

const host = window.nainTailHost;
const grid = document.querySelector("#addonGrid");
let slots = [];
const notice = document.querySelector("#hostNotice");

function renderSlots(count) {
  const slotCount = Math.max(3, count);
  grid.style.setProperty("--addon-columns", String(Math.min(slotCount, 4)));
  slots = Array.from({ length: slotCount }, (_value, index) => {
    const slot = document.createElement("li");
    slot.className = "addon-slot";
    slot.dataset.addonSlot = String(index);
    grid.append(slot);
    return slot;
  });
}

function showNotice(message, error = false) {
  notice.textContent = message || "";
  notice.classList.toggle("error", error);
}

function placeholder(slot, index) {
  const card = document.createElement("div");
  card.className = "addon-placeholder";
  const copy = document.createElement("div");
  const mark = document.createElement("span");
  const label = document.createElement("small");
  mark.textContent = "+";
  label.textContent = `애드온 슬롯 ${index + 1} · 비어 있음`;
  copy.append(mark, label);
  card.append(copy);
  slot.replaceChildren(card);
}

function addonCard(slot, addon) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "addon-card";
  card.dataset.addonId = addon.id;
  card.setAttribute("aria-label", `${addon.name} 열기`);

  const visual = document.createElement("span");
  visual.className = "addon-visual";
  const glyph = document.createElement("span");
  glyph.className = "addon-glyph";
  glyph.textContent = addon.name.slice(0, 1).toUpperCase();
  visual.append(glyph);

  const copy = document.createElement("span");
  copy.className = "addon-copy";
  const identity = document.createElement("span");
  const name = document.createElement("strong");
  const meta = document.createElement("small");
  name.textContent = addon.name;
  meta.textContent = `${addon.builtIn ? "내장 애드온" : "애드온"} · v${addon.version}`;
  identity.append(name, meta);
  const open = document.createElement("span");
  open.className = "addon-open";
  open.textContent = "열기 →";
  copy.append(identity, open);
  card.append(visual, copy);

  card.addEventListener("click", async () => {
    card.disabled = true;
    showNotice(`${addon.name}을 여는 중…`);
    try {
      const response = await host.openAddon(addon.id);
      if (!response?.ok) throw new Error(response?.error?.message || "애드온을 열지 못했다.");
    } catch (error) {
      showNotice(error.message, true);
    } finally {
      card.disabled = false;
    }
  });
  slot.replaceChildren(card);
}

let refreshing = false;

async function refreshAddons() {
  if (refreshing) return;
  refreshing = true;
  if (!host?.listAddons || !host?.openAddon) {
    showNotice("호스트 브리지를 불러오지 못했다.", true);
    refreshing = false;
    return;
  }
  try {
    const response = await host.listAddons();
    if (!response?.ok) throw new Error(response?.error?.message || "애드온 목록을 읽지 못했다.");
    const addons = response.result || [];
    grid.replaceChildren();
    renderSlots(addons.length);
    slots.forEach(placeholder);
    addons.forEach((addon, index) => addonCard(slots[index], addon));
    showNotice(addons.length ? `${addons.length}개의 애드온을 사용할 수 있다.` : "설치된 애드온이 없다.");
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    refreshing = false;
  }
}

renderSlots(3);
slots.forEach(placeholder);
refreshAddons();
window.addEventListener("focus", refreshAddons);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshAddons();
});
