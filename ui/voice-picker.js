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

  function autoPairVoice(langCode, voices = []) {
    if (!voices || voices.length === 0) return null;
    const prefs = SMART_VOICE_PREFERENCES[langCode] || [];
    for (const prefName of prefs) {
      const match = voices.find((v) => v.name.includes(prefName) || prefName.includes(v.name));
      if (match) return match;
    }
    const langPrefix = (langCode || "vi").split("-")[0].toLowerCase();
    const langMatch = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(langPrefix));
    return langMatch || null;
  }

  function getTopVoicesForLanguage(langCode, voices = []) {
    if (!voices || voices.length === 0) return [];
    const langPrefix = (langCode || "vi").split("-")[0].toLowerCase();
    const matching = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith(langPrefix));
    if (matching.length === 0) return [];

    const prefs = SMART_VOICE_PREFERENCES[langCode] || [];
    const prioritized = [];
    const seen = new Set();

    for (const prefName of prefs) {
      const found = matching.find((v) => (v.name.includes(prefName) || prefName.includes(v.name)) && !seen.has(v.name));
      if (found) {
        prioritized.push(found);
        seen.add(found.name);
      }
    }

    for (const v of matching) {
      if (!seen.has(v.name) && (v.name.includes("Natural") || v.name.includes("Google"))) {
        prioritized.push(v);
        seen.add(v.name);
      }
    }

    for (const v of matching) {
      if (!seen.has(v.name)) {
        prioritized.push(v);
        seen.add(v.name);
      }
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

      const targetLang = settings.targetLanguage || "vi";
      const voices = (typeof window !== "undefined" && window.speechSynthesis?.getVoices?.()) || [];
      const pairedVoice = autoPairVoice(targetLang, voices);
      const pairedClean = pairedVoice ? cleanVoiceLabel(pairedVoice.name) : "";
      const autoText = pairedClean ? `Auto (${pairedClean})` : "Auto (Recommended)";

      appendOption(selectEl, "auto", autoText);

      const topVoices = getTopVoicesForLanguage(targetLang, voices);
      for (const v of topVoices) {
        appendOption(selectEl, v.name, cleanVoiceLabel(v.name));
      }

      appendOption(selectEl, "off", "Off / Mute");

      if (settings.captionTtsProvider === "off") {
        selectEl.value = "off";
      } else if (settings.standardVoice) {
        selectEl.value = settings.standardVoice;
      } else {
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
    populate,
  };
})();
