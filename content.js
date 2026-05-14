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
  const LUMEO_VERSION = "1.0.0";
  const GLOBAL_KEY = "__lumeoContentVersion";
  if (window[GLOBAL_KEY] === LUMEO_VERSION) return;
  // Older copy may have left UI behind; clean up before re-installing listeners.
  document.querySelectorAll(".ec-root").forEach((el) => el.remove());
  window[GLOBAL_KEY] = LUMEO_VERSION;

  // ───── Suppress YouTube Polymer insertBefore errors ───────────────────────
  // YouTube's internal framework (Polymer/lit) uses insertBefore during SPA
  // navigation. Our DOM mutations can trigger its MutationObservers, which
  // then throw NotFoundError when reference nodes have been detached. These
  // errors are harmless but pollute chrome://extensions. Swallow them.
  window.addEventListener("error", (e) => {
    if (e.error?.name === "NotFoundError" && e.error?.message?.includes("insertBefore")) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);
  window.addEventListener("unhandledrejection", (e) => {
    const err = e.reason;
    if (err?.name === "NotFoundError" && err?.message?.includes("insertBefore")) {
      e.preventDefault();
    }
  });

  // ───── Constants ──────────────────────────────────────────────────────────
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
  const STANDARD_DEFAULT_VOICE = window.LumeoVoicePicker?.STANDARD_DEFAULT_VOICE || "English_magnetic_voiced_man";
  const browserApi = window.LumeoBrowserApi;

  function getYouTubeVideoId() {
    try { return new URL(location.href).searchParams.get("v") || null; } catch { return null; }
  }

  function getYouTubeChannelId() {
    const canonical = document.querySelector('link[rel="canonical"]')?.href || "";
    const channelMatch = canonical.match(/youtube\.com\/channel\/([^/?#]+)/i)
      || location.pathname.match(/^\/(?:channel|c|user|@)([^/?#]+)/i);
    return channelMatch?.[1] || null;
  }

  function getOverlayLayoutKey() {
    const videoId = getYouTubeVideoId();
    if (videoId) return `${LAYOUT_KEY}:video:${videoId}`;
    const channelId = getYouTubeChannelId();
    return channelId ? `${LAYOUT_KEY}:channel:${channelId}` : LAYOUT_KEY;
  }

  // Standard pipeline tunables. CHUNK_MS too short = wasteful per-call
  // overhead; too long = unbearable lag. 5s is the sweet spot for podcast/
  // keynote speech where sentences average 3-6s.
  const STANDARD_CHUNK_MS = window.LumeoStandardPipeline?.DEFAULT_CHUNK_MS || 5000;

  // ───── F6 — Token-guarded session state ───────────────────────────────────
  // Every async callback that could mutate session state captures `pageToken`
  // in closure and checks `if (token !== pageToken) return` before mutating.
  // Each new session bumps pageToken so stale callbacks are silently dropped.
  let pageToken = 0;
  let session = null;     // active session
  let prevSession = null; // held during handover until new is fully ready
  let settings = null;
  let currentTargetText = "";
  let currentSourceText = "";
  let lastDisplayedCue = null;
  let captionPollTimer = null;
  let heartbeatTimer = null;
  let warningTimer = null;
  let limitTimer = null;
  let warningShown = false;
  let videoEl = null;
  let onYTPause = null;
  let onYTPlay = null;
  let lastSpaUrl = location.href;
  let captionStyle = loadCaptionStyle();

  // ───── Background channel ─────────────────────────────────────────────────
  function notifyBackground(msg) {
    browserApi.sendRuntimeMessage(msg).catch(() => {});
  }
  function emitState(partial) {
    notifyBackground({ type: "CONTENT_STATE", ...partial });
  }
  function emitEnded(reason) {
    notifyBackground({ type: "CONTENT_ENDED", reason });
  }

  // ───── F1 — Overlay panel ─────────────────────────────────────────────────
  function createInlineOverlayController(options = {}) {
    const doc = options.document || document;
    const languages = options.languages || [];
    let inlineRoot = null;
    let inlineElements = {};

    function build() {
      if (inlineRoot) return inlineRoot;
      inlineRoot = doc.createElement("aside");
      inlineRoot.className = "ec-root is-side-collapsed";
      inlineRoot.dataset.state = "ready";
      inlineRoot.innerHTML = `
        <div class="ec-toolbar" data-ec-drag>
          <span class="ec-dot"></span>
          <select class="ec-select" data-ec-language aria-label="Target language"></select>
          <span class="ec-toolbar-cap" data-ec-tts-cap hidden>Speech</span>
          <select class="ec-select" data-ec-voice aria-label="Voice"></select>
          <span class="ec-spacer"></span>
          <button class="ec-btn" type="button" data-ec-pip aria-label="Toggle Picture-in-Picture subtitles" title="Picture-in-Picture subtitles">PiP</button>
          <button class="ec-btn" type="button" data-ec-settings title="Settings">⚙️</button>
          <button class="ec-btn" type="button" data-ec-help aria-label="Keyboard shortcuts" title="Keyboard shortcuts (? or h)">?</button>
          <button class="ec-btn" type="button" data-ec-hide title="Show Lumeo controls">Show</button>
          <button class="ec-btn ec-btn-primary" type="button" data-ec-stop>Stop</button>
        </div>
        <div class="ec-style-popover" data-ec-settings-panel hidden>
          <label><span>Size</span> <input type="range" data-ec-style-size min="12" max="36" step="1"><output data-ec-style-size-value></output></label>
          <label><span>Pos</span> <input type="range" data-ec-style-position min="0" max="80" step="1"><output data-ec-style-position-value></output></label>
          <label class="ec-style-field-select"><span>Preset</span><select class="ec-select" data-ec-layout-preset><option value="stacked">Stacked (Sub+Source)</option><option value="translated-only">Translated only</option><option value="source-only">Source only</option></select></label>
          <label><span>Orig Vol</span><input type="range" data-ec-original-volume min="0" max="100" step="1"><output data-ec-original-volume-value></output></label>
          <label><span>Voice Vol</span><input type="range" data-ec-voice-volume min="0" max="100" step="1"><output data-ec-voice-volume-value></output></label>
          <label><span>Mute Orig.</span><input type="checkbox" data-ec-mute-original></label>
          <label><span>Show Trans.</span><input type="checkbox" data-ec-show-translated></label>
          <label><span>Show Source</span><input type="checkbox" data-ec-show-source></label>
          <label><span>Contrast</span><input type="checkbox" data-ec-high-contrast></label>
        </div>
      `;
      doc.documentElement.appendChild(inlineRoot);
      inlineElements = {
        langSelect: inlineRoot.querySelector("[data-ec-language]"),
        voiceSelect: inlineRoot.querySelector("[data-ec-voice]"),
        ttsCap: inlineRoot.querySelector("[data-ec-tts-cap]"),
        hideBtn: inlineRoot.querySelector("[data-ec-hide]"),
        stopBtn: inlineRoot.querySelector("[data-ec-stop]"),
        pipBtn: inlineRoot.querySelector("[data-ec-pip]"),
        helpBtn: inlineRoot.querySelector("[data-ec-help]"),
        settingsBtn: inlineRoot.querySelector("[data-ec-settings]"),
        settingsPanel: inlineRoot.querySelector("[data-ec-settings-panel]"),
        styleSize: inlineRoot.querySelector("[data-ec-style-size]"),
        styleSizeValue: inlineRoot.querySelector("[data-ec-style-size-value]"),
        stylePosition: inlineRoot.querySelector("[data-ec-style-position]"),
        stylePositionValue: inlineRoot.querySelector("[data-ec-style-position-value]"),
        layoutPreset: inlineRoot.querySelector("[data-ec-layout-preset]"),
        highContrast: inlineRoot.querySelector("[data-ec-high-contrast]"),
        originalVolume: inlineRoot.querySelector("[data-ec-original-volume]"),
        originalVolumeValue: inlineRoot.querySelector("[data-ec-original-volume-value]"),
        voiceVolume: inlineRoot.querySelector("[data-ec-voice-volume]"),
        voiceVolumeValue: inlineRoot.querySelector("[data-ec-voice-volume-value]"),
        muteOriginal: inlineRoot.querySelector("[data-ec-mute-original]"),
        showTranslated: inlineRoot.querySelector("[data-ec-show-translated]"),
        showSource: inlineRoot.querySelector("[data-ec-show-source]"),
        target: null,
        source: null,
        history: null,
      };
      for (const [code, name] of languages) {
        const opt = doc.createElement("option");
        opt.value = code;
        opt.textContent = name;
        inlineElements.langSelect?.appendChild(opt);
      }
      inlineElements.settingsBtn?.addEventListener("click", () => {
        if (inlineElements.settingsPanel) inlineElements.settingsPanel.hidden = !inlineElements.settingsPanel.hidden;
      });
      inlineElements.helpBtn?.addEventListener("click", () => showToast("Shortcuts: Esc collapse, ?/h help, Ctrl/Cmd+Shift+L show/hide", 6000));
      inlineElements.hideBtn?.addEventListener("click", () => toggleSideCollapsed());
      return inlineRoot;
    }

    function destroy() {
      inlineRoot?.remove();
      inlineRoot = null;
      inlineElements = {};
    }

    function toggleSideCollapsed() {
      if (!inlineRoot) return;
      inlineRoot.classList.toggle("is-side-collapsed");
      const collapsed = inlineRoot.classList.contains("is-side-collapsed");
      if (inlineElements.hideBtn) {
        inlineElements.hideBtn.textContent = collapsed ? "Show" : "Hide";
        inlineElements.hideBtn.title = collapsed ? "Show Lumeo controls" : "Hide Lumeo controls";
      }
    }

    function showToast(text, opts, durationMs) {
      if (!inlineRoot) return;
      if (typeof opts === "number") durationMs = opts;
      const toast = doc.createElement("div");
      toast.className = "ec-toast";
      toast.textContent = String(text || "");
      inlineRoot.appendChild(toast);
      setTimeout(() => toast.remove(), durationMs || 8000);
    }

    return {
      build,
      destroy,
      getRoot: () => inlineRoot,
      getElements: () => inlineElements,
      applyLayout: () => {},
      refreshLayoutKey: () => {},
      applyCaptionStyle: () => {},
      syncCaptionControls: (captionStyle = {}) => {
        if (inlineElements.styleSize) inlineElements.styleSize.value = String(captionStyle.fontSize || 22);
        if (inlineElements.styleSizeValue) inlineElements.styleSizeValue.value = `${captionStyle.fontSize || 22}px`;
        if (inlineElements.stylePosition) inlineElements.stylePosition.value = String(captionStyle.bottomOffset || 14);
        if (inlineElements.stylePositionValue) inlineElements.stylePositionValue.value = `${captionStyle.bottomOffset || 14}%`;
        if (inlineElements.highContrast) inlineElements.highContrast.checked = !!captionStyle.highContrast;
        if (inlineElements.layoutPreset) inlineElements.layoutPreset.value = captionStyle.layoutPreset || "stacked";
        if (inlineElements.originalVolume) inlineElements.originalVolume.value = String(captionStyle.originalVolume ?? 18);
        if (inlineElements.originalVolumeValue) inlineElements.originalVolumeValue.value = String(captionStyle.originalVolume ?? 18);
        if (inlineElements.voiceVolume) inlineElements.voiceVolume.value = String(captionStyle.voiceVolume ?? 100);
        if (inlineElements.voiceVolumeValue) inlineElements.voiceVolumeValue.value = String(captionStyle.voiceVolume ?? 100);
        if (inlineElements.muteOriginal) inlineElements.muteOriginal.checked = !!captionStyle.muteOriginal;
        if (inlineElements.showTranslated) inlineElements.showTranslated.checked = captionStyle.showTranslatedSub !== false;
        if (inlineElements.showSource) inlineElements.showSource.checked = captionStyle.showSourceSub !== false;
      },
      setState: (state) => { if (inlineRoot) inlineRoot.dataset.state = state; },
      setStatusText: () => {},
      showToast,
      toggleSideCollapsed,
    };
  }

  const subtitleOverlay = window.LumeoSubtitleOverlay?.createSubtitleOverlayController?.();
  const overlayController = window.LumeoOverlay?.createOverlayController?.({
    layoutKey: getOverlayLayoutKey,
    languages: LANGUAGES,
    collapsedOnStart: true,
  }) || createInlineOverlayController({ languages: LANGUAGES });
  let root = null;
  let elements = {};

  function loadCaptionStyle() {
    try {
      return {
        fontSize: 22,
        bottomOffset: 14,
        highContrast: false,
        showSource: true,
        muteOriginal: false,
        originalVolume: settings?.originalVolume ?? 18,
        voiceVolume: settings?.voiceVolume ?? 100,
        showTranslatedSub: true,
        showSourceSub: true,
        layoutPreset: "stacked",
        ...JSON.parse(localStorage.getItem(CAPTION_STYLE_KEY) || "{}"),
      };
    } catch {
      return { fontSize: 22, bottomOffset: 14, highContrast: false, showSource: true, muteOriginal: false, showTranslatedSub: true, showSourceSub: true, layoutPreset: "stacked" };
    }
  }
  function saveCaptionStyle() {
    try { localStorage.setItem(CAPTION_STYLE_KEY, JSON.stringify(captionStyle)); } catch {}
  }
  function applyLayoutPreset(preset) {
    captionStyle.layoutPreset = preset || "stacked";
    if (captionStyle.layoutPreset === "translated-only") {
      captionStyle.showTranslatedSub = true;
      captionStyle.showSourceSub = false;
      captionStyle.showSource = false;
    } else if (captionStyle.layoutPreset === "source-only") {
      captionStyle.showTranslatedSub = false;
      captionStyle.showSourceSub = true;
      captionStyle.showSource = true;
    } else {
      captionStyle.showTranslatedSub = true;
      captionStyle.showSourceSub = true;
      captionStyle.showSource = true;
    }
  }
  function applyCaptionStyle() {
    if (!root) return;
    overlayController?.applyCaptionStyle(captionStyle);
    subtitleOverlay?.applyStyle(captionStyle);
    const video = videoEl || findVideo();
    if (video) video.muted = !!captionStyle.muteOriginal;
  }

  function buildOverlay() {
    if (root) return;
    if (!overlayController) throw new Error("LumeoOverlay module not loaded");
    root = overlayController.build();
    elements = overlayController.getElements();

    populateVoicePicker(settings?.tier || "realtime");
    elements.langSelect.value = settings?.targetLanguage || "vi";

    elements.langSelect.addEventListener("change", () => {
      const newLang = elements.langSelect.value;
      if (settings?.tier === "caption") {
        settings.targetLanguage = newLang;
        notifyBackground({ type: "UPDATE_SETTINGS", settings: { targetLanguage: newLang } });
        showToast("Stop and Start to retranslate captions", 5000);
      } else if (settings?.tier === "standard") {
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
    elements.hideBtn.addEventListener("click", () => overlayController.toggleSideCollapsed());
    elements.stopBtn.addEventListener("click", () => {
      stopSession("user-stop");
      notifyBackground({ type: "CONTENT_STATE", running: false, status: "Stopped" });
      emitEnded("Stopped");
    });
    elements.pipBtn?.addEventListener("click", async () => {
      const result = await subtitleOverlay?.togglePictureInPicture?.();
      if (!result?.ok) {
        showToast("PiP subtitles require Chrome Document Picture-in-Picture support", 5000);
        return;
      }
      showToast(result.open ? "PiP subtitles on" : "PiP subtitles off", 2000);
    });
    elements.originalVolume?.addEventListener("input", () => {
      const value = Number(elements.originalVolume.value);
      captionStyle.originalVolume = value;
      settings = { ...(settings || {}), originalVolume: value };
      saveCaptionStyle();
      overlayController.syncCaptionControls(captionStyle);
      applyVolumes(settings.originalVolume, settings.voiceVolume);
      notifyBackground({ type: "UPDATE_SETTINGS", settings: { originalVolume: value } });
    });
    elements.voiceVolume?.addEventListener("input", () => {
      const value = Number(elements.voiceVolume.value);
      captionStyle.voiceVolume = value;
      settings = { ...(settings || {}), voiceVolume: value };
      saveCaptionStyle();
      overlayController.syncCaptionControls(captionStyle);
      applyVolumes(settings.originalVolume, settings.voiceVolume);
      notifyBackground({ type: "UPDATE_SETTINGS", settings: { voiceVolume: value } });
    });
    elements.muteOriginal?.addEventListener("change", () => {
      captionStyle.muteOriginal = elements.muteOriginal.checked;
      settings = { ...(settings || {}), originalVolume: captionStyle.muteOriginal ? 0 : (captionStyle.originalVolume || 18) };
      saveCaptionStyle();
      applyCaptionStyle();
      applyVolumes(settings.originalVolume, settings.voiceVolume);
      notifyBackground({ type: "UPDATE_SETTINGS", settings: { originalVolume: settings.originalVolume } });
    });
    elements.showTranslated?.addEventListener("change", () => {
      captionStyle.showTranslatedSub = elements.showTranslated.checked;
      saveCaptionStyle();
      applyCaptionStyle();
    });
    elements.showSource?.addEventListener("change", () => {
      captionStyle.showSourceSub = elements.showSource.checked;
      captionStyle.showSource = elements.showSource.checked;
      saveCaptionStyle();
      applyCaptionStyle();
    });
    elements.styleSize?.addEventListener("input", () => {
      captionStyle.fontSize = Number(elements.styleSize.value);
      saveCaptionStyle();
      overlayController.syncCaptionControls(captionStyle);
      applyCaptionStyle();
    });
    elements.stylePosition?.addEventListener("input", () => {
      captionStyle.bottomOffset = Number(elements.stylePosition.value);
      saveCaptionStyle();
      overlayController.syncCaptionControls(captionStyle);
      applyCaptionStyle();
    });
    elements.layoutPreset?.addEventListener("change", () => {
      applyLayoutPreset(elements.layoutPreset.value);
      saveCaptionStyle();
      overlayController.syncCaptionControls(captionStyle);
      applyCaptionStyle();
      setTargetCue(lastDisplayedCue);
    });
    elements.highContrast?.addEventListener("change", () => {
      captionStyle.highContrast = elements.highContrast.checked;
      saveCaptionStyle();
      applyCaptionStyle();
    });

    captionStyle.originalVolume = settings?.originalVolume ?? captionStyle.originalVolume ?? 18;
    captionStyle.voiceVolume = settings?.voiceVolume ?? captionStyle.voiceVolume ?? 100;
    captionStyle.muteOriginal = (settings?.originalVolume ?? captionStyle.originalVolume) === 0 || !!captionStyle.muteOriginal;

    if (elements.pipBtn && !subtitleOverlay?.isPictureInPictureSupported?.()) {
      elements.pipBtn.setAttribute("aria-disabled", "true");
      elements.pipBtn.title = "PiP subtitles unsupported in this browser";
    }
    overlayController.syncCaptionControls(captionStyle);
    applyCaptionStyle();
  }

  function applyTierToolbar() {
    if (elements.exportBtn) elements.exportBtn.hidden = !session;
    if (elements.ttsCap) elements.ttsCap.hidden = settings?.tier !== "caption";
  }

  function populateVoicePicker(tier) {
    window.LumeoVoicePicker?.populate(elements.voiceSelect, tier, settings || {});
  }

  function setOverlayState(state) {
    overlayController?.setState(state);
  }
  function setStatusText(text) {
    overlayController?.setStatusText(text);
  }
  function setTargetText(text) {
    const value = text == null ? "" : String(text);
    if (elements.target) {
      elements.target.textContent = value;
      const lang = settings?.targetLanguage;
      elements.target.dir = RTL_LANGS.has(lang) ? "rtl" : "ltr";
    }
    subtitleOverlay?.updateCue(value ? { text: value, translated: value } : null, {
      captionStyle,
      targetLanguage: settings?.targetLanguage,
      rtlLangs: RTL_LANGS,
    });
  }
  /**
   * Show a cue as a proper bilingual subtitle pair:
   *   Line 1 (bold): translated text
   *   Line 2 (dim):  original source text (if showSource enabled)
   * Updates BOTH the panel target and the in-video subtitle overlay.
   */
  function setTargetCue(cue) {
    lastDisplayedCue = cue || null;
    // Update the side panel target
    if (elements.target) {
      elements.target.textContent = "";
      if (cue) {
        if (captionStyle.layoutPreset !== "source-only") {
          const translated = document.createElement("div");
          translated.className = "ec-target-translated";
          translated.textContent = cue.translated || cue.text || "";
          elements.target.appendChild(translated);
        }
        if (captionStyle.showSource !== false && captionStyle.layoutPreset !== "translated-only" && cue.text && cue.text !== cue.translated) {
          const source = document.createElement("div");
          source.className = "ec-target-source";
          source.textContent = cue.text;
          elements.target.appendChild(source);
        }
        const lang = settings?.targetLanguage;
        elements.target.dir = RTL_LANGS.has(lang) ? "rtl" : "ltr";
      }
    }
    subtitleOverlay?.updateCue(cue, {
      captionStyle,
      targetLanguage: settings?.targetLanguage,
      rtlLangs: RTL_LANGS,
    });
  }
  function showToast(text, opts, durationMs) {
    overlayController?.showToast(text, opts, durationMs);
  }
  function removeOverlay() {
    if (!root) return;
    overlayController?.destroy();
    root = null;
    elements = {};
    subtitleOverlay?.remove();
  }

  // ───── F3 — Source caption polling ────────────────────────────────────────
  let lastSeenCaption = "";
  const readYTCaptions = window.LumeoCaptions?.readYTCaptions || (() => "");
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
  // Audio helpers live in lib/audio-utils.js so the Standard pipeline and
  // the Groq/OpenAI direct pipelines can reuse them. We keep local aliases
  // so the rest of this file reads the same as before the split.
  const _audioUtils = window.LumeoAudioUtils;
  if (!_audioUtils) {
    console.error("[Lumeo] lib/audio-utils.js not loaded — aborting.");
    return;
  }
  const findVideo = _audioUtils.findVideo;
  const nudgePlay = _audioUtils.nudgePlay;
  const captureWithRetry = _audioUtils.captureWithRetry;
  const _kyma = window.LumeoKyma;
  if (!_kyma) {
    console.error("[Lumeo] services/kyma-client.js not loaded — aborting.");
    return;
  }

  // ───── Heartbeat + session timer (60-min cap, one-shot 55-min warning) ────
  function startHeartbeat(kymaSessionId, kymaKey) {
    stopHeartbeat();
    if (!kymaSessionId || !kymaKey) return;
    heartbeatTimer = setInterval(() => {
      if (!session) return;
      void _kyma.heartbeat(kymaSessionId, kymaKey);
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

  // ───── Session core (build PeerConnection through Kyma → OpenAI) ─────────
  async function buildRealtimeSession(token, audioStream, opts) {
      return window.LumeoRealtimePipeline.buildSession({
        token: token,
        audioStream: audioStream,
        kymaKey: opts.kymaKey,
        targetLanguage: opts.targetLanguage || "vi",
        realtimeVoice: opts.realtimeVoice || "",
        kyma: _kyma,
        isFresh: () => token === pageToken,
        onStatus: setStatusText,
        onOverlayState: setOverlayState,
        onRealtimeEvent: handleRealtimeEvent,
        onConnectionLost: (newSession) => {
          if (newSession === session) {
            stopSession("connection-lost");
            emitEnded("Connection lost.");
          }
        },
        computeGain,
        getVoiceVolume: () => settings?.voiceVolume ?? 100,
      });
    }

  function handleRealtimeEvent(raw, token) {
    window.LumeoRealtimePipeline?.handleEvent(raw, {
      isFresh: () => !(token !== pageToken && session?.token !== token),
      currentTargetText,
      appendTargetDelta: (delta) => {
        currentTargetText += delta;
        return currentTargetText;
      },
      setTargetText,
      setOverlayState,
      setStatusText,
      pushHistoryTurn: (finalText) => {
        currentTargetText = finalText || currentTargetText;
      },
    });
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
        void _kyma.endSession(prevSession.kymaSessionId, prevSession.kymaKey);
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
    if (!settings.kymaKey) {
      return {
        ok: false,
        error: "Add your Kyma key in Standard Dub, then Start again.",
        errorCode: "missing-dub-key",
        missingProviders: ["kyma"],
        slotsMissingKeys: ["dubPipeline"],
      };
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
      return { ok: false, error: err.message || "YouTube audio cannot be captured. Click Play on the video, then retry." };
    }

    const recorderMime = window.LumeoStandardPipeline.pickRecorderMime(_audioUtils);
    if (!recorderMime) {
      stream.getTracks().forEach((t) => t.stop());
      removeOverlay();
      return { ok: false, error: "This browser cannot record YouTube audio for Standard Dub. Try Chrome/Edge, then retry." };
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

    window.LumeoStandardPipeline.runChunkLoop(newSession, {
      getActiveSession: () => session,
      isVideoPaused: () => !!videoEl?.paused,
      processChunk: (sessionRef, blob) => window.LumeoStandardPipeline.processChunk(sessionRef, blob, standardPipelineContext()),
      chunkMs: STANDARD_CHUNK_MS,
    });
    emitState({ running: true, paused: false, status: "Translating" });
    return { ok: true };
  }


  function standardPipelineContext() {
    return {
      getActiveSession: () => session,
      getPageToken: () => pageToken,
      getSettings: () => settings || {},
      langNameByCode: LANG_NAME,
      standardDefaultVoice: STANDARD_DEFAULT_VOICE,
      kymaBase: _kyma.KYMA_BASE,
      parseKymaError: _kyma.parseError,
      audioUtils: _audioUtils,
      fetch,
      FormData,
      onSourceText: (text) => {
        currentSourceText = text;
        if (elements.source && settings.showSource) elements.source.textContent = text.slice(-220);
      },
      onTargetText: (text) => {
        currentTargetText = text;
        setTargetText(text);
        setOverlayState("live");
      },
      onError: showStandardError,
      onChunkDone: () => {},
    };
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

    if (settings.tier === "caption") {
      console.log("[Lumeo] Starting caption tier, checking orchestrator...");
      if (!window.LumeoCaptionOrchestrator) {
        console.error("[Lumeo] LumeoCaptionOrchestrator not loaded!");
        return { ok: false, error: "LumeoCaptionOrchestrator not loaded" };
      }
      console.log("[Lumeo] LumeoCaptionOrchestrator found, starting...");
      videoEl = videoEl || findVideo();
      pageToken++;
      return window.LumeoCaptionOrchestrator.start({
        getSession: () => session,
        getSettings: () => settings,
        getPageToken: () => pageToken,
        getVideo: () => videoEl,
        getElements: () => elements,
        getLangName: (code) => LANG_NAME[code],
        getTranscriptController: () => null,
        applyTierToolbar,
        setStatusText,
        setOverlayState,
        showToast,
        setTargetCue,
        setTargetText,
        applySourceVisibility,
        removeOverlay,
        buildOverlay,
        captureWithRetry,
        readYTCaptions,
        onSessionCreated: (newSession) => { session = newSession; },
        onSessionEnded: (reason, msg) => { stopSession(reason); emitEnded(msg || reason); },
        onStateChange: (partial) => { emitState(partial); },
        onUpdateSettings: (newSettings) => { notifyBackground({ type: "UPDATE_SETTINGS", settings: newSettings }); },
        onOpenPopup: (slot) => { notifyBackground({ type: "OPEN_POPUP_TO_SLOT", slot }); },
        onSwitchToStandard: async (pipeline) => {
          pipeline?.stop?.();
          session = null;
          settings = { ...settings, tier: "standard" };
          notifyBackground({ type: "UPDATE_SETTINGS", settings: { tier: "standard" } });
          const reply = await startStandardSession();
          if (!reply?.ok) {
            showToast(reply?.error || "Could not start Standard Dub.", 7000);
            emitState({ running: false, status: "Standard error", errorMessage: reply?.error || "Standard error" });
          }
        },
        setCurrentTexts: (source, target) => { currentSourceText = source; currentTargetText = target; },
        getCurrentTexts: () => ({ source: currentSourceText, target: currentTargetText }),
        setYTPauseHandler: (handler) => { 
          onYTPause = handler; 
          if(videoEl) videoEl.addEventListener("pause", onYTPause); 
        },
        setYTPlayHandler: (handler) => { 
          onYTPlay = handler; 
          if(videoEl) videoEl.addEventListener("play", onYTPlay); 
        }
      });
    }
    if (settings.tier === "standard") {
      return startStandardSession();
    }
    if (settings.tier !== "realtime") {
      return { ok: false, error: "Unknown tier: " + settings.tier };
    }
    if (!settings.kymaKey) {
      return {
        ok: false,
        error: "Add your Kyma key in Realtime Bridge, then Start again.",
        errorCode: "missing-realtime-key",
        missingProviders: ["kyma-realtime"],
        slotsMissingKeys: ["realtimeBridge"],
      };
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
      return { ok: false, error: err.message || "YouTube audio cannot be captured. Click Play on the video, then retry." };
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
          session.sttLoop?.stop?.();
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
        void _kyma.endSession(session.kymaSessionId, session.kymaKey);
      }
      session = null;
    }
    if (prevSession) {
      try { prevSession.pc?.close(); } catch {}
      void _kyma.endSession(prevSession.kymaSessionId, prevSession.kymaKey);
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
      overlayController?.refreshLayoutKey?.();
      if (session) {
        stopSession("yt-navigation");
        emitEnded("YouTube navigated.");
      }
    }
  }, 500);

  // ───── Tab unload — fire /end with keepalive ──────────────────────────────
  const handleUnload = () => {
    if (session) {
      void _kyma.endSession(session.kymaSessionId, session.kymaKey);
    }
  };
  window.addEventListener("beforeunload", handleUnload);
  window.addEventListener("pagehide", handleUnload);

  // ───── Background message router ──────────────────────────────────────────
  browserApi.addRuntimeMessageListener((msg, sender, sendResponse) => {
    (async () => {
      switch (msg?.type) {
        case "CONTENT_PING":
          sendResponse({
            ok: true,
            version: LUMEO_VERSION,
            browserApi: !!window.LumeoBrowserApi,
            captionPipeline: !!window.LumeoCaptionPipeline,
            realtimePipeline: !!window.LumeoRealtimePipeline,
            standardPipeline: !!window.LumeoStandardPipeline,
            translateService: !!window.LumeoTranslate,
            captionService: !!window.LumeoCaptions,
            kymaService: !!window.LumeoKyma,
            srtService: !!window.LumeoSrtExport,
            ttsService: !!window.LumeoTTS,
            sonioxService: !!window.LumeoSonioxSTT,
            audioUtils: !!window.LumeoAudioUtils,
            tokenGuard: !!window.LumeoTokenGuard,
            groqService: !!window.LumeoGroqSTT,
            openaiTts: !!window.LumeoOpenAITTS,
            overlayModule: !!window.LumeoOverlay,
            subtitleOverlayModule: !!window.LumeoSubtitleOverlay,
            captionFallbackChoice: !!window.LumeoCaptionFallbackChoice,
            captionOrchestrator: !!window.LumeoCaptionOrchestrator,
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
