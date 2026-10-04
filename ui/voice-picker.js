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
        appendOption(selectEl, "off", "TTS Off");
        selectEl.value = "custom-voice-engine";
        return;
      }

      appendOption(selectEl, "auto", "Auto (Recommended)");

      const targetLang = settings.targetLanguage || "vi";
      const voices = (typeof window !== "undefined" && window.speechSynthesis?.getVoices?.()) || [];
      const langPrefix = targetLang.split("-")[0].toLowerCase();
      const matchingVoices = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith(langPrefix));

      for (const v of matchingVoices.slice(0, 8)) {
        const cleanName = v.name.replace(/Microsoft\s+|Google\s+|Online\s+/g, "").trim();
        appendOption(selectEl, v.name, cleanName || v.name);
      }

      appendOption(selectEl, "off", "TTS Off");

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
