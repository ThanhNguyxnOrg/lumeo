(() => {
  "use strict";

  const LUMEO_VERSION = "2.0.0";
  const GLOBAL_KEY = "__lumeoContentVersion";
  if (window[GLOBAL_KEY] === LUMEO_VERSION) return;
  document.querySelectorAll(".ec-root").forEach((el) => el.remove());
  window[GLOBAL_KEY] = LUMEO_VERSION;

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

  const CAPTION_POLL_MS = 350;
  const LAYOUT_KEY = "lumeoOverlayLayout";
  const CAPTION_STYLE_KEY = "lumeoCaptionStyle";
  const RTL_LANGS = new Set(["ar", "fa", "he", "ur"]);

  const LANGUAGES = [
    ["vi", "Vietnamese"], ["en", "English"], ["ja", "Japanese"],
    ["ko", "Korean"], ["zh", "Chinese"], ["fr", "French"],
    ["es", "Spanish"], ["de", "German"], ["pt", "Portuguese"],
    ["hi", "Hindi"], ["id", "Indonesian"], ["it", "Italian"],
    ["ru", "Russian"],
  ];
  const LANG_NAME = Object.fromEntries(LANGUAGES);
  const browserApi = window.LumeoBrowserApi;

  function getYouTubeVideoId() {
    if (window.LumeoPlatformAdapters) {
      return window.LumeoPlatformAdapters.getAdapter().getVideoId();
    }
    try {
      const parsed = new URL(location.href);
      return parsed.searchParams.get("v") || parsed.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/)?.[1] || null;
    } catch { return null; }
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

  function notifyBackground(msg) {
    browserApi.sendRuntimeMessage(msg).catch(() => {});
  }
  function emitState(partial) {
    notifyBackground({ type: "CONTENT_STATE", ...partial });
  }
  function emitEnded(reason) {
    notifyBackground({ type: "CONTENT_ENDED", reason });
  }

  const LumeoSessionManager = window.LumeoSessionManager;
  const subtitleOverlay = window.LumeoSubtitleOverlay?.createSubtitleOverlayController?.();
  const transcriptController = window.LumeoTranscript?.createTranscriptController?.({
    onSeek: (seconds) => {
      const v = findVideo ? findVideo() : document.querySelector("video");
      if (v) v.currentTime = seconds;
    },
  });
  const overlayController = window.LumeoOverlay?.createOverlayController?.({
    layoutKey: getOverlayLayoutKey,
    languages: LANGUAGES,
    collapsedOnStart: false,
    onButtonClick: async () => {
      buildOverlay();
      const open = overlayController.isOpen?.();
      if (open) {
        overlayController.toggleSideCollapsed(true);
      } else {
        overlayController.toggleSideCollapsed(false);
        if (!LumeoSessionManager.getSession()) {
          const stored = await browserApi.sendRuntimeMessage({ type: "GET_STATE" }).catch(() => null);
          const currentSettings = stored?.state || { tier: "caption", targetLanguage: "vi", translateProvider: "google-free" };
          browserApi.sendRuntimeMessage({ type: "START", settings: currentSettings }).catch(() => {});
        }
      }
    },
  });
  overlayController?.ensureYouTubeControlButton?.();

  let root = null;
  let elements = {};
  let settings = null;
  let currentTargetText = "";
  let currentSourceText = "";
  let lastDisplayedCue = null;
  let captionPollTimer = null;
  let lastSpaUrl = location.href;
  let captionStyle = loadCaptionStyle();

  const findVideo = window.LumeoAudioUtils?.findVideo;
  const readYTCaptions = window.LumeoCaptions?.readYTCaptions || (() => "");

  function loadCaptionStyle() {
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
      subtitleOrder: "translation-top",
      subBackgroundOpacity: 0.92,
      subShadowStyle: "drop",
    };
  }

  // Load from chrome.storage.local on startup
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.get([
        "fontSize", "bottomOffset", "highContrast", "layoutPreset",
        "subtitleOrder", "subBackgroundOpacity", "subShadowStyle",
        "originalVolume", "voiceVolume", "muteOriginal"
      ], (res) => {
        if (res) {
          captionStyle = { ...captionStyle, ...res };
          applyCaptionStyle();
        }
      });

      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local") {
          const updated = {};
          const keys = [
            "fontSize", "bottomOffset", "highContrast", "layoutPreset",
            "subtitleOrder", "subBackgroundOpacity", "subShadowStyle",
            "originalVolume", "voiceVolume", "muteOriginal"
          ];
          for (const key of keys) {
            if (changes[key] !== undefined) updated[key] = changes[key].newValue;
          }
          if (Object.keys(updated).length > 0) {
            captionStyle = { ...captionStyle, ...updated };
            applyCaptionStyle();
            if (lastDisplayedCue) setTargetCue(lastDisplayedCue);
          }
        }
      });
    }
  } catch {}

  function saveCaptionStyle() {
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.set({
          fontSize: captionStyle.fontSize,
          bottomOffset: captionStyle.bottomOffset,
          highContrast: captionStyle.highContrast,
          layoutPreset: captionStyle.layoutPreset,
          subtitleOrder: captionStyle.subtitleOrder,
          subBackgroundOpacity: captionStyle.subBackgroundOpacity,
          subShadowStyle: captionStyle.subShadowStyle,
          originalVolume: captionStyle.originalVolume,
          voiceVolume: captionStyle.voiceVolume,
          muteOriginal: captionStyle.muteOriginal,
        });
      }
    } catch {}
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
    overlayController?.applyCaptionStyle(captionStyle);
    subtitleOverlay?.applyStyle(captionStyle);
    const video = LumeoSessionManager.getVideoEl() || findVideo?.();
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
        showToast("Stop and restart translation to apply the new target language", 5000);
      } else if (settings?.tier === "standard") {
        settings.targetLanguage = newLang;
        notifyBackground({ type: "UPDATE_SETTINGS", settings: { targetLanguage: newLang } });
        setStatusText("Switching to " + (LANG_NAME[newLang] || newLang));
        setOverlayState("live");
      } else {
        LumeoSessionManager.requestHandover({ targetLanguage: newLang });
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
        LumeoSessionManager.requestHandover({ realtimeVoice: newVoice });
      }
    });

    elements.stopBtn.addEventListener("click", () => {
      LumeoSessionManager.stopSession("user-stop");
      notifyBackground({ type: "CONTENT_STATE", running: false, status: "Stopped" });
      emitEnded("Stopped");
    });

    elements.pipBtn?.addEventListener("click", async () => {
      const result = await subtitleOverlay?.togglePictureInPicture?.();
      if (!result?.ok) {
        showToast("PiP subtitles require Document PiP support in Chrome", 5000);
        return;
      }
      showToast(result.open ? "PiP subtitles enabled" : "PiP subtitles disabled", 2000);
    });

    document.addEventListener("lumeopipopened", () => {
      elements.pipBtn?.classList.add("is-active");
    });
    document.addEventListener("lumeopipclosed", () => {
      elements.pipBtn?.classList.remove("is-active");
    });

    elements.transcriptBtn?.addEventListener("click", () => {
      transcriptController?.toggle();
    });

    elements.originalVolume?.addEventListener("input", () => {
      const value = Number(elements.originalVolume.value);
      captionStyle.originalVolume = value;
      settings = { ...(settings || {}), originalVolume: value };
      saveCaptionStyle();
      overlayController.syncCaptionControls(captionStyle);
      LumeoSessionManager.applyVolumes(settings.originalVolume, settings.voiceVolume);
      notifyBackground({ type: "UPDATE_SETTINGS", settings: { originalVolume: value } });
    });

    elements.voiceVolume?.addEventListener("input", () => {
      const value = Number(elements.voiceVolume.value);
      captionStyle.voiceVolume = value;
      settings = { ...(settings || {}), voiceVolume: value };
      saveCaptionStyle();
      overlayController.syncCaptionControls(captionStyle);
      LumeoSessionManager.applyVolumes(settings.originalVolume, settings.voiceVolume);
      notifyBackground({ type: "UPDATE_SETTINGS", settings: { voiceVolume: value } });
    });

    elements.muteOriginal?.addEventListener("change", () => {
      captionStyle.muteOriginal = elements.muteOriginal.checked;
      settings = { ...(settings || {}), originalVolume: captionStyle.muteOriginal ? 0 : (captionStyle.originalVolume || 18) };
      saveCaptionStyle();
      applyCaptionStyle();
      LumeoSessionManager.applyVolumes(settings.originalVolume, settings.voiceVolume);
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
    if (elements.exportBtn) elements.exportBtn.hidden = !LumeoSessionManager.getSession();
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
    const isStatusMessage = /^(loading|waiting|native|caption cache|translating)/i.test(value.trim());
    if (!isStatusMessage) {
      subtitleOverlay?.updateCue(value ? { text: value, translated: value } : null, {
        captionStyle,
        targetLanguage: settings?.targetLanguage,
        rtlLangs: RTL_LANGS,
      });
    }
  }

  function setTargetCue(cue) {
    lastDisplayedCue = cue || null;
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

  let lastSeenCaption = "";
  function startCaptionPoll() {
    stopCaptionPoll();
    lastSeenCaption = "";
    captionPollTimer = setInterval(() => {
      if (!settings?.showSource) return;
      const video = findVideo?.();
      if (video && video.paused) return;
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

  LumeoSessionManager.init({
    showToast,
    emitEnded,
    emitState,
    notifyBackground,
    setStatusText,
    setOverlayState,
    setTargetCue,
    setTargetText,
    buildOverlay,
    removeOverlay,
    applyTierToolbar,
    applySourceVisibility,
    startCaptionPoll,
    stopCaptionPoll,
    getElements: () => elements,
    getTranscriptController: () => transcriptController,
    getCurrentTexts: () => ({ source: currentSourceText, target: currentTargetText }),
    setCurrentTexts: (src, tgt) => { currentSourceText = src; currentTargetText = tgt; },
    onSessionStopped: () => {
      currentSourceText = "";
      currentTargetText = "";
      transcriptController?.remove?.();
    },
    onSettingsUpdated: (newSettings, prev) => {
      settings = { ...(settings || {}), ...newSettings };
      if (elements.langSelect && newSettings.targetLanguage) {
        elements.langSelect.value = newSettings.targetLanguage;
      }
      if (elements.voiceSelect &&
          (newSettings.realtimeVoice !== undefined ||
           newSettings.standardVoice !== undefined ||
           newSettings.captionTtsProvider !== undefined)) {
        populateVoicePicker(settings.tier || "realtime");
      }
      applyTierToolbar();
      if ("showSource" in newSettings) {
        applySourceVisibility();
        if (settings.showSource && LumeoSessionManager.getSession()) startCaptionPoll();
        else stopCaptionPoll();
      }
    },
    onHandoverSettingsApplied: (newSettings) => {
      settings = newSettings;
      if (elements.langSelect) elements.langSelect.value = newSettings.targetLanguage;
      if (elements.voiceSelect) elements.voiceSelect.value = newSettings.realtimeVoice || "";
    }
  });

  const handleNavigation = () => {
    if (location.href !== lastSpaUrl) {
      lastSpaUrl = location.href;
      overlayController?.refreshLayoutKey?.();
      overlayController?.ensureYouTubeControlButton?.();
      if (LumeoSessionManager.getSession()) {
        LumeoSessionManager.stopSession("yt-navigation");
        emitEnded("YouTube navigated.");
      }
    }
  };
  window.addEventListener("yt-navigate-finish", handleNavigation);
  setInterval(handleNavigation, 500);

  const handleUnload = () => {
    const s = LumeoSessionManager.getSession();
    if (s && s.kymaSessionId) {
      void window.LumeoKyma?.endSession(s.kymaSessionId, s.kymaKey);
    }
  };
  window.addEventListener("beforeunload", handleUnload);
  window.addEventListener("pagehide", handleUnload);

  browserApi.addRuntimeMessageListener((msg, sender, sendResponse) => {
    (async () => {
      try {
        switch (msg?.type) {
          case "CONTENT_PING":
            sendResponse({
              ok: true,
              version: LUMEO_VERSION,
              browserApi: !!window.LumeoBrowserApi,
              platformAdapters: !!window.LumeoPlatformAdapters,
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
              sessionManager: !!window.LumeoSessionManager,
            });
            break;
          case "CONTENT_START":
            settings = { ...(msg.settings || {}) };
            LumeoSessionManager.setSettings(settings);
            const startRes = await LumeoSessionManager.startSession(settings);
            sendResponse(startRes || { ok: true });
            break;
          case "CONTENT_STOP":
            LumeoSessionManager.stopSession("backend-stop");
            sendResponse({ ok: true });
            break;
          case "CONTENT_UPDATE_SETTINGS":
            LumeoSessionManager.applySettingsLive(msg.settings || {});
            sendResponse({ ok: true });
            break;
          case "CONTENT_UPDATE_VOLUME":
            const sManagerSettings = LumeoSessionManager.getSettings() || {};
            const updated = { ...sManagerSettings, originalVolume: msg.originalVolume, voiceVolume: msg.voiceVolume };
            settings = updated;
            LumeoSessionManager.setSettings(updated);
            LumeoSessionManager.applyVolumes(msg.originalVolume, msg.voiceVolume);
            sendResponse({ ok: true });
            break;
          case "TOGGLE_OVERLAY":
            buildOverlay();
            overlayController?.toggleSideCollapsed();
            sendResponse({ ok: true });
            break;
          default:
            sendResponse({ ok: false, error: "Unknown content message: " + msg?.type });
        }
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  });
})();
