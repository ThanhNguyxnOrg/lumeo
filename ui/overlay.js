(() => {
  "use strict";

  if (window.LumeoOverlay?.__loaded) return;

  const DEFAULT_LAYOUT = Object.freeze({ left: null, top: null, width: 320, height: null, sideCollapsed: false });

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
        const hasPlayer = typeof doc !== "undefined" && Boolean(doc.querySelector("#movie_player, .html5-video-player"));
        if (hasPlayer) {
          delete parsed.left;
          delete parsed.top;
        }
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
    let isTranslating = false;

    // Subtitle visual state variables
    let currentFontSize = 22;
    let currentBgOpacity = 75;
    let currentShadowStyle = "drop-shadow";
    let currentSubtitleOrder = "translation-top";

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
            <circle class="ytp-lumeo-dot" cx="24.5" cy="11.5" r="2.2" />
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
      ytButton.classList.toggle("is-translating", isTranslating);
      ytButton.setAttribute("aria-pressed", String(isOpen));
      if (isTranslating) {
        ytButton.title = isOpen
          ? "Minimize Lumeo (Translating) - Esc"
          : "Lumeo (Translating) - Alt+L";
      } else {
        ytButton.title = isOpen
          ? "Minimize Lumeo - Esc"
          : "Lumeo — AI Captions & Dubbing (Alt+L)";
      }
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
      const w = Math.min(Math.max(layout.width || 320, 260), maxW);
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
      const moviePlayer = typeof doc !== "undefined" ? doc.querySelector("#movie_player, .html5-video-player") : null;
      const inPlayer = Boolean(moviePlayer && (root.parentElement === moviePlayer || moviePlayer.contains(root) || (doc.body && doc.body.contains(moviePlayer))));

      if (inPlayer) {
        root.style.position = "absolute";
        root.style.bottom = "56px";
        root.style.top = "auto";
        root.style.left = "auto";
        let rightPx = 12;
        if (ytButton && moviePlayer) {
          try {
            const playerRect = moviePlayer.getBoundingClientRect();
            const btnRect = ytButton.getBoundingClientRect();
            if (playerRect.width > 0 && btnRect.right > 0) {
              rightPx = Math.max(12, Math.round(playerRect.right - btnRect.right - 6));
            }
          } catch {}
        }
        root.style.right = rightPx + "px";
        root.style.width = layout.sideCollapsed ? "auto" : "320px";
        root.style.height = "auto";
      } else {
        clampLayout();
        if (layout.left !== null && layout.top !== null) {
          root.style.left = layout.left + "px";
          root.style.top = layout.top + "px";
          root.style.width = layout.sideCollapsed ? "auto" : (layout.width || 320) + "px";
          root.style.height = "auto";
          root.style.right = "auto";
          root.style.bottom = "auto";
          root.style.position = "fixed";
        } else {
          root.style.position = "fixed";
          root.style.right = "12px";
          root.style.bottom = "56px";
          root.style.left = "auto";
          root.style.top = "auto";
          root.style.width = layout.sideCollapsed ? "auto" : (layout.width || 320) + "px";
          root.style.height = "auto";
        }
      }
      root.classList.toggle("is-side-collapsed", !!layout.sideCollapsed);
      root.classList.toggle("is-compact", false);
      if (elements.hideBtn) {
        elements.hideBtn.title = layout.sideCollapsed ? "Open Lumeo (Esc)" : "Minimize Lumeo (Esc)";
      }
      updateYouTubeControlButton();
    }

    const SUBMENUS = {
      subtitles: {
        title: "Subtitles",
        getItems: () => [
          { id: "stacked", label: "Bilingual (Original + Translated)" },
          { id: "translated-only", label: "Translation only" },
          { id: "source-only", label: "Original only" },
        ],
        getValue: () => elements.layoutPreset?.value || "stacked",
        onSelect: (val) => {
          if (elements.layoutPreset) {
            elements.layoutPreset.value = val;
            elements.layoutPreset.dispatchEvent(new win.Event("change", { bubbles: true }));
          }
          try { chrome.storage?.local?.set({ layoutPreset: val }); } catch {}
          updateMenuLabels();
        },
      },
      language: {
        title: "Target Language",
        getItems: () => {
          if (languages && languages.length > 0) {
            return languages.map(([code, name]) => ({ id: code, label: name }));
          }
          return [
            { id: "vi", label: "Vietnamese (Tiếng Việt)" },
            { id: "en", label: "English" },
            { id: "ja", label: "Japanese (日本語)" },
            { id: "ko", label: "Korean (한국어)" },
            { id: "zh", label: "Chinese (中文)" },
            { id: "fr", label: "French (Français)" },
            { id: "es", label: "Spanish (Español)" },
            { id: "de", label: "German (Deutsch)" },
          ];
        },
        getValue: () => elements.langSelect?.value || "vi",
        onSelect: (val) => {
          if (elements.langSelect) {
            elements.langSelect.value = val;
            elements.langSelect.dispatchEvent(new win.Event("change", { bubbles: true }));
          }
          try { chrome.storage?.local?.set({ targetLanguage: val }); } catch {}
          updateMenuLabels();
        },
      },
      voice: {
        title: "AI Voice",
        getItems: () => {
          const opts = Array.from(elements.voiceSelect?.options || []);
          if (opts.length > 0) {
            return opts.map((o) => ({ id: o.value, label: o.textContent }));
          }
          return [
            { id: "auto", label: "Auto (Recommended)" },
            { id: "female-1", label: "Female (Natural)" },
            { id: "male-1", label: "Male (Deep)" },
            { id: "off", label: "Off / Mute" },
          ];
        },
        getValue: () => elements.voiceSelect?.value || "auto",
        onSelect: (val) => {
          if (elements.voiceSelect) {
            elements.voiceSelect.value = val;
            elements.voiceSelect.dispatchEvent(new win.Event("change", { bubbles: true }));
          }
          try { chrome.storage?.local?.set({ voice: val }); } catch {}
          updateMenuLabels();
        },
      },
      fontsize: {
        title: "Font size",
        getItems: () => [
          { id: "14", label: "50%" },
          { id: "18", label: "75%" },
          { id: "22", label: "100%" },
          { id: "28", label: "125%" },
          { id: "34", label: "150%" },
          { id: "42", label: "200%" },
        ],
        getValue: () => String(currentFontSize),
        onSelect: (val) => {
          currentFontSize = Number(val);
          if (elements.fontVal) elements.fontVal.textContent = `${val}px`;
          if (elements.styleSize) {
            elements.styleSize.value = val;
            elements.styleSize.dispatchEvent(new win.Event("input", { bubbles: true }));
          }
          try { chrome.storage?.local?.set({ fontSize: Number(val) }); } catch {}
          applyLiveCaptionStyle();
          updateMenuLabels();
        },
      },
      opacity: {
        title: "Background opacity",
        getItems: () => [
          { id: "0", label: "0%" },
          { id: "25", label: "25%" },
          { id: "50", label: "50%" },
          { id: "75", label: "75%" },
          { id: "100", label: "100%" },
        ],
        getValue: () => String(currentBgOpacity),
        onSelect: (val) => {
          currentBgOpacity = Number(val);
          try { chrome.storage?.local?.set({ subBackgroundOpacity: Number(val) }); } catch {}
          applyLiveCaptionStyle();
          updateMenuLabels();
        },
      },
      edge: {
        title: "Character edge style",
        getItems: () => [
          { id: "none", label: "None" },
          { id: "drop-shadow", label: "Drop shadow" },
          { id: "raised", label: "Raised" },
          { id: "depressed", label: "Depressed" },
          { id: "outline", label: "Uniform (Outline)" },
        ],
        getValue: () => currentShadowStyle,
        onSelect: (val) => {
          currentShadowStyle = val;
          try { chrome.storage?.local?.set({ subShadowStyle: val }); } catch {}
          applyLiveCaptionStyle();
          updateMenuLabels();
        },
      },
      order: {
        title: "Subtitle order",
        getItems: () => [
          { id: "translation-top", label: "Translation on top" },
          { id: "source-top", label: "Original on top" },
        ],
        getValue: () => elements.subtitleOrder?.value || currentSubtitleOrder,
        onSelect: (val) => {
          currentSubtitleOrder = val;
          if (elements.subtitleOrder) {
            elements.subtitleOrder.value = val;
            elements.subtitleOrder.dispatchEvent(new win.Event("change", { bubbles: true }));
          }
          try { chrome.storage?.local?.set({ subtitleOrder: val }); } catch {}
          updateMenuLabels();
        },
      },
    };

    function openSubmenu(subKey) {
      const sub = SUBMENUS[subKey];
      if (!sub || !elements.subContainer) return;

      const items = sub.getItems();
      const currentVal = sub.getValue();

      elements.subContainer.replaceChildren();
      for (const item of items) {
        const btn = doc.createElement("button");
        btn.type = "button";
        btn.className = "ytp-lumeo-sub-item" + (String(item.id) === String(currentVal) ? " is-selected" : "");
        btn.setAttribute("data-sub-id", item.id);
        btn.innerHTML = `
          <span class="ytp-lumeo-sub-check">✓</span>
          <span class="ytp-lumeo-sub-label">${item.label}</span>
        `;
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          sub.onSelect(item.id);
          closeSubmenu();
        });
        elements.subContainer.appendChild(btn);
      }

      if (elements.backTitle) elements.backTitle.textContent = sub.title;
      if (elements.backBtn) elements.backBtn.style.display = "inline-flex";
      if (elements.brand) elements.brand.style.display = "none";
      if (elements.rootView) elements.rootView.style.display = "none";
      elements.subContainer.style.display = "flex";
      elements.subContainer.scrollTop = 0;
    }

    function closeSubmenu() {
      if (elements.subContainer) elements.subContainer.style.display = "none";
      if (elements.rootView) elements.rootView.style.display = "block";
      if (elements.backBtn) elements.backBtn.style.display = "none";
      if (elements.brand) elements.brand.style.display = "flex";
    }

    function applyLiveCaptionStyle() {
      const player = typeof doc !== "undefined" ? doc.querySelector("#movie_player, .html5-video-player") : null;
      const sub = player ? player.querySelector(".lumeo-video-sub") : (typeof doc !== "undefined" ? doc.querySelector(".lumeo-video-sub") : null);
      if (sub) {
        sub.style.setProperty("--lumeo-caption-font-size", `${currentFontSize}px`);
        sub.style.setProperty("--lumeo-sub-bg-opacity", String(currentBgOpacity / 100));
        sub.classList.remove("lumeo-shadow-none", "lumeo-shadow-drop-shadow", "lumeo-shadow-raised", "lumeo-shadow-depressed", "lumeo-shadow-outline");
        sub.classList.add(`lumeo-shadow-${currentShadowStyle}`);
      }
    }

    function updateMenuLabels() {
      if (!root) return;
      const subVal = elements.layoutPreset?.value || "stacked";
      const subItem = SUBMENUS.subtitles.getItems().find((i) => i.id === subVal);
      const subLabelEl = root.querySelector('[data-val="subtitles"]');
      if (subLabelEl) subLabelEl.textContent = subItem ? subItem.label.split(" ")[0] : "Bilingual";

      const langVal = elements.langSelect?.value || "vi";
      const langItem = SUBMENUS.language.getItems().find((i) => i.id === langVal);
      const langLabelEl = root.querySelector('[data-val="language"]');
      if (langLabelEl) langLabelEl.textContent = langItem ? langItem.label.split(" (")[0] : langVal;

      const voiceVal = elements.voiceSelect?.value || "auto";
      const voiceItem = SUBMENUS.voice.getItems().find((i) => i.id === voiceVal);
      const voiceLabelEl = root.querySelector('[data-val="voice"]');
      if (voiceLabelEl) voiceLabelEl.textContent = voiceItem ? voiceItem.label.split(" (")[0] : voiceVal;

      const fontItem = SUBMENUS.fontsize.getItems().find((i) => String(i.id) === String(currentFontSize));
      const fontLabelEl = root.querySelector('[data-val="fontsize"]');
      if (fontLabelEl) fontLabelEl.textContent = fontItem ? fontItem.label : `${currentFontSize}px`;

      const opacItem = SUBMENUS.opacity.getItems().find((i) => String(i.id) === String(currentBgOpacity));
      const opacLabelEl = root.querySelector('[data-val="opacity"]');
      if (opacLabelEl) opacLabelEl.textContent = opacItem ? opacItem.label : `${currentBgOpacity}%`;

      const edgeItem = SUBMENUS.edge.getItems().find((i) => i.id === currentShadowStyle);
      const edgeLabelEl = root.querySelector('[data-val="edge"]');
      if (edgeLabelEl) edgeLabelEl.textContent = edgeItem ? edgeItem.label.split(" (")[0] : currentShadowStyle;

      const orderVal = elements.subtitleOrder?.value || currentSubtitleOrder;
      const orderItem = SUBMENUS.order.getItems().find((i) => i.id === orderVal);
      const orderLabelEl = root.querySelector('[data-val="order"]');
      if (orderLabelEl) orderLabelEl.textContent = orderItem ? orderItem.label : orderVal;
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
            <button class="ytp-lumeo-back-btn" type="button" data-lumeo-back aria-label="Back" title="Back" style="display: none;">
              <span class="ytp-lumeo-back-arrow">‹</span>
              <span data-lumeo-back-title>Back</span>
            </button>
            <div class="ytp-lumeo-brand" data-lumeo-brand>
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
            <!-- Root View -->
            <div class="ytp-lumeo-root-view" data-lumeo-root-view>
              <div class="ytp-lumeo-row ytp-lumeo-session-row">
                <button type="button" class="ytp-lumeo-toggle-session-btn is-start" data-lumeo-toggle-session title="Start real-time translation" aria-label="Start Translation">
                  <span class="ytp-lumeo-session-icon">▶</span>
                  <span class="ytp-lumeo-session-text">Start Translation</span>
                </button>
              </div>

              <div class="ytp-lumeo-menu-list">
                <!-- Subtitles / Display mode -->
                <button type="button" class="ytp-lumeo-menu-item" data-open-sub="subtitles">
                  <span class="ytp-lumeo-item-label">Subtitles</span>
                  <span class="ytp-lumeo-item-val" data-val="subtitles">Bilingual</span>
                  <span class="ytp-lumeo-item-arrow">›</span>
                </button>

                <!-- Target Language -->
                <button type="button" class="ytp-lumeo-menu-item" data-open-sub="language">
                  <span class="ytp-lumeo-item-label">Target Language</span>
                  <span class="ytp-lumeo-item-val" data-val="language">Vietnamese</span>
                  <span class="ytp-lumeo-item-arrow">›</span>
                </button>

                <!-- AI Voice -->
                <button type="button" class="ytp-lumeo-menu-item" data-open-sub="voice" data-ec-voice-row>
                  <span class="ytp-lumeo-item-label">AI Voice</span>
                  <span class="ytp-lumeo-item-val" data-val="voice">Auto</span>
                  <span class="ytp-lumeo-item-arrow">›</span>
                </button>

                <!-- Font size -->
                <button type="button" class="ytp-lumeo-menu-item" data-open-sub="fontsize">
                  <span class="ytp-lumeo-item-label">Font size</span>
                  <span class="ytp-lumeo-item-val" data-val="fontsize">100%</span>
                  <span class="ytp-lumeo-item-arrow">›</span>
                </button>

                <!-- Background opacity -->
                <button type="button" class="ytp-lumeo-menu-item" data-open-sub="opacity">
                  <span class="ytp-lumeo-item-label">Background opacity</span>
                  <span class="ytp-lumeo-item-val" data-val="opacity">75%</span>
                  <span class="ytp-lumeo-item-arrow">›</span>
                </button>

                <!-- Character edge style -->
                <button type="button" class="ytp-lumeo-menu-item" data-open-sub="edge">
                  <span class="ytp-lumeo-item-label">Character edge style</span>
                  <span class="ytp-lumeo-item-val" data-val="edge">Drop shadow</span>
                  <span class="ytp-lumeo-item-arrow">›</span>
                </button>

                <!-- Subtitle order -->
                <button type="button" class="ytp-lumeo-menu-item" data-open-sub="order">
                  <span class="ytp-lumeo-item-label">Subtitle order</span>
                  <span class="ytp-lumeo-item-val" data-val="order">Translation on top</span>
                  <span class="ytp-lumeo-item-arrow">›</span>
                </button>

                <!-- Reset Subtitle Position -->
                <button type="button" class="ytp-lumeo-menu-item ytp-lumeo-item-reset" data-lumeo-reset-pos title="Reset subtitle position to default bottom-center">
                  <span class="ytp-lumeo-item-label" style="display: inline-flex; align-items: center; gap: 6px;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 13px; height: 13px;">
                      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                      <path d="M3 3v5h5"/>
                    </svg>
                    Reset Subtitle Position
                  </span>
                </button>
              </div>
            </div>

            <!-- Submenu View -->
            <div class="ytp-lumeo-sub-container" data-lumeo-sub-container style="display: none;"></div>
          </div>
        </div>

        <!-- Preserved DOM nodes for backward-compatibility with tests & content.js -->
        <div style="display: none !important;">
          <button data-lumeo-font-dec type="button"></button>
          <button data-lumeo-font-inc type="button"></button>
          <span data-lumeo-font-val>22px</span>
          <select class="ec-select ytp-lumeo-select" data-ec-language aria-label="Target language"></select>
          <select class="ec-select ytp-lumeo-select" data-ec-voice aria-label="AI Voice"></select>
          <select class="ec-select ytp-lumeo-select" data-ec-layout-preset aria-label="Subtitle layout mode">
            <option value="stacked">Bilingual (Original + Translated)</option>
            <option value="translated-only">Translation only</option>
            <option value="source-only">Original only</option>
          </select>
          <select class="ec-select ytp-lumeo-select" data-lumeo-subtitle-order aria-label="Subtitle vertical order">
            <option value="translation-top">Translation on top</option>
            <option value="source-top">Original on top</option>
          </select>
          <button type="button" class="ec-btn-stop-session ytp-lumeo-btn-stop" data-ec-stop title="Stop active translation"></button>
          <button type="button" class="ytp-lumeo-link-options" data-ec-open-options></button>
          <div class="ec-body" data-ec-body><div class="ec-target" data-ec-target></div></div>
          <div class="ec-toolbar">
            <span class="ec-toolbar-cap" data-ec-tts-cap hidden></span>
            <button data-ec-settings hidden aria-label="Quick settings" type="button"></button>
            <button data-ec-pip hidden aria-label="PiP subtitles" type="button"></button>
            <button data-ec-transcript hidden aria-label="Transcript" type="button"></button>
            <button data-ec-help hidden aria-label="Keyboard shortcuts" type="button"></button>
          </div>
          <div class="ec-style-popover" data-ec-settings-panel hidden>
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
      updateMenuLabels();
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
        toggleSessionBtn: root.querySelector("[data-lumeo-toggle-session]"),
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
        backBtn: root.querySelector("[data-lumeo-back]"),
        backTitle: root.querySelector("[data-lumeo-back-title]"),
        brand: root.querySelector("[data-lumeo-brand]"),
        rootView: root.querySelector("[data-lumeo-root-view]"),
        subContainer: root.querySelector("[data-lumeo-sub-container]"),
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
      if (layout.sideCollapsed) {
        closeSubmenu();
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
      currentFontSize = fontSize;
      root.style.setProperty("--lumeo-caption-font-size", `${fontSize}px`);
      root.style.setProperty("--lumeo-caption-bottom-offset", `${bottomOffset}%`);
      root.classList.toggle("ec-hide-source-line", captionStyle.showSource === false || captionStyle.layoutPreset === "translated-only");
      root.classList.toggle("ec-hide-translated-line", captionStyle.layoutPreset === "source-only");
      root.classList.toggle("ec-caption-high-contrast", !!captionStyle.highContrast);
      updateMenuLabels();
      applyLiveCaptionStyle();
    }

    function syncCaptionControls(captionStyle = {}) {
      const fontSize = captionStyle.fontSize || 22;
      const bottomOffset = captionStyle.bottomOffset || 14;
      currentFontSize = fontSize;
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
      updateMenuLabels();
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
      elements.toggleSessionBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        if (isTranslating) {
          if (typeof options.onStopSession === "function") {
            options.onStopSession();
          } else if (elements.stopBtn) {
            elements.stopBtn.click();
          }
        } else {
          if (typeof options.onStartSession === "function") {
            options.onStartSession();
          }
        }
      });
      elements.stopBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        if (typeof options.onStopSession === "function") {
          options.onStopSession();
        }
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
        currentSubtitleOrder = nextOrder;
        try {
          if (typeof chrome !== "undefined" && chrome.storage?.local) {
            chrome.storage.local.set({ subtitleOrder: nextOrder });
          }
        } catch {}
        updateMenuLabels();
      });

      // Back button in submenu header
      elements.backBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        closeSubmenu();
      });

      // Menu items that open submenus
      root.querySelectorAll("[data-open-sub]").forEach((item) => {
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          const subKey = item.getAttribute("data-open-sub");
          if (subKey) openSubmenu(subKey);
        });
      });

      // Init settings from storage
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          chrome.storage.local.get(["fontSize", "subtitleOrder", "subBackgroundOpacity", "subShadowStyle", "targetLanguage", "layoutPreset"], (items) => {
            if (items?.fontSize) {
              currentFontSize = Number(items.fontSize);
              if (elements.fontVal) elements.fontVal.textContent = `${currentFontSize}px`;
              if (elements.styleSize) elements.styleSize.value = currentFontSize;
            }
            if (items?.subBackgroundOpacity != null) {
              currentBgOpacity = Number(items.subBackgroundOpacity);
            }
            if (items?.subShadowStyle) {
              currentShadowStyle = items.subShadowStyle;
            }
            if (items?.subtitleOrder) {
              currentSubtitleOrder = items.subtitleOrder;
              if (elements.subtitleOrder) elements.subtitleOrder.value = items.subtitleOrder;
            }
            if (items?.targetLanguage && elements.langSelect) {
              elements.langSelect.value = items.targetLanguage;
            }
            if (items?.layoutPreset && elements.layoutPreset) {
              elements.layoutPreset.value = items.layoutPreset;
            }
            updateMenuLabels();
            applyLiveCaptionStyle();
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

    function updateSessionControls() {
      if (!elements.toggleSessionBtn) return;
      if (isTranslating) {
        elements.toggleSessionBtn.classList.remove("is-start");
        elements.toggleSessionBtn.classList.add("is-stop");
        elements.toggleSessionBtn.title = "Stop active translation";
        elements.toggleSessionBtn.setAttribute("aria-label", "Stop Translation");
        elements.toggleSessionBtn.innerHTML = `
          <span class="ytp-lumeo-session-icon">⏹</span>
          <span class="ytp-lumeo-session-text">Stop Translation</span>
        `;
      } else {
        elements.toggleSessionBtn.classList.remove("is-stop");
        elements.toggleSessionBtn.classList.add("is-start");
        elements.toggleSessionBtn.title = "Start real-time translation";
        elements.toggleSessionBtn.setAttribute("aria-label", "Start Translation");
        elements.toggleSessionBtn.innerHTML = `
          <span class="ytp-lumeo-session-icon">▶</span>
          <span class="ytp-lumeo-session-text">Start Translation</span>
        `;
      }
    }

    function setSessionState(sessionState = {}) {
      if (typeof sessionState.isTranslating === "boolean") {
        isTranslating = sessionState.isTranslating;
      }
      updateSessionControls();
      updateYouTubeControlButton();
    }

    function stepFontSize(delta) {
      const current = Number(elements.styleSize?.value || currentFontSize || 22);
      const next = Math.min(36, Math.max(14, current + delta));
      currentFontSize = next;
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
      applyLiveCaptionStyle();
      updateMenuLabels();
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

      if (e.key === "Escape") {
        const isBodyOrNull = !doc.activeElement || doc.activeElement === doc.body || doc.activeElement === doc.documentElement;
        if (isOpen() && (overlayFocused || isBodyOrNull)) {
          toggleSideCollapsed(true);
          e.preventDefault();
          return;
        }
      }

      if (!overlayFocused) return;

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
      // Popover dragging is intentionally disabled per ADR 0004.
      // Settings popovers must remain strictly anchored to YouTube's player controls.
      // Subtitle drag on the video player is handled exclusively by LumeoSubtitleOverlay.
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
      setSessionState,
      isTranslating: () => isTranslating,
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
