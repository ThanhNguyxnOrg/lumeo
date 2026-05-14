// Lumeo — background service worker.
// Single source of truth for session state across the popup and content script.
//
// Popup is a passive renderer: it never reads chrome.storage to decide running
// state. Content script owns the WebRTC PeerConnection lifecycle for the
// Standard / Realtime dubbing pipelines, and the timedtext fetch loop for the
// Caption pipeline. Background glues them: ensureContentScript(tabId) makes
// Start work without a refresh, state.* is the canonical snapshot,
// BACKGROUND_STATE_UPDATE pushes to popup, CONTENT_UPDATE pushes to the active
// YT tab.
//
// Inherits the Echoly v0.2.1 state machine (2026-05-08 baseline) and extends
// it with Caption-tier scaffolding for the v2.0 merge.

import "./lib/browser-api.js";

const browserApi = globalThis.LumeoBrowserApi;

const DEFAULT_SETTINGS = {
  tier: "caption",
  targetLanguage: "vi",
  translateProvider: "google-free",
  sttProvider: "none",
  captionTtsProvider: "off",
  dubProvider: "kyma",
  realtimeProvider: "kyma-realtime",
  openaiKey: "",
  openaiModel: "gpt-4o-mini",
  geminiKey: "",
  geminiModel: "gemini-2.5-flash-lite",
  openRouterKey: "",
  openRouterModel: "openrouter/free",
  groqApiKey: "",
  groqModel: "llama-3.3-70b-versatile",
  // Reserved provider fields stay in settings so popup/storage migrations do
  // not churn while the corresponding registry entries remain coming-soon.
  huggingFaceToken: "",
  hfModel: "",
  googleCloudKey: "",
  libreTranslateUrl: "",
  libreTranslateKey: "",
  sonioxApiKey: "",
  elevenLabsKey: "",
  minimaxKey: "",
  replicateKey: "",
  translationContext: "",
  realtimeVoice: "marin",
  // Standard tier (Minimax chunked pipeline). Default voice is Magnetic Man,
  // the male voice Son ranked highest in the 2026-05-08 listening test.
  standardVoice: "English_magnetic_voiced_man",
  originalVolume: 18,
  voiceVolume: 100,
  showSource: false,
  kymaKey: "",
};

// In-memory state. Resets when the service worker cold-starts; that's
// intentional — the user gets a clean idle on cold start.
const state = {
  running: false,
  connecting: false,
  paused: false,
  tabId: null,
  status: "Ready",
  errorMessage: "",
  errorCode: "",
  missingProviders: [],
  slotsMissingKeys: [],
  ...DEFAULT_SETTINGS,
};

// Restrict storage access so rogue page scripts on youtube.com cannot read
// the user's Kyma key. Sticky, no retry needed.
browserApi.setStorageAccessLevel("TRUSTED_CONTEXTS").catch(() => {});

let lastBroadcastAt = 0;
const BROADCAST_DEBOUNCE_MS = 50;
let sonioxWs = null;
let sonioxTabId = null;

function snapshot() {
  return { ...state };
}

function broadcastToPopup() {
  // Debounce: 1 broadcast per 50 ms. Popup re-renders are cheap but spamming
  // is wasteful while volume sliders drag.
  const now = Date.now();
  if (now - lastBroadcastAt < BROADCAST_DEBOUNCE_MS) return;
  lastBroadcastAt = now;
  browserApi.sendRuntimeMessage({ type: "BACKGROUND_STATE_UPDATE", state: snapshot() }).catch(() => {});
}

async function relayToContent(tabId, message) {
  if (!tabId) throw new Error("No active tab to relay to.");
  return browserApi.sendTabMessage(tabId, message);
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function fetchJSON(url, init = {}) {
  const response = await fetch(url, {
    method: init.method || "GET",
    headers: init.headers || {},
    body: init.body || undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.error || `HTTP ${response.status}`);
  }
  return data;
}

function isYouTubeUrl(url) {
  return typeof url === "string" && /^https?:\/\/[^/]*youtube\.com\//.test(url);
}

async function activeYouTubeTab() {
  const [tab] = await browserApi.queryTabs({ active: true, currentWindow: true });
  if (!tab) throw new Error("No active tab.");
  if (!isYouTubeUrl(tab.url)) throw new Error("Open a YouTube video first.");
  return tab;
}

const CONTENT_SCRIPT_FILES = [
  "lib/browser-api.js",
  "lib/token-guard.js",
  "lib/audio-utils.js",
  "ui/overlay.js",
  "ui/subtitle-overlay.js",
  "ui/voice-picker.js",
  "ui/caption-fallback-choice.js",
  "services/providers.js",
  "services/translate.js",
  "services/srt-export.js",
  "services/tts-browser.js",
  "services/tts-openai.js",
  "services/stt-soniox.js",
  "services/stt-groq.js",
  "services/captions.js",
  "services/kyma-client.js",
  "pipelines/caption.js",
  "pipelines/caption-orchestrator.js",
  "pipelines/realtime.js",
  "pipelines/standard.js",
  "content.js",
];
const EXPECTED_CONTENT_VERSION = "1.0.0";
const CAPTION_CACHE_KEY = "lumeoCaptionCacheV1";

async function readCaptionCache() {
  const stored = await chrome.storage.local.get(CAPTION_CACHE_KEY);
  return stored[CAPTION_CACHE_KEY] || { entries: {} };
}

async function writeCaptionCache(cache) {
  await chrome.storage.local.set({ [CAPTION_CACHE_KEY]: cache || { entries: {} } });
}

// Ensure content script and its support modules are alive in the target tab.
// PING first; if the old content script is present but the new Caption modules
// are missing (common after extension reload on an already-open YouTube tab),
// inject support files again before starting.
async function ensureContentScript(tabId) {
  let shouldReset = false;
  try {
    const reply = await chrome.tabs.sendMessage(tabId, { type: "CONTENT_PING" });
    if (reply?.ok &&
        reply.version === EXPECTED_CONTENT_VERSION &&
        reply.browserApi &&
        reply.captionPipeline &&
        reply.realtimePipeline &&
        reply.standardPipeline &&
        reply.translateService &&
        reply.captionService &&
        reply.kymaService &&
        reply.srtService &&
        reply.ttsService &&
        reply.sonioxService &&
        reply.audioUtils &&
        reply.tokenGuard &&
        reply.groqService &&
        reply.openaiTts &&
        reply.overlayModule &&
        reply.subtitleOverlayModule &&
        reply.captionFallbackChoice &&
        reply.captionOrchestrator) {
      return;
    }
    shouldReset = !!reply?.ok;
  } catch {
    // Not yet injected.
  }
  if (shouldReset) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          delete window.__lumeoContentVersion;
          for (const key of [
            "LumeoBrowserApi",
            "LumeoTokenGuard",
            "LumeoAudioUtils",
            "LumeoOverlay",
            "LumeoSubtitleOverlay",
            "LumeoVoicePicker",
            "LumeoCaptionFallbackChoice",
            "LumeoProviders",
            "LumeoTranslate",
            "LumeoSrtExport",
            "LumeoTTS",
            "LumeoOpenAITTS",
            "LumeoSonioxSTT",
            "LumeoGroqSTT",
            "LumeoCaptions",
            "LumeoKyma",
            "LumeoCaptionPipeline",
            "LumeoCaptionOrchestrator",
            "LumeoRealtimePipeline",
            "LumeoStandardPipeline",
          ]) {
            try { delete window[key]; } catch {}
          }
          document.querySelectorAll(".ec-root").forEach((el) => el.remove());
        },
      });
    } catch {
      // If reset fails, the following injection still covers fresh tabs.
    }
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: CONTENT_SCRIPT_FILES,
  });
  // Inserting CSS via scripting API too, since content_scripts manifest entry
  // does not run on the just-injected page if the tab pre-existed extension.
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["content.css"],
    });
  } catch {
    // CSS may already be present from manifest static match — harmless.
  }
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  Object.assign(state, stored);
  return stored;
}

async function persistSettings(partial) {
  Object.assign(state, partial);
  const persistable = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (k in partial) persistable[k] = state[k];
  }
  if (Object.keys(persistable).length) {
    await chrome.storage.local.set(persistable);
  }
}

async function handleStart(settings) {
  if (state.running || state.connecting) {
    return { ok: false, error: "Session already running." };
  }
  await persistSettings(settings || {});
  let tab;
  try {
    tab = await activeYouTubeTab();
  } catch (err) {
    return { ok: false, error: err.message };
  }
  state.tabId = tab.id;
  state.connecting = true;
  state.errorMessage = "";
  state.errorCode = "";
  state.missingProviders = [];
  state.slotsMissingKeys = [];
  state.status = "Connecting";
  broadcastToPopup();

  try {
    await ensureContentScript(tab.id);
    const reply = await relayToContent(tab.id, {
      type: "CONTENT_START",
      settings: snapshot(),
    });
    if (!reply?.ok) {
      state.connecting = false;
      state.running = false;
      state.errorMessage = reply?.error || "Could not start translation.";
      state.errorCode = reply?.errorCode || "";
      state.missingProviders = reply?.missingProviders || [];
      state.slotsMissingKeys = reply?.slotsMissingKeys || [];
      state.status = state.errorMessage;
      broadcastToPopup();
      return {
        ok: false,
        error: state.errorMessage,
        errorCode: state.errorCode,
        missingProviders: state.missingProviders,
        slotsMissingKeys: state.slotsMissingKeys,
        state: snapshot(),
      };
    }
    state.connecting = false;
    state.running = true;
    state.status = "Translating";
    broadcastToPopup();
    return { ok: true, state: snapshot() };
  } catch (err) {
    state.connecting = false;
    state.running = false;
    state.errorMessage = err.message || String(err);
    state.errorCode = err.errorCode || err.code || "";
    state.missingProviders = err.missingProviders || [];
    state.slotsMissingKeys = err.slotsMissingKeys || [];
    state.status = state.errorMessage;
    broadcastToPopup();
    return { ok: false, error: state.errorMessage };
  }
}

async function handleStop() {
  const tabId = state.tabId;
  state.running = false;
  state.connecting = false;
  state.paused = false;
  state.errorMessage = "";
  state.errorCode = "";
  state.missingProviders = [];
  state.slotsMissingKeys = [];
  state.status = "Stopped";
  broadcastToPopup();
  if (tabId) {
    try {
      await relayToContent(tabId, { type: "CONTENT_STOP" });
    } catch {
      // Tab may be gone; that's fine.
    }
  }
  state.tabId = null;
  return { ok: true, state: snapshot() };
}

async function handleUpdateSettings(settings) {
  await persistSettings(settings || {});
  if (!state.running && !state.connecting) {
    state.errorMessage = "";
    state.errorCode = "";
    state.missingProviders = [];
    state.slotsMissingKeys = [];
    state.status = "Ready";
  }
  broadcastToPopup();
  if (state.tabId && (state.running || state.connecting)) {
    try {
      const reply = await relayToContent(state.tabId, {
        type: "CONTENT_UPDATE_SETTINGS",
        settings: snapshot(),
      });
      if (reply?.state) Object.assign(state, reply.state);
    } catch (err) {
      state.errorMessage = err.message || String(err);
      broadcastToPopup();
    }
  }
  return { ok: true, state: snapshot() };
}

async function handleUpdateVolume(originalVolume, voiceVolume) {
  if (typeof originalVolume === "number") state.originalVolume = originalVolume;
  if (typeof voiceVolume === "number") state.voiceVolume = voiceVolume;
  // Persist debounced — slider drag fires many times.
  chrome.storage.local
    .set({ originalVolume: state.originalVolume, voiceVolume: state.voiceVolume })
    .catch(() => {});
  if (state.tabId) {
    try {
      await relayToContent(state.tabId, {
        type: "CONTENT_UPDATE_VOLUME",
        originalVolume: state.originalVolume,
        voiceVolume: state.voiceVolume,
      });
    } catch {
      // Tab gone; volume will be re-applied next start.
    }
  }
  return { ok: true };
}

// Content-side push: session live state + transient events.
function handleContentEvent(message) {
  if (message.type === "UPDATE_SETTINGS" && message.settings && typeof message.settings === "object") {
    void persistSettings(message.settings).then(() => broadcastToPopup());
  }
  if (message.type === "CONTENT_STATE") {
    if (typeof message.running === "boolean") state.running = message.running;
    if (typeof message.paused === "boolean") state.paused = message.paused;
    if (typeof message.status === "string") state.status = message.status;
    if (typeof message.errorMessage === "string") state.errorMessage = message.errorMessage;
    if (typeof message.errorCode === "string") state.errorCode = message.errorCode;
    if (Array.isArray(message.missingProviders)) state.missingProviders = message.missingProviders;
    if (Array.isArray(message.slotsMissingKeys)) state.slotsMissingKeys = message.slotsMissingKeys;
    broadcastToPopup();
  }
  if (message.type === "OPEN_POPUP_TO_SLOT") {
    chrome.runtime
      .sendMessage({ type: "OPEN_POPUP_TO_SLOT", slot: message.slot || message.provider || "" })
      .catch(() => {});
  }
  if (message.type === "CONTENT_ENDED") {
    state.running = false;
    state.connecting = false;
    state.paused = false;
    state.tabId = null;
    state.status = message.reason || "Stopped";
    broadcastToPopup();
  }
}

function startSonioxWebSocket(apiKey, langHints) {
  closeSonioxWebSocket();

  sonioxWs = new WebSocket("wss://stt-rt.soniox.com/transcribe-websocket");

  sonioxWs.onopen = () => {
    sonioxWs.send(JSON.stringify({
      api_key: apiKey,
      // stt-rt-v4 is the current real-time model. Soniox auto-routes
      // stt-rt-preview to v4 after 2026-02-28 but we pin the version
      // explicitly so a future rename fails loudly instead of silent drift.
      model: "stt-rt-v4",
      audio_format: "pcm_s16le",
      sample_rate: 16000,
      num_channels: 1,
      language_hints: langHints || [],
      enable_endpoint_detection: true,
      enable_language_identification: true,
    }));
    forwardToSonioxTab({ action: "sonioxStatus", status: "connected" });
  };

  sonioxWs.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.error_code) {
        forwardToSonioxTab({
          action: "sonioxError",
          error: `${data.error_code}: ${data.error_message}`,
        });
        closeSonioxWebSocket();
        return;
      }
      forwardToSonioxTab({ action: "sonioxResult", data });
    } catch {
      // Ignore malformed upstream frames; the next valid frame recovers.
    }
  };

  sonioxWs.onerror = () => {
    forwardToSonioxTab({ action: "sonioxError", error: "WebSocket connection failed" });
  };

  sonioxWs.onclose = () => {
    forwardToSonioxTab({ action: "sonioxResult", data: { tokens: [], finished: true } });
    sonioxWs = null;
  };
}

function closeSonioxWebSocket() {
  if (!sonioxWs) return;
  try {
    if (sonioxWs.readyState === WebSocket.OPEN) sonioxWs.send("");
  } catch {
    // Best-effort flush before closing.
  }
  try { sonioxWs.close(); } catch {}
  sonioxWs = null;
}

function forwardToSonioxTab(msg) {
  if (sonioxTabId) chrome.tabs.sendMessage(sonioxTabId, msg).catch(() => {});
}

function handleLegacyCaptionMessage(message, sender, sendResponse) {
  switch (message?.action) {
    case "fetchUrl":
      fetchText(message.url)
        .then((text) => sendResponse({ ok: true, text }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    case "fetchJSON":
      fetchJSON(message.url, message)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    case "startSonioxWs":
      sonioxTabId = sender.tab?.id || state.tabId;
      startSonioxWebSocket(message.apiKey, message.langHints);
      sendResponse({ ok: true });
      return false;
    case "sonioxAudio":
      if (sonioxWs?.readyState === WebSocket.OPEN) {
        sonioxWs.send(new Int16Array(message.samples).buffer);
      }
      return false;
    case "stopSonioxWs":
      closeSonioxWebSocket();
      sendResponse({ ok: true });
      return false;
    case "captionCacheGet":
      readCaptionCache()
        .then((cache) => sendResponse({ ok: true, cache }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    case "captionCacheSet":
      writeCaptionCache(message.cache)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    case "captionCacheClear":
      writeCaptionCache({ entries: {}, stats: { bytes: 0, count: 0, clearedAt: Date.now() } })
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    default:
      return null;
  }
}

// Popup → background → content router.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const legacyHandled = handleLegacyCaptionMessage(message, sender, sendResponse);
  if (legacyHandled !== null) return legacyHandled;

  // Content-originated messages (have sender.tab).
  if (sender.tab) {
    handleContentEvent(message);
    sendResponse?.({ ok: true });
    return false;
  }

  // Popup-originated messages (no sender.tab).
  (async () => {
    try {
      switch (message?.type) {
        case "GET_STATE":
          await loadSettings();
          if (!state.running && !state.connecting) {
            state.errorMessage = "";
            state.errorCode = "";
            state.missingProviders = [];
            state.slotsMissingKeys = [];
            state.status = "Ready";
          }
          sendResponse({ ok: true, state: snapshot() });
          break;
        case "START":
          sendResponse(await handleStart(message.settings));
          break;
        case "STOP":
          sendResponse(await handleStop());
          break;
        case "UPDATE_SETTINGS":
          sendResponse(await handleUpdateSettings(message.settings));
          break;
        case "UPDATE_VOLUME":
          sendResponse(await handleUpdateVolume(
            message.originalVolume,
            message.voiceVolume,
          ));
          break;
        case "OPEN_POPUP_TO_SLOT":
          chrome.runtime
            .sendMessage({ type: "OPEN_POPUP_TO_SLOT", slot: message.slot || message.provider || "" })
            .catch(() => {});
          sendResponse({ ok: true });
          break;
        default:
          sendResponse({ ok: false, error: "Unknown message: " + message?.type });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
  })();
  return true;  // async sendResponse
});

// Tab close / navigate away → stop session cleanly so Kyma sees the /end.
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === sonioxTabId) {
    closeSonioxWebSocket();
    sonioxTabId = null;
  }
  if (tabId === state.tabId) {
    void handleStop();
  }
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId !== state.tabId) return;
  if (!changeInfo.url) return;
  // YT is a SPA; URL change happens for /watch?v= switches too.
  // Stop on any URL change so the new video starts clean.
  void handleStop();
});

void loadSettings();
