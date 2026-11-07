(() => {
  "use strict";

  if (window.LumeoStandardPipeline?.__loaded) return;

  const DEFAULT_CHUNK_MS = 5000;
  const MIN_CHUNK_BYTES = 2000;
  const RECORDER_MIMES = Object.freeze([
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ]);

  function pickRecorderMime(audioUtils = window.LumeoAudioUtils) {
    return audioUtils?.pickRecorderMime?.(RECORDER_MIMES) || "";
  }

  function shouldProcessChunk(sessionRef, activeSession, pageToken, blob) {
    if (sessionRef !== activeSession) return false;
    if (sessionRef?.token !== pageToken) return false;
    return Number(blob?.size || 0) >= MIN_CHUNK_BYTES;
  }

  const MAX_READY_CHUNKS = 3;
  const MAX_WAIT_MS = 2200;
  const DRAIN_TICK_MS = 250;
  // Playback is anchored to the source video clock, not to a free-running
  // queue. These caps keep a late line intelligible while still letting it
  // catch up instead of drifting one chunk further behind every time.
  const MAX_FIT_RATE = 1.1;
  const MAX_CATCHUP_RATE = 1.6;
  // A chunk can only start after STT + translation + TTS finish, which is
  // normally a couple of seconds after its recorded slot. Allow more than one
  // full chunk of lateness before treating it as a backlog spike and dropping
  // it; otherwise a normal processing delay would mute the whole dub.
  const LATE_GRACE_SECONDS = 5.5;

  function clearDrainTimer(state) {
    if (!state?.drainTimer) return;
    try { clearTimeout(state.drainTimer); } catch {}
    state.drainTimer = null;
  }

  function getDubState(sessionRef, startIndex, startMs) {
    if (!sessionRef.dubState) {
      const fallback = Number.isFinite(Number(startIndex)) ? Number(startIndex) : 0;
      const anchor = Number(startMs);
      sessionRef.dubState = {
        nextIndex: fallback,
        // Anchor the first wait window to where the chunk actually started.
        // Without this, the first post-seek chunk looks stale and is skipped.
        lastEndMs: Number.isFinite(anchor) && anchor >= 0 ? anchor : 0,
        ready: new Map(),
        skipped: 0,
        dropped: 0,
        drainTimer: null,
      };
    }
    return sessionRef.dubState;
  }

  function scheduleDrain(sessionRef, context) {
    const state = sessionRef.dubState;
    if (!state || state.drainTimer) return;
    state.drainTimer = setTimeout(() => {
      state.drainTimer = null;
      if (sessionRef !== context.getActiveSession?.() || sessionRef.stopFlag) return;
      if (sessionRef.dubState !== state) return;
      drainOrderedDub(sessionRef, context);
    }, DRAIN_TICK_MS);
  }

  function enqueueOrderedDub(sessionRef, meta, audioBuffer, context) {
    const state = getDubState(
      sessionRef,
      sessionRef.dubStartIndex ?? meta.index,
      meta.sourceStartMs,
    );
    if (meta.index < state.nextIndex) {
      state.dropped += 1;
      return;
    }
    if (state.ready.has(meta.index)) {
      state.dropped += 1;
      return;
    }
    state.ready.set(meta.index, { meta, audioBuffer, context });
    if (state.ready.size > MAX_READY_CHUNKS) {
      const keys = [...state.ready.keys()].sort((a, b) => a - b);
      while (keys.length > MAX_READY_CHUNKS) {
        const dropIndex = keys.pop();
        if (dropIndex === state.nextIndex) break;
        state.ready.delete(dropIndex);
        state.skipped += 1;
      }
    }
    drainOrderedDub(sessionRef, context);
  }

  function drainOrderedDub(sessionRef, context) {
    const state = sessionRef.dubState;
    if (!state) return;
    let progress = true;
    while (progress) {
      progress = false;
      while (!state.ready.has(state.nextIndex)) {
        // Wait a bounded time for the missing chunk; after that the video has
        // moved past its slot, so skip it instead of blocking later audio.
        const videoNowMs = Math.max(0, (Number(context.getVideo?.()?.currentTime) || 0) * 1000);
        const waitUntil = (state.lastEndMs || 0) + MAX_WAIT_MS;
        if (videoNowMs > waitUntil) {
          state.nextIndex += 1;
          state.skipped += 1;
          progress = true;
          continue;
        }
        // A later chunk is already buffered: keep a timer alive so the gap is
        // skipped even when no further chunk arrives to trigger drain again.
        if (state.ready.size > 0) {
          scheduleDrain(sessionRef, context);
        } else {
          clearDrainTimer(state);
        }
        return;
      }
      const item = state.ready.get(state.nextIndex);
      state.ready.delete(state.nextIndex);
      state.nextIndex += 1;
      state.lastEndMs = Number(item.meta.sourceEndMs) || state.lastEndMs;
      playDubItem(sessionRef, item.audioBuffer, item.context || context, item.meta);
      progress = true;
    }
  }

  function resetDubState(sessionRef, startIndex) {
    const state = sessionRef?.dubState;
    clearDrainTimer(state);
    clearDubTextTimers(sessionRef);
    if (!sessionRef) return;
    sessionRef.dubState = null;
    sessionRef.lastScheduledDubItem = null;
    if (Number.isFinite(Number(startIndex))) {
      sessionRef.dubStartIndex = Number(startIndex);
    }
  }

  function runChunkLoop(sessionRef, options = {}) {
    const {
      getActiveSession = () => null,
      isVideoPaused = () => false,
      MediaRecorder: Recorder = window.MediaRecorder,
      BlobCtor = Blob,
      setTimeout: setTimer = setTimeout,
      processChunk = () => Promise.resolve(),
      chunkMs = DEFAULT_CHUNK_MS,
      retryPausedMs = 400,
      retryErrorMs = 1000,
      getVideoTime = () => 0,
    } = options;

    const cycle = () => {
      if (sessionRef !== getActiveSession() || sessionRef.stopFlag) return;
      if (isVideoPaused()) {
        setTimer(cycle, retryPausedMs);
        return;
      }

      let recorder;
      try {
        recorder = new Recorder(sessionRef.stream, { mimeType: sessionRef.recorderMime });
      } catch {
        try {
          recorder = new Recorder(sessionRef.stream);
        } catch {
          setTimer(cycle, retryErrorMs);
          return;
        }
      }

      const chunkGeneration = Number(sessionRef.chunkGeneration) || 0;
      sessionRef.activeRecorder = recorder;
      const parts = [];
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data && event.data.size > 0) parts.push(event.data);
      });
      recorder.addEventListener("stop", () => {
        if (sessionRef !== getActiveSession() || sessionRef.stopFlag) return;
        // A seek bumps chunkGeneration and stops the in-flight recorder so a
        // chunk that straddles the seek boundary is discarded instead of being
        // transcribed and played at the wrong timestamp.
        if ((Number(sessionRef.chunkGeneration) || 0) !== chunkGeneration) {
          cycle();
          return;
        }
        if (parts.length) {
          const blob = new BlobCtor(parts, { type: sessionRef.recorderMime });
          const index = Number(sessionRef.nextChunkIndex) || 0;
          sessionRef.nextChunkIndex = index + 1;
          const stoppedAtMs = Math.max(0, Math.round((Number(getVideoTime()) || 0) * 1000));
          const sourceEndMs = stoppedAtMs > sourceStartMs ? stoppedAtMs : sourceStartMs + chunkMs;
          blob.__lumeoChunk = {
            index,
            sourceStartMs,
            sourceEndMs,
          };
          processChunk(sessionRef, blob).catch(() => {});
        }
        cycle();
      });

      let sourceStartMs = 0;
      try {
        // Capture the slot start before recording begins. Reading the video
        // clock after the 5s stop put every chunk one chunk-length late.
        sourceStartMs = Math.max(0, Math.round((Number(getVideoTime()) || 0) * 1000));
        recorder.start();
      } catch {
        setTimer(cycle, retryErrorMs);
        return;
      }

      setTimer(() => {
        try {
          if (recorder.state !== "inactive") recorder.stop();
        } catch {}
      }, chunkMs);
    };

    cycle();
  }

  async function processChunk(sessionRef, blob, context = {}) {
    const activeSession = context.getActiveSession?.();
    const pageToken = context.getPageToken?.();
    if (!shouldProcessChunk(sessionRef, activeSession, pageToken, blob)) return;

    const settings = context.getSettings?.() || {};
    const token = sessionRef.token;
    const kymaKey = sessionRef.kymaKey;
    const language = settings.targetLanguage || "en";
    const languageName = context.langNameByCode?.[language] || language;
    const voiceId = settings.standardVoice || context.standardDefaultVoice || "English_magnetic_voiced_man";
    const kymaBase = context.kymaBase || "https://api.kymaapi.com/v1";
    const audioUtils = context.audioUtils || window.LumeoAudioUtils;
    const fetchFn = context.fetch || fetch;
    const FormDataCtor = context.FormData || FormData;
    const parseKymaError = context.parseKymaError || ((status, body) => ({ status, user: body || "Pipeline error" }));
    const chunkMeta = blob?.__lumeoChunk || { index: 0, sourceStartMs: 0, sourceEndMs: DEFAULT_CHUNK_MS };
    const generation = Number(sessionRef.dubGeneration) || 0;
    const isCurrent = () => sessionRef === context.getActiveSession?.()
      && sessionRef.token === context.getPageToken?.()
      && (Number(sessionRef.dubGeneration) || 0) === generation;

    let wavBlob;
    try {
      wavBlob = await audioUtils.webmBlobToWav(blob, sessionRef.audioCtx);
    } catch {
      return;
    }
    if (!isCurrent()) return;

    const formData = new FormDataCtor();
    formData.append("file", wavBlob, "chunk.wav");
    formData.append("model", "whisper-v3-turbo");
    formData.append("response_format", "json");

    let transcriptionResponse;
    try {
      transcriptionResponse = await fetchFn(`${kymaBase}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: "Bearer " + kymaKey },
        body: formData,
        signal: sessionRef.abortController.signal,
      });
    } catch {
      return;
    }
    if (!isCurrent()) return;
    if (!transcriptionResponse.ok) {
      const body = await transcriptionResponse.text().catch(() => "");
      context.onError?.(parseKymaError(transcriptionResponse.status, body));
      return;
    }

    const transcription = await transcriptionResponse.json().catch(() => ({}));
    const sourceText = String(transcription.text || "").trim();
    if (!sourceText || sourceText.length < 2) return;

    const glossary = String(settings.translationContext || "").trim();
    const priorLines = Array.isArray(sessionRef.contextLines)
      ? sessionRef.contextLines.slice(-4)
      : [];
    const systemPrompt = [
      `You are a live dubbing translator. Translate the user's sentence into ${languageName}. Output ONLY the translation. No quotes, no commentary, no explanation, no labels. Preserve names, brand names, and technical terms verbatim.`,
      glossary ? `Glossary / user context: ${glossary}` : "",
      priorLines.length
        ? `Previous transcript (context only, do not translate it):\n${priorLines.join("\n")}`
        : "",
    ].filter(Boolean).join("\n");

    let translationResponse;
    try {
      translationResponse = await fetchFn(`${kymaBase}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + kymaKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: settings.geminiModel || "gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: sourceText },
          ],
          temperature: 0.2,
        }),
        signal: sessionRef.abortController.signal,
      });
    } catch {
      return;
    }
    if (!isCurrent()) return;
    if (!translationResponse.ok) {
      const body = await translationResponse.text().catch(() => "");
      context.onError?.(parseKymaError(translationResponse.status, body));
      return;
    }

    const translation = await translationResponse.json().catch(() => ({}));
    const targetText = String(translation?.choices?.[0]?.message?.content || "").trim();
    if (!targetText) return;

    if (!Array.isArray(sessionRef.contextLines)) sessionRef.contextLines = [];
    sessionRef.contextLines.push(sourceText);
    if (sessionRef.contextLines.length > 8) {
      sessionRef.contextLines.splice(0, sessionRef.contextLines.length - 8);
    }

    let speechResponse;
    try {
      speechResponse = await fetchFn(`${kymaBase}/audio/speech`, {
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
        signal: sessionRef.abortController.signal,
      });
    } catch {
      return;
    }
    if (!isCurrent()) return;
    if (!speechResponse.ok) {
      const body = await speechResponse.text().catch(() => "");
      context.onError?.(parseKymaError(speechResponse.status, body));
      return;
    }

    const arrayBuffer = await speechResponse.arrayBuffer();
    if (!isCurrent()) return;

    let audioBuffer;
    try {
      audioBuffer = await sessionRef.audioCtx.decodeAudioData(arrayBuffer);
    } catch {
      return;
    }
    if (!isCurrent()) return;

    enqueueOrderedDub(sessionRef, { ...chunkMeta, sourceText, targetText }, audioBuffer, context);
    context.onChunkDone?.();
  }

  function clearDubTextTimers(sessionRef) {
    if (!sessionRef?.dubTextTimers) return;
    for (const timer of sessionRef.dubTextTimers) {
      try { clearTimeout(timer); } catch {}
    }
    sessionRef.dubTextTimers = null;
  }

  function stopDubPlayback(sessionRef) {
    clearDubTextTimers(sessionRef);
    if (sessionRef?.activeSources) {
      for (const source of sessionRef.activeSources) {
        try { source.stop(); } catch {}
      }
      sessionRef.activeSources.clear();
    }
    if (sessionRef) {
      sessionRef.lastScheduledDubItem = null;
      sessionRef.nextPlayAt = 0;
      sessionRef.duckUntil = 0;
    }
  }

  // Translate a chunk's source slot into AudioContext time. `startAt` is when
  // playback should begin, `rate` is the speed needed to fit the slot, and
  // `expired` means the video already moved past this chunk entirely.
  function computeDubTiming(meta = {}, audioDuration = 0, context = {}, audioNow = 0) {
    const slotStart = Math.max(0, (Number(meta.sourceStartMs) || 0) / 1000);
    const slotEnd = Math.max(slotStart + 0.25, (Number(meta.sourceEndMs) || 0) / 1000);
    const duration = Math.max(0, Number(audioDuration) || 0);
    const video = typeof context.getVideo === "function" ? context.getVideo() : null;
    const rawTime = Number(video?.currentTime);
    if (!Number.isFinite(rawTime)) {
      return { anchored: false, slotStart, slotEnd, duration };
    }
    const videoRate = Math.max(0.25, Number(video?.playbackRate) || 1);
    const lateness = Math.max(0, rawTime - slotStart);
    const expired = rawTime > slotEnd + LATE_GRACE_SECONDS;
    const slotSeconds = Math.max(0.25, (slotEnd - slotStart) / videoRate);
    const remaining = Math.max(0, (slotEnd - rawTime) / videoRate);
    const wait = Math.max(0, (slotStart - rawTime) / videoRate);
    const startAt = audioNow + 0.05 + (expired ? 0 : wait);
    let rate = 1;
    if (duration > slotSeconds) {
      rate = Math.min(MAX_FIT_RATE, duration / slotSeconds);
    }
    if (!expired && lateness > 0 && remaining > 0.15 && duration > remaining) {
      rate = Math.max(rate, Math.min(MAX_CATCHUP_RATE, duration / remaining));
    }
    return {
      anchored: true,
      slotStart,
      slotEnd,
      duration,
      lateness,
      expired,
      startAt,
      rate,
      endAt: startAt + duration / Math.max(0.5, rate),
    };
  }

  function playDubItem(sessionRef, audioBuffer, context = {}, meta = {}) {
    if (!sessionRef || !audioBuffer || !sessionRef.audioCtx) return false;
    const audioCtx = sessionRef.audioCtx;
    const now = audioCtx.currentTime;
    const timing = computeDubTiming(meta, audioBuffer.duration, context, now);

    if (timing.expired) {
      sessionRef.dubSkippedLate = (Number(sessionRef.dubSkippedLate) || 0) + 1;
      try { context.onChunkSkipped?.({ ...meta, reason: "late" }); } catch {}
      return false;
    }

    const previous = sessionRef.lastScheduledDubItem;
    let startAt;
    let rate;
    if (timing.anchored) {
      startAt = timing.startAt;
      rate = timing.rate;
      // Late chunks start as soon as they are ready. If the previous chunk is
      // still speaking, run this one right after it instead of stacking both
      // at the same instant and cutting the older line off.
      if (timing.lateness > 0
        && previous?.source
        && Number.isFinite(previous.endAt)
        && previous.endAt > startAt) {
        startAt = previous.endAt;
      }
    } else {
      // Legacy fallback when no video clock is available (tests, detached
      // players): keep the old bounded queue behavior.
      if (sessionRef.nextPlayAt < now) sessionRef.nextPlayAt = 0;
      if (sessionRef.nextPlayAt - now > 2.0) sessionRef.nextPlayAt = now + 0.05;
      startAt = Math.max(now + 0.05, sessionRef.nextPlayAt);
      const chunkSeconds = (Number(meta.sourceEndMs) - Number(meta.sourceStartMs)) / 1000;
      const targetDuration = (chunkSeconds > 0 ? chunkSeconds : 5.0) / (Number(context.getVideo?.()?.playbackRate) || 1);
      const speedRatio = (Number(audioBuffer.duration) || 0) / targetDuration;
      rate = speedRatio > 1.05 ? Math.min(speedRatio, MAX_FIT_RATE) : 1.0;
    }

    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    if (source.playbackRate) source.playbackRate.value = rate;
    const duration = (Number(audioBuffer.duration) || 0) / Math.max(0.5, rate);

    let gain = null;
    if (typeof audioCtx.createGain === "function") {
      gain = audioCtx.createGain();
      gain.gain.value = 1;
      source.connect(gain);
      gain.connect(sessionRef.outputGain);
    } else {
      source.connect(sessionRef.outputGain);
    }

    // A line that overran its slot may still be playing when the next cue is
    // due. Fade it out at the boundary so the fresh chunk starts on time
    // instead of stacking behind it.
    if (previous?.source && previous.source !== source && startAt < previous.endAt) {
      const fadeAt = Math.max(now, startAt - 0.12);
      try {
        previous.gain?.gain?.cancelScheduledValues?.(now);
        previous.gain?.gain?.setValueAtTime?.(1, fadeAt);
        previous.gain?.gain?.linearRampToValueAtTime?.(0, Math.max(fadeAt + 0.02, startAt));
      } catch {}
      try { previous.source.stop(Math.max(now + 0.02, startAt)); } catch {}
    }

    const item = {
      source,
      gain,
      meta,
      startAt,
      endAt: startAt + duration,
    };
    sessionRef.activeSources = sessionRef.activeSources || new Set();
    sessionRef.activeSources.add(source);
    sessionRef.lastScheduledDubItem = item;
    const onEnded = () => {
      sessionRef.activeSources?.delete(source);
      if (sessionRef.lastScheduledDubItem === item) sessionRef.lastScheduledDubItem = null;
    };
    if (typeof source.addEventListener === "function") {
      source.addEventListener("ended", onEnded);
    } else {
      source.onended = onEnded;
    }

    try {
      source.start(startAt);
    } catch {
      sessionRef.activeSources.delete(source);
      if (sessionRef.lastScheduledDubItem === item) sessionRef.lastScheduledDubItem = null;
      return false;
    }
    sessionRef.nextPlayAt = item.endAt;

    // Show the translated line when its voice actually starts. Showing it at
    // translation time made the subtitle run ahead of the dub by the whole
    // TTS latency.
    if (meta.sourceText || meta.targetText) {
      if (!timing.anchored) {
        try { context.onSourceText?.(meta.sourceText || ""); } catch {}
        try { context.onTargetText?.(meta.targetText || ""); } catch {}
      } else {
        const generation = Number(sessionRef.dubGeneration) || 0;
        const delay = Math.max(0, (startAt - audioCtx.currentTime) * 1000);
        let timer = null;
        const scheduleTextCheck = (ms) => {
          timer = setTimeout(showText, ms);
          sessionRef.dubTextTimers = sessionRef.dubTextTimers || new Set();
          sessionRef.dubTextTimers.add(timer);
        };
        const showText = () => {
          sessionRef.dubTextTimers?.delete(timer);
          if (sessionRef !== context.getActiveSession?.()) return;
          if (context.getPageToken && sessionRef.token !== context.getPageToken()) return;
          if ((Number(sessionRef.dubGeneration) || 0) !== generation) return;
          const remainingMs = (startAt - audioCtx.currentTime) * 1000;
          if (remainingMs > 25) {
            scheduleTextCheck(remainingMs);
            return;
          }
          try { context.onSourceText?.(meta.sourceText || ""); } catch {}
          try { context.onTargetText?.(meta.targetText || ""); } catch {}
        };
        scheduleTextCheck(delay);
      }
    }

    const video = typeof context.getVideo === "function" ? context.getVideo() : null;
    if (video) {
      const settings = context.getSettings?.() || {};
      if (settings.muteOriginal) {
        video.muted = true;
        video.volume = 0;
      } else {
        const originalVolume = settings.originalVolume ?? 18;
        const endAt = startAt + duration;
        sessionRef.duckUntil = endAt;

        const delayToStart = Math.max(0, (startAt - audioCtx.currentTime) * 1000);
        const delayToEnd = Math.max(0, (endAt - audioCtx.currentTime) * 1000);

        setTimeout(() => {
          if (sessionRef === context.getActiveSession?.() && sessionRef.token === context.getPageToken?.()) {
            const liveSettings = context.getSettings?.() || settings;
            if (!liveSettings.muteOriginal) {
              const liveVol = liveSettings.originalVolume ?? originalVolume;
              video.volume = Math.max(0, Math.min(1, (liveVol * 0.15) / 100));
            }
          }
        }, delayToStart);

        setTimeout(() => {
          if (sessionRef === context.getActiveSession?.() && sessionRef.token === context.getPageToken?.()) {
            const liveSettings = context.getSettings?.() || settings;
            if (!liveSettings.muteOriginal) {
              if (audioCtx.currentTime >= (sessionRef.duckUntil || 0) - 0.05) {
                const liveVol = liveSettings.originalVolume ?? originalVolume;
                video.volume = Math.max(0, Math.min(1, liveVol / 100));
              }
            }
          }
        }, delayToEnd);
      }
    }
    return true;
  }

  window.LumeoStandardPipeline = {
    __loaded: true,
    DEFAULT_CHUNK_MS,
    MIN_CHUNK_BYTES,
    RECORDER_MIMES,
    pickRecorderMime,
    shouldProcessChunk,
    MAX_READY_CHUNKS,
    MAX_WAIT_MS,
    DRAIN_TICK_MS,
    MAX_FIT_RATE,
    MAX_CATCHUP_RATE,
    LATE_GRACE_SECONDS,
    computeDubTiming,
    clearDubTextTimers,
    stopDubPlayback,
    runChunkLoop,
    processChunk,
    enqueueOrderedDub,
    drainOrderedDub,
    resetDubState,
    playDubItem,
  };
})();
