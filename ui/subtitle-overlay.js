(() => {
  "use strict";

  if (window.LumeoSubtitleOverlay?.__loaded) return;

  const WORD_RE = /[\p{L}\p{N}]+(?:[’'\-][\p{L}\p{N}]+)*/gu;

  function tokenizeLookupText(text = "") {
    const value = String(text || "");
    const tokens = [];
    let cursor = 0;
    for (const match of value.matchAll(WORD_RE)) {
      if (match.index > cursor) tokens.push({ text: value.slice(cursor, match.index), word: "" });
      tokens.push({ text: match[0], word: match[0] });
      cursor = match.index + match[0].length;
    }
    if (cursor < value.length) tokens.push({ text: value.slice(cursor), word: "" });
    return tokens;
  }

  function normalizeLookupWord(word = "") {
    return String(word || "")
      .normalize("NFKC")
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
      .toLocaleLowerCase();
  }

  function createSubtitleOverlayController(options = {}) {
    const doc = options.document || document;
    const win = options.window || window;
    const readComputedStyle = options.getComputedStyle || window.getComputedStyle.bind(window);
    const selectors = options.selectors || ["#movie_player", ".html5-video-player"];
    let overlay = null;
    let currentCue = null;
    let popover = null;
    let pipWindow = null;
    let pipRoot = null;
    let lastCaptionStyle = {};
    let lastCueOptions = {};

    function findPlayer() {
      for (const selector of selectors) {
        const player = doc.querySelector(selector);
        if (player) return player;
      }
      return null;
    }

    function build() {
      if (overlay) return overlay;
      const player = findPlayer();
      if (!player) return null;
      const playerPos = readComputedStyle(player).position;
      if (playerPos === "static") player.style.position = "relative";

      overlay = doc.createElement("div");
      overlay.className = "lumeo-video-sub";
      overlay.setAttribute("aria-live", "polite");
      overlay.addEventListener("click", handleLookupEvent);
      overlay.addEventListener("keydown", handleLookupEvent);
      try {
        player.appendChild(overlay);
      } catch {
        // YouTube SPA navigation may reconstruct the player mid-insertion;
        // fall back to documentElement so the overlay still renders.
        doc.documentElement.appendChild(overlay);
      }
      return overlay;
    }

    function remove() {
      closePictureInPicture();
      if (!overlay) return;
      overlay.remove();
      overlay = null;
    }

    function isPictureInPictureSupported() {
      return typeof win.documentPictureInPicture?.requestWindow === "function";
    }

    function applySubtitleStyle(target, captionStyle = {}) {
      if (!target) return;
      target.style.setProperty("--lumeo-caption-font-size", `${captionStyle.fontSize || 22}px`);
      target.style.setProperty("--lumeo-caption-bottom-offset", `${captionStyle.bottomOffset || 14}%`);
      const layoutPreset = captionStyle.layoutPreset || "stacked";
      target.classList.toggle("lumeo-hide-translated", !captionStyle.showTranslatedSub || layoutPreset === "source-only");
      target.classList.toggle("lumeo-hide-source", !captionStyle.showSourceSub || layoutPreset === "translated-only");
      target.classList.toggle("lumeo-layout-compact", layoutPreset === "compact");
      target.classList.toggle("lumeo-layout-source-only", layoutPreset === "source-only");
      target.classList.toggle("lumeo-layout-translated-only", layoutPreset === "translated-only");
      target.classList.toggle("lumeo-high-contrast", !!captionStyle.highContrast);
    }

    function applyStyle(captionStyle = {}) {
      lastCaptionStyle = { ...captionStyle };
      applySubtitleStyle(overlay, captionStyle);
      applySubtitleStyle(pipRoot, captionStyle);
    }

    function ensurePopover() {
      if (popover) return popover;
      popover = doc.createElement("div");
      popover.className = "lumeo-lookup-popover";
      popover.hidden = true;
      popover.setAttribute("role", "dialog");
      popover.setAttribute("aria-label", "Word lookup");
      overlay?.appendChild(popover);
      return popover;
    }

    function openLookup(word) {
      const normalized = normalizeLookupWord(word);
      if (!normalized || !overlay) return;
      const panel = ensurePopover();
      panel.replaceChildren();
      const title = doc.createElement("strong");
      title.textContent = word;
      const meta = doc.createElement("small");
      meta.textContent = `Normalized · ${normalized}`;
      const target = doc.createElement("p");
      target.textContent = `Target: ${currentCue?.translated || currentCue?.text || "—"}`;
      const source = doc.createElement("p");
      source.textContent = `Source: ${currentCue?.text || "—"}`;
      const copy = doc.createElement("button");
      copy.type = "button";
      copy.className = "lumeo-lookup-copy";
      copy.textContent = "Copy word";
      copy.addEventListener("click", async () => {
        try { await window.navigator?.clipboard?.writeText?.(word); } catch {}
      });
      panel.append(title, meta, target, source, copy);
      panel.hidden = false;
      copy.focus?.();
    }

    function appendLookupText(parent, text) {
      for (const token of tokenizeLookupText(text)) {
        if (!token.word) {
          parent.appendChild(doc.createTextNode(token.text));
          continue;
        }
        const button = doc.createElement("button");
        button.type = "button";
        button.className = "lumeo-lookup-word";
        button.dataset.lookupWord = token.word;
        button.setAttribute("aria-label", `Inspect word ${token.word}`);
        button.textContent = token.text;
        parent.appendChild(button);
      }
    }

    function handleLookupEvent(event) {
      const target = event.target?.closest?.(".lumeo-lookup-word");
      if (!target || !overlay?.contains(target)) return;
      if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openLookup(target.dataset.lookupWord || target.textContent || "");
    }

    function appendSubtitleLines(target, cue, captionStyle = {}, appendText = appendLookupText) {
      target.textContent = "";
      if (!cue) {
        target.hidden = true;
        return;
      }
      target.hidden = false;
      const layoutPreset = captionStyle.layoutPreset || "stacked";
      if (layoutPreset !== "source-only") {
        const translated = target.ownerDocument.createElement("div");
        translated.className = "lumeo-video-sub-translated";
        appendText(translated, cue.translated || cue.text || "");
        target.appendChild(translated);
      }

      if (captionStyle.showSource !== false && layoutPreset !== "translated-only" && cue.text && cue.text !== cue.translated) {
        const source = target.ownerDocument.createElement("div");
        source.className = "lumeo-video-sub-source";
        appendText(source, cue.text);
        target.appendChild(source);
      }
    }

    function syncPictureInPicture() {
      if (!pipRoot) return;
      appendSubtitleLines(pipRoot, currentCue, lastCaptionStyle, (parent, text) => { parent.textContent = text; });
      const rtlLangs = lastCueOptions.rtlLangs || new Set();
      pipRoot.dir = rtlLangs.has(lastCueOptions.targetLanguage) ? "rtl" : "ltr";
      applySubtitleStyle(pipRoot, lastCaptionStyle);
    }

    async function openPictureInPicture() {
      if (!isPictureInPictureSupported()) return { ok: false, reason: "unsupported" };
      if (pipWindow && !pipWindow.closed) return { ok: true, alreadyOpen: true };
      try {
        pipWindow = await win.documentPictureInPicture.requestWindow({ width: 520, height: 180 });
        const style = pipWindow.document.createElement("style");
        style.textContent = `
          :root { --lumeo-bg: #101113; --lumeo-ivory: #f2ede3; --lumeo-ivory-dim: #c9c3b6; --lumeo-line: #26292f; --lumeo-display: "Inter Tight", Inter, "SF Pro Display", -apple-system, system-ui, sans-serif; }
          .lumeo-pip-body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--lumeo-bg); color: var(--lumeo-ivory); font-family: var(--lumeo-display); }
          .lumeo-video-sub { max-width: calc(100vw - 32px); padding: 8px 18px; border-radius: 4px; background: rgba(0, 0, 0, 0.78); text-align: center; }
          .lumeo-video-sub.lumeo-high-contrast { border: 1px solid var(--lumeo-ivory-dim); background: var(--lumeo-bg); box-shadow: 0 0 0 2px var(--lumeo-line); }
          .lumeo-video-sub[hidden], .lumeo-hide-translated .lumeo-video-sub-translated, .lumeo-hide-source .lumeo-video-sub-source { display: none; }
          .lumeo-video-sub-translated { color: #fff; font-size: var(--lumeo-caption-font-size, 20px); font-weight: 600; line-height: 1.3; }
          .lumeo-video-sub-source { color: rgba(255, 255, 255, 0.6); font-size: calc(var(--lumeo-caption-font-size, 20px) * 0.7); line-height: 1.25; margin-top: 2px; }
          .lumeo-layout-compact { padding: 4px 12px; }
          .lumeo-layout-compact .lumeo-video-sub-translated { font-size: calc(var(--lumeo-caption-font-size, 20px) * 0.86); line-height: 1.18; }
          .lumeo-layout-compact .lumeo-video-sub-source { font-size: calc(var(--lumeo-caption-font-size, 20px) * 0.58); line-height: 1.12; margin-top: 1px; }
          .lumeo-layout-source-only .lumeo-video-sub-source { color: #fff; font-size: var(--lumeo-caption-font-size, 20px); font-weight: 600; line-height: 1.3; margin-top: 0; }
        `;
        pipWindow.document.head.appendChild(style);
        pipWindow.document.body.className = "lumeo-pip-body";
        pipRoot = pipWindow.document.createElement("div");
        pipRoot.className = "lumeo-video-sub lumeo-pip-sub";
        pipRoot.setAttribute("aria-live", "polite");
        pipWindow.document.body.appendChild(pipRoot);
        pipWindow.addEventListener("pagehide", () => {
          pipWindow = null;
          pipRoot = null;
        }, { once: true });
        syncPictureInPicture();
        return { ok: true };
      } catch (error) {
        pipWindow = null;
        pipRoot = null;
        return { ok: false, reason: error?.name || "failed" };
      }
    }

    function closePictureInPicture() {
      if (pipWindow && !pipWindow.closed) pipWindow.close();
      pipWindow = null;
      pipRoot = null;
    }

    async function togglePictureInPicture() {
      if (pipWindow && !pipWindow.closed) {
        closePictureInPicture();
        return { ok: true, open: false };
      }
      const result = await openPictureInPicture();
      return { ...result, open: !!result.ok };
    }

    function getPictureInPictureState() {
      return { supported: isPictureInPictureSupported(), open: !!(pipWindow && !pipWindow.closed) };
    }

    function updateCue(cue, optionsForCue = {}) {
      if (!overlay) build();
      if (!overlay) return;
      const captionStyle = optionsForCue.captionStyle || {};
      lastCueOptions = { ...optionsForCue };
      currentCue = cue || null;
      popover = null;
      applyStyle(captionStyle);
      appendSubtitleLines(overlay, cue, captionStyle);
      const rtlLangs = optionsForCue.rtlLangs || new Set();
      overlay.dir = rtlLangs.has(optionsForCue.targetLanguage) ? "rtl" : "ltr";
      syncPictureInPicture();
    }

    function getElement() {
      return overlay;
    }

    return {
      build,
      remove,
      applyStyle,
      updateCue,
      getElement,
      isPictureInPictureSupported,
      openPictureInPicture,
      closePictureInPicture,
      togglePictureInPicture,
      getPictureInPictureState,
    };
  }

  window.LumeoSubtitleOverlay = {
    __loaded: true,
    tokenizeLookupText,
    normalizeLookupWord,
    createSubtitleOverlayController,
  };
})();
