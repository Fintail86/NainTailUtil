"use strict";

const api = window.nainTail;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const DEVELOPMENT_FEATURES_STORAGE_KEY = "naitail.developmentFeaturesEnabled";
const GENERATION_PANEL_WIDTH_STORAGE_KEY = "naitail.generationPanelWidths";
const GENERATION_PANEL_DEFAULT_WIDTH = 430;
const GENERATION_PANEL_MIN_WIDTH = 320;
const GENERATION_PANEL_MAX_WIDTH = 620;
function readDevelopmentFeaturesEnabled() {
  try { return window.localStorage.getItem(DEVELOPMENT_FEATURES_STORAGE_KEY) === "true"; }
  catch { return false; }
}
function readGenerationPanelWidths() {
  const defaults = { single: GENERATION_PANEL_DEFAULT_WIDTH, multi: GENERATION_PANEL_DEFAULT_WIDTH };
  try {
    const stored = JSON.parse(window.localStorage.getItem(GENERATION_PANEL_WIDTH_STORAGE_KEY) || "null");
    if (!stored || typeof stored !== "object") return defaults;
    return Object.fromEntries(Object.entries(defaults).map(([scope, fallback]) => {
      const width = Number(stored[scope]);
      return [scope, Number.isFinite(width) && width >= GENERATION_PANEL_MIN_WIDTH && width <= GENERATION_PANEL_MAX_WIDTH ? width : fallback];
    }));
  } catch { return defaults; }
}
const state = {
  tab: "single",
  developmentFeaturesEnabled: readDevelopmentFeaturesEnabled(),
  projects: [],
  project: null,
  projectDirty: false,
  presets: [],
  preset: null,
  presetType: "sub-slot",
  presetDirty: false,
  artistStudy: null,
  artistStudyDirty: false,
  queue: { jobs: [], state: "idle" },
  results: [],
  singleResultIndex: 0,
  singlePreview: { mode: "fit", zoom: 1, pan: { x: 0, y: 0 }, imageSize: { width: 1, height: 1 }, drag: null },
  multi: { schema: "naintail.multi/v1", examplePrompt: "", exampleNegativePrompt: "", prompt: "", negativePrompt: "", characters: [], vibes: [], normalizeVibeStrengths: true, preciseReferences: [], settings: {}, slots: [], batchCount: 1, queueCount: 1 },
  multiCharacterOpenIds: new Set(),
  multiSlotOpenIds: new Set(),
  multiResults: [],
  multiSelectedResultId: null,
  artistStudyResults: [],
  artistStudyCharacterOpenIds: new Set(),
  singleCharacters: [],
  singlePreciseReferences: [],
  singleVibes: [],
  singleNormalizeVibeStrengths: true,
  singleCharacterOpenIds: new Set(),
  info: null,
  live: null,
  credential: null,
  outputSettings: null,
  subscription: null,
  subscriptionCheckedAt: 0,
  generationPanelWidths: readGenerationPanelWidths(),
  costs: { single: null, multi: null, artist: null, project: {} },
};
const titles = { single: ["GENERATION", "Single"], multi: ["VARIATION WORKSPACE", "멀티"], "artist-study": ["ARTIST LAB", "작례 연구기"], projects: ["STORY WORKSPACE", "작품 개발"], presets: ["REUSABLE LIBRARY", "프리셋"], settings: ["APPLICATION", "설정"] };
const DEFAULT_NAI_MODEL = "nai-diffusion-4-5-full";
const MODEL_SELECTION_STORAGE_KEY = "naitail.selectedModel";
const NAI_MODELS = Object.freeze({
  "nai-diffusion-5-curated": { label: "V5 Curated", defaults: { steps: 23, guidance: 7, sampler: "k_euler_ancestral", scheduler: "karras" }, scheduler: false, decrisper: false, references: false, transparency: true, lightQuality: true, ucPresets: ["Heavy", "Light", "Furry Focus", "Human Focus", "None"] },
  "nai-diffusion-5-full": { label: "V5 Full", defaults: { steps: 23, guidance: 7, sampler: "k_euler_ancestral", scheduler: "karras" }, scheduler: false, decrisper: false, references: false, transparency: true, lightQuality: true, ucPresets: ["Heavy", "Light", "Furry Focus", "Human Focus", "None"] },
  "nai-diffusion-4-5-full": { label: "V4.5 Full", defaults: { steps: 28, guidance: 5, sampler: "k_euler_ancestral", scheduler: "karras" }, scheduler: true, decrisper: true, references: true, transparency: false, lightQuality: false, ucPresets: ["Heavy", "Light", "Furry Focus", "Human Focus", "None"] },
  "nai-diffusion-4-5-curated": { label: "V4.5 Curated", defaults: { steps: 28, guidance: 5, sampler: "k_euler_ancestral", scheduler: "karras" }, scheduler: true, decrisper: true, references: true, transparency: false, lightQuality: false, ucPresets: ["Heavy", "Light", "Human Focus", "None"] },
});
function readPreferredNaiModel() {
  try {
    const model = window.localStorage.getItem(MODEL_SELECTION_STORAGE_KEY);
    return NAI_MODELS[model] ? model : DEFAULT_NAI_MODEL;
  } catch { return DEFAULT_NAI_MODEL; }
}
let preferredNaiModel = readPreferredNaiModel();
function persistPreferredNaiModel(model) {
  if (!NAI_MODELS[model]) return;
  preferredNaiModel = model;
  try { window.localStorage.setItem(MODEL_SELECTION_STORAGE_KEY, model); }
  catch { /* localStorage가 막힌 환경에서는 현재 세션에만 적용한다. */ }
}
const MAX_LOCAL_BATCH = 8;
const MAX_LOCAL_QUEUE = 20;
const MAX_LOCAL_TASKS = 100;
const costEstimateTimers = { single: null, multi: null, artist: null, project: null };

function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function id(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function localCount(form, name, maximum) {
  const value = Number(form.elements[name]?.value);
  return Number.isInteger(value) && value >= 1 && value <= maximum ? value : 0;
}
function localRepeatSummary(form, variationCount) {
  const batchCount = localCount(form, "batchCount", MAX_LOCAL_BATCH);
  const queueCount = localCount(form, "queueCount", MAX_LOCAL_QUEUE);
  const totalTasks = variationCount * batchCount * queueCount;
  return { batchCount, queueCount, totalTasks, valid: batchCount > 0 && queueCount > 0 && totalTasks > 0 && totalTasks <= MAX_LOCAL_TASKS };
}
function updateSingleGenerationSummary() {
  const summary = localRepeatSummary($("#singleForm"), 1);
  $("#singleGenerationTotal").textContent = summary.totalTasks > MAX_LOCAL_TASKS ? `최대 ${MAX_LOCAL_TASKS}장` : `총 ${summary.totalTasks || "—"}장`;
  const button = $("#singleGenerateButton");
  const cost = state.costs.single?.generationCount === summary.totalTasks ? state.costs.single : null;
  button.textContent = `큐에 추가 · ${summary.totalTasks || 0}장${cost ? ` · 예상 ${cost.totalCost} Anlas` : " · 비용 계산 중"}`;
  button.disabled = !summary.valid || Boolean(cost?.overLimit);
  button.title = summary.totalTasks > MAX_LOCAL_TASKS ? `한 번에 최대 ${MAX_LOCAL_TASKS}장까지 등록할 수 있다.` : cost?.overLimit ? `한 장 예상 비용 ${cost.maximumPerImageCost} Anlas로 NAI 제한 140을 초과한다.` : "";
  return summary;
}
function multiVariationCount() {
  return state.multi.slots.length ? state.multi.slots.filter((slot) => slot.enabled !== false).length : 1;
}
function updateMultiGenerationSummary() {
  const variations = multiVariationCount();
  const summary = localRepeatSummary($("#multiForm"), variations);
  $("#multiGenerationTotal").textContent = summary.totalTasks > MAX_LOCAL_TASKS ? `최대 ${MAX_LOCAL_TASKS}장` : `총 ${summary.totalTasks || "—"}장`;
  const button = $("#multiGenerateButton");
  const cost = state.costs.multi?.generationCount === summary.totalTasks ? state.costs.multi : null;
  button.textContent = `활성 슬롯 큐에 추가 · ${summary.totalTasks || 0}장${cost ? ` · 예상 ${cost.totalCost} Anlas` : " · 비용 계산 중"}`;
  button.disabled = !summary.valid || Boolean(cost?.overLimit);
  button.title = summary.totalTasks > MAX_LOCAL_TASKS ? `한 번에 최대 ${MAX_LOCAL_TASKS}장까지 등록할 수 있다.` : variations === 0 ? "활성 슬롯이 없다." : cost?.overLimit ? `한 장 예상 비용 ${cost.maximumPerImageCost} Anlas로 NAI 제한 140을 초과한다.` : "";
  return summary;
}

function invalidateCost(scope) {
  if (scope === "project") state.costs.project = {};
  else state.costs[scope] = null;
  if (scope === "single") updateSingleGenerationSummary();
  else if (scope === "multi") updateMultiGenerationSummary();
  else if (scope === "artist") updateArtistGenerationButtons();
  else updateProjectGenerationButtons();
}

function scheduleCostEstimate(scope) {
  clearTimeout(costEstimateTimers[scope]);
  costEstimateTimers[scope] = setTimeout(() => {
    const work = scope === "single" ? estimateSingle()
      : scope === "multi" ? estimateMulti()
        : scope === "artist" ? estimateArtistStudy()
          : estimateAllProjectCosts();
    work.catch(() => {});
  }, 180);
}
function productFileUrl(relativePath) {
  if (!state.info?.productRoot || !relativePath) return "";
  const combined = `${state.info.productRoot.replace(/\\/gu, "/").replace(/\/$/u, "")}/${String(relativePath).replace(/\\/gu, "/")}`;
  return encodeURI(`file:///${combined}`);
}
function outputFileUrl(relativePath) {
  if (!state.info?.outputRoot || !relativePath) return "";
  const root = state.info.outputRoot.replace(/\\/gu, "/").replace(/\/$/u, "");
  const portablePath = String(relativePath).replace(/\\/gu, "/").replace(/^outputs\//u, "");
  return encodeURI(`file:///${root}/${portablePath}`);
}
function notify(message, error = false) { const el = $("#notice"); el.textContent = message; el.className = `notice show${error ? " error" : ""}`; clearTimeout(notify.timer); notify.timer = setTimeout(() => { el.className = "notice"; el.textContent = ""; }, 4200); }
async function call(promise) { const response = await promise; if (!response?.ok) { const error = new Error(response?.error?.message || "요청에 실패했습니다."); error.code = response?.error?.code; throw error; } return response.result; }
async function action(work, success, trigger = null) {
  const originalText = trigger?.textContent;
  if (trigger) {
    trigger.disabled = true;
    trigger.classList.add("is-busy");
    trigger.setAttribute("aria-busy", "true");
    if (originalText) trigger.textContent = "처리 중…";
  }
  try {
    const result = await work();
    if (success) notify(success);
    return result;
  } catch (error) {
    notify(`${error.code ? `${error.code}: ` : ""}${error.message}`, true);
    throw error;
  } finally {
    if (trigger) {
      trigger.disabled = false;
      trigger.classList.remove("is-busy");
      trigger.removeAttribute("aria-busy");
      if (originalText) trigger.textContent = originalText;
    }
  }
}

function updateDirtyIndicator() {
  const dirty = state.tab === "projects" ? state.projectDirty : state.tab === "presets" ? state.presetDirty : state.tab === "artist-study" ? state.artistStudyDirty : false;
  $("#dirtyIndicator").hidden = !dirty;
}

function markDirty(kind, dirty = true) {
  if (kind === "project") state.projectDirty = dirty;
  if (kind === "preset") state.presetDirty = dirty;
  if (kind === "artist-study") state.artistStudyDirty = dirty;
  updateDirtyIndicator();
}

function confirmChoice(options = {}) {
  const dialog = $("#confirmDialog");
  const accept = $("#confirmAccept");
  const alternate = $("#confirmAlternate");
  $("#confirmTitle").textContent = options.title || "확인";
  $("#confirmMessage").textContent = options.message || "계속할까?";
  accept.textContent = options.confirmText || "확인";
  accept.className = options.danger === false ? "primary" : "danger";
  alternate.hidden = !options.alternateText;
  alternate.textContent = options.alternateText || "";
  dialog.returnValue = "cancel";
  return new Promise((resolve) => {
    const onClose = () => resolve(dialog.returnValue || "cancel");
    dialog.addEventListener("close", onClose, { once: true });
    dialog.showModal();
    $("#confirmCancel").focus();
  });
}

$("#confirmDialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) event.currentTarget.close("cancel");
});

function closeExamplePresetSaveMenu() {
  $("#examplePresetSaveMenu").hidden = true;
  $("#examplePresetSaveMenuButton").setAttribute("aria-expanded", "false");
}

function openExamplePresetNameDialog() {
  closeExamplePresetSaveMenu();
  const dialog = $("#examplePresetNameDialog");
  $("#examplePresetNameForm").reset();
  $("#examplePresetNameError").hidden = true;
  dialog.showModal();
  $("#examplePresetNameInput").focus();
}

function closeExamplePresetNameDialog() {
  if ($("#examplePresetNameDialog").dataset.busy === "true") return;
  $("#examplePresetNameDialog").close();
}

function openArtistExampleNameDialog() {
  syncArtistStudyFromDom();
  const dialog = $("#artistExampleNameDialog");
  $("#artistExampleNameForm").reset();
  $("#artistExampleNameError").hidden = true;
  dialog.showModal();
  $("#artistExampleNameInput").focus();
}

function closeArtistExampleNameDialog() {
  if ($("#artistExampleNameDialog").dataset.busy === "true") return;
  $("#artistExampleNameDialog").close();
}

$("#examplePresetNameDialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeExamplePresetNameDialog();
});
$("#examplePresetNameDialog").addEventListener("cancel", (event) => {
  if (event.currentTarget.dataset.busy === "true") event.preventDefault();
});
$("#examplePresetNameCancel").addEventListener("click", closeExamplePresetNameDialog);
$("#artistExampleNameDialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeArtistExampleNameDialog();
});
$("#artistExampleNameDialog").addEventListener("cancel", (event) => {
  if (event.currentTarget.dataset.busy === "true") event.preventDefault();
});
$("#artistExampleNameCancel").addEventListener("click", closeArtistExampleNameDialog);
document.addEventListener("click", (event) => {
  if (!event.target.closest(".inline-preset-save")) closeExamplePresetSaveMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeExamplePresetSaveMenu();
});

function settingsHtml(settings = {}, prefix = "settings") {
  const value = (key, fallback) => settings[key] ?? fallback;
  const model = NAI_MODELS[value("model", preferredNaiModel)] ? value("model", preferredNaiModel) : preferredNaiModel;
  const definition = NAI_MODELS[model];
  const qualityPreset = value("qualityPreset", value("qualityTags", true) === false ? "None" : "Standard");
  const qualityOptions = definition.lightQuality ? ["Standard", "Light", "None"] : ["Standard", "None"];
  const transparencyAvailable = definition.transparency && ["settings", "multi"].includes(prefix);
  const transparencyMode = value("transparencyMode", value("transparentBackground", false) === true ? "transparent-background" : "none");
  const transparencyOptions = [
    ["none", "사용 안 함"],
    ["transparent-background", "투명 배경"],
    ["has-alpha", "알파 채널 활용"],
    ["alpha-transparency", "반투명 효과"],
  ];
  const basic = `<input type="hidden" name="${prefix}.model" value="${esc(model)}">
    <label>Width<input name="${prefix}.width" type="number" min="64" max="2048" step="64" value="${esc(value("width", 832))}"></label>
    <label>Height<input name="${prefix}.height" type="number" min="64" max="2048" step="64" value="${esc(value("height", 1216))}"></label>
    <label>Steps<input name="${prefix}.steps" type="number" min="1" max="50" value="${esc(value("steps", definition.defaults.steps))}"></label>
    <label>Guidance<input name="${prefix}.guidance" type="number" min="0" max="20" step="0.1" value="${esc(value("guidance", definition.defaults.guidance))}"></label>
    <label class="checkbox span2 setting-metadata" title="체크를 끄면 저장 PNG에서 NovelAI 및 NainTail 생성정보를 제거합니다."><input name="${prefix}.includeMetadata" type="checkbox" ${value("includeMetadata", true) !== false ? "checked" : ""}> EXIF / 생성정보 포함</label>`;
  const advanced = `<label class="span2 setting-sampler">Sampler<select name="${prefix}.sampler"><option value="k_euler_ancestral">Euler Ancestral</option><option value="k_dpmpp_2m">DPM++ 2M</option><option value="k_euler">Euler</option><option value="k_dpm_2">DPM2</option><option value="k_dpmpp_2s_ancestral">DPM++ 2S Ancestral</option><option value="k_dpmpp_sde">DPM++ SDE</option><option value="k_dpm_fast">DPM Fast</option><option value="ddim">DDIM</option></select></label>
    ${definition.scheduler ? `<label>Scheduler<select name="${prefix}.scheduler"><option value="karras">Karras</option><option value="native">Native</option><option value="exponential">Exponential</option><option value="polyexponential">Polyexponential</option></select></label>` : `<input type="hidden" name="${prefix}.scheduler" value="karras">`}
    <label>Seed<input name="${prefix}.seed" type="number" min="0" placeholder="Random" value="${esc(value("seed", ""))}"></label>
    <label>Guidance Rescale<input name="${prefix}.cfgRescale" type="number" min="0" max="1" step="0.02" value="${esc(value("cfgRescale", 0))}"></label>
    <label>UC preset<select name="${prefix}.ucPreset">${definition.ucPresets.map((x) => `<option ${value("ucPreset", "Heavy") === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>
    <label>Quality preset<select name="${prefix}.qualityPreset">${qualityOptions.map((x) => `<option ${qualityPreset === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>
    ${definition.decrisper ? `<label class="checkbox"><input name="${prefix}.decrisper" type="checkbox" ${value("decrisper", false) === true ? "checked" : ""}> Decrisper</label>` : `<input type="hidden" name="${prefix}.decrisper" value="false">`}
    ${transparencyAvailable ? `<label>Transparency<select name="${prefix}.transparencyMode" title="V5 알파 채널 생성 방식">${transparencyOptions.map(([id, label]) => `<option value="${id}" ${transparencyMode === id ? "selected" : ""}>${label}</option>`).join("")}</select></label>` : ""}`;
  if (!["settings", "study", "multi"].includes(prefix)) return `${basic}${advanced}`;
  const summary = definition.scheduler ? "Sampler · Scheduler · Rescale · Decrisper · Seed · UC" : `Sampler · Rescale · Seed · UC${transparencyAvailable ? " · 투명화" : ""}`;
  return `${basic}<details class="single-advanced-settings"><summary><span><strong>고급 설정</strong><small>${summary}</small></span><span class="advanced-settings-chevron" aria-hidden="true">⌄</span></summary><div class="single-advanced-grid">${advanced}</div></details>`;
}

function readSettings(form, prefix = "settings") {
  const get = (name) => form.elements.namedItem(`${prefix}.${name}`);
  const qualityPreset = get("qualityPreset")?.value || "Standard";
  const transparencyMode = get("transparencyMode")?.value || "none";
  return { model: get("model")?.value || DEFAULT_NAI_MODEL, width: Number(get("width").value), height: Number(get("height").value), steps: Number(get("steps").value), guidance: Number(get("guidance").value), sampler: get("sampler").value, scheduler: get("scheduler")?.value || "karras", seed: get("seed").value === "" ? null : Number(get("seed").value), cfgRescale: Number(get("cfgRescale").value), decrisper: get("decrisper")?.checked === true, includeMetadata: get("includeMetadata")?.checked !== false, ucPreset: get("ucPreset").value, qualityPreset, qualityTags: qualityPreset !== "None", transparencyMode, transparentBackground: transparencyMode !== "none" };
}

function writeSettings(form, settings = {}, prefix = "settings") {
  for (const key of ["model", "width", "height", "steps", "guidance", "sampler", "scheduler", "seed", "cfgRescale", "ucPreset", "qualityPreset"]) {
    const field = form.elements.namedItem(`${prefix}.${key}`);
    if (field) field.value = settings[key] ?? (key === "seed" ? "" : field.value);
  }
  const decrisper = form.elements.namedItem(`${prefix}.decrisper`);
  if (decrisper) decrisper.checked = settings.decrisper === true;
  const includeMetadata = form.elements.namedItem(`${prefix}.includeMetadata`);
  if (includeMetadata) includeMetadata.checked = settings.includeMetadata !== false;
  const transparencyMode = form.elements.namedItem(`${prefix}.transparencyMode`);
  if (transparencyMode) transparencyMode.value = settings.transparencyMode || (settings.transparentBackground === true ? "transparent-background" : "none");
}

function settingsContextForTab(tab = state.tab) {
  if (tab === "single") return { form: $("#singleForm"), prefix: "settings", container: $("[data-settings-scope=single]") };
  if (tab === "multi") return { form: $("#multiForm"), prefix: "multi", container: $("[data-settings-scope=multi]") };
  if (tab === "artist-study" && state.artistStudy) return { form: $("#artistStudyForm"), prefix: "study", container: $("[data-settings-scope=artist-study]") };
  if (tab === "projects" && state.project && $("#projectForm")) return { form: $("#projectForm"), prefix: "common", container: $("[data-project-settings]") };
  return null;
}

function syncHeaderModelSelector() {
  const context = settingsContextForTab();
  const selector = $("#modelSelector");
  const model = context?.form?.elements.namedItem(`${context.prefix}.model`)?.value;
  selector.disabled = !context;
  $("#modelSelectorWrap").classList.toggle("disabled", !context);
  if (model && NAI_MODELS[model]) selector.value = model;
  selector.title = context ? `${NAI_MODELS[selector.value].label} · 현재 화면의 생성 모델` : "이 화면에는 생성 모델 설정이 없다.";
}

function renderModelCapabilities(scope) {
  const model = modelFor(scope);
  const definition = NAI_MODELS[model] || NAI_MODELS[DEFAULT_NAI_MODEL];
  const unavailable = $(`#${scope}ReferenceUnavailable`);
  const block = unavailable?.closest(".precise-reference-block");
  const body = block?.querySelector(".reference-tools-body");
  if (unavailable) unavailable.hidden = definition.references;
  if (body) body.hidden = !definition.references;
  block?.classList.toggle("model-feature-unavailable", !definition.references);
  updateReferenceSummary(scope);
}

function switchTab(tab) { state.tab = tab; $$(".tab").forEach((el) => el.classList.toggle("active", el.dataset.tab === tab)); $$(".view").forEach((el) => el.classList.toggle("active", el.id === `view-${tab}`)); $("#mainWorkspace").classList.toggle("single-workspace-mode", tab === "single"); $("#mainWorkspace").classList.toggle("multi-workspace-mode", tab === "multi"); $("#pageEyebrow").textContent = titles[tab][0]; $("#pageTitle").textContent = titles[tab][1]; if (tab === "single" || tab === "multi") renderModelCapabilities(tab); syncHeaderModelSelector(); updateDirtyIndicator(); }

function renderDevelopmentFeatures() {
  const enabled = state.developmentFeaturesEnabled;
  $$('[data-development-feature="true"]').forEach((tab) => {
    tab.hidden = !enabled;
    tab.setAttribute("aria-hidden", String(!enabled));
  });
  $("#developmentFeaturesEnabled").checked = enabled;
  $("#developmentFeaturesState").textContent = enabled ? "상태 · 사용" : "상태 · 사용 안 함";
}

function setDevelopmentFeaturesEnabled(enabled) {
  state.developmentFeaturesEnabled = Boolean(enabled);
  try { window.localStorage.setItem(DEVELOPMENT_FEATURES_STORAGE_KEY, String(state.developmentFeaturesEnabled)); }
  catch { /* localStorage가 막힌 환경에서는 현재 세션에만 적용한다. */ }
  if (!state.developmentFeaturesEnabled && ["artist-study", "projects"].includes(state.tab)) switchTab("single");
  renderDevelopmentFeatures();
}

function generationPanelWorkspace(scope) {
  return scope === "single" ? $(".single-generation-workspace") : scope === "multi" ? $(".multi-generation-workspace") : null;
}

function generationPanelWidthBounds(scope, workspace = generationPanelWorkspace(scope)) {
  const available = workspace?.getBoundingClientRect().width || 0;
  const reserved = scope === "single" ? 334 : 670;
  return {
    min: GENERATION_PANEL_MIN_WIDTH,
    max: Math.max(GENERATION_PANEL_MIN_WIDTH, Math.min(GENERATION_PANEL_MAX_WIDTH, available ? available - reserved : GENERATION_PANEL_MAX_WIDTH)),
  };
}

function persistGenerationPanelWidths() {
  try { window.localStorage.setItem(GENERATION_PANEL_WIDTH_STORAGE_KEY, JSON.stringify(state.generationPanelWidths)); }
  catch { /* localStorage가 막힌 환경에서는 현재 세션에만 적용한다. */ }
}

function setGenerationPanelWidth(scope, width, { persist = false } = {}) {
  const workspace = generationPanelWorkspace(scope);
  const handle = $(`[data-generation-resizer="${scope}"]`);
  if (!workspace || !handle) return;
  const bounds = generationPanelWidthBounds(scope, workspace);
  const next = Math.round(Math.min(bounds.max, Math.max(bounds.min, Number(width) || GENERATION_PANEL_DEFAULT_WIDTH)));
  state.generationPanelWidths[scope] = next;
  workspace.style.setProperty(`--${scope}-generation-panel-width`, `${next}px`);
  handle.setAttribute("aria-valuemin", String(bounds.min));
  handle.setAttribute("aria-valuemax", String(bounds.max));
  handle.setAttribute("aria-valuenow", String(next));
  handle.title = `${next}px · 드래그해서 생성 영역 폭 조절 · 더블클릭으로 초기화`;
  if (persist) persistGenerationPanelWidths();
}

function initGenerationPanelResizers() {
  $$("[data-generation-resizer]").forEach((handle) => {
    const scope = handle.dataset.generationResizer;
    let pointerId = null;
    const finish = (event) => {
      if (pointerId === null || (event?.pointerId !== undefined && event.pointerId !== pointerId)) return;
      pointerId = null;
      handle.classList.remove("dragging");
      document.body.classList.remove("resizing-generation-panel");
      persistGenerationPanelWidths();
    };
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      pointerId = event.pointerId;
      handle.setPointerCapture(pointerId);
      handle.classList.add("dragging");
      document.body.classList.add("resizing-generation-panel");
      event.preventDefault();
    });
    handle.addEventListener("pointermove", (event) => {
      if (pointerId !== event.pointerId) return;
      const workspace = generationPanelWorkspace(scope);
      setGenerationPanelWidth(scope, event.clientX - workspace.getBoundingClientRect().left);
      event.preventDefault();
    });
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    handle.addEventListener("dblclick", () => setGenerationPanelWidth(scope, GENERATION_PANEL_DEFAULT_WIDTH, { persist: true }));
    handle.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
      const step = event.shiftKey ? 40 : 10;
      const width = event.key === "Home" ? GENERATION_PANEL_DEFAULT_WIDTH : state.generationPanelWidths[scope] + (event.key === "ArrowRight" ? step : -step);
      setGenerationPanelWidth(scope, width, { persist: true });
      event.preventDefault();
    });
    setGenerationPanelWidth(scope, state.generationPanelWidths[scope]);
  });
}

function positionGridHtml(position) {
  const selected = position || "";
  const cells = ["1", "2", "3", "4", "5"].flatMap((row) => ["a", "b", "c", "d", "e"].map((column) => `${column}${row}`));
  return `<details class="character-position"><summary>위치 <strong>${selected ? selected.toUpperCase() : "AI 선택"}</strong></summary><div class="position-picker"><button type="button" class="position-auto ${selected ? "" : "active"}" data-character-position="" aria-pressed="${String(!selected)}">AI 선택</button><div class="position-grid" role="grid" aria-label="캐릭터 5×5 위치">${cells.map((cell) => `<button type="button" class="${selected === cell ? "active" : ""}" data-character-position="${cell}" aria-label="${cell.toUpperCase()} 위치" aria-pressed="${String(selected === cell)}" title="${cell.toUpperCase()}">${cell.toUpperCase()}</button>`).join("")}</div><p>위치는 강제 좌표가 아니라 모델에 주는 대략적인 힌트다.</p></div></details>`;
}

function singleCharacterRows() {
  if (!state.singleCharacters.length) return `<div class="single-character-empty"><span>캐릭터 없음</span><small>일반 싱글 생성</small></div>`;
  return state.singleCharacters.map((character, index) => `<details class="single-character-card" data-single-character-index="${index}" data-single-character-id="${esc(character.id)}" ${state.singleCharacterOpenIds.has(character.id) ? "open" : ""}><summary><span><small class="character-use-state ${character.enabled !== false ? "" : "off"}">${character.enabled !== false ? "사용" : "미사용"}</small><strong>${esc(character.name || `캐릭터 ${index + 1}`)}</strong></span><span class="character-summary-meta"><small>${character.position ? character.position.toUpperCase() : "AI 위치"}</small><span class="character-card-chevron" aria-hidden="true">⌄</span></span></summary><div class="single-character-card-body"><header><label class="checkbox"><input data-single-character-field="enabled" type="checkbox" ${character.enabled !== false ? "checked" : ""}> 사용</label><div class="character-order-tools"><button type="button" data-single-character-action="up" aria-label="위로 이동">↑</button><button type="button" data-single-character-action="down" aria-label="아래로 이동">↓</button><button type="button" data-single-character-action="delete" class="danger" aria-label="삭제">×</button></div></header><label>이름<input data-single-character-field="name" value="${esc(character.name)}"></label><div class="character-prompts"><label>Character Prompt<input data-single-character-field="prompt" value="${esc(character.prompt)}" placeholder="girl, black hair, source#hug"></label><label>Character UC<input data-single-character-field="negativePrompt" value="${esc(character.negativePrompt)}" placeholder="원하지 않는 캐릭터 속성"></label></div>${positionGridHtml(character.position)}</div></details>`).join("");
}

function renderSingleCharacters() {
  $("#singleCharacters").innerHTML = singleCharacterRows();
  $("#singleCharacterCount").textContent = `${state.singleCharacters.length} / 6`;
  $("#addSingleCharacter").disabled = state.singleCharacters.length >= 6;
}

function preciseReferencesFor(scope) {
  return scope === "single" ? state.singlePreciseReferences : state.multi.preciseReferences;
}

function vibesFor(scope) {
  return scope === "single" ? state.singleVibes : state.multi.vibes;
}

function vibeNormalizationFor(scope, value) {
  if (value === undefined) return scope === "single" ? state.singleNormalizeVibeStrengths : state.multi.normalizeVibeStrengths;
  if (scope === "single") state.singleNormalizeVibeStrengths = Boolean(value);
  else state.multi.normalizeVibeStrengths = Boolean(value);
  return Boolean(value);
}

function modelFor(scope) {
  const form = $(`#${scope}Form`);
  return readSettings(form, scope === "single" ? "settings" : "multi").model;
}

function updateReferenceSummary(scope) {
  const vibes = vibesFor(scope).length;
  const precise = preciseReferencesFor(scope).length;
  const definition = NAI_MODELS[modelFor(scope)] || NAI_MODELS[DEFAULT_NAI_MODEL];
  $(`#${scope}ReferenceCount`).textContent = definition.references ? `Vibe ${vibes} · Precise ${precise}` : `V5 미지원 · ${vibes + precise}개 보존`;
}

function preciseReferenceRows(references) {
  if (!references.length) return `<p class="muted">등록된 이미지 참조가 없다.</p>`;
  return references.map((reference, index) => `<article class="precise-reference-card" data-reference-index="${index}">
    <img src="${esc(productFileUrl(reference.relativePath))}" alt="${esc(reference.name)} 참조 미리보기">
    <div class="precise-reference-controls">
      <header><strong title="${esc(reference.name)}">${esc(reference.name)}</strong><button type="button" class="danger" data-reference-remove aria-label="이미지 참조 삭제">×</button></header>
      <label class="precise-reference-mode"><span>종류</span><select data-reference-field="mode"><option value="character&style" ${reference.mode === "character&style" ? "selected" : ""}>Character &amp; Style</option><option value="character" ${reference.mode === "character" ? "selected" : ""}>Character</option><option value="style" ${reference.mode === "style" ? "selected" : ""}>Style</option></select></label>
      <label class="precise-reference-slider"><span class="precise-reference-slider-meta"><span>Strength</span><output>${Number(reference.strength).toFixed(2)}</output></span><input type="range" data-reference-field="strength" min="-1" max="1" step="0.05" value="${esc(reference.strength)}"></label>
      <label class="precise-reference-slider"><span class="precise-reference-slider-meta"><span>Fidelity</span><output>${Number(reference.fidelity).toFixed(2)}</output></span><input type="range" data-reference-field="fidelity" min="-1" max="1" step="0.05" value="${esc(reference.fidelity)}"></label>
    </div>
  </article>`).join("");
}

function renderPreciseReferences(scope) {
  const references = preciseReferencesFor(scope);
  const supported = (NAI_MODELS[modelFor(scope)] || NAI_MODELS[DEFAULT_NAI_MODEL]).references;
  $(`#${scope}ReferenceList`).innerHTML = preciseReferenceRows(references);
  $(`#${scope}PreciseCount`).textContent = `${references.length} / 16`;
  const add = $(`#add${scope === "single" ? "Single" : "Multi"}Reference`);
  add.disabled = !supported || references.length >= 16 || vibesFor(scope).length > 0;
  add.title = !supported ? "선택한 V5 모델은 아직 Precise Reference를 지원하지 않는다." : vibesFor(scope).length ? "Vibe Transfer와 Precise Reference는 동시에 사용할 수 없다." : "";
  updateReferenceSummary(scope);
}

function vibeRows(vibes) {
  if (!vibes.length) return `<p class="muted">등록된 Vibe가 없다.</p>`;
  return vibes.map((vibe, index) => `<article class="precise-reference-card vibe-reference-card" data-vibe-index="${index}">
    <img src="${esc(productFileUrl(vibe.relativePath))}" alt="${esc(vibe.name)} Vibe 미리보기">
    <div class="precise-reference-controls">
      <header><strong title="${esc(vibe.name)}">${esc(vibe.name)}</strong><span class="vibe-cache-state ${vibe.cached ? "cached" : ""}">${vibe.cached ? "인코딩 캐시" : "인코딩 필요"}</span><button type="button" class="danger" data-vibe-remove aria-label="Vibe 삭제">×</button></header>
      <label class="precise-reference-slider"><span class="precise-reference-slider-meta"><span>Strength</span><output>${Number(vibe.strength).toFixed(2)}</output></span><input type="range" data-vibe-field="strength" min="0" max="1" step="0.05" value="${esc(vibe.strength)}"></label>
      <label class="precise-reference-slider"><span class="precise-reference-slider-meta"><span>Info Extracted</span><output>${Number(vibe.informationExtracted).toFixed(2)}</output></span><input type="range" data-vibe-field="informationExtracted" min="0.01" max="1" step="0.01" value="${esc(vibe.informationExtracted)}"></label>
    </div>
  </article>`).join("");
}

function renderVibes(scope) {
  const vibes = vibesFor(scope);
  const supported = (NAI_MODELS[modelFor(scope)] || NAI_MODELS[DEFAULT_NAI_MODEL]).references;
  $(`#${scope}VibeList`).innerHTML = vibeRows(vibes);
  $(`#${scope}VibeCount`).textContent = `${vibes.length} / 16`;
  $(`#${scope}NormalizeVibes`).checked = vibeNormalizationFor(scope);
  const add = $(`#add${scope === "single" ? "Single" : "Multi"}Vibe`);
  add.disabled = !supported || vibes.length >= 16 || preciseReferencesFor(scope).length > 0;
  add.title = !supported ? "선택한 V5 모델은 아직 Vibe Transfer를 지원하지 않는다." : preciseReferencesFor(scope).length ? "Precise Reference와 Vibe Transfer는 동시에 사용할 수 없다." : "";
  updateReferenceSummary(scope);
}

function processVibeImage(picked) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      if (!width || !height || width > 8192 || height > 8192 || width * height > 40_000_000) {
        reject(new Error("Vibe 이미지는 최대 8192px, 4천만 픽셀까지 사용할 수 있습니다."));
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(image, 0, 0);
      resolve({ name: picked.name, imageBase64: canvas.toDataURL("image/png").split(",")[1], width, height });
    };
    image.onerror = () => reject(new Error("선택한 Vibe 이미지를 읽을 수 없습니다."));
    image.src = `data:${picked.mimeType};base64,${picked.imageBase64}`;
  });
}

function defaultVibeInformation(scope) {
  return modelFor(scope) === "nai-diffusion-4-5-full" ? 0.7 : 1;
}

async function refreshVibeCacheStatus(scope) {
  const vibes = vibesFor(scope);
  if (!vibes.length) return;
  const status = await call(api.getVibeCacheStatus(vibes, modelFor(scope)));
  const byId = new Map(status.map((item) => [item.id, item.cached]));
  vibes.forEach((vibe) => { vibe.cached = Boolean(byId.get(vibe.id)); });
  renderVibes(scope);
}

async function addVibe(scope, trigger) {
  if (!(NAI_MODELS[modelFor(scope)] || NAI_MODELS[DEFAULT_NAI_MODEL]).references) throw new Error("Vibe Transfer는 현재 V4.5 모델에서만 사용할 수 있습니다.");
  if (preciseReferencesFor(scope).length) throw new Error("Precise Reference를 먼저 비워야 Vibe Transfer를 사용할 수 있습니다.");
  const picked = await action(() => call(api.pickReferenceImage()), null, trigger);
  if (!picked) return;
  const processed = await processVibeImage(picked);
  const saved = await action(() => call(api.saveVibeImage({ ...processed, informationExtracted: defaultVibeInformation(scope) })), null, trigger);
  vibesFor(scope).push({ ...saved, cached: false });
  renderVibes(scope);
  renderPreciseReferences(scope);
  await refreshVibeCacheStatus(scope);
  if (scope === "single") await estimateSingle();
  else await estimateMulti();
  notify(`${saved.name}을 Vibe Transfer로 추가했다.`);
}

function bindVibeList(scope) {
  const container = $(`#${scope}VibeList`);
  container.addEventListener("input", (event) => {
    const field = event.target.dataset.vibeField;
    if (!field) return;
    const vibe = vibesFor(scope)[Number(event.target.closest("[data-vibe-index]").dataset.vibeIndex)];
    vibe[field] = Number(event.target.value);
    if (field === "informationExtracted") vibe.cached = false;
    event.target.closest("label").querySelector("output").textContent = Number(event.target.value).toFixed(2);
    if (field === "informationExtracted") {
      const badge = event.target.closest(".vibe-reference-card").querySelector(".vibe-cache-state");
      badge.textContent = "인코딩 필요";
      badge.classList.remove("cached");
    }
  });
  container.addEventListener("change", async (event) => {
    if (!event.target.dataset.vibeField) return;
    if (event.target.dataset.vibeField === "informationExtracted") await refreshVibeCacheStatus(scope);
    if (scope === "single") await estimateSingle();
    else await estimateMulti();
  });
  container.addEventListener("click", async (event) => {
    if (!event.target.hasAttribute("data-vibe-remove")) return;
    vibesFor(scope).splice(Number(event.target.closest("[data-vibe-index]").dataset.vibeIndex), 1);
    renderVibes(scope);
    renderPreciseReferences(scope);
    if (scope === "single") await estimateSingle();
    else await estimateMulti();
  });
}

function processPreciseReferenceImage(picked) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const ratio = image.naturalWidth / image.naturalHeight;
      const candidates = [[1024, 1536], [1536, 1024], [1472, 1472]];
      let target = candidates[0];
      for (const candidate of candidates) {
        if (Math.abs(candidate[0] / candidate[1] - ratio) < Math.abs(target[0] / target[1] - ratio)) target = candidate;
      }
      const [width, height] = target;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      context.fillStyle = "#000000";
      context.fillRect(0, 0, width, height);
      const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
      const drawnWidth = image.naturalWidth * scale;
      const drawnHeight = image.naturalHeight * scale;
      context.drawImage(image, (width - drawnWidth) / 2, (height - drawnHeight) / 2, drawnWidth, drawnHeight);
      resolve({ name: picked.name, imageBase64: canvas.toDataURL("image/png").split(",")[1], width, height });
    };
    image.onerror = () => reject(new Error("선택한 참조 이미지를 읽을 수 없습니다."));
    image.src = `data:${picked.mimeType};base64,${picked.imageBase64}`;
  });
}

async function addPreciseReference(scope, trigger) {
  if (!(NAI_MODELS[modelFor(scope)] || NAI_MODELS[DEFAULT_NAI_MODEL]).references) throw new Error("Precise Reference는 현재 V4.5 모델에서만 사용할 수 있습니다.");
  if (vibesFor(scope).length) throw new Error("Vibe Transfer를 먼저 비워야 Precise Reference를 사용할 수 있습니다.");
  const picked = await action(() => call(api.pickReferenceImage()), null, trigger);
  if (!picked) return;
  const processed = await processPreciseReferenceImage(picked);
  const saved = await action(() => call(api.saveReferenceImage(processed)), null, trigger);
  preciseReferencesFor(scope).push(saved);
  renderPreciseReferences(scope);
  renderVibes(scope);
  if (scope === "single") await estimateSingle();
  else await estimateMulti();
  notify(`${saved.name}을 V4.5 이미지 참조로 추가했다.`);
}

function bindPreciseReferenceList(scope) {
  const container = $(`#${scope}ReferenceList`);
  container.addEventListener("input", (event) => {
    const field = event.target.dataset.referenceField;
    if (!field || !["strength", "fidelity"].includes(field)) return;
    const reference = preciseReferencesFor(scope)[Number(event.target.closest("[data-reference-index]").dataset.referenceIndex)];
    reference[field] = Number(event.target.value);
    event.target.closest("label").querySelector("output").textContent = Number(event.target.value).toFixed(2);
  });
  container.addEventListener("change", async (event) => {
    const field = event.target.dataset.referenceField;
    if (!field) return;
    const reference = preciseReferencesFor(scope)[Number(event.target.closest("[data-reference-index]").dataset.referenceIndex)];
    reference[field] = field === "mode" ? event.target.value : Number(event.target.value);
    if (scope === "single") await estimateSingle();
    else await estimateMulti();
  });
  container.addEventListener("click", async (event) => {
    if (!event.target.hasAttribute("data-reference-remove")) return;
    const index = Number(event.target.closest("[data-reference-index]").dataset.referenceIndex);
    preciseReferencesFor(scope).splice(index, 1);
    renderPreciseReferences(scope);
    renderVibes(scope);
    if (scope === "single") await estimateSingle();
    else await estimateMulti();
  });
}

function syncSingleCharactersFromDom() {
  $$("[data-single-character-index]", $("#singleCharacters")).forEach((card) => {
    const character = state.singleCharacters[Number(card.dataset.singleCharacterIndex)];
    if (!character) return;
    if (card.open) state.singleCharacterOpenIds.add(character.id);
    else state.singleCharacterOpenIds.delete(character.id);
    character.enabled = $("[data-single-character-field=enabled]", card).checked;
    character.name = $("[data-single-character-field=name]", card).value;
    character.prompt = $("[data-single-character-field=prompt]", card).value;
    character.negativePrompt = $("[data-single-character-field=negativePrompt]", card).value;
  });
}

function multiCharacterRows() {
  const characters = state.multi.characters || [];
  if (!characters.length) return `<div class="single-character-empty"><span>캐릭터 없음</span><small>모든 슬롯에 공통 적용</small></div>`;
  return characters.map((character, index) => `<details class="single-character-card" data-multi-character-index="${index}" ${state.multiCharacterOpenIds.has(character.id) ? "open" : ""}><summary><span><small class="character-use-state ${character.enabled !== false ? "" : "off"}">${character.enabled !== false ? "사용" : "미사용"}</small><strong>${esc(character.name || `캐릭터 ${index + 1}`)}</strong></span><span class="character-summary-meta"><small>${character.position ? character.position.toUpperCase() : "AI 위치"}</small><span class="character-card-chevron" aria-hidden="true">⌄</span></span></summary><div class="single-character-card-body"><header><label class="checkbox"><input data-multi-character-field="enabled" type="checkbox" ${character.enabled !== false ? "checked" : ""}> 사용</label><div class="character-order-tools"><button type="button" data-multi-character-action="up">↑</button><button type="button" data-multi-character-action="down">↓</button><button type="button" data-multi-character-action="delete" class="danger">×</button></div></header><label>이름<input data-multi-character-field="name" value="${esc(character.name)}"></label><div class="character-prompts"><label>Character Prompt<input data-multi-character-field="prompt" value="${esc(character.prompt)}" placeholder="girl, black hair"></label><label>Character UC<input data-multi-character-field="negativePrompt" value="${esc(character.negativePrompt)}"></label></div>${positionGridHtml(character.position)}</div></details>`).join("");
}

function renderMultiCharacters() {
  $("#multiCharacters").innerHTML = multiCharacterRows();
  $("#multiCharacterCount").textContent = `${state.multi.characters.length} / 6`;
  $("#addMultiCharacter").disabled = state.multi.characters.length >= 6;
}

function syncMultiCharactersFromDom() {
  $$('[data-multi-character-index]', $("#multiCharacters")).forEach((card) => {
    const character = state.multi.characters[Number(card.dataset.multiCharacterIndex)];
    if (!character) return;
    if (card.open) state.multiCharacterOpenIds.add(character.id);
    else state.multiCharacterOpenIds.delete(character.id);
    character.enabled = $("[data-multi-character-field=enabled]", card).checked;
    character.name = $("[data-multi-character-field=name]", card).value;
    character.prompt = $("[data-multi-character-field=prompt]", card).value;
    character.negativePrompt = $("[data-multi-character-field=negativePrompt]", card).value;
  });
}

function multiSlotRows() {
  if (!state.multi.slots.length) return `<div class="multi-slot-empty"><span>＋</span><strong>슬롯이 없다.</strong><p>슬롯이 없으면 공통 프롬프트 한 장을 생성한다.</p></div>`;
  return state.multi.slots.map((slot, index) => `<details class="multi-slot-card ${slot.enabled !== false ? "" : "excluded"}" data-multi-slot-index="${index}" ${state.multiSlotOpenIds.has(slot.id) ? "open" : ""}><summary><label class="checkbox" title="이 슬롯 출력"><input data-multi-slot-field="enabled" type="checkbox" ${slot.enabled !== false ? "checked" : ""}><span>${index + 1}</span></label><input type="text" data-multi-slot-field="name" value="${esc(slot.name)}" aria-label="슬롯 ${index + 1} 이름"><div class="multi-slot-tools"><button type="button" data-multi-slot-action="up" aria-label="슬롯 위로">↑</button><button type="button" data-multi-slot-action="down" aria-label="슬롯 아래로">↓</button><button type="button" data-multi-slot-action="delete" class="danger" aria-label="슬롯 삭제">×</button></div></summary><div class="multi-slot-card-body"><label>Prompt<textarea data-multi-slot-field="prompt" rows="3" placeholder="이 슬롯에서 추가할 표정·배경·포즈">${esc(slot.prompt)}</textarea></label><label>Undesired Content<textarea data-multi-slot-field="negativePrompt" rows="2" placeholder="이 슬롯에서만 제외할 내용">${esc(slot.negativePrompt)}</textarea></label></div></details>`).join("");
}

function renderMultiSlots() {
  $("#multiSlotList").innerHTML = multiSlotRows();
  const selected = state.multi.slots.filter((slot) => slot.enabled !== false).length;
  $("#multiSlotCount").textContent = `${state.multi.slots.length} / 20`;
  $("#multiSelectedSlotCount").textContent = state.multi.slots.length ? `${selected}개 출력` : "공통 1개 출력";
  $("#addMultiSlot").disabled = state.multi.slots.length >= 20;
  $("#selectAllMultiSlots").disabled = !state.multi.slots.length || selected === state.multi.slots.length;
  $("#clearAllMultiSlots").disabled = !selected;
  $("#invertMultiSlots").disabled = !state.multi.slots.length;
  $("#appendMultiSlotPreset").disabled = !$("#multiSlotPreset").value || state.multi.slots.length >= 20;
  updateMultiGenerationSummary();
  invalidateCost("multi");
  scheduleCostEstimate("multi");
}

function syncMultiSlotsFromDom() {
  $$('[data-multi-slot-index]', $("#multiSlotList")).forEach((card) => {
    const slot = state.multi.slots[Number(card.dataset.multiSlotIndex)];
    if (!slot) return;
    if (card.open) state.multiSlotOpenIds.add(slot.id);
    else state.multiSlotOpenIds.delete(slot.id);
    slot.enabled = $("[data-multi-slot-field=enabled]", card).checked;
    slot.name = $("[data-multi-slot-field=name]", card).value;
    slot.prompt = $("[data-multi-slot-field=prompt]", card).value;
    slot.negativePrompt = $("[data-multi-slot-field=negativePrompt]", card).value;
  });
}

function syncMultiFromDom() {
  const form = $("#multiForm");
  state.multi.examplePrompt = form.elements.examplePrompt.value;
  state.multi.exampleNegativePrompt = form.elements.exampleNegativePrompt.value;
  state.multi.prompt = form.elements.prompt.value;
  state.multi.negativePrompt = form.elements.negativePrompt.value;
  state.multi.batchCount = Number(form.elements.batchCount.value);
  state.multi.queueCount = Number(form.elements.queueCount.value);
  state.multi.normalizeVibeStrengths = form.querySelector("#multiNormalizeVibes").checked;
  state.multi.settings = readSettings(form, "multi");
  syncMultiCharactersFromDom();
  syncMultiSlotsFromDom();
}

function renderMulti() {
  const form = $("#multiForm");
  form.elements.examplePrompt.value = state.multi.examplePrompt || "";
  form.elements.exampleNegativePrompt.value = state.multi.exampleNegativePrompt || "";
  form.elements.prompt.value = state.multi.prompt || "";
  form.elements.negativePrompt.value = state.multi.negativePrompt || "";
  form.elements.batchCount.value = state.multi.batchCount || 1;
  form.elements.queueCount.value = state.multi.queueCount || 1;
  $("[data-settings-scope=multi]").innerHTML = settingsHtml(state.multi.settings || {}, "multi");
  writeSettings(form, state.multi.settings || {}, "multi");
  state.multi.vibes = Array.isArray(state.multi.vibes) ? state.multi.vibes : [];
  state.multi.normalizeVibeStrengths = state.multi.normalizeVibeStrengths !== false;
  state.multi.preciseReferences = Array.isArray(state.multi.preciseReferences) ? state.multi.preciseReferences : [];
  renderMultiCharacters();
  renderVibes("multi");
  renderPreciseReferences("multi");
  renderModelCapabilities("multi");
  renderMultiSlots();
  renderMultiResults();
  if (state.tab === "multi") syncHeaderModelSelector();
}

function artistStudyCharacterRows() {
  const characters = state.artistStudy?.characters || [];
  if (!characters.length) return `<div class="single-character-empty"><span>캐릭터 없음</span><small>일반 작례 연구</small></div>`;
  return characters.map((character, index) => `<details class="single-character-card" data-study-character-index="${index}" data-study-character-id="${esc(character.id)}" ${state.artistStudyCharacterOpenIds.has(character.id) ? "open" : ""}><summary><span><small class="character-use-state ${character.enabled !== false ? "" : "off"}">${character.enabled !== false ? "사용" : "미사용"}</small><strong>${esc(character.name || `캐릭터 ${index + 1}`)}</strong></span><span class="character-summary-meta"><small>${character.position ? character.position.toUpperCase() : "AI 위치"}</small><span class="character-card-chevron" aria-hidden="true">⌄</span></span></summary><div class="single-character-card-body"><header><label class="checkbox"><input data-study-character-field="enabled" type="checkbox" ${character.enabled !== false ? "checked" : ""}> 사용</label><div class="character-order-tools"><button type="button" data-study-character-action="up" aria-label="위로 이동">↑</button><button type="button" data-study-character-action="down" aria-label="아래로 이동">↓</button><button type="button" data-study-character-action="delete" class="danger" aria-label="삭제">×</button></div></header><label>이름<input data-study-character-field="name" value="${esc(character.name)}"></label><div class="character-prompts"><label>Character Prompt<input data-study-character-field="prompt" value="${esc(character.prompt)}" placeholder="girl, black hair, source#hug"></label><label>Character UC<input data-study-character-field="negativePrompt" value="${esc(character.negativePrompt)}" placeholder="원하지 않는 캐릭터 속성"></label></div>${positionGridHtml(character.position)}</div></details>`).join("");
}

function renderArtistStudyCharacters() {
  const characters = state.artistStudy?.characters || [];
  $("#artistStudyCharacters").innerHTML = artistStudyCharacterRows();
  $("#artistStudyCharacterCount").textContent = `${characters.length} / 6`;
  $("#addArtistStudyCharacter").disabled = characters.length >= 6;
}

function syncArtistStudyCharactersFromDom() {
  if (!state.artistStudy) return;
  $$('[data-study-character-index]', $("#artistStudyCharacters")).forEach((card) => {
    const character = state.artistStudy.characters[Number(card.dataset.studyCharacterIndex)];
    if (!character) return;
    if (card.open) state.artistStudyCharacterOpenIds.add(character.id);
    else state.artistStudyCharacterOpenIds.delete(character.id);
    character.enabled = $("[data-study-character-field=enabled]", card).checked;
    character.name = $("[data-study-character-field=name]", card).value;
    character.prompt = $("[data-study-character-field=prompt]", card).value;
    character.negativePrompt = $("[data-study-character-field=negativePrompt]", card).value;
  });
}

function artistSliderRows(artists = []) {
  if (!artists.length) return `<p class="muted">등록된 작가가 없다. 작가를 추가한 뒤 슬라이더로 가중치를 조절해.</p>`;
  return artists.map((artist, index) => {
    const name = artist.name || `작가 ${index + 1}`;
    const weight = Number(artist.weight ?? 1).toFixed(2);
    return `<div class="artist-slider-row" data-artist-index="${index}">
      <input class="artist-sort-number" data-artist-field="sort" type="number" min="1" max="${artists.length}" step="1" value="${index + 1}" aria-label="${esc(name)} 정렬 번호" title="번호를 바꾸면 해당 순서로 이동한다">
      <label class="checkbox artist-enabled" title="이 작가 사용"><input data-artist-field="enabled" type="checkbox" aria-label="${esc(name)} 사용" ${artist.enabled !== false ? "checked" : ""}></label>
      <input data-artist-field="name" value="${esc(artist.name)}" placeholder="작가 이름" aria-label="작가 이름">
      <div class="artist-weight-control"><input data-artist-field="weight" type="range" min="0" max="2" step="0.05" value="${esc(weight)}" aria-label="${esc(name)} 가중치"><output>${esc(weight)}</output></div>
      <div class="slot-tools"><button type="button" data-artist-action="up" title="위로 이동" aria-label="${esc(name)} 위로 이동">↑</button><button type="button" data-artist-action="down" title="아래로 이동" aria-label="${esc(name)} 아래로 이동">↓</button><button type="button" data-artist-action="delete" class="danger" title="삭제" aria-label="${esc(name)} 삭제">×</button></div>
    </div>`;
  }).join("");
}

function renderArtistStudy() {
  if (!state.artistStudy) return;
  const form = $("#artistStudyForm");
  form.elements.examplePrompt.value = state.artistStudy.examplePrompt || "";
  form.elements.exampleNegativePrompt.value = state.artistStudy.exampleNegativePrompt || "";
  form.elements.basePrompt.value = state.artistStudy.basePrompt || "";
  form.elements.negativePrompt.value = state.artistStudy.negativePrompt || "";
  form.elements.randomMin.value = state.artistStudy.randomMin ?? 0.4;
  form.elements.randomMax.value = state.artistStudy.randomMax ?? 1.6;
  $("[data-settings-scope=artist-study]").innerHTML = settingsHtml(state.artistStudy.settings || {}, "study");
  syncSelectValues(form, state.artistStudy.settings || {}, "study");
  $("#artistSliderList").innerHTML = artistSliderRows(state.artistStudy.artists);
  renderArtistStudyCharacters();
  if (state.tab === "artist-study") syncHeaderModelSelector();
  updateDirtyIndicator();
}

function syncArtistStudyFromDom() {
  const form = $("#artistStudyForm");
  if (!form || !state.artistStudy) return;
  state.artistStudy.examplePrompt = form.elements.examplePrompt.value;
  state.artistStudy.exampleNegativePrompt = form.elements.exampleNegativePrompt.value;
  state.artistStudy.basePrompt = form.elements.basePrompt.value;
  state.artistStudy.negativePrompt = form.elements.negativePrompt.value;
  state.artistStudy.randomMin = Number(form.elements.randomMin.value);
  state.artistStudy.randomMax = Number(form.elements.randomMax.value);
  state.artistStudy.settings = readSettings(form, "study");
  syncArtistStudyCharactersFromDom();
  $$("[data-artist-index]", form).forEach((row) => {
    const artist = state.artistStudy.artists[Number(row.dataset.artistIndex)];
    if (!artist) return;
    artist.name = $("[data-artist-field=name]", row).value;
    artist.enabled = $("[data-artist-field=enabled]", row).checked;
    artist.weight = Number($("[data-artist-field=weight]", row).value);
  });
}

function slotRows(slots, owner) {
  if (!slots.length) return `<p class="muted">아직 슬롯이 없다.</p>`;
  return slots.map((slot, index) => `<div class="slot-row" data-owner="${owner}" data-index="${index}"><label class="checkbox" title="활성"><input data-field="enabled" type="checkbox" aria-label="${esc(slot.name)} 활성화" ${slot.enabled !== false ? "checked" : ""}></label><input data-field="name" value="${esc(slot.name)}" aria-label="슬롯 이름"><textarea data-field="prompt" rows="2" aria-label="프롬프트" title="${esc(slot.prompt)}">${esc(slot.prompt)}</textarea><textarea data-field="negativePrompt" rows="2" aria-label="Undesired Content" title="${esc(slot.negativePrompt)}">${esc(slot.negativePrompt)}</textarea><div class="slot-tools"><button type="button" data-slot-action="up" title="위로 이동" aria-label="${esc(slot.name)} 위로 이동">↑</button><button type="button" data-slot-action="down" title="아래로 이동" aria-label="${esc(slot.name)} 아래로 이동">↓</button><button type="button" data-slot-action="delete" class="danger" title="삭제" aria-label="${esc(slot.name)} 삭제">×</button></div></div>`).join("");
}

function presetsOfType(type) { return state.presets.filter((preset) => preset.type === type && preset.id); }
function presetOptions() { const presets = presetsOfType("sub-slot"); return presets.length ? presets.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("") : `<option value="">서브슬롯 프리셋 없음</option>`; }
function appendControls(owner) { const enabled = presetsOfType("sub-slot").length > 0; return `<div class="preset-append"><select data-preset-select="${owner}">${presetOptions()}</select><button data-append-preset="${owner}" class="secondary" ${enabled ? "" : "disabled"}>프리셋 Append</button></div>`; }
function examplePresetValues() { const form = $("#singleForm"); return { prompt: form.elements.examplePrompt.value, negativePrompt: form.elements.exampleNegativePrompt.value }; }
function updateExamplePresetActions() {
  const selectedId = $("#singleExamplePreset").value;
  const selectedPreset = state.presets.find((preset) => preset.type === "example" && preset.id === selectedId) || null;
  const values = examplePresetValues();
  $("#applyExamplePreset").disabled = !selectedPreset;
  $("#examplePresetSaveMenuButton").disabled = !values.prompt.trim() && !values.negativePrompt.trim();
  $("#overwriteExamplePreset").disabled = !selectedPreset;
  $("#overwriteExamplePresetName").textContent = selectedPreset ? selectedPreset.name : "먼저 프리셋을 선택해.";
}
function renderExamplePresetOptions() {
  const select = $("#singleExamplePreset");
  const selectedId = select.value;
  const presets = presetsOfType("example");
  select.innerHTML = presets.length ? `<option value="">작례 프리셋 선택</option>${presets.map((preset) => `<option value="${esc(preset.id)}">${esc(preset.name)}</option>`).join("")}` : `<option value="">작례 프리셋 없음</option>`;
  if (presets.some((preset) => preset.id === selectedId)) select.value = selectedId;
  updateExamplePresetActions();
  const multiSelect = $("#multiExamplePreset");
  const multiSelectedId = multiSelect.value;
  multiSelect.innerHTML = presets.length ? `<option value="">작례 프리셋 선택</option>${presets.map((preset) => `<option value="${esc(preset.id)}">${esc(preset.name)}</option>`).join("")}` : `<option value="">작례 프리셋 없음</option>`;
  if (presets.some((preset) => preset.id === multiSelectedId)) multiSelect.value = multiSelectedId;
  $("#applyMultiExamplePreset").disabled = !multiSelect.value;
}

function renderMultiPresetOptions() {
  const select = $("#multiSlotPreset");
  const selectedId = select.value;
  const presets = presetsOfType("sub-slot");
  select.innerHTML = presets.length ? `<option value="">서브슬롯 프리셋 선택</option>${presets.map((preset) => `<option value="${esc(preset.id)}">${esc(preset.name)}</option>`).join("")}` : `<option value="">서브슬롯 프리셋 없음</option>`;
  if (presets.some((preset) => preset.id === selectedId)) select.value = selectedId;
  $("#appendMultiSlotPreset").disabled = !select.value || state.multi.slots.length >= 20;
}
function selectExamplePreset(idValue) { $("#singleExamplePreset").value = idValue || ""; updateExamplePresetActions(); }
async function persistExamplePreset(input, trigger) {
  const values = examplePresetValues();
  const saved = await action(() => call(api.savePreset({ schema: "naintail.example-preset/v1", type: "example", ...input, ...values })), null, trigger);
  if (state.preset?.id === saved.id) state.preset = saved;
  await refreshLibraries();
  selectExamplePreset(saved.id);
  return saved;
}

function renderProjectList() { $("#projectList").innerHTML = state.projects.length ? state.projects.map((p) => `<button class="list-item ${state.project?.id === p.id ? "active" : ""}" data-project-id="${esc(p.id)}" title="${esc(p.name)}"><strong>${esc(p.name)}</strong><small>${esc(p.updatedAt || "")}</small></button>`).join("") : `<p class="muted">작품이 없다.</p>`; }
function renderProject() {
  renderProjectList(); const empty = $("#projectEmpty"), editor = $("#projectEditor");
  if (!state.project) { empty.hidden = false; editor.hidden = true; if (state.tab === "projects") syncHeaderModelSelector(); return; }
  empty.hidden = true; editor.hidden = false; const p = state.project;
  editor.innerHTML = `<form id="projectForm"><div class="project-title-row"><label>작품 이름<input name="name" value="${esc(p.name)}"></label><div class="actions"><button type="button" data-generate-scope="general" data-base-label="일반 생성" class="secondary">일반 생성 · 비용 계산 중</button><button type="button" data-generate-scope="character" data-base-label="캐릭터 생성" class="secondary">캐릭터 생성 · 비용 계산 중</button><button type="button" data-generate-scope="all" data-base-label="전체 생성" class="primary">전체 생성 · 비용 계산 중</button></div></div>
    <label>공통 Prompt<textarea name="commonPrompt" rows="4">${esc(p.commonPrompt)}</textarea></label><label>공통 Undesired Content<textarea name="commonNegativePrompt" rows="2">${esc(p.commonNegativePrompt)}</textarea></label>
    <details><summary>공통 생성 설정</summary><div class="settings-grid" data-project-settings>${settingsHtml(p.commonSettings, "common")}</div></details>
    <section class="section-card"><header><div><h3>일반 멀티 슬롯</h3><p class="muted">캐릭터 카드 없이도 독립적으로 사용한다. 프리셋 Append 후에는 원본과 연결되지 않는다.</p></div><div class="preset-append">${appendControls("general")}<button type="button" data-add-slot="general">＋ 슬롯</button></div></header><div class="slot-list">${slotRows(p.generalSlots, "general")}</div></section>
    <section class="section-card"><header><div><h3>캐릭터 카드</h3><p class="muted">활성 카드 최대 6명이 한 이미지의 독립 Character Prompt가 된다. 카드 순서도 배치 힌트다.</p></div><button type="button" id="addCharacter">＋ 캐릭터</button></header><div id="characters">${p.characters.map(characterHtml).join("") || `<p class="muted">캐릭터 카드가 없다.</p>`}</div></section>
    <section class="section-card"><header><div><h3>작품 결과</h3><p class="muted">재시작 후에도 작품·카드·슬롯 관계를 복원한다.</p></div></header><div class="gallery">${projectResultsHtml(p.results)}</div></section>
    <div class="actions"><button type="button" id="reloadProject" class="ghost">되돌리기</button><button class="primary">작품 저장</button></div></form>`;
  syncSelectValues(editor, p.commonSettings, "common");
  updateProjectGenerationButtons();
  if (state.tab === "projects") syncHeaderModelSelector();
  scheduleCostEstimate("project");
}

function projectResultsHtml(results = []) {
  if (!results.length) return `<p class="muted">이 작품의 저장 결과가 없다.</p>`;
  return [...results].reverse().slice(0, 24).map((r) => `<article class="result-card"><img src="${esc(outputFileUrl(r.relativePath))}" alt="${esc(r.source?.slotName || "작품 결과")}"><div><strong>${esc(r.source?.characterName || r.source?.slotName || "일반 슬롯")}</strong><small>${esc(r.source?.slotName || r.createdAt || "")}</small></div></article>`).join("");
}

function characterHtml(character, index) { return `<article class="character-card" data-character-index="${index}"><header><div class="character-card-title"><label class="checkbox"><input data-character-field="enabled" type="checkbox" ${character.enabled !== false ? "checked" : ""}> 사용</label><h3>${esc(character.name)}</h3><span class="pill">${character.position ? character.position.toUpperCase() : "AI 위치"}</span></div><div><button type="button" data-character-move="up" aria-label="${esc(character.name)} 카드 위로 이동">↑</button><button type="button" data-character-move="down" aria-label="${esc(character.name)} 카드 아래로 이동">↓</button><button type="button" data-character-delete class="danger">카드 삭제</button></div></header><label>캐릭터 이름<input data-character-field="name" value="${esc(character.name)}"></label><div class="character-prompts"><label>Character Prompt<textarea data-character-field="prompt" rows="3" title="${esc(character.prompt)}" placeholder="girl, black hair, source#hug">${esc(character.prompt)}</textarea></label><label>Character UC<textarea data-character-field="negativePrompt" rows="3" title="${esc(character.negativePrompt)}">${esc(character.negativePrompt)}</textarea></label></div>${positionGridHtml(character.position)}<p class="character-action-tip">상호작용은 Character Prompt에 <code>source#</code>, <code>target#</code>, <code>mutual#</code> 태그를 직접 사용할 수 있다.</p><div class="panel-head"><div><strong>카드 소유 슬롯</strong><p class="muted">이 카드의 슬롯 Prompt·UC만 해당 캐릭터 캡션에 합성된다.</p></div><div class="preset-append">${appendControls(`character:${character.id}`)}<button type="button" data-add-slot="character:${character.id}">＋ 슬롯</button></div></div><div class="slot-list">${slotRows(character.slots, `character:${character.id}`)}</div></article>`; }

function syncSelectValues(root, settings, prefix) { ["sampler", "scheduler"].forEach((key) => { const el = root.querySelector(`[name="${prefix}.${key}"]`); if (el && settings?.[key]) el.value = settings[key]; }); }
function syncProjectFromDom() {
  const form = $("#projectForm"); if (!form || !state.project) return;
  state.project.name = form.elements.name.value; state.project.commonPrompt = form.elements.commonPrompt.value; state.project.commonNegativePrompt = form.elements.commonNegativePrompt.value; state.project.commonSettings = readSettings(form, "common");
  $$(".slot-row", form).forEach((row) => { const slots = slotsForOwner(row.dataset.owner); const slot = slots[Number(row.dataset.index)]; if (!slot) return; slot.name = $("[data-field=name]", row).value; slot.prompt = $("[data-field=prompt]", row).value; slot.negativePrompt = $("[data-field=negativePrompt]", row).value; slot.enabled = $("[data-field=enabled]", row).checked; });
  $$("[data-character-index]", form).forEach((card) => { const c = state.project.characters[Number(card.dataset.characterIndex)]; c.name = $("[data-character-field=name]", card).value; c.prompt = $("[data-character-field=prompt]", card).value; c.negativePrompt = $("[data-character-field=negativePrompt]", card).value; c.enabled = $("[data-character-field=enabled]", card).checked; });
}
function slotsForOwner(owner) { if (owner === "general") return state.project.generalSlots; const characterId = owner.split(":")[1]; return state.project.characters.find((c) => c.id === characterId)?.slots || []; }
function move(list, index, delta) { const target = index + delta; if (target < 0 || target >= list.length) return; [list[index], list[target]] = [list[target], list[index]]; }

async function saveCurrentProject(trigger = null) {
  syncProjectFromDom();
  state.project = await action(() => call(api.saveProject(state.project)), "작품을 저장했다.", trigger);
  markDirty("project", false);
  await refreshLibraries();
  renderProject();
  return state.project;
}

async function discardProjectChanges() {
  if (state.project?.id) state.project = await action(() => call(api.getProject(state.project.id)));
  markDirty("project", false);
  renderProject();
}

function examplePresetSetLabel(preset) {
  if (preset.hasPrompt && preset.hasNegativePrompt) return "Prompt + UC";
  if (preset.hasNegativePrompt) return "UC only";
  if (preset.hasPrompt) return "Prompt · UC 비어 있음";
  return "빈 Prompt + UC 세트";
}
function renderPresetList() { const presets = presetsOfType(state.presetType); $("#presetList").innerHTML = presets.length ? presets.map((p) => `<button class="list-item ${state.preset?.id === p.id ? "active" : ""}" data-preset-id="${esc(p.id)}" title="${esc(p.name)}"><strong>${esc(p.name)}</strong><small>${p.type === "example" ? examplePresetSetLabel(p) : `${p.itemCount ?? 0} items`}</small></button>`).join("") : `<p class="muted">${state.presetType === "example" ? "작례 프리셋이 없다." : "서브슬롯 프리셋이 없다."}</p>`; }
function renderPreset() {
  renderPresetList();
  $$("[data-preset-type]").forEach((button) => { const active = button.dataset.presetType === state.presetType; button.classList.toggle("active", active); button.setAttribute("aria-selected", String(active)); });
  const empty = $("#presetEmpty"), editor = $("#presetEditor");
  $("#presetEmptyTitle").textContent = state.presetType === "example" ? "재사용할 작례" : "재사용할 슬롯 묶음";
  $("#presetEmptyDescription").textContent = state.presetType === "example" ? "싱글 생성의 작례 영역에 Prompt와 UC를 불러온다." : "작품이나 캐릭터 카드에 Append하면 독립 슬롯으로 복사된다.";
  if (!state.preset) { empty.hidden = false; editor.hidden = true; return; }
  empty.hidden = true; editor.hidden = false;
  if (state.preset.type === "example") {
    editor.innerHTML = `<form id="presetForm"><div class="project-title-row"><label>작례 프리셋 이름<input name="name" value="${esc(state.preset.name)}"></label><button type="button" id="deletePreset" class="danger">삭제</button></div><section class="section-card example-preset-editor"><header><div><h3>작례 Prompt + UC 세트</h3><p class="muted">두 값을 하나의 프리셋으로 함께 저장하고, 싱글·멀티에서 함께 불러온다.</p></div></header><label>Prompt<textarea name="prompt" rows="10">${esc(state.preset.prompt)}</textarea></label><label>UC (Undesired Content)<textarea name="negativePrompt" rows="5">${esc(state.preset.negativePrompt)}</textarea></label></section><div class="actions"><button class="primary">Prompt + UC 세트 저장</button></div></form>`;
    return;
  }
  editor.innerHTML = `<form id="presetForm"><div class="project-title-row"><label>프리셋 이름<input name="name" value="${esc(state.preset.name)}"></label><button type="button" id="deletePreset" class="danger">삭제</button></div><section class="section-card"><header><div><h3>슬롯 템플릿</h3><p class="muted">Append 시 fresh slot ID로 복사되며 이후 원본 프리셋과 연결되지 않는다.</p></div><button type="button" id="addPresetItem">＋ 항목</button></header><div class="slot-list">${state.preset.items.map((item, i) => `<div class="slot-row" data-preset-index="${i}"><span></span><input data-field="name" value="${esc(item.name)}" aria-label="프리셋 항목 이름"><textarea data-field="prompt" rows="2" aria-label="프리셋 항목 프롬프트" title="${esc(item.prompt)}">${esc(item.prompt)}</textarea><textarea data-field="negativePrompt" rows="2" aria-label="프리셋 항목 Undesired Content" title="${esc(item.negativePrompt)}">${esc(item.negativePrompt)}</textarea><div class="slot-tools"><button type="button" data-preset-move="up" aria-label="${esc(item.name)} 위로 이동">↑</button><button type="button" data-preset-move="down" aria-label="${esc(item.name)} 아래로 이동">↓</button><button type="button" data-preset-item-delete class="danger" aria-label="${esc(item.name)} 삭제">×</button></div></div>`).join("") || `<p class="muted">항목이 없다.</p>`}</div></section><div class="actions"><button class="primary">서브슬롯 프리셋 저장</button></div></form>`;
}
function syncPresetFromDom() { const form = $("#presetForm"); if (!form || !state.preset) return; state.preset.name = form.elements.name.value; if (state.preset.type === "example") { state.preset.prompt = form.elements.prompt.value; state.preset.negativePrompt = form.elements.negativePrompt.value; return; } $$("[data-preset-index]", form).forEach((row) => { const item = state.preset.items[Number(row.dataset.presetIndex)]; item.name = $("[data-field=name]", row).value; item.prompt = $("[data-field=prompt]", row).value; item.negativePrompt = $("[data-field=negativePrompt]", row).value; }); }

async function saveCurrentPreset(trigger = null) {
  syncPresetFromDom();
  state.preset = await action(() => call(api.savePreset(state.preset)), state.preset.type === "example" ? "작례 Prompt와 UC를 세트로 저장했다." : "프리셋을 저장했다.", trigger);
  markDirty("preset", false);
  await refreshLibraries();
  renderPreset();
  return state.preset;
}

async function discardPresetChanges() {
  const exists = state.presets.some((item) => item.id === state.preset?.id);
  state.preset = exists ? await action(() => call(api.getPreset(state.preset.id))) : null;
  markDirty("preset", false);
  renderPreset();
}

async function saveCurrentArtistStudy(trigger = null) {
  syncArtistStudyFromDom();
  state.artistStudy = await action(() => call(api.saveArtistStudy(state.artistStudy)), "작례 연구 설정을 저장했다.", trigger);
  markDirty("artist-study", false);
  renderArtistStudy();
  return state.artistStudy;
}

async function discardArtistStudyChanges() {
  state.artistStudy = await action(() => call(api.getArtistStudy()));
  markDirty("artist-study", false);
  renderArtistStudy();
}

async function guardUnsaved(kind) {
  const dirty = kind === "project" ? state.projectDirty : kind === "preset" ? state.presetDirty : state.artistStudyDirty;
  if (!dirty) return true;
  const choice = await confirmChoice({
    title: "저장되지 않은 변경",
    message: "편집 내용을 저장할까? 버리기를 선택하면 현재 변경은 복구할 수 없어.",
    confirmText: "버리기",
    alternateText: "저장",
  });
  if (choice === "cancel") return false;
  if (choice === "alternate") {
    if (kind === "project") await saveCurrentProject();
    else if (kind === "preset") await saveCurrentPreset();
    else await saveCurrentArtistStudy();
  } else if (kind === "project") await discardProjectChanges();
  else if (kind === "preset") await discardPresetChanges();
  else await discardArtistStudyChanges();
  return true;
}

async function guardCurrentEditor(nextTab = null) {
  if (state.tab === "projects" && !(await guardUnsaved("project"))) return false;
  if (state.tab === "presets" && !(await guardUnsaved("preset"))) return false;
  if (state.tab === "artist-study" && !(await guardUnsaved("artist-study"))) return false;
  if (nextTab) switchTab(nextTab);
  return true;
}

function queueStateLabel(value) { return ({ pending: "전송 전 대기", in_flight: "NAI에 전송됨", completed: "저장 완료", failed: "생성 실패", cancelled: "전송 전 취소" })[value] || value; }
function renderQueue() { const q = state.queue || { jobs: [] }; const active = q.jobs?.filter((j) => !["completed", "failed", "cancelled"].includes(j.state)).length || 0; $("#queueCount").textContent = active; $("#queueState").textContent = q.state === "running" ? "한 장 생성 중 · 현재 응답 저장 후 다음 요청 전송" : q.state === "paused" ? "실패로 일시정지 · 같은 Run의 미전송 항목 취소됨" : "대기 작업 없음"; $("#queueList").innerHTML = q.jobs?.length ? [...q.jobs].reverse().slice(0, 60).map((j) => { const label = j.task?.label || j.task?.source?.slotName || "Single"; const owner = j.task?.source?.characterName ? `${j.task.source.characterName} · ${j.task?.source?.slotName || "슬롯"}` : j.task?.source?.type === "general" ? `일반 슬롯 · ${j.task?.source?.slotName || ""}` : j.task?.source?.type === "multi" ? `멀티 슬롯 ${j.task.source.slotIndex} · ${j.task.source.slotName}` : j.task?.source?.type === "artist-study" ? "작례 연구기" : "Single"; const error = j.error?.message || ""; return `<article class="queue-job"><header><strong title="${esc(label)}">${esc(label)}</strong><span class="job-state state-${esc(j.state)}">${esc(queueStateLabel(j.state))}</span></header><small title="${esc(owner)}">${esc(owner)}</small>${error ? `<p class="job-error state-failed" title="${esc(error)}">${esc(error)}</p>` : ""}</article>`; }).join("") : `<p class="muted">대기 중인 작업이 없다.</p>`; }
function resultCards(results, selectedIndex = -1) { return results.map((r, index) => { const artists = r.source?.artists?.map((artist) => `${artist.name} ${Number(artist.weight).toFixed(2)}`).join(" · "); const apply = r.source?.type === "artist-study" ? `<button type="button" class="ghost result-apply" data-apply-artist-result="${index}" title="이 이미지에 사용된 작가 활성 상태와 가중치를 등록 작가 목록에 적용">값 적용</button>` : ""; return `<article class="result-card ${selectedIndex === index ? "active" : ""}" data-result-index="${index}"><img src="${esc(r.outputUrl)}" alt="생성 결과"><div class="result-card-meta"><span><strong>${esc(r.source?.slotName || r.source?.type || "Single")}</strong><small>${esc(artists || `seed ${r.seed ?? "-"}`)}</small></span>${apply}</div></article>`; }).join(""); }

function clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, value)); }
function selectedSingleResult() { return state.results[state.singleResultIndex] || null; }
function resetSinglePreviewTransform(mode = "fit") {
  state.singlePreview.mode = mode;
  state.singlePreview.zoom = 1;
  state.singlePreview.pan = { x: 0, y: 0 };
  applySinglePreviewTransform();
}
function singlePreviewMetrics() {
  const viewport = $("#singlePreview");
  const image = $("#singlePreviewImage");
  if (!viewport || !image) return null;
  const imageWidth = Math.max(1, state.singlePreview.imageSize.width);
  const imageHeight = Math.max(1, state.singlePreview.imageSize.height);
  const fitScale = Math.min(viewport.clientWidth / imageWidth, viewport.clientHeight / imageHeight, 1);
  const scale = (state.singlePreview.mode === "fit" ? fitScale : 1) * state.singlePreview.zoom;
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return { viewport, image, imageWidth, imageHeight, scale, width, height, overflowX: Math.max(0, (width - viewport.clientWidth) / 2), overflowY: Math.max(0, (height - viewport.clientHeight) / 2) };
}
function applySinglePreviewTransform() {
  const metrics = singlePreviewMetrics();
  if (!metrics) return;
  state.singlePreview.pan = {
    x: clamp(state.singlePreview.pan.x, -metrics.overflowX, metrics.overflowX),
    y: clamp(state.singlePreview.pan.y, -metrics.overflowY, metrics.overflowY),
  };
  metrics.image.style.left = `calc(50% + ${state.singlePreview.pan.x}px)`;
  metrics.image.style.top = `calc(50% + ${state.singlePreview.pan.y}px)`;
  metrics.image.style.width = `${Math.max(1, metrics.width)}px`;
  metrics.image.style.height = `${Math.max(1, metrics.height)}px`;
  metrics.viewport.classList.toggle("pannable", metrics.overflowX > 0 || metrics.overflowY > 0);
  const zoomLabel = $("#singlePreviewZoom");
  if (zoomLabel) zoomLabel.textContent = `${Math.round(metrics.scale * 100)}%`;
  $("#singlePreviewFit")?.classList.toggle("active", state.singlePreview.mode === "fit" && state.singlePreview.zoom === 1);
  $("#singlePreviewActual")?.classList.toggle("active", state.singlePreview.mode === "actual" && state.singlePreview.zoom === 1);
}
function renderSinglePreview(result) {
  state.singlePreview.mode = "fit";
  state.singlePreview.zoom = 1;
  state.singlePreview.pan = { x: 0, y: 0 };
  state.singlePreview.imageSize = { width: Number(result.width) || 1, height: Number(result.height) || 1 };
  $("#singlePreviewSize").textContent = `${result.width || "-"} × ${result.height || "-"}`;
  $("#singlePreview").innerHTML = `<img id="singlePreviewImage" src="${esc(result.outputUrl)}" alt="선택한 생성 결과" draggable="false"><div class="single-viewer-tools"><button type="button" id="singlePreviewFit" class="active" aria-label="화면에 맞춰보기" title="화면에 맞춰보기"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"></path></svg></button><button type="button" id="singlePreviewActual" aria-label="실제 크기" title="실제 크기 (1:1)">1:1</button><span id="singlePreviewZoom">100%</span></div><span class="single-preview-meta">${esc(result.width || "-")}×${esc(result.height || "-")} · seed ${esc(result.seed ?? "-")}</span>`;
  const image = $("#singlePreviewImage");
  image.addEventListener("load", () => {
    state.singlePreview.imageSize = { width: image.naturalWidth || Number(result.width) || 1, height: image.naturalHeight || Number(result.height) || 1 };
    applySinglePreviewTransform();
  }, { once: true });
  $("#reuseSingleResult").disabled = !result.request;
  $("#revealSingleResult").disabled = !result.relativePath;
  $("#trashSingleResult").disabled = !result.relativePath;
  requestAnimationFrame(applySinglePreviewTransform);
}
function renderSingleResults() {
  $("#singleResultCount").textContent = `${state.results.length}장`;
  const gallery = $("#resultGallery");
  if (!state.results.length) {
    gallery.classList.add("empty");
    gallery.innerHTML = "<p>아직 생성된 이미지가 없다.</p>";
    $("#singlePreview").innerHTML = `<div class="single-preview-empty"><span>✦</span><strong>아직 생성된 이미지가 없다.</strong><p>생성 결과를 선택하면 여기에 크게 표시된다.</p></div>`;
    $("#singlePreviewSize").textContent = "—";
    $("#reuseSingleResult").disabled = true;
    $("#revealSingleResult").disabled = true;
    $("#trashSingleResult").disabled = true;
    return;
  }
  state.singleResultIndex = Math.min(state.singleResultIndex, state.results.length - 1);
  gallery.classList.remove("empty");
  gallery.innerHTML = resultCards(state.results, state.singleResultIndex);
  const result = state.results[state.singleResultIndex];
  renderSinglePreview(result);
}

function selectedMultiResult() {
  return state.multiResults.find((result) => result.id === state.multiSelectedResultId) || null;
}

function renderMultiResults() {
  $("#multiResultCount").textContent = `${state.multiResults.length}장`;
  const selected = selectedMultiResult();
  if (!selected) {
    $("#multiPreview").innerHTML = `<div class="single-preview-empty"><span>✧</span><strong>아직 멀티 결과가 없다.</strong><p>슬롯 썸네일을 선택하면 크게 표시된다.</p></div>`;
    $("#revealMultiResult").disabled = true;
  } else {
    $("#multiPreview").innerHTML = `<img src="${esc(selected.outputUrl)}" alt="${esc(selected.source?.slotName || "멀티 결과")}"><span class="single-preview-meta">${esc(selected.source?.slotName || "슬롯")} · ${esc(selected.width || "-")}×${esc(selected.height || "-")} · seed ${esc(selected.seed ?? "-")}</span>`;
    $("#revealMultiResult").disabled = !selected.relativePath;
  }

  const container = $("#multiSlotResults");
  if (!state.multiResults.length) {
    container.innerHTML = `<p class="muted">프로그램 종료 또는 클리어 전까지 이 세션의 결과가 누적된다.</p>`;
    return;
  }
  const groups = new Map();
  for (const result of state.multiResults) {
    const key = result.source?.slotId || `slot-${result.source?.slotIndex || 1}`;
    if (!groups.has(key)) groups.set(key, { name: result.source?.slotName || "공통 프롬프트", index: result.source?.slotIndex || 1, results: [] });
    groups.get(key).results.push(result);
  }
  container.innerHTML = [...groups.values()].sort((left, right) => left.index - right.index).map((group) => `<section class="multi-slot-result-group"><header><strong>${String(group.index).padStart(2, "0")} · ${esc(group.name)}</strong><span>${group.results.length}장 누적</span></header><div class="multi-result-thumbnails">${group.results.map((result) => `<button type="button" class="multi-result-thumbnail ${result.id === state.multiSelectedResultId ? "active" : ""}" data-multi-result-id="${esc(result.id)}" title="seed ${esc(result.seed ?? "-")}"><img src="${esc(result.outputUrl)}" alt="${esc(group.name)} 결과"></button>`).join("")}</div></section>`).join("");
}

function addResult(result) {
  if (result.source?.type === "artist-study") {
    state.artistStudyResults.unshift(result);
    state.artistStudyResults = state.artistStudyResults.slice(0, 20);
    $("#artistStudyGallery").classList.remove("empty");
    $("#artistStudyGallery").innerHTML = resultCards(state.artistStudyResults);
    return;
  }
  if (result.source?.type === "multi") {
    state.multiResults.unshift(result);
    state.multiSelectedResultId = result.id;
    renderMultiResults();
    return;
  }
  state.results.unshift(result);
  state.results = state.results.slice(0, MAX_LOCAL_TASKS);
  state.singleResultIndex = 0;
  renderSingleResults();
}

function applyArtistResult(index) {
  const result = state.artistStudyResults[index];
  const usedArtists = result?.source?.artists;
  if (!state.artistStudy || !Array.isArray(usedArtists)) return;
  syncArtistStudyFromDom();
  const usedByName = new Map(usedArtists.filter((artist) => artist?.name).map((artist) => [artist.name.trim().toLocaleLowerCase(), artist]));
  const existingNames = new Set();
  state.artistStudy.artists = state.artistStudy.artists.map((artist) => {
    const key = artist.name.trim().toLocaleLowerCase();
    existingNames.add(key);
    const used = usedByName.get(key);
    return used ? { ...artist, enabled: true, weight: Number(used.weight) } : { ...artist, enabled: false };
  });
  usedArtists.forEach((artist) => {
    const key = artist.name.trim().toLocaleLowerCase();
    if (!key || existingNames.has(key)) return;
    state.artistStudy.artists.push({ id: id("artist"), name: artist.name.trim(), enabled: true, weight: Number(artist.weight) });
    existingNames.add(key);
  });
  markDirty("artist-study");
  renderArtistStudy();
  notify("이 이미지에 사용된 작가 활성 상태와 가중치를 적용했다.");
}

async function refreshLibraries() { [state.projects, state.presets] = await Promise.all([call(api.listProjects()), call(api.listPresets())]); renderProjectList(); renderPresetList(); renderExamplePresetOptions(); renderMultiPresetOptions(); }
function renderCredentialStatus(credential = state.credential, live = state.live) {
  if (!credential) return;
  state.credential = credential;
  if (live) state.live = live;
  const workerReady = Boolean(state.live?.worker?.ready || state.live?.worker?.ok);
  const credentialState = credential.state || (credential.configured ? "ready" : "missing");
  const connectionLabels = {
    ready: "Worker ready · Token set",
    missing: "Worker ready · Token missing",
    invalid: "Worker ready · Token unreadable",
    unavailable: "Worker ready · Credential storage unavailable",
  };
  const credentialLabels = { ready: "저장됨", missing: "미설정", invalid: "복호화 실패", unavailable: "보호 저장소 사용 불가" };
  const connectionKind = !workerReady || ["invalid", "unavailable"].includes(credentialState) ? "bad" : credentialState === "ready" ? "good" : "";
  $("#connectionLabel").textContent = workerReady ? connectionLabels[credentialState] || connectionLabels.missing : "Worker unavailable";
  $("#connectionBadge").className = `connection ${connectionKind}`;
  $("#credentialBadge").textContent = credentialLabels[credentialState] || credentialLabels.missing;
  $("#credentialBadge").className = `pill ${credentialState === "ready" ? "good" : "bad"}`;
  renderAnlasBalance();
  renderOpusUsage();
}

function renderOutputSettings(settings) {
  if (!settings) return;
  state.outputSettings = settings;
  const hosted = settings.mode === "hosted";
  const custom = settings.source === "custom";
  $("#outputSettingsBadge").textContent = hosted ? "호스트 상속" : custom ? "사용자 지정" : "Standalone 기본값";
  $("#outputSettingsBadge").className = `pill ${hosted ? "good" : ""}`;
  $("#outputSettingsDescription").textContent = hosted
    ? "NainTail 호스트의 공용 출력 위치를 상속한다. Hosted 모드에서는 변경할 수 없다."
    : "Standalone 생성 결과를 저장할 위치다. 기본값은 NaiTail 폴더의 outputs다.";
  $("#outputSettingsPath").textContent = settings.outputRoot;
  $("#outputSettingsPath").title = settings.outputRoot;
  $("#selectOutputFolder").disabled = settings.locked;
  $("#resetOutputFolder").disabled = settings.locked || !custom;
}

async function refreshStatus() {
  const [live, credential, info, queue, outputSettings] = await Promise.all([call(api.getLiveStatus()), call(api.getCredentialStatus()), call(api.getInfo()), call(api.getQueue()), call(api.getOutputSettings())]);
  state.info = info;
  renderCredentialStatus(credential, live);
  renderOutputSettings(outputSettings);
  $("#runtimeData").textContent = JSON.stringify(info, null, 2);
  state.queue = queue;
  renderQueue();
}

function isOpusSubscription(subscription = state.subscription) {
  const tier = subscription?.tier ?? subscription?.subscriptionTier ?? subscription?.subscription_tier;
  return Number(tier) === 3 || String(tier || "").toLowerCase() === "opus";
}

function opusUsageState(subscription = state.subscription) {
  const usage = subscription?.usage;
  if (!isOpusSubscription(subscription) || !usage || typeof usage !== "object") return null;
  const rawPercent = Number(usage.percent);
  if (!Number.isFinite(rawPercent)) return null;
  const isNegative = usage.isNegative === true;
  const rawRefillSeconds = Number(usage.timeUntilNextPercent);
  const percent = isNegative ? 0 : Math.min(100, Math.max(0, rawPercent));
  return {
    percent,
    isNegative,
    approximateImages: Math.round(percent * 17.3),
    timeUntilNextPercent: Number.isFinite(rawRefillSeconds) && rawRefillSeconds >= 0 ? rawRefillSeconds : null,
  };
}

function formatUsagePercent(percent) {
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`;
}

function formatCountdown(totalSeconds) {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const clock = [hours, minutes, remainder].map((value) => String(value).padStart(2, "0")).join(":");
  return days > 0 ? `${days}일 ${clock}` : clock;
}

function updateAnlasBadgeHoverTitle(usage = opusUsageState(), refillText = "") {
  const badge = $("#anlasBalanceBadge");
  if (!badge) return;
  const anlasTitle = badge.dataset.anlasTitle || "Anlas 잔액";
  const credentialReady = state.credential?.state === "ready" || state.credential?.configured === true;
  const opusTitle = usage
    ? `V5 Opus 무료 할당량 ${formatUsagePercent(usage.percent)} 남음 · 추정 ${usage.approximateImages.toLocaleString("ko-KR")}장`
    : !credentialReady
      ? "V5 Opus 할당량 · 토큰을 설정해야 조회 가능"
      : isOpusSubscription()
        ? "V5 Opus 할당량 · API 사용량 정보 없음"
        : "V5 Opus 할당량 · Opus 계정에서 조회 가능";
  badge.removeAttribute("title");
  const anlasAriaLabel = badge.dataset.anlasAriaLabel || "Anlas 잔액";
  badge.setAttribute("aria-label", [anlasAriaLabel, opusTitle, refillText].filter(Boolean).join(". "));
}

function renderOpusUsageCountdown(usage = opusUsageState()) {
  const outputs = [$("#opusUsageRefill"), $("#headerOpusUsageRefill")].filter(Boolean);
  if (!usage) {
    updateAnlasBadgeHoverTitle(null);
    return;
  }
  let text;
  if (usage.percent >= 100 && !usage.isNegative) {
    text = "할당량 완충됨";
  } else if (usage.timeUntilNextPercent === null) {
    text = "충전 시간 정보 없음";
  } else {
    const elapsed = state.subscriptionCheckedAt ? (Date.now() - state.subscriptionCheckedAt) / 1000 : 0;
    const remaining = Math.max(0, usage.timeUntilNextPercent - elapsed);
    const refillRate = usage.timeUntilNextPercent > 0 ? Math.round((86400 / usage.timeUntilNextPercent) * 10) / 10 : null;
    const rateText = refillRate === null ? "" : ` · 약 ${refillRate}%/일`;
    text = remaining > 0 ? `다음 1%까지 ${formatCountdown(remaining)}${rateText}` : `다음 1% 충전 반영 대기${rateText}`;
  }
  for (const output of outputs) output.textContent = text;
  updateAnlasBadgeHoverTitle(usage, text);
}

function renderOpusUsage() {
  const views = [
    { card: $("#opusUsageCard"), percent: $("#opusUsagePercent"), images: $("#opusUsageImages"), state: $("#opusUsageState"), progress: $("#opusUsageProgress"), fill: $("#opusUsageProgressFill"), hideWhenUnavailable: true },
    { card: $("#headerOpusUsageCard"), percent: $("#headerOpusUsagePercent"), images: $("#headerOpusUsageImages"), state: $("#headerOpusUsageState"), progress: $("#headerOpusUsageProgress"), fill: $("#headerOpusUsageProgressFill"), hideWhenUnavailable: false },
  ].filter((view) => view.card);
  if (!views.length) return;
  const credentialReady = state.credential?.state === "ready" || state.credential?.configured === true;
  const usage = credentialReady ? opusUsageState() : null;
  for (const view of views) {
    view.card.hidden = !usage && view.hideWhenUnavailable;
    view.card.setAttribute("aria-busy", "false");
  }
  if (!usage) {
    const header = views.find((view) => !view.hideWhenUnavailable);
    if (header) {
      const isOpus = isOpusSubscription();
      header.card.dataset.state = "unavailable";
      header.percent.textContent = "—";
      header.images.textContent = !credentialReady ? "토큰을 설정해야 조회할 수 있음" : isOpus ? "API 사용량 정보 없음" : "Opus 계정에서 제공되는 정보";
      header.state.textContent = !credentialReady ? "미연결" : isOpus ? "정보 없음" : "Opus 전용";
      header.state.className = "pill bad";
      header.fill.style.width = "0%";
      header.progress.setAttribute("aria-valuenow", "0");
      header.progress.setAttribute("aria-valuetext", header.images.textContent);
      $("#headerOpusUsageRefill").textContent = credentialReady ? "배지를 클릭해 새로고침" : "설정에서 토큰을 저장해줘";
    }
    return;
  }
  const kind = usage.isNegative || usage.percent <= 0 ? "empty" : usage.percent < 5 ? "low" : "available";
  const stateLabel = kind === "empty" ? "소진됨" : kind === "low" ? "잔여량 낮음" : "사용 가능";
  for (const view of views) {
    view.card.dataset.state = kind;
    view.percent.textContent = formatUsagePercent(usage.percent);
    view.images.textContent = `추정 잔여 이미지 약 ${usage.approximateImages.toLocaleString("ko-KR")}장`;
    view.state.textContent = stateLabel;
    view.state.className = `pill ${kind === "available" ? "good" : "bad"}`;
    view.fill.style.width = `${usage.percent}%`;
    view.progress.setAttribute("aria-valuenow", String(usage.percent));
    view.progress.setAttribute("aria-valuetext", `${formatUsagePercent(usage.percent)} 남음, 추정 ${usage.approximateImages}장`);
  }
  renderOpusUsageCountdown(usage);
}

function initializeHeaderUsagePopover() {
  const popover = $(".header-usage-popover");
  const badge = $("#anlasBalanceBadge");
  const card = $("#headerOpusUsageCard");
  if (!popover || !badge || !card || popover.dataset.bound === "true") return;
  document.body.append(card);
  const position = () => {
    const rect = badge.getBoundingClientRect();
    const margin = 12;
    const gap = 8;
    const cardRect = card.getBoundingClientRect();
    const cardWidth = Math.min(cardRect.width || 300, Math.max(0, window.innerWidth - (margin * 2)));
    const cardHeight = cardRect.height;
    const maxLeft = Math.max(margin, window.innerWidth - cardWidth - margin);
    const left = Math.min(Math.max(margin, rect.right - cardWidth), maxLeft);
    const below = rect.bottom + gap;
    const top = below + cardHeight <= window.innerHeight - margin
      ? below
      : Math.max(margin, rect.top - gap - cardHeight);
    document.documentElement.style.setProperty("--header-opus-tooltip-top", `${Math.round(top)}px`);
    document.documentElement.style.setProperty("--header-opus-tooltip-left", `${Math.round(left)}px`);
  };
  const open = () => {
    position();
    popover.dataset.open = "true";
    card.dataset.open = "true";
    badge.setAttribute("aria-expanded", "true");
  };
  const close = () => {
    if (popover.dataset.pinned === "true") return;
    popover.dataset.open = "false";
    card.dataset.open = "false";
    badge.setAttribute("aria-expanded", "false");
  };
  popover.addEventListener("pointerenter", open);
  popover.addEventListener("pointerleave", close);
  popover.addEventListener("focusin", open);
  popover.addEventListener("focusout", close);
  badge.addEventListener("click", () => {
    popover.dataset.pinned = "true";
    open();
  });
  document.addEventListener("pointerdown", (event) => {
    if (popover.contains(event.target) || card.contains(event.target)) return;
    popover.dataset.pinned = "false";
    close();
  });
  window.addEventListener("resize", () => {
    if (popover.dataset.open === "true") position();
  });
  popover.dataset.bound = "true";
}

function subscriptionBalance(subscription = state.subscription) {
  const remaining = subscription?.trainingStepsLeft;
  if (Number.isFinite(Number(remaining))) return Number(remaining);
  if (!remaining || typeof remaining !== "object") return null;
  const refillable = Number(remaining.fixedTrainingStepsLeft || 0);
  const purchased = Number(remaining.purchasedTrainingSteps || 0);
  return Number.isFinite(refillable + purchased) ? refillable + purchased : null;
}

function renderAnlasBalance({ loading = false, error = null } = {}) {
  const badge = $("#anlasBalanceBadge");
  const value = $("#anlasBalanceValue");
  if (!badge || !value) return;
  const credentialReady = state.credential?.state === "ready" || state.credential?.configured === true;
  badge.disabled = !credentialReady || loading;
  badge.className = "anlas-balance muted";
  let anlasTitle;
  if (!credentialReady) {
    value.textContent = "—";
    anlasTitle = "토큰을 설정하면 현재 Anlas 잔액을 조회한다.";
  } else if (loading) {
    value.textContent = "조회 중…";
    anlasTitle = "NovelAI에서 현재 Anlas 잔액을 조회하고 있다.";
  } else if (error) {
    value.textContent = "조회 실패";
    badge.className = "anlas-balance bad";
    anlasTitle = `${error.message || error} · 클릭하여 다시 조회`;
    badge.disabled = false;
  } else {
    const balance = subscriptionBalance();
    value.textContent = balance === null ? "확인 불가" : balance.toLocaleString("ko-KR");
    badge.className = `anlas-balance ${balance === null ? "muted" : "good"}`;
    anlasTitle = balance === null ? "잔액 필드가 없는 응답이다. 클릭하여 다시 조회" : `현재 ${balance.toLocaleString("ko-KR")} Anlas · 클릭하여 새로고침`;
  }
  badge.dataset.anlasTitle = anlasTitle;
  badge.dataset.anlasAriaLabel = `Anlas 잔액 ${value.textContent}`;
  badge.removeAttribute("title");
  badge.setAttribute("aria-label", badge.dataset.anlasAriaLabel);
  updateAnlasBadgeHoverTitle();
}

async function refreshSubscription(trigger = null) {
  const credentialReady = state.credential?.state === "ready" || state.credential?.configured === true;
  if (!credentialReady) {
    state.subscription = null;
    state.subscriptionCheckedAt = 0;
    $("#subscriptionData").textContent = "토큰 미설정";
    renderAnlasBalance();
    renderOpusUsage();
    return null;
  }
  renderAnlasBalance({ loading: true });
  $("#opusUsageCard")?.setAttribute("aria-busy", "true");
  const work = () => call(api.getSubscription());
  try {
    const subscription = trigger && trigger.id !== "anlasBalanceBadge" ? await action(work, null, trigger) : await work();
    state.subscription = subscription;
    state.subscriptionCheckedAt = Date.now();
    $("#subscriptionData").textContent = JSON.stringify(subscription, null, 2);
    renderAnlasBalance();
    renderOpusUsage();
    return subscription;
  } catch (error) {
    state.subscription = null;
    state.subscriptionCheckedAt = 0;
    $("#subscriptionData").textContent = `조회 실패: ${error.message}`;
    renderAnlasBalance({ error });
    renderOpusUsage();
    throw error;
  }
}

function commonCostOptions(scope) {
  const supportsReferences = (NAI_MODELS[modelFor(scope)] || NAI_MODELS[DEFAULT_NAI_MODEL]).references;
  const vibes = vibesFor(scope);
  return {
    subscriptionKnown: Boolean(state.subscription),
    isOpus: isOpusSubscription(),
    opusUsageExhausted: opusUsageState()?.isNegative === true,
    preciseReferenceCount: supportsReferences ? preciseReferencesFor(scope).length : 0,
    vibeCount: supportsReferences ? vibes.length : 0,
    vibeEncodingCount: supportsReferences ? vibes.filter((vibe) => !vibe.cached).length : 0,
  };
}

function singleCostInput() {
  const form = $("#singleForm");
  const summary = localRepeatSummary(form, 1);
  return { request: { settings: readSettings(form) }, options: { ...commonCostOptions("single"), generationCount: summary.totalTasks } };
}

function multiCostInput() {
  const form = $("#multiForm");
  syncMultiSlotsFromDom();
  const summary = localRepeatSummary(form, multiVariationCount());
  const commonSettings = readSettings(form, "multi");
  const slots = state.multi.slots.length ? state.multi.slots.filter((slot) => slot.enabled !== false) : [{ settings: {} }];
  return {
    request: { settings: commonSettings },
    options: {
      ...commonCostOptions("multi"),
      generationCount: summary.totalTasks,
      settingsVariants: slots.map((slot) => ({ settings: { ...commonSettings, ...(slot.settings || {}) }, count: summary.batchCount * summary.queueCount })),
    },
  };
}

function artistCostInput() {
  const form = $("#artistStudyForm");
  return {
    request: { settings: readSettings(form, "study") },
    options: { subscriptionKnown: Boolean(state.subscription), isOpus: isOpusSubscription(), opusUsageExhausted: opusUsageState()?.isNegative === true, generationCount: 1 },
  };
}

function projectSettingsVariants(scope) {
  const project = state.project;
  if (!project) return [];
  const variants = [];
  if (scope === "all" || scope === "general") {
    project.generalSlots.filter((slot) => slot.enabled !== false).forEach((slot) => {
      variants.push({ settings: { ...project.commonSettings, ...(slot.settings || {}) }, count: 1 });
    });
  }
  if (scope !== "general") {
    project.characters.filter((character) => character.enabled !== false).forEach((character) => {
      character.slots.filter((slot) => slot.enabled !== false).forEach((slot) => {
        variants.push({ settings: { ...project.commonSettings, ...(character.settings || {}), ...(slot.settings || {}) }, count: 1 });
      });
    });
  }
  return variants;
}

function projectCostInput(scope) {
  syncProjectFromDom();
  const settingsVariants = projectSettingsVariants(scope);
  return {
    request: { settings: state.project?.commonSettings || {} },
    options: {
      subscriptionKnown: Boolean(state.subscription),
      isOpus: isOpusSubscription(),
      opusUsageExhausted: opusUsageState()?.isNegative === true,
      generationCount: settingsVariants.length,
      settingsVariants,
    },
  };
}

function costLabel(result) {
  if (!result) return "비용 계산 중";
  return `${result.subscriptionKnown ? "" : "최대 "}예상 ${result.totalCost} Anlas`;
}

function updateArtistGenerationButtons() {
  const result = state.costs.artist;
  const suffix = costLabel(result);
  const current = $("#generateArtistStudy");
  const random = $("#randomGenerateArtistStudy");
  if (current) current.textContent = `현재 조합 생성 · ${suffix}`;
  if (random) random.textContent = `랜덤 생성 · ${suffix}`;
  if (current) current.disabled = Boolean(result?.overLimit);
  if (random) random.disabled = Boolean(result?.overLimit);
}

function updateProjectGenerationButtons() {
  $$('[data-generate-scope]', $("#projectEditor")).forEach((button) => {
    const result = state.costs.project[button.dataset.generateScope];
    button.textContent = `${button.dataset.baseLabel} · ${costLabel(result)}`;
    button.disabled = Boolean(result?.overLimit);
  });
}

function renderCostEstimate(scope, result) {
  state.costs[scope] = result;
  const badge = $(`#${scope === "artist" ? "artistStudy" : scope}Eligibility`);
  const prefix = result.subscriptionKnown ? "" : "최대 ";
  badge.textContent = result.isFree ? "예상 0 Anlas · FREE" : `${prefix}예상 ${result.totalCost} Anlas`;
  badge.className = `pill ${result.isFree ? "good" : "bad"}`;
  badge.title = result.reasons.join(" · ");
  if (scope === "single") updateSingleGenerationSummary();
  else if (scope === "multi") updateMultiGenerationSummary();
  else updateArtistGenerationButtons();
  return result;
}

function anlasConfirmationMessage(result) {
  const lines = [`이 작업은 약 ${result.totalCost} Anlas를 사용할 것으로 예상된다.`];
  if (result.baseGenerationCost) lines.push(`기본 생성: ${result.baseGenerationCost}`);
  if (result.preciseReferenceCost) lines.push(`Precise Reference: ${result.preciseReferenceCost}`);
  if (result.vibeGenerationCost) lines.push(`Vibe 생성 가산: ${result.vibeGenerationCost}`);
  if (result.vibeEncodingCost) lines.push(`Vibe 인코딩: ${result.vibeEncodingCost}`);
  const balance = subscriptionBalance();
  if (balance !== null) lines.push(`현재 잔액: ${balance} → 예상 잔액: ${balance - result.totalCost}`);
  lines.push("실제 차감액은 NAI 서버의 현재 과금식에 따라 달라질 수 있다.");
  return lines.join("\n");
}

async function confirmAnlasUse(result) {
  if (!result || result.totalCost <= 0) return true;
  const choice = await confirmChoice({
    title: `${result.totalCost} Anlas 사용 확인`,
    message: anlasConfirmationMessage(result),
    confirmText: `${result.totalCost} Anlas 사용하고 생성`,
    danger: false,
  });
  return choice === "confirm";
}

async function refreshArtistStudy() {
  state.artistStudy = await call(api.getArtistStudy());
  markDirty("artist-study", false);
  renderArtistStudy();
}

async function estimateArtistStudy(trigger = null) {
  const input = artistCostInput();
  const work = () => call(api.estimateGeneration(input.request, input.options));
  const result = trigger ? await action(work, null, trigger) : await work();
  return renderCostEstimate("artist", result);
}

async function estimateMulti(trigger = null) {
  const input = multiCostInput();
  const work = () => call(api.estimateGeneration(input.request, input.options));
  const result = trigger ? await action(work, null, trigger) : await work();
  return renderCostEstimate("multi", result);
}

async function estimateProject(scope, trigger = null) {
  const input = projectCostInput(scope);
  const work = () => call(api.estimateGeneration(input.request, input.options));
  const result = trigger ? await action(work, null, trigger) : await work();
  state.costs.project[scope] = result;
  updateProjectGenerationButtons();
  return result;
}

async function estimateAllProjectCosts() {
  if (!state.project || !$("#projectForm")) return [];
  return Promise.all(["general", "character", "all"].map((scope) => estimateProject(scope)));
}

$("#tabs").addEventListener("click", async (event) => { const tab = event.target.closest("[data-tab]")?.dataset.tab; if (tab && tab !== state.tab) await guardCurrentEditor(tab); });
$("#developmentFeaturesEnabled").addEventListener("change", (event) => setDevelopmentFeaturesEnabled(event.currentTarget.checked));
$("#modelSelector").addEventListener("change", async (event) => {
  const context = settingsContextForTab();
  if (!context) return;
  if (state.tab === "multi") syncMultiFromDom();
  if (state.tab === "artist-study") syncArtistStudyFromDom();
  if (state.tab === "projects") syncProjectFromDom();
  const model = event.currentTarget.value;
  const definition = NAI_MODELS[model];
  persistPreferredNaiModel(model);
  const current = readSettings(context.form, context.prefix);
  const next = {
    ...current,
    ...definition.defaults,
    model,
    decrisper: definition.decrisper ? current.decrisper : false,
    transparencyMode: definition.transparency ? current.transparencyMode : "none",
    transparentBackground: definition.transparency && current.transparencyMode !== "none",
    qualityPreset: definition.lightQuality || current.qualityPreset !== "Light" ? current.qualityPreset : "Standard",
    ucPreset: definition.ucPresets.includes(current.ucPreset) ? current.ucPreset : "Heavy",
  };
  context.container.innerHTML = settingsHtml(next, context.prefix);
  writeSettings(context.form, next, context.prefix);
  if (state.tab === "single" || state.tab === "multi") {
    if (state.tab === "multi") state.multi.settings = next;
    renderVibes(state.tab);
    renderPreciseReferences(state.tab);
    renderModelCapabilities(state.tab);
    invalidateCost(state.tab);
    scheduleCostEstimate(state.tab);
    if (definition.references) refreshVibeCacheStatus(state.tab).catch((error) => notify(error.message, true));
  } else if (state.tab === "artist-study") {
    state.artistStudy.settings = next;
    markDirty("artist-study");
    invalidateCost("artist");
    scheduleCostEstimate("artist");
  } else if (state.tab === "projects") {
    state.project.commonSettings = next;
    markDirty("project");
    invalidateCost("project");
    scheduleCostEstimate("project");
  }
  syncHeaderModelSelector();
  notify(`${definition.label}로 변경하고 권장 Steps·Guidance를 적용했다.`);
});
$("[data-settings-scope=single]").innerHTML = settingsHtml({}, "settings");
$("[data-settings-scope=multi]").innerHTML = settingsHtml({}, "multi");
$("[data-settings-scope=artist-study]").innerHTML = settingsHtml({}, "study");
$("#singleForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  syncSingleCharactersFromDom();
  const settings = readSettings(form);
  const referencesSupported = (NAI_MODELS[settings.model] || NAI_MODELS[DEFAULT_NAI_MODEL]).references;
  const request = { examplePrompt: form.elements.examplePrompt.value, exampleNegativePrompt: form.elements.exampleNegativePrompt.value, prompt: form.elements.prompt.value, negativePrompt: form.elements.negativePrompt.value, characters: state.singleCharacters, vibes: referencesSupported ? state.singleVibes : [], normalizeVibeStrengths: state.singleNormalizeVibeStrengths, preciseReferences: referencesSupported ? state.singlePreciseReferences : [], batchCount: Number(form.elements.batchCount.value), queueCount: Number(form.elements.queueCount.value), settings };
  const estimate = await estimateSingle();
  if (!(await confirmAnlasUse(estimate))) return;
  const result = await action(async () => { const generated = await call(api.generateSingle(request)); state.queue = generated.queue; renderQueue(); return generated; }, null, event.submitter);
  notify(`Single 로컬 작업 ${result.tasks}장을 큐에 추가했다.`);
  updateSingleGenerationSummary();
});
$("#singleForm").addEventListener("input", () => { updateExamplePresetActions(); invalidateCost("single"); scheduleCostEstimate("single"); });
$("#singleForm").addEventListener("change", (event) => {
  if (event.target.name === "settings.model") refreshVibeCacheStatus("single").then(() => estimateSingle()).catch((error) => notify(error.message, true));
});
bindPreciseReferenceList("single");
bindVibeList("single");
$("#addSingleReference").addEventListener("click", (event) => addPreciseReference("single", event.currentTarget));
$("#addSingleVibe").addEventListener("click", (event) => addVibe("single", event.currentTarget));
$("#singleNormalizeVibes").addEventListener("change", (event) => vibeNormalizationFor("single", event.currentTarget.checked));
$("#addSingleCharacter").addEventListener("click", () => { syncSingleCharactersFromDom(); const character = { id: id("character"), name: `캐릭터 ${state.singleCharacters.length + 1}`, prompt: "", negativePrompt: "", enabled: true, position: null }; state.singleCharacters.push(character); state.singleCharacterOpenIds.add(character.id); renderSingleCharacters(); });
$("#singleCharacters").addEventListener("click", (event) => {
  const card = event.target.closest("[data-single-character-index]");
  if (!card) return;
  syncSingleCharactersFromDom();
  const index = Number(card.dataset.singleCharacterIndex);
  if (event.target.hasAttribute("data-character-position")) { state.singleCharacters[index].position = event.target.dataset.characterPosition || null; renderSingleCharacters(); return; }
  const actionName = event.target.dataset.singleCharacterAction;
  if (!actionName) return;
  if (actionName === "delete") { state.singleCharacterOpenIds.delete(state.singleCharacters[index].id); state.singleCharacters.splice(index, 1); }
  else move(state.singleCharacters, index, actionName === "up" ? -1 : 1);
  renderSingleCharacters();
});
$("#singleCharacters").addEventListener("input", (event) => {
  const card = event.target.closest("[data-single-character-index]");
  if (!card) return;
  if (event.target.matches("[data-single-character-field=name]")) $("summary strong", card).textContent = event.target.value || `캐릭터 ${Number(card.dataset.singleCharacterIndex) + 1}`;
  if (event.target.matches("[data-single-character-field=enabled]")) {
    const badge = $(".character-use-state", card);
    badge.textContent = event.target.checked ? "사용" : "미사용";
    badge.classList.toggle("off", !event.target.checked);
  }
});
$("#singleExamplePreset").addEventListener("change", updateExamplePresetActions);
$("#applyExamplePreset").addEventListener("click", async (event) => { const presetId = $("#singleExamplePreset").value; if (!presetId) return; const preset = await action(() => call(api.getPreset(presetId)), null, event.currentTarget); if (preset.type !== "example") throw new Error("작례 프리셋이 아닙니다."); const form = $("#singleForm"); form.elements.examplePrompt.value = preset.prompt; form.elements.exampleNegativePrompt.value = preset.negativePrompt; updateExamplePresetActions(); notify(`작례 Prompt와 UC 세트를 불러왔다: ${preset.name}`); });
$("#examplePresetSaveMenuButton").addEventListener("click", (event) => { event.stopPropagation(); const menu = $("#examplePresetSaveMenu"); menu.hidden = !menu.hidden; event.currentTarget.setAttribute("aria-expanded", String(!menu.hidden)); });
$("#saveExampleAsNew").addEventListener("click", openExamplePresetNameDialog);
$("#overwriteExamplePreset").addEventListener("click", async (event) => {
  closeExamplePresetSaveMenu();
  const selected = state.presets.find((preset) => preset.type === "example" && preset.id === $("#singleExamplePreset").value);
  if (!selected) return;
  const choice = await confirmChoice({ title: "현재 프리셋을 덮어쓸까?", message: `${selected.name}의 이름과 ID는 유지하고 현재 작례 Prompt와 UC로 갱신한다.`, confirmText: "덮어쓰기", danger: false });
  if (choice !== "confirm") return;
  const saved = await persistExamplePreset({ id: selected.id, name: selected.name }, event.currentTarget);
  notify(`작례 Prompt와 UC 세트를 덮어썼다: ${saved.name}`);
});
$("#examplePresetNameForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const dialog = $("#examplePresetNameDialog");
  const input = $("#examplePresetNameInput");
  const error = $("#examplePresetNameError");
  const name = input.value.trim();
  if (!name || dialog.dataset.busy === "true") return;
  dialog.dataset.busy = "true";
  input.disabled = true;
  $("#examplePresetNameCancel").disabled = true;
  error.hidden = true;
  try {
    const saved = await persistExamplePreset({ id: id("example"), name }, event.submitter);
    dialog.close();
    notify(`새 작례 Prompt와 UC 세트로 저장했다: ${saved.name}`);
  } catch (saveError) {
    error.textContent = saveError.message;
    error.hidden = false;
  } finally {
    dialog.dataset.busy = "false";
    input.disabled = false;
    $("#examplePresetNameCancel").disabled = false;
  }
});
async function estimateSingle(trigger = null) { const input = singleCostInput(); const work = () => call(api.estimateGeneration(input.request, input.options)); const result = trigger ? await action(work, null, trigger) : await work(); return renderCostEstimate("single", result); }
$("#singleEstimate").addEventListener("click", (event) => estimateSingle(event.currentTarget));
$("#resultGallery").addEventListener("click", (event) => { const card = event.target.closest("[data-result-index]"); if (!card) return; state.singleResultIndex = Number(card.dataset.resultIndex); renderSingleResults(); });
$("#singlePreview").addEventListener("click", (event) => {
  if (event.target.closest("#singlePreviewFit")) resetSinglePreviewTransform("fit");
  if (event.target.closest("#singlePreviewActual")) resetSinglePreviewTransform("actual");
});
$("#singlePreview").addEventListener("wheel", (event) => {
  if (!selectedSingleResult()) return;
  event.preventDefault();
  state.singlePreview.zoom = clamp(state.singlePreview.zoom * (event.deltaY < 0 ? 1.12 : (1 / 1.12)), 0.1, 8);
  applySinglePreviewTransform();
}, { passive: false });
$("#singlePreview").addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || event.target.closest(".single-viewer-tools")) return;
  const metrics = singlePreviewMetrics();
  if (!metrics || (metrics.overflowX <= 0 && metrics.overflowY <= 0)) return;
  event.currentTarget.setPointerCapture(event.pointerId);
  state.singlePreview.drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, panX: state.singlePreview.pan.x, panY: state.singlePreview.pan.y };
  event.currentTarget.classList.add("dragging");
});
$("#singlePreview").addEventListener("pointermove", (event) => {
  const drag = state.singlePreview.drag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  state.singlePreview.pan = { x: drag.panX + event.clientX - drag.startX, y: drag.panY + event.clientY - drag.startY };
  applySinglePreviewTransform();
});
function endSinglePreviewDrag(event) {
  if (state.singlePreview.drag?.pointerId !== event.pointerId) return;
  state.singlePreview.drag = null;
  event.currentTarget.classList.remove("dragging");
  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
}
$("#singlePreview").addEventListener("pointerup", endSinglePreviewDrag);
$("#singlePreview").addEventListener("pointercancel", endSinglePreviewDrag);
new ResizeObserver(() => applySinglePreviewTransform()).observe($("#singlePreview"));

$("#multiForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  syncMultiFromDom();
  const estimate = await estimateMulti();
  if (!(await confirmAnlasUse(estimate))) return;
  const referencesSupported = (NAI_MODELS[state.multi.settings.model] || NAI_MODELS[DEFAULT_NAI_MODEL]).references;
  const request = referencesSupported ? state.multi : { ...state.multi, vibes: [], preciseReferences: [] };
  const result = await action(() => call(api.generateMulti(request)), null, event.submitter);
  state.queue = result.queue;
  renderQueue();
  notify(`멀티 로컬 작업 ${result.tasks}장을 큐에 추가했다.`);
  updateMultiGenerationSummary();
});
$("#multiForm").addEventListener("input", () => { invalidateCost("multi"); scheduleCostEstimate("multi"); });
$("#multiForm").addEventListener("change", (event) => {
  if (event.target.name === "multi.model") refreshVibeCacheStatus("multi").then(() => estimateMulti()).catch((error) => notify(error.message, true));
});
$("#estimateMulti").addEventListener("click", (event) => estimateMulti(event.currentTarget));
bindPreciseReferenceList("multi");
bindVibeList("multi");
$("#addMultiReference").addEventListener("click", (event) => addPreciseReference("multi", event.currentTarget));
$("#addMultiVibe").addEventListener("click", (event) => addVibe("multi", event.currentTarget));
$("#multiNormalizeVibes").addEventListener("change", (event) => vibeNormalizationFor("multi", event.currentTarget.checked));
$("#multiExamplePreset").addEventListener("change", (event) => { $("#applyMultiExamplePreset").disabled = !event.currentTarget.value; });
$("#applyMultiExamplePreset").addEventListener("click", async (event) => {
  const presetId = $("#multiExamplePreset").value;
  if (!presetId) return;
  const preset = await action(() => call(api.getPreset(presetId)), null, event.currentTarget);
  if (preset.type !== "example") throw new Error("작례 프리셋이 아닙니다.");
  const form = $("#multiForm");
  form.elements.examplePrompt.value = preset.prompt;
  form.elements.exampleNegativePrompt.value = preset.negativePrompt;
  syncMultiFromDom();
  notify(`멀티 공통 Prompt와 UC 세트를 불러왔다: ${preset.name}`);
});
$("#addMultiCharacter").addEventListener("click", () => {
  syncMultiFromDom();
  const character = { id: id("character"), name: `캐릭터 ${state.multi.characters.length + 1}`, prompt: "", negativePrompt: "", enabled: true, position: null };
  state.multi.characters.push(character);
  state.multiCharacterOpenIds.add(character.id);
  renderMultiCharacters();
});
$("#multiCharacters").addEventListener("click", (event) => {
  const card = event.target.closest("[data-multi-character-index]");
  if (!card) return;
  syncMultiCharactersFromDom();
  const index = Number(card.dataset.multiCharacterIndex);
  if (event.target.hasAttribute("data-character-position")) { state.multi.characters[index].position = event.target.dataset.characterPosition || null; renderMultiCharacters(); return; }
  const actionName = event.target.dataset.multiCharacterAction;
  if (!actionName) return;
  if (actionName === "delete") { state.multiCharacterOpenIds.delete(state.multi.characters[index].id); state.multi.characters.splice(index, 1); }
  else move(state.multi.characters, index, actionName === "up" ? -1 : 1);
  renderMultiCharacters();
});
$("#addMultiSlot").addEventListener("click", () => {
  syncMultiFromDom();
  if (state.multi.slots.length >= 20) return;
  const slot = { id: id("slot"), name: `슬롯 ${state.multi.slots.length + 1}`, prompt: "", negativePrompt: "", enabled: true, settings: {} };
  state.multi.slots.push(slot);
  state.multiSlotOpenIds.add(slot.id);
  renderMultiSlots();
});
$("#multiSlotList").addEventListener("click", (event) => {
  const actionName = event.target.dataset.multiSlotAction;
  if (!actionName) return;
  event.preventDefault();
  const card = event.target.closest("[data-multi-slot-index]");
  syncMultiSlotsFromDom();
  const index = Number(card.dataset.multiSlotIndex);
  if (actionName === "delete") { state.multiSlotOpenIds.delete(state.multi.slots[index].id); state.multi.slots.splice(index, 1); }
  else move(state.multi.slots, index, actionName === "up" ? -1 : 1);
  renderMultiSlots();
});
$("#multiSlotList").addEventListener("change", (event) => {
  if (!event.target.matches('[data-multi-slot-field="enabled"]')) return;
  syncMultiSlotsFromDom();
  renderMultiSlots();
});
function setMultiSlotSelection(kind) {
  syncMultiFromDom();
  state.multi.slots = state.multi.slots.map((slot) => ({ ...slot, enabled: kind === "select" ? true : kind === "clear" ? false : slot.enabled === false }));
  renderMultiSlots();
}
$("#selectAllMultiSlots").addEventListener("click", () => setMultiSlotSelection("select"));
$("#clearAllMultiSlots").addEventListener("click", () => setMultiSlotSelection("clear"));
$("#invertMultiSlots").addEventListener("click", () => setMultiSlotSelection("invert"));
$("#multiSlotPreset").addEventListener("change", (event) => { $("#appendMultiSlotPreset").disabled = !event.currentTarget.value || state.multi.slots.length >= 20; });
$("#appendMultiSlotPreset").addEventListener("click", async (event) => {
  syncMultiFromDom();
  const preset = await action(() => call(api.getPreset($("#multiSlotPreset").value)), null, event.currentTarget);
  if (preset.type !== "sub-slot") throw new Error("서브슬롯 프리셋이 아닙니다.");
  const capacity = 20 - state.multi.slots.length;
  const appended = preset.items.slice(0, capacity).map((item) => ({ id: id("slot"), name: item.name, prompt: item.prompt, negativePrompt: item.negativePrompt, enabled: true, settings: { ...(item.settings || {}) } }));
  state.multi.slots.push(...appended);
  appended.forEach((slot) => state.multiSlotOpenIds.add(slot.id));
  renderMultiSlots();
  renderMultiPresetOptions();
  notify(`${appended.length}개 슬롯을 독립 항목으로 Append했다.`);
});
$("#multiSlotResults").addEventListener("click", (event) => {
  const button = event.target.closest("[data-multi-result-id]");
  if (!button) return;
  state.multiSelectedResultId = button.dataset.multiResultId;
  renderMultiResults();
});
$("#clearMultiResults").addEventListener("click", () => {
  state.multiResults = [];
  state.multiSelectedResultId = null;
  renderMultiResults();
  notify("멀티 세션의 누적 표시를 비웠다. 저장된 PNG 파일은 유지된다.");
});
$("#revealMultiResult").addEventListener("click", async (event) => {
  const result = selectedMultiResult();
  if (!result?.relativePath) return;
  await action(() => call(api.revealOutput({ id: result.id, relativePath: result.relativePath })), null, event.currentTarget);
});

$("#reuseSingleResult").addEventListener("click", () => {
  const result = selectedSingleResult();
  if (!result?.request) return;
  const form = $("#singleForm");
  form.elements.examplePrompt.value = "";
  form.elements.exampleNegativePrompt.value = "";
  form.elements.prompt.value = result.request.prompt || "";
  form.elements.negativePrompt.value = result.request.negativePrompt || "";
  state.singleCharacters = Array.isArray(result.request.characters) ? result.request.characters.map((character) => ({ ...character, id: character.id || id("character") })) : [];
  state.singleVibes = Array.isArray(result.request.vibes) ? result.request.vibes.map((vibe) => ({ ...vibe })) : [];
  state.singleNormalizeVibeStrengths = result.request.normalizeVibeStrengths !== false;
  state.singlePreciseReferences = Array.isArray(result.request.preciseReferences) ? result.request.preciseReferences.map((reference) => ({ ...reference })) : [];
  state.singleCharacterOpenIds = new Set();
  renderSingleCharacters();
  const reusedSettings = { ...(result.request.settings || {}), seed: result.seed };
  $("[data-settings-scope=single]").innerHTML = settingsHtml(reusedSettings, "settings");
  writeSettings(form, reusedSettings);
  renderVibes("single");
  renderPreciseReferences("single");
  renderModelCapabilities("single");
  syncHeaderModelSelector();
  if ((NAI_MODELS[modelFor("single")] || NAI_MODELS[DEFAULT_NAI_MODEL]).references) refreshVibeCacheStatus("single").catch((error) => notify(error.message, true));
  updateExamplePresetActions();
  notify("선택 이미지의 Prompt·UC·캐릭터·Vibe·이미지 참조·생성 설정을 불러왔다.");
});
$("#revealSingleResult").addEventListener("click", async (event) => {
  const result = selectedSingleResult();
  if (!result?.relativePath) return;
  await action(() => call(api.revealOutput({ id: result.id, projectId: result.projectId, relativePath: result.relativePath })), null, event.currentTarget);
});
$("#trashSingleResult").addEventListener("click", async (event) => {
  const result = selectedSingleResult();
  if (!result?.relativePath) return;
  const choice = await confirmChoice({ title: "이미지를 휴지통으로 이동할까?", message: result.relativePath, confirmText: "휴지통으로 이동" });
  if (choice !== "confirm") return;
  await action(() => call(api.trashOutput({ id: result.id, projectId: result.projectId, relativePath: result.relativePath })), null, event.currentTarget);
  state.results.splice(state.singleResultIndex, 1);
  if (state.project?.id === result.projectId) state.project.results = state.project.results.filter((item) => item.id !== result.id);
  state.singleResultIndex = Math.max(0, Math.min(state.singleResultIndex, state.results.length - 1));
  renderSingleResults();
  notify("선택 이미지를 Windows 휴지통으로 이동했다.");
});

$("#artistStudyForm").addEventListener("input", (event) => {
  if (event.target.matches('[data-artist-field="weight"]')) event.target.nextElementSibling.textContent = Number(event.target.value).toFixed(2);
  markDirty("artist-study");
  invalidateCost("artist");
  scheduleCostEstimate("artist");
});
$("#artistStudyForm").addEventListener("change", () => { markDirty("artist-study"); invalidateCost("artist"); scheduleCostEstimate("artist"); });
$("#artistStudyForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveCurrentArtistStudy();
  const estimate = await estimateArtistStudy();
  if (!(await confirmAnlasUse(estimate))) return;
  const result = await action(() => call(api.generateArtistStudy(state.artistStudy)), "현재 작가 조합 한 장을 큐에 추가했다.", event.submitter);
  state.queue = result.queue;
  renderQueue();
});
$("#addArtistStudyCharacter").addEventListener("click", () => {
  syncArtistStudyFromDom();
  const character = { id: id("character"), name: `캐릭터 ${state.artistStudy.characters.length + 1}`, prompt: "", negativePrompt: "", enabled: true, position: null };
  state.artistStudy.characters.push(character);
  state.artistStudyCharacterOpenIds.add(character.id);
  markDirty("artist-study");
  renderArtistStudyCharacters();
});
$("#artistStudyCharacters").addEventListener("click", (event) => {
  const card = event.target.closest("[data-study-character-index]");
  if (!card) return;
  syncArtistStudyCharactersFromDom();
  const index = Number(card.dataset.studyCharacterIndex);
  if (event.target.hasAttribute("data-character-position")) {
    state.artistStudy.characters[index].position = event.target.dataset.characterPosition || null;
    markDirty("artist-study");
    renderArtistStudyCharacters();
    return;
  }
  const actionName = event.target.dataset.studyCharacterAction;
  if (!actionName) return;
  if (actionName === "delete") {
    state.artistStudyCharacterOpenIds.delete(state.artistStudy.characters[index].id);
    state.artistStudy.characters.splice(index, 1);
  } else {
    move(state.artistStudy.characters, index, actionName === "up" ? -1 : 1);
  }
  markDirty("artist-study");
  renderArtistStudyCharacters();
});
$("#artistStudyCharacters").addEventListener("input", (event) => {
  const card = event.target.closest("[data-study-character-index]");
  if (!card) return;
  if (event.target.matches("[data-study-character-field=name]")) $("summary strong", card).textContent = event.target.value || `캐릭터 ${Number(card.dataset.studyCharacterIndex) + 1}`;
  if (event.target.matches("[data-study-character-field=enabled]")) {
    const badge = $(".character-use-state", card);
    badge.textContent = event.target.checked ? "사용" : "미사용";
    badge.classList.toggle("off", !event.target.checked);
  }
});
$("#addStudyArtist").addEventListener("click", () => {
  syncArtistStudyFromDom();
  state.artistStudy.artists.push({ id: id("artist"), name: "", enabled: true, weight: 1 });
  markDirty("artist-study");
  renderArtistStudy();
  const names = $$('[data-artist-field="name"]', $("#artistSliderList"));
  names.at(-1)?.focus();
});
$("#artistSliderList").addEventListener("click", (event) => {
  const actionName = event.target.dataset.artistAction;
  if (!actionName) return;
  syncArtistStudyFromDom();
  const row = event.target.closest("[data-artist-index]");
  const index = Number(row.dataset.artistIndex);
  if (actionName === "delete") state.artistStudy.artists.splice(index, 1);
  else move(state.artistStudy.artists, index, actionName === "up" ? -1 : 1);
  markDirty("artist-study");
  renderArtistStudy();
});
$("#artistSliderList").addEventListener("change", (event) => {
  if (!event.target.matches('[data-artist-field="sort"]')) return;
  const row = event.target.closest("[data-artist-index]");
  const fromIndex = Number(row.dataset.artistIndex);
  syncArtistStudyFromDom();
  const lastIndex = state.artistStudy.artists.length - 1;
  const requestedIndex = Math.min(lastIndex, Math.max(0, Math.trunc(Number(event.target.value) || (fromIndex + 1)) - 1));
  if (requestedIndex !== fromIndex) {
    const [artist] = state.artistStudy.artists.splice(fromIndex, 1);
    state.artistStudy.artists.splice(requestedIndex, 0, artist);
  }
  markDirty("artist-study");
  renderArtistStudy();
  $(`[data-artist-index="${requestedIndex}"] [data-artist-field="sort"]`, $("#artistSliderList"))?.focus();
});
$("#artistSliderList").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target.matches('[data-artist-field="sort"]')) {
    event.preventDefault();
    event.target.blur();
  }
});
$("#artistStudyGallery").addEventListener("click", (event) => {
  const button = event.target.closest("[data-apply-artist-result]");
  if (button) applyArtistResult(Number(button.dataset.applyArtistResult));
});
$("#saveArtistStudy").addEventListener("click", (event) => saveCurrentArtistStudy(event.currentTarget));
$("#registerArtistExample").addEventListener("click", openArtistExampleNameDialog);
$("#artistExampleNameForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const dialog = $("#artistExampleNameDialog");
  const input = $("#artistExampleNameInput");
  const error = $("#artistExampleNameError");
  const name = input.value.trim();
  if (!name || dialog.dataset.busy === "true") return;
  dialog.dataset.busy = "true";
  input.disabled = true;
  $("#artistExampleNameCancel").disabled = true;
  error.hidden = true;
  try {
    syncArtistStudyFromDom();
    const saved = await action(() => call(api.saveArtistStudyExample(state.artistStudy, name)), null, event.submitter);
    await refreshLibraries();
    dialog.close();
    notify(`작례 프리셋으로 등록했다: ${saved.name}`);
  } catch (saveError) {
    error.textContent = saveError.message;
    error.hidden = false;
  } finally {
    dialog.dataset.busy = "false";
    input.disabled = false;
    $("#artistExampleNameCancel").disabled = false;
  }
});
$("#estimateArtistStudy").addEventListener("click", (event) => estimateArtistStudy(event.currentTarget));
$("#randomizeArtistStudy").addEventListener("click", async (event) => {
  syncArtistStudyFromDom();
  state.artistStudy = await action(() => call(api.randomizeArtistStudy(state.artistStudy)), "체크된 작가의 가중치만 무작위로 조절했다.", event.currentTarget);
  markDirty("artist-study");
  renderArtistStudy();
});
$("#sortStudyArtists").addEventListener("click", () => {
  syncArtistStudyFromDom();
  state.artistStudy.artists = state.artistStudy.artists
    .map((artist, index) => ({ artist, index }))
    .sort((left, right) => Number(right.artist.enabled) - Number(left.artist.enabled)
      || Number(right.artist.weight) - Number(left.artist.weight)
      || left.index - right.index)
    .map(({ artist }) => artist);
  markDirty("artist-study");
  renderArtistStudy();
});
$("#randomGenerateArtistStudy").addEventListener("click", async (event) => {
  syncArtistStudyFromDom();
  const estimate = await estimateArtistStudy();
  if (!(await confirmAnlasUse(estimate))) return;
  const result = await action(async () => {
    state.artistStudy = await call(api.randomizeArtistStudy(state.artistStudy));
    state.artistStudy = await call(api.saveArtistStudy(state.artistStudy));
    const generated = await call(api.generateArtistStudy(state.artistStudy));
    markDirty("artist-study", false);
    renderArtistStudy();
    return generated;
  }, "체크된 작가만 랜덤 조절해 한 장을 큐에 추가했다.", event.currentTarget);
  state.queue = result.queue;
  renderQueue();
});
$$('[data-open-outputs]').forEach((button) => button.addEventListener("click", (event) => action(() => call(api.openOutputs()), null, event.currentTarget)));
$("#hostHomeButton").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  if (!window.nainTailHost?.goHome) {
    notify("NainTail 호스트 홈을 사용할 수 없는 실행 환경이야.", true);
    return;
  }
  button.disabled = true;
  try {
    const response = await window.nainTailHost.goHome();
    if (!response?.ok) throw new Error(response?.error?.message || "홈으로 돌아가지 못했다.");
  } catch (error) {
    notify(error.message, true);
  } finally {
    button.disabled = false;
  }
});

$("#newProject").addEventListener("click", async (event) => { if (!(await guardUnsaved("project"))) return; const created = await action(() => call(api.createProject({ name: "새 작품" })), "새 작품을 만들었다.", event.currentTarget); state.project = created; markDirty("project", false); await refreshLibraries(); renderProject(); });
$("#projectList").addEventListener("click", async (event) => { const pid = event.target.closest("[data-project-id]")?.dataset.projectId; if (!pid || pid === state.project?.id) return; if (!(await guardUnsaved("project"))) return; state.project = await action(() => call(api.getProject(pid)), null, event.target.closest("[data-project-id]")); markDirty("project", false); renderProject(); });
$("#projectEditor").addEventListener("input", () => { markDirty("project"); invalidateCost("project"); scheduleCostEstimate("project"); });
$("#projectEditor").addEventListener("change", () => { markDirty("project"); invalidateCost("project"); scheduleCostEstimate("project"); });
$("#projectEditor").addEventListener("submit", async (event) => { if (event.target.id !== "projectForm") return; event.preventDefault(); await saveCurrentProject(event.submitter); });
$("#projectEditor").addEventListener("click", async (event) => {
  const el = event.target; if (!state.project) return;
  if (el.id === "addCharacter") { syncProjectFromDom(); state.project.characters.push({ id: id("character"), name: "새 캐릭터", prompt: "", negativePrompt: "", enabled: true, position: null, settings: {}, slots: [] }); markDirty("project"); renderProject(); return; }
  if (el.hasAttribute("data-character-position")) { syncProjectFromDom(); const card = el.closest("[data-character-index]"); if (!card) return; state.project.characters[Number(card.dataset.characterIndex)].position = el.dataset.characterPosition || null; markDirty("project"); renderProject(); return; }
  if (el.id === "reloadProject") { if (!state.projectDirty || await confirmChoice({ title: "편집 내용 버리기", message: "마지막 저장 이후 변경을 버리고 작품을 다시 불러올까?", confirmText: "버리기" }) === "confirm") await discardProjectChanges(); return; }
  const scope = el.dataset.generateScope; if (scope) { if (state.projectDirty) await saveCurrentProject(); else syncProjectFromDom(); const estimate = await estimateProject(scope); if (!(await confirmAnlasUse(estimate))) return; const result = await action(() => call(api.generateProject(state.project.id, { scope })), `${resultLabel(scope)} 요청을 큐에 추가했다.`, el); state.queue = result.queue; renderQueue(); return; }
  const addOwner = el.dataset.addSlot; if (addOwner) { syncProjectFromDom(); slotsForOwner(addOwner).push({ id: id("slot"), name: "새 슬롯", prompt: "", negativePrompt: "", enabled: true, settings: {} }); markDirty("project"); renderProject(); return; }
  const slotAction = el.dataset.slotAction; if (slotAction) { syncProjectFromDom(); const row = el.closest("[data-owner]"); const list = slotsForOwner(row.dataset.owner), index = Number(row.dataset.index); if (slotAction === "delete") list.splice(index, 1); else move(list, index, slotAction === "up" ? -1 : 1); markDirty("project"); renderProject(); return; }
  const card = el.closest("[data-character-index]"); if (card && (el.dataset.characterMove || el.hasAttribute("data-character-delete"))) { syncProjectFromDom(); const index = Number(card.dataset.characterIndex); if (el.hasAttribute("data-character-delete")) { const character = state.project.characters[index]; const choice = await confirmChoice({ title: "캐릭터 카드 삭제", message: `${character.name} 카드와 카드가 소유한 ${character.slots.length}개 슬롯을 편집 내용에서 제거할까?`, confirmText: "카드 삭제" }); if (choice !== "confirm") return; state.project.characters.splice(index, 1); } else move(state.project.characters, index, el.dataset.characterMove === "up" ? -1 : 1); markDirty("project"); renderProject(); return; }
  const owner = el.dataset.appendPreset; if (owner) { syncProjectFromDom(); state.project = await action(() => call(api.saveProject(state.project))); const select = $(`[data-preset-select="${CSS.escape(owner)}"]`); const target = owner === "general" ? { type: "general" } : { type: "character", characterId: owner.split(":")[1] }; state.project = await action(() => call(api.appendPreset(state.project.id, select.value, target)), "프리셋 항목을 독립 슬롯으로 Append했다.", el); markDirty("project", false); await refreshLibraries(); renderProject(); }
});
function resultLabel(scope) { return scope === "all" ? "전체" : scope === "general" ? "일반 슬롯" : "캐릭터 슬롯"; }

$("#presetTypeTabs").addEventListener("click", async (event) => { const type = event.target.closest("[data-preset-type]")?.dataset.presetType; if (!type || type === state.presetType) return; if (!(await guardUnsaved("preset"))) return; state.presetType = type; state.preset = null; markDirty("preset", false); renderPreset(); });
$("#newPreset").addEventListener("click", async () => { if (!(await guardUnsaved("preset"))) return; state.preset = state.presetType === "example" ? { schema: "naintail.example-preset/v1", type: "example", id: id("example"), name: "새 작례 프리셋", prompt: "", negativePrompt: "" } : { schema: "naintail.sub-slot-preset/v1", type: "sub-slot", id: id("preset"), name: "새 서브슬롯 프리셋", items: [] }; markDirty("preset"); renderPreset(); });
$("#presetList").addEventListener("click", async (event) => { const pid = event.target.closest("[data-preset-id]")?.dataset.presetId; if (!pid || pid === state.preset?.id) return; if (!(await guardUnsaved("preset"))) return; state.preset = await action(() => call(api.getPreset(pid)), null, event.target.closest("[data-preset-id]")); markDirty("preset", false); renderPreset(); });
$("#presetEditor").addEventListener("input", () => markDirty("preset"));
$("#presetEditor").addEventListener("change", () => markDirty("preset"));
$("#presetEditor").addEventListener("submit", async (event) => { if (event.target.id !== "presetForm") return; event.preventDefault(); await saveCurrentPreset(event.submitter); });
$("#presetEditor").addEventListener("click", async (event) => { const el = event.target; if (!state.preset) return; if (el.id === "addPresetItem" && state.preset.type === "sub-slot") { syncPresetFromDom(); state.preset.items.push({ name: "새 슬롯", prompt: "", negativePrompt: "", settings: {} }); markDirty("preset"); renderPreset(); return; } if (el.id === "deletePreset") { const saved = state.presets.some((item) => item.id === state.preset.id); if (!saved) { state.preset = null; markDirty("preset", false); renderPreset(); return; } const isExample = state.preset.type === "example"; const choice = await confirmChoice({ title: `${isExample ? "작례" : "서브슬롯"} 프리셋 삭제`, message: isExample ? `${state.preset.name} 작례 프리셋을 영구 삭제할까?` : `${state.preset.name} 프리셋을 영구 삭제할까? 이미 Append한 독립 슬롯은 영향을 받지 않아.`, confirmText: "프리셋 삭제" }); if (choice !== "confirm") return; await action(() => call(api.deletePreset(state.preset.id)), "프리셋을 삭제했다.", el); state.preset = null; markDirty("preset", false); await refreshLibraries(); renderPreset(); return; } if (state.preset.type !== "sub-slot") return; const row = el.closest("[data-preset-index]"); if (!row) return; syncPresetFromDom(); const index = Number(row.dataset.presetIndex); if (el.hasAttribute("data-preset-item-delete")) state.preset.items.splice(index, 1); else if (el.dataset.presetMove) move(state.preset.items, index, el.dataset.presetMove === "up" ? -1 : 1); markDirty("preset"); renderPreset(); });

async function refreshAllCostEstimates() { await Promise.all([estimateSingle(), estimateMulti(), estimateArtistStudy(), estimateAllProjectCosts()]); }
$("#credentialForm").addEventListener("submit", async (event) => { event.preventDefault(); const token = event.currentTarget.elements.token.value; const credential = await action(() => call(api.saveCredential(token)), "토큰을 암호화 저장했다.", event.submitter); renderCredentialStatus(credential); event.currentTarget.reset(); await refreshStatus(); await refreshSubscription(); await refreshAllCostEstimates(); });
$("#clearCredential").addEventListener("click", async (event) => { const choice = await confirmChoice({ title: "저장된 토큰 삭제", message: "암호화 저장된 NovelAI 토큰을 이 제품 폴더에서 삭제할까?", confirmText: "토큰 삭제" }); if (choice !== "confirm") return; const credential = await action(() => call(api.clearCredential()), "저장된 토큰을 삭제했다.", event.currentTarget); state.subscription = null; state.subscriptionCheckedAt = 0; renderCredentialStatus(credential); await refreshStatus(); await refreshAllCostEstimates(); });
$("#openOutputFolder").addEventListener("click", (event) => action(() => call(api.openOutputs()), null, event.currentTarget));
$("#selectOutputFolder").addEventListener("click", async (event) => { const settings = await action(() => call(api.selectOutputFolder()), "출력 폴더를 변경했다.", event.currentTarget); renderOutputSettings(settings); await refreshStatus(); });
$("#resetOutputFolder").addEventListener("click", async (event) => { const settings = await action(() => call(api.resetOutputFolder()), "애드온 기본 출력 폴더로 복원했다.", event.currentTarget); renderOutputSettings(settings); await refreshStatus(); });
$("#checkSubscription").addEventListener("click", async (event) => { await refreshSubscription(event.currentTarget); await refreshAllCostEstimates(); });
initializeHeaderUsagePopover();
$("#anlasBalanceBadge").addEventListener("click", async (event) => { try { await refreshSubscription(event.currentTarget); await refreshAllCostEstimates(); notify("Anlas 잔액을 갱신했다."); } catch (error) { notify(`${error.code ? `${error.code}: ` : ""}${error.message}`, true); } });
$("#clearQueue").addEventListener("click", async (event) => { const pending = state.queue.jobs?.filter((job) => job.state === "pending").length || 0; if (pending > 0) { const choice = await confirmChoice({ title: "대기열 비우기", message: `NAI에 아직 보내지 않은 ${pending}개 작업을 취소할까? 이미 전송된 한 장은 완료 후 저장돼.`, confirmText: "대기 작업 취소" }); if (choice !== "confirm") return; } const result = await action(() => call(api.clearQueue()), "NAI에 아직 보내지 않은 작업을 취소했다.", event.currentTarget); state.queue = result.queue; renderQueue(); });
$("#stopQueue").addEventListener("click", async (event) => { const result = await action(() => call(api.stopAfterCurrent()), "현재 이미지까지 저장한 뒤 중단한다.", event.currentTarget); state.queue = result.queue; renderQueue(); });
$("#resumeQueue").addEventListener("click", async (event) => { state.queue = await action(() => call(api.resumeQueue()), "큐를 재개했다.", event.currentTarget); renderQueue(); });
api.onQueue((event) => {
  const previousState = state.queue?.state;
  state.queue = event.queue;
  renderQueue();
  if (previousState !== "idle" && state.queue?.state === "idle" && (state.credential?.state === "ready" || state.credential?.configured === true)) {
    refreshSubscription().then(refreshAllCostEstimates).catch(() => {});
  }
});
api.onResult((result) => addResult(result));

window.setInterval(() => renderOpusUsageCountdown(), 1000);

async function init() { try { initGenerationPanelResizers(); renderDevelopmentFeatures(); updateSingleGenerationSummary(); await Promise.all([refreshLibraries(), refreshStatus(), refreshArtistStudy()]); try { await refreshSubscription(); } catch { state.subscription = null; } renderVibes("single"); renderPreciseReferences("single"); renderModelCapabilities("single"); renderProject(); renderPreset(); renderMulti(); syncHeaderModelSelector(); await Promise.all([refreshVibeCacheStatus("single"), refreshVibeCacheStatus("multi")]); await refreshAllCostEstimates(); } catch (error) { notify(error.message, true); } }
init();
