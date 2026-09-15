const MODE_SHORTCUTS = Object.freeze({
  q: { mode: "mosaic", label: "모자이크" },
  w: { mode: "color", label: "색상 박스" },
  e: { mode: "shape", label: "형태 칠하기" },
  r: { mode: "gradient", label: "그라데이션" },
  t: { mode: "fog", label: "포그" },
});

const selectedBoxes = new Set();
let primaryBox = null;
let marqueeMode = false;
let marqueeDrag = null;
let marqueeElement = null;
let suppressNextCanvasClick = false;
let suppressNextBoxClick = false;
let syncingPrimary = false;
let replayingEdit = false;
let operationQueue = Promise.resolve();
let toastTimer = null;

function isEditableTarget(target) {
  return target instanceof Element
    && Boolean(target.closest("input, textarea, select, [contenteditable='true'], [role='dialog']"));
}

function boxElements() {
  return Array.from(document.querySelectorAll(".censor-image-content .censor-box"));
}

function pruneSelection() {
  for (const box of selectedBoxes) {
    if (!box.isConnected || !box.matches(".censor-image-content .censor-box")) {
      selectedBoxes.delete(box);
    }
  }
  if (!primaryBox?.isConnected || !selectedBoxes.has(primaryBox)) {
    primaryBox = selectedBoxes.values().next().value || null;
  }
}

function headingActions() {
  return document.querySelector(".censor-preview-heading > div:last-child");
}

function ensureMultiSelectButton() {
  const actions = headingActions();
  if (!actions || actions.querySelector(".censor-multi-select-toggle")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "censor-multi-select-toggle";
  button.title = "영역 드래그로 박스 다중 선택 · Ctrl/Shift 클릭으로 선택 추가/해제";
  button.addEventListener("click", () => setMarqueeMode(!marqueeMode));

  const manualButton = Array.from(actions.querySelectorAll("button"))
    .find((candidate) => candidate.textContent.includes("수동 영역") || candidate.textContent.includes("그리기 종료"));
  actions.insertBefore(button, manualButton || actions.lastElementChild);
  syncVisualSelection();
}

function setMarqueeMode(enabled) {
  marqueeMode = Boolean(enabled);
  if (marqueeMode) {
    const headingButtons = Array.from(document.querySelectorAll(".censor-preview-heading button"));
    const originalButton = headingButtons.find((button) => button.textContent.trim() === "원본");
    const previewButton = headingButtons.find((button) => button.textContent.includes("검열 미리보기"));
    const manualButton = headingButtons.find((button) => (
      button.textContent.includes("수동 영역") || button.textContent.includes("그리기 종료")
    ));

    if (manualButton?.textContent.includes("그리기 종료")) {
      manualButton.click();
    } else if (originalButton?.classList.contains("active")) {
      if (previewButton && !previewButton.disabled) {
        previewButton.click();
      } else if (manualButton && !manualButton.disabled) {
        manualButton.click();
        requestAnimationFrame(() => {
          const stopButton = Array.from(document.querySelectorAll(".censor-preview-heading button"))
            .find((button) => button.textContent.includes("그리기 종료"));
          stopButton?.click();
        });
      }
    }
  }
  document.querySelector(".censor-canvas")?.classList.toggle("multi-selecting", marqueeMode);
  if (!marqueeMode) finishMarquee(null, true);
  syncVisualSelection();
}

function syncVisualSelection() {
  pruneSelection();
  for (const box of boxElements()) {
    box.classList.toggle("batch-selected", selectedBoxes.has(box));
  }

  const button = document.querySelector(".censor-multi-select-toggle");
  if (button) {
    button.classList.toggle("active", marqueeMode);
    button.disabled = !document.querySelector(".censor-image-content");
    const buttonState = `${marqueeMode ? "end" : "start"}:${selectedBoxes.size}`;
    if (button.dataset.selectionState !== buttonState) {
      const count = document.createElement("span");
      count.className = "selection-count";
      count.textContent = String(selectedBoxes.size);
      button.replaceChildren(
        document.createTextNode(marqueeMode ? "선택 종료 " : "다중 선택 "),
        count,
      );
      button.dataset.selectionState = buttonState;
    }
  }
  document.querySelector(".censor-canvas")?.classList.toggle("multi-selecting", marqueeMode);
}

function replaceSelection(boxes, primary = null) {
  selectedBoxes.clear();
  for (const box of boxes) {
    if (box?.isConnected) selectedBoxes.add(box);
  }
  primaryBox = primary && selectedBoxes.has(primary)
    ? primary
    : Array.from(selectedBoxes).at(-1) || null;
  syncVisualSelection();
  if (primaryBox) selectPrimaryInReact(primaryBox);
}

function toggleSelection(box) {
  if (selectedBoxes.has(box)) {
    selectedBoxes.delete(box);
    if (primaryBox === box) primaryBox = Array.from(selectedBoxes).at(-1) || null;
  } else {
    selectedBoxes.add(box);
    primaryBox = box;
  }
  syncVisualSelection();
  if (primaryBox) selectPrimaryInReact(primaryBox);
}

function selectPrimaryInReact(box) {
  if (!box?.isConnected) return;
  syncingPrimary = true;
  box.click();
  syncingPrimary = false;
}

function nextRender() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

async function activateBox(box) {
  if (!box?.isConnected) return false;
  selectPrimaryInReact(box);
  await nextRender();
  return Boolean(document.querySelector(".selected-box-settings"));
}

function normalizedLabel(control) {
  const label = control.closest("label");
  if (!label) return "";
  const directSpan = Array.from(label.children).find((child) => child.tagName === "SPAN");
  return (directSpan?.textContent || label.textContent || "").trim();
}

function describeControl(control) {
  return {
    tagName: control.tagName,
    type: control instanceof HTMLInputElement ? control.type : "",
    label: normalizedLabel(control),
  };
}

function findMatchingControl(section, descriptor) {
  return Array.from(section.querySelectorAll("input, select")).find((control) => {
    const candidate = describeControl(control);
    return candidate.tagName === descriptor.tagName
      && candidate.type === descriptor.type
      && candidate.label === descriptor.label;
  }) || null;
}

function dispatchControlValue(control, value, checked) {
  if (control instanceof HTMLInputElement && control.type === "checkbox") {
    if (control.checked !== checked) control.click();
    return;
  }

  const prototype = control instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(control, value);
  else control.value = value;
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

function findOverrideCheckbox() {
  return Array.from(document.querySelectorAll(".selected-box-settings input[type='checkbox']"))
    .find((input) => normalizedLabel(input).includes("개별 검열 설정 사용")) || null;
}

async function restorePrimary(box) {
  if (box?.isConnected && selectedBoxes.has(box)) {
    await activateBox(box);
  }
  syncVisualSelection();
}

function enqueueOperation(operation) {
  operationQueue = operationQueue
    .catch(() => undefined)
    .then(operation)
    .catch((error) => showToast(error?.message || "다중 편집에 실패했습니다.", true));
  return operationQueue;
}

async function toggleOverridesForSelection() {
  pruneSelection();
  const boxes = Array.from(selectedBoxes);
  if (!boxes.length) return;
  const originalPrimary = primaryBox || boxes.at(-1);

  replayingEdit = true;
  try {
    await activateBox(originalPrimary);
    const current = findOverrideCheckbox();
    if (!current) throw new Error("개별 검열 설정을 찾을 수 없습니다.");
    const desired = !current.checked;

    for (const box of boxes) {
      if (!await activateBox(box)) continue;
      const checkbox = findOverrideCheckbox();
      if (checkbox && checkbox.checked !== desired) checkbox.click();
      await nextRender();
    }
    await restorePrimary(originalPrimary);
    showToast(`${boxes.length}개 박스 개별 설정 ${desired ? "ON" : "OFF"}`);
  } finally {
    replayingEdit = false;
  }
}

async function setModeForSelection(mode, label) {
  pruneSelection();
  const boxes = Array.from(selectedBoxes);
  if (!boxes.length) return;
  const originalPrimary = primaryBox || boxes.at(-1);

  replayingEdit = true;
  try {
    for (const box of boxes) {
      if (!await activateBox(box)) continue;
      let checkbox = findOverrideCheckbox();
      if (checkbox && !checkbox.checked) {
        checkbox.click();
        await nextRender();
      }
      const modeSelect = document.querySelector(".selected-box-effect-grid select");
      if (!modeSelect) throw new Error("개별 검열 방식 선택기를 찾을 수 없습니다.");
      dispatchControlValue(modeSelect, mode, false);
      await nextRender();
    }
    await restorePrimary(originalPrimary);
    showToast(`${boxes.length}개 박스 → ${label}`);
  } finally {
    replayingEdit = false;
  }
}

async function mirrorControlToSelection(source, descriptor, value, checked) {
  pruneSelection();
  const boxes = Array.from(selectedBoxes);
  if (boxes.length < 2) return;
  const originalPrimary = primaryBox || boxes.at(-1);

  replayingEdit = true;
  try {
    for (const box of boxes) {
      if (box === source || !await activateBox(box)) continue;
      const section = document.querySelector(".selected-box-settings");
      const control = section && findMatchingControl(section, descriptor);
      if (!control) continue;
      dispatchControlValue(control, value, checked);
      await nextRender();
    }
    await restorePrimary(originalPrimary);
  } finally {
    replayingEdit = false;
  }
}

async function clickButtonForSelection(buttonText) {
  pruneSelection();
  const boxes = Array.from(selectedBoxes);
  if (boxes.length < 2) return;
  const originalPrimary = primaryBox || boxes.at(-1);

  replayingEdit = true;
  try {
    for (const box of boxes) {
      if (!await activateBox(box)) continue;
      const button = Array.from(document.querySelectorAll(".selected-box-settings button"))
        .find((candidate) => candidate.textContent.trim() === buttonText);
      button?.click();
      await nextRender();
    }
    await restorePrimary(originalPrimary);
  } finally {
    replayingEdit = false;
  }
}

async function deleteSelection() {
  pruneSelection();
  const boxes = Array.from(selectedBoxes);
  if (!boxes.length) return;

  replayingEdit = true;
  try {
    for (const box of boxes) {
      if (!await activateBox(box)) continue;
      const deleteButton = Array.from(document.querySelectorAll(".selected-box-settings button"))
        .find((candidate) => candidate.textContent.trim() === "삭제");
      deleteButton?.click();
      await nextRender();
    }
    selectedBoxes.clear();
    primaryBox = null;
    syncVisualSelection();
    showToast(`${boxes.length}개 박스 삭제`);
  } finally {
    replayingEdit = false;
  }
}

function showToast(message, error = false) {
  const canvas = document.querySelector(".censor-canvas");
  if (!canvas) return;
  let toast = canvas.querySelector(".censor-shortcut-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "censor-shortcut-toast";
    canvas.appendChild(toast);
  }
  toast.classList.toggle("error", error);
  toast.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.remove(), 1600);
}

function marqueeRect(event) {
  if (!marqueeDrag) return null;
  const bounds = marqueeDrag.content.getBoundingClientRect();
  const currentX = Math.min(bounds.right, Math.max(bounds.left, event.clientX));
  const currentY = Math.min(bounds.bottom, Math.max(bounds.top, event.clientY));
  return {
    left: Math.min(marqueeDrag.startX, currentX),
    top: Math.min(marqueeDrag.startY, currentY),
    right: Math.max(marqueeDrag.startX, currentX),
    bottom: Math.max(marqueeDrag.startY, currentY),
    bounds,
  };
}

function updateMarquee(event) {
  const rect = marqueeRect(event);
  if (!rect || !marqueeElement) return;
  marqueeElement.style.left = `${rect.left - rect.bounds.left}px`;
  marqueeElement.style.top = `${rect.top - rect.bounds.top}px`;
  marqueeElement.style.width = `${rect.right - rect.left}px`;
  marqueeElement.style.height = `${rect.bottom - rect.top}px`;
}

function finishMarquee(event, cancelled = false) {
  if (!marqueeDrag) return;
  const drag = marqueeDrag;
  const rect = event ? marqueeRect(event) : null;
  if (drag.content.hasPointerCapture?.(drag.pointerId)) {
    drag.content.releasePointerCapture(drag.pointerId);
  }
  marqueeDrag = null;
  marqueeElement?.remove();
  marqueeElement = null;

  if (cancelled || !rect || rect.right - rect.left < 4 || rect.bottom - rect.top < 4) return;
  const contained = boxElements().filter((box) => {
    const boxRect = box.getBoundingClientRect();
    const centerX = boxRect.left + boxRect.width / 2;
    const centerY = boxRect.top + boxRect.height / 2;
    return centerX >= rect.left && centerX <= rect.right
      && centerY >= rect.top && centerY <= rect.bottom;
  });

  const next = drag.additive ? new Set(selectedBoxes) : new Set();
  for (const box of contained) next.add(box);
  replaceSelection(next, contained.at(-1) || primaryBox);
  suppressNextCanvasClick = true;
  setTimeout(() => { suppressNextCanvasClick = false; }, 0);
  showToast(`${selectedBoxes.size}개 박스 선택`);
}

document.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;

  const manualButton = event.target.closest?.(".censor-preview-heading button");
  if (manualButton?.textContent.trim() === "원본" && marqueeMode) {
    setMarqueeMode(false);
    return;
  }
  if (manualButton && (manualButton.textContent.includes("수동 영역") || manualButton.textContent.includes("그리기 종료"))) {
    if (marqueeMode) setMarqueeMode(false);
    return;
  }

  const box = event.target.closest?.(".censor-box");
  if (box) {
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressNextBoxClick = true;
      toggleSelection(box);
    } else if (!selectedBoxes.has(box)) {
      replaceSelection([box], box);
    } else {
      primaryBox = box;
      syncVisualSelection();
    }
    return;
  }

  const content = event.target.closest?.(".censor-image-content");
  if (!marqueeMode || !content || event.target.closest("button, input, select")) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  marqueeDrag = {
    content,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    additive: event.ctrlKey || event.metaKey || event.shiftKey,
  };
  marqueeElement = document.createElement("div");
  marqueeElement.className = "censor-selection-marquee";
  content.appendChild(marqueeElement);
  content.setPointerCapture?.(event.pointerId);
  updateMarquee(event);
}, true);

document.addEventListener("pointermove", (event) => {
  if (!marqueeDrag) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  updateMarquee(event);
}, true);

document.addEventListener("pointerup", (event) => {
  if (!marqueeDrag) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  finishMarquee(event);
}, true);

document.addEventListener("pointercancel", () => finishMarquee(null, true), true);
document.addEventListener("mouseup", (event) => {
  if (!marqueeDrag) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  finishMarquee(event);
}, true);
window.addEventListener("blur", () => finishMarquee(null, true));

document.addEventListener("click", (event) => {
  if (syncingPrimary || replayingEdit) return;
  if (suppressNextBoxClick && event.target.closest?.(".censor-box")) {
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressNextBoxClick = false;
    return;
  }
  if (suppressNextCanvasClick && event.target.closest?.(".censor-canvas")) {
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressNextCanvasClick = false;
    return;
  }

  const box = event.target.closest?.(".censor-box");
  if (box) {
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !selectedBoxes.has(box)) {
      replaceSelection([box], box);
    }
    return;
  }

  if (event.target.closest?.(".censor-canvas") && !marqueeMode) {
    selectedBoxes.clear();
    primaryBox = null;
    syncVisualSelection();
  }
}, true);

document.addEventListener("change", (event) => {
  if (replayingEdit || selectedBoxes.size < 2) return;
  const control = event.target;
  if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) return;
  if (!control.closest(".selected-box-settings")) return;
  const descriptor = describeControl(control);
  const value = control.value;
  const checked = control instanceof HTMLInputElement && control.checked;
  const source = primaryBox;
  setTimeout(() => enqueueOperation(
    () => mirrorControlToSelection(source, descriptor, value, checked),
  ), 0);
}, true);

document.addEventListener("click", (event) => {
  if (replayingEdit || selectedBoxes.size < 2) return;
  const button = event.target.closest?.("button");
  if (!button) return;
  const text = button.textContent.trim();

  if (text === "선택 삭제" || (text === "삭제" && button.closest(".selected-box-settings"))) {
    event.preventDefault();
    event.stopImmediatePropagation();
    enqueueOperation(deleteSelection);
    return;
  }

  if (button.closest(".selected-box-settings") && (text === "초기화" || text === "기본 설정으로 되돌리기" || text === "전역 설정으로 되돌리기")) {
    event.preventDefault();
    event.stopImmediatePropagation();
    enqueueOperation(() => clickButtonForSelection(text));
  }
}, true);

document.addEventListener("keydown", (event) => {
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || isEditableTarget(event.target)) return;
  if (!selectedBoxes.size || document.querySelector("[role='alertdialog']")) return;
  const key = event.key.toLowerCase();

  if (key === "f") {
    event.preventDefault();
    event.stopImmediatePropagation();
    enqueueOperation(toggleOverridesForSelection);
    return;
  }

  const shortcut = MODE_SHORTCUTS[key];
  if (shortcut) {
    event.preventDefault();
    event.stopImmediatePropagation();
    enqueueOperation(() => setModeForSelection(shortcut.mode, shortcut.label));
  }
}, true);

const observer = new MutationObserver(() => {
  ensureMultiSelectButton();
  syncVisualSelection();
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["class"],
});

ensureMultiSelectButton();
syncVisualSelection();
