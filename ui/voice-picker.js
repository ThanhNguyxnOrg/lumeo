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
      selectEl.setAttribute("aria-label", "Caption speech (read aloud)");
      selectEl.title = "Read translated captions aloud. Pick Browser TTS for free on-device speech.";
      for (const [id, name] of CAPTION_TTS_OPTIONS) appendOption(selectEl, id, name);
      selectEl.value = settings.captionTtsProvider || "off";
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
