(() => {
  "use strict";

  if (globalThis.LumeoProviders?.__loaded) return;

  const providers = Object.freeze({
    none: {
      id: "none",
      label: "None",
      slot: "stt",
      group: "Fallback",
      keyFields: [],
      modes: ["caption"],
      status: "available",
      noKey: true,
      description: "Do not use live speech-to-text fallback when YouTube has no captions.",
    },
    ttsOff: {
      id: "off",
      label: "Off",
      slot: "tts",
      group: "Caption TTS",
      keyFields: [],
      modes: ["caption"],
      status: "available",
      noKey: true,
      description: "Text captions only. No spoken caption playback.",
    },
    browserTts: {
      id: "browser",
      label: "Browser TTS",
      slot: "tts",
      group: "Caption TTS",
      keyFields: [],
      modes: ["caption"],
      status: "available",
      noKey: true,
      description: "Uses Chrome speechSynthesis voices on this device.",
    },
    googleFree: {
      id: "google-free",
      label: "Google Free",
      slot: "translator",
      group: "Translation",
      keyFields: [],
      modes: ["caption"],
      status: "available",
      noKey: true,
      free: true,
      description: "Default no-key caption translation when YouTube exposes captions.",
    },
    gemini: {
      id: "gemini",
      label: "Gemini",
      slot: "translator",
      group: "Translation",
      keyFields: ["geminiKey"],
      modes: ["caption"],
      status: "available",
      helpUrl: "https://aistudio.google.com/app/apikey",
      description: "Good free-tier/BYOK caption translation.",
    },
    openrouter: {
      id: "openrouter",
      label: "OpenRouter",
      slot: "translator",
      group: "Translation",
      keyFields: ["openRouterKey"],
      modes: ["caption"],
      status: "available",
      helpUrl: "https://openrouter.ai/keys",
      description: "Free model router or user-selected OpenRouter models.",
    },
    groq: {
      id: "groq",
      label: "Groq",
      slot: "translator",
      group: "Translation",
      keyFields: ["groqApiKey"],
      modes: ["caption"],
      status: "available",
      helpUrl: "https://console.groq.com/keys",
      description: "Fast BYOK caption translation through Groq chat models.",
    },
    openai: {
      id: "openai",
      label: "OpenAI",
      slot: "translator",
      group: "Translation",
      keyFields: ["openaiKey"],
      modes: ["caption"],
      status: "available",
      helpUrl: "https://platform.openai.com/api-keys",
      description: "BYOK caption translation.",
    },
    googleCloud: {
      id: "google-cloud",
      label: "Google Cloud",
      slot: "translator",
      group: "Translation / TTS",
      keyFields: ["googleCloudKey"],
      modes: ["caption"],
      status: "available",
      helpUrl: "https://console.cloud.google.com/apis/credentials",
      description: "Cloud Translation and Chirp3-HD TTS.",
    },
    googleCloudTts: {
      id: "google-cloud-tts",
      label: "Google Cloud TTS",
      slot: "tts",
      group: "Caption TTS",
      keyFields: ["googleCloudKey"],
      modes: ["caption"],
      status: "available",
      helpUrl: "https://console.cloud.google.com/apis/credentials",
      description: "Speaks translated captions with Google Cloud TTS.",
    },
    openaiTts: {
      id: "openai-tts",
      label: "OpenAI TTS",
      slot: "tts",
      group: "Caption TTS",
      keyFields: ["openaiKey"],
      modes: ["caption"],
      status: "available",
      helpUrl: "https://platform.openai.com/api-keys",
      description: "Speaks translated captions with OpenAI TTS.",
    },
    libretranslate: {
      id: "libretranslate",
      label: "LibreTranslate",
      slot: "translator",
      group: "Translation",
      keyFields: ["libreTranslateUrl"],
      optionalKeyFields: ["libreTranslateKey"],
      modes: ["caption"],
      status: "available",
      helpUrl: "https://libretranslate.com",
      description: "Managed or self-hosted translation endpoint.",
    },
    soniox: {
      id: "soniox",
      label: "Soniox",
      slot: "stt",
      group: "STT fallback",
      keyFields: ["sonioxApiKey"],
      modes: ["caption"],
      status: "available",
      helpUrl: "https://soniox.com/console",
      fallbackFor: ["missing-caption-track"],
      description: "Streams tab audio to Soniox realtime STT when YouTube has no readable captions. Use only when you want provider-side audio transcription.",
    },
    kyma: {
      id: "kyma",
      label: "Kyma proxy",
      slot: "dubPipeline",
      group: "Dubbing",
      keyFields: ["kymaKey"],
      modes: ["standard"],
      status: "available",
      helpUrl: "https://kymaapi.com",
      description: "Kyma Standard route: Whisper v3 Turbo STT, Gemini 2.5 Flash translation, then MiniMax Speech Turbo TTS. Uses the same Kyma key as Realtime, but a different backend pipeline.",
    },
    kymaRealtime: {
      id: "kyma-realtime",
      label: "Kyma WebRTC",
      slot: "realtimeBridge",
      group: "Realtime",
      keyFields: ["kymaKey"],
      modes: ["realtime"],
      status: "available",
      helpUrl: "https://kymaapi.com",
      description: "Kyma Realtime route: mints an ephemeral OpenAI Realtime WebRTC session for sub-second dubbing. Uses the same Kyma key as Standard, but streams live audio instead of chunking.",
    },
    // Reserved keyFields support stable popup rendering and storage migrations.
    // Runtime key validation ignores providers with status "coming-soon".
    openaiDirectDub: {
      id: "openai-direct-dub",
      label: "OpenAI Whisper + TTS",
      slot: "dubPipeline",
      group: "Dubbing",
      keyFields: ["openaiKey"],
      modes: ["standard"],
      status: "coming-soon",
      helpUrl: "https://platform.openai.com/api-keys",
      description: "Direct BYOK standard pipeline planned: Whisper transcription, model translation, OpenAI TTS.",
    },
    openaiRealtimeDirect: {
      id: "openai-realtime-direct",
      label: "OpenAI Realtime direct",
      slot: "realtimeBridge",
      group: "Realtime",
      keyFields: ["openaiKey"],
      modes: ["realtime"],
      status: "coming-soon",
      helpUrl: "https://platform.openai.com/api-keys",
      description: "Direct OpenAI Realtime BYOK bridge planned for users who do not want a gateway.",
    },
    elevenLabsDub: {
      id: "elevenlabs-dubbing",
      label: "ElevenLabs Dubbing",
      slot: "dubPipeline",
      group: "Dubbing",
      keyFields: ["elevenLabsKey"],
      modes: ["standard"],
      status: "coming-soon",
      helpUrl: "https://elevenlabs.io/app/settings/api-keys",
      description: "VOD dubbing pipeline planned for high-quality speaker-style dubbing.",
    },
    elevenLabsTts: {
      id: "elevenlabs-tts",
      label: "ElevenLabs TTS",
      slot: "tts",
      group: "Caption TTS",
      keyFields: ["elevenLabsKey"],
      modes: ["caption"],
      status: "coming-soon",
      helpUrl: "https://elevenlabs.io/app/settings/api-keys",
      description: "Planned premium TTS for spoken translated captions.",
    },
    minimaxTts: {
      id: "minimax-tts",
      label: "MiniMax TTS",
      slot: "tts",
      group: "Caption TTS",
      keyFields: ["minimaxKey"],
      modes: ["caption"],
      status: "coming-soon",
      helpUrl: "https://platform.minimax.io/user-center/basic-information/interface-key",
      description: "Planned direct MiniMax TTS provider.",
    },
    replicateDub: {
      id: "replicate-dub",
      label: "Replicate",
      slot: "dubPipeline",
      group: "Dubbing",
      keyFields: ["replicateKey"],
      modes: ["standard"],
      // Reserved only: no runtime direct Replicate path exists yet.
      status: "coming-soon",
      helpUrl: "https://replicate.com/account/api-tokens",
      description: "Planned experimental dubbing route via hosted open models.",
    },
    geminiLive: {
      id: "gemini-live",
      label: "Gemini Live",
      slot: "realtimeBridge",
      group: "Realtime",
      keyFields: ["geminiKey"],
      modes: ["realtime"],
      status: "coming-soon",
      helpUrl: "https://aistudio.google.com/app/apikey",
      description: "Planned realtime voice route once browser extension flow is stable.",
    },
    groqWhisper: {
      id: "groq-whisper",
      label: "Groq Whisper",
      slot: "stt",
      group: "STT fallback",
      keyFields: ["groqApiKey"],
      modes: ["caption"],
      status: "available",
      helpUrl: "https://console.groq.com/keys",
      description: "Uploads tab-audio chunks to Groq Whisper when YouTube has no readable captions. Usually cheaper than realtime STT.",
    },
    webSpeech: {
      id: "web-speech",
      label: "Web Speech API",
      slot: "stt",
      group: "STT fallback",
      keyFields: [],
      modes: ["caption"],
      status: "coming-soon",
      noKey: true,
      description: "Experimental browser STT fallback; language support varies by Chrome install.",
    },
    huggingface: {
      id: "huggingface",
      label: "Hugging Face",
      slot: "translator",
      group: "Advanced",
      keyFields: ["huggingFaceToken"],
      modes: ["caption"],
      advanced: true,
      status: "coming-soon",
      helpUrl: "https://huggingface.co/settings/tokens",
      description: "Reserved advanced provider option.",
    },
  });

  const slotDefinitions = Object.freeze({
    translator: {
      id: "translator",
      label: "Caption translator",
      required: true,
      storageKey: "translateProvider",
      defaultProvider: "google-free",
      copy: "Pick the model provider that translates YouTube captions.",
    },
    stt: {
      id: "stt",
      label: "No-caption fallback",
      required: false,
      storageKey: "sttProvider",
      defaultProvider: "none",
      copy: "Used only when YouTube exposes no caption track.",
    },
    tts: {
      id: "tts",
      label: "Caption TTS",
      required: false,
      storageKey: "captionTtsProvider",
      defaultProvider: "off",
      copy: "Optional spoken playback for translated caption lines.",
    },
    dubPipeline: {
      id: "dubPipeline",
      label: "Standard dub pipeline",
      required: true,
      storageKey: "dubProvider",
      defaultProvider: "kyma",
      copy: "Chunked audio dubbing. Kyma uses one key for this Standard route and the separate Realtime route.",
    },
    realtimeBridge: {
      id: "realtimeBridge",
      label: "Realtime bridge",
      required: true,
      storageKey: "realtimeProvider",
      defaultProvider: "kyma-realtime",
      copy: "Low-latency live bridge. Kyma uses one key for this Realtime route and the separate Standard route.",
    },
  });

  const modes = Object.freeze({
    caption: {
      id: "caption",
      label: "Caption Free",
      badge: "Caption · Free",
      slots: ["translator", "stt", "tts"],
      engines: ["google-free", "gemini", "openrouter", "groq", "libretranslate", "openai", "google-cloud"],
      defaultEngine: "google-free",
      requiredProviders: [],
      optionalFallbackProviders: ["soniox"],
      copy: "Text-first translation. Uses YouTube captions when available.",
    },
    standard: {
      id: "standard",
      label: "Standard Dub",
      badge: "Standard · Audio",
      slots: ["dubPipeline"],
      engines: ["kyma", "openai-direct-dub", "elevenlabs-dubbing", "replicate-dub"],
      requiredProviders: ["kyma"],
      optionalFallbackProviders: [],
      copy: "Audio translation with chunked dubbing.",
    },
    realtime: {
      id: "realtime",
      label: "Realtime Dub",
      badge: "Realtime · Live",
      slots: ["realtimeBridge"],
      engines: ["kyma-realtime", "openai-realtime-direct", "gemini-live"],
      requiredProviders: ["kyma-realtime"],
      optionalFallbackProviders: [],
      copy: "Low-latency live dubbing.",
    },
  });

  const keyFields = Object.freeze({
    kymaKey: { label: "Kyma API key (Standard + Realtime)", placeholder: "ky-...", secret: true },
    geminiKey: { label: "Gemini API key", placeholder: "AIza...", secret: true },
    openRouterKey: { label: "OpenRouter key", placeholder: "sk-or-...", secret: true },
    groqApiKey: { label: "Groq key", placeholder: "gsk_...", secret: true },
    huggingFaceToken: { label: "Hugging Face token", placeholder: "hf_...", secret: true },
    openaiKey: { label: "OpenAI key", placeholder: "sk-...", secret: true },
    googleCloudKey: { label: "Google Cloud key", placeholder: "AIza...", secret: true },
    libreTranslateUrl: { label: "LibreTranslate URL", placeholder: "http://localhost:5000", secret: false },
    libreTranslateKey: { label: "LibreTranslate key", placeholder: "optional API key", secret: true },
    sonioxApiKey: { label: "Soniox key", placeholder: "Soniox API key", secret: true },
    elevenLabsKey: { label: "ElevenLabs API key", placeholder: "sk_...", secret: true },
    minimaxKey: { label: "MiniMax API key", placeholder: "MiniMax key", secret: true },
    replicateKey: { label: "Replicate token", placeholder: "r8_...", secret: true },
  });

  const capabilityBySlot = Object.freeze({
    translator: "translate",
    stt: "stt",
    tts: "tts",
    dubPipeline: "standardDub",
    realtimeBridge: "realtimeDub",
  });

  const localOnlyProviders = new Set(["none", "off", "browser", "web-speech"]);

  function providerCapabilities(provider) {
    if (!provider) {
      return {
        translate: false,
        stt: false,
        tts: false,
        standardDub: false,
        realtimeDub: false,
        requiresKey: false,
        free: false,
        localOnly: false,
        comingSoon: false,
      };
    }
    const capability = capabilityBySlot[provider.slot];
    return {
      translate: capability === "translate",
      stt: capability === "stt",
      tts: capability === "tts",
      standardDub: capability === "standardDub",
      realtimeDub: capability === "realtimeDub",
      requiresKey: !provider.noKey && !provider.free && (provider.keyFields || []).length > 0,
      free: !!provider.free || !!provider.noKey,
      localOnly: localOnlyProviders.has(provider.id),
      comingSoon: provider.status === "coming-soon",
    };
  }

  function withCapabilities(provider) {
    return provider ? { ...provider, capabilities: providerCapabilities(provider) } : null;
  }

  function providerById(id) {
    return Object.values(providers).find((provider) => provider.id === id) || null;
  }

  function keyFieldsForProvider(providerId) {
    const provider = providerById(providerId);
    if (!provider) return [];
    return [...(provider.keyFields || []), ...(provider.optionalKeyFields || [])];
  }

  function hasRequiredKeys(providerId, values = {}) {
    const provider = providerById(providerId);
    if (!provider) return false;
    if (provider.noKey || provider.free) return true;
    return (provider.keyFields || []).every((key) => String(values[key] || "").trim());
  }

  function missingKeyMessage(providerId) {
    const provider = providerById(providerId);
    const label = provider?.label || "this provider";
    const slot = slotDefinitions[provider?.slot];
    const destination = slot?.label || "provider settings";
    return `Add your ${label} key in ${destination}, then Start again.`;
  }

  function providersForSlot(modeId, slotId, options = {}) {
    return Object.values(providers).filter((provider) =>
      provider.slot === slotId &&
      (provider.modes || []).includes(modeId) &&
      (options.includeRoadmap || provider.status !== "coming-soon")
    );
  }

  function slotsForMode(modeId) {
    const mode = modes[modeId] || modes.caption;
    return (mode.slots || []).map((slotId) => slotDefinitions[slotId]).filter(Boolean);
  }

  function selectedProviderForSlot(slotId, values = {}) {
    const slot = slotDefinitions[slotId];
    if (!slot) return null;
    return providerById(values[slot.storageKey] || slot.defaultProvider);
  }

  function requiredProvidersForMode(modeId, valuesOrEngine = {}) {
    const values = typeof valuesOrEngine === "string"
      ? { translateProvider: valuesOrEngine }
      : valuesOrEngine || {};
    return slotsForMode(modeId)
      .filter((slot) => slot.required)
      .map((slot) => selectedProviderForSlot(slot.id, values)?.id)
      .filter(Boolean);
  }

  globalThis.LumeoProviders = {
    __loaded: true,
    providers,
    modes,
    slotDefinitions,
    keyFields,
    capabilityBySlot,
    providerCapabilities,
    withCapabilities,
    providerById,
    keyFieldsForProvider,
    hasRequiredKeys,
    missingKeyMessage,
    providersForSlot,
    slotsForMode,
    selectedProviderForSlot,
    requiredProvidersForMode,
  };
})();
