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

    function clampLayout() {
      const maxW = Math.max(300, win.innerWidth - 24);
      const w = Math.min(Math.max(layout.width || 420, 320), maxW);
      const player = doc.querySelector("#movie_player, .html5-video-player");
      const rect = player?.getBoundingClientRect?.();
      const anchorRight = rect?.right || win.innerWidth;
      const anchorBottom = rect?.bottom || win.innerHeight;
      const collapsedLeft = Math.max(12, Math.min(anchorRight - 146, win.innerWidth - 64));
      const collapsedTop = Math.max(12, Math.min(anchorBottom - 64, win.innerHeight - 64));
      const openLeft = Math.max(12, Math.min(anchorRight - w - 16, win.innerWidth - w - 12));
      const openTop = Math.max(12, Math.min(anchorBottom - 58, win.innerHeight - 58));
      const left = layout.sideCollapsed ? collapsedLeft : Math.min(Math.max(layout.left ?? openLeft, 12), Math.max(12, win.innerWidth - w - 12));
      const top = layout.sideCollapsed ? collapsedTop : Math.min(Math.max(layout.top ?? openTop, 12), Math.max(12, win.innerHeight - 40));
      layout = { ...layout, left, top, width: w };
    }

    function applyLayout() {
      if (!root) return;
      clampLayout();
      root.style.left = layout.left + "px";
      root.style.top = layout.top + "px";
      root.style.width = layout.sideCollapsed ? "52px" : layout.width + "px";
      root.style.height = "auto";
      root.style.right = "auto";
      root.style.bottom = "auto";
      root.classList.toggle("is-side-collapsed", !!layout.sideCollapsed);
      root.classList.toggle("is-compact", layout.width < 560);
      if (elements.hideBtn) {
        elements.hideBtn.textContent = layout.sideCollapsed ? "Show" : "Hide";
      }
    }

    function build() {
      if (root) return root;
      root = doc.createElement("aside");
      root.className = "ec-root";
      root.dataset.state = "ready";
      root.setAttribute("aria-keyshortcuts", "Escape ? h Control+Shift+L Meta+Shift+L");
      root.innerHTML = `
        <div class="ec-toolbar" data-ec-drag>
          <span class="ec-dot"></span>
          <select class="ec-select" data-ec-language aria-label="Target language"></select>
          <span class="ec-toolbar-cap" data-ec-tts-cap hidden>Speech</span>
          <select class="ec-select" data-ec-voice aria-label="Voice"></select>
          <span class="ec-spacer"></span>
          <button class="ec-btn" type="button" data-ec-pip aria-label="Toggle Picture-in-Picture subtitles" title="Picture-in-Picture subtitles">PiP</button>
          <button class="ec-btn" type="button" data-ec-settings title="Settings">⚙️</button>
          <button class="ec-btn" type="button" data-ec-help aria-label="Keyboard shortcuts" aria-keyshortcuts="? h" title="Keyboard shortcuts (? or h)">?</button>
          <button class="ec-btn" type="button" data-ec-hide aria-keyshortcuts="Escape" title="Collapse overlay (Esc)">Hide</button>
          <button class="ec-btn ec-btn-primary" type="button" data-ec-stop>Stop</button>
        </div>
        <div class="ec-body" data-ec-body>
          <div class="ec-target" data-ec-target></div>
        </div>
        <div class="ec-style-popover" data-ec-settings-panel hidden>
          <label><span>Size</span> <input type="range" data-ec-style-size min="12" max="36" step="1"><output data-ec-style-size-value></output></label>
          <label><span>Pos</span> <input type="range" data-ec-style-position min="0" max="80" step="1"><output data-ec-style-position-value></output></label>
          <label class="ec-style-field-select"><span>Preset</span>
            <select class="ec-select" data-ec-layout-preset>
              <option value="stacked">Stacked (Sub+Source)</option>
              <option value="translated-only">Translated only</option>
              <option value="source-only">Source only</option>
            </select>
          </label>
          <label title="Original YouTube volume">
            <span>Orig Vol</span>
            <input type="range" data-ec-original-volume min="0" max="100" step="1"><output data-ec-original-volume-value></output>
          </label>
          <label title="Translated/dub voice volume">
            <span>Voice Vol</span>
            <input type="range" data-ec-voice-volume min="0" max="100" step="1"><output data-ec-voice-volume-value></output>
          </label>
          <label title="Mute the original YouTube audio">
            <span>Mute Orig.</span>
            <input type="checkbox" data-ec-mute-original>
          </label>
          <label title="Show Translated">
            <span>Show Trans.</span>
            <input type="checkbox" data-ec-show-translated>
          </label>
          <label title="Show Source">
            <span>Show Source</span>
            <input type="checkbox" data-ec-show-source>
          </label>
          <label title="High Contrast">
            <span>Contrast</span>
            <input type="checkbox" data-ec-high-contrast>
          </label>
        </div>
        <span class="ec-resize-edge ec-resize-edge-n" data-ec-resize="n"></span>
        <span class="ec-resize-edge ec-resize-edge-e" data-ec-resize="e"></span>
        <span class="ec-resize-edge ec-resize-edge-s" data-ec-resize="s"></span>
        <span class="ec-resize-edge ec-resize-edge-w" data-ec-resize="w"></span>
        <span class="ec-resize-corner ec-resize-corner-nw" data-ec-resize="nw"></span>
        <span class="ec-resize-corner ec-resize-corner-ne" data-ec-resize="ne"></span>
        <span class="ec-resize-corner ec-resize-corner-sw" data-ec-resize="sw"></span>
        <span class="ec-resize-corner ec-resize-corner-se" data-ec-resize="se"></span>
      `;
      try {
        doc.documentElement.appendChild(root);
      } catch {
        // YouTube SPA navigation can cause NotFoundError; retry on body
        (doc.body || doc.documentElement).appendChild(root);
      }
      elements = mapElements();
      populateLanguages();
      bindShortcuts();
      bindDragResize();
      applyLayout();
      win.addEventListener("resize", applyLayout);
      doc.addEventListener("keydown", handleShortcutKeydown);
      return root;
    }

    function mapElements() {
      return {
        langSelect: root.querySelector("[data-ec-language]"),
        voiceSelect: root.querySelector("[data-ec-voice]"),
        ttsCap: root.querySelector("[data-ec-tts-cap]"),
        hideBtn: root.querySelector("[data-ec-hide]"),
        stopBtn: root.querySelector("[data-ec-stop]"),
        pipBtn: root.querySelector("[data-ec-pip]"),
        helpBtn: root.querySelector("[data-ec-help]"),
        settingsBtn: root.querySelector("[data-ec-settings]"),
        settingsPanel: root.querySelector("[data-ec-settings-panel]"),
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

    function toggleSideCollapsed() {
      layout.sideCollapsed = !layout.sideCollapsed;
      saveLayout();
      applyLayout();
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
        a.href = String(opts.cta);
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = String(opts.ctaLabel || "Open");
        toast.appendChild(a);
      }
      root.appendChild(toast);
      win.setTimeout(() => toast.remove(), durationMs);
    }

    function bindShortcuts() {
      elements.helpBtn?.addEventListener("click", () => showShortcutHelp());
      elements.settingsBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        if (elements.settingsPanel) elements.settingsPanel.hidden = !elements.settingsPanel.hidden;
      });
      elements.settingsPanel?.addEventListener("click", (e) => e.stopPropagation());
      root.addEventListener("click", () => {
        if (elements.settingsPanel && !elements.settingsPanel.hidden) elements.settingsPanel.hidden = true;
      });
    }

    function showShortcutHelp() {
      showToast("Shortcuts: Esc collapse, ?/h help, Ctrl/Cmd+Shift+L show/hide", 6000);
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
      win.removeEventListener("resize", applyLayout);
      doc.removeEventListener("keydown", handleShortcutKeydown);
      root.remove();
      root = null;
      elements = {};
    }

    function bindDragResize() {
      let dragMode = null;
      let pointer = null;

      elements.drag.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        if (e.target.closest("button, select, input")) return;
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
    };
  }

  window.LumeoOverlay = {
    __loaded: true,
    createOverlayController,
  };
})();
