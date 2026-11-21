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

  const MAX_AUDIO_CACHE = 100;
  const SPEECH_QUEUE_LIMIT = 2;
  const googleAudioCache = new Map();
  const customAudioCache = new Map();
  const googleAudioInflight = new Map();
  const customAudioInflight = new Map();
  const speechQueue = [];
  let queuePumping = false;
  let speechGeneration = 0;
  let activeAbortController = null;
  let currentAudio = null;
  let cachedVoices = [];

  // Measured speaking pace (speech units per second at 1.0x) and start latency
  // (seconds between asking for a line and hearing it), keyed by voice. The
  // caption orchestrator uses them to fit each line to its subtitle slot and
  // to start the voice early enough to land on the cue boundary.
  const paceByKey = new Map();
  const latencyByKey = new Map();
  const MAX_SPEECH_RATE = 2.0;

  function nowMs() {
    return typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  }

  function blend(map, key, sample) {
    const prev = map.get(key);
    map.set(key, prev == null ? sample : prev * 0.7 + sample * 0.3);
  }

  function recordPace(key, units, naturalSeconds) {
    const count = Number(units);
    const seconds = Number(naturalSeconds);
    // Very short lines are dominated by engine start/stop padding.
    if (!key || !(count >= 4) || !(seconds >= 0.6)) return;
    const pace = count / seconds;
    if (pace < 0.5 || pace > 20) return;
    blend(paceByKey, key, pace);
  }

  function recordLatency(key, seconds) {
    const value = Number(seconds);
    if (!key || !Number.isFinite(value) || value < 0 || value > 5) return;
    blend(latencyByKey, key, value);
  }

  function getPace(key) {
    return paceByKey.get(key) ?? null;
  }

  function getStartLatency(key) {
    return latencyByKey.get(key) ?? 0;
  }

  function clampRate(value, min = 0.5, max = 2.0) {
    const rate = Number(value);
    if (!Number.isFinite(rate) || rate <= 0) return 1.0;
    return Math.min(max, Math.max(min, rate));
  }

  function drainSpeechQueue() {
    while (speechQueue.length) {
      const task = speechQueue.shift();
      try {
        task.resolve(false);
      } catch {}
    }
  }

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
    speechGeneration += 1;
    try { activeAbortController?.abort(); } catch {}
    activeAbortController = null;
    drainSpeechQueue();
    try { speechSynthesis.cancel(); } catch {}
    activeUtterance = null;
    if (currentAudio) {
      try { currentAudio.pause(); } catch {}
      currentAudio = null;
    }
  }

  function speakTaskAndWait(text, lang, options = {}) {
    return new Promise((resolve) => {
      const generation = speechGeneration;
      const controller = new AbortController();
      activeAbortController = controller;
      let settled = false;
      const cleanLength = String(text || "").length;
      const defaultTimeout = Math.min(30000, Math.max(8000, cleanLength * 140));
      const timeoutMs = Number(options.stallTimeoutMs) > 0
        ? Number(options.stallTimeoutMs)
        : defaultTimeout;
      const timer = setTimeout(() => finish(false), timeoutMs);
      function finish(ok) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (activeAbortController === controller) activeAbortController = null;
        resolve(ok);
      }
      controller.signal.addEventListener("abort", () => finish(false), { once: true });
      const requestedAt = nowMs();
      const taskOptions = {
        ...options,
        signal: options.signal || controller.signal,
        onStart: () => {
          if (generation !== speechGeneration || settled) return;
          recordLatency(options.latencyKey, (nowMs() - requestedAt) / 1000);
        },
        onEnd: (ok) => finish(ok !== false),
      };
      Promise.resolve(speak(text, lang, taskOptions))
        .then((ok) => {
          if (generation !== speechGeneration || controller.signal.aborted) finish(false);
          else if (!ok) finish(false);
        })
        .catch(() => finish(false));
    });
  }

  async function pumpSpeechQueue() {
    if (queuePumping) return;
    queuePumping = true;
    try {
      while (speechQueue.length) {
        const task = speechQueue.shift();
        let stale = false;
        try {
          stale = task.options.isStale?.() === true;
        } catch {}
        if (stale) {
          try {
            task.options.onSkip?.({ text: task.text, reason: "stale" });
          } catch {}
          try {
            task.resolve(false);
          } catch {}
          continue;
        }
        let ok = false;
        try {
          // A queued line may start late because the previous line is still
          // playing. Recompute its rate at the moment it actually starts so a
          // stale queue cannot keep speaking at the pace it had when queued.
          if (typeof task.options.getRate === "function") {
            const nextRate = Number(task.options.getRate());
            if (Number.isFinite(nextRate)) task.options.rate = nextRate;
          }
          ok = await speakTaskAndWait(task.text, task.lang, task.options);
        } catch {}
        try {
          task.resolve(ok);
        } catch {}
      }
    } finally {
      queuePumping = false;
    }
  }

  // Queue a spoken line so a new cue never cuts off the line already playing.
  // When the backlog exceeds the limit, the oldest pending line is dropped and
  // the caller's onSkip callback is notified.
  function speakQueued(text, lang, options = {}) {
    return new Promise((resolve) => {
      // Purge lines that were waiting when the video already moved past them.
      for (let i = speechQueue.length - 1; i >= 0; i -= 1) {
        const pending = speechQueue[i];
        let stale = false;
        try {
          stale = pending.options.isStale?.() === true;
        } catch {}
        if (stale) {
          speechQueue.splice(i, 1);
          try {
            pending.options.onSkip?.({ text: pending.text, reason: "stale" });
          } catch {}
          try {
            pending.resolve(false);
          } catch {}
        }
      }
      const task = { text, lang, options, resolve };
      let alreadyStale = false;
      try {
        alreadyStale = options.isStale?.() === true;
      } catch {}
      if (alreadyStale) {
        try {
          options.onSkip?.({ text, reason: "stale" });
        } catch {}
        resolve(false);
        return;
      }
      if (speechQueue.length >= SPEECH_QUEUE_LIMIT) {
        const dropped = speechQueue.shift();
        try {
          dropped.options.onSkip?.({ text: dropped.text, reason: "backlog" });
        } catch {}
        try {
          dropped.resolve(false);
        } catch {}
      }
      speechQueue.push(task);
      void pumpSpeechQueue();
    });
  }

  async function speakBrowser(text, lang, options = {}) {
    const clean = stripTtsNoise(text);
    const langVoices = getVoicesForLang(lang);
    const autoVoice = (typeof window !== "undefined" && window.LumeoVoicePicker?.autoPairVoice)
      ? window.LumeoVoicePicker.autoPairVoice(lang, langVoices)
      : langVoices[0];
    const voice = getVoiceByName(options.voiceName) || autoVoice || null;
    if (currentAudio) {
      try { currentAudio.pause(); } catch {}
      currentAudio = null;
    }
    stopSpeechOnly();
    let finished = false;
    const finish = (ok = true) => {
      if (finished) return;
      finished = true;
      if (activeUtterance === utterance) activeUtterance = null;
      try { options.onEnd?.(ok); } catch {}
    };
    const utterance = new SpeechSynthesisUtterance(clean);
    activeUtterance = utterance;
    let startedAt = 0;
    utterance.onstart = () => {
      startedAt = nowMs();
      try { options.onStart?.(); } catch {}
    };
    utterance.onend = () => {
      if (startedAt) {
        recordPace(options.paceKey, options.speechUnits, ((nowMs() - startedAt) / 1000) * utterance.rate);
      }
      finish(true);
    };
    utterance.onerror = (event) => finish(event?.error ? false : true);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang || browserLang(lang);
    } else {
      utterance.lang = browserLang(lang);
    }
    utterance.rate = clampRate(options.rate, 0.5, 2.0);
    utterance.pitch = Number(options.pitch || 1);
    utterance.volume = Number(options.volume ?? 1);
    speechSynthesis.speak(utterance);
    return true;
  }

  // Play a synthesized clip. `bakedRate` is the speed already rendered into the
  // clip; `fallbackRate` is used until the real duration is known. Once it is,
  // the clip is sped up just enough to end inside the caller's slot.
  async function playClip(audioUrl, options = {}, { bakedRate = 1, fallbackRate = 1 } = {}) {
    if (currentAudio) {
      try { currentAudio.pause(); } catch {}
      currentAudio = null;
    }
    stopSpeechOnly();
    const audio = new Audio(audioUrl);
    currentAudio = audio;
    audio.volume = Number(options.volume ?? 1);
    if (fallbackRate !== 1) audio.playbackRate = fallbackRate;
    let ended = false;
    const end = (ok) => {
      if (ended) return;
      ended = true;
      if (currentAudio === audio) currentAudio = null;
      try { options.onEnd?.(ok); } catch {}
    };
    const fitToSlot = () => {
      const duration = Number(audio.duration);
      if (!Number.isFinite(duration) || duration <= 0) return;
      recordPace(options.paceKey, options.speechUnits, duration * bakedRate);
      if (typeof options.getSlotSeconds !== "function") return;
      const slot = Number(options.getSlotSeconds());
      if (!Number.isFinite(slot)) return;
      const ceiling = Math.max(1, MAX_SPEECH_RATE / bakedRate);
      audio.playbackRate = Math.min(ceiling, Math.max(1, duration / Math.max(slot, 0.05)));
    };
    audio.addEventListener?.("ended", () => end(true), { once: true });
    // Without this a clip that fails to decode holds the queue until the
    // stall timeout, and every following line starts late.
    audio.addEventListener?.("error", () => end(false), { once: true });
    audio.addEventListener?.("playing", () => {
      try { options.onStart?.(); } catch {}
    }, { once: true });
    if (audio.readyState >= 1) fitToSlot();
    else audio.addEventListener?.("loadedmetadata", fitToSlot, { once: true });
    await audio.play();
    return true;
  }

  function setCachedAudio(cache, key, url) {
    if (cache.size >= MAX_AUDIO_CACHE) {
      const oldestKey = cache.keys().next().value;
      const oldUrl = cache.get(oldestKey);
      try { URL.revokeObjectURL(oldUrl); } catch {}
      cache.delete(oldestKey);
    }
    cache.set(key, url);
  }

  // Synthesize (and cache) a Google Cloud line without playing it. The
  // caption orchestrator calls this for the next cue so playback can start on
  // the cue boundary instead of after a network round-trip.
  async function synthesizeGoogleCloud(text, lang, options = {}) {
    const clean = stripTtsNoise(text);
    if (!clean) return null;
    const apiKey = String(options.googleCloudKey || options.apiKey || "").trim();
    if (!apiKey) throw new Error("Google Cloud Text-to-Speech API key is missing.");
    const languageCode = normalizeLang(lang);
    if (!CHIRP3_HD_LOCALES.has(languageCode)) {
      throw new Error(`Google Cloud TTS has no Chirp3-HD voice for ${languageCode}; falling back to browser voice.`);
    }
    const voiceName = options.voiceName || "Achernar";
    const rate = clampRate(options.rate, 0.25, 2.0);
    const cacheKey = [
      languageCode,
      voiceName,
      rate,
      clean,
    ].join("\u0001");
    let audioUrl = googleAudioCache.get(cacheKey);
    if (audioUrl) return audioUrl;
    let pending = googleAudioInflight.get(cacheKey);
    if (!pending) {
      pending = (async () => {
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
              speakingRate: rate,
            },
          }),
          signal: options.signal,
        });
        if (options.signal?.aborted) return null;
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error?.message || `Google TTS HTTP ${response.status}`);
        }
        const bytes = Uint8Array.from(atob(data.audioContent || ""), (char) => char.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mp3" }));
        setCachedAudio(googleAudioCache, cacheKey, url);
        return url;
      })();
      googleAudioInflight.set(cacheKey, pending);
      pending.then(
        () => googleAudioInflight.delete(cacheKey),
        () => googleAudioInflight.delete(cacheKey),
      );
    }
    return pending;
  }

  async function speakGoogleCloud(text, lang, options = {}) {
    const audioUrl = await synthesizeGoogleCloud(text, lang, options);
    if (!audioUrl || options.signal?.aborted) return false;
    return playClip(audioUrl, options, { bakedRate: clampRate(options.rate, 0.25, 2.0) });
  }

  async function synthesizeCustomVoice(text, lang, options = {}) {
    const clean = stripTtsNoise(text);
    if (!clean) return null;
    const base = String(options.customTtsBaseUrl || "").trim().replace(/\/+$/, "");
    const voiceId = String(options.customTtsVoiceId || "").trim();
    const apiKey = String(options.customTtsApiKey || "").trim();
    if (!base) throw new Error("Custom Voice Base URL is required.");
    if (!voiceId) throw new Error("Custom Voice ID is required.");

    const modelId = String(options.customTtsModelId || "").trim();
    // Rate is applied with Audio.playbackRate at playback time, so it must not
    // be part of the cache key; the same clip can be reused at a new speed.
    const cacheKey = [base, voiceId, modelId, clean].join("\u0001");
    let audioUrl = customAudioCache.get(cacheKey);
    if (audioUrl) return audioUrl;

    // Prefetch and playback may ask for the same line within the same tick.
    // Share one request so the clip is synthesized once.
    let pending = customAudioInflight.get(cacheKey);
    if (!pending) {
      pending = (async () => {
        let targetUrl;
        const headers = { "Content-Type": "application/json" };
        let body;

        if (base.includes("elevenlabs")) {
          targetUrl = `${base}/text-to-speech/${encodeURIComponent(voiceId)}`;
          if (apiKey) headers["xi-api-key"] = apiKey;
          body = JSON.stringify({
            text: clean,
            model_id: modelId || "eleven_flash_v2_5",
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
        if (options.signal?.aborted) return null;

        const blob = await response.blob();
        if (options.signal?.aborted) return null;
        const url = URL.createObjectURL(blob);
        setCachedAudio(customAudioCache, cacheKey, url);
        return url;
      })();
      customAudioInflight.set(cacheKey, pending);
      pending.then(
        () => customAudioInflight.delete(cacheKey),
        () => customAudioInflight.delete(cacheKey),
      );
    }
    return pending;
  }

  async function speakCustomVoice(text, lang, options = {}) {
    const audioUrl = await synthesizeCustomVoice(text, lang, options);
    if (!audioUrl || options.signal?.aborted) return false;
    // The clip is synthesized at natural speed; the rate is applied at
    // playback so the same clip can be reused at any speed.
    return playClip(audioUrl, options, { fallbackRate: clampRate(options.rate, 0.9, 2.0) });
  }

  async function speakOpenAI(text, lang, options = {}) {
    if (!window.LumeoOpenAITTS?.synthesize) throw new Error("OpenAI TTS service is not loaded.");
    const speed = Number(options.rate) > 0 ? Number(options.rate) : 1;
    const audioUrl = await window.LumeoOpenAITTS.synthesize(text, {
      apiKey: options.openaiKey,
      voice: options.openaiVoice || "alloy",
      speed,
      signal: options.signal,
    });
    if (!audioUrl || options.signal?.aborted) return false;
    return playClip(audioUrl, options, { bakedRate: clampRate(speed, 0.25, 2.0) });
  }

  // Warm the audio cache for a line that will be spoken later. Only network
  // providers can be prefetched; browser speech is synthesized synchronously
  // by the speech engine and has no media blob to prepare.
  async function prefetch(text, lang, options = {}) {
    const provider = options.provider || "browser";
    try {
      if (provider === "google-cloud") {
        return !!(await synthesizeGoogleCloud(text, lang, options));
      }
      if (provider === "custom-voice-engine") {
        return !!(await synthesizeCustomVoice(text, lang, options));
      }
      if (provider === "openai-tts" || provider === "openai") {
        if (!window.LumeoOpenAITTS?.synthesize) return false;
        const url = await window.LumeoOpenAITTS.synthesize(text, {
          apiKey: options.openaiKey,
          voice: options.openaiVoice || "alloy",
          speed: Number(options.rate) > 0 ? Number(options.rate) : 1,
          signal: options.signal,
        });
        return !!url;
      }
    } catch (err) {
      // Prefetch is opportunistic: a failed request must never block or
      // duplicate the real playback request.
      console.warn("[TTS] Prefetch failed, playback will retry:", err);
    }
    return false;
  }

  async function speak(text, lang, options = {}) {
    const provider = options.provider || "browser";
    if (provider === "custom-voice-engine") {
      try {
        return await speakCustomVoice(text, lang, options);
      } catch (err) {
        console.warn("[TTS] Custom voice failed, falling back to browser TTS:", err);
        options.onFailover?.({ from: "custom-voice-engine", to: "browser", error: err.message });
        return speakBrowser(text, lang, { ...options, paceKey: "", onStart: undefined });
      }
    }
    if (provider === "google-cloud") {
      try {
        return await speakGoogleCloud(text, lang, options);
      } catch (err) {
        console.warn("[TTS] Google Cloud TTS failed, falling back to browser TTS:", err);
        options.onFailover?.({ from: "google-cloud", to: "browser", error: err.message });
        return speakBrowser(text, lang, { ...options, paceKey: "", onStart: undefined });
      }
    }
    if (provider === "openai-tts" || provider === "openai") {
      if (!window.LumeoOpenAITTS) throw new Error("OpenAI TTS service is not loaded.");
      try {
        return await speakOpenAI(text, lang, options);
      } catch (err) {
        console.warn("[TTS] OpenAI TTS failed, falling back to browser TTS:", err);
        options.onFailover?.({ from: "openai-tts", to: "browser", error: err.message });
        return speakBrowser(text, lang, { ...options, paceKey: "", onStart: undefined });
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
    speakQueued,
    prefetch,
    speakBrowser,
    speakGoogleCloud,
    speakCustomVoice,
    getPace,
    getStartLatency,
    synthesizeGoogleCloud,
    synthesizeCustomVoice,
    stop,
  };
})();

