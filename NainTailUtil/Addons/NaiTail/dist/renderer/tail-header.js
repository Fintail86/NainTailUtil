(() => {
  "use strict";

  const ADDONS = {
    naitail: { title: "NaiTail", mark: "N", role: "NOVELAI ADD-ON" },
    animatail: { title: "AnimaTail", mark: "A", role: "LOCAL STUDIO" },
    gallerytail: { title: "GalleryTail", mark: "G", role: "OUTPUT BROWSER" },
    censortail: { title: "CensorTail", mark: "C", role: "LOCAL CENSOR" }
  };

  const ICONS = {
    single: '<path d="M7 1.5v11M1.5 7h11"/><path d="m3 3 8 8M11 3 3 11"/>',
    multi: '<rect x="1.5" y="2" width="7" height="7" rx="1"/><path d="M5 12h6a1 1 0 0 0 1-1V5"/>',
    study: '<path d="M2 11 10.5 2.5M8 2h3.5v3.5"/><path d="M2 6v6h6"/>',
    project: '<rect x="2" y="2" width="10" height="10" rx="1.5"/><path d="M4.5 5h5M4.5 8h5"/>',
    preset: '<path d="M2 4h10M2 10h10M5 2v4M9 8v4"/>',
    settings: '<circle cx="7" cy="7" r="2.2"/><path d="M7 1.5v1.2M7 11.3v1.2M1.5 7h1.2M11.3 7h1.2M3.1 3.1l.9.9M10 10l.9.9M10.9 3.1l-.9.9M4 10l-.9.9"/>',
    gallery: '<rect x="1.5" y="2" width="11" height="10" rx="1.5"/><circle cx="4.5" cy="5" r="1"/><path d="m3 10 2.7-2.7L8 9.5l1.5-1.5 2 2"/>',
    censor: '<path d="M7 1.5 11.5 3v3.5c0 2.7-1.8 4.8-4.5 6-2.7-1.2-4.5-3.3-4.5-6V3z"/><path d="m4.7 7 1.4 1.4 3-3"/>',
    back: '<path d="m8.5 3-4 4 4 4"/>'
  };

  const state = {
    key: "warning",
    message: "상태 확인 중",
    history: [],
    notifications: [],
    explicitStatus: null,
    scheduled: false,
    initialized: false
  };

  function addonKey() {
    const haystack = `${document.title} ${location.pathname}`.toLowerCase();
    return Object.keys(ADDONS).find((key) => haystack.includes(key)) || "naitail";
  }

  function svg(path, className = "") {
    return `<svg${className ? ` class="${className}"` : ""} viewBox="0 0 14 14" aria-hidden="true">${path}</svg>`;
  }

  function text(el) {
    return (el?.textContent || "").replace(/\s+/gu, " ").trim();
  }

  function setText(el, value) {
    if (el && el.textContent !== value) el.textContent = value;
  }

  function classifyTab(label) {
    if (/설정/u.test(label)) return "settings";
    if (/프리셋/u.test(label)) return "preset";
    if (/작품/u.test(label)) return "project";
    if (/연구/u.test(label)) return "study";
    if (/멀티/u.test(label)) return "multi";
    if (/갤러리/u.test(label)) return "gallery";
    if (/검열/u.test(label)) return "censor";
    return "single";
  }

  function normalizeTabs(header) {
    const nav = header.querySelector(".tab-nav");
    if (!nav) return;
    nav.querySelectorAll(".tab, .tab-item").forEach((tab) => {
      const label = text(tab).replace(/^[✦✧◇▣⌁⚙]+\s*/u, "");
      const kind = classifyTab(label);
      let icon = tab.querySelector(".tail-tab-icon");
      if (!icon) {
        tab.querySelectorAll(".tab-icon").forEach((old) => old.remove());
        icon = document.createElement("span");
        icon.className = "tail-tab-icon";
        icon.innerHTML = svg(ICONS[kind]);
        tab.prepend(icon);
      }
      const nodes = Array.from(tab.childNodes).filter((node) => node !== icon);
      const currentLabel = nodes.map((node) => node.textContent || "").join("").trim();
      if (currentLabel !== label) {
        nodes.forEach((node) => node.remove());
        tab.append(document.createTextNode(label));
      }
    });
  }

  function normalizeIdentity(header, config) {
    const brand = header.querySelector(".brand");
    if (!brand) return;

    const mark = brand.querySelector(".brand-mark");
    if (mark) {
      setText(mark, config.mark);
      mark.setAttribute("role", "button");
      mark.setAttribute("tabindex", "0");
      mark.setAttribute("aria-label", `${config.title} 기본 화면`);
      if (!mark.dataset.tailBound) {
        const activateDefault = () => header.querySelector(".tab-nav .tab, .tab-nav .tab-item")?.click();
        mark.addEventListener("click", activateDefault);
        mark.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            activateDefault();
          }
        });
        mark.dataset.tailBound = "true";
      }
    }

    const copy = brand.querySelector(".brand-copy") || brand.querySelector("div");
    setText(copy?.querySelector("strong"), config.title);
    setText(copy?.querySelector("small"), config.role);

    const hosted = typeof window.nainTailHost?.goHome === "function";
    document.body.dataset.tailHosted = hosted ? "true" : "false";
    brand.querySelectorAll(".host-home-button").forEach((button) => {
      button.hidden = true;
      button.setAttribute("aria-hidden", "true");
    });
    let back = brand.querySelector(".tail-host-back");
    if (hosted && !back) {
      back = document.createElement("button");
      back.type = "button";
      back.className = "tail-host-back";
      back.setAttribute("aria-label", "NainTail 홈으로 돌아가기");
      back.title = "NainTail 홈으로 돌아가기";
      back.innerHTML = svg(ICONS.back);
      back.addEventListener("click", () => window.nainTailHost.goHome());
      brand.prepend(back);
    } else if (!hosted && back) {
      back.remove();
    }

    if (!header.querySelector(".tail-identity-divider")) {
      const divider = document.createElement("span");
      divider.className = "tail-identity-divider";
      divider.setAttribute("aria-hidden", "true");
      header.append(divider);
    }
  }

  function ensureStateUi(header) {
    const meta = header.querySelector(".header-meta");
    if (!meta) return null;
    let wrap = meta.querySelector(".tail-state-wrap");
    if (wrap) return wrap;
    wrap = document.createElement("div");
    wrap.className = "tail-state-wrap";
    wrap.innerHTML = `
      <button type="button" class="tail-state-button" aria-label="상태 기록 열기" aria-expanded="false">
        <span class="tail-state-shape" aria-hidden="true"></span>
      </button>
      <span class="tail-state-tooltip" role="tooltip">상태 확인 중</span>
      <section class="tail-state-history" aria-label="상태 기록" hidden><strong>상태 기록</strong><ul></ul></section>
      <div class="tail-notification-stack" role="status" aria-live="polite"></div>`;
    meta.append(wrap);
    const button = wrap.querySelector(".tail-state-button");
    const history = wrap.querySelector(".tail-state-history");
    button.addEventListener("click", () => {
      history.hidden = !history.hidden;
      button.setAttribute("aria-expanded", String(!history.hidden));
      renderHistory(wrap);
    });
    document.addEventListener("pointerdown", (event) => {
      if (!wrap.contains(event.target)) {
        history.hidden = true;
        button.setAttribute("aria-expanded", "false");
      }
    });
    return wrap;
  }

  function resourceFrom(key, header) {
    const meta = header.querySelector(".header-meta");
    if (!meta) return;
    let source = null;
    let value = "";
    if (key === "naitail") {
      source = header.querySelector("#anlasBalanceBadge");
      value = text(source);
      source?.classList.add("tail-header-source");
      header.querySelector("#connectionBadge")?.classList.add("tail-header-source");
    } else if (key === "animatail") {
      header.querySelector(".runtime-chip")?.classList.add("tail-header-source");
      header.querySelector(".version-chip")?.classList.add("tail-header-static");
    } else if (key === "gallerytail") {
      source = header.querySelector(".version-chip");
      const count = text(document.body).match(/(\d+)\s*개\s*이미지/u)?.[1];
      value = count ? `${count} IMAGES` : "OUTPUTS";
      source?.classList.add("tail-header-source");
    } else {
      header.querySelector(".version-chip")?.classList.add("tail-header-static");
      const model = document.querySelector(".censor-model-card");
      value = model ? text(model).slice(0, 44) : "";
    }
    let resource = meta.querySelector(".tail-resource");
    if (!value) {
      resource?.remove();
      return;
    }
    if (!resource) {
      resource = document.createElement("div");
      resource.className = "tail-resource";
      const stateWrap = meta.querySelector(".tail-state-wrap");
      meta.insertBefore(resource, stateWrap || null);
    }
    setText(resource, value);
    resource.title = value;
  }

  function inferStatus(key, header) {
    if (key === "naitail") {
      const badge = header.querySelector("#connectionBadge");
      const label = text(badge) || "연결 상태 확인 중";
      if (badge?.classList.contains("good") || /연결됨|사용 가능|ready|connected/iu.test(label)) return ["ready", label];
      if (badge?.classList.contains("bad") || /missing|미설정|없음|실패|오류|error|invalid/iu.test(label)) return ["alert", label];
      return ["warning", label];
    }
    if (key === "animatail") {
      const chip = header.querySelector(".runtime-chip");
      const label = text(chip) || "런타임 확인 중";
      if (chip?.classList.contains("ready") || /준비됨|ready/iu.test(label)) return ["ready", label];
      if (/not-installed|manifest-missing|manifest-invalid/u.test(chip?.className || "") || /미설치|실패|오류|없음|invalid/iu.test(label)) return ["alert", label];
      return ["warning", label];
    }
    if (key === "gallerytail") {
      const error = document.querySelector(".error, [role='alert']");
      if (error && text(error)) return ["alert", text(error)];
      if (text(document.querySelector(".gallery-page")).match(/\d+\s*개\s*이미지/u)) return ["ready", "갤러리 사용 가능"];
      if (document.querySelector(".gallery-page .loading, .gallery-page [aria-busy='true']")) return ["warning", "출력 목록을 불러오는 중"];
      return ["ready", "갤러리 사용 가능"];
    }
    const error = document.querySelector(".censor-error, .censor-runtime-dialog [role='alert']");
    if (error && text(error)) return ["alert", text(error)];
    const progress = document.querySelector(".censor-progress");
    if (progress && text(progress)) {
      return ["warning", text(progress) || "검열 런타임 준비 중"];
    }
    return ["ready", "검열 엔진 사용 가능"];
  }

  function pushHistory(level, message) {
    const previous = state.history[0];
    if (previous?.level === level && previous.message === message) return;
    state.history.unshift({ level, message, at: new Date() });
    state.history = state.history.slice(0, 8);
  }

  function notify(level, message, options = {}) {
    if (!message || level === "ready") return;
    const existing = state.notifications.find((item) => item.level === level && item.message === message);
    if (existing) {
      existing.count += 1;
      existing.createdAt = Date.now();
      existing.statusBound ||= Boolean(options.statusBound);
      if (existing.timer) clearTimeout(existing.timer);
      scheduleDismiss(existing, options);
    } else {
      const item = { id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, level, message, count: 1, createdAt: Date.now(), timer: null, statusBound: Boolean(options.statusBound) };
      state.notifications.unshift(item);
      scheduleDismiss(item, options);
    }
    renderNotifications(document.querySelector(".tail-header .tail-state-wrap"));
  }

  function scheduleDismiss(item, options) {
    if (item.level !== "warning" || options.persistent) return;
    item.timer = setTimeout(() => {
      state.notifications = state.notifications.filter((candidate) => candidate !== item);
      renderNotifications(document.querySelector(".tail-header .tail-state-wrap"));
    }, 5000);
  }

  function setStatus(level, message, options = {}) {
    const normalized = ["ready", "warning", "alert"].includes(level) ? level : "warning";
    const changed = state.key !== normalized || state.message !== message;
    if (changed && state.key === "alert" && normalized !== "alert") {
      state.notifications = state.notifications.filter((item) => !(item.statusBound && item.level === "alert"));
    }
    state.key = normalized;
    state.message = message || "상태 정보 없음";
    if (changed) {
      pushHistory(normalized, state.message);
      if (state.initialized || normalized !== "ready") notify(normalized, state.message, { ...options, statusBound: true });
    }
    const header = document.querySelector(".tail-header");
    if (!header) return;
    header.dataset.tailState = normalized;
    const wrap = ensureStateUi(header);
    const button = wrap?.querySelector(".tail-state-button");
    const tooltip = wrap?.querySelector(".tail-state-tooltip");
    button?.setAttribute("aria-label", `${normalized === "ready" ? "준비됨" : normalized === "warning" ? "주의" : "오류"}: ${state.message}. 상태 기록 열기`);
    setText(tooltip, state.message);
    renderHistory(wrap);
    renderNotifications(wrap);
  }

  function renderHistory(wrap) {
    const list = wrap?.querySelector(".tail-state-history ul");
    if (!list) return;
    const signature = state.history.map((item) => `${item.level}:${item.message}:${item.at.getTime()}`).join("|");
    if (list.dataset.signature === signature) return;
    list.dataset.signature = signature;
    list.replaceChildren(...state.history.map((item) => {
      const li = document.createElement("li");
      const stamp = item.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      li.textContent = `${stamp} · ${item.message}`;
      return li;
    }));
  }

  function renderNotifications(wrap) {
    const stack = wrap?.querySelector(".tail-notification-stack");
    if (!stack) return;
    const signature = state.notifications.map((item) => `${item.id}:${item.count}`).join("|");
    if (stack.dataset.signature === signature) return;
    stack.dataset.signature = signature;
    stack.replaceChildren();
    state.notifications.slice(0, 3).forEach((item) => {
      const card = document.createElement("article");
      card.className = "tail-notification";
      card.dataset.level = item.level;
      const marker = document.createElement("small");
      marker.textContent = item.level === "alert" ? "!" : "△";
      const body = document.createElement("p");
      body.textContent = item.message;
      if (item.count > 1) body.append(` ×${item.count}`);
      const close = document.createElement("button");
      close.type = "button";
      close.setAttribute("aria-label", "알림 닫기");
      close.textContent = "×";
      close.addEventListener("click", () => {
        if (item.timer) clearTimeout(item.timer);
        state.notifications = state.notifications.filter((candidate) => candidate !== item);
        renderNotifications(wrap);
      });
      card.append(marker, body, close);
      stack.append(card);
    });
    if (state.notifications.length > 3) {
      const overflow = document.createElement("span");
      overflow.className = "tail-notification-overflow";
      overflow.textContent = `+${state.notifications.length - 3}`;
      stack.append(overflow);
    }
  }

  function normalize() {
    state.scheduled = false;
    const header = document.querySelector(".app-header");
    if (!header) return;
    const key = addonKey();
    document.body.dataset.tailAddon = key;
    header.classList.add("tail-header");
    normalizeIdentity(header, ADDONS[key]);
    normalizeTabs(header);
    ensureStateUi(header);
    resourceFrom(key, header);
    const [level, message] = state.explicitStatus || inferStatus(key, header);
    setStatus(level, message);
    state.initialized = true;
  }

  function scheduleNormalize() {
    if (state.scheduled) return;
    state.scheduled = true;
    requestAnimationFrame(normalize);
  }

  window.addEventListener("tail-header:status", (event) => {
    const detail = event.detail || {};
    state.explicitStatus = [detail.level, detail.message];
    setStatus(detail.level, detail.message, { persistent: detail.persistent });
  });
  window.addEventListener("tail-header:notify", (event) => {
    const detail = event.detail || {};
    notify(detail.level || "warning", detail.message, { persistent: detail.persistent });
  });
  window.tailHeader = Object.freeze({
    publish(level, message, options = {}) {
      state.explicitStatus = [level, message];
      setStatus(level, message, options);
    },
    clear() {
      state.explicitStatus = null;
      scheduleNormalize();
    },
    notify(level, message, options = {}) {
      notify(level, message, options);
    }
  });

  new MutationObserver(scheduleNormalize).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "hidden", "disabled"]
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scheduleNormalize, { once: true });
  else scheduleNormalize();
})();
