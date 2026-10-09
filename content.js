(() => {
  "use strict";

  const LUMEO_VERSION = "2.0.2";
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
    // Popular & Recommended
    ["vi", "Vietnamese (Tiếng Việt)"],
    ["en", "English"],
    ["ja", "Japanese (日本語)"],
    ["ko", "Korean (한국어)"],
    ["zh", "Chinese (中文)"],
    ["es", "Spanish (Español)"],
    ["fr", "French (Français)"],
    ["de", "German (Deutsch)"],
    // Alphabetical Index
    ["ar", "Arabic (العربية)"],
    ["bn", "Bengali (বাংলা)"],
    ["cs", "Czech (Čeština)"],
    ["da", "Danish (Dansk)"],
    ["nl", "Dutch (Nederlands)"],
    ["el", "Greek (Ελληνικά)"],
    ["he", "Hebrew (עברית)"],
    ["hi", "Hindi (हिन्दी)"],
    ["hu", "Hungarian (Magyar)"],
    ["id", "Indonesian (Bahasa Indonesia)"],
    ["it", "Italian (Italiano)"],
    ["ms", "Malay (Bahasa Melayu)"],
    ["no", "Norwegian (Norsk)"],
    ["fa", "Persian (فارسی)"],
    ["pl", "Polish (Polski)"],
    ["pt", "Portuguese (Português)"],
    ["ro", "Romanian (Română)"],
    ["ru", "Russian (Русский)"],
    ["sv", "Swedish (Svenska)"],
    ["th", "Thai (ไทย)"],
    ["tr", "Turkish (Türkçe)"],
    ["uk", "Ukrainian (Українська)"],
    ["ur", "Urdu (اردو)"],
  ];
  const LANG_NAME = Object.fromEntries(LANGUAGES);
  const browserApi = window.LumeoBrowserApi;

  const SMART_VOICE_PREFERENCES = {
    vi: ["Microsoft HoaiMy Online (Natural) - Vietnamese (Vietnam)", "Google tiếng Việt", "Microsoft NamMinh Online (Natural)"],
    en: ["Microsoft Jenny Online (Natural) - English (United States)", "Google US English", "Microsoft Guy Online (Natural)", "Samantha"],
    ja: ["Microsoft Nanami Online (Natural) - Japanese (Japan)", "Google 日本語", "Microsoft Keita Online (Natural)", "Kyoko"],
    ko: ["Microsoft SunHi Online (Natural) - Korean (Korea)", "Google 한국의", "Microsoft InJoon Online (Natural)", "Yuna"],
    zh: ["Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)", "Google 普通话 (中国大陆)", "Microsoft Yunxi Online (Natural)"],
    es: ["Microsoft Elvira Online (Natural) - Spanish (Spain)", "Google español", "Microsoft Alvaro Online (Natural)"],
    fr: ["Microsoft Denise Online (Natural) - French (France)", "Google français", "Microsoft Henri Online (Natural)"],
    de: ["Microsoft Katja Online (Natural) - German (Germany)", "Google Deutsch", "Microsoft Conrad Online (Natural)"],
    ru: ["Microsoft Svetlana Online (Natural) - Russian (Russia)", "Google русский", "Microsoft Dmitri Online (Natural)"],
    pt: ["Microsoft Francisca Online (Natural) - Portuguese (Brazil)", "Google português do Brasil"],
    it: ["Microsoft Elsa Online (Natural) - Italian (Italy)", "Google italiano"],
  };

  function autoPairVoiceForLanguage(langCode) {
    if (typeof window === "undefined" || !window.speechSynthesis) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return null;
    const prefs = SMART_VOICE_PREFERENCES[langCode] || [];
    for (const prefName of prefs) {
      const match = voices.find((v) => v.name.includes(prefName) || prefName.includes(v.name));
      if (match) return match.name;
    }
    const langMatch = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(langCode.toLowerCase()));
    if (langMatch) return langMatch.name;
    return null;
  }

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
    clearSessionUI();
    notifyBackground({ type: "CONTENT_ENDED", reason });
  }

  const LumeoSessionManager = window.LumeoSessionManager;
  const subtitleOverlay = window.LumeoSubtitleOverlay?.createSubtitleOverlayController?.();
  const transcriptController = window.LumeoTranscript?.createTranscriptController?.({
    onToggle: (isOpen) => {
      overlayController?.setTranscriptActive?.(isOpen);
    },
    onSeek: (seconds) => {
      const v = findVideo ? findVideo() : document.querySelector("video");
      if (v) v.currentTime = seconds;
    },
    onSummarize: async (cues) => {
      if (!cues || cues.length === 0) {
        showToast("No transcript cues available to summarize yet.", 3000);
        return;
      }
      transcriptController?.showSummaryLoading?.();
      const res = await browserApi.sendRuntimeMessage({
        type: "SUMMARIZE_TRANSCRIPT",
        cues,
        targetLanguage: settings?.targetLanguage || "vi",
      }).catch((e) => ({ ok: false, error: e?.message }));

      if (res?.ok) {
        transcriptController?.setSummary?.(res.summary);
      } else {
        transcriptController?.setSummaryError?.(res?.error || "Could not generate summary.");
        if (res?.needKey) {
          showToast("AI key required for summary. Click ⚙ in Lumeo to configure.", 5000);
        }
      }
    },
  });
  const overlayController = window.LumeoOverlay?.createOverlayController?.({
    layoutKey: getOverlayLayoutKey,
    languages: LANGUAGES,
    collapsedOnStart: true,
    onButtonClick: () => {
      ensureOverlayBuilt();
      const open = overlayController.isOpen?.();
      overlayController.toggleSideCollapsed(open);
    },
    onStartSession: async () => {
      await handleStartSession();
    },
    onStopSession: () => {
      handleStopSession();
    },
    onLanguageChange: (newLang) => {
      handleLanguageChange(newLang);
    },
    onVoiceChange: (newVoice) => {
      handleVoiceChange(newVoice);
    },
    onLayoutChange: (preset) => {
      applyLayoutPreset(preset);
      saveCaptionStyle();
      applyCaptionStyle();
    },
    onFontSizeChange: (size) => {
      captionStyle.fontSize = size;
      saveCaptionStyle();
      applyCaptionStyle();
    },
    onOpacityChange: (opacity) => {
      captionStyle.subBackgroundOpacity = opacity;
      saveCaptionStyle();
      applyCaptionStyle();
    },
    onShadowStyleChange: (shadow) => {
      captionStyle.subShadowStyle = shadow;
      saveCaptionStyle();
      applyCaptionStyle();
    },
    onSubtitleOrderChange: (order) => {
      captionStyle.subtitleOrder = order;
      saveCaptionStyle();
      applyCaptionStyle();
      if (lastDisplayedCue) setTargetCue(lastDisplayedCue);
    },
    onSecondaryLanguageChange: (secondaryLang) => {
      captionStyle.secondaryLanguage = secondaryLang;
      settings = settings || {};
      settings.secondaryLanguage = secondaryLang;
      saveCaptionStyle();
      applyCaptionStyle();
      if (lastDisplayedCue) setTargetCue(lastDisplayedCue);

      const activeSession = LumeoSessionManager.getSession();
      if (activeSession && (settings.tier === "caption" || !settings.tier)) {
        overlayController?.setSessionState?.({
          isTranslating: true,
          isLoading: true,
          statusText: "Switching secondary subtitle to " + (LANG_NAME[secondaryLang] || secondaryLang) + "...",
        });
        LumeoSessionManager.restartSession({ ...settings, secondaryLanguage: secondaryLang }).catch(() => {
          overlayController?.setSessionState?.({ isTranslating: false, isLoading: false, statusText: "Language switch failed" });
        });
      }
    },
    onOriginalVolumeChange: (vol) => {
      captionStyle.originalVolume = vol;
      captionStyle.muteOriginal = vol === 0;
      saveCaptionStyle();
      const s = LumeoSessionManager.getSettings() || settings || {};
      const updated = { ...s, originalVolume: vol, muteOriginal: vol === 0 };
      settings = updated;
      LumeoSessionManager.setSettings(updated);
      LumeoSessionManager.applyVolumes(vol, s.voiceVolume ?? 100);
      const vid = LumeoSessionManager.getVideoEl() || findVideo?.() || document.querySelector("video");
      if (vid) {
        vid.volume = Math.max(0, Math.min(1, vol / 100));
        vid.muted = vol === 0;
      }
      try {
        browserApi.sendRuntimeMessage({
          type: "UPDATE_VOLUME",
          originalVolume: vol,
          voiceVolume: s.voiceVolume ?? 100,
        }).catch(() => {});
      } catch {}
    },
    onVoiceVolumeChange: (vol) => {
      captionStyle.voiceVolume = vol;
      saveCaptionStyle();
      const s = LumeoSessionManager.getSettings() || settings || {};
      const updated = { ...s, voiceVolume: vol };
      settings = updated;
      LumeoSessionManager.setSettings(updated);
      LumeoSessionManager.applyVolumes(s.originalVolume ?? 18, vol);
      try {
        browserApi.sendRuntimeMessage({
          type: "UPDATE_VOLUME",
          originalVolume: s.originalVolume ?? 18,
          voiceVolume: vol,
        }).catch(() => {});
      } catch {}
    },
    onResetPosition: () => {
      subtitleOverlay?.resetPosition?.();
    },
    onToggleTranscript: () => {
      const isOpen = transcriptController?.toggle();
      overlayController?.setTranscriptActive?.(isOpen);
      return isOpen;
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
      secondaryLanguage: "original",
      subBackgroundOpacity: 75,
      subShadowStyle: "drop-shadow",
    };
  }

  // Live voiceschanged listener
  if (typeof window !== "undefined" && window.speechSynthesis) {
    const handleVoicesChanged = () => {
      if (elements.voiceSelect) {
        populateVoicePicker(settings?.tier || "caption");
      }
      overlayController?.updateMenuLabels?.();
    };
    try {
      window.speechSynthesis.addEventListener("voiceschanged", handleVoicesChanged);
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = handleVoicesChanged;
      }
    } catch {}
  }

  const IGNORED_STORAGE_KEYS = new Set(["lumeoCaptionCacheV1", "lumeoSubPosition"]);

  // Load from chrome.storage.local on startup
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.get(null, (res) => {
        if (res) {
          delete res.lumeoCaptionCacheV1;
          delete res.lumeoSubPosition;
          settings = { ...(settings || {}), ...res };
          captionStyle = { ...captionStyle, ...res };
          if (elements.langSelect && res.targetLanguage) {
            elements.langSelect.value = res.targetLanguage;
            autoPairVoiceForLanguage(res.targetLanguage);
          }
          if (elements.voiceSelect) {
            populateVoicePicker(settings.tier || "caption");
          }
          overlayController?.syncCaptionControls?.(captionStyle);
          applyCaptionStyle();
          overlayController?.updateMenuLabels?.();
        }
      });

      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local") {
          const updated = {};
          for (const [key, change] of Object.entries(changes)) {
            if (!IGNORED_STORAGE_KEYS.has(key)) {
              updated[key] = change.newValue;
            }
          }
          if (Object.keys(updated).length > 0) {
            settings = { ...(settings || {}), ...updated };
            captionStyle = { ...captionStyle, ...updated };
            if (updated.targetLanguage && elements.langSelect) {
              elements.langSelect.value = updated.targetLanguage;
              autoPairVoiceForLanguage(updated.targetLanguage);
            }
            if (updated.captionTtsProvider !== undefined || updated.standardVoice !== undefined || updated.targetLanguage !== undefined) {
              populateVoicePicker(settings.tier || "caption");
            }
            overlayController?.syncCaptionControls?.(captionStyle);
            applyCaptionStyle();
            overlayController?.updateMenuLabels?.();
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
          secondaryLanguage: captionStyle.secondaryLanguage || "original",
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
    if (LumeoSessionManager.getSession()) {
      const video = LumeoSessionManager.getVideoEl() || findVideo?.();
      if (video) video.muted = !!captionStyle.muteOriginal;
    }
  }

  async function handleStartSession() {
    overlayController?.setSessionState?.({ isTranslating: true, isLoading: true, statusText: "Loading captions..." });
    const stored = await browserApi.sendRuntimeMessage({ type: "GET_STATE" }).catch(() => null);
    const currentSettings = stored?.state || settings || { tier: "caption", targetLanguage: "vi", translateProvider: "google-free" };
    settings = currentSettings;
    LumeoSessionManager.setSettings(currentSettings);
    // Delegate START to background service worker which will ensureContentScript and send CONTENT_START
    browserApi.sendRuntimeMessage({ type: "START", settings: currentSettings }).catch(() => {});
  }

  function handleStopSession() {
    overlayController?.setSessionState?.({ isTranslating: false, isLoading: false, statusText: "" });
    LumeoSessionManager.stopSession("user-stop");
    notifyBackground({ type: "CONTENT_STATE", running: false, status: "Stopped" });
    emitEnded("Stopped");
  }

  function handleLanguageChange(newLang) {
    if (!newLang) return;
    settings = { ...(settings || {}), targetLanguage: newLang };
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.set({ targetLanguage: newLang });
      }
    } catch {}
    notifyBackground({ type: "UPDATE_SETTINGS", settings: { targetLanguage: newLang } });
    LumeoSessionManager.setSettings(settings);

    // Smart auto-pair neural voice for chosen target language
    const pairedVoice = autoPairVoiceForLanguage(newLang);
    if (pairedVoice) {
      handleVoiceChange(pairedVoice);
    }
    populateVoicePicker(settings?.tier || "caption");
    overlayController?.updateMenuLabels?.();

    // In-place reactive handover without stopping active video playback (Decision 14)
    if (settings.tier === "caption" || !settings.tier) {
      const activeSession = LumeoSessionManager.getSession() || (LumeoSessionManager.isStarting?.() ? true : null);
      if (activeSession) {
        overlayController?.setSessionState?.({
          isTranslating: true,
          isLoading: true,
          statusText: "Switching to " + (LANG_NAME[newLang] || newLang) + "...",
        });
        LumeoSessionManager.restartSession({ ...settings, targetLanguage: newLang }).catch(() => {
          overlayController?.setSessionState?.({ isTranslating: false, isLoading: false, statusText: "Language switch failed" });
        });
      }
    } else if (settings.tier === "standard") {
      setStatusText("Switching to " + (LANG_NAME[newLang] || newLang));
      setOverlayState("live");
    } else {
      LumeoSessionManager.requestHandover({ targetLanguage: newLang });
    }
  }

  function handleVoiceChange(newVoice) {
    if (!newVoice) return;
    settings = settings || {};
    if (settings?.tier === "caption" || !settings?.tier) {
      if (newVoice === "off") {
        settings.captionTtsProvider = "off";
      } else if (newVoice === "custom-voice-engine") {
        settings.captionTtsProvider = "custom-voice-engine";
      } else if (newVoice === "auto") {
        settings.captionTtsProvider = "browser";
        settings.standardVoice = "";
      } else {
        settings.captionTtsProvider = "browser";
        settings.standardVoice = newVoice;
      }
      notifyBackground({ type: "UPDATE_SETTINGS", settings: { captionTtsProvider: settings.captionTtsProvider, standardVoice: settings.standardVoice } });
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          chrome.storage.local.set({ captionTtsProvider: settings.captionTtsProvider, standardVoice: settings.standardVoice });
        }
      } catch {}
    } else if (settings?.tier === "standard") {
      settings.standardVoice = newVoice;
      notifyBackground({ type: "UPDATE_SETTINGS", settings: { standardVoice: newVoice } });
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          chrome.storage.local.set({ voice: newVoice, standardVoice: newVoice });
        }
      } catch {}
    } else {
      LumeoSessionManager.requestHandover({ realtimeVoice: newVoice });
    }
  }

  function ensureOverlayBuilt() {
    if (root) return root;
    if (!overlayController) return null;
    root = overlayController.build();
    elements = overlayController.getElements();

    if (elements.langSelect && settings?.targetLanguage) {
      elements.langSelect.value = settings.targetLanguage;
    }
    populateVoicePicker(settings?.tier || "caption");
    overlayController?.syncCaptionControls?.(captionStyle);
    overlayController?.updateMenuLabels?.();

    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      try {
        chrome.storage.local.get(null, (res) => {
          if (res) {
            settings = { ...(settings || {}), ...res };
            captionStyle = { ...captionStyle, ...res };
            if (elements.langSelect && settings.targetLanguage) {
              elements.langSelect.value = settings.targetLanguage;
            }
            populateVoicePicker(settings?.tier || "caption");
            overlayController?.syncCaptionControls?.(captionStyle);
            overlayController?.updateMenuLabels?.();
          }
        });
      } catch {}
    }

    elements.langSelect?.addEventListener("change", () => {
      handleLanguageChange(elements.langSelect.value);
    });

    elements.voiceSelect?.addEventListener("change", () => {
      handleVoiceChange(elements.voiceSelect.value);
    });

    elements.stopBtn?.addEventListener("click", () => {
      handleStopSession();
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
    return root;
  }

  const buildOverlay = ensureOverlayBuilt;

  function applyTierToolbar() {
    if (elements.exportBtn) elements.exportBtn.hidden = !LumeoSessionManager.getSession();
    if (elements.ttsCap) elements.ttsCap.hidden = settings?.tier !== "caption";
  }

  function populateVoicePicker(tier) {
    window.LumeoVoicePicker?.populate(elements.voiceSelect, tier, settings || {});
  }

  function setOverlayState(state) {
    overlayController?.setState(state);
    if (state === "live") {
      overlayController?.setSessionState?.({ isTranslating: true, isLoading: false });
    } else if (state === "ready" || state === "stopped" || state === "error") {
      overlayController?.setSessionState?.({ isLoading: false });
    }
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

  let wasPlayingBeforeHover = false;
  function bindAutoPauseOnHover() {
    const subEl = subtitleOverlay?.getElement?.();
    if (!subEl || subEl.dataset.lumeoHoverPause) return;
    subEl.dataset.lumeoHoverPause = "true";
    subEl.addEventListener("mouseenter", () => {
      if (!settings?.autoPauseOnHover) return;
      const video = LumeoSessionManager.getVideoEl() || document.querySelector("video.html5-main-video") || document.querySelector("video");
      if (video && !video.paused) {
        wasPlayingBeforeHover = true;
        video.pause();
      }
    });
    subEl.addEventListener("mouseleave", () => {
      if (!settings?.autoPauseOnHover) return;
      if (wasPlayingBeforeHover) {
        wasPlayingBeforeHover = false;
        const video = LumeoSessionManager.getVideoEl() || document.querySelector("video.html5-main-video") || document.querySelector("video");
        if (video && video.paused) {
          video.play().catch(() => {});
        }
      }
    });
  }

  window.addEventListener("keydown", (e) => {
    if (!settings?.navHotkeys) return;
    const target = e.target;
    if (target) {
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
        return;
      }
    }
    const video = LumeoSessionManager.getVideoEl() || document.querySelector("video.html5-main-video") || document.querySelector("video");
    if (!video) return;

    if (e.code === "KeyA" && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      const targetTime = lastDisplayedCue?.start != null ? Math.max(0, lastDisplayedCue.start - 0.1) : Math.max(0, video.currentTime - 5);
      video.currentTime = targetTime;
      showToast("⏪ Prev Cue", 1500);
    } else if (e.code === "KeyS" && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      const targetTime = lastDisplayedCue?.start != null ? lastDisplayedCue.start : Math.max(0, video.currentTime - 2);
      video.currentTime = targetTime;
      showToast("🔄 Replay Cue", 1500);
    } else if (e.code === "KeyD" && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      const targetTime = lastDisplayedCue?.end != null ? lastDisplayedCue.end + 0.1 : video.currentTime + 5;
      video.currentTime = targetTime;
      showToast("⏩ Next Cue", 1500);
    }
  });

  function setTargetCue(cue) {
    lastDisplayedCue = cue || null;
    if (elements.target) {
      elements.target.textContent = "";
      if (cue) {
        const isSourceTop = captionStyle.subtitleOrder === "source-top";
        const secondaryText = cue.secondaryTranslated || cue.text;
        const showTranslated = captionStyle.layoutPreset !== "source-only";
        const showSource = captionStyle.showSource !== false && captionStyle.layoutPreset !== "translated-only" && secondaryText && secondaryText !== (cue.translated || cue.text);

        const createTranslatedNode = () => {
          const translated = document.createElement("div");
          translated.className = "ec-target-translated" + (isSourceTop ? " is-secondary" : " is-primary");
          translated.textContent = cue.translated || cue.text || "";
          return translated;
        };

        const createSourceNode = () => {
          const source = document.createElement("div");
          source.className = "ec-target-source" + (isSourceTop ? " is-primary" : " is-secondary");
          source.textContent = secondaryText;
          return source;
        };

        if (isSourceTop) {
          if (showSource) elements.target.appendChild(createSourceNode());
          if (showTranslated) elements.target.appendChild(createTranslatedNode());
        } else {
          if (showTranslated) elements.target.appendChild(createTranslatedNode());
          if (showSource) elements.target.appendChild(createSourceNode());
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
    bindAutoPauseOnHover();
  }

  function showToast(text, opts, durationMs) {
    overlayController?.showToast(text, opts, durationMs);
  }

  function clearSessionUI() {
    subtitleOverlay?.remove();
    overlayController?.setSessionState?.({ isTranslating: false });
    currentTargetText = "";
    currentSourceText = "";
    lastDisplayedCue = null;
  }

  function removeOverlay() {
    clearSessionUI();
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
      clearSessionUI();
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
      overlayController?.toggleSideCollapsed?.(true);
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
    try {
      LumeoSessionManager.stopSession("unload");
    } catch {}
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
            if (LumeoSessionManager.getSession()) {
              sendResponse({ ok: true, alreadyRunning: true });
              break;
            }
            settings = { ...(msg.settings || {}) };
            LumeoSessionManager.setSettings(settings);
            overlayController?.setSessionState?.({ isTranslating: true });
            if (elements.langSelect && settings.targetLanguage) {
              elements.langSelect.value = settings.targetLanguage;
            }
            populateVoicePicker(settings.tier || "caption");
            overlayController?.syncCaptionControls?.(captionStyle);
            overlayController?.updateMenuLabels?.();
            const startRes = await LumeoSessionManager.startSession(settings);
            sendResponse(startRes || { ok: true });
            break;
          case "CONTENT_STOP":
            LumeoSessionManager.stopSession("backend-stop");
            clearSessionUI();
            sendResponse({ ok: true });
            break;
          case "CONTENT_UPDATE_SETTINGS":
            settings = { ...(settings || {}), ...(msg.settings || {}) };
            LumeoSessionManager.applySettingsLive(msg.settings || {});
            if (msg.settings?.targetLanguage && elements.langSelect) {
              elements.langSelect.value = msg.settings.targetLanguage;
            }
            overlayController?.syncCaptionControls?.(captionStyle);
            overlayController?.updateMenuLabels?.();
            sendResponse({ ok: true });
            break;
          case "CONTENT_UPDATE_VOLUME":
            const sManagerSettings = LumeoSessionManager.getSettings() || settings || {};
            const updatedVol = {
              ...sManagerSettings,
              originalVolume: msg.originalVolume,
              voiceVolume: msg.voiceVolume,
              muteOriginal: msg.originalVolume === 0 ? true : sManagerSettings.muteOriginal,
            };
            settings = updatedVol;
            if (typeof msg.originalVolume === "number") {
              captionStyle.originalVolume = msg.originalVolume;
              captionStyle.muteOriginal = msg.originalVolume === 0;
            }
            if (typeof msg.voiceVolume === "number") {
              captionStyle.voiceVolume = msg.voiceVolume;
            }
            saveCaptionStyle();
            LumeoSessionManager.setSettings(updatedVol);
            LumeoSessionManager.applyVolumes(msg.originalVolume, msg.voiceVolume);
            const activeVid = LumeoSessionManager.getVideoEl() || findVideo?.() || document.querySelector("video");
            if (activeVid && typeof msg.originalVolume === "number") {
              activeVid.volume = Math.max(0, Math.min(1, msg.originalVolume / 100));
              activeVid.muted = !!settings.muteOriginal || msg.originalVolume === 0;
            }
            overlayController?.syncCaptionControls?.(captionStyle);
            overlayController?.updateMenuLabels?.();
            sendResponse({ ok: true });
            break;
          case "TOGGLE_OVERLAY":
            ensureOverlayBuilt();
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

  // Live storage sync from Options page or other tabs
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        let volumeChanged = false;
        let captionStyleChanged = false;
        let settingsChanged = false;

        const updatedSettings = { ...(settings || {}) };

        for (const [key, change] of Object.entries(changes)) {
          if (change && "newValue" in change) {
            updatedSettings[key] = change.newValue;
            settingsChanged = true;
          }
        }

        if (changes.originalVolume?.newValue != null) {
          captionStyle.originalVolume = Number(changes.originalVolume.newValue);
          volumeChanged = true;
          captionStyleChanged = true;
        }
        if (changes.voiceVolume?.newValue != null) {
          captionStyle.voiceVolume = Number(changes.voiceVolume.newValue);
          volumeChanged = true;
          captionStyleChanged = true;
        }
        if (changes.muteOriginal?.newValue != null) {
          captionStyle.muteOriginal = !!changes.muteOriginal.newValue;
          volumeChanged = true;
          captionStyleChanged = true;
        }
        if (changes.fontSize?.newValue != null) {
          captionStyle.fontSize = Number(changes.fontSize.newValue);
          captionStyleChanged = true;
        }
        if (changes.bottomOffset?.newValue != null) {
          captionStyle.bottomOffset = Number(changes.bottomOffset.newValue);
          captionStyleChanged = true;
        }
        if (changes.subBackgroundOpacity?.newValue != null) {
          const raw = changes.subBackgroundOpacity.newValue;
          captionStyle.subBackgroundOpacity = typeof raw === "number" && raw <= 1 ? Math.round(raw * 100) : Number(raw);
          captionStyleChanged = true;
        }
        if (changes.subShadowStyle?.newValue != null) {
          captionStyle.subShadowStyle = changes.subShadowStyle.newValue;
          captionStyleChanged = true;
        }
        if (changes.subtitleOrder?.newValue != null) {
          captionStyle.subtitleOrder = changes.subtitleOrder.newValue;
          captionStyleChanged = true;
        }
        if (changes.layoutPreset?.newValue != null) {
          captionStyle.layoutPreset = changes.layoutPreset.newValue;
          captionStyleChanged = true;
        }
        if (changes.targetLanguage?.newValue != null) {
          if (elements.langSelect) elements.langSelect.value = changes.targetLanguage.newValue;
          if (captionStyle.targetLanguage !== changes.targetLanguage.newValue) {
            captionStyle.targetLanguage = changes.targetLanguage.newValue;
            captionStyleChanged = true;
          }
        }

        if (settingsChanged) {
          settings = updatedSettings;
          LumeoSessionManager.setSettings(updatedSettings);
          LumeoSessionManager.applySettingsLive(updatedSettings);
        }

        if (volumeChanged) {
          LumeoSessionManager.applyVolumes(settings.originalVolume, settings.voiceVolume);
          const currentSession = LumeoSessionManager.getSession?.();
          const isDubbingActive = currentSession && currentSession.type !== "caption";
          const vid = LumeoSessionManager.getVideoEl() || findVideo?.() || document.querySelector("video");
          if (vid && isDubbingActive && typeof settings.originalVolume === "number") {
            vid.volume = Math.max(0, Math.min(1, settings.originalVolume / 100));
            vid.muted = !!settings.muteOriginal || settings.originalVolume === 0;
          }
        }

        if (captionStyleChanged) {
          saveCaptionStyle();
          applyCaptionStyle();
          overlayController?.syncCaptionControls?.(captionStyle);
        }
        overlayController?.updateMenuLabels?.();
      });
    }
  } catch {}

  // Eagerly mount overlay structure so controls/listeners are active on page load
  setTimeout(() => {
    try {
      ensureOverlayBuilt();
    } catch {}
  }, 0);

  window.addEventListener("pagehide", () => {
    overlayController?.destroy?.();
  });
})();
