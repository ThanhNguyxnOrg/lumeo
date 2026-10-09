(() => {
  "use strict";

  if (window.LumeoSessionManager?.__loaded) return;

  const SESSION_LIMIT_MS = 60 * 60 * 1000;
  const SESSION_WARNING_MS = 55 * 60 * 1000;
  const HEARTBEAT_MS = 30_000;
  const VOICE_GAIN_MAX = 2.0;

  const LANGUAGES = [
    ["en", "English"], ["vi", "Vietnamese"], ["ja", "Japanese"],
    ["ko", "Korean"], ["zh", "Chinese"], ["fr", "French"],
    ["es", "Spanish"], ["de", "German"], ["pt", "Portuguese"],
    ["hi", "Hindi"], ["id", "Indonesian"], ["it", "Italian"],
    ["ru", "Russian"],
  ];
  const LANG_NAME = Object.fromEntries(LANGUAGES);
  const STANDARD_DEFAULT_VOICE = window.LumeoVoicePicker?.STANDARD_DEFAULT_VOICE || "English_magnetic_voiced_man";

  let session = null;
  let prevSession = null;
  let activeStartingPipeline = null;
  let pageToken = 0;
  let settings = null;
  let videoEl = null;
  let initialVideoVolume = 1.0;
  let initialVideoMuted = false;
  let onYTPause = null;
  let onYTPlay = null;
  let onYTSeeked = null;
  let onYTRateChange = null;

  let heartbeatTimer = null;
  let warningTimer = null;
  let limitTimer = null;
  let warningShown = false;

  let callbacks = {};

  function init(cb) {
    callbacks = cb;
  }

  function getSession() { return session; }
  function getPrevSession() { return prevSession; }
  function getPageToken() { return pageToken; }
  function getSettings() { return settings; }
  function setSettings(s) { settings = s; }
  function getVideoEl() { return videoEl; }
  function setVideoEl(v) { videoEl = v; }
  function incrementPageToken() { return ++pageToken; }

  function startHeartbeat(kymaSessionId, kymaKey) {
    stopHeartbeat();
    if (!kymaSessionId || !kymaKey) return;
    heartbeatTimer = setInterval(() => {
      if (!session) return;
      void window.LumeoKyma?.heartbeat(kymaSessionId, kymaKey);
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
      callbacks.showToast?.("Session ends in 5 min", 6000);
    }, SESSION_WARNING_MS);
    limitTimer = setTimeout(() => {
      stopSession("auto-stop-60min");
      callbacks.emitEnded?.("Auto-stopped at 60 min — start again to continue.");
    }, SESSION_LIMIT_MS);
  }

  function clearSessionTimer() {
    if (warningTimer) { clearTimeout(warningTimer); warningTimer = null; }
    if (limitTimer) { clearTimeout(limitTimer); limitTimer = null; }
  }

  async function buildRealtimeSession(token, audioStream, opts) {
    return window.LumeoRealtimePipeline.buildSession({
      token: token,
      audioStream: audioStream,
      kymaKey: opts.kymaKey,
      targetLanguage: opts.targetLanguage || "vi",
      realtimeVoice: opts.realtimeVoice || "",
      kyma: window.LumeoKyma,
      isFresh: () => token === pageToken,
      onStatus: (txt) => callbacks.setStatusText?.(txt),
      onOverlayState: (st) => callbacks.setOverlayState?.(st),
      onRealtimeEvent: (raw, tok) => handleRealtimeEvent(raw, tok),
      onConnectionLost: (newSession) => {
        if (newSession === session) {
          stopSession("connection-lost");
          callbacks.emitEnded?.("Connection lost.");
        }
      },
      computeGain,
      getVoiceVolume: () => settings?.voiceVolume ?? 100,
    });
  }

  function handleRealtimeEvent(raw, token) {
    window.LumeoRealtimePipeline?.handleEvent(raw, {
      isFresh: () => !(token !== pageToken && session?.token !== token),
      currentTargetText: callbacks.getCurrentTexts?.().target || "",
      appendTargetDelta: (delta) => {
        const texts = callbacks.getCurrentTexts?.() || { source: "", target: "" };
        const updated = texts.target + delta;
        callbacks.setCurrentTexts?.(texts.source, updated);
        return updated;
      },
      setTargetText: (txt) => callbacks.setTargetText?.(txt),
      setOverlayState: (st) => callbacks.setOverlayState?.(st),
      setStatusText: (txt) => callbacks.setStatusText?.(txt),
      pushHistoryTurn: (finalText) => {
        const texts = callbacks.getCurrentTexts?.() || { source: "", target: "" };
        callbacks.setCurrentTexts?.(texts.source, finalText || texts.target);
      },
    });
  }

  function computeGain(voiceVolume) {
    return voiceVolume === 0 ? 0 : (voiceVolume / 100) * VOICE_GAIN_MAX;
  }

  function applyVolumes(originalVolume, voiceVolume) {
    if (!videoEl || !videoEl.isConnected) {
      videoEl = window.LumeoAudioUtils?.findVideo?.() || (typeof document !== "undefined" ? document.querySelector("video") : null);
    }
    if (videoEl) {
      const isMuted = !!settings?.muteOriginal || (originalVolume ?? 0) === 0;
      videoEl.volume = Math.max(0, Math.min(1, (originalVolume ?? 18) / 100));
      videoEl.muted = isMuted;
    }
    if (session?.outputGain) {
      session.outputGain.gain.value = computeGain(voiceVolume ?? 100);
    } else if (session?.remoteAudio) {
      session.remoteAudio.volume = Math.min((voiceVolume ?? 100) / 100, 1.0);
      session.remoteAudio.muted = voiceVolume === 0;
    }
  }

  async function requestHandover(partial) {
    if (!session) return;
    const newSettings = { ...settings, ...partial };
    const same =
      newSettings.targetLanguage === session.targetLanguage &&
      (newSettings.realtimeVoice || "") === (session.realtimeVoice || "");
    if (same) return;

    callbacks.setOverlayState?.("connecting");

    const newToken = ++pageToken;
    settings = newSettings;
    callbacks.notifyBackground?.({ type: "UPDATE_SETTINGS", settings: newSettings });
    callbacks.onHandoverSettingsApplied?.(newSettings);

    let newSession;
    try {
      newSession = await buildRealtimeSession(newToken, session.stream, {
        kymaKey: settings.kymaKey,
        targetLanguage: newSettings.targetLanguage,
        realtimeVoice: newSettings.realtimeVoice,
      });
      if (newToken !== pageToken) {
        try { newSession.pc.close(); } catch {}
        return;
      }
    } catch (err) {
      if (newToken !== pageToken) return;
      callbacks.setStatusText?.("Switch failed — keeping current session");
      callbacks.setOverlayState?.("live");
      callbacks.showToast?.(err.message, { cta: err.cta, ctaLabel: err.ctaLabel }, 9000);
      return;
    }

    prevSession = session;
    session = newSession;
    callbacks.setStatusText?.("Translating");
    callbacks.setOverlayState?.("live");

    setTimeout(() => {
      if (prevSession) {
        disposeSession(prevSession);
        prevSession = null;
      }
    }, 400);

    startHeartbeat(newSession.kymaSessionId, newSession.kymaKey);
    applyVolumes(settings.originalVolume, settings.voiceVolume);
  }

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
    const audioUtils = window.LumeoAudioUtils;
    const video = audioUtils?.findVideo();
    if (!video) return { ok: false, error: "No YouTube video on this page." };
    videoEl = video;

    let stream;
    try {
      callbacks.buildOverlay?.();
      callbacks.setStatusText?.("Acquiring audio");
      stream = await audioUtils.captureWithRetry(video);
    } catch (err) {
      callbacks.removeOverlay?.();
      return { ok: false, error: err.message || "YouTube audio cannot be captured. Click Play on the video, then retry." };
    }

    const recorderMime = window.LumeoStandardPipeline.pickRecorderMime(audioUtils);
    if (!recorderMime) {
      stream.getTracks().forEach((t) => t.stop());
      callbacks.removeOverlay?.();
      return { ok: false, error: "This browser cannot record YouTube audio for Standard Dub. Try Chrome/Edge, then retry." };
    }

    let audioCtx;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      callbacks.removeOverlay?.();
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
      abortController: new AbortController(),
    };
    session = newSession;
    callbacks.applyTierToolbar?.();

    callbacks.setStatusText?.("Translating");
    callbacks.setOverlayState?.("live");
    startSessionTimer();
    applyVolumes(settings.originalVolume, settings.voiceVolume);
    callbacks.applySourceVisibility?.();
    if (settings.showSource) callbacks.startCaptionPoll?.();

    onYTPause = () => {
      if (session?.audioCtx && session.audioCtx.state === "running") {
        session.audioCtx.suspend().catch(() => {});
      }
      callbacks.setStatusText?.("Paused");
      callbacks.setOverlayState?.("paused");
      callbacks.emitState?.({ paused: true, status: "Paused" });
    };
    onYTPlay = () => {
      if (session?.audioCtx && session.audioCtx.state === "suspended") {
        session.audioCtx.resume().catch(() => {});
      }
      callbacks.setStatusText?.("Translating");
      callbacks.setOverlayState?.("live");
      callbacks.emitState?.({ paused: false, status: "Translating" });
    };
    onYTSeeked = () => {
      if (session?.activeSources) {
        for (const src of session.activeSources) {
          try { src.stop(); } catch {}
        }
        session.activeSources.clear();
      }
      if (session) {
        session.nextPlayAt = 0;
        session.duckUntil = 0;
      }
      if (video) {
        if (settings?.muteOriginal) {
          video.muted = true;
          video.volume = 0;
        } else {
          video.volume = (settings?.originalVolume ?? 18) / 100;
        }
      }
    };
    onYTRateChange = () => {
      // Sync or adjust if rate changes
    };
    video.addEventListener("pause", onYTPause);
    video.addEventListener("play", onYTPlay);
    video.addEventListener("seeked", onYTSeeked);
    video.addEventListener("ratechange", onYTRateChange);

    window.LumeoStandardPipeline.runChunkLoop(newSession, {
      getActiveSession: () => session,
      isVideoPaused: () => !!videoEl?.paused,
      processChunk: (sessionRef, blob) => window.LumeoStandardPipeline.processChunk(sessionRef, blob, standardPipelineContext()),
      chunkMs: window.LumeoStandardPipeline.DEFAULT_CHUNK_MS || 5000,
    });
    callbacks.emitState?.({ running: true, paused: false, status: "Translating" });
    return { ok: true };
  }

  function standardPipelineContext() {
    return {
      getActiveSession: () => session,
      getPageToken: () => pageToken,
      getSettings: () => settings || {},
      langNameByCode: LANG_NAME,
      standardDefaultVoice: STANDARD_DEFAULT_VOICE,
      kymaBase: window.LumeoKyma?.KYMA_BASE,
      parseKymaError: window.LumeoKyma?.parseError,
      audioUtils: window.LumeoAudioUtils,
      getVideo: () => videoEl,
      fetch,
      FormData,
      onSourceText: (text) => {
        callbacks.setCurrentTexts?.(text, callbacks.getCurrentTexts?.().target || "");
        callbacks.onSourceText?.(text);
      },
      onTargetText: (text) => {
        callbacks.setCurrentTexts?.(callbacks.getCurrentTexts?.().source || "", text);
        callbacks.setTargetText?.(text);
        callbacks.setOverlayState?.("live");
      },
      onError: (parsed) => {
        callbacks.setStatusText?.(parsed.user || "Pipeline error");
        callbacks.showToast?.(parsed.user, { cta: parsed.cta, ctaLabel: parsed.ctaLabel }, 6000);
      },
      onChunkDone: () => {},
    };
  }

  async function startSession(incomingSettings) {
    if (session) return { ok: false, error: "Session already running." };
    if (incomingSettings && typeof incomingSettings === "object") {
      settings = { ...(settings || {}), ...incomingSettings };
    } else if (typeof incomingSettings === "string") {
      settings = { ...(settings || {}), tier: incomingSettings };
    }

    const audioUtils = window.LumeoAudioUtils;
    const initialVid = audioUtils?.findVideo();
    if (initialVid) {
      videoEl = initialVid;
      initialVideoVolume = initialVid.volume;
      initialVideoMuted = initialVid.muted;
    }

    if (settings.tier === "caption") {
      if (!window.LumeoCaptionOrchestrator) {
        return { ok: false, error: "LumeoCaptionOrchestrator not loaded" };
      }
      videoEl = videoEl || audioUtils?.findVideo();
      pageToken++;
      return window.LumeoCaptionOrchestrator.start({
        getSession: () => session,
        setActivePipeline: (p) => { activeStartingPipeline = p; },
        getSettings: () => settings,
        getPageToken: () => pageToken,
        getVideo: () => videoEl,
        getElements: () => callbacks.getElements?.(),
        getLangName: (code) => LANG_NAME[code],
        getTranscriptController: () => callbacks.getTranscriptController?.() || null,
        applyTierToolbar: () => callbacks.applyTierToolbar?.(),
        setStatusText: (txt) => callbacks.setStatusText?.(txt),
        setOverlayState: (st) => callbacks.setOverlayState?.(st),
        showToast: (txt, o, d) => callbacks.showToast?.(txt, o, d),
        setTargetCue: (cue) => callbacks.setTargetCue?.(cue),
        setTargetText: (txt) => callbacks.setTargetText?.(txt),
        applySourceVisibility: () => callbacks.applySourceVisibility?.(),
        removeOverlay: () => callbacks.removeOverlay?.(),
        buildOverlay: () => callbacks.buildOverlay?.(),
        captureWithRetry: audioUtils?.captureWithRetry,
        readYTCaptions: window.LumeoCaptions?.readYTCaptions || (() => ""),
        onSessionCreated: (newSession) => { session = newSession; },
        onSessionEnded: (reason, msg) => { stopSession(reason); callbacks.emitEnded?.(msg || reason); },
        onStateChange: (partial) => { callbacks.emitState?.(partial); },
        onUpdateSettings: (newSettings) => { callbacks.notifyBackground?.({ type: "UPDATE_SETTINGS", settings: newSettings }); },
        onOpenPopup: (slot) => { callbacks.notifyBackground?.({ type: "OPEN_POPUP_TO_SLOT", slot }); },
        onSwitchToStandard: async (pipeline) => {
          if (session) {
            disposeSession(session);
            session = null;
          } else {
            pipeline?.stop?.();
          }
          settings = { ...settings, tier: "standard" };
          callbacks.notifyBackground?.({ type: "UPDATE_SETTINGS", settings: { tier: "standard" } });
          const reply = await startStandardSession();
          if (!reply?.ok) {
            callbacks.showToast?.(reply?.error || "Could not start Standard Dub.", 7000);
            callbacks.emitState?.({ running: false, status: "Standard error", errorMessage: reply?.error || "Standard error" });
          }
        },
        setCurrentTexts: (src, tgt) => callbacks.setCurrentTexts?.(src, tgt),
        getCurrentTexts: () => callbacks.getCurrentTexts?.() || { source: "", target: "" },
        setYTPauseHandler: (handler) => {
          onYTPause = handler;
          if (videoEl) videoEl.addEventListener("pause", onYTPause);
        },
        setYTPlayHandler: (handler) => {
          onYTPlay = handler;
          if (videoEl) videoEl.addEventListener("play", onYTPlay);
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

    const video = audioUtils?.findVideo();
    if (!video) return { ok: false, error: "No YouTube video on this page." };
    videoEl = video;

    let stream;
    try {
      callbacks.buildOverlay?.();
      callbacks.setStatusText?.("Acquiring audio");
      stream = await audioUtils.captureWithRetry(video);
    } catch (err) {
      callbacks.removeOverlay?.();
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
      callbacks.removeOverlay?.();
      const msg = err.cta ? `${err.message} (${err.cta})` : err.message;
      return { ok: false, error: msg };
    }
    if (token !== pageToken) {
      try { newSession.pc.close(); } catch {}
      callbacks.removeOverlay?.();
      return { ok: false, error: "Cancelled before connect completed." };
    }

    session = newSession;
    callbacks.applyTierToolbar?.();
    callbacks.setStatusText?.("Translating");
    callbacks.setOverlayState?.("live");
    startHeartbeat(session.kymaSessionId, session.kymaKey);
    startSessionTimer();
    applyVolumes(settings.originalVolume, settings.voiceVolume);
    callbacks.applySourceVisibility?.();
    if (settings.showSource) callbacks.startCaptionPoll?.();

    onYTPause = () => {
      if (session?.remoteAudio) {
        session.remoteAudio.pause();
      }
      callbacks.setStatusText?.("Paused");
      callbacks.setOverlayState?.("paused");
      callbacks.emitState?.({ paused: true, status: "Paused" });
    };
    onYTPlay = () => {
      if (session?.remoteAudio) {
        session.remoteAudio.play().catch(() => {});
      }
      callbacks.setStatusText?.("Translating");
      callbacks.setOverlayState?.("live");
      callbacks.emitState?.({ paused: false, status: "Translating" });
    };
    video.addEventListener("pause", onYTPause);
    video.addEventListener("play", onYTPlay);

    callbacks.emitState?.({ running: true, paused: false, status: "Translating" });
    return { ok: true };
  }

  function disposeSession(s) {
    if (!s) return;
    try { s.pipeline?.stop?.(); } catch {}
    try { s.sttLoop?.stop?.(); } catch {}
    if (s.captionTimer) {
      try { clearInterval(s.captionTimer); } catch {}
      s.captionTimer = null;
    }
    s.stopFlag = true;
    try { s.abortController?.abort(); } catch {}
    try {
      if (s.activeRecorder && s.activeRecorder.state !== "inactive") {
        s.activeRecorder.stop();
      }
    } catch {}
    try {
      if (s.remoteAudio) {
        s.remoteAudio.pause();
        s.remoteAudio.srcObject = null;
        s.remoteAudio.remove();
        s.remoteAudio = null;
      }
    } catch {}
    try { s.outputGain?.disconnect(); } catch {}
    try {
      if (s.audioCtx && s.audioCtx.state !== "closed") {
        s.audioCtx.close()?.catch?.(() => {});
      }
    } catch {}
    try { s.dc?.close(); } catch {}
    try { s.pc?.close(); } catch {}
    try {
      if (s.stream) {
        s.stream.getTracks().forEach((t) => {
          try { t.stop(); } catch {}
        });
      }
    } catch {}
    if (s.kymaSessionId) {
      void window.LumeoKyma?.endSession(s.kymaSessionId, s.kymaKey);
    }
  }

  function stopSession(reason = "stop") {
    pageToken += 1;
    clearSessionTimer();
    stopHeartbeat();
    callbacks.stopCaptionPoll?.();
    if (videoEl) {
      if (onYTPause) videoEl.removeEventListener("pause", onYTPause);
      if (onYTPlay) videoEl.removeEventListener("play", onYTPlay);
      if (onYTSeeked) videoEl.removeEventListener("seeked", onYTSeeked);
      if (onYTRateChange) videoEl.removeEventListener("ratechange", onYTRateChange);
      if (reason !== "restart") {
        videoEl.muted = initialVideoMuted;
        videoEl.volume = initialVideoVolume;
        videoEl = null;
      }
    }
    if (reason !== "restart") {
      initialVideoVolume = 1.0;
      initialVideoMuted = false;
    }
    onYTPause = null;
    onYTPlay = null;
    onYTSeeked = null;
    onYTRateChange = null;
    if (activeStartingPipeline) {
      try { activeStartingPipeline.stop(); } catch {}
      activeStartingPipeline = null;
    }
    if (session) {
      disposeSession(session);
      session = null;
    }
    if (prevSession) {
      disposeSession(prevSession);
      prevSession = null;
    }
    callbacks.onSessionStopped?.();
    if (reason !== "restart") {
      callbacks.removeOverlay?.();
    }
  }

  async function restartSession(nextSettings) {
    stopSession("restart");
    return startSession(nextSettings || settings);
  }

  function applySettingsLive(newSettings) {
    const prev = settings || {};
    settings = { ...prev, ...newSettings };
    if ("tier" in newSettings && newSettings.tier !== prev.tier && session) {
      callbacks.showToast?.("Stop and Start to switch tiers", 5000);
    }
    callbacks.onSettingsUpdated?.(newSettings, prev);
    if (session?.type === "caption") {
      if (
        ("targetLanguage" in newSettings && newSettings.targetLanguage !== prev.targetLanguage) ||
        ("secondaryLanguage" in newSettings && newSettings.secondaryLanguage !== prev.secondaryLanguage)
      ) {
        void restartSession({ ...settings, ...newSettings });
      }
    } else if (session?.type !== "standard") {
      if (
        ("targetLanguage" in newSettings && newSettings.targetLanguage !== prev.targetLanguage) ||
        ("realtimeVoice" in newSettings && newSettings.realtimeVoice !== prev.realtimeVoice)
      ) {
        void requestHandover(newSettings);
      }
    }
    if ("originalVolume" in newSettings || "voiceVolume" in newSettings || "muteOriginal" in newSettings) {
      applyVolumes(settings.originalVolume, settings.voiceVolume);
    }
  }

  window.LumeoSessionManager = {
    __loaded: true,
    init,
    getSession,
    getPrevSession,
    getPageToken,
    getSettings,
    setSettings,
    getVideoEl,
    setVideoEl,
    incrementPageToken,
    startSession,
    stopSession,
    restartSession,
    requestHandover,
    applySettingsLive,
    isStarting: () => !!activeStartingPipeline,
    applyVolumes,
    computeGain,
  };
})();
