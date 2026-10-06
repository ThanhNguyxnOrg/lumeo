(() => {
  "use strict";

  if (window.LumeoTTS?.__loaded) return;

  const LANG_CODE_MAP = {
    "zh-CN": "cmn-CN",
    "zh-TW": "cmn-TW",
    en: "en-US",
    pt: "pt-BR",
    es: "es-ES",
    fr: "fr-FR",
    de: "de-DE",
    ja: "ja-JP",
    ko: "ko-KR",
    vi: "vi-VN",
    th: "th-TH",
    id: "id-ID",
    ar: "ar-XA",
    hi: "hi-IN",
    ru: "ru-RU",
    it: "it-IT",
    nl: "nl-NL",
    pl: "pl-PL",
    tr: "tr-TR",
    uk: "uk-UA",
  };

  const MAX_GOOGLE_AUDIO_CACHE = 100;
  const googleAudioCache = new Map();
  let currentAudio = null;
  let lastCustomVoiceUrl = null;
  let cachedVoices = [];

  function populateVoices() {
    try {
      if (typeof speechSynthesis !== "undefined") {
        const v = speechSynthesis.getVoices();
        if (v && v.length) cachedVoices = v;
      }
    } catch {}
    return cachedVoices;
  }
  populateVoices();
  if (typeof speechSynthesis !== "undefined") {
    speechSynthesis.addEventListener?.("voiceschanged", populateVoices);
    if (speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = populateVoices;
    }
  }

  function normalizeLang(lang) {
    return LANG_CODE_MAP[lang] || lang || "en-US";
  }

  function baseLang(lang) {
    return String(lang || "").split("-")[0].toLowerCase();
  }

  function stripTtsNoise(text) {
    return String(text || "")
      .replace(/\[[^\]]*\]|\([^)]*\)/g, "")
      .replace(/[>><<»«♪♫♬★☆#*~|\\{}[\]]/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function getVoicesForLang(lang) {
    const list = cachedVoices.length ? cachedVoices : populateVoices();
    const wanted = baseLang(lang);
    return list.filter((voice) =>
      baseLang(voice.lang) === wanted ||
      voice.lang.toLowerCase().startsWith(`${wanted}-`)
    );
  }

  function getVoiceByName(name) {
    if (!name) return null;
    const list = cachedVoices.length ? cachedVoices : populateVoices();
    return list.find((voice) => voice.name === name) || null;
  }

  let activeUtterance = null;

  function stop() {
    try { speechSynthesis.cancel(); } catch {}
    activeUtterance = null;
    if (currentAudio) {
      try { currentAudio.pause(); } catch {}
      currentAudio = null;
    }
    if (lastCustomVoiceUrl) {
      try { URL.revokeObjectURL(lastCustomVoiceUrl); } catch {}
      lastCustomVoiceUrl = null;
    }
  }

  async function speakBrowser(text, lang, options = {}) {
    const clean = stripTtsNoise(text);
    if (!clean) return false;
    const voice = getVoiceByName(options.voiceName) || getVoicesForLang(lang)[0] || null;
    stop();
    const utterance = new SpeechSynthesisUtterance(clean);
    activeUtterance = utterance;
    utterance.onend = () => { if (activeUtterance === utterance) activeUtterance = null; };
    utterance.onerror = () => { if (activeUtterance === utterance) activeUtterance = null; };
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang || normalizeLang(lang);
    } else {
      utterance.lang = normalizeLang(lang);
    }
    utterance.rate = Number(options.rate || 1.15);
    utterance.pitch = Number(options.pitch || 1);
    utterance.volume = Number(options.volume ?? 1);
    speechSynthesis.speak(utterance);
    return true;
  }

  async function speakGoogleCloud(text, lang, options = {}) {
    const clean = stripTtsNoise(text);
    if (!clean) return false;
    const apiKey = String(options.googleCloudKey || options.apiKey || "").trim();
    if (!apiKey) throw new Error("Google Cloud Text-to-Speech API key is missing.");
    const languageCode = normalizeLang(lang);
    const voiceName = options.voiceName || "Achernar";
    const cacheKey = [
      languageCode,
      voiceName,
      options.rate || 1,
      clean,
    ].join("\u0001");
    let audioUrl = googleAudioCache.get(cacheKey);
    if (!audioUrl) {
      const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { text: clean },
          voice: {
            languageCode,
            name: `${languageCode}-Chirp3-HD-${voiceName}`,
          },
          audioConfig: {
            audioEncoding: "MP3",
            speakingRate: Number(options.rate || 1),
          },
        }),
        signal: options.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error?.message || `Google TTS HTTP ${response.status}`);
      }
      const bytes = Uint8Array.from(atob(data.audioContent || ""), (char) => char.charCodeAt(0));
      audioUrl = URL.createObjectURL(new Blob([bytes], { type: "audio/mp3" }));
      if (googleAudioCache.size >= MAX_GOOGLE_AUDIO_CACHE) {
        const oldestKey = googleAudioCache.keys().next().value;
        const oldUrl = googleAudioCache.get(oldestKey);
        try { URL.revokeObjectURL(oldUrl); } catch {}
        googleAudioCache.delete(oldestKey);
      }
      googleAudioCache.set(cacheKey, audioUrl);
    }
    stop();
    currentAudio = new Audio(audioUrl);
    currentAudio.volume = Number(options.volume ?? 1);
    await currentAudio.play();
    return true;
  }

  async function speakCustomVoice(text, lang, options = {}) {
    const clean = stripTtsNoise(text);
    if (!clean) return false;
    const base = String(options.customTtsBaseUrl || "").trim().replace(/\/+$/, "");
    const voiceId = String(options.customTtsVoiceId || "").trim();
    const apiKey = String(options.customTtsApiKey || "").trim();
    if (!base) throw new Error("Custom Voice Base URL is required.");
    if (!voiceId) throw new Error("Custom Voice ID is required.");

    let targetUrl;
    const headers = { "Content-Type": "application/json" };
    let body;

    const modelId = String(options.customTtsModelId || "").trim();
    if (base.includes("elevenlabs")) {
      targetUrl = `${base}/text-to-speech/${encodeURIComponent(voiceId)}`;
      if (apiKey) headers["xi-api-key"] = apiKey;
      body = JSON.stringify({
        text: clean,
        model_id: modelId || "eleven_turbo_v2_5",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      });
    } else {
      targetUrl = base.endsWith("/audio/speech") ? base : `${base}/audio/speech`;
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      body = JSON.stringify({
        input: clean,
        voice: voiceId,
        model: modelId || "tts-1",
      });
    }

    const response = await fetch(targetUrl, {
      method: "POST",
      headers,
      body,
      signal: options.signal,
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData?.detail?.message || errData?.error?.message || `Custom Voice HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const audioUrl = URL.createObjectURL(blob);
    stop();
    lastCustomVoiceUrl = audioUrl;
    currentAudio = new Audio(audioUrl);
    currentAudio.volume = Number(options.volume ?? 1);
    await currentAudio.play();
    return true;
  }

  async function speak(text, lang, options = {}) {
    const provider = options.provider || "browser";
    if (provider === "custom-voice-engine") {
      try {
        return await speakCustomVoice(text, lang, options);
      } catch (err) {
        console.warn("[TTS] Custom voice failed, falling back to browser TTS:", err);
        options.onFailover?.({ from: "custom-voice-engine", to: "browser", error: err.message });
        return speakBrowser(text, lang, options);
      }
    }
    if (provider === "google-cloud") {
      try {
        return await speakGoogleCloud(text, lang, options);
      } catch (err) {
        console.warn("[TTS] Google Cloud TTS failed, falling back to browser TTS:", err);
        options.onFailover?.({ from: "google-cloud", to: "browser", error: err.message });
        return speakBrowser(text, lang, options);
      }
    }
    if (provider === "openai-tts" || provider === "openai") {
      if (!window.LumeoOpenAITTS) throw new Error("OpenAI TTS service is not loaded.");
      try {
        return await window.LumeoOpenAITTS.speak(text, lang, {
          apiKey: options.openaiKey,
          voice: options.openaiVoice || "alloy",
          speed: options.rate || 1,
          volume: options.volume ?? 1,
        });
      } catch (err) {
        console.warn("[TTS] OpenAI TTS failed, falling back to browser TTS:", err);
        options.onFailover?.({ from: "openai-tts", to: "browser", error: err.message });
        return speakBrowser(text, lang, options);
      }
    }
    return speakBrowser(text, lang, options);
  }

  window.LumeoTTS = {
    __loaded: true,
    LANG_CODE_MAP,
    normalizeLang,
    getVoicesForLang,
    speak,
    speakBrowser,
    speakGoogleCloud,
    speakCustomVoice,
    stop,
  };
})();

