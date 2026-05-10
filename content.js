// Lumeo content script — owns WebRTC PeerConnection lifecycle, the in-page
// overlay panel, and YT video element capture. Background tells us when to
// start/stop/update; we tell background what's happening via CONTENT_STATE.
// Caption tier (free YouTube subtitle translation) lives alongside the
// Standard / Realtime audio-dubbing pipelines inherited from the Echoly v0.2.1
// baseline (see CHANGELOG for the v2 merge history — Lumeo = Lumen v1 +
// Echoly v0.2.1, merged 2026-05-09).
//
// Layered: F9 version guard, F6 token-guarded async, F5 captureStream retry,
// F1 overlay panel, F2 history, F3 source captions, F4 handover.

(() => {
  // ───── F9 — Idempotent version guard ──────────────────────────────────────
  const LUMEO_VERSION = "2.0.0-beta.5";
  const GLOBAL_KEY = "__lumeoContentVersion";
  if (window[GLOBAL_KEY] === LUMEO_VERSION) return;
  // Older copy may have left UI behind; clean up before re-installing listeners.
  document.querySelectorAll(".ec-root").forEach((el) => el.remove());
  window[GLOBAL_KEY] = LUMEO_VERSION;

  // ───── Constants ──────────────────────────────────────────────────────────
  const KYMA_BASE = "https://api.kymaapi.com/v1";
  const OPENAI_CALLS_URL = "https://api.openai.com/v1/realtime/translations/calls";
  const SESSION_LIMIT_MS = 60 * 60 * 1000;
  const SESSION_WARNING_MS = 55 * 60 * 1000;
  const HEARTBEAT_MS = 30_000;
  const CAPTION_POLL_MS = 350;
  const HISTORY_MAX = 16;
  const VOICE_GAIN_MAX = 2.0;          // unity at slider 50, 2× boost at 100
  const LAYOUT_KEY = "lumeoOverlayLayout";
  const CAPTION_STYLE_KEY = "lumeoCaptionStyle";
  const RTL_LANGS = new Set(["ar", "fa", "he", "ur"]);

  const LANGUAGES = [
    ["en", "English"], ["vi", "Vietnamese"], ["ja", "Japanese"],
    ["ko", "Korean"], ["zh", "Chinese"], ["fr", "French"],
    ["es", "Spanish"], ["de", "German"], ["pt", "Portuguese"],
    ["hi", "Hindi"], ["id", "Indonesian"], ["it", "Italian"],
    ["ru", "Russian"],
  ];
  const LANG_NAME = Object.fromEntries(LANGUAGES);
  const REALTIME_VOICES = [
    "marin", "alloy", "ash", "ballad", "coral",
    "echo", "sage", "shimmer", "verse",
  ];
  const CAPTION_TTS_OPTIONS = [
    ["off", "TTS Off"],
    ["browser", "Browser TTS"],
    ["google-cloud", "Google Cloud TTS"],
  ];
  // Standard tier voices — Minimax `speech-02-turbo` IDs. Cross-language: each
  // voice handles all 13 target languages. Curated 2026-05-08.
  const STANDARD_VOICES = [
    ["English_magnetic_voiced_man",   "Magnetic Man"],
    ["English_captivating_female1",   "Captivating Female"],
    ["English_ManWithDeepVoice",      "Deep Voice Man"],
    ["English_ConfidentWoman",        "Confident Woman"],
    ["Chinese (Mandarin)_News_Anchor","News Anchor"],
  ];
  const STANDARD_DEFAULT_VOICE = STANDARD_VOICES[0][0];

  // Standard pipeline tunables. CHUNK_MS too short = wasteful per-call
  // overhead; too long = unbearable lag. 5s is the sweet spot for podcast/
  // keynote speech where sentences average 3-6s.
  const STANDARD_CHUNK_MS = 5000;
  const STANDARD_MIN_CHUNK_BYTES = 2000;  // sub-2KB blobs are silence
  const STANDARD_RECORDER_MIMES = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];

  // ───── F6 — Token-guarded session state ───────────────────────────────────
  // Every async callback that could mutate session state captures `pageToken`
  // in closure and checks `if (token !== pageToken) return` before mutating.
  // Each new session bumps pageToken so stale callbacks are silently dropped.
  let pageToken = 0;
  let session = null;     // active session
  let prevSession = null; // held during handover until new is fully ready
  let settings = null;
  let history = [];
  let currentTargetText = "";
  let currentSourceText = "";
  let captionPollTimer = null;
  let heartbeatTimer = null;
  let warningTimer = null;
  let limitTimer = null;
  let warningShown = false;
  let videoEl = null;
  let onYTPause = null;
  let onYTPlay = null;
  let lastSpaUrl = location.href;
  let layout = loadLayout();
  let captionStyle = loadCaptionStyle();

  // ───── Background channel ─────────────────────────────────────────────────
  function notifyBackground(msg) {
    chrome.runtime.sendMessage(msg).catch(() => {});
  }
  function emitState(partial) {
    notifyBackground({ type: "CONTENT_STATE", ...partial });
  }
  function emitEnded(reason) {
    notifyBackground({ type: "CONTENT_ENDED", reason });
  }

  // ───── F1 — Overlay panel ─────────────────────────────────────────────────
  let root = null;
  let elements = {};

  function loadLayout() {
    try {
      return {
        left: null, top: null, width: null, height: null, sideCollapsed: false,
        ...JSON.parse(localStorage.getItem(LAYOUT_KEY) || "{}"),
      };
    } catch {
      return { left: null, top: null, width: null, height: null, sideCollapsed: false };
    }
  }
  function saveLayout() {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch {}
  }
  function loadCaptionStyle() {
    try {
      return {
        fontSize: 22,
        showSource: true,
        ...JSON.parse(localStorage.getItem(CAPTION_STYLE_KEY) || "{}"),
      };
    } catch {
      return { fontSize: 22, showSource: true };
    }
  }
  function saveCaptionStyle() {
    try { localStorage.setItem(CAPTION_STYLE_KEY, JSON.stringify(captionStyle)); } catch {}
  }
  function applyCaptionStyle() {
    if (!root) return;
    root.style.setProperty("--lumeo-caption-font-size", `${captionStyle.fontSize || 22}px`);
    root.classList.toggle("ec-hide-source-line", captionStyle.showSource === false);
  }
  function clampLayout() {
    const maxW = Math.max(300, window.innerWidth - 24);
    const maxH = Math.max(130, window.innerHeight - 24);
    const w = Math.min(Math.max(layout.width || 560, 300), maxW);
    const h = Math.min(Math.max(layout.height || 200, 130), maxH);
    const left = Math.min(
      Math.max(layout.left ?? window.innerWidth - w - 24, 12),
      Math.max(12, window.innerWidth - w - 12),
    );
    const top = Math.min(
      Math.max(layout.top ?? window.innerHeight - h - 96, 12),
      Math.max(12, window.innerHeight - h - 12),
    );
    layout = { ...layout, left, top, width: w, height: h };
  }
  function applyLayout() {
    if (!root) return;
    clampLayout();
    root.style.left = layout.left + "px";
    root.style.top = layout.top + "px";
    root.style.width = layout.width + "px";
    root.style.height = layout.height + "px";
    root.style.right = "auto";
    root.style.bottom = "auto";
    root.classList.toggle("is-side-collapsed", !!layout.sideCollapsed);
    root.classList.toggle("is-compact", layout.width < 560 || layout.height < 210);
    root.classList.toggle("is-roomy", layout.width > 760 && layout.height > 235);
    root.style.setProperty(
      "--ec-target-lines",
      String(Math.max(2, Math.min(8, Math.floor((layout.height - 74) / 38)))),
    );
    if (elements.hideBtn) {
      elements.hideBtn.textContent = layout.sideCollapsed ? "Show" : "Hide";
    }
  }

  function buildOverlay() {
    if (root) return;
    root = document.createElement("aside");
    root.className = "ec-root";
    root.dataset.state = "ready";
    root.innerHTML = `
      <div class="ec-toolbar" data-ec-drag>
        <span class="ec-brand">
          <span class="ec-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
              <path d="M7 9v6M11 6v12M15 8v8M19 11v2"/>
            </svg>
          </span>
          <span class="ec-wordmark">Lumeo</span>
          <span class="ec-state" data-ec-status>Ready</span>
        </span>
        <span class="ec-spacer"></span>
        <select class="ec-select" data-ec-language aria-label="Target language"></select>
        <select class="ec-select" data-ec-voice aria-label="Voice"></select>
        <button class="ec-btn" type="button" data-ec-style hidden>Style</button>
        <button class="ec-btn" type="button" data-ec-export hidden>Export</button>
        <button class="ec-btn" type="button" data-ec-hide>Hide</button>
        <button class="ec-btn ec-btn-primary" type="button" data-ec-stop>Stop</button>
      </div>
      <div class="ec-body">
        <div class="ec-main">
          <div class="ec-style-popover" data-ec-style-panel hidden>
            <label>
              <span>Size</span>
              <input type="range" min="16" max="36" step="1" data-ec-style-size />
            </label>
            <label>
              <span>Source</span>
              <input type="checkbox" data-ec-style-source />
            </label>
          </div>
          <div class="ec-target" data-ec-target></div>
        </div>
        <div class="ec-side" data-ec-side>
          <div class="ec-source" data-ec-source hidden></div>
          <div class="ec-history" data-ec-history hidden></div>
        </div>
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
    document.documentElement.appendChild(root);

    elements = {
      status: root.querySelector("[data-ec-status]"),
      langSelect: root.querySelector("[data-ec-language]"),
      voiceSelect: root.querySelector("[data-ec-voice]"),
      target: root.querySelector("[data-ec-target]"),
      source: root.querySelector("[data-ec-source]"),
      history: root.querySelector("[data-ec-history]"),
      styleBtn: root.querySelector("[data-ec-style]"),
      stylePanel: root.querySelector("[data-ec-style-panel]"),
      styleSize: root.querySelector("[data-ec-style-size]"),
      styleSource: root.querySelector("[data-ec-style-source]"),
      hideBtn: root.querySelector("[data-ec-hide]"),
      stopBtn: root.querySelector("[data-ec-stop]"),
      exportBtn: root.querySelector("[data-ec-export]"),
      drag: root.querySelector("[data-ec-drag]"),
    };

    // Populate language picker
    for (const [code, name] of LANGUAGES) {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = name;
      elements.langSelect.appendChild(opt);
    }

    populateVoicePicker(settings?.tier || "realtime");
    elements.langSelect.value = settings?.targetLanguage || "vi";

    elements.langSelect.addEventListener("change", () => {
      const newLang = elements.langSelect.value;
      if (settings?.tier === "caption") {
        settings.targetLanguage = newLang;
        notifyBackground({ type: "UPDATE_SETTINGS", settings: { targetLanguage: newLang } });
        showToast("Stop and Start to retranslate captions", 5000);
      } else if (settings?.tier === "standard") {
        // Standard pipeline picks up the new prompt on the next chunk; no
        // tear-down needed. Push to background so popup stays in sync.
        settings.targetLanguage = newLang;
        notifyBackground({ type: "UPDATE_SETTINGS", settings: { targetLanguage: newLang } });
        setStatusText("Switching to " + (LANG_NAME[newLang] || newLang));
        setOverlayState("live");
      } else {
        requestHandover({ targetLanguage: newLang });
      }
    });
    elements.voiceSelect.addEventListener("change", () => {
      const newVoice = elements.voiceSelect.value;
      if (settings?.tier === "caption") {
        settings.captionTtsProvider = newVoice;
        notifyBackground({ type: "UPDATE_SETTINGS", settings: { captionTtsProvider: newVoice } });
      } else if (settings?.tier === "standard") {
        settings.standardVoice = newVoice;
        notifyBackground({ type: "UPDATE_SETTINGS", settings: { standardVoice: newVoice } });
      } else {
        requestHandover({ realtimeVoice: newVoice });
      }
    });
    elements.hideBtn.addEventListener("click", () => {
      layout.sideCollapsed = !layout.sideCollapsed;
      saveLayout();
      applyLayout();
    });
    elements.stopBtn.addEventListener("click", () => {
      stopSession("user-stop");
      notifyBackground({ type: "CONTENT_STATE", running: false, status: "Stopped" });
      emitEnded("Stopped");
    });
    elements.exportBtn.addEventListener("click", () => {
      exportSessionTranscript();
    });
    elements.styleBtn.addEventListener("click", () => {
      if (!elements.stylePanel) return;
      elements.stylePanel.hidden = !elements.stylePanel.hidden;
    });
    elements.styleSize.addEventListener("input", () => {
      captionStyle.fontSize = Number(elements.styleSize.value);
      saveCaptionStyle();
      applyCaptionStyle();
    });
    elements.styleSource.addEventListener("change", () => {
      captionStyle.showSource = elements.styleSource.checked;
      saveCaptionStyle();
      applyCaptionStyle();
    });

    bindDragResize();
    if (elements.styleSize) elements.styleSize.value = String(captionStyle.fontSize || 22);
    if (elements.styleSource) elements.styleSource.checked = captionStyle.showSource !== false;
    applyCaptionStyle();
    applyLayout();

    window.addEventListener("resize", applyLayout);
  }

  function applyTierToolbar() {
    if (elements.exportBtn) elements.exportBtn.hidden = !session;
    if (elements.styleBtn) elements.styleBtn.hidden = settings?.tier !== "caption";
    if (elements.stylePanel && settings?.tier !== "caption") elements.stylePanel.hidden = true;
  }

  // Tier-aware voice list rebuild. Realtime exposes 9 OpenAI voices + Auto;
  // Standard exposes 5 curated Minimax voices. Called from buildOverlay and
  // on tier change so the dropdown matches the active pipeline.
  function populateVoicePicker(tier) {
    if (!elements.voiceSelect) return;
    elements.voiceSelect.replaceChildren();
    if (tier === "caption") {
      for (const [id, name] of CAPTION_TTS_OPTIONS) {
        const opt = document.createElement("option");
        opt.value = id; opt.textContent = name;
        elements.voiceSelect.appendChild(opt);
      }
      elements.voiceSelect.value = settings?.captionTtsProvider || "off";
    } else if (tier === "standard") {
      for (const [id, name] of STANDARD_VOICES) {
        const opt = document.createElement("option");
        opt.value = id; opt.textContent = name;
        elements.voiceSelect.appendChild(opt);
      }
      elements.voiceSelect.value = settings?.standardVoice || STANDARD_DEFAULT_VOICE;
    } else {
      const autoOpt = document.createElement("option");
      autoOpt.value = ""; autoOpt.textContent = "Auto";
      elements.voiceSelect.appendChild(autoOpt);
      for (const v of REALTIME_VOICES) {
        const opt = document.createElement("option");
        opt.value = v; opt.textContent = v.charAt(0).toUpperCase() + v.slice(1);
        elements.voiceSelect.appendChild(opt);
      }
      elements.voiceSelect.value = settings?.realtimeVoice ?? "marin";
    }
  }

  function setOverlayState(state) {
    if (root) root.dataset.state = state;
  }
  function setStatusText(text) {
    if (elements.status) elements.status.textContent = text;
  }
  function setTargetText(text) {
    if (!elements.target) return;
    elements.target.textContent = text;
    const lang = settings?.targetLanguage;
    elements.target.dir = RTL_LANGS.has(lang) ? "rtl" : "ltr";
  }
  // Toast accepts plain text + optional CTA. Built via DOM APIs (not innerHTML)
  // because the text often comes from upstream API errors — a crafted error
  // body would otherwise be an XSS vector inside youtube.com's origin.
  function showToast(text, opts, durationMs) {
    if (!root) return;
    if (typeof opts === "number") { durationMs = opts; opts = null; }
    if (!durationMs) durationMs = 8000;
    let toast = root.querySelector(".ec-toast");
    if (toast) toast.remove();
    toast = document.createElement("div");
    toast.className = "ec-toast";
    toast.textContent = String(text || "");
    if (opts && opts.cta) {
      toast.append(" ");
      const a = document.createElement("a");
      a.href = String(opts.cta);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = String(opts.ctaLabel || "Open");
      toast.appendChild(a);
    }
    root.appendChild(toast);
    setTimeout(() => toast.remove(), durationMs);
  }
  function removeOverlay() {
    if (!root) return;
    window.removeEventListener("resize", applyLayout);
    root.remove();
    root = null;
    elements = {};
  }

  // ───── Drag + resize ──────────────────────────────────────────────────────
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

    root.addEventListener("pointermove", (e) => {
      if (!dragMode || !pointer) return;
      const dx = e.clientX - pointer.x;
      const dy = e.clientY - pointer.y;
      if (dragMode === "move") {
        layout.left = pointer.left + dx;
        layout.top = pointer.top + dy;
      } else {
        const m = dragMode.slice(7);  // remove "resize-"
        if (m.includes("e")) layout.width = pointer.width + dx;
        if (m.includes("s")) layout.height = pointer.height + dy;
        if (m.includes("w")) {
          layout.width = pointer.width - dx;
          layout.left = pointer.left + dx;
        }
        if (m.includes("n")) {
          layout.height = pointer.height - dy;
          layout.top = pointer.top + dy;
        }
      }
      applyLayout();
    });

    root.addEventListener("pointerup", () => {
      if (dragMode) saveLayout();
      dragMode = null;
      pointer = null;
    });
    root.addEventListener("pointercancel", () => {
      dragMode = null;
      pointer = null;
    });
  }
  function capturePointer(e) {
    const rect = root.getBoundingClientRect();
    return {
      x: e.clientX, y: e.clientY,
      left: layout.left ?? rect.left,
      top: layout.top ?? rect.top,
      width: layout.width ?? rect.width,
      height: layout.height ?? rect.height,
    };
  }

  // ───── F2 — History rendering ─────────────────────────────────────────────
  function pushHistoryTurn(opts = {}) {
    if (!currentTargetText && !opts.marker) return;
    const entry = {
      time: new Date().toTimeString().slice(0, 5),
      seconds: videoEl?.currentTime || 0,
      target: currentTargetText.slice(0, 280),
      source: currentSourceText.slice(0, 220),
      lang: settings?.targetLanguage,
      voice: settings?.realtimeVoice,
      marker: opts.marker || null,
    };
    history.unshift(entry);
    if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
    currentTargetText = "";
    renderHistory();
  }
  function renderHistory() {
    if (!elements.history) return;
    elements.history.replaceChildren();
    if (!history.length) {
      elements.history.hidden = true;
      return;
    }
    elements.history.hidden = false;
    for (const turn of history) {
      if (turn.marker) {
        const wrap = document.createElement("div");
        wrap.className = "ec-h-marker";
        const chip = document.createElement("span");
        chip.className = "ec-h-marker-chip";
        chip.textContent = turn.marker;
        wrap.appendChild(chip);
        elements.history.appendChild(wrap);
      }
      const item = document.createElement("div");
      item.className = "ec-h-item";
      const meta = document.createElement("span");
      meta.className = "ec-h-meta";
      meta.textContent = turn.time;
      const text = document.createElement("span");
      text.className = "ec-h-text";
      text.textContent = turn.target;
      item.append(meta, text);
      elements.history.appendChild(item);
    }
  }

  function exportSessionTranscript() {
    if (session?.type === "caption") {
      session.pipeline?.exportZip?.(getVideoTitle());
      showToast("Subtitle ZIP exported", 2500);
      return;
    }
    if (!history.length) {
      showToast("No transcript yet", 2500);
      return;
    }
    const cues = [...history].reverse().map((turn, index) => {
      const start = Number(turn.seconds || index * 4);
      return {
        start,
        end: start + 4,
        text: turn.source || turn.target,
        translated: turn.target,
      };
    });
    const title = getVideoTitle();
    const blob = window.LumeoSrtExport.makeSubtitleZip(cues, title);
    const safeTitle = window.LumeoSrtExport.sanitizeFilename(title);
    window.LumeoSrtExport.downloadBlob(blob, `${safeTitle}_lumeo_transcript.zip`);
    showToast("Transcript ZIP exported", 2500);
  }

  function fmtCaptionTime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds || 0)));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function getVideoTitle() {
    const titleEl =
      document.querySelector("yt-formatted-string.ytd-watch-metadata") ||
      document.querySelector("h1.ytd-watch-metadata yt-formatted-string") ||
      document.querySelector("#title h1");
    return titleEl?.textContent?.trim() || "youtube-video";
  }

  function renderCaptionTranscript(cues) {
    if (!elements.history) return;
    elements.history.replaceChildren();
    elements.history.hidden = false;
    const header = document.createElement("div");
    header.className = "ec-caption-header";
    header.textContent = `TRANSCRIPT · ${cues.length} BLOCKS`;
    elements.history.appendChild(header);
    for (let i = 0; i < cues.length; i += 1) {
      const cue = cues[i];
      const row = document.createElement("button");
      row.type = "button";
      row.className = "ec-caption-row";
      row.dataset.index = String(i);
      row.addEventListener("click", () => {
        const video = videoEl || findVideo();
        if (video) video.currentTime = cue.start;
      });
      const time = document.createElement("span");
      time.className = "ec-caption-time";
      time.textContent = fmtCaptionTime(cue.start);
      const text = document.createElement("span");
      text.className = "ec-caption-text";
      const target = document.createElement("strong");
      target.textContent = cue.translated || cue.text;
      const source = document.createElement("small");
      source.textContent = cue.text;
      text.append(target, source);
      row.append(time, text);
      elements.history.appendChild(row);
    }
  }

  function updateCaptionTranscriptHighlight(index) {
    if (!elements.history) return;
    const active = elements.history.querySelector(".ec-caption-row.is-active");
    active?.classList.remove("is-active");
    if (index < 0) return;
    const row = elements.history.querySelector(`.ec-caption-row[data-index="${index}"]`);
    if (!row) return;
    row.classList.add("is-active");
    row.scrollIntoView({ block: "nearest" });
  }

  // ───── F3 — Source caption polling ────────────────────────────────────────
  let lastSeenCaption = "";
  function readYTCaptions() {
    const segs = document.querySelectorAll(".ytp-caption-segment");
    return Array.from(segs).map((s) => s.textContent).join(" ").trim().replace(/\s+/g, " ");
  }
  function startCaptionPoll() {
    stopCaptionPoll();
    lastSeenCaption = "";
    captionPollTimer = setInterval(() => {
      if (!settings?.showSource) return;
      const text = readYTCaptions();
      if (!text || text === lastSeenCaption) return;
      lastSeenCaption = text;
      currentSourceText = text;
      if (elements.source) {
        elements.source.textContent = text.slice(-220);
      }
    }, CAPTION_POLL_MS);
  }
  function stopCaptionPoll() {
    if (captionPollTimer) {
      clearInterval(captionPollTimer);
      captionPollTimer = null;
    }
  }
  function applySourceVisibility() {
    if (!elements.source) return;
    elements.source.hidden = !settings?.showSource;
  }

  // ───── F5 — captureStream re-acquisition with playback nudge ──────────────
  function findVideo() {
    return document.querySelector("video.html5-main-video") || document.querySelector("video");
  }
  function nudgePlay(video) {
    if (!video.paused) return Promise.resolve();
    const p = video.play();
    if (!p?.then) return Promise.resolve();
    return Promise.race([p.catch(() => {}), new Promise((r) => setTimeout(r, 250))]);
  }
  async function captureWithRetry(video, timeoutMs = 9000) {
    if (typeof video.captureStream !== "function" && typeof video.mozCaptureStream !== "function") {
      throw new Error("This Chrome build cannot capture YouTube audio.");
    }
    const start = Date.now();
    let lastStream;
    while (Date.now() - start < timeoutMs) {
      if (video.paused) await nudgePlay(video);
      lastStream = (video.captureStream || video.mozCaptureStream).call(video);
      if (lastStream.getAudioTracks().length) {
        return new MediaStream(lastStream.getAudioTracks());
      }
      lastStream.getTracks().forEach((t) => t.stop());
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error("YouTube audio not ready. Press play, then Start again.");
  }

  // ───── Kyma error parser ──────────────────────────────────────────────────
  function parseKymaError(status, errText) {
    try {
      const parsed = JSON.parse(errText);
      const err = parsed.error || {};
      if (err.code === "insufficient_balance") {
        const cta = err.cta_url || "https://kymaapi.com/billing";
        return { user: "Out of Kyma balance.", cta, ctaLabel: "Top up" };
      }
      if (err.code === "too_many_sessions") {
        return { user: "Three sessions already running. Stop one or wait." };
      }
      if (err.code === "upstream_error") {
        return { user: "Provider unreachable. Try again shortly." };
      }
      if (err.code === "rate_limited") {
        return { user: "Provider rate limit hit. Wait 30s." };
      }
      if (err.message) return { user: "Kyma " + status + ": " + err.message };
    } catch {}
    return { user: "Kyma " + status + ": " + (errText || "").slice(0, 160) };
  }

  // ───── Heartbeat + session timer (60-min cap, one-shot 55-min warning) ────
  function startHeartbeat(kymaSessionId, kymaKey) {
    stopHeartbeat();
    if (!kymaSessionId || !kymaKey) return;
    heartbeatTimer = setInterval(() => {
      if (!session) return;
      fetch(`${KYMA_BASE}/realtime/translations/sessions/${kymaSessionId}/heartbeat`, {
        method: "POST",
        headers: { Authorization: "Bearer " + kymaKey },
      }).catch(() => {});
    }, HEARTBEAT_MS);
  }
  function stopHeartbeat() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  }

  function startSessionTimer() {
    clearSessionTimer();
    warningShown = false;
    warningTimer = setTimeout(() => {
      if (warningShown) return;
      warningShown = true;
      showToast("Session ends in 5 min", 6000);
    }, SESSION_WARNING_MS);
    limitTimer = setTimeout(() => {
      stopSession("auto-stop-60min");
      emitEnded("Auto-stopped at 60 min — start again to continue.");
    }, SESSION_LIMIT_MS);
  }
  function clearSessionTimer() {
    if (warningTimer) { clearTimeout(warningTimer); warningTimer = null; }
    if (limitTimer) { clearTimeout(limitTimer); limitTimer = null; }
  }

  // ───── End Kyma session (release collateral immediately, no 90s wait) ─────
  async function endKymaSession(kymaSessionId, kymaKey) {
    if (!kymaSessionId || !kymaKey) return;
    try {
      await fetch(`${KYMA_BASE}/realtime/translations/sessions/${kymaSessionId}/end`, {
        method: "POST",
        headers: { Authorization: "Bearer " + kymaKey },
        keepalive: true,
      });
    } catch {}
  }

  // ───── Session core (build PeerConnection through Kyma → OpenAI) ─────────
  async function buildRealtimeSession(token, audioStream, opts) {
    const kymaKey = opts.kymaKey;
    const lang = opts.targetLanguage || "vi";
    const voice = opts.realtimeVoice || "";

    setStatusText("Connecting");
    setOverlayState("connecting");

    let mintResp;
    try {
      mintResp = await fetch(`${KYMA_BASE}/realtime/translations/client_secrets`, {
        method: "POST",
        headers: { Authorization: "Bearer " + kymaKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          session: {
            model: "gpt-realtime-translate",
            audio: { output: { language: lang, ...(voice ? { voice } : {}) } },
          },
        }),
      });
    } catch (e) {
      throw new Error("Network error reaching Kyma.");
    }
    if (token !== pageToken) throw new Error("Stale session.");
    if (!mintResp.ok) {
      const text = await mintResp.text().catch(() => "");
      const parsed = parseKymaError(mintResp.status, text);
      const err = new Error(parsed.user);
      err.cta = parsed.cta;
      err.ctaLabel = parsed.ctaLabel;
      throw err;
    }
    const mint = await mintResp.json();
    if (token !== pageToken) throw new Error("Stale session.");
    const clientSecret = mint.value;
    const kymaSessionId = mint.kyma_session_id;
    if (!clientSecret) throw new Error("Kyma response missing client_secret.");

    const pc = new RTCPeerConnection();
    for (const track of audioStream.getAudioTracks()) pc.addTrack(track, audioStream);

    const dc = pc.createDataChannel("oai-events");
    dc.addEventListener("message", (e) => {
      if (token !== pageToken && session?.token !== token) return;
      handleRealtimeEvent(e.data, token);
    });

    const newSession = {
      token, pc, dc,
      stream: audioStream,
      remoteAudio: null,
      audioCtx: null,
      outputGain: null,
      kymaSessionId,
      kymaKey,
      targetLanguage: lang,
      realtimeVoice: voice,
    };

    pc.addEventListener("track", (event) => {
      if (newSession.remoteAudio) return;
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.muted = true;  // playback flows through Web Audio for amplification
      audio.srcObject = event.streams[0];
      document.body.appendChild(audio);
      newSession.remoteAudio = audio;

      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        const src = ctx.createMediaStreamSource(event.streams[0]);
        const gain = ctx.createGain();
        gain.gain.value = computeGain(settings?.voiceVolume ?? 100);
        src.connect(gain);
        gain.connect(ctx.destination);
        newSession.audioCtx = ctx;
        newSession.outputGain = gain;
      } catch {
        // Fallback: HTMLAudio (capped at 1.0)
        audio.muted = false;
        audio.volume = Math.min((settings?.voiceVolume ?? 100) / 100, 1.0);
      }
    });

    pc.addEventListener("iceconnectionstatechange", () => {
      if (token !== pageToken && session?.token !== token) return;
      if (["closed", "failed", "disconnected"].includes(pc.iceConnectionState)) {
        // Network drop or remote close
        if (newSession === session) {
          stopSession("connection-lost");
          emitEnded("Connection lost.");
        }
      }
    });

    const offer = await pc.createOffer();
    if (token !== pageToken) throw new Error("Stale session.");
    await pc.setLocalDescription(offer);

    const sdpResp = await fetch(OPENAI_CALLS_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + clientSecret, "Content-Type": "application/sdp" },
      body: offer.sdp,
    });
    if (token !== pageToken) {
      try { pc.close(); } catch {}
      throw new Error("Stale session.");
    }
    if (!sdpResp.ok) {
      const t = await sdpResp.text().catch(() => "");
      try { pc.close(); } catch {}
      void endKymaSession(kymaSessionId, kymaKey);
      throw new Error(`SDP exchange ${sdpResp.status}: ${t.slice(0, 160)}`);
    }
    const answerSdp = await sdpResp.text();
    if (token !== pageToken) {
      try { pc.close(); } catch {}
      throw new Error("Stale session.");
    }
    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

    return newSession;
  }

  function handleRealtimeEvent(raw, token) {
    if (token !== pageToken && session?.token !== token) return;
    let evt;
    try { evt = JSON.parse(raw); } catch { return; }
    if (evt.type === "error") {
      setStatusText("Translation error");
      return;
    }
    const isDelta =
      evt.type === "session.output_transcript.delta" ||
      evt.type === "response.audio_transcript.delta" ||
      evt.type === "response.output_audio_transcript.delta" ||
      (evt.type === "response.text.delta" && typeof evt.delta === "string");
    if (isDelta && evt.delta) {
      currentTargetText += evt.delta;
      setTargetText(currentTargetText);
      setOverlayState("live");
      return;
    }
    const isDone =
      evt.type === "session.output_transcript.done" ||
      evt.type === "response.audio_transcript.done" ||
      evt.type === "response.output_audio_transcript.done" ||
      evt.type === "response.text.done";
    if (isDone) {
      if (evt.transcript) currentTargetText = evt.transcript;
      setTargetText(currentTargetText);
      pushHistoryTurn();
      return;
    }
  }

  function computeGain(voiceVolume) {
    return voiceVolume === 0 ? 0 : (voiceVolume / 100) * VOICE_GAIN_MAX;
  }

  function applyVolumes(originalVolume, voiceVolume) {
    if (videoEl) {
      videoEl.volume = (originalVolume ?? 18) / 100;
      videoEl.muted = (originalVolume ?? 0) === 0;
    }
    if (session?.outputGain) {
      session.outputGain.gain.value = computeGain(voiceVolume ?? 100);
    } else if (session?.remoteAudio) {
      session.remoteAudio.volume = Math.min((voiceVolume ?? 100) / 100, 1.0);
      session.remoteAudio.muted = voiceVolume === 0;
    }
  }

  // ───── F4 — Voice / language handover (zero-gap) ──────────────────────────
  async function requestHandover(partial) {
    if (!session) return;
    const newSettings = { ...settings, ...partial };
    const same =
      newSettings.targetLanguage === session.targetLanguage &&
      (newSettings.realtimeVoice || "") === (session.realtimeVoice || "");
    if (same) return;

    // Mark current turn into history with marker chip showing the change
    const fromLang = LANG_NAME[session.targetLanguage] || session.targetLanguage;
    const toLang = LANG_NAME[newSettings.targetLanguage] || newSettings.targetLanguage;
    if (newSettings.targetLanguage !== session.targetLanguage) {
      pushHistoryTurn({ marker: `${fromLang} → ${toLang}` });
      setStatusText("Switching to " + toLang);
    } else {
      pushHistoryTurn({ marker: "Switching voice" });
      setStatusText("Switching voice");
    }
    setOverlayState("connecting");

    const newToken = ++pageToken;
    settings = newSettings;
    notifyBackground({ type: "UPDATE_SETTINGS", settings: newSettings });
    if (elements.langSelect) elements.langSelect.value = newSettings.targetLanguage;
    if (elements.voiceSelect) elements.voiceSelect.value = newSettings.realtimeVoice || "";

    let newSession;
    try {
      newSession = await buildRealtimeSession(newToken, session.stream, {
        kymaKey: settings.kymaKey,
        targetLanguage: newSettings.targetLanguage,
        realtimeVoice: newSettings.realtimeVoice,
      });
      if (newToken !== pageToken) {
        // Yet another change came in; abandon this build
        try { newSession.pc.close(); } catch {}
        return;
      }
    } catch (err) {
      if (newToken !== pageToken) return;
      setStatusText("Switch failed — keeping current session");
      setOverlayState("live");
      showToast(err.message, { cta: err.cta, ctaLabel: err.ctaLabel }, 9000);
      // Old session stays running — no swap performed
      return;
    }

    // Swap: mute old, install new, close old
    prevSession = session;
    session = newSession;
    setStatusText("Translating");
    setOverlayState("live");

    // Wait briefly for new audio track to arrive before muting old
    setTimeout(() => {
      if (prevSession) {
        try {
          if (prevSession.remoteAudio) {
            prevSession.remoteAudio.pause();
            prevSession.remoteAudio.srcObject = null;
            prevSession.remoteAudio.remove();
          }
          if (prevSession.outputGain) prevSession.outputGain.disconnect();
          if (prevSession.audioCtx) prevSession.audioCtx.close();
          prevSession.pc?.close();
        } catch {}
        void endKymaSession(prevSession.kymaSessionId, prevSession.kymaKey);
        prevSession = null;
      }
    }, 400);

    // Heartbeat for new session, drop old heartbeat
    startHeartbeat(newSession.kymaSessionId, newSession.kymaKey);
    applyVolumes(settings.originalVolume, settings.voiceVolume);
  }

  // ───── Standard tier (chunked: whisper → gpt-4o-mini → minimax) ───────────
  // Pipeline lives entirely client-side. Each chunk independently calls three
  // Kyma endpoints; chunks process in parallel so chunk N+1 starts recording
  // while chunk N is still in TTS. Playback queue uses Web Audio scheduling
  // so dub plays back-to-back even when pipeline latency varies per chunk.
  async function startStandardSession() {
    const video = findVideo();
    if (!video) return { ok: false, error: "No YouTube video on this page." };
    videoEl = video;

    let stream;
    try {
      buildOverlay();
      setStatusText("Acquiring audio");
      stream = await captureWithRetry(video);
    } catch (err) {
      removeOverlay();
      return { ok: false, error: err.message };
    }

    const recorderMime = pickRecorderMime();
    if (!recorderMime) {
      stream.getTracks().forEach((t) => t.stop());
      removeOverlay();
      return { ok: false, error: "Browser cannot record audio for chunked pipeline." };
    }

    let audioCtx;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      removeOverlay();
      return { ok: false, error: "AudioContext unavailable: " + err.message };
    }
    const outputGain = audioCtx.createGain();
    outputGain.gain.value = computeGain(settings.voiceVolume ?? 100);
    outputGain.connect(audioCtx.destination);

    const token = ++pageToken;
    const newSession = {
      token,
      type: "standard",
      stream,
      audioCtx,
      outputGain,
      remoteAudio: null,
      pc: null,
      dc: null,
      kymaSessionId: null,
      kymaKey: settings.kymaKey,
      recorderMime,
      activeRecorder: null,
      nextPlayAt: 0,
      stopFlag: false,
      // One AbortController for the whole session — every fetch in
      // processStandardChunk hangs off this signal so a Stop click cancels
      // in-flight whisper/translate/TTS calls instead of silently burning
      // ~5-10s of Kyma credits per orphaned pipeline.
      abortController: new AbortController(),
    };
    session = newSession;
    applyTierToolbar();

    setStatusText("Translating");
    setOverlayState("live");
    startSessionTimer();
    applyVolumes(settings.originalVolume, settings.voiceVolume);
    applySourceVisibility();
    if (settings.showSource) startCaptionPoll();

    onYTPause = () => {
      setStatusText("Paused");
      setOverlayState("paused");
      emitState({ paused: true, status: "Paused" });
    };
    onYTPlay = () => {
      setStatusText("Translating");
      setOverlayState("live");
      emitState({ paused: false, status: "Translating" });
    };
    video.addEventListener("pause", onYTPause);
    video.addEventListener("play", onYTPlay);

    runChunkLoop(newSession);
    emitState({ running: true, paused: false, status: "Translating" });
    return { ok: true };
  }

  function pickRecorderMime() {
    if (typeof MediaRecorder === "undefined") return "";
    for (const m of STANDARD_RECORDER_MIMES) {
      try { if (MediaRecorder.isTypeSupported(m)) return m; } catch {}
    }
    return "";
  }

  // Kyma's transcription gateway whitelists mp3/wav/m4a only — Chrome
  // MediaRecorder can only emit webm/opus or mp4. So we decode the recorder
  // blob locally and re-encode as 16-bit PCM WAV before uploading. The
  // overhead is ~30ms per 5s chunk on M-series Macs and bandwidth roughly
  // doubles (opus 24kbps → wav 16-bit mono 16kHz ≈ 256kbps), which is fine
  // for a 5s window.
  async function webmBlobToWav(blob, sharedCtx) {
    const arrayBuf = await blob.arrayBuffer();
    let ownCtx;
    let ctx = sharedCtx;
    if (!ctx) {
      ownCtx = new (window.AudioContext || window.webkitAudioContext)();
      ctx = ownCtx;
    }
    let audioBuf;
    try {
      audioBuf = await ctx.decodeAudioData(arrayBuf);
    } finally {
      if (ownCtx) ownCtx.close().catch(() => {});
    }
    return audioBufferToWavBlob(audioBuf);
  }

  function audioBufferToWavBlob(audioBuf) {
    // Whisper handles mono fine; downmix to mono and resample to 16 kHz to
    // match Whisper's internal rate — saves bandwidth without quality loss.
    const targetRate = 16000;
    const monoSamples = downmixAndResample(audioBuf, targetRate);
    const dataSize = monoSamples.length * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    let p = 0;
    function wstr(s) { for (let i = 0; i < s.length; i++) view.setUint8(p++, s.charCodeAt(i)); }
    function w32(n) { view.setUint32(p, n, true); p += 4; }
    function w16(n) { view.setUint16(p, n, true); p += 2; }
    wstr("RIFF"); w32(36 + dataSize); wstr("WAVE");
    wstr("fmt "); w32(16); w16(1); w16(1); w32(targetRate);
    w32(targetRate * 2); w16(2); w16(16);
    wstr("data"); w32(dataSize);
    for (let i = 0; i < monoSamples.length; i++) {
      const s = Math.max(-1, Math.min(1, monoSamples[i]));
      view.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      p += 2;
    }
    return new Blob([buffer], { type: "audio/wav" });
  }

  function downmixAndResample(audioBuf, targetRate) {
    const srcRate = audioBuf.sampleRate;
    const channels = audioBuf.numberOfChannels;
    const srcLen = audioBuf.length;
    // Mono mix first (avg across channels).
    const mono = new Float32Array(srcLen);
    for (let ch = 0; ch < channels; ch++) {
      const data = audioBuf.getChannelData(ch);
      for (let i = 0; i < srcLen; i++) mono[i] += data[i];
    }
    if (channels > 1) for (let i = 0; i < srcLen; i++) mono[i] /= channels;
    if (srcRate === targetRate) return mono;
    // Linear resample — adequate for speech intelligibility at 16 kHz target.
    const ratio = srcRate / targetRate;
    const outLen = Math.floor(srcLen / ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const src = i * ratio;
      const i0 = Math.floor(src);
      const i1 = Math.min(i0 + 1, srcLen - 1);
      const f = src - i0;
      out[i] = mono[i0] * (1 - f) + mono[i1] * f;
    }
    return out;
  }

  // Recorder cycle: stop+start each window so each blob is a self-contained
  // file that whisper can decode without container fragments. The brief
  // (<10ms) gap between cycles is acceptable; it lands in inter-sentence
  // pauses more often than not.
  function runChunkLoop(s) {
    const cycle = () => {
      if (s !== session || s.stopFlag) return;
      // Skip recording while video paused — captureStream emits silence so
      // we'd burn a whisper call to learn nothing.
      if (videoEl?.paused) {
        setTimeout(cycle, 400);
        return;
      }
      let recorder;
      try {
        recorder = new MediaRecorder(s.stream, { mimeType: s.recorderMime });
      } catch {
        try { recorder = new MediaRecorder(s.stream); } catch {
          setTimeout(cycle, 1000);
          return;
        }
      }
      s.activeRecorder = recorder;
      const parts = [];
      recorder.addEventListener("dataavailable", (e) => {
        if (e.data && e.data.size > 0) parts.push(e.data);
      });
      recorder.addEventListener("stop", () => {
        if (s !== session || s.stopFlag) return;
        if (parts.length) {
          const blob = new Blob(parts, { type: s.recorderMime });
          processStandardChunk(s, blob).catch(() => {});
        }
        cycle();
      });
      try { recorder.start(); } catch {
        setTimeout(cycle, 1000);
        return;
      }
      setTimeout(() => {
        try { if (recorder.state !== "inactive") recorder.stop(); } catch {}
      }, STANDARD_CHUNK_MS);
    };
    cycle();
  }

  async function processStandardChunk(s, blob) {
    if (s !== session || s.token !== pageToken) return;
    if (blob.size < STANDARD_MIN_CHUNK_BYTES) return;
    const t = s.token;
    const lang = settings.targetLanguage || "vi";
    const langName = LANG_NAME[lang] || lang;
    const voiceId = settings.standardVoice || STANDARD_DEFAULT_VOICE;
    const kymaKey = s.kymaKey;

    // 1. Transcribe — gateway whitelist rejects webm/opus, so re-encode the
    // recorder blob as 16 kHz mono WAV before upload. Reuses the playback
    // AudioContext so we don't spin up a fresh decoder per chunk.
    let wavBlob;
    try {
      wavBlob = await webmBlobToWav(blob, s.audioCtx);
    } catch {
      return;
    }
    if (s !== session || s.token !== t) return;
    const fd = new FormData();
    fd.append("file", wavBlob, "chunk.wav");
    fd.append("model", "whisper-v3-turbo");
    fd.append("response_format", "json");
    let trResp;
    try {
      trResp = await fetch(`${KYMA_BASE}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: "Bearer " + kymaKey },
        body: fd,
        signal: s.abortController.signal,
      });
    } catch {
      return;  // network blip OR aborted via Stop; next chunk will recover
    }
    if (s !== session || s.token !== t) return;
    if (!trResp.ok) {
      const txt = await trResp.text().catch(() => "");
      const parsed = parseKymaError(trResp.status, txt);
      showStandardError(parsed);
      return;
    }
    const tr = await trResp.json().catch(() => ({}));
    const sourceText = String(tr.text || "").trim();
    if (!sourceText || sourceText.length < 2) return;
    currentSourceText = sourceText;
    if (elements.source && settings.showSource) {
      elements.source.textContent = sourceText.slice(-220);
    }

    // 2. Translate via gemini-2.5-flash. Strict prompt — no quotes/commentary —
    // because anything extra goes straight into TTS as spoken words. Gemini
    // Flash is the cheap+multilingual pick on Kyma; gpt-4o-mini isn't in the
    // catalog (verified 2026-05-08).
    let tlResp;
    try {
      tlResp = await fetch(`${KYMA_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + kymaKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `You are a live dubbing translator. Translate the user's sentence into ${langName}. Output ONLY the translation. No quotes, no commentary, no explanation, no labels. Preserve names, brand names, and technical terms verbatim.`,
            },
            { role: "user", content: sourceText },
          ],
          temperature: 0.2,
        }),
        signal: s.abortController.signal,
      });
    } catch {
      return;
    }
    if (s !== session || s.token !== t) return;
    if (!tlResp.ok) {
      const txt = await tlResp.text().catch(() => "");
      const parsed = parseKymaError(tlResp.status, txt);
      showStandardError(parsed);
      return;
    }
    const tl = await tlResp.json().catch(() => ({}));
    const targetText = String(tl?.choices?.[0]?.message?.content || "").trim();
    if (!targetText) return;
    currentTargetText = targetText;
    setTargetText(targetText);
    setOverlayState("live");

    // 3. TTS via Minimax. mp3 returned directly as audio bytes.
    let ttsResp;
    try {
      ttsResp = await fetch(`${KYMA_BASE}/audio/speech`, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + kymaKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "minimax-speech-turbo",
          input: targetText,
          voice_id: voiceId,
          response_format: "mp3",
        }),
        signal: s.abortController.signal,
      });
    } catch {
      return;
    }
    if (s !== session || s.token !== t) return;
    if (!ttsResp.ok) {
      const txt = await ttsResp.text().catch(() => "");
      const parsed = parseKymaError(ttsResp.status, txt);
      showStandardError(parsed);
      return;
    }
    const arrayBuf = await ttsResp.arrayBuffer();
    if (s !== session || s.token !== t) return;

    let audioBuf;
    try {
      audioBuf = await s.audioCtx.decodeAudioData(arrayBuf);
    } catch {
      return;
    }
    if (s !== session || s.token !== t) return;

    // Schedule against the queue tail so chunks play sequentially without
    // overlap, even when one chunk's pipeline takes longer than another. If
    // the queue tail has fallen behind realtime (silence/error gaps left it
    // stranded in the past), reset it — otherwise the next valid chunk would
    // play immediately AND every chunk after would inherit the stale offset.
    if (s.nextPlayAt < s.audioCtx.currentTime) s.nextPlayAt = 0;
    const startAt = Math.max(s.audioCtx.currentTime + 0.05, s.nextPlayAt);
    const src = s.audioCtx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(s.outputGain);
    try { src.start(startAt); } catch {}
    s.nextPlayAt = startAt + audioBuf.duration;

    pushHistoryTurn();
  }

  function showStandardError(parsed) {
    setStatusText(parsed.user || "Pipeline error");
    showToast(parsed.user, { cta: parsed.cta, ctaLabel: parsed.ctaLabel }, 6000);
  }

  function missingCaptionDependencies() {
    const required = [
      ["LumeoTranslate", window.LumeoTranslate],
      ["LumeoSrtExport", window.LumeoSrtExport],
      ["LumeoTTS", window.LumeoTTS],
      ["LumeoSonioxSTT", window.LumeoSonioxSTT],
      ["LumeoCaptions", window.LumeoCaptions],
      ["LumeoCaptionPipeline", window.LumeoCaptionPipeline],
    ];
    return required.filter(([, value]) => !value).map(([name]) => name);
  }

  function renderCaptionFallbackChoice(video, token, pipeline, reason, diagnostics) {
    session = {
      token,
      type: "caption",
      choiceOnly: true,
      pipeline,
      captionTimer: null,
      lastCueIndex: -1,
      kymaKey: null,
      stream: null,
      pc: null,
      dc: null,
    };
    applyTierToolbar();
    setStatusText("Choose fallback");
    setOverlayState("error");
    if (elements.history) elements.history.hidden = true;
    if (!elements.target) return;
    elements.target.textContent = "";
    const wrap = document.createElement("div");
    wrap.className = "ec-choice";
    const title = document.createElement("strong");
    title.textContent = diagnostics?.reason === "no-target-language"
      ? "No matching caption language"
      : diagnostics?.reason === "timedtext-empty-body"
        ? "YouTube returned empty captions"
        : "No YouTube captions found";
    const copy = document.createElement("small");
    copy.textContent = reason || "This video did not expose a readable caption track.";

    let trackInfo = null;
    if (Array.isArray(diagnostics?.tracks) && diagnostics.tracks.length) {
      trackInfo = document.createElement("div");
      trackInfo.className = "ec-choice-tracks";
      const head = document.createElement("strong");
      head.textContent = `Detected tracks (${diagnostics.tracks.length})`;
      trackInfo.appendChild(head);
      const list = document.createElement("ul");
      for (const track of diagnostics.tracks.slice(0, 12)) {
        const li = document.createElement("li");
        const tag = track.kind === "asr" ? " · auto" : "";
        li.textContent = `${track.languageCode}${tag}${track.name ? ` — ${track.name}` : ""}`;
        list.appendChild(li);
      }
      trackInfo.appendChild(list);
    }

    const actions = document.createElement("div");
    actions.className = "ec-choice-actions";

    const sonioxBtn = document.createElement("button");
    sonioxBtn.type = "button";
    sonioxBtn.className = "ec-choice-btn";
    sonioxBtn.textContent = "Try Soniox STT";
    sonioxBtn.addEventListener("click", async () => {
      if (!settings.sonioxApiKey) {
        showToast("Add a Soniox key in the popup marketplace.", 7000);
        emitState({
          running: true,
          status: "Add Soniox key",
          errorMessage: "",
          errorCode: "missing-caption-track",
          missingProviders: ["soniox"],
          slotsMissingKeys: ["stt"],
        });
        notifyBackground({ type: "OPEN_POPUP_TO_SLOT", slot: "stt" });
        return;
      }
      const reply = await startCaptionSonioxFallback(video, token, pipeline, reason);
      if (!reply?.ok) {
        showToast(reply?.error || "Could not start Soniox fallback.", 7000);
        emitState({ running: false, status: "Soniox error", errorMessage: reply?.error || "Soniox error" });
      }
    });

    const standardBtn = document.createElement("button");
    standardBtn.type = "button";
    standardBtn.className = "ec-choice-btn";
    standardBtn.textContent = "Switch to Standard Dub";
    standardBtn.addEventListener("click", async () => {
      if (!settings.kymaKey) {
        showToast("Add a Kyma key in the Standard Dub provider card.", 7000);
        emitState({
          running: true,
          status: "Add Kyma key",
          errorMessage: "",
          errorCode: "missing-dub-key",
          missingProviders: ["kyma"],
          slotsMissingKeys: ["dubPipeline"],
        });
        notifyBackground({ type: "OPEN_POPUP_TO_SLOT", slot: "dubPipeline" });
        return;
      }
      pipeline.stop?.();
      session = null;
      settings = { ...settings, tier: "standard" };
      notifyBackground({ type: "UPDATE_SETTINGS", settings: { tier: "standard" } });
      const reply = await startStandardSession();
      if (!reply?.ok) {
        showToast(reply?.error || "Could not start Standard Dub.", 7000);
        emitState({ running: false, status: "Standard error", errorMessage: reply?.error || "Standard error" });
      }
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "ec-choice-btn ec-choice-btn-muted";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => {
      stopSession("caption-fallback-cancel");
      emitEnded("Caption fallback cancelled.");
    });

    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "ec-choice-btn ec-choice-btn-muted";
    retryBtn.textContent = "Retry caption fetch";
    retryBtn.addEventListener("click", async () => {
      pipeline.stop?.();
      session = null;
      const reply = await startCaptionSession();
      if (!reply?.ok) {
        showToast(reply?.error || "Retry failed.", 7000);
      }
    });

    actions.append(sonioxBtn, standardBtn, retryBtn, cancelBtn);
    wrap.append(title, copy);
    if (trackInfo) wrap.append(trackInfo);
    wrap.append(actions);
    elements.target.appendChild(wrap);
    emitState({
      running: true,
      paused: false,
      status: "Choose fallback",
      errorMessage: "",
      errorCode: "missing-caption-track",
      missingProviders: ["soniox", "kyma"],
      slotsMissingKeys: [],
    });
  }

  // ───── Caption tier (free/BYOK text translation) ──────────────────────────
  // Clean rewrite of the Lumen v1 caption path: use YouTube timedtext tracks
  // first, translate only when native target captions are unavailable, and
  // render through the same Lumeo overlay shell used by the dub tiers.
  async function startCaptionSession() {
    const video = findVideo();
    if (!video) return { ok: false, error: "No YouTube video on this page." };
    videoEl = video;

    buildOverlay();
    setStatusText("Loading captions");
    setOverlayState("connecting");
    applyTierToolbar();
    applySourceVisibility();

    const token = ++pageToken;
    const missingDeps = missingCaptionDependencies();
    if (missingDeps.length) {
      return {
        ok: false,
        error: `Caption dependencies not loaded: ${missingDeps.join(", ")}. Reload the extension and this YouTube tab.`,
      };
    }
    const pipeline = window.LumeoCaptionPipeline.create();

    let result;
    try {
      result = await pipeline.start({
        targetLanguage: settings.targetLanguage || "vi",
        targetLanguageName: LANG_NAME[settings.targetLanguage] || settings.targetLanguage || "Vietnamese",
        translateProvider: settings.translateProvider || "google-free",
        openaiKey: settings.openaiKey,
        openaiModel: settings.openaiModel,
        geminiKey: settings.geminiKey,
        geminiModel: settings.geminiModel,
        openRouterKey: settings.openRouterKey,
        openRouterModel: settings.openRouterModel,
        groqApiKey: settings.groqApiKey,
        groqModel: settings.groqModel,
        googleCloudKey: settings.googleCloudKey,
        libreTranslateUrl: settings.libreTranslateUrl,
        libreTranslateKey: settings.libreTranslateKey,
        context: settings.translationContext,
      });
    } catch (err) {
      removeOverlay();
      return { ok: false, error: err?.message || String(err) };
    }

    if (token !== pageToken) {
      pipeline.stop();
      removeOverlay();
      return { ok: false, error: "Cancelled before captions loaded." };
    }
    if (!result?.ok) {
      renderCaptionFallbackChoice(
        video,
        token,
        pipeline,
        result?.error || "Could not load captions.",
        result?.diagnostics,
      );
      return { ok: true, errorCode: "missing-caption-track" };
    }

    session = {
      token,
      type: "caption",
      pipeline,
      captionTimer: null,
      lastCueIndex: -1,
      kymaKey: null,
      stream: null,
      pc: null,
      dc: null,
    };

    history = [];
    currentTargetText = "";
    currentSourceText = "";
    setStatusText(result.meta?.nativeTarget ? "Native captions" : "Caption Free");
    setOverlayState("live");
    renderCaptionTranscript(result.cues || pipeline.cues || []);
    applyTierToolbar();
    emitState({ running: true, paused: false, status: "Captioning" });

    const tick = () => {
      if (session?.type !== "caption" || session.token !== token) return;
      const current = pipeline.cueAt(video.currentTime);
      if (current.index === session.lastCueIndex) return;
      session.lastCueIndex = current.index;
      if (!current.cue) {
        currentTargetText = "";
        currentSourceText = "";
        setTargetText("");
        if (elements.source) elements.source.textContent = "";
        updateCaptionTranscriptHighlight(-1);
        return;
      }
      currentSourceText = current.cue.text;
      currentTargetText = current.cue.translated || current.cue.text;
      setTargetText(currentTargetText);
      if (elements.source && settings.showSource) {
        elements.source.textContent = currentSourceText.slice(-260);
      }
      updateCaptionTranscriptHighlight(current.index);
      if (settings.captionTtsProvider && settings.captionTtsProvider !== "off") {
        pipeline.speakCue(current.cue, {
          provider: settings.captionTtsProvider,
          targetLanguage: settings.targetLanguage || "vi",
          googleCloudKey: settings.googleCloudKey,
          rate: settings.ttsRate || 1,
        }).catch(() => {});
      }
    };
    session.captionTimer = setInterval(tick, 120);
    tick();

    onYTPause = () => {
      setStatusText("Paused");
      setOverlayState("paused");
      emitState({ paused: true, status: "Paused" });
    };
    onYTPlay = () => {
      setStatusText("Captioning");
      setOverlayState("live");
      emitState({ paused: false, status: "Captioning" });
    };
    video.addEventListener("pause", onYTPause);
    video.addEventListener("play", onYTPlay);
    return { ok: true };
  }

  async function startCaptionSonioxFallback(video, token, pipeline, reason) {
    if (!window.LumeoSonioxSTT) {
      removeOverlay();
      return { ok: false, error: "Soniox fallback service not loaded." };
    }
    setStatusText("Soniox STT");
    setOverlayState("connecting");
    showToast(reason ? `${reason} Starting Soniox fallback.` : "Starting Soniox fallback.", 5000);

    session = {
      token,
      type: "caption",
      liveStt: true,
      pipeline,
      captionTimer: null,
      lastCueIndex: -1,
      cues: [],
      tokenBuffer: [],
      kymaKey: null,
      stream: null,
      pc: null,
      dc: null,
    };
    applyTierToolbar();
    renderCaptionTranscript(session.cues);

    const flushBuffer = async () => {
      if (session?.type !== "caption" || !session.liveStt || !session.tokenBuffer.length) return;
      const sourceText = session.tokenBuffer.map((t) => t.text || "").join("").trim();
      session.tokenBuffer = [];
      if (!sourceText) return;
      const start = video.currentTime;
      const cue = { start, end: start + 4, text: sourceText, translated: "" };
      try {
        const [translated] = await window.LumeoTranslate.translateBatch([sourceText], settings.targetLanguage || "vi", {
          provider: settings.translateProvider || "google-free",
          targetLanguageName: LANG_NAME[settings.targetLanguage] || settings.targetLanguage || "Vietnamese",
          openaiKey: settings.openaiKey,
          openaiModel: settings.openaiModel,
          geminiKey: settings.geminiKey,
          geminiModel: settings.geminiModel,
          openRouterKey: settings.openRouterKey,
          openRouterModel: settings.openRouterModel,
          groqApiKey: settings.groqApiKey,
          groqModel: settings.groqModel,
          googleCloudKey: settings.googleCloudKey,
          libreTranslateUrl: settings.libreTranslateUrl,
          libreTranslateKey: settings.libreTranslateKey,
          context: settings.translationContext,
        });
        cue.translated = translated || sourceText;
      } catch {
        cue.translated = sourceText;
      }
      if (session?.type !== "caption" || !session.liveStt) return;
      cue.end = Math.max(video.currentTime, cue.start + 2);
      session.cues.push(cue);
      pipeline.cues = session.cues;
      currentSourceText = cue.text;
      currentTargetText = cue.translated;
      setTargetText(currentTargetText);
      if (elements.source && settings.showSource) elements.source.textContent = currentSourceText.slice(-260);
      renderCaptionTranscript(session.cues);
      updateCaptionTranscriptHighlight(session.cues.length - 1);
      if (settings.captionTtsProvider && settings.captionTtsProvider !== "off") {
        pipeline.speakCue(cue, {
          provider: settings.captionTtsProvider,
          targetLanguage: settings.targetLanguage || "vi",
          googleCloudKey: settings.googleCloudKey,
          rate: settings.ttsRate || 1,
        }).catch(() => {});
      }
    };

    try {
      await window.LumeoSonioxSTT.start({
        apiKey: settings.sonioxApiKey,
        onStatus: (status) => {
          setStatusText(status === "connected" ? "Soniox Live" : status || "Soniox STT");
          setOverlayState("live");
          emitState({ running: true, paused: false, status: "Captioning (STT)" });
        },
        onError: (error) => {
          setStatusText("Soniox error");
          showToast(error || "Soniox error", 7000);
          emitState({ running: false, paused: false, status: "Soniox error", errorMessage: error || "Soniox error" });
        },
        onResult: (data) => {
          if (data?.finished) {
            void flushBuffer();
            return;
          }
          const tokens = (data?.tokens || []).filter((t) => t?.text && !String(t.text).startsWith("<"));
          const finals = tokens.filter((t) => t.is_final);
          if (finals.length) session.tokenBuffer.push(...finals);
          const interim = tokens.filter((t) => !t.is_final).map((t) => t.text).join("").trim();
          const finalText = session.tokenBuffer.map((t) => t.text || "").join("").trim();
          const preview = (finalText + " " + interim).trim();
          if (preview) {
            currentSourceText = preview;
            setTargetText(preview);
            if (elements.source && settings.showSource) elements.source.textContent = preview.slice(-260);
          }
          if (/[.!?。！？]$/.test(finalText) || finalText.length > 120) {
            void flushBuffer();
          }
        },
      });
    } catch (err) {
      removeOverlay();
      return { ok: false, error: err?.message || String(err) };
    }

    setStatusText("Soniox Live");
    setOverlayState("live");
    emitState({ running: true, paused: false, status: "Captioning (STT)" });
    return { ok: true };
  }

  // ───── Start session (token-bumped on each call) ──────────────────────────
  async function startSession(incomingSettings) {
    if (session) return { ok: false, error: "Session already running." };
    settings = { ...incomingSettings };
    history = [];
    currentTargetText = "";
    currentSourceText = "";

    if (settings.tier === "caption") {
      return startCaptionSession();
    }
    if (settings.tier === "standard") {
      return startStandardSession();
    }
    if (settings.tier !== "realtime") {
      return { ok: false, error: "Unknown tier: " + settings.tier };
    }

    const video = findVideo();
    if (!video) return { ok: false, error: "No YouTube video on this page." };
    videoEl = video;

    let stream;
    try {
      buildOverlay();
      setStatusText("Acquiring audio");
      stream = await captureWithRetry(video);
    } catch (err) {
      removeOverlay();
      return { ok: false, error: err.message };
    }

    const token = ++pageToken;
    let newSession;
    try {
      newSession = await buildRealtimeSession(token, stream, {
        kymaKey: settings.kymaKey,
        targetLanguage: settings.targetLanguage,
        realtimeVoice: settings.realtimeVoice,
      });
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      removeOverlay();
      const msg = err.cta
        ? `${err.message} (${err.cta})`
        : err.message;
      return { ok: false, error: msg };
    }
    if (token !== pageToken) {
      // Stop arrived during build
      try { newSession.pc.close(); } catch {}
      removeOverlay();
      return { ok: false, error: "Cancelled before connect completed." };
    }

    session = newSession;
    applyTierToolbar();
    setStatusText("Translating");
    setOverlayState("live");
    startHeartbeat(session.kymaSessionId, session.kymaKey);
    startSessionTimer();
    applyVolumes(settings.originalVolume, settings.voiceVolume);
    applySourceVisibility();
    if (settings.showSource) startCaptionPoll();

    // Pause/play do NOT tear down the session — captureStream goes silent
    // naturally on YT pause, so OpenAI outputs silence. Resume is instant.
    onYTPause = () => {
      setStatusText("Paused");
      setOverlayState("paused");
      emitState({ paused: true, status: "Paused" });
    };
    onYTPlay = () => {
      setStatusText("Translating");
      setOverlayState("live");
      emitState({ paused: false, status: "Translating" });
    };
    video.addEventListener("pause", onYTPause);
    video.addEventListener("play", onYTPlay);

    emitState({ running: true, paused: false, status: "Translating" });
    return { ok: true };
  }

  function stopSession(reason = "stop") {
    pageToken += 1;
    clearSessionTimer();
    stopHeartbeat();
    stopCaptionPoll();
    if (videoEl) {
      if (onYTPause) videoEl.removeEventListener("pause", onYTPause);
      if (onYTPlay) videoEl.removeEventListener("play", onYTPlay);
      videoEl.muted = false;
      videoEl.volume = 1.0;
      videoEl = null;
    }
    onYTPause = null;
    onYTPlay = null;
    if (session) {
      try {
        if (session.type === "caption") {
          if (session.captionTimer) {
            clearInterval(session.captionTimer);
            session.captionTimer = null;
          }
          session.pipeline?.stop?.();
        }
        // Standard tier: halt the recorder loop so no further chunks fire,
        // and abort any in-flight whisper/translate/TTS fetch so we stop
        // burning Kyma credits the moment the user clicks Stop.
        if (session.type === "standard") {
          session.stopFlag = true;
          if (session.abortController) {
            try { session.abortController.abort(); } catch {}
          }
          if (session.activeRecorder && session.activeRecorder.state !== "inactive") {
            try { session.activeRecorder.stop(); } catch {}
          }
        }
        if (session.remoteAudio) {
          session.remoteAudio.pause();
          session.remoteAudio.srcObject = null;
          session.remoteAudio.remove();
        }
        if (session.outputGain) session.outputGain.disconnect();
        if (session.audioCtx) session.audioCtx.close();
        if (session.dc) session.dc.close();
        if (session.pc) session.pc.close();
        if (session.stream) session.stream.getTracks().forEach((t) => t.stop());
      } catch {}
      // Realtime tier holds Kyma session collateral; standard tier doesn't.
      if (session.kymaSessionId) {
        void endKymaSession(session.kymaSessionId, session.kymaKey);
      }
      session = null;
    }
    if (prevSession) {
      try { prevSession.pc?.close(); } catch {}
      void endKymaSession(prevSession.kymaSessionId, prevSession.kymaKey);
      prevSession = null;
    }
    history = [];
    currentTargetText = "";
    removeOverlay();
  }

  function applySettingsLive(newSettings) {
    const prev = settings || {};
    settings = { ...prev, ...newSettings };
    // Tier swap mid-session needs a full restart (different pipelines, can't
    // hot-swap). Surface the constraint so the user knows why their toggle
    // didn't take effect; they can press Stop then Start.
    if ("tier" in newSettings && newSettings.tier !== prev.tier && session) {
      showToast("Stop and Start to switch tiers", 5000);
    }
    if (elements.langSelect && newSettings.targetLanguage) {
      elements.langSelect.value = newSettings.targetLanguage;
    }
    // Voice select shape depends on tier — repopulate before assigning value
    // so the new id exists in the dropdown.
    if (elements.voiceSelect &&
        (newSettings.realtimeVoice !== undefined ||
         newSettings.standardVoice !== undefined ||
         newSettings.captionTtsProvider !== undefined)) {
      const tier = settings.tier || "realtime";
      populateVoicePicker(tier);
    }
    applyTierToolbar();
    if ("showSource" in newSettings) {
      applySourceVisibility();
      if (settings.showSource && session) startCaptionPoll();
      else stopCaptionPoll();
    }
    // Realtime swaps require a full session handover (new client_secret +
    // PeerConnection). Standard pipeline picks up new lang/voice on the next
    // chunk — no tear-down required.
    if (session && session.type !== "standard" && session.type !== "caption") {
      if (("targetLanguage" in newSettings && newSettings.targetLanguage !== prev.targetLanguage) ||
          ("realtimeVoice" in newSettings && newSettings.realtimeVoice !== prev.realtimeVoice)) {
        void requestHandover(newSettings);
      }
    } else if (session?.type === "caption" &&
        ("targetLanguage" in newSettings || "translateProvider" in newSettings)) {
      showToast("Stop and Start to retranslate captions", 5000);
    }
    if ("originalVolume" in newSettings || "voiceVolume" in newSettings) {
      applyVolumes(settings.originalVolume, settings.voiceVolume);
    }
  }

  // ───── SPA navigation handling ────────────────────────────────────────────
  // YT navigates internally without full page reload. Our static manifest
  // ensures content.js loads on /watch URLs, but a /watch → /watch nav
  // happens via History API. Detect URL change and stop session cleanly.
  setInterval(() => {
    if (location.href !== lastSpaUrl) {
      lastSpaUrl = location.href;
      if (session) {
        stopSession("yt-navigation");
        emitEnded("YouTube navigated.");
      }
    }
  }, 500);

  // ───── Tab unload — fire /end with keepalive ──────────────────────────────
  const handleUnload = () => {
    if (session) {
      void endKymaSession(session.kymaSessionId, session.kymaKey);
    }
  };
  window.addEventListener("beforeunload", handleUnload);
  window.addEventListener("pagehide", handleUnload);

  // ───── Background message router ──────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      switch (msg?.type) {
        case "CONTENT_PING":
          sendResponse({
            ok: true,
            version: LUMEO_VERSION,
            captionPipeline: !!window.LumeoCaptionPipeline,
            translateService: !!window.LumeoTranslate,
            captionService: !!window.LumeoCaptions,
            kymaService: !!window.LumeoKyma,
            srtService: !!window.LumeoSrtExport,
            ttsService: !!window.LumeoTTS,
            sonioxService: !!window.LumeoSonioxSTT,
          });
          break;
        case "CONTENT_START":
          sendResponse(await startSession(msg.settings || {}));
          break;
        case "CONTENT_STOP":
          stopSession("backend-stop");
          sendResponse({ ok: true });
          break;
        case "CONTENT_UPDATE_SETTINGS":
          applySettingsLive(msg.settings || {});
          sendResponse({ ok: true });
          break;
        case "CONTENT_UPDATE_VOLUME":
          settings = { ...(settings || {}), originalVolume: msg.originalVolume, voiceVolume: msg.voiceVolume };
          applyVolumes(msg.originalVolume, msg.voiceVolume);
          sendResponse({ ok: true });
          break;
        default:
          sendResponse({ ok: false, error: "Unknown content message: " + msg?.type });
      }
    })();
    return true;
  });
})();
