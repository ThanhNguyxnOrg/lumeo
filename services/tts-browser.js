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

  const googleAudioCache = new Map();
  let currentAudio = null;

  function normalizeLang(lang) {
    return LANG_CODE_MAP[lang] || lang || "en-US";
  }

  function baseLang(lang) {
    return String(lang || "").split("-")[0].toLowerCase();
  }

  function stripTtsNoise(text) {
    return String(text || "")
      .replace(/[>><<»«♪♫♬★☆#*~|\\{}[\]]/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function getVoicesForLang(lang) {
    const wanted = baseLang(lang);
    return speechSynthesis.getVoices().filter((voice) =>
      baseLang(voice.lang) === wanted ||
      voice.lang.toLowerCase().startsWith(`${wanted}-`)
    );
  }

  function getVoiceByName(name) {
    if (!name) return null;
    return speechSynthesis.getVoices().find((voice) => voice.name === name) || null;
  }

  function stop() {
    try { speechSynthesis.cancel(); } catch {}
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
  }

  async function speakBrowser(text, lang, options = {}) {
    const clean = stripTtsNoise(text);
    if (!clean) return false;
    const voice = getVoiceByName(options.voiceName) || getVoicesForLang(lang)[0] || null;
    if (!voice) throw new Error(`No browser voice found for ${lang}.`);
    stop();
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.voice = voice;
    utterance.lang = voice.lang || normalizeLang(lang);
    utterance.rate = Number(options.rate || 1);
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
      googleAudioCache.set(cacheKey, audioUrl);
    }
    stop();
    currentAudio = new Audio(audioUrl);
    currentAudio.volume = Number(options.volume ?? 1);
    await currentAudio.play();
    return true;
  }

  async function speak(text, lang, options = {}) {
    const provider = options.provider || "browser";
    if (provider === "google-cloud") {
      return speakGoogleCloud(text, lang, options);
    }
    if (provider === "openai-tts") {
      if (!window.LumeoOpenAITTS) throw new Error("OpenAI TTS service is not loaded.");
      return window.LumeoOpenAITTS.speak(text, lang, {
        apiKey: options.openaiKey,
        voice: options.openaiVoice || "alloy",
        speed: options.rate || 1,
        volume: options.volume ?? 1,
      });
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
    stop,
  };
})();
