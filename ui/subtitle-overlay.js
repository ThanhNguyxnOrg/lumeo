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

    let isDragging = false;
    let hasDragged = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let initialOverlayRect = null;
    let initialPlayerRect = null;
    let detachDragListeners = null;
    let lastPosition = null;

    function applySavedPosition() {
      if (!overlay) return;
      try {
        const raw = win.localStorage?.getItem("lumeoSubPosition");
        if (raw) {
          const pos = JSON.parse(raw);
          if (typeof pos.leftPercent === "number" && typeof pos.topPercent === "number") {
            overlay.style.left = pos.leftPercent + "%";
            overlay.style.top = pos.topPercent + "%";
            overlay.style.bottom = "auto";
            overlay.style.transform = "none";
          }
        }
      } catch {}
    }

    function resetPosition() {
      try {
        win.localStorage?.removeItem("lumeoSubPosition");
      } catch {}
      lastPosition = null;
      if (overlay) {
        overlay.style.left = "50%";
        overlay.style.top = "auto";
        overlay.style.bottom = "var(--lumeo-caption-bottom-offset, 14%)";
        overlay.style.transform = "translateX(-50%)";
      }
    }

    try {
      win.addEventListener("lumeo:reset-sub-position", resetPosition);
    } catch {}

    function initDragging() {
      if (!overlay || detachDragListeners) return;

      const onPointerDown = (e) => {
        if (e.button !== 0) return;
        const player = findPlayer();
        if (!player) return;

        isDragging = true;
        hasDragged = false;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        initialOverlayRect = overlay.getBoundingClientRect?.() || { left: 0, top: 0, width: 200, height: 50 };
        initialPlayerRect = player.getBoundingClientRect?.() || { left: 0, top: 0, width: 1000, height: 600 };

        try { overlay.setPointerCapture?.(e.pointerId); } catch {}
      };

      const onPointerMove = (e) => {
        if (!isDragging) return;
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;

        if (!hasDragged && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
          hasDragged = true;
          overlay.classList.add("is-dragging");
        }

        if (hasDragged && initialPlayerRect && initialOverlayRect) {
          const playerW = Math.max(1, initialPlayerRect.width);
          const playerH = Math.max(1, initialPlayerRect.height);
          const overlayW = initialOverlayRect.width;
          const overlayH = initialOverlayRect.height;

          const rawLeft = initialOverlayRect.left - initialPlayerRect.left + dx;
          const rawTop = initialOverlayRect.top - initialPlayerRect.top + dy;

          const clampedLeft = Math.max(0, Math.min(rawLeft, playerW - overlayW));
          const clampedTop = Math.max(0, Math.min(rawTop, playerH - overlayH));

          const leftPercent = (clampedLeft / playerW) * 100;
          const topPercent = (clampedTop / playerH) * 100;

          lastPosition = { leftPercent, topPercent };
          overlay.style.left = leftPercent + "%";
          overlay.style.top = topPercent + "%";
          overlay.style.bottom = "auto";
          overlay.style.transform = "none";
        }
      };

      const onPointerUp = () => {
        if (!isDragging) return;
        isDragging = false;
        overlay.classList.remove("is-dragging");

        if (hasDragged && lastPosition) {
          try {
            win.localStorage?.setItem("lumeoSubPosition", JSON.stringify(lastPosition));
          } catch {}
          win.setTimeout?.(() => { hasDragged = false; }, 50);
        } else {
          hasDragged = false;
        }
      };

      overlay.addEventListener("pointerdown", onPointerDown);
      win.addEventListener("pointermove", onPointerMove);
      win.addEventListener("pointerup", onPointerUp);
      win.addEventListener("pointercancel", onPointerUp);

      detachDragListeners = () => {
        overlay.removeEventListener("pointerdown", onPointerDown);
        win.removeEventListener("pointermove", onPointerMove);
        win.removeEventListener("pointerup", onPointerUp);
        win.removeEventListener("pointercancel", onPointerUp);
        detachDragListeners = null;
      };
    }

    function build() {
      if (overlay) return overlay;
      const player = findPlayer();
      if (!player) return null;
      const playerPos = readComputedStyle(player).position;
      if (playerPos === "static") player.style.position = "relative";

      player.classList.add("lumeo-active-player");
      player.setAttribute("data-lumeo-active", "true");

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
      applySavedPosition();
      initDragging();

      // Load persistent caption style from storage
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          chrome.storage.local.get([
            "fontSize",
            "bottomOffset",
            "highContrast",
            "layoutPreset",
            "subBackgroundOpacity",
            "subShadowStyle",
            "subtitleOrder",
            "showSourceSub",
            "showTranslatedSub",
          ], (res) => {
            if (res) applyStyle(res);
          });
        }
      } catch {}

      return overlay;
    }

    // Live sync listeners from Options page
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === "local") {
            const updated = {};
            if (changes.fontSize) updated.fontSize = changes.fontSize.newValue;
            if (changes.bottomOffset) updated.bottomOffset = changes.bottomOffset.newValue;
            if (changes.highContrast) updated.highContrast = changes.highContrast.newValue;
            if (changes.layoutPreset) updated.layoutPreset = changes.layoutPreset.newValue;
            if (changes.subBackgroundOpacity) updated.subBackgroundOpacity = changes.subBackgroundOpacity.newValue;
            if (changes.subShadowStyle) updated.subShadowStyle = changes.subShadowStyle.newValue;
            if (changes.subtitleOrder) updated.subtitleOrder = changes.subtitleOrder.newValue;
            if (changes.showSourceSub) updated.showSourceSub = changes.showSourceSub.newValue;
            if (changes.showTranslatedSub) updated.showTranslatedSub = changes.showTranslatedSub.newValue;
            if (Object.keys(updated).length > 0) {
              applyStyle(updated);
              if (currentCue && overlay) appendSubtitleLines(overlay, currentCue, lastCaptionStyle);
            }
          }
        });
      }
    } catch {}

    try {
      if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.addListener((msg) => {
          if (msg?.type === "LUMEO_STYLE_UPDATED" && msg.settings) {
            applyStyle(msg.settings);
            if (currentCue && overlay) appendSubtitleLines(overlay, currentCue, lastCaptionStyle);
          }
        });
      }
    } catch {}

    function remove() {
      closePictureInPicture();
      if (detachDragListeners) detachDragListeners();
      const player = findPlayer();
      if (player) {
        player.classList.remove("lumeo-active-player");
        player.setAttribute("data-lumeo-active", "false");
      }
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
      if (captionStyle.subBackgroundOpacity != null) {
        const raw = Number(captionStyle.subBackgroundOpacity);
        const normalized = Number.isFinite(raw) ? (raw > 1 ? raw / 100 : raw) : 0.75;
        const clamped = Math.max(0, Math.min(1, normalized));
        target.style.setProperty("--lumeo-sub-bg-opacity", String(clamped));
        target.classList.toggle("lumeo-sub-transparent", clamped === 0);
      }
      const layoutPreset = captionStyle.layoutPreset || "stacked";
      target.classList.toggle("lumeo-hide-translated", captionStyle.showTranslatedSub === false || layoutPreset === "source-only");
      target.classList.toggle("lumeo-hide-source", captionStyle.showSourceSub === false || layoutPreset === "translated-only");
      target.classList.toggle("lumeo-layout-compact", layoutPreset === "compact");
      target.classList.toggle("lumeo-layout-source-only", layoutPreset === "source-only");
      target.classList.toggle("lumeo-layout-translated-only", layoutPreset === "translated-only");
      target.classList.toggle("lumeo-high-contrast", !!captionStyle.highContrast);

      let shadowStyle = captionStyle.subShadowStyle || "drop-shadow";
      if (shadowStyle === "glow") shadowStyle = "drop-shadow";
      if (shadowStyle === "box") shadowStyle = "outline";

      target.classList.toggle("lumeo-shadow-none", shadowStyle === "none");
      target.classList.toggle("lumeo-shadow-drop-shadow", shadowStyle === "drop-shadow");
      target.classList.toggle("lumeo-shadow-raised", shadowStyle === "raised");
      target.classList.toggle("lumeo-shadow-depressed", shadowStyle === "depressed");
      target.classList.toggle("lumeo-shadow-outline", shadowStyle === "outline");
    }

    function applyStyle(captionStyle = {}) {
      lastCaptionStyle = { ...lastCaptionStyle, ...captionStyle };
      applySubtitleStyle(overlay, lastCaptionStyle);
      applySubtitleStyle(pipRoot, lastCaptionStyle);
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

    async function fetchDefinition(normWord) {
      try {
        const resp = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(normWord)}`);
        if (!resp.ok) return null;
        const list = await resp.json();
        if (!Array.isArray(list) || !list[0]) return null;
        const entry = list[0];
        const phonetic = entry.phonetic || entry.phonetics?.find((p) => p.text)?.text || "";
        const audio = entry.phonetics?.find((p) => p.audio && p.audio.startsWith("http"))?.audio || "";
        const meaning = entry.meanings?.[0];
        const partOfSpeech = meaning?.partOfSpeech || "";
        const definition = meaning?.definitions?.[0]?.definition || "";
        return { phonetic, audio, partOfSpeech, definition };
      } catch {
        return null;
      }
    }

    function openLookup(word) {
      const normalized = normalizeLookupWord(word);
      if (!normalized || !overlay) return;
      const panel = ensurePopover();
      panel.replaceChildren();

      const header = doc.createElement("div");
      header.className = "lumeo-lookup-header";
      const titleGroup = doc.createElement("div");
      titleGroup.className = "lumeo-lookup-title-group";
      const title = doc.createElement("strong");
      title.textContent = word;
      const meta = doc.createElement("small");
      meta.textContent = `Normalized · ${normalized}`;
      titleGroup.append(title, meta);

      const closeBtn = doc.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "lumeo-lookup-close";
      closeBtn.setAttribute("aria-label", "Close");
      closeBtn.textContent = "✕";

      const closePanel = () => {
        panel.hidden = true;
        doc.removeEventListener("keydown", onDocKey);
        doc.removeEventListener("click", onDocClick, true);
      };
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        closePanel();
      });

      const onDocKey = (e) => {
        if (e.key === "Escape") {
          closePanel();
        }
      };
      const onDocClick = (e) => {
        if (panel && !panel.contains(e.target) && !e.target.closest?.(".lumeo-lookup-word")) {
          closePanel();
        }
      };

      doc.addEventListener("keydown", onDocKey);
      setTimeout(() => {
        doc.addEventListener("click", onDocClick, true);
      }, 50);

      header.append(titleGroup, closeBtn);
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

      const aiBtn = doc.createElement("button");
      aiBtn.type = "button";
      aiBtn.className = "lumeo-lookup-ai-btn";
      aiBtn.textContent = "✨ AI Context";

      const cambridge = doc.createElement("a");
      cambridge.className = "lumeo-lookup-link";
      cambridge.href = `https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(normalized)}`;
      cambridge.target = "_blank";
      cambridge.rel = "noopener noreferrer";
      cambridge.textContent = "Cambridge ↗";

      const oxford = doc.createElement("a");
      oxford.className = "lumeo-lookup-link";
      oxford.href = `https://www.oxfordlearnersdictionaries.com/definition/english/${encodeURIComponent(normalized)}`;
      oxford.target = "_blank";
      oxford.rel = "noopener noreferrer";
      oxford.textContent = "Oxford ↗";

      const actions = doc.createElement("div");
      actions.className = "lumeo-lookup-actions";
      actions.append(copy, aiBtn, cambridge, oxford);

      const aiContainer = doc.createElement("div");
      aiContainer.className = "lumeo-lookup-ai-box";
      aiContainer.hidden = true;

      aiBtn.addEventListener("click", async () => {
        aiBtn.disabled = true;
        aiContainer.hidden = false;
        aiContainer.replaceChildren();

        const loading = doc.createElement("div");
        loading.className = "lumeo-lookup-ai-loading";
        loading.textContent = "Analyzing with AI...";
        aiContainer.appendChild(loading);

        try {
          const rawSentence = currentCue?.text || currentCue?.translated || normalized;
          const targetLang = lastCueOptions.targetLanguage || "en";

          let response;
          if (options.browserApi?.sendRuntimeMessage) {
            response = await options.browserApi.sendRuntimeMessage({
              type: "EXPLAIN_WORD_CONTEXT",
              word: normalized,
              sentence: rawSentence,
              targetLanguage: targetLang,
            });
          } else if (globalThis.LumeoBrowserApi?.sendRuntimeMessage) {
            response = await globalThis.LumeoBrowserApi.sendRuntimeMessage({
              type: "EXPLAIN_WORD_CONTEXT",
              word: normalized,
              sentence: rawSentence,
              targetLanguage: targetLang,
            });
          } else if (typeof chrome !== "undefined" && chrome?.runtime?.sendMessage) {
            response = await new Promise((res) => {
              chrome.runtime.sendMessage({
                type: "EXPLAIN_WORD_CONTEXT",
                word: normalized,
                sentence: rawSentence,
                targetLanguage: targetLang,
              }, res);
            });
          } else {
            response = { ok: false, error: "Runtime unavailable" };
          }

          aiContainer.replaceChildren();

          if (response?.ok && response?.data) {
            const data = response.data;
            const header = doc.createElement("div");
            header.className = "lumeo-lookup-ai-header";
            const hStrong = doc.createElement("strong");
            hStrong.textContent = "✨ Contextual Meaning";
            const hProv = doc.createElement("span");
            hProv.className = "lumeo-lookup-ai-provider";
            hProv.textContent = data.provider || "AI";
            header.append(hStrong, hProv);

            const meaning = doc.createElement("p");
            meaning.className = "lumeo-lookup-ai-meaning";
            meaning.textContent = data.meaning || "No meaning provided.";

            aiContainer.append(header, meaning);

            if (data.nuance) {
              const nuance = doc.createElement("p");
              nuance.className = "lumeo-lookup-ai-nuance";
              const nuanceLabel = doc.createElement("strong");
              nuanceLabel.textContent = "Nuance: ";
              nuance.append(nuanceLabel, doc.createTextNode(data.nuance));
              aiContainer.appendChild(nuance);
            }

            if (data.synonyms) {
              const synonyms = doc.createElement("p");
              synonyms.className = "lumeo-lookup-ai-synonyms";
              const synLabel = doc.createElement("strong");
              synLabel.textContent = "Synonyms: ";
              synonyms.append(synLabel, doc.createTextNode(data.synonyms));
              aiContainer.appendChild(synonyms);
            }
          } else {
            const errEl = doc.createElement("div");
            errEl.className = "lumeo-lookup-ai-error";
            errEl.textContent = response?.error || "Failed to analyze context.";
            aiContainer.appendChild(errEl);
          }
        } catch (err) {
          aiContainer.replaceChildren();
          const errEl = doc.createElement("div");
          errEl.className = "lumeo-lookup-ai-error";
          errEl.textContent = err?.message || "Failed to analyze context.";
          aiContainer.appendChild(errEl);
        } finally {
          aiBtn.disabled = false;
        }
      });

      const defContainer = doc.createElement("div");
      defContainer.className = "lumeo-lookup-def";
      defContainer.hidden = true;

      panel.append(header, target, source, actions, aiContainer, defContainer);
      panel.hidden = false;
      copy.focus?.();

      void fetchDefinition(normalized).then((def) => {
        if (!def || !def.definition) return;
        defContainer.hidden = false;
        defContainer.replaceChildren();
        if (def.phonetic) {
          const ph = doc.createElement("span");
          ph.className = "lumeo-lookup-phonetic";
          ph.textContent = `${def.phonetic} `;
          defContainer.appendChild(ph);
        }
        if (def.audio) {
          const sound = doc.createElement("button");
          sound.type = "button";
          sound.className = "lumeo-lookup-copy";
          sound.style.display = "inline-flex";
          sound.style.marginRight = "6px";
          sound.textContent = "🔈 Audio";
          sound.addEventListener("click", () => {
            try { new win.Audio(def.audio).play().catch(() => {}); } catch {}
          });
          defContainer.appendChild(sound);
        }
        if (def.partOfSpeech) {
          const pos = doc.createElement("span");
          pos.className = "lumeo-lookup-pos";
          pos.textContent = `[${def.partOfSpeech}] `;
          defContainer.appendChild(pos);
        }
        const desc = doc.createElement("span");
        desc.textContent = def.definition;
        defContainer.appendChild(desc);
      });
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
      if (hasDragged) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
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
      const isSourceTop = captionStyle.subtitleOrder === "source-top";

      const showTranslated = layoutPreset !== "source-only";
      const showSource = captionStyle.showSource !== false && layoutPreset !== "translated-only" && cue.text && cue.text !== cue.translated;

      function createTranslatedEl() {
        const translated = target.ownerDocument.createElement("div");
        translated.className = "lumeo-video-sub-translated";
        appendText(translated, cue.translated || cue.text || "");
        return translated;
      }

      function createSourceEl() {
        const source = target.ownerDocument.createElement("div");
        source.className = "lumeo-video-sub-source";
        appendText(source, cue.text);
        return source;
      }

      if (isSourceTop) {
        if (showSource) target.appendChild(createSourceEl());
        if (showTranslated) target.appendChild(createTranslatedEl());
      } else {
        if (showTranslated) target.appendChild(createTranslatedEl());
        if (showSource) target.appendChild(createSourceEl());
      }
    }

    function syncPictureInPicture() {
      if (!pipRoot) return;
      appendSubtitleLines(pipRoot, currentCue, lastCaptionStyle, (parent, text) => { parent.textContent = text; });
      const rtlLangs = lastCueOptions.rtlLangs || new Set();
      pipRoot.dir = rtlLangs.has(lastCueOptions.targetLanguage) ? "rtl" : "ltr";
      applySubtitleStyle(pipRoot, lastCaptionStyle);
    }

    let origVideoParent = null;
    let origVideoNext = null;
    let pipVideoEl = null;

    async function openPictureInPicture() {
      if (!isPictureInPictureSupported()) return { ok: false, reason: "unsupported" };
      if (pipWindow && !pipWindow.closed) return { ok: true, alreadyOpen: true };
      try {
        const video = doc.querySelector("video.html5-main-video") || doc.querySelector("video");
        const vWidth = video?.videoWidth || 1280;
        const vHeight = video?.videoHeight || 720;
        let pipW = 540;
        let pipH = Math.round((pipW * vHeight) / vWidth) || 304;
        if (pipH > 480) {
          pipH = 480;
          pipW = Math.round((pipH * vWidth) / vHeight) || 270;
        }

        pipWindow = await win.documentPictureInPicture.requestWindow({ width: pipW, height: pipH });
        const style = pipWindow.document.createElement("style");
        style.textContent = `
          :root { --lumeo-bg: #101113; --lumeo-ivory: #f2ede3; --lumeo-ivory-dim: #c9c3b6; --lumeo-line: #26292f; --lumeo-display: "Inter Tight", Inter, "SF Pro Display", -apple-system, system-ui, sans-serif; }
          .lumeo-pip-body { margin: 0; padding: 0; width: 100vw; height: 100vh; background: #000; overflow: hidden; position: relative; display: flex; align-items: center; justify-content: center; font-family: var(--lumeo-display); }
          .lumeo-pip-video { width: 100%; height: 100%; object-fit: contain; display: block; }
          .lumeo-pip-sub-layer { position: absolute; left: 0; right: 0; bottom: 8%; display: flex; justify-content: center; pointer-events: none; z-index: 10; padding: 0 16px; }
          .lumeo-video-sub { max-width: calc(100vw - 32px); padding: 8px 18px; border-radius: 4px; background: rgba(0, 0, 0, 0.78); backdrop-filter: blur(8px); text-align: center; pointer-events: auto; }
          .lumeo-video-sub.lumeo-high-contrast { border: 1px solid var(--lumeo-ivory-dim); background: var(--lumeo-bg); box-shadow: 0 0 0 2px var(--lumeo-line); }
          .lumeo-video-sub[hidden], .lumeo-hide-translated .lumeo-video-sub-translated, .lumeo-hide-source .lumeo-video-sub-source { display: none; }
          .lumeo-video-sub-translated { color: #fff; font-size: var(--lumeo-caption-font-size, 20px); font-weight: 600; line-height: 1.3; text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.7); }
          .lumeo-video-sub-source { color: rgba(255, 255, 255, 0.75); font-size: calc(var(--lumeo-caption-font-size, 20px) * 0.7); line-height: 1.25; margin-top: 2px; text-shadow: 0 1px 2px rgba(0,0,0,0.9); }
          .lumeo-layout-compact { padding: 4px 12px; }
          .lumeo-layout-compact .lumeo-video-sub-translated { font-size: calc(var(--lumeo-caption-font-size, 20px) * 0.86); line-height: 1.18; }
          .lumeo-layout-compact .lumeo-video-sub-source { font-size: calc(var(--lumeo-caption-font-size, 20px) * 0.58); line-height: 1.12; margin-top: 1px; }
          .lumeo-layout-source-only .lumeo-video-sub-source { color: #fff; font-size: var(--lumeo-caption-font-size, 20px); font-weight: 600; line-height: 1.3; margin-top: 0; }
        `;
        pipWindow.document.head.appendChild(style);
        pipWindow.document.body.className = "lumeo-pip-body";

        let streamOk = false;
        if (video) {
          try {
            const stream = video.captureStream?.();
            if (stream && stream.getVideoTracks?.()?.length > 0) {
              pipVideoEl = pipWindow.document.createElement("video");
              pipVideoEl.className = "lumeo-pip-video";
              pipVideoEl.autoplay = true;
              pipVideoEl.muted = true;
              pipVideoEl.playsInline = true;
              pipVideoEl.srcObject = stream;
              pipWindow.document.body.appendChild(pipVideoEl);
              streamOk = true;
            }
          } catch (e) {
            // captureStream may fail on cross-origin or mocked envs
          }

          if (!streamOk && video.parentNode && video.parentNode !== pipWindow.document.body) {
            origVideoParent = video.parentNode;
            origVideoNext = video.nextSibling;
            video.classList.add("lumeo-pip-video");
            pipWindow.document.body.appendChild(video);
          }
        }

        const subLayer = pipWindow.document.createElement("div");
        subLayer.className = "lumeo-pip-sub-layer";
        pipRoot = pipWindow.document.createElement("div");
        pipRoot.className = "lumeo-video-sub lumeo-pip-sub";
        pipRoot.setAttribute("aria-live", "polite");
        subLayer.appendChild(pipRoot);
        pipWindow.document.body.appendChild(subLayer);

        pipWindow.addEventListener("pagehide", () => {
          if (origVideoParent && video) {
            try { origVideoParent.insertBefore(video, origVideoNext); } catch (e) {}
            video.classList.remove("lumeo-pip-video");
          }
          if (pipVideoEl) {
            try { pipVideoEl.srcObject = null; } catch (e) {}
            pipVideoEl = null;
          }
          origVideoParent = null;
          origVideoNext = null;
          pipWindow = null;
          pipRoot = null;
          try { doc.dispatchEvent(new win.CustomEvent("lumeopipclosed")); } catch (e) {}
        }, { once: true });

        syncPictureInPicture();
        try { doc.dispatchEvent(new win.CustomEvent("lumeopipopened")); } catch (e) {}
        return { ok: true };
      } catch (error) {
        pipWindow = null;
        pipRoot = null;
        return { ok: false, reason: error?.name || "failed" };
      }
    }

    function closePictureInPicture() {
      if (pipWindow && !pipWindow.closed) {
        try { pipWindow.close(); } catch (e) {}
        try { doc.dispatchEvent(new win.CustomEvent("lumeopipclosed")); } catch (e) {}
      }
      const video = doc.querySelector("video.html5-main-video") || doc.querySelector("video");
      if (origVideoParent && video) {
        try { origVideoParent.insertBefore(video, origVideoNext); } catch (e) {}
        video.classList.remove("lumeo-pip-video");
      }
      pipWindow = null;
      pipRoot = null;
      pipVideoEl = null;
      origVideoParent = null;
      origVideoNext = null;
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
      resetPosition,
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
