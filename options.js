// Lumeo Options Page Controller
(() => {
  "use strict";

  const STORAGE = typeof chrome !== "undefined" && chrome.storage?.local ? chrome.storage.local : {
    get: async (defaults) => ({ ...defaults }),
    set: async () => {},
    remove: async () => {},
    clear: async () => {},
  };

  const DEFAULT_SETTINGS = {
    tier: "caption",
    translateProvider: "google-free",
    targetLanguage: "vi",
    sttProvider: "none",
    dubProvider: "kyma",
    realtimeProvider: "kyma-realtime",
    realtimeVoice: "marin",
    showSource: true,
    showSourceSub: true,
    showTranslatedSub: true,
    geminiKey: "",
    geminiModel: "gemini-2.5-flash-lite",
    openaiKey: "",
    openaiModel: "gpt-4o-mini",
    openRouterKey: "",
    openRouterModel: "openrouter/free",
    groqApiKey: "",
    groqModel: "llama-3.3-70b-versatile",
    kymaKey: "",
    sonioxApiKey: "",
    elevenLabsKey: "",
    minimaxKey: "",
    replicateKey: "",
    huggingFaceToken: "",
    googleCloudKey: "",
    libreTranslateUrl: "",
    libreTranslateKey: "",
    customProxyBaseUrl: "",
    customProxyApiKey: "",
    customProxyModelId: "",
    captionTtsProvider: "off",
    standardVoice: "",
    customTtsBaseUrl: "",
    customTtsApiKey: "",
    customTtsVoiceId: "",
    customTtsModelId: "",
    autoStart: false,
    smartSkipNative: false,
    autoPauseOnHover: false,
    navHotkeys: false,
    voiceVolume: 100,
    originalVolume: 18,
    muteOriginal: false,
    fontSize: 22,
    bottomOffset: 14,
    highContrast: false,
    layoutPreset: "stacked",
    subtitleOrder: "translation-top",
    secondaryLanguage: "original",
    subShadowStyle: "drop-shadow",
    subBackgroundOpacity: 75,
  };

  let currentSettings = { ...DEFAULT_SETTINGS };
  let saveDebounceTimer = null;

  // DOM Elements
  const tabButtons = document.querySelectorAll(".nav-tab");
  const panelSections = document.querySelectorAll(".panel-section");
  const sectionTitle = document.getElementById("sectionTitle");
  const sectionDesc = document.getElementById("sectionDesc");
  const saveToast = document.getElementById("saveToast");

  // Providers & Keys Inputs
  const translateProviderInput = document.getElementById("translateProvider");
  const targetLanguageInput = document.getElementById("targetLanguage");
  const geminiKeyInput = document.getElementById("geminiKey");
  const geminiModelInput = document.getElementById("geminiModel");
  const openaiKeyInput = document.getElementById("openaiKey");
  const openaiModelInput = document.getElementById("openaiModel");
  const groqApiKeyInput = document.getElementById("groqApiKey");
  const kymaKeyInput = document.getElementById("kymaKey");
  const customProxyBaseUrlInput = document.getElementById("customProxyBaseUrl");
  const customProxyApiKeyInput = document.getElementById("customProxyApiKey");
  const customProxyModelIdInput = document.getElementById("customProxyModelId");

  // Audio & Voice Inputs
  const captionTtsProviderInput = document.getElementById("captionTtsProvider");
  const browserVoiceWrap = document.getElementById("browserVoiceWrap");
  const browserVoiceInput = document.getElementById("browserVoice");
  const customVoiceEngineWrap = document.getElementById("customVoiceEngineWrap");
  const customTtsBaseUrlInput = document.getElementById("customTtsBaseUrl");
  const customTtsVoiceIdInput = document.getElementById("customTtsVoiceId");
  const customTtsApiKeyInput = document.getElementById("customTtsApiKey");
  const customTtsModelIdInput = document.getElementById("customTtsModelId");
  const btnFetchCustomTtsVoices = document.getElementById("btnFetchCustomTtsVoices");
  const customTtsVoiceSelect = document.getElementById("customTtsVoiceSelect");
  const voiceVolumeInput = document.getElementById("voiceVolume");
  const voiceVolumeVal = document.getElementById("voiceVolumeVal");
  const originalVolumeInput = document.getElementById("originalVolume");
  const originalVolumeVal = document.getElementById("originalVolumeVal");
  const muteOriginalInput = document.getElementById("muteOriginal");

  // Subtitle Appearance Inputs
  const fontSizeInput = document.getElementById("fontSize");
  const fontSizeVal = document.getElementById("fontSizeVal");
  const bottomOffsetInput = document.getElementById("bottomOffset");
  const bottomOffsetVal = document.getElementById("bottomOffsetVal");
  const layoutPresetInput = document.getElementById("layoutPreset");
  const highContrastInput = document.getElementById("highContrast");
  const subtitleOrderInput = document.getElementById("subtitleOrder");
  const subShadowStyleInput = document.getElementById("subShadowStyle");
  const subBackgroundOpacityInput = document.getElementById("subBackgroundOpacity");
  const subBackgroundOpacityVal = document.getElementById("subBackgroundOpacityVal");
  const btnResetPosition = document.getElementById("btnResetPosition");

  // Automation Inputs
  const autoStartInput = document.getElementById("autoStart");
  const smartSkipNativeInput = document.getElementById("smartSkipNative");
  const autoPauseOnHoverInput = document.getElementById("autoPauseOnHover");
  const navHotkeysInput = document.getElementById("navHotkeys");

  // Preview elements
  const previewSubBox = document.getElementById("previewSubBox");
  const previewSubTranslated = document.getElementById("previewSubTranslated");
  const previewSubSource = document.getElementById("previewSubSource");

  // Cache & Action elements
  const btnClearCache = document.getElementById("btnClearCache");
  const btnExportSrt = document.getElementById("btnExportSrt");
  const cacheStatusMsg = document.getElementById("cacheStatusMsg");
  const btnResetAll = document.getElementById("btnResetAll");
  const btnConfigureShortcuts = document.getElementById("btnConfigureShortcuts");

  const TAB_METADATA = {
    providers: {
      title: "API Keys & AI Providers",
      desc: "Manage your private AI service keys. All keys are stored securely and locally on your browser.",
    },
    subtitles: {
      title: "Subtitle Style & Appearance",
      desc: "Adjust font size, position, contrast, and playback automation of subtitles in real time.",
    },
    audio: {
      title: "Voice & Audio Balance",
      desc: "Configure Text-to-Speech voices and volume balance between video and translation.",
    },
    cache: {
      title: "Subtitle Cache & Export",
      desc: "Clear temporary cached translations or export subtitles as SRT files.",
    },
  };

  // 1. Tab Switching
  tabButtons.forEach((tab) => {
    tab.addEventListener("click", () => {
      const targetTab = tab.dataset.tab;
      tabButtons.forEach((t) => {
        t.classList.remove("is-active");
        t.setAttribute("aria-selected", "false");
      });
      panelSections.forEach((p) => p.classList.remove("is-active"));

      tab.classList.add("is-active");
      tab.setAttribute("aria-selected", "true");
      const activePanel = document.getElementById(`panel-${targetTab}`);
      if (activePanel) activePanel.classList.add("is-active");

      const meta = TAB_METADATA[targetTab];
      if (meta) {
        sectionTitle.textContent = meta.title;
        sectionDesc.textContent = meta.desc;
      }
    });
  });

  // 2. TTS Voice Sections Toggling
  function updateTtsSectionsVisibility() {
    const provider = captionTtsProviderInput?.value;
    if (provider === "custom-voice-engine") {
      if (browserVoiceWrap) browserVoiceWrap.style.display = "none";
      if (customVoiceEngineWrap) customVoiceEngineWrap.style.display = "block";
    } else if (provider === "browser" || provider === "off") {
      if (browserVoiceWrap) browserVoiceWrap.style.display = "block";
      if (customVoiceEngineWrap) customVoiceEngineWrap.style.display = "none";
    } else {
      if (browserVoiceWrap) browserVoiceWrap.style.display = "none";
      if (customVoiceEngineWrap) customVoiceEngineWrap.style.display = "none";
    }
  }

  // 3. Populate Browser Voices
  function populateBrowserVoices() {
    if (typeof window === "undefined" || !("speechSynthesis" in window) || !browserVoiceInput) return;
    const voices = window.speechSynthesis.getVoices() || [];
    const prev = browserVoiceInput.value || currentSettings.standardVoice || "";
    const targetLang = currentSettings.targetLanguage || "vi";
    const picker = window.LumeoVoicePicker;

    browserVoiceInput.innerHTML = '<option value="">Auto-pair best natural voice for language</option>';

    if (picker) {
      const topVoices = picker.getTopVoicesForLanguage(targetLang, voices);
      if (topVoices.length > 0) {
        const matchGroup = document.createElement("optgroup");
        matchGroup.label = `Recommended Natural Voices (${targetLang})`;
        topVoices.forEach((v) => {
          const opt = document.createElement("option");
          opt.value = v.voiceURI || v.name;
          opt.textContent = `${picker.cleanVoiceLabel(v.name)} (${v.lang})`;
          matchGroup.appendChild(opt);
        });
        browserVoiceInput.appendChild(matchGroup);
      }
      const topSet = new Set(topVoices.map((v) => v.name));
      const others = voices.filter((v) => !topSet.has(v.name));
      if (others.length > 0) {
        const otherGroup = document.createElement("optgroup");
        otherGroup.label = "All Other Voices";
        others.forEach((v) => {
          const opt = document.createElement("option");
          opt.value = v.voiceURI || v.name;
          opt.textContent = `${picker.cleanVoiceLabel(v.name)} (${v.lang})`;
          otherGroup.appendChild(opt);
        });
        browserVoiceInput.appendChild(otherGroup);
      }
    } else {
      const prefix = targetLang.split("-")[0].toLowerCase();
      const matching = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith(prefix));
      const others = voices.filter((v) => !v.lang || !v.lang.toLowerCase().startsWith(prefix));

      if (matching.length > 0) {
        const matchGroup = document.createElement("optgroup");
        matchGroup.label = `Matching Voices (${targetLang})`;
        matching.forEach((v) => {
          const opt = document.createElement("option");
          opt.value = v.voiceURI || v.name;
          opt.textContent = `${v.name} (${v.lang})`;
          matchGroup.appendChild(opt);
        });
        browserVoiceInput.appendChild(matchGroup);
      }

      if (others.length > 0) {
        const otherGroup = document.createElement("optgroup");
        otherGroup.label = "All Other Voices";
        others.forEach((v) => {
          const opt = document.createElement("option");
          opt.value = v.voiceURI || v.name;
          opt.textContent = `${v.name} (${v.lang})`;
          otherGroup.appendChild(opt);
        });
        browserVoiceInput.appendChild(otherGroup);
      }
    }

    if (prev) browserVoiceInput.value = prev;
  }
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.onvoiceschanged = populateBrowserVoices;
    populateBrowserVoices();
  }

  // 4. Load Settings from Storage
  async function loadSettings() {
    try {
      const stored = await STORAGE.get(null);
      currentSettings = { ...DEFAULT_SETTINGS, ...(stored || {}) };

      // Also read caption style from localStorage if present
      try {
        const style = JSON.parse(localStorage.getItem("lumeoCaptionStyle") || "{}");
        currentSettings = { ...currentSettings, ...style };
      } catch {}

      // Seamless migration of openRouterKey to Custom AI Gateway
      if (currentSettings.openRouterKey && !currentSettings.customProxyApiKey) {
        currentSettings.customProxyApiKey = currentSettings.openRouterKey;
        currentSettings.customProxyBaseUrl = currentSettings.customProxyBaseUrl || "https://openrouter.ai/api/v1";
        currentSettings.customProxyModelId = currentSettings.customProxyModelId || currentSettings.openRouterModel || "openrouter/free";
      }
      if (currentSettings.translateProvider === "openrouter") {
        currentSettings.translateProvider = "custom-gateway";
      }

      populateInputs();
      updatePreview();
      updateTtsSectionsVisibility();
      populateBrowserVoices();
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  }

  function populateInputs(skipElementId = null) {
    const shouldUpdate = (el) => el && el.id !== skipElementId;

    if (shouldUpdate(translateProviderInput)) translateProviderInput.value = currentSettings.translateProvider || "google-free";
    if (shouldUpdate(targetLanguageInput)) targetLanguageInput.value = currentSettings.targetLanguage || "vi";
    if (shouldUpdate(geminiKeyInput)) geminiKeyInput.value = currentSettings.geminiKey || "";
    if (shouldUpdate(geminiModelInput)) geminiModelInput.value = currentSettings.geminiModel || "gemini-2.5-flash-lite";
    if (shouldUpdate(openaiKeyInput)) openaiKeyInput.value = currentSettings.openaiKey || "";
    if (shouldUpdate(openaiModelInput)) openaiModelInput.value = currentSettings.openaiModel || "gpt-4o-mini";
    if (shouldUpdate(groqApiKeyInput)) groqApiKeyInput.value = currentSettings.groqApiKey || "";
    if (shouldUpdate(kymaKeyInput)) kymaKeyInput.value = currentSettings.kymaKey || "";
    if (shouldUpdate(customProxyBaseUrlInput)) customProxyBaseUrlInput.value = currentSettings.customProxyBaseUrl || "";
    if (shouldUpdate(customProxyApiKeyInput)) customProxyApiKeyInput.value = currentSettings.customProxyApiKey || "";
    if (shouldUpdate(customProxyModelIdInput)) customProxyModelIdInput.value = currentSettings.customProxyModelId || "";

    if (shouldUpdate(captionTtsProviderInput)) captionTtsProviderInput.value = currentSettings.captionTtsProvider || "off";
    if (shouldUpdate(browserVoiceInput) && currentSettings.standardVoice) browserVoiceInput.value = currentSettings.standardVoice;
    if (shouldUpdate(customTtsBaseUrlInput)) customTtsBaseUrlInput.value = currentSettings.customTtsBaseUrl || "";
    if (shouldUpdate(customTtsVoiceIdInput)) customTtsVoiceIdInput.value = currentSettings.customTtsVoiceId || "";
    if (shouldUpdate(customTtsModelIdInput)) customTtsModelIdInput.value = currentSettings.customTtsModelId || "";
    if (shouldUpdate(customTtsApiKeyInput)) customTtsApiKeyInput.value = currentSettings.customTtsApiKey || "";

    if (shouldUpdate(autoStartInput)) autoStartInput.checked = !!currentSettings.autoStart;
    if (shouldUpdate(smartSkipNativeInput)) smartSkipNativeInput.checked = !!currentSettings.smartSkipNative;
    if (shouldUpdate(autoPauseOnHoverInput)) autoPauseOnHoverInput.checked = !!currentSettings.autoPauseOnHover;
    if (shouldUpdate(navHotkeysInput)) navHotkeysInput.checked = !!currentSettings.navHotkeys;

    if (shouldUpdate(voiceVolumeInput)) {
      voiceVolumeInput.value = currentSettings.voiceVolume ?? 100;
      if (voiceVolumeVal) voiceVolumeVal.textContent = `${voiceVolumeInput.value}%`;
    }
    if (shouldUpdate(originalVolumeInput)) {
      originalVolumeInput.value = currentSettings.originalVolume ?? 18;
      if (originalVolumeVal) originalVolumeVal.textContent = `${originalVolumeInput.value}%`;
    }
    if (shouldUpdate(muteOriginalInput)) muteOriginalInput.checked = !!currentSettings.muteOriginal;

    if (shouldUpdate(fontSizeInput)) {
      fontSizeInput.value = currentSettings.fontSize ?? 22;
      if (fontSizeVal) fontSizeVal.textContent = `${fontSizeInput.value}px`;
    }
    if (shouldUpdate(bottomOffsetInput)) {
      bottomOffsetInput.value = currentSettings.bottomOffset ?? 14;
      if (bottomOffsetVal) bottomOffsetVal.textContent = `${bottomOffsetInput.value}%`;
    }
    if (shouldUpdate(layoutPresetInput)) layoutPresetInput.value = currentSettings.layoutPreset || "stacked";
    if (shouldUpdate(highContrastInput)) highContrastInput.checked = !!currentSettings.highContrast;

    if (shouldUpdate(subtitleOrderInput)) subtitleOrderInput.value = currentSettings.subtitleOrder || "translation-top";
    if (shouldUpdate(subShadowStyleInput)) subShadowStyleInput.value = currentSettings.subShadowStyle || "drop-shadow";
    if (shouldUpdate(subBackgroundOpacityInput)) {
      subBackgroundOpacityInput.value = currentSettings.subBackgroundOpacity ?? 75;
      if (subBackgroundOpacityVal) subBackgroundOpacityVal.textContent = `${subBackgroundOpacityInput.value}%`;
    }
  }

  if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local") {
        let changed = false;
        for (const [key, change] of Object.entries(changes)) {
          if (currentSettings[key] !== change.newValue) {
            currentSettings[key] = change.newValue;
            changed = true;
          }
        }
        if (changed) {
          const activeId = document.activeElement?.id || null;
          populateInputs(activeId);
          updatePreview();
          updateTtsSectionsVisibility();
        }
      }
    });
  }

  // 5. Save Settings to Storage
  async function saveImmediately() {
    clearTimeout(saveDebounceTimer);
    readInputs();
    updatePreview();
    updateTtsSectionsVisibility();
    try {
      await STORAGE.set(currentSettings);
      showToast();
      try {
        chrome.runtime?.sendMessage?.({
          type: "UPDATE_SETTINGS",
          settings: currentSettings,
        });
      } catch {}
    } catch (err) {
      console.error("Failed to save settings:", err);
    }
  }

  function scheduleSave() {
    readInputs();
    updatePreview();
    updateTtsSectionsVisibility();
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(async () => {
      try {
        await STORAGE.set(currentSettings);
        showToast();
        try {
          chrome.runtime?.sendMessage?.({
            type: "UPDATE_SETTINGS",
            settings: currentSettings,
          });
        } catch {}
      } catch (err) {
        console.error("Failed to save settings:", err);
      }
    }, 150);
  }

  function readInputs() {
    if (translateProviderInput) currentSettings.translateProvider = translateProviderInput.value;
    if (targetLanguageInput) currentSettings.targetLanguage = targetLanguageInput.value;
    if (geminiKeyInput) currentSettings.geminiKey = geminiKeyInput.value.trim();
    if (geminiModelInput) currentSettings.geminiModel = geminiModelInput.value;
    if (openaiKeyInput) currentSettings.openaiKey = openaiKeyInput.value.trim();
    if (openaiModelInput) currentSettings.openaiModel = openaiModelInput.value;
    if (groqApiKeyInput) currentSettings.groqApiKey = groqApiKeyInput.value.trim();
    if (kymaKeyInput) currentSettings.kymaKey = kymaKeyInput.value.trim();
    if (customProxyBaseUrlInput) currentSettings.customProxyBaseUrl = customProxyBaseUrlInput.value.trim();
    if (customProxyApiKeyInput) currentSettings.customProxyApiKey = customProxyApiKeyInput.value.trim();
    if (customProxyModelIdInput) currentSettings.customProxyModelId = customProxyModelIdInput.value.trim();

    if (captionTtsProviderInput) currentSettings.captionTtsProvider = captionTtsProviderInput.value;
    if (browserVoiceInput) currentSettings.standardVoice = browserVoiceInput.value;
    if (customTtsBaseUrlInput) currentSettings.customTtsBaseUrl = customTtsBaseUrlInput.value.trim();
    if (customTtsVoiceIdInput) currentSettings.customTtsVoiceId = customTtsVoiceIdInput.value.trim();
    if (customTtsModelIdInput) currentSettings.customTtsModelId = customTtsModelIdInput.value.trim();
    if (customTtsApiKeyInput) currentSettings.customTtsApiKey = customTtsApiKeyInput.value.trim();

    if (autoStartInput) currentSettings.autoStart = autoStartInput.checked;
    if (smartSkipNativeInput) currentSettings.smartSkipNative = smartSkipNativeInput.checked;
    if (autoPauseOnHoverInput) currentSettings.autoPauseOnHover = autoPauseOnHoverInput.checked;
    if (navHotkeysInput) currentSettings.navHotkeys = navHotkeysInput.checked;

    if (voiceVolumeInput) {
      currentSettings.voiceVolume = Number(voiceVolumeInput.value);
      if (voiceVolumeVal) voiceVolumeVal.textContent = `${currentSettings.voiceVolume}%`;
    }
    if (originalVolumeInput) {
      currentSettings.originalVolume = Number(originalVolumeInput.value);
      if (originalVolumeVal) originalVolumeVal.textContent = `${currentSettings.originalVolume}%`;
    }
    if (muteOriginalInput) currentSettings.muteOriginal = muteOriginalInput.checked;

    if (fontSizeInput) {
      currentSettings.fontSize = Number(fontSizeInput.value);
      if (fontSizeVal) fontSizeVal.textContent = `${currentSettings.fontSize}px`;
    }
    if (bottomOffsetInput) {
      currentSettings.bottomOffset = Number(bottomOffsetInput.value);
      if (bottomOffsetVal) bottomOffsetVal.textContent = `${currentSettings.bottomOffset}%`;
    }
    if (layoutPresetInput) currentSettings.layoutPreset = layoutPresetInput.value;
    if (highContrastInput) currentSettings.highContrast = highContrastInput.checked;

    if (subtitleOrderInput) currentSettings.subtitleOrder = subtitleOrderInput.value;
    if (subShadowStyleInput) currentSettings.subShadowStyle = subShadowStyleInput.value;
    if (subBackgroundOpacityInput) {
      currentSettings.subBackgroundOpacity = Number(subBackgroundOpacityInput.value);
      if (subBackgroundOpacityVal) subBackgroundOpacityVal.textContent = `${currentSettings.subBackgroundOpacity}%`;
    }
  }

  function showToast() {
    if (!saveToast) return;
    saveToast.classList.add("is-visible");
    setTimeout(() => saveToast.classList.remove("is-visible"), 1800);
  }

  // 6. Update Subtitle Preview
  function updatePreview() {
    if (!previewSubBox) return;
    previewSubBox.style.setProperty("--lumeo-caption-font-size", `${currentSettings.fontSize}px`);
    previewSubBox.style.setProperty("--lumeo-caption-bottom-offset", `${currentSettings.bottomOffset}%`);
    previewSubBox.style.fontSize = `${currentSettings.fontSize}px`;
    previewSubBox.style.bottom = `${currentSettings.bottomOffset}%`;
    previewSubBox.style.setProperty("--lumeo-sub-bg-opacity", String((currentSettings.subBackgroundOpacity ?? 75) / 100));

    // Shadow style classes
    previewSubBox.classList.remove("lumeo-shadow-none", "lumeo-shadow-drop-shadow", "lumeo-shadow-raised", "lumeo-shadow-depressed", "lumeo-shadow-outline");
    let shadow = currentSettings.subShadowStyle || "drop-shadow";
    if (shadow === "glow") shadow = "drop-shadow";
    if (shadow === "box") shadow = "outline";
    previewSubBox.classList.add(`lumeo-shadow-${shadow}`);

    previewSubBox.classList.toggle("high-contrast", !!currentSettings.highContrast);

    // Subtitle Order
    if (currentSettings.subtitleOrder === "source-top") {
      previewSubBox.classList.add("lumeo-order-source-top");
      if (previewSubSource && previewSubTranslated && previewSubSource.nextElementSibling !== previewSubTranslated) {
        previewSubBox.insertBefore(previewSubSource, previewSubTranslated);
      }
    } else {
      previewSubBox.classList.remove("lumeo-order-source-top");
      if (previewSubTranslated && previewSubSource && previewSubTranslated.nextElementSibling !== previewSubSource) {
        previewSubBox.insertBefore(previewSubTranslated, previewSubSource);
      }
    }

    const preset = currentSettings.layoutPreset;
    if (preset === "translated-only") {
      if (previewSubTranslated) previewSubTranslated.style.display = "block";
      if (previewSubSource) previewSubSource.style.display = "none";
    } else if (preset === "source-only") {
      if (previewSubTranslated) previewSubTranslated.style.display = "none";
      if (previewSubSource) previewSubSource.style.display = "block";
    } else {
      if (previewSubTranslated) previewSubTranslated.style.display = "block";
      if (previewSubSource) previewSubSource.style.display = "block";
    }
  }

  // 7. Input Listeners
  const allInputs = [
    translateProviderInput, targetLanguageInput,
    geminiKeyInput, geminiModelInput,
    openaiKeyInput, openaiModelInput,
    groqApiKeyInput, kymaKeyInput,
    customProxyBaseUrlInput, customProxyApiKeyInput, customProxyModelIdInput,
    captionTtsProviderInput, browserVoiceInput,
    customTtsBaseUrlInput, customTtsVoiceIdInput, customTtsApiKeyInput, customTtsModelIdInput,
    voiceVolumeInput, originalVolumeInput, muteOriginalInput,
    fontSizeInput, bottomOffsetInput, layoutPresetInput, highContrastInput,
    subtitleOrderInput, subShadowStyleInput, subBackgroundOpacityInput,
    autoStartInput, smartSkipNativeInput, autoPauseOnHoverInput, navHotkeysInput
  ];

  allInputs.forEach((input) => {
    if (!input) return;
    input.addEventListener("input", scheduleSave);
    input.addEventListener("change", () => {
      if (input === targetLanguageInput) {
        readInputs();
        populateBrowserVoices();
      }
      saveImmediately();
    });
  });

  function sendLiveVolumeUpdate() {
    const isMuted = !!muteOriginalInput?.checked;
    const origVol = isMuted ? 0 : (originalVolumeInput ? Number(originalVolumeInput.value) : 18);
    const voiceVol = voiceVolumeInput ? Number(voiceVolumeInput.value) : 100;
    try {
      chrome.runtime?.sendMessage?.({
        type: "UPDATE_VOLUME",
        originalVolume: origVol,
        voiceVolume: voiceVol,
      });
    } catch {}
  }

  voiceVolumeInput?.addEventListener("input", sendLiveVolumeUpdate);
  originalVolumeInput?.addEventListener("input", sendLiveVolumeUpdate);
  muteOriginalInput?.addEventListener("change", sendLiveVolumeUpdate);

  // Reset Subtitle Position Button
  btnResetPosition?.addEventListener("click", async () => {
    try {
      localStorage.removeItem("lumeoSubPosition");
      await STORAGE.remove("lumeoSubPosition");
    } catch {}
    if (bottomOffsetInput) bottomOffsetInput.value = 14;
    if (bottomOffsetVal) bottomOffsetVal.textContent = "14%";
    currentSettings.bottomOffset = 14;
    scheduleSave();
    showToast();
  });

  // 8. Eye Toggle Buttons
  document.querySelectorAll(".btn-eye").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      const targetInput = document.getElementById(targetId);
      if (!targetInput) return;
      if (targetInput.type === "password") {
        targetInput.type = "text";
        btn.textContent = "🙈";
      } else {
        targetInput.type = "password";
        btn.textContent = "👁";
      }
    });
  });

  // 9. Test API Key / Voice Buttons
  document.querySelectorAll(".btn-test").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const provider = btn.dataset.test;
      const prevText = btn.textContent;
      btn.textContent = "Testing...";
      btn.disabled = true;

      try {
        let msg = "";
        if (provider === "gemini") {
          const key = geminiKeyInput.value.trim();
          if (!key) throw new Error("Please enter a Gemini API Key");
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
          if (res.ok) { msg = "Gemini API Key is valid!"; }
          else { msg = `Error ${res.status}: Check key or permissions`; }
        } else if (provider === "openai") {
          const key = openaiKeyInput.value.trim();
          if (!key) throw new Error("Please enter an OpenAI API Key");
          const res = await fetch("https://api.openai.com/v1/models", {
            headers: { Authorization: `Bearer ${key}` }
          });
          if (res.ok) { msg = "OpenAI API Key is valid!"; }
          else { msg = `Error ${res.status}: Invalid key`; }
        } else if (provider === "groq") {
          const key = groqApiKeyInput.value.trim();
          if (!key) throw new Error("Please enter a Groq API Key");
          const res = await fetch("https://api.groq.com/openai/v1/models", {
            headers: { Authorization: `Bearer ${key}` }
          });
          if (res.ok) { msg = "Groq API Key is valid!"; }
          else { msg = `Error ${res.status}`; }
        } else if (provider === "custom-gateway") {
          const key = customProxyApiKeyInput.value.trim();
          const base = customProxyBaseUrlInput.value.trim().replace(/\/+$/, "");
          if (!base) throw new Error("Base URL is required. Please enter your Custom AI Gateway URL.");
          if (!key) throw new Error("Please enter an API Key for Custom AI Gateway");
          const url = base.endsWith("/models") ? base : `${base}/models`;
          const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
          if (res.ok) { msg = "Custom AI Gateway connected successfully!"; }
          else { msg = `Gateway error ${res.status}: Check Base URL or API Key`; }
        } else if (provider === "custom-tts") {
          const key = customTtsApiKeyInput.value.trim();
          const voiceId = customTtsVoiceIdInput.value.trim();
          const base = customTtsBaseUrlInput.value.trim().replace(/\/+$/, "");
          if (!base) throw new Error("Base URL is required. Please enter your Custom Voice Gateway URL.");
          if (!voiceId) throw new Error("Please enter a Voice ID string");
          if (base.includes("elevenlabs")) {
            if (!key) throw new Error("Please enter your ElevenLabs API Key");
            const url = `${base}/text-to-speech/${encodeURIComponent(voiceId)}`;
            const voiceModelId = customTtsModelIdInput?.value?.trim() || "eleven_turbo_v2_5";
            const res = await fetch(url, {
              method: "POST",
              headers: { "xi-api-key": key, "Content-Type": "application/json" },
              body: JSON.stringify({ text: "Hello! This is a test of your custom voice in Lumeo.", model_id: voiceModelId }),
            });
            if (res.ok) {
              const blob = await res.blob();
              const audio = new Audio(URL.createObjectURL(blob));
              audio.play().catch(() => {});
              msg = "Voice synthesized and playing successfully!";
            } else {
              msg = `Voice Engine error ${res.status}: Check Voice ID or API Key`;
            }
          } else {
            const url = base.endsWith("/audio/speech") ? base : `${base}/audio/speech`;
            const res = await fetch(url, {
              method: "POST",
              headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
              body: JSON.stringify({ model: "tts-1", voice: voiceId, input: "Hello! This is a test of your custom voice in Lumeo." }),
            });
            if (res.ok) {
              const blob = await res.blob();
              const audio = new Audio(URL.createObjectURL(blob));
              audio.play().catch(() => {});
              msg = "Voice synthesized and playing successfully!";
            } else {
              msg = `Voice Engine responded with status ${res.status}`;
            }
          }
        }
        alert(msg);
      } catch (err) {
        alert(err.message || "Test failed.");
      } finally {
        btn.textContent = prevText;
        btn.disabled = false;
      }
    });
  });

  // Fetch Voices from ElevenLabs / Custom TTS
  btnFetchCustomTtsVoices?.addEventListener("click", async () => {
    const key = customTtsApiKeyInput?.value?.trim();
    if (!key) {
      alert("Please enter your ElevenLabs API Key first to fetch voices.");
      return;
    }
    const origText = btnFetchCustomTtsVoices.textContent;
    btnFetchCustomTtsVoices.textContent = "⏳ Fetching...";
    btnFetchCustomTtsVoices.disabled = true;
    try {
      const base = (customTtsBaseUrlInput?.value?.trim() || "https://api.elevenlabs.io/v1").replace(/\/+$/, "");
      const res = await fetch(`${base}/voices`, {
        headers: { "xi-api-key": key },
      });
      if (!res.ok) {
        throw new Error(`ElevenLabs error ${res.status}: Check API Key or endpoint.`);
      }
      const data = await res.json();
      const voices = data?.voices || [];
      if (!voices.length) {
        alert("No voices found in your ElevenLabs account.");
        return;
      }
      if (customTtsVoiceSelect) {
        customTtsVoiceSelect.replaceChildren();
        const defOpt = document.createElement("option");
        defOpt.value = "";
        defOpt.textContent = `-- Choose from ${voices.length} voices in your account --`;
        customTtsVoiceSelect.appendChild(defOpt);

        voices.forEach((v) => {
          const opt = document.createElement("option");
          opt.value = v.voice_id;
          const desc = v.category ? ` [${v.category}]` : "";
          opt.textContent = `${v.name}${desc} (${v.voice_id.slice(0, 8)}...)`;
          customTtsVoiceSelect.appendChild(opt);
        });

        const manualOpt = document.createElement("option");
        manualOpt.value = "__manual__";
        manualOpt.textContent = "✏️ Enter custom Voice ID manually...";
        customTtsVoiceSelect.appendChild(manualOpt);

        customTtsVoiceSelect.style.display = "block";
      }
      alert(`Successfully loaded ${voices.length} voices from your account! Select a voice from the dropdown.`);
    } catch (err) {
      alert(err.message || "Failed to fetch voices.");
    } finally {
      btnFetchCustomTtsVoices.textContent = origText;
      btnFetchCustomTtsVoices.disabled = false;
    }
  });

  customTtsVoiceSelect?.addEventListener("change", () => {
    const selected = customTtsVoiceSelect.value;
    if (selected && selected !== "__manual__") {
      if (customTtsVoiceIdInput) {
        customTtsVoiceIdInput.value = selected;
        scheduleSave();
      }
    }
  });

  // 10. Cache & Export Tools
  btnClearCache?.addEventListener("click", async () => {
    try {
      localStorage.removeItem("lumeoCaptionCacheV1");
      await STORAGE.remove("lumeoCaptionCacheV1");
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ action: "captionCacheClear" }, () => {});
      }
      cacheStatusMsg.textContent = "Subtitle cache cleared successfully!";
      setTimeout(() => cacheStatusMsg.textContent = "", 3000);
    } catch {
      cacheStatusMsg.textContent = "Failed to clear cache.";
    }
  });

  btnExportSrt?.addEventListener("click", async () => {
    try {
      const stored = await STORAGE.get("lumeoCaptionCacheV1");
      const cache = stored?.lumeoCaptionCacheV1 || {};
      const entries = cache.entries || {};
      const keys = Object.keys(entries);
      if (!keys.length) {
        cacheStatusMsg.textContent = "No cached subtitles found to export.";
        setTimeout(() => cacheStatusMsg.textContent = "", 3000);
        return;
      }
      let srtContent = "";
      let index = 1;
      const formatTime = (sec) => {
        const totalMs = Math.round((Number(sec) || 0) * 1000);
        const h = Math.floor(totalMs / 3600000).toString().padStart(2, "0");
        const m = Math.floor((totalMs % 3600000) / 60000).toString().padStart(2, "0");
        const s = Math.floor((totalMs % 60000) / 1000).toString().padStart(2, "0");
        const ms = (totalMs % 1000).toString().padStart(3, "0");
        return `${h}:${m}:${s},${ms}`;
      };
      for (const k of keys) {
        const entry = entries[k];
        if (!entry) continue;
        const cuesList = Array.isArray(entry.cues) ? entry.cues : (entry.text ? [entry] : []);
        for (const cue of cuesList) {
          const text = cue.translated || cue.text || "";
          if (!text) continue;
          const start = cue.start != null ? cue.start : (index - 1) * 3;
          const end = cue.end != null ? cue.end : (index * 3);
          srtContent += `${index}\n${formatTime(start)} --> ${formatTime(end)}\n${text}\n\n`;
          index++;
        }
      }
      const blob = new Blob([srtContent], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lumeo-subtitles-${Date.now()}.srt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      cacheStatusMsg.textContent = `Exported ${index - 1} subtitle cues!`;
      setTimeout(() => cacheStatusMsg.textContent = "", 3000);
    } catch (err) {
      cacheStatusMsg.textContent = "Export error: " + (err.message || String(err));
    }
  });

  btnResetAll?.addEventListener("click", async () => {
    if (!confirm("Are you sure you want to reset all settings to defaults?")) return;
    try {
      await STORAGE.clear();
      localStorage.clear();
      currentSettings = { ...DEFAULT_SETTINGS };
      populateInputs();
      updatePreview();
      updateTtsSectionsVisibility();
      alert("All settings restored to defaults!");
    } catch (err) {
      alert("Error: " + err.message);
    }
  });

  // 11. Dynamic Shortcut Display & Config Button
  if (typeof chrome !== "undefined" && chrome.commands?.getAll) {
    chrome.commands.getAll((commands) => {
      const toggleCmd = commands?.find((c) => c.name === "_execute_action" || c.name === "toggle-overlay");
      if (toggleCmd?.shortcut) {
        const el = document.getElementById("shortcutToggle");
        if (el) el.textContent = toggleCmd.shortcut;
      }
    });
  }

  btnConfigureShortcuts?.addEventListener("click", () => {
    if (typeof chrome !== "undefined" && chrome.tabs?.create) {
      chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
    }
  });

  // 12. 2-way live sync via chrome.storage.onChanged
  if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;
      let hasChanges = false;
      for (const [key, change] of Object.entries(changes)) {
        if (key in DEFAULT_SETTINGS && currentSettings[key] !== change.newValue) {
          currentSettings[key] = change.newValue;
          hasChanges = true;
        }
      }
      if (hasChanges) {
        populateInputs();
        updatePreview();
        updateTtsSectionsVisibility();
      }
    });
  }

  // Init
  loadSettings();
})();
