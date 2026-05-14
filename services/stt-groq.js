// Lumeo Groq STT service — OpenAI-compatible speech-to-text fallback for
// Caption tier videos that expose no caption track. Preferred over the
// Soniox fallback because Groq's Whisper Large v3 Turbo runs at ~216x
// real-time and costs ~$0.02/hour versus Soniox at ~$0.12/hour.
//
// Transport: we capture YouTube audio with captureStream() (no
// getDisplayMedia permission prompt) and upload 10s WAV chunks to Groq's
// /openai/v1/audio/transcriptions endpoint. Each chunk is self-contained so
// transient network errors only lose one chunk, never the whole session.

(() => {
  "use strict";

  if (window.LumeoGroqSTT?.__loaded) return;

  const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
  const DEFAULT_MODEL = "whisper-large-v3-turbo";
  // Groq enforces a 10s minimum per request, 25MB max. 10s WAV 16 kHz mono
  // is ~320KB — well inside the budget. Push to 15s to reduce per-call
  // overhead (~100ms) without making the caption feed feel laggy.
  const DEFAULT_CHUNK_MS = 15_000;
  const MIN_CHUNK_BYTES = 2000;

  function assertKey(apiKey) {
    const key = String(apiKey || "").trim();
    if (!key) throw new Error("Groq API key is missing.");
    return key;
  }

  // Transcribe a single WAV blob. Returns { text, language } on success.
  // Throws on HTTP or network errors so the caller can decide whether to
  // skip the chunk or tear down the session.
  async function transcribeBlob(wavBlob, options = {}) {
    const key = assertKey(options.apiKey);
    const model = options.model || DEFAULT_MODEL;
    const form = new FormData();
    form.append("file", wavBlob, "chunk.wav");
    form.append("model", model);
    form.append("response_format", "verbose_json");
    if (options.language) form.append("language", options.language);
    if (options.prompt) form.append("prompt", options.prompt);
    if (options.temperature != null) {
      form.append("temperature", String(options.temperature));
    }
    const response = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: options.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail =
        data?.error?.message || data?.error || `Groq HTTP ${response.status}`;
      throw new Error(String(detail).slice(0, 240));
    }
    return {
      text: String(data.text || "").trim(),
      language: data.language || "",
      segments: Array.isArray(data.segments) ? data.segments : [],
    };
  }

  // Drive a continuous transcribe loop over a MediaStream. Each chunk goes
  // through the shared WAV encoder in lib/audio-utils.js so the output is
  // identical to what the Standard pipeline uploads to Kyma.
  class GroqTranscribeLoop {
    constructor(options = {}) {
      this.stream = options.stream;
      this.apiKey = options.apiKey;
      this.model = options.model || DEFAULT_MODEL;
      this.language = options.language || "";
      this.chunkMs = options.chunkMs || DEFAULT_CHUNK_MS;
      this.onText = options.onText || (() => {});
      this.onError = options.onError || (() => {});
      this.abortController = new AbortController();
      this.recorder = null;
      this.stopped = false;
    }

    start() {
      if (this.recorder) return;
      const audioUtils = window.LumeoAudioUtils;
      if (!audioUtils) {
        throw new Error("LumeoAudioUtils not loaded — load lib/audio-utils.js first.");
      }
      const mime = audioUtils.pickRecorderMime();
      if (!mime) throw new Error("No supported MediaRecorder mime type.");
      this.recorder = new MediaRecorder(this.stream, { mimeType: mime });
      this.recorder.ondataavailable = async (event) => {
        if (this.stopped) return;
        const blob = event.data;
        if (!blob || blob.size < MIN_CHUNK_BYTES) return;
        try {
          const wav = await audioUtils.webmBlobToWav(blob);
          const result = await transcribeBlob(wav, {
            apiKey: this.apiKey,
            model: this.model,
            language: this.language,
            signal: this.abortController.signal,
          });
          if (!this.stopped && result.text) this.onText(result);
        } catch (err) {
          if (err?.name === "AbortError" || this.stopped) return;
          try {
            this.onError(err);
          } catch {
            // Caller handler threw; nothing more to do here.
          }
        }
      };
      // Cycle recorder per chunk: each blob becomes a self-contained file so
      // Whisper does not need to reassemble container fragments.
      const cycle = () => {
        if (this.stopped || !this.recorder) return;
        try {
          this.recorder.start();
          setTimeout(() => {
            if (this.stopped || !this.recorder) return;
            try {
              if (this.recorder.state === "recording") this.recorder.stop();
            } catch {
              // Recorder already torn down; stop() will no-op.
            }
            cycle();
          }, this.chunkMs);
        } catch (err) {
          this.onError(err);
        }
      };
      cycle();
    }

    stop() {
      this.stopped = true;
      try {
        this.abortController.abort();
      } catch {
        // Safe to ignore; upstream fetches will reject with AbortError.
      }
      try {
        if (this.recorder?.state === "recording") this.recorder.stop();
      } catch {
        // Recorder may already be inactive.
      }
      this.recorder = null;
    }
  }

  window.LumeoGroqSTT = {
    __loaded: true,
    GROQ_URL,
    DEFAULT_MODEL,
    transcribeBlob,
    GroqTranscribeLoop,
    create: (options) => new GroqTranscribeLoop(options),
  };
})();
