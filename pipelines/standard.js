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

      sessionRef.activeRecorder = recorder;
      const parts = [];
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data && event.data.size > 0) parts.push(event.data);
      });
      recorder.addEventListener("stop", () => {
        if (sessionRef !== getActiveSession() || sessionRef.stopFlag) return;
        if (parts.length) {
          const blob = new BlobCtor(parts, { type: sessionRef.recorderMime });
          processChunk(sessionRef, blob).catch(() => {});
        }
        cycle();
      });

      try {
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
    const language = settings.targetLanguage || "vi";
    const languageName = context.langNameByCode?.[language] || language;
    const voiceId = settings.standardVoice || context.standardDefaultVoice || "English_magnetic_voiced_man";
    const kymaBase = context.kymaBase || "https://api.kymaapi.com/v1";
    const audioUtils = context.audioUtils || window.LumeoAudioUtils;
    const fetchFn = context.fetch || fetch;
    const FormDataCtor = context.FormData || FormData;
    const parseKymaError = context.parseKymaError || ((status, body) => ({ status, user: body || "Pipeline error" }));
    const isCurrent = () => sessionRef === context.getActiveSession?.() && sessionRef.token === context.getPageToken?.();

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

    let translationResponse;
    try {
      translationResponse = await fetchFn(`${kymaBase}/chat/completions`, {
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
              content: `You are a live dubbing translator. Translate the user's sentence into ${languageName}. Output ONLY the translation. No quotes, no commentary, no explanation, no labels. Preserve names, brand names, and technical terms verbatim.`,
            },
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

    if (sessionRef.nextPlayAt < sessionRef.audioCtx.currentTime) sessionRef.nextPlayAt = 0;
    const startAt = Math.max(sessionRef.audioCtx.currentTime + 0.05, sessionRef.nextPlayAt);
    const source = sessionRef.audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(sessionRef.outputGain);
    try { source.start(startAt); } catch {}
    sessionRef.nextPlayAt = startAt + audioBuffer.duration;
    context.onChunkDone?.();
  }

  window.LumeoStandardPipeline = {
    __loaded: true,
    DEFAULT_CHUNK_MS,
    MIN_CHUNK_BYTES,
    RECORDER_MIMES,
    pickRecorderMime,
    shouldProcessChunk,
    runChunkLoop,
    processChunk,
  };
})();
