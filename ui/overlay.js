(() => {
  "use strict";

  if (window.LumeoOverlay?.__loaded) return;

  const DEFAULT_LAYOUT = Object.freeze({ left: null, top: null, width: null, height: null, sideCollapsed: false });


  function createOverlayController(options = {}) {
    const doc = options.document || document;
    const win = options.window || window;
    const storage = options.localStorage || win.localStorage;
    const fallbackLayoutKey = "lumeoOverlayLayout";
    const layoutKeyOption = options.layoutKey || fallbackLayoutKey;
    const languages = options.languages || [];

    function currentLayoutKey() {
      const key = typeof layoutKeyOption === "function" ? layoutKeyOption() : layoutKeyOption;
      return typeof key === "string" && key ? key : fallbackLayoutKey;
    }

    let root = null;
    let elements = {};
    let layout = loadLayout();

    // Start observing YouTube player controls immediately on controller creation
    setTimeout(() => {
      try { bindYouTubeObserver(); } catch {}
    }, 0);

    function loadLayout() {
      const layoutKey = currentLayoutKey();
      try {
        const stored = storage.getItem(layoutKey) || (layoutKey !== fallbackLayoutKey ? storage.getItem(fallbackLayoutKey) : null);
        const parsed = JSON.parse(stored || "{}");
        const next = { ...DEFAULT_LAYOUT, ...parsed };
        if (!stored && options.collapsedOnStart) next.sideCollapsed = true;
        return next;
      } catch {
        return { ...DEFAULT_LAYOUT };
      }
    }

    function saveLayout() {
      try { storage.setItem(currentLayoutKey(), JSON.stringify(layout)); } catch {}
    }

    function refreshLayoutKey() {
      layout = loadLayout();
      applyLayout();
    }

    let ytButton = null;
    let ytObserver = null;
    let ytPollTimer = null;

    function ensureYouTubeControlButton() {
      if (typeof doc === "undefined" || !doc.querySelector) return null;
      const rightControls = doc.querySelector(
        "#movie_player .ytp-chrome-bottom .ytp-right-controls, " +
        "#movie_player .ytp-right-controls, " +
        ".html5-video-player .ytp-right-controls, " +
        ".ytp-chrome-controls .ytp-right-controls, " +
        ".ytp-right-controls"
      );
      if (!rightControls) return null;

      let btn = rightControls.querySelector(".ytp-lumeo-button");
      if (!btn) {
        btn = doc.createElement("button");
        btn.className = "ytp-button ytp-lumeo-button";
        btn.type = "button";
        btn.setAttribute("aria-label", "Lumeo Captions & AI Dubbing");
        btn.innerHTML = `
          <svg viewBox="0 0 36 36" width="100%" height="100%">
            <rect x="8" y="10.5" width="20" height="15" rx="3" stroke="currentColor" stroke-width="2" fill="none" />
            <path d="M12 15h6M12 19h12M20 15h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            <circle class="ytp-lumeo-dot" cx="24.5" cy="11.5" r="2.2" fill="#f97316" />
          </svg>
        `;
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          e.preventDefault();
          if (typeof options.onButtonClick === "function") {
            options.onButtonClick();
          } else {
            toggleSideCollapsed();
          }
        });

        const settingsBtn = rightControls.querySelector(".ytp-settings-button");
        try {
          if (settingsBtn && settingsBtn.parentNode === rightControls) {
            rightControls.insertBefore(btn, settingsBtn);
          } else if (settingsBtn && settingsBtn.parentNode) {
            settingsBtn.parentNode.insertBefore(btn, settingsBtn);
          } else {
            rightControls.appendChild(btn);
          }
        } catch {
          try {
            rightControls.appendChild(btn);
          } catch {}
        }
      }
      ytButton = btn;
      updateYouTubeControlButton();
      return btn;
    }

    function updateYouTubeControlButton() {
      if (!ytButton) return;
      const isOpen = Boolean(root && !layout.sideCollapsed);
      ytButton.classList.toggle("ytp-lumeo-active", isOpen);
      ytButton.setAttribute("aria-pressed", String(isOpen));
      ytButton.title = isOpen ? "Hide Lumeo (Esc)" : "Open Lumeo (Esc)";
    }

    function bindYouTubeObserver() {
      if (typeof MutationObserver === "undefined") return;
      const target = doc.body || doc.documentElement;
      if (!target) return;
      if (ytObserver) ytObserver.disconnect();
      ytObserver = new MutationObserver(() => {
        ensureYouTubeControlButton();
      });
      try {
        ytObserver.observe(target, { childList: true, subtree: true });
      } catch {}
      ensureYouTubeControlButton();
      if (!ytPollTimer && typeof win.setInterval === "function") {
        ytPollTimer = win.setInterval(ensureYouTubeControlButton, 1000);
      }
    }

    function clampLayout() {
      const maxW = Math.max(280, win.innerWidth - 24);
      const w = Math.min(Math.max(layout.width || 300, 260), maxW);
      if (layout.left !== null && layout.top !== null) {
        const left = Math.min(Math.max(layout.left, 8), win.innerWidth - w - 8);
        const top = Math.min(Math.max(layout.top, 8), win.innerHeight - 44);
        layout = { ...layout, left, top, width: w };
      } else {
        layout = { ...layout, width: w };
      }
    }

    function applyLayout() {
      if (!root) return;
      clampLayout();
      if (layout.left !== null && layout.top !== null) {
        root.style.left = layout.left + "px";
        root.style.top = layout.top + "px";
        root.style.width = layout.sideCollapsed ? "auto" : layout.width + "px";
        root.style.height = "auto";
        root.style.right = "auto";
        root.style.bottom = "auto";
        root.style.position = "fixed";
      } else {
        const inPlayer = Boolean(root.parentElement && (root.parentElement.id === "movie_player" || root.parentElement.classList?.contains("html5-video-player")));
        root.style.position = inPlayer ? "absolute" : "fixed";
        root.style.right = "12px";
        root.style.bottom = "60px";
        root.style.left = "auto";
        root.style.top = "auto";
        root.style.width = layout.sideCollapsed ? "auto" : (layout.width || 300) + "px";
        root.style.height = "auto";
      }
      root.classList.toggle("is-side-collapsed", !!layout.sideCollapsed);
      root.classList.toggle("is-compact", layout.width < 560);
      if (elements.hideBtn) {
        elements.hideBtn.title = layout.sideCollapsed ? "Open Lumeo (Esc)" : "Minimize Lumeo (Esc)";
      }
      updateYouTubeControlButton();
    }

    function updateYouTubeControlButton() {
      if (!ytButton) return;
      const isOpen = Boolean(root && !layout.sideCollapsed);
      ytButton.classList.toggle("ytp-lumeo-active", isOpen);
      ytButton.setAttribute("aria-pressed", String(isOpen));
      ytButton.title = isOpen ? "Minimize Lumeo (Esc)" : "Open Lumeo — AI Captions & Dubbing (Esc)";
    }

    function build() {
      if (root) return root;
      root = doc.createElement("aside");
      root.className = "ec-root ytp-lumeo-popover-host";
      root.dataset.state = "ready";
      root.setAttribute("aria-keyshortcuts", "Escape ? h Control+Shift+L Meta+Shift+L");
      root.innerHTML = `
        <div class="ytp-lumeo-popover" role="dialog" aria-label="Lumeo Quick Settings">
          <div class="ytp-lumeo-header" data-ec-drag>
            <div class="ytp-lumeo-brand">
              <span class="ytp-lumeo-logo-badge">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="#f97316" stroke-width="2.2"/>
                  <path d="M7 12h10M12 7v10" stroke="#f97316" stroke-width="2.2" stroke-linecap="round"/>
                </svg>
              </span>
              <span class="ytp-lumeo-title">Lumeo</span>
              <span class="ec-dot" data-ec-dot title="Lumeo: Ready"></span>
            </div>
            <div class="ytp-lumeo-header-actions">
              <button class="ytp-lumeo-icon-btn" type="button" data-ec-open-options aria-label="Settings" title="Full Settings & API Keys ↗">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1 2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
              </button>
              <button class="ytp-lumeo-icon-btn" type="button" data-ec-hide aria-keyshortcuts="Escape" aria-label="Minimize" title="Minimize (Esc)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          </div>
          <div class="ytp-lumeo-body">
            <div class="ytp-lumeo-row">
              <label class="ytp-lumeo-label">Target Language</label>
              <select class="ec-select ytp-lumeo-select" data-ec-language aria-label="Target language" title="Select target language"></select>
            </div>
            <div class="ytp-lumeo-row" data-ec-voice-row>
              <label class="ytp-lumeo-label">AI Voice</label>
              <select class="ec-select ytp-lumeo-select" data-ec-voice aria-label="AI Voice" title="Select dubbing voice"></select>
            </div>
            <div class="ytp-lumeo-row ytp-lumeo-stepper-row">
              <span class="ytp-lumeo-label">Subtitle Size</span>
              <div class="ytp-lumeo-stepper">
                <button type="button" class="ytp-lumeo-step-btn" data-lumeo-font-dec title="Decrease font size" aria-label="Decrease font size">A−</button>
                <span class="ytp-lumeo-step-val" data-lumeo-font-val>22px</span>
                <button type="button" class="ytp-lumeo-step-btn" data-lumeo-font-inc title="Increase font size" aria-label="Increase font size">A+</button>
              </div>
            </div>
            <div class="ytp-lumeo-row">
              <label class="ytp-lumeo-label">Display Mode</label>
              <select class="ec-select ytp-lumeo-select" data-ec-layout-preset aria-label="Subtitle layout mode">
                <option value="stacked">Bilingual (Original + Translated)</option>
                <option value="translated-only">Translation only</option>
                <option value="source-only">Original only</option>
              </select>
            </div>
            <div class="ytp-lumeo-row">
              <label class="ytp-lumeo-label">Subtitle Order</label>
              <select class="ec-select ytp-lumeo-select" data-lumeo-subtitle-order aria-label="Subtitle vertical order">
                <option value="translation-top">Translation on top</option>
                <option value="source-top">Original on top</option>
              </select>
            </div>
            <div class="ytp-lumeo-row">
              <button type="button" class="ytp-lumeo-btn-secondary" data-lumeo-reset-pos title="Reset subtitle position to default bottom-center">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 12px; height: 12px; margin-right: 5px;">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                  <path d="M3 3v5h5"/>
                </svg>
                Reset Subtitle Position
              </button>
            </div>
            <div class="ytp-lumeo-row">
              <button type="button" class="ec-btn-stop-session ytp-lumeo-btn-stop" data-ec-stop title="Stop active translation">
                ✕ Stop translation
              </button>
            </div>
            <div class="ytp-lumeo-footer">
              <button type="button" class="ytp-lumeo-link-options" data-ec-open-options title="Open detailed settings & API keys">
                Detailed Settings & API Keys ↗
              </button>
            </div>
          </div>
        </div>

        <!-- Preserved DOM nodes for backward-compatibility with tests & content.js -->
        <div class="ec-body" data-ec-body style="display: none !important;">
          <div class="ec-target" data-ec-target></div>
        </div>
        <div class="ec-toolbar" style="display: none !important;">
          <span class="ec-toolbar-cap" data-ec-tts-cap hidden></span>
          <button data-ec-settings hidden aria-label="Quick settings" type="button"></button>
          <button data-ec-pip hidden aria-label="PiP subtitles" type="button"></button>
          <button data-ec-transcript hidden aria-label="Transcript" type="button"></button>
          <button data-ec-help hidden aria-label="Keyboard shortcuts" type="button"></button>
        </div>
        <div class="ec-style-popover" data-ec-settings-panel hidden style="display: none !important;">
          <input type="range" data-ec-style-size min="12" max="36" step="1" value="22">
          <output data-ec-style-size-value>22px</output>
          <input type="range" data-ec-style-position min="0" max="80" step="1" value="28">
          <output data-ec-style-position-value>28%</output>
          <input type="range" data-ec-original-volume min="0" max="100" step="1" value="100">
          <output data-ec-original-volume-value>100%</output>
          <input type="range" data-ec-voice-volume min="0" max="100" step="1" value="100">
          <output data-ec-voice-volume-value>100%</output>
          <input type="checkbox" data-ec-mute-original>
          <input type="checkbox" data-ec-show-translated checked>
          <input type="checkbox" data-ec-show-source checked>
          <input type="checkbox" data-ec-high-contrast>
        </div>
      `;
      const moviePlayer = doc.querySelector("#movie_player, .html5-video-player");
      const targetContainer = doc.fullscreenElement || doc.webkitFullscreenElement || moviePlayer || doc.body || doc.documentElement;
      try {
        targetContainer.appendChild(root);
      } catch {
        (doc.body || doc.documentElement).appendChild(root);
      }
      elements = mapElements();
      populateLanguages();
      bindShortcuts();
      bindDragResize();
      applyLayout();
      bindYouTubeObserver();
      win.addEventListener("resize", applyLayout);
      doc.addEventListener("keydown", handleShortcutKeydown);
      doc.addEventListener("fullscreenchange", handleFullscreenChange);
      doc.addEventListener("webkitfullscreenchange", handleFullscreenChange);
      return root;
    }

    function handleFullscreenChange() {
      if (!root) return;
      const fsEl = doc.fullscreenElement || doc.webkitFullscreenElement;
      if (fsEl) {
        if (!fsEl.contains(root)) {
          try { fsEl.appendChild(root); } catch {}
        }
      } else {
        const defaultContainer = doc.body || doc.documentElement;
        if (root.parentElement !== defaultContainer) {
          try { defaultContainer.appendChild(root); } catch {}
        }
      }
      applyLayout();
    }

    function mapElements() {
      return {
        langSelect: root.querySelector("[data-ec-language]"),
        voiceSelect: root.querySelector("[data-ec-voice]"),
        ttsCap: root.querySelector("[data-ec-tts-cap]"),
        hideBtn: root.querySelector("[data-ec-hide]"),
        stopBtn: root.querySelector("[data-ec-stop]"),
        pipBtn: root.querySelector("[data-ec-pip]"),
        transcriptBtn: root.querySelector("[data-ec-transcript]"),
        helpBtn: root.querySelector("[data-ec-help]"),
        settingsBtn: root.querySelector("[data-ec-settings]"),
        settingsPanel: root.querySelector("[data-ec-settings-panel]"),
        openOptionsBtn: root.querySelector("[data-ec-open-options]"),
        drag: root.querySelector("[data-ec-drag]"),
        styleSize: root.querySelector("[data-ec-style-size]"),
        styleSizeValue: root.querySelector("[data-ec-style-size-value]"),
        stylePosition: root.querySelector("[data-ec-style-position]"),
        stylePositionValue: root.querySelector("[data-ec-style-position-value]"),
        layoutPreset: root.querySelector("[data-ec-layout-preset]"),
        highContrast: root.querySelector("[data-ec-high-contrast]"),
        originalVolume: root.querySelector("[data-ec-original-volume]"),
        originalVolumeValue: root.querySelector("[data-ec-original-volume-value]"),
        voiceVolume: root.querySelector("[data-ec-voice-volume]"),
        voiceVolumeValue: root.querySelector("[data-ec-voice-volume-value]"),
        muteOriginal: root.querySelector("[data-ec-mute-original]"),
        showTranslated: root.querySelector("[data-ec-show-translated]"),
        showSource: root.querySelector("[data-ec-show-source]"),
        target: root.querySelector("[data-ec-target]"),
        body: root.querySelector("[data-ec-body]"),
        status: root.querySelector(".ec-dot"),
        fontDec: root.querySelector("[data-lumeo-font-dec]"),
        fontInc: root.querySelector("[data-lumeo-font-inc]"),
        fontVal: root.querySelector("[data-lumeo-font-val]"),
        resetPos: root.querySelector("[data-lumeo-reset-pos]"),
        subtitleOrder: root.querySelector("[data-lumeo-subtitle-order]"),
        source: null,
        history: null,
      };
    }

    function populateLanguages() {
      if (!elements.langSelect) return;
      elements.langSelect.replaceChildren();
      for (const [code, name] of languages) {
        const opt = doc.createElement("option");
        opt.value = code;
        opt.textContent = name;
        elements.langSelect.appendChild(opt);
      }
    }

    function toggleSideCollapsed(forceState) {
      if (!root) {
        build();
        layout.sideCollapsed = typeof forceState === "boolean" ? forceState : false;
      } else {
        layout.sideCollapsed = typeof forceState === "boolean" ? forceState : !layout.sideCollapsed;
      }
      saveLayout();
      applyLayout();
    }

    function isOpen() {
      return Boolean(root && !layout.sideCollapsed && !root.hidden);
    }

    function applyCaptionStyle(captionStyle = {}) {
      if (!root) return;
      const fontSize = captionStyle.fontSize || 22;
      const bottomOffset = captionStyle.bottomOffset || 14;
      root.style.setProperty("--lumeo-caption-font-size", `${fontSize}px`);
      root.style.setProperty("--lumeo-caption-bottom-offset", `${bottomOffset}%`);
      root.classList.toggle("ec-hide-source-line", captionStyle.showSource === false || captionStyle.layoutPreset === "translated-only");
      root.classList.toggle("ec-hide-translated-line", captionStyle.layoutPreset === "source-only");
      root.classList.toggle("ec-caption-high-contrast", !!captionStyle.highContrast);
    }

    function syncCaptionControls(captionStyle = {}) {
      const fontSize = captionStyle.fontSize || 22;
      const bottomOffset = captionStyle.bottomOffset || 14;
      if (elements.styleSize) elements.styleSize.value = String(fontSize);
      if (elements.styleSizeValue) elements.styleSizeValue.value = `${fontSize}px`;
      if (elements.stylePosition) elements.stylePosition.value = String(bottomOffset);
      if (elements.stylePositionValue) elements.stylePositionValue.value = `${bottomOffset}%`;
      if (elements.highContrast) elements.highContrast.checked = !!captionStyle.highContrast;
      if (elements.layoutPreset) elements.layoutPreset.value = captionStyle.layoutPreset || "stacked";
      if (elements.originalVolume) elements.originalVolume.value = String(captionStyle.originalVolume ?? 18);
      if (elements.originalVolumeValue) elements.originalVolumeValue.value = String(captionStyle.originalVolume ?? 18);
      if (elements.voiceVolume) elements.voiceVolume.value = String(captionStyle.voiceVolume ?? 100);
      if (elements.voiceVolumeValue) elements.voiceVolumeValue.value = String(captionStyle.voiceVolume ?? 100);
      if (elements.muteOriginal) elements.muteOriginal.checked = !!captionStyle.muteOriginal;
      if (elements.showTranslated) elements.showTranslated.checked = captionStyle.showTranslatedSub !== false;
      if (elements.showSource) elements.showSource.checked = captionStyle.showSourceSub !== false;
    }

    function setState(state) {
      if (root) root.dataset.state = state;
    }

    function setStatusText(/* text */) {
      // Status text intentionally not shown on toolbar
    }

    function showToast(text, opts, durationMs) {
      if (!root) return;
      if (typeof opts === "number") { durationMs = opts; opts = null; }
      if (!durationMs) durationMs = 8000;
      let toast = root.querySelector(".ec-toast");
      if (toast) toast.remove();
      toast = doc.createElement("div");
      toast.className = "ec-toast";
      toast.textContent = String(text || "");
      if (opts && opts.cta) {
        toast.append(" ");
        const a = doc.createElement("a");
        const safeUrl = String(opts.cta).trim();
        if (safeUrl.startsWith("https://") || safeUrl.startsWith("http://")) {
          a.href = safeUrl;
        } else {
          a.href = "#";
        }
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = String(opts.ctaLabel || "Open");
        toast.appendChild(a);
      }
      root.appendChild(toast);
      win.setTimeout(() => toast.remove(), durationMs);
    }

    function bindShortcuts() {
      elements.helpBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        showShortcutHelp();
      });
      elements.settingsBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        if (elements.settingsPanel) elements.settingsPanel.hidden = !elements.settingsPanel.hidden;
      });
      elements.hideBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleSideCollapsed();
      });
      elements.stopBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
      });
      elements.pipBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
      });
      elements.transcriptBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
      });
      // Stepper buttons for font size
      elements.fontDec?.addEventListener("click", (e) => {
        e.stopPropagation();
        stepFontSize(-2);
      });
      elements.fontInc?.addEventListener("click", (e) => {
        e.stopPropagation();
        stepFontSize(2);
      });

      // Reset dragged subtitle position
      elements.resetPos?.addEventListener("click", (e) => {
        e.stopPropagation();
        try {
          storage.removeItem("lumeoSubPosition");
          win.localStorage?.removeItem("lumeoSubPosition");
        } catch {}
        try {
          if (typeof chrome !== "undefined" && chrome.storage?.local) {
            chrome.storage.local.remove("lumeoSubPosition");
          }
        } catch {}
        try {
          win.dispatchEvent(new win.CustomEvent("lumeo:reset-sub-position"));
        } catch {}
        showToast("Subtitle position reset to bottom-center", 3000);
      });

      // Subtitle order
      elements.subtitleOrder?.addEventListener("change", (e) => {
        e.stopPropagation();
        const nextOrder = elements.subtitleOrder.value;
        try {
          if (typeof chrome !== "undefined" && chrome.storage?.local) {
            chrome.storage.local.set({ subtitleOrder: nextOrder });
          }
        } catch {}
      });

      // Init settings from storage
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          chrome.storage.local.get(["fontSize", "subtitleOrder"], (items) => {
            if (items?.fontSize) {
              const sz = Number(items.fontSize);
              if (elements.fontVal) elements.fontVal.textContent = `${sz}px`;
              if (elements.styleSize) elements.styleSize.value = sz;
            }
            if (items?.subtitleOrder && elements.subtitleOrder) {
              elements.subtitleOrder.value = items.subtitleOrder;
            }
          });
        }
      } catch {}

      root.querySelectorAll("[data-ec-open-options]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          try { chrome.runtime?.sendMessage?.({ type: "OPEN_OPTIONS_PAGE" }); } catch {}
        });
      });

      root.querySelectorAll("button, select, input, label").forEach((el) => {
        el.addEventListener("pointerdown", (e) => e.stopPropagation());
      });

      root.addEventListener("click", (e) => {
        if (layout.sideCollapsed && !e.target.closest("[data-ec-stop]")) {
          toggleSideCollapsed();
          return;
        }
        if (elements.settingsPanel && !elements.settingsPanel.hidden && !e.target.closest("[data-ec-settings], [data-ec-settings-panel]")) {
          elements.settingsPanel.hidden = true;
        }
      });
    }

    function stepFontSize(delta) {
      const current = Number(elements.styleSize?.value || 22);
      const next = Math.min(36, Math.max(14, current + delta));
      if (elements.fontVal) elements.fontVal.textContent = `${next}px`;
      if (elements.styleSize) {
        elements.styleSize.value = next;
        elements.styleSize.dispatchEvent(new win.Event("input", { bubbles: true }));
      }
      if (elements.styleSizeValue) elements.styleSizeValue.textContent = `${next}px`;
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          chrome.storage.local.set({ fontSize: next });
        }
      } catch {}
    }

    function showShortcutHelp() {
      showToast("Shortcuts: Esc to minimize, ? or h for help, Ctrl/Cmd+Shift+L to toggle", 6000);
    }

    function handleShortcutKeydown(e) {
      if (!root || isEditableTarget(e.target)) return;
      const overlayFocused = root.contains(doc.activeElement) || root.contains(e.target);
      const key = String(e.key || "").toLowerCase();

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === "l") {
        root.hidden = !root.hidden;
        e.preventDefault();
        return;
      }

      if (!overlayFocused) return;

      if (e.key === "Escape") {
        if (!layout.sideCollapsed) toggleSideCollapsed();
        e.preventDefault();
        return;
      }

      if (key === "?" || key === "h") {
        showShortcutHelp();
        e.preventDefault();
      }
    }

    function isEditableTarget(target) {
      if (!target || target === doc || target === win) return false;
      const element = target.nodeType === 1 ? target : target.parentElement;
      if (!element) return false;
      return !!element.closest("input, textarea, select, [contenteditable]") || !!element.isContentEditable;
    }

    function destroy() {
      if (!root) return;
      if (ytPollTimer) {
        try { win.clearInterval(ytPollTimer); } catch {}
        ytPollTimer = null;
      }
      if (ytObserver) {
        try { ytObserver.disconnect(); } catch {}
        ytObserver = null;
      }
      if (ytButton) {
        try { ytButton.remove(); } catch {}
        ytButton = null;
      }
      win.removeEventListener("resize", applyLayout);
      doc.removeEventListener("keydown", handleShortcutKeydown);
      doc.removeEventListener("fullscreenchange", handleFullscreenChange);
      doc.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
      root.remove();
      root = null;
      elements = {};
    }

    function bindDragResize() {
      let dragMode = null;
      let pointer = null;

      elements.drag.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        if (e.target.closest("button, select, input, label, a, .ec-btn, .ec-select")) return;
        dragMode = "move";
        pointer = capturePointer(e);
        root.setPointerCapture?.(e.pointerId);
        e.preventDefault();
      });

      for (const handle of root.querySelectorAll("[data-ec-resize]")) {
        handle.addEventListener("pointerdown", (e) => {
          if (e.button !== 0) return;
          dragMode = "resize-" + handle.dataset.ecResize;
          pointer = capturePointer(e);
          handle.setPointerCapture?.(e.pointerId);
          e.preventDefault();
        });
      }

      const finishPointer = () => {
        if (dragMode) saveLayout();
        dragMode = null;
        pointer = null;
      };

      win.addEventListener("pointermove", (e) => {
        if (!dragMode || !pointer) return;
        const dx = e.clientX - pointer.x;
        const dy = e.clientY - pointer.y;
        if (dragMode === "move") {
          layout.left = pointer.left + dx;
          layout.top = pointer.top + dy;
          layout.openLeft = layout.left;
          layout.openTop = layout.top;
        } else {
          const mode = dragMode.slice(7);
          if (mode.includes("e")) layout.width = pointer.width + dx;
          if (mode.includes("s")) layout.height = pointer.height + dy;
          if (mode.includes("w")) {
            layout.width = pointer.width - dx;
            layout.left = pointer.left + dx;
          }
          if (mode.includes("n")) {
            layout.height = pointer.height - dy;
            layout.top = pointer.top + dy;
          }
        }
        applyLayout();
      });

      win.addEventListener("pointerup", finishPointer);
      win.addEventListener("pointercancel", finishPointer);
    }

    function capturePointer(e) {
      const rect = root.getBoundingClientRect();
      return {
        x: e.clientX,
        y: e.clientY,
        left: layout.left ?? rect.left,
        top: layout.top ?? rect.top,
        width: layout.width ?? rect.width,
        height: layout.height ?? rect.height,
      };
    }

    return {
      build,
      destroy,
      getRoot: () => root,
      getElements: () => elements,
      applyLayout,
      refreshLayoutKey,
      applyCaptionStyle,
      syncCaptionControls,
      setState,
      setStatusText,
      showToast,
      toggleSideCollapsed,
      isOpen,
      ensureYouTubeControlButton,
      getYouTubeControlButton: () => ytButton,
    };
  }

  window.LumeoOverlay = {
    __loaded: true,
    createOverlayController,
  };
})();
