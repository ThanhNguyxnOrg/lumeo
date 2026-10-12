(() => {
  "use strict";

  if (window.LumeoTTS?.__loaded) return;

  // Cloud languageCode per target language (BCP-47). Covers every popup
  // CAPTION_LANGUAGES code; locales without a Cloud voice fail fast into the
  // browser failover (see CHIRP3_HD_LOCALES below) instead of a late HTTP error.
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
    ms: "ms-MY",
    fil: "fil-PH",
    my: "my-MM",
    km: "km-KH",
    lo: "lo-LA",
    bn: "bn-IN",
    ta: "ta-IN",
    te: "te-IN",
    ur: "ur-IN",
    ar: "ar-XA",
    fa: "fa-IR",
    he: "he-IL",
    tr: "tr-TR",
    nl: "nl-NL",
    pl: "pl-PL",
    ro: "ro-RO",
    cs: "cs-CZ",
    sv: "sv-SE",
    da: "da-DK",
    fi: "fi-FI",
    no: "nb-NO",
    el: "el-GR",
    hu: "hu-HU",
    uk: "uk-UA",
    id: "id-ID",
    hi: "hi-IN",
    ru: "ru-RU",
    it: "it-IT",
    // Long-tail entries below are provisional BCP-47 placeholders: they make
    // browser prefix-matching work for every caption code, but Cloud requests
    // are gated by CHIRP3_HD_LOCALES first, so unverified codes (jw-ID vs jv,
    // yi-001, la-VA, sm-WS, …) can only affect error-message text, never ship
    // an invalid request. Verify against Cloud docs before allowlisting any.
    af: "af-ZA",
    sq: "sq-AL",
    am: "am-ET",
    hy: "hy-AM",
    az: "az-AZ",
    eu: "eu-ES",
    be: "be-BY",
    bs: "bs-BA",
    bg: "bg-BG",
    ca: "ca-ES",
    hr: "hr-HR",
    et: "et-EE",
    ka: "ka-GE",
    gl: "gl-ES",
    gu: "gu-IN",
    ht: "ht-HT",
    ha: "ha-NG",
    is: "is-IS",
    ig: "ig-NG",
    ga: "ga-IE",
    jw: "jw-ID",
    kn: "kn-IN",
    kk: "kk-KZ",
    rw: "rw-RW",
    ku: "ku-TR",
    ky: "ky-KG",
    la: "la-VA",
    lv: "lv-LV",
    lt: "lt-LT",
    lb: "lb-LU",
    mk: "mk-MK",
    mg: "mg-MG",
    ml: "ml-IN",
    mt: "mt-MT",
    mi: "mi-NZ",
    mr: "mr-IN",
    mn: "mn-MN",
    ne: "ne-NP",
    ny: "ny-MW",
    or: "or-IN",
    ps: "ps-AF",
    pa: "pa-IN",
    sm: "sm-WS",
    gd: "gd-GB",
    sr: "sr-RS",
    st: "st-ZA",
    sn: "sn-ZW",
    sd: "sd-PK",
    si: "si-LK",
    sk: "sk-SK",
    sl: "sl-SI",
    so: "so-SO",
    su: "su-ID",
    sw: "sw-KE",
    tg: "tg-TJ",
    tt: "tt-RU",
    tk: "tk-TM",
    ug: "ug-CN",
    uz: "uz-UZ",
    cy: "cy-GB",
    xh: "xh-ZA",
    yi: "yi-001",
    yo: "yo-NG",
    zu: "zu-ZA",
    zh: "cmn-CN",
  };

  // Locales with a Chirp3-HD voice (first-party table 2026-10-09). Locales
  // outside this set fail fast to browser TTS instead of a guaranteed HTTP error.
  // Note: cmn-TW is intentionally absent (Chirp table lists cmn-CN + yue-HK
  // only), so Traditional Chinese is browser-only by design; yue-HK/nl-BE/
  // en-AU-IN-GB/fr-CA/es-US entries are kept for completeness though no map
  // entry produces them today.
  const CHIRP3_HD_LOCALES = new Set([
    "ar-XA", "bn-IN", "bg-BG", "yue-HK", "hr-HR", "cs-CZ", "da-DK", "nl-BE",
    "nl-NL", "en-AU", "en-IN", "en-GB", "en-US", "et-EE", "fi-FI", "fr-CA",
    "fr-FR", "de-DE", "el-GR", "gu-IN", "he-IL", "hi-IN", "hu-HU", "id-ID",
    "it-IT", "ja-JP", "kn-IN", "ko-KR", "lv-LV", "lt-LT", "ml-IN", "cmn-CN",
    "mr-IN", "nb-NO", "pl-PL", "pt-BR", "pa-IN", "ro-RO", "ru-RU", "sr-RS",
    "sk-SK", "sl-SI", "es-ES", "es-US", "sw-KE", "sv-SE", "ta-IN", "te-IN",
    "th-TH", "tr-TR", "uk-UA", "ur-IN", "vi-VN",
  ]);

  // Browser utterance.lang must be BCP-47, never a Cloud-only code: map the
  // Cloud codes back (cmn-* → zh-*, ar-XA → ar-SA).
  const BROWSER_LANG_OVERRIDES = {
    "zh-CN": "zh-CN",
    "zh-TW": "zh-TW",
    zh: "zh-CN",
    ar: "ar-SA",
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

  // BCP-47 code for speechSynthesis utterance.lang (never a Cloud-only code).
  function browserLang(lang) {
    const raw = String(lang || "");
    if (BROWSER_LANG_OVERRIDES[raw]) return BROWSER_LANG_OVERRIDES[raw];
    const cloud = LANG_CODE_MAP[raw] || raw || "en-US";
    if (/^cmn-/i.test(cloud)) return `zh-${cloud.slice(4).toUpperCase()}`;
    if (/^ar-XA$/i.test(cloud)) return "ar-SA";
    return cloud;
  }

  // Voice-tag aliases: full tags that name the same language across platforms.
  const LANG_TAG_ALIASES = {
    fil: ["fil", "tl"],
    tl: ["tl", "fil"],
    no: ["no", "nb", "nn"],
    nb: ["nb", "no", "nn"],
    nn: ["nn", "no", "nb"],
    zh: ["zh", "cmn", "yue"],
    "zh-cn": ["zh-cn", "cmn-cn"],
    "zh-tw": ["zh-tw", "cmn-tw"],
    cmn: ["cmn", "zh", "yue"],
    yue: ["yue", "zh", "cmn"],
  };

  function normTag(tag) {
    return String(tag || "").toLowerCase();
  }

  // Separator-aware match: full-tag equality (incl. aliases) wins, then
  // base-language prefix with an explicit "-" separator (never bare prefix,
  // so "th" never matches a hypothetical "the-*" tag).
  function voiceTagMatches(voiceLang, wanted) {
    const v = normTag(voiceLang);
    const w = normTag(wanted);
    if (!v || !w) return false;
    if (v === w) return true;
    const aliases = LANG_TAG_ALIASES[w] || LANG_TAG_ALIASES[w.split("-")[0]] || [];
    if (aliases.includes(v) || aliases.includes(v.split("-")[0])) return true;
    const wBase = w.split("-")[0];
    return v === wBase || v.startsWith(`${wBase}-`);
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
    const wanted = normTag(lang);
    const exact = [];
    const broad = [];
    for (const voice of list) {
      if (!voice?.lang) continue;
      const v = normTag(voice.lang);
      if (v === wanted) {
        exact.push(voice);
      } else if (voiceTagMatches(voice.lang, lang)) {
        broad.push(voice);
      }
    }
    return [...exact, ...broad];
  }

  function getVoiceByName(name) {
    if (!name) return null;
    const list = cachedVoices.length ? cachedVoices : populateVoices();
    return list.find((voice) => voice.name === name) || null;
  }

  let activeUtterance = null;

  // Cancel in-flight browser speech WITHOUT touching network-audio handles.
  // Cloud/custom paths must preempt a failing-over browser utterance (no
  // overlap), but must not revoke blob URLs the way stop() does.
  function stopSpeechOnly() {
    try {
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    } catch {}
    activeUtterance = null;
  }

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
    const langVoices = getVoicesForLang(lang);
    const autoVoice = (typeof window !== "undefined" && window.LumeoVoicePicker?.autoPairVoice)
      ? window.LumeoVoicePicker.autoPairVoice(lang, langVoices)
      : langVoices[0];
    const voice = getVoiceByName(options.voiceName) || autoVoice || null;
    stop();
    const utterance = new SpeechSynthesisUtterance(clean);
    activeUtterance = utterance;
    utterance.onend = () => { if (activeUtterance === utterance) activeUtterance = null; };
    utterance.onerror = () => { if (activeUtterance === utterance) activeUtterance = null; };
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang || browserLang(lang);
    } else {
      utterance.lang = browserLang(lang);
    }
    utterance.rate = Number(options.rate || 1.0);
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
    if (!CHIRP3_HD_LOCALES.has(languageCode)) {
      throw new Error(`Google Cloud TTS has no Chirp3-HD voice for ${languageCode}; falling back to browser voice.`);
    }
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
    if (currentAudio) {
      try { currentAudio.pause(); } catch {}
      currentAudio = null;
    }
    stopSpeechOnly();
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
    if (currentAudio) {
      try { currentAudio.pause(); } catch {}
      currentAudio = null;
    }
    if (lastCustomVoiceUrl) {
      try { URL.revokeObjectURL(lastCustomVoiceUrl); } catch {}
    }
    lastCustomVoiceUrl = audioUrl;
    stopSpeechOnly();
    currentAudio = new Audio(audioUrl);
    currentAudio.volume = Number(options.volume ?? 1);
    // ElevenLabs/custom has no synthesis speed param: apply fitted rate post-hoc (0.90-1.10) so network voices keep up without re-synthesis.
    currentAudio.playbackRate = Math.min(1.1, Math.max(0.9, Number(options.rate || 1)));
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
    CHIRP3_HD_LOCALES,
    normalizeLang,
    browserLang,
    getVoicesForLang,
    speak,
    speakBrowser,
    speakGoogleCloud,
    speakCustomVoice,
    stop,
  };
})();

