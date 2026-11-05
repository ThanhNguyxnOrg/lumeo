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
    if (!sessionRef) return;
    sessionRef.dubState = null;
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
    context.onSourceText?.(sourceText);

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
    context.onTargetText?.(targetText);

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

    enqueueOrderedDub(sessionRef, chunkMeta, audioBuffer, context);
    context.onChunkDone?.();
  }

  function playDubItem(sessionRef, audioBuffer, context = {}, meta = {}) {
    if (!sessionRef || !audioBuffer || !sessionRef.audioCtx) return;
    if (sessionRef.nextPlayAt < sessionRef.audioCtx.currentTime) sessionRef.nextPlayAt = 0;
    // Backlog guard: tighter 1.10 cap trades chipmunking for queue drift under sustained
    // expansion (e.g. 6s speech per 5s chunk drifts +0.45s/chunk). Fast-forward instead of
    // queueing unbounded lag; current (fresher) chunk wins over stale backlog.
    if (sessionRef.nextPlayAt - sessionRef.audioCtx.currentTime > 2.0) {
      sessionRef.nextPlayAt = sessionRef.audioCtx.currentTime + 0.05;
    }
    const startAt = Math.max(sessionRef.audioCtx.currentTime + 0.05, sessionRef.nextPlayAt);
    const source = sessionRef.audioCtx.createBufferSource();
    source.buffer = audioBuffer;

    const settings = context.getSettings?.() || {};
    const video = typeof context.getVideo === "function" ? context.getVideo() : null;
    const fitPlaybackRate = Number(video?.playbackRate) || 1;
    const chunkSeconds = (Number(meta.sourceEndMs) - Number(meta.sourceStartMs)) / 1000;
    const targetDuration = (chunkSeconds > 0 ? chunkSeconds : 5.0) / fitPlaybackRate;
    const ttsDuration = audioBuffer.duration;
    const speedRatio = ttsDuration / targetDuration;
    let rate = 1.0;
    if (speedRatio > 1.05) {
      rate = Math.min(speedRatio, 1.1);
    }
    if (source.playbackRate) {
      source.playbackRate.value = rate;
    }
    const duration = ttsDuration / rate;

    source.connect(sessionRef.outputGain);
    sessionRef.activeSources = sessionRef.activeSources || new Set();
    sessionRef.activeSources.add(source);
    if (typeof source.addEventListener === "function") {
      source.addEventListener("ended", () => {
        sessionRef.activeSources?.delete(source);
      });
    } else {
      source.onended = () => {
        sessionRef.activeSources?.delete(source);
      };
    }
    try { source.start(startAt); } catch {}
    sessionRef.nextPlayAt = startAt + duration;

    if (video) {
      if (settings.muteOriginal) {
        video.muted = true;
        video.volume = 0;
      } else {
        const originalVolume = settings.originalVolume ?? 18;
        const endAt = startAt + duration;
        sessionRef.duckUntil = Math.max(sessionRef.duckUntil || 0, endAt);

        const delayToStart = Math.max(0, (startAt - sessionRef.audioCtx.currentTime) * 1000);
        const delayToEnd = Math.max(0, (endAt - sessionRef.audioCtx.currentTime) * 1000);

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
              if (sessionRef.audioCtx.currentTime >= (sessionRef.duckUntil || 0) - 0.05) {
                const liveVol = liveSettings.originalVolume ?? originalVolume;
                video.volume = Math.max(0, Math.min(1, liveVol / 100));
              }
            }
          }
        }, delayToEnd);
      }
    }
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
    runChunkLoop,
    processChunk,
    enqueueOrderedDub,
    drainOrderedDub,
    resetDubState,
    playDubItem,
  };
})();
