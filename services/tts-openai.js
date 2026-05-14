// Lumeo OpenAI TTS service — used by the Caption tier (spoken playback of
// translated lines) and by the planned OpenAI direct Standard pipeline
// (chunked dub without Kyma). Returns an audio element / blob so callers can
// route the output through their own GainNode and volume controls.

(() => {
  "use strict";

  if (window.LumeoOpenAITTS?.__loaded) return;

  const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";
  const DEFAULT_MODEL = "tts-1";
  const DEFAULT_VOICE = "alloy";
  const DEFAULT_FORMAT = "mp3";

  const VOICES = Object.freeze([
    "alloy", "echo", "fable", "onyx", "nova", "shimmer",
  ]);

  const cache = new Map();
  let currentAudio = null;

  function assertKey(apiKey) {
    const key = String(apiKey || "").trim();
    if (!key) throw new Error("OpenAI API key is missing.");
    return key;
  }

  function stop() {
    if (currentAudio) {
      try {
        currentAudio.pause();
      } catch {
        // Element may already be detached.
      }
      currentAudio = null;
    }
  }

  // Fetch a synthesized audio blob. Cached by (voice, format, speed, text)
  // so replays of the same caption line during scrubbing do not burn credits.
  async function synthesize(text, options = {}) {
    const clean = String(text || "").trim();
    if (!clean) return null;
    const voice = options.voice || DEFAULT_VOICE;
    const format = options.format || DEFAULT_FORMAT;
    const speed = Number(options.speed || 1);
    const cacheKey = [voice, format, speed, clean].join("\u0001");
    let blobUrl = cache.get(cacheKey);
    if (blobUrl) return blobUrl;

    const key = assertKey(options.apiKey);
    const response = await fetch(OPENAI_TTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: options.model || DEFAULT_MODEL,
        voice,
        input: clean,
        format,
        speed,
      }),
      signal: options.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `OpenAI TTS ${response.status}: ${String(detail).slice(0, 200)}`
      );
    }
    const blob = await response.blob();
    blobUrl = URL.createObjectURL(blob);
    cache.set(cacheKey, blobUrl);
    return blobUrl;
  }

  // Fire-and-forget playback helper matching LumeoTTS.speak semantics so
  // pipelines/caption.js can swap providers without refactoring call sites.
  async function speak(text, lang, options = {}) {
    const url = await synthesize(text, options);
    if (!url) return false;
    stop();
    currentAudio = new Audio(url);
    currentAudio.volume = Number(options.volume ?? 1);
    if (typeof options.onEnd === "function") {
      currentAudio.addEventListener("ended", options.onEnd, { once: true });
    }
    await currentAudio.play();
    return true;
  }

  window.LumeoOpenAITTS = {
    __loaded: true,
    OPENAI_TTS_URL,
    VOICES,
    synthesize,
    speak,
    stop,
    clearCache: () => {
      for (const url of cache.values()) {
        try { URL.revokeObjectURL(url); } catch {}
      }
      cache.clear();
    },
  };
})();
