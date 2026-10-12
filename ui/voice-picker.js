(() => {
  "use strict";

  if (window.LumeoVoicePicker?.__loaded) return;

  const REALTIME_VOICES = Object.freeze([
    "marin", "alloy", "ash", "ballad", "coral",
    "echo", "sage", "shimmer", "verse",
  ]);

  const CAPTION_TTS_OPTIONS = Object.freeze([
    ["off", "TTS Off"],
    ["browser", "Browser TTS"],
    ["google-cloud", "Google Cloud TTS"],
    ["openai-tts", "OpenAI TTS"],
  ]);

  const STANDARD_VOICES = Object.freeze([
    ["English_magnetic_voiced_man", "Magnetic Man"],
    ["English_captivating_female1", "Captivating Female"],
    ["English_ManWithDeepVoice", "Deep Voice Man"],
    ["English_ConfidentWoman", "Confident Woman"],
    ["Chinese (Mandarin)_News_Anchor", "News Anchor"],
  ]);

  const STANDARD_DEFAULT_VOICE = STANDARD_VOICES[0][0];
  const REALTIME_DEFAULT_VOICE = "marin";

  function titleCase(value) {
    const text = String(value || "");
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
  }

  const SMART_VOICE_PREFERENCES = {
    vi: ["Microsoft HoaiMy Online (Natural) - Vietnamese (Vietnam)", "Google tiếng Việt", "Microsoft NamMinh Online (Natural)"],
    en: ["Microsoft Jenny Online (Natural) - English (United States)", "Google US English", "Microsoft Guy Online (Natural)", "Samantha"],
    ja: ["Microsoft Nanami Online (Natural) - Japanese (Japan)", "Google 日本語", "Microsoft Keita Online (Natural)", "Kyoko"],
    ko: ["Microsoft SunHi Online (Natural) - Korean (Korea)", "Google 한국의", "Microsoft InJoon Online (Natural)", "Yuna"],
    zh: ["Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)", "Google 普通话 (中国大陆)", "Microsoft Yunxi Online (Natural)"],
    es: ["Microsoft Elvira Online (Natural) - Spanish (Spain)", "Google español", "Microsoft Alvaro Online (Natural)"],
    fr: ["Microsoft Denise Online (Natural) - French (France)", "Google français", "Microsoft Henri Online (Natural)"],
    de: ["Microsoft Katja Online (Natural) - German (Germany)", "Google Deutsch", "Microsoft Conrad Online (Natural)"],
    ru: ["Microsoft Svetlana Online (Natural) - Russian (Russia)", "Google русский", "Microsoft Dmitri Online (Natural)"],
    pt: ["Microsoft Francisca Online (Natural) - Portuguese (Brazil)", "Google português do Brasil"],
    it: ["Microsoft Elsa Online (Natural) - Italian (Italy)", "Google italiano"],
  };

  function cleanVoiceLabel(name) {
    if (!name) return "";
    let clean = name
      .replace(/Online\s*\(Natural\)/gi, "(Natural)")
      .replace(/Microsoft\s+/gi, "")
      .replace(/Google\s+/gi, "Google ")
      .replace(/\s*-\s*[A-Za-z\s()]+$/g, "")
      .trim();
    return clean || name;
  }

  // Voice-tag aliases shared with services/tts-browser.js matching: full tags
  // naming the same language across platforms (fil/tl, no/nb/nn, zh/cmn/yue).
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

  // Full-tag equality (incl. aliases) first, then separator-aware base prefix.
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

  function autoPairVoice(langCode, voices = []) {
    if (!voices || voices.length === 0) return null;
    const want = normTag(langCode);
    const prefs = SMART_VOICE_PREFERENCES[langCode] || [];
    for (const prefName of prefs) {
      const match = voices.find((v) => v.name.includes(prefName) || prefName.includes(v.name));
      if (match && voiceTagMatches(match.lang, langCode)) return match;
    }
    const exact = voices.find((v) => normTag(v.lang) === want);
    if (exact) return exact;
    const langPrefix = (langCode || "vi").split("-")[0].toLowerCase();
    const langMatch = voices.find((v) => v.lang && voiceTagMatches(v.lang, langCode));
    if (langMatch) return langMatch;
    // Separator-aware last resort (never bare prefix: "th" must not match "the-*").
    return voices.find((v) => {
      const vl = v.lang && v.lang.toLowerCase();
      return vl === langPrefix || (!!vl && vl.startsWith(`${langPrefix}-`));
    }) || null;
  }

  function getTopVoicesForLanguage(langCode, voices = []) {
    if (!voices || voices.length === 0) return [];
    const want = normTag(langCode);
    const matching = voices.filter((v) => v.lang && voiceTagMatches(v.lang, langCode));
    if (matching.length === 0) return [];

    const exact = matching.filter((v) => normTag(v.lang) === want);
    const rest = matching.filter((v) => normTag(v.lang) !== want);

    const prefs = SMART_VOICE_PREFERENCES[langCode] || [];
    const prioritized = [];
    const seen = new Set();

    const pushIfNew = (v) => {
      if (v && !seen.has(v.name)) {
        prioritized.push(v);
        seen.add(v.name);
      }
    };

    for (const prefName of prefs) {
      const found = matching.find((v) => (v.name.includes(prefName) || prefName.includes(v.name)) && !seen.has(v.name));
      if (found) pushIfNew(found);
    }

    // Full-tag hits outrank base-prefix hits within each quality band.
    for (const band of [exact, rest]) {
      for (const v of band) {
        if (v.name.includes("Natural") || v.name.includes("Google")) pushIfNew(v);
      }
    }

    for (const band of [exact, rest]) {
      for (const v of band) pushIfNew(v);
    }

    return prioritized.slice(0, 3);
  }

  function appendOption(selectEl, value, label) {
    const opt = selectEl.ownerDocument.createElement("option");
    opt.value = value;
    opt.textContent = label;
    selectEl.appendChild(opt);
  }

  function populate(selectEl, tier, settings = {}) {
    if (!selectEl) return;
    selectEl.replaceChildren();

    if (tier === "caption") {
      selectEl.setAttribute("aria-label", "Caption speech voice");
      selectEl.title = "Spoken speech for translated captions.";

      if (settings.captionTtsProvider === "custom-voice-engine") {
        const voiceLabel = settings.customTtsVoiceId ? `Custom Voice (${settings.customTtsVoiceId.slice(0, 12)}...)` : "Custom Voice (Active)";
        appendOption(selectEl, "custom-voice-engine", voiceLabel);
        appendOption(selectEl, "off", "Off / Mute");
        selectEl.value = "custom-voice-engine";
        return;
      }

      const targetLang = settings.targetLanguage || "en";
      const voices = (typeof window !== "undefined" && window.speechSynthesis?.getVoices?.()) || [];
      const matchingCount = voices.filter((v) => v.lang && voiceTagMatches(v.lang, targetLang)).length;
      const pairedVoice = autoPairVoice(targetLang, voices);
      const pairedClean = pairedVoice ? cleanVoiceLabel(pairedVoice.name) : "";
      // Empty state: no OS voice for this language is normal (spec), so say
      // so instead of silently reading with the default (often EN) voice.
      const autoText = matchingCount === 0
        ? `Auto (No ${targetLang} voice installed — uses default)`
        : pairedClean ? `Auto (${pairedClean})` : "Auto (Recommended)";

      appendOption(selectEl, "auto", autoText);

      const topVoices = getTopVoicesForLanguage(targetLang, voices);
      for (const v of topVoices) {
        appendOption(selectEl, v.name, cleanVoiceLabel(v.name));
      }

      appendOption(selectEl, "off", "Off / Mute");

      const offered = new Set(Array.from(selectEl.options).map((o) => o.value));
      if (settings.captionTtsProvider === "off") {
        selectEl.value = "off";
      } else if (settings.standardVoice && offered.has(settings.standardVoice)) {
        selectEl.value = settings.standardVoice;
      } else {
        // Drop stale cross-language selections: a voice picked for another
        // language must not keep reading the new language.
        selectEl.value = "auto";
      }
      return;
    }

    if (tier === "standard") {
      selectEl.setAttribute("aria-label", "Dub voice");
      selectEl.removeAttribute("title");
      for (const [id, name] of STANDARD_VOICES) appendOption(selectEl, id, name);
      selectEl.value = settings.standardVoice || STANDARD_DEFAULT_VOICE;
      return;
    }

    selectEl.setAttribute("aria-label", "Realtime voice");
    selectEl.removeAttribute("title");
    appendOption(selectEl, "", "Auto");
    for (const voice of REALTIME_VOICES) appendOption(selectEl, voice, titleCase(voice));
    selectEl.value = settings.realtimeVoice ?? REALTIME_DEFAULT_VOICE;
  }

  window.LumeoVoicePicker = {
    __loaded: true,
    CAPTION_TTS_OPTIONS,
    REALTIME_VOICES,
    REALTIME_DEFAULT_VOICE,
    STANDARD_VOICES,
    STANDARD_DEFAULT_VOICE,
    cleanVoiceLabel,
    autoPairVoice,
    getTopVoicesForLanguage,
    SMART_VOICE_PREFERENCES,
    populate,
  };
})();
