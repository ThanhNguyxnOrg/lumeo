// Lumeo Options Page Controller
(() => {
  "use strict";

  const STORAGE = chrome.storage.local;

  const DEFAULT_SETTINGS = {
    translateProvider: "google-free",
    geminiKey: "",
    geminiModel: "gemini-2.5-flash-lite",
    openaiKey: "",
    openaiModel: "gpt-4o-mini",
    groqApiKey: "",
    kymaKey: "",
    captionTtsProvider: "off",
    voiceVolume: 100,
    originalVolume: 18,
    muteOriginal: false,
    fontSize: 22,
    bottomOffset: 14,
    highContrast: false,
    layoutPreset: "stacked",
  };

  let currentSettings = { ...DEFAULT_SETTINGS };
  let saveDebounceTimer = null;

  // DOM Elements
  const tabButtons = document.querySelectorAll(".nav-tab");
  const panelSections = document.querySelectorAll(".panel-section");
  const sectionTitle = document.getElementById("sectionTitle");
  const sectionDesc = document.getElementById("sectionDesc");
  const saveToast = document.getElementById("saveToast");

  // Inputs
  const translateProviderInput = document.getElementById("translateProvider");
  const geminiKeyInput = document.getElementById("geminiKey");
  const geminiModelInput = document.getElementById("geminiModel");
  const openaiKeyInput = document.getElementById("openaiKey");
  const openaiModelInput = document.getElementById("openaiModel");
  const groqApiKeyInput = document.getElementById("groqApiKey");
  const kymaKeyInput = document.getElementById("kymaKey");

  const captionTtsProviderInput = document.getElementById("captionTtsProvider");
  const voiceVolumeInput = document.getElementById("voiceVolume");
  const voiceVolumeVal = document.getElementById("voiceVolumeVal");
  const originalVolumeInput = document.getElementById("originalVolume");
  const originalVolumeVal = document.getElementById("originalVolumeVal");
  const muteOriginalInput = document.getElementById("muteOriginal");

  const fontSizeInput = document.getElementById("fontSize");
  const fontSizeVal = document.getElementById("fontSizeVal");
  const bottomOffsetInput = document.getElementById("bottomOffset");
  const bottomOffsetVal = document.getElementById("bottomOffsetVal");
  const layoutPresetInput = document.getElementById("layoutPreset");
  const highContrastInput = document.getElementById("highContrast");

  // Preview elements
  const previewSubBox = document.getElementById("previewSubBox");
  const previewSubTranslated = document.getElementById("previewSubTranslated");
  const previewSubSource = document.getElementById("previewSubSource");

  // Cache elements
  const btnClearCache = document.getElementById("btnClearCache");
  const btnExportSrt = document.getElementById("btnExportSrt");
  const cacheStatusMsg = document.getElementById("cacheStatusMsg");
  const btnResetAll = document.getElementById("btnResetAll");

  const TAB_METADATA = {
    providers: {
      title: "API Keys & AI Providers",
      desc: "Manage your private AI service keys. All keys are stored securely and locally on your browser.",
    },
    subtitles: {
      title: "Subtitle Style & Appearance",
      desc: "Adjust font size, position, and contrast of on-video subtitles in real time.",
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

  // 2. Load Settings from Storage
  async function loadSettings() {
    try {
      const stored = await STORAGE.get(null);
      currentSettings = { ...DEFAULT_SETTINGS, ...stored };

      // Also read caption style from localStorage if present
      try {
        const style = JSON.parse(localStorage.getItem("lumeoCaptionStyle") || "{}");
        currentSettings = { ...currentSettings, ...style };
      } catch {}

      populateInputs();
      updatePreview();
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  }

  function populateInputs() {
    translateProviderInput.value = currentSettings.translateProvider || "google-free";
    geminiKeyInput.value = currentSettings.geminiKey || "";
    geminiModelInput.value = currentSettings.geminiModel || "gemini-2.5-flash-lite";
    openaiKeyInput.value = currentSettings.openaiKey || "";
    openaiModelInput.value = currentSettings.openaiModel || "gpt-4o-mini";
    groqApiKeyInput.value = currentSettings.groqApiKey || "";
    kymaKeyInput.value = currentSettings.kymaKey || "";

    captionTtsProviderInput.value = currentSettings.captionTtsProvider || "off";
    voiceVolumeInput.value = currentSettings.voiceVolume ?? 100;
    voiceVolumeVal.textContent = `${voiceVolumeInput.value}%`;
    originalVolumeInput.value = currentSettings.originalVolume ?? 18;
    originalVolumeVal.textContent = `${originalVolumeInput.value}%`;
    muteOriginalInput.checked = !!currentSettings.muteOriginal;

    fontSizeInput.value = currentSettings.fontSize ?? 22;
    fontSizeVal.textContent = `${fontSizeInput.value}px`;
    bottomOffsetInput.value = currentSettings.bottomOffset ?? 14;
    bottomOffsetVal.textContent = `${bottomOffsetInput.value}%`;
    layoutPresetInput.value = currentSettings.layoutPreset || "stacked";
    highContrastInput.checked = !!currentSettings.highContrast;
  }

  // 3. Save Settings to Storage
  function scheduleSave() {
    readInputs();
    updatePreview();
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(async () => {
      try {
        await STORAGE.set(currentSettings);
        showToast();
      } catch (err) {
        console.error("Failed to save settings:", err);
      }
    }, 150);
  }

  function readInputs() {
    currentSettings.translateProvider = translateProviderInput.value;
    currentSettings.geminiKey = geminiKeyInput.value.trim();
    currentSettings.geminiModel = geminiModelInput.value;
    currentSettings.openaiKey = openaiKeyInput.value.trim();
    currentSettings.openaiModel = openaiModelInput.value;
    currentSettings.groqApiKey = groqApiKeyInput.value.trim();
    currentSettings.kymaKey = kymaKeyInput.value.trim();

    currentSettings.captionTtsProvider = captionTtsProviderInput.value;
    currentSettings.voiceVolume = Number(voiceVolumeInput.value);
    currentSettings.originalVolume = Number(originalVolumeInput.value);
    currentSettings.muteOriginal = muteOriginalInput.checked;

    currentSettings.fontSize = Number(fontSizeInput.value);
    currentSettings.bottomOffset = Number(bottomOffsetInput.value);
    currentSettings.layoutPreset = layoutPresetInput.value;
    currentSettings.highContrast = highContrastInput.checked;

    voiceVolumeVal.textContent = `${currentSettings.voiceVolume}%`;
    originalVolumeVal.textContent = `${currentSettings.originalVolume}%`;
    fontSizeVal.textContent = `${currentSettings.fontSize}px`;
    bottomOffsetVal.textContent = `${currentSettings.bottomOffset}%`;
  }

  function showToast() {
    saveToast.classList.add("is-visible");
    setTimeout(() => saveToast.classList.remove("is-visible"), 1800);
  }

  // 4. Update Subtitle Preview
  function updatePreview() {
    if (!previewSubBox) return;
    previewSubBox.style.fontSize = `${currentSettings.fontSize}px`;
    previewSubBox.style.bottom = `${currentSettings.bottomOffset}%`;
    previewSubBox.classList.toggle("high-contrast", !!currentSettings.highContrast);

    const preset = currentSettings.layoutPreset;
    if (preset === "translated-only") {
      previewSubTranslated.style.display = "block";
      previewSubSource.style.display = "none";
    } else if (preset === "source-only") {
      previewSubTranslated.style.display = "none";
      previewSubSource.style.display = "block";
    } else {
      previewSubTranslated.style.display = "block";
      previewSubSource.style.display = "block";
    }
  }

  // 5. Input Listeners
  const allInputs = [
    translateProviderInput, geminiKeyInput, geminiModelInput,
    openaiKeyInput, openaiModelInput, groqApiKeyInput, kymaKeyInput,
    captionTtsProviderInput, voiceVolumeInput, originalVolumeInput,
    muteOriginalInput, fontSizeInput, bottomOffsetInput,
    layoutPresetInput, highContrastInput
  ];

  allInputs.forEach((input) => {
    if (!input) return;
    input.addEventListener("input", scheduleSave);
    input.addEventListener("change", scheduleSave);
  });

  // 6. Eye Toggle Buttons
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

  // 7. Test API Key Buttons
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
        }
        alert(msg);
      } catch (err) {
        alert(err.message || "Key test failed.");
      } finally {
        btn.textContent = prevText;
        btn.disabled = false;
      }
    });
  });

  // 8. Cache Tools
  btnClearCache?.addEventListener("click", async () => {
    try {
      localStorage.removeItem("lumeoCaptionCacheV1");
      await STORAGE.remove("lumeoCaptionCacheV1");
      cacheStatusMsg.textContent = "Subtitle cache cleared successfully!";
      setTimeout(() => cacheStatusMsg.textContent = "", 3000);
    } catch {
      cacheStatusMsg.textContent = "Failed to clear cache.";
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
      alert("All settings restored to defaults!");
    } catch (err) {
      alert("Error: " + err.message);
    }
  });

  // Init
  loadSettings();
})();
