// Lumen Subtitle Studio — popup script.
// Passive renderer: background owns state. Popup queries GET_STATE on open,
// subscribes to BACKGROUND_STATE_UPDATE pushes, and dispatches user actions
// via runtime messages. Tier list will gain the Caption option in Phase 2 of
// the v2.0 merge.

const $ = (id) => document.getElementById(id);
const tierSelect = $("tier");
const voiceSelect = $("voice");
const langSelect = $("lang");
const kymaKeyInput = $("kymaKey");
const keyBadge = $("keyBadge");
const toggleBtn = $("toggle");
const statusEl = $("status");
const originalVolumeInput = $("originalVolume");
const voiceVolumeInput = $("voiceVolume");
const originalOut = $("originalOut");
const voiceOut = $("voiceOut");
const showSourceCheckbox = $("showSource");

const LANGUAGES = [
  ["en", "English"], ["vi", "Vietnamese"], ["ja", "Japanese"],
  ["ko", "Korean"], ["zh", "Chinese"], ["fr", "French"],
  ["es", "Spanish"], ["de", "German"], ["pt", "Portuguese"],
  ["hi", "Hindi"], ["id", "Indonesian"], ["it", "Italian"],
  ["ru", "Russian"],
];
const REALTIME_VOICES = [
  { id: "", name: "Auto · clones speaker" },
  { id: "marin", name: "Marin" },
  { id: "alloy", name: "Alloy" },
  { id: "ash", name: "Ash" },
  { id: "ballad", name: "Ballad" },
  { id: "coral", name: "Coral" },
  { id: "echo", name: "Echo" },
  { id: "sage", name: "Sage" },
  { id: "shimmer", name: "Shimmer" },
  { id: "verse", name: "Verse" },
];
// Standard tier — Minimax `speech-02-turbo` voice IDs. Cross-language: each
// voice speaks any of the 13 target languages. Curated from the 333-voice
// catalog after a Vietnamese listening test (Son, 2026-05-08).
const STANDARD_VOICES = [
  { id: "English_magnetic_voiced_man",  name: "Magnetic Man" },
  { id: "English_captivating_female1",  name: "Captivating Female" },
  { id: "English_ManWithDeepVoice",     name: "Deep Voice Man" },
  { id: "English_ConfidentWoman",       name: "Confident Woman" },
  { id: "Chinese (Mandarin)_News_Anchor", name: "News Anchor" },
];

let state = {
  running: false, connecting: false, paused: false,
  tier: "realtime", targetLanguage: "vi",
  realtimeVoice: "marin",
  standardVoice: "English_magnetic_voiced_man",
  originalVolume: 18, voiceVolume: 100, showSource: false,
  kymaKey: "", status: "Ready",
};

function populateLanguages() {
  for (const [code, name] of LANGUAGES) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = name;
    langSelect.appendChild(opt);
  }
}

// Voice list swaps between tiers. Called whenever the tier changes so the
// dropdown only shows valid voices for the current pipeline. Tries to keep
// the prior selection if the new tier has a matching id; otherwise falls
// back to the first option.
function repopulateVoices(tier, preferredVoiceId) {
  const list = tier === "standard" ? STANDARD_VOICES : REALTIME_VOICES;
  voiceSelect.replaceChildren();
  for (const v of list) {
    const opt = document.createElement("option");
    opt.value = v.id;
    opt.textContent = v.name;
    voiceSelect.appendChild(opt);
  }
  const wanted = preferredVoiceId ?? "";
  const match = Array.from(voiceSelect.options).some((o) => o.value === wanted);
  voiceSelect.value = match ? wanted : list[0].id;
}

function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (reply) => {
      const e = chrome.runtime.lastError;
      if (e) reject(new Error(e.message));
      else resolve(reply);
    });
  });
}

function isBenign(msg) {
  if (!msg) return false;
  return /message channel closed|asynchronous response|message port closed|Receiving end does not exist/i.test(msg);
}

function setStateClass(name) {
  document.body.dataset.state = name;
}

function setKeyBadge(k) {
  keyBadge.classList.remove("ok", "warn");
  if (!k) {
    keyBadge.textContent = "missing";
  } else if (k.startsWith("ky") || k.startsWith("kyma-")) {
    keyBadge.textContent = "saved";
    keyBadge.classList.add("ok");
  } else {
    keyBadge.textContent = "check";
    keyBadge.classList.add("warn");
  }
}

function applyState(s) {
  state = { ...state, ...s };
  if (typeof state.tier === "string") {
    const allowed = state.tier === "standard" ? "standard" : "realtime";
    if (tierSelect.value !== allowed) tierSelect.value = allowed;
  }
  if (typeof state.targetLanguage === "string") langSelect.value = state.targetLanguage;
  // Voice list depends on tier — repopulate then select the saved id for
  // the current tier (realtimeVoice when realtime, standardVoice when standard).
  const activeVoice = tierSelect.value === "standard" ? state.standardVoice : state.realtimeVoice;
  repopulateVoices(tierSelect.value, activeVoice);
  if (typeof state.originalVolume === "number") {
    originalVolumeInput.value = state.originalVolume;
    originalOut.textContent = state.originalVolume;
  }
  if (typeof state.voiceVolume === "number") {
    voiceVolumeInput.value = state.voiceVolume;
    voiceOut.textContent = state.voiceVolume;
  }
  if (typeof state.showSource === "boolean") showSourceCheckbox.checked = state.showSource;
  if (typeof state.kymaKey === "string") {
    if (kymaKeyInput.value !== state.kymaKey) kymaKeyInput.value = state.kymaKey;
    setKeyBadge(state.kymaKey);
  }

  // Status + button
  if (state.connecting) {
    setStateClass("connecting");
    statusEl.textContent = state.status || "Connecting";
    toggleBtn.textContent = "Stop";
    toggleBtn.classList.add("is-live");
  } else if (state.running && state.paused) {
    setStateClass("paused");
    statusEl.textContent = "Paused.";
    toggleBtn.textContent = "Stop";
    toggleBtn.classList.add("is-live");
  } else if (state.running) {
    setStateClass("active");
    const langName = LANGUAGES.find(([c]) => c === state.targetLanguage)?.[1] || state.targetLanguage;
    statusEl.textContent = `Translating to ${langName}.`;
    toggleBtn.textContent = "Stop";
    toggleBtn.classList.add("is-live");
  } else if (state.errorMessage) {
    setStateClass("error");
    statusEl.textContent = state.errorMessage;
    toggleBtn.textContent = "Start";
    toggleBtn.classList.remove("is-live");
  } else {
    setStateClass("idle");
    statusEl.textContent = state.kymaKey ? "Ready." : "Add a Kyma key to start.";
    toggleBtn.textContent = "Start";
    toggleBtn.classList.remove("is-live");
  }
  toggleBtn.disabled = false;
}

function readSettings() {
  // Only write the voice key for the active tier so the other tier's saved
  // pick survives a tier toggle round-trip without being clobbered.
  const tier = tierSelect.value;
  const voiceKey = tier === "standard" ? "standardVoice" : "realtimeVoice";
  return {
    tier,
    targetLanguage: langSelect.value,
    [voiceKey]: voiceSelect.value,
    originalVolume: Number(originalVolumeInput.value),
    voiceVolume: Number(voiceVolumeInput.value),
    showSource: showSourceCheckbox.checked,
    kymaKey: kymaKeyInput.value.trim(),
  };
}

async function pushSettings() {
  try {
    const reply = await send({ type: "UPDATE_SETTINGS", settings: readSettings() });
    if (reply?.state) applyState(reply.state);
  } catch (err) {
    if (!isBenign(err.message)) {
      statusEl.textContent = err.message;
      setStateClass("error");
    }
  }
}

let volumeDebounce = null;
function onVolumeChange() {
  originalOut.textContent = originalVolumeInput.value;
  voiceOut.textContent = voiceVolumeInput.value;
  clearTimeout(volumeDebounce);
  volumeDebounce = setTimeout(() => {
    chrome.runtime.sendMessage({
      type: "UPDATE_VOLUME",
      originalVolume: Number(originalVolumeInput.value),
      voiceVolume: Number(voiceVolumeInput.value),
    }).catch(() => {});
  }, 60);
}

async function onToggle() {
  toggleBtn.disabled = true;
  try {
    if (state.running || state.connecting) {
      const reply = await send({ type: "STOP" });
      if (reply?.state) applyState(reply.state);
      else applyState({ running: false, connecting: false, paused: false });
    } else {
      const settings = readSettings();
      if (!settings.kymaKey) {
        statusEl.textContent = "Add a Kyma key first.";
        setStateClass("error");
        toggleBtn.disabled = false;
        return;
      }
      const reply = await send({ type: "START", settings });
      if (!reply?.ok) {
        statusEl.textContent = reply?.error || "Could not start.";
        setStateClass("error");
        toggleBtn.disabled = false;
        return;
      }
      if (reply?.state) applyState(reply.state);
    }
  } catch (err) {
    toggleBtn.disabled = false;
    if (isBenign(err.message)) return;
    statusEl.textContent = err.message;
    setStateClass("error");
  }
}

// ───── Events ─────
tierSelect.addEventListener("change", () => {
  // Swap the voice list to match the new tier and pick the saved voice for
  // that tier (realtimeVoice when realtime, standardVoice when standard).
  // Then push settings so background restarts the session on the new pipeline.
  const tier = tierSelect.value;
  const wanted = tier === "standard" ? state.standardVoice : state.realtimeVoice;
  repopulateVoices(tier, wanted);
  pushSettings();
});
voiceSelect.addEventListener("change", pushSettings);
langSelect.addEventListener("change", pushSettings);
showSourceCheckbox.addEventListener("change", pushSettings);
kymaKeyInput.addEventListener("input", () => setKeyBadge(kymaKeyInput.value.trim()));
kymaKeyInput.addEventListener("change", pushSettings);
originalVolumeInput.addEventListener("input", onVolumeChange);
voiceVolumeInput.addEventListener("input", onVolumeChange);
toggleBtn.addEventListener("click", onToggle);

// Background push subscription
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "BACKGROUND_STATE_UPDATE" && message.state) {
    applyState(message.state);
  }
});

// Init
populateLanguages();
repopulateVoices(state.tier, state.tier === "standard" ? state.standardVoice : state.realtimeVoice);
(async () => {
  try {
    const reply = await send({ type: "GET_STATE" });
    if (reply?.state) applyState(reply.state);
  } catch (err) {
    if (!isBenign(err.message)) {
      statusEl.textContent = err.message;
      setStateClass("error");
    }
  }
})();
