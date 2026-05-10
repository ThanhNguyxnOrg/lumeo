// Lumen Subtitle Studio content script — owns WebRTC PeerConnection lifecycle,
// the in-page overlay panel, and YT video element capture. Background tells us
// when to start/stop/update; we tell background what's happening via
// CONTENT_STATE. Caption tier (free YouTube subtitle translation) lives
// alongside the Standard / Realtime audio-dubbing pipelines inherited from the
// Echoly v0.2.1 baseline (see CHANGELOG for the v2 merge history).
//
// Layered: F9 version guard, F6 token-guarded async, F5 captureStream retry,
// F1 overlay panel, F2 history, F3 source captions, F4 handover.

(() => {
  // ───── F9 — Idempotent version guard ──────────────────────────────────────
  const LUMEN_VERSION = "2.0.0-beta.1";
  const GLOBAL_KEY = "__lumenContentVersion";
  if (window[GLOBAL_KEY] === LUMEN_VERSION) return;
  // Older copy may have left UI behind; clean up before re-installing listeners.
  document.querySelectorAll(".ec-root").forEach((el) => el.remove());
  window[GLOBAL_KEY] = LUMEN_VERSION;

  // ───── Constants ──────────────────────────────────────────────────────────
  const KYMA_BASE = "https://api.kymaapi.com/v1";
  const OPENAI_CALLS_URL = "https://api.openai.com/v1/realtime/translations/calls";
  const SESSION_LIMIT_MS = 60 * 60 * 1000;
  const SESSION_WARNING_MS = 55 * 60 * 1000;
  const HEARTBEAT_MS = 30_000;
  const CAPTION_POLL_MS = 350;
  const HISTORY_MAX = 16;
  const VOICE_GAIN_MAX = 2.0;          // unity at slider 50, 2× boost at 100
  const LAYOUT_KEY = "lumenOverlayLayout";
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
          <span class="ec-wordmark">Lumen</span>
          <span class="ec-state" data-ec-status>Ready</span>
        </span>
        <span class="ec-spacer"></span>
        <select class="ec-select" data-ec-language aria-label="Target language"></select>
        <select class="ec-select" data-ec-voice aria-label="Voice"></select>
        <button class="ec-btn" type="button" data-ec-hide>Hide</button>
        <button class="ec-btn ec-btn-primary" type="button" data-ec-stop>Stop</button>
      </div>
      <div class="ec-body">
        <div class="ec-main">
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
      hideBtn: root.querySelector("[data-ec-hide]"),
      stopBtn: root.querySelector("[data-ec-stop]"),
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
      if (settings?.tier === "standard") {
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
      if (settings?.tier === "standard") {
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

    bindDragResize();
    applyLayout();

    window.addEventListener("resize", applyLayout);
  }

  // Tier-aware voice list rebuild. Realtime exposes 9 OpenAI voices + Auto;
  // Standard exposes 5 curated Minimax voices. Called from buildOverlay and
  // on tier change so the dropdown matches the active pipeline.
  function populateVoicePicker(tier) {
    if (!elements.voiceSelect) return;
    elements.voiceSelect.replaceChildren();
    if (tier === "standard") {
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

  // ───── Start session (token-bumped on each call) ──────────────────────────
  async function startSession(incomingSettings) {
    if (session) return { ok: false, error: "Session already running." };
    settings = { ...incomingSettings };
    history = [];
    currentTargetText = "";
    currentSourceText = "";

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
        (newSettings.realtimeVoice !== undefined || newSettings.standardVoice !== undefined)) {
      const tier = settings.tier || "realtime";
      populateVoicePicker(tier);
    }
    if ("showSource" in newSettings) {
      applySourceVisibility();
      if (settings.showSource && session) startCaptionPoll();
      else stopCaptionPoll();
    }
    // Realtime swaps require a full session handover (new client_secret +
    // PeerConnection). Standard pipeline picks up new lang/voice on the next
    // chunk — no tear-down required.
    if (session?.type !== "standard") {
      if (("targetLanguage" in newSettings && newSettings.targetLanguage !== prev.targetLanguage) ||
          ("realtimeVoice" in newSettings && newSettings.realtimeVoice !== prev.realtimeVoice)) {
        void requestHandover(newSettings);
      }
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
          sendResponse({ ok: true, version: LUMEN_VERSION });
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
