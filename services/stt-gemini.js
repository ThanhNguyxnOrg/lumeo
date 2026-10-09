// Lumeo Gemini STT service — Multimodal Audio Speech-to-Text fallback for
// Caption tier videos that expose no caption track.
// Uses Google Gemini 2.5/1.5 Flash Free Tier (15 RPM free, zero cost).
//
// Transport: we capture YouTube audio with captureStream() (no
// getDisplayMedia permission prompt) and upload 15s WAV chunks as inlineData
// to Gemini's generateContent endpoint.

(() => {
  "use strict";

  if (window.LumeoGeminiSTT?.__loaded) return;

  const DEFAULT_MODEL = "gemini-2.5-flash-lite";
  const DEFAULT_CHUNK_MS = 15_000;
  const MIN_CHUNK_BYTES = 2000;

  function assertKey(apiKey) {
    const key = String(apiKey || "").trim();
    if (!key) throw new Error("Gemini API key is missing.");
    return key;
  }

  async function blobToBase64(blob) {
    if (typeof FileReader !== "undefined") {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const res = String(reader.result || "");
          const base64 = res.includes(",") ? res.split(",")[1] : res;
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  async function transcribeBlob(wavBlob, options = {}) {
    const key = assertKey(options.apiKey);
    const model = options.model || DEFAULT_MODEL;
    const base64Data = await blobToBase64(wavBlob);

    const promptText = options.language
      ? `Transcribe the spoken speech in this audio snippet accurately. Output ONLY the verbatim transcript text. If silence or no speech, output nothing.`
      : "Transcribe the spoken speech in this audio snippet accurately. Output ONLY the verbatim transcript text. If silence or no speech, output nothing.";

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

    const payload = {
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: "audio/wav",
                data: base64Data,
              },
            },
            {
              text: promptText,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: options.signal,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data?.error?.message || data?.error || `Gemini HTTP ${response.status}`;
      throw new Error(String(detail).slice(0, 240));
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return {
      text: String(text).trim(),
      language: options.language || "",
      segments: [],
    };
  }

  class GeminiTranscribeLoop {
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
      this.cycleTimer = null;
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
          } catch {}
        }
      };

      const cycle = () => {
        if (this.stopped || !this.recorder) return;
        try {
          this.recorder.start();
          this.cycleTimer = setTimeout(() => {
            this.cycleTimer = null;
            if (this.stopped || !this.recorder) return;
            try {
              if (this.recorder.state === "recording") this.recorder.stop();
            } catch {}
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
      if (this.cycleTimer) {
        clearTimeout(this.cycleTimer);
        this.cycleTimer = null;
      }
      try {
        this.abortController.abort();
      } catch {}
      if (this.recorder) {
        try {
          if (this.recorder.state === "recording") this.recorder.stop();
        } catch {}
        this.recorder = null;
      }
    }
  }

  window.LumeoGeminiSTT = {
    __loaded: true,
    DEFAULT_MODEL,
    DEFAULT_CHUNK_MS,
    MIN_CHUNK_BYTES,
    transcribeBlob,
    create: (options) => new GeminiTranscribeLoop(options),
  };
})();
