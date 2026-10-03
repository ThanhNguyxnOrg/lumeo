# Reactive UI, Bounded Popover Dragging, and Dynamic Session Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate all 8 discovered UI/UX and session lifecycle bugs by implementing first-class reactive callbacks, safe bounded popover dragging clamped to `#movie_player`, live subtitle style token synchronization (opacity & edge style), and an idempotent single-flight session handshake.

**Architecture:** Refactor `LumeoOverlay.createOverlayController` to consume direct functional callbacks for all submenu mutations rather than relying on surrogate `<select>` DOM elements and synthetic events. Re-introduce `PointerEvents` dragging on `.ytp-lumeo-header` strictly clamped inside the YouTube player bounding box with double-click and reset button anchor snap-back. Unify `CONTENT_START` handling in `content.js` to acknowledge in-flight/active sessions idempotently, and remove the blocking "Stop and restart" toast in favor of immediate reactive re-translation of active cues.

**Tech Stack:** Vanilla JavaScript (ES2022, Chrome Extensions MV3), CSS3 variables & PointerEvents API, Vitest 4.x for automated testing.

**Spec:** [`docs/bug-audit-and-fix-plan.md`](file:///d:/Code/lumeo/docs/bug-audit-and-fix-plan.md), [`CONTEXT.md`](file:///d:/Code/lumeo/CONTEXT.md), [`docs/adr/0005-reactive-controls-bounded-drag-and-live-sync.md`](file:///d:/Code/lumeo/docs/adr/0005-reactive-controls-bounded-drag-and-live-sync.md).

## Global Constraints

- Preserve 100% International English copy across all UI elements and toasts.
- All 149 existing Vitest unit tests must remain passing; new behavior must be covered by automated tests.
- Zero external runtime dependencies; use native Web APIs (`PointerEvents`, `CSSStyleDeclaration.setProperty`).
- Popover DOM and Subtitle Overlay MUST always be contained within `#movie_player` or `document.fullscreenElement` to support YouTube Fullscreen mode.
- Clamping must strictly enforce `8px <= left <= playerWidth - 328px` and `8px <= top <= playerHeight - popoverHeight - 52px`.

## Review Focus

1. **Shortcuts open without prior button click:** Verify that opening the popover via `Alt+L` binds all submenu callbacks immediately and selections do not fail as zombies.
2. **Rapid Start / Stop clicking:** Verify that clicking `▶ Start Translation` followed by rapid clicks does not trigger `"Session already running"` errors in `background.js`.
3. **Extreme Player Dragging:** Verify that dragging the popover towards player edges smoothly stops at boundary margins and never jumps off-screen or into YouTube sidebars.
4. **Opacity percentage to decimal conversion:** Verify that choosing `25%`, `50%`, `75%` renders distinct translucency (`0.25`, `0.5`, `0.75`) in CSS `rgba(12, 13, 18, alpha)`.
5. **Language change during playback:** Verify that switching target language in caption mode translates the active subtitle immediately without tearing down video playback.

---

### Task 1: Normalize Subtitle Style Tokens (Opacity & Edge Shadow Classes)

**Files:**
- Modify: `ui/subtitle-overlay.js:238-256`
- Modify: `ui/overlay.js:404-414`
- Test: `tests/subtitle-overlay.test.mjs`

**Interfaces:**
- Consumes: `captionStyle` object with `subBackgroundOpacity` (number or string 0..100 or 0.0..1.0), `subShadowStyle` (`none`, `drop-shadow`, `raised`, `depressed`, `outline`).
- Produces: Normalized CSS variable `--lumeo-sub-bg-opacity` in range `0.0..1.0` and CSS classes `lumeo-shadow-${style}` attached to `.lumeo-video-sub`.

- [ ] **Step 1: Write the failing unit test in `tests/subtitle-overlay.test.mjs`**

Add assertions verifying that `subBackgroundOpacity: 75` outputs `--lumeo-sub-bg-opacity: 0.75` and `subShadowStyle: "drop-shadow"` applies `lumeo-shadow-drop-shadow`:

```javascript
it("normalizes integer opacity (75 -> 0.75) and applies correct shadow class", async () => {
  const { controller, overlay } = await setup();
  controller.applyStyle({
    subBackgroundOpacity: 75,
    subShadowStyle: "drop-shadow",
  });
  expect(overlay.style.getPropertyValue("--lumeo-sub-bg-opacity")).toBe("0.75");
  expect(overlay.classList.contains("lumeo-shadow-drop-shadow")).toBe(true);
  expect(overlay.classList.contains("lumeo-shadow-glow")).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/subtitle-overlay.test.mjs`  
Expected: FAIL (received `"75"` instead of `"0.75"`, class `lumeo-shadow-drop-shadow` not toggled).

- [ ] **Step 3: Implement style normalization in `ui/subtitle-overlay.js` and `ui/overlay.js`**

In `ui/subtitle-overlay.js:applySubtitleStyle`:
```javascript
if (captionStyle.subBackgroundOpacity != null) {
  const raw = Number(captionStyle.subBackgroundOpacity);
  const normalized = Number.isFinite(raw) ? (raw > 1 ? raw / 100 : raw) : 0.92;
  target.style.setProperty("--lumeo-sub-bg-opacity", String(normalized));
}

const shadowStyles = ["none", "drop-shadow", "raised", "depressed", "outline"];
const activeShadow = captionStyle.subShadowStyle || "drop-shadow";
for (const s of shadowStyles) {
  target.classList.toggle(`lumeo-shadow-${s}`, activeShadow === s);
}
```

In `ui/overlay.js:applyLiveCaptionStyle`:
```javascript
function applyLiveCaptionStyle() {
  const player = typeof doc !== "undefined" ? doc.querySelector("#movie_player, .html5-video-player") : null;
  const sub = player ? player.querySelector(".lumeo-video-sub") : (typeof doc !== "undefined" ? doc.querySelector(".lumeo-video-sub") : null);
  if (sub) {
    sub.style.setProperty("--lumeo-caption-font-size", `${currentFontSize}px`);
    const normalizedOpacity = currentBgOpacity > 1 ? currentBgOpacity / 100 : currentBgOpacity;
    sub.style.setProperty("--lumeo-sub-bg-opacity", String(normalizedOpacity));
    const shadowStyles = ["none", "drop-shadow", "raised", "depressed", "outline"];
    for (const s of shadowStyles) {
      sub.classList.toggle(`lumeo-shadow-${s}`, currentShadowStyle === s);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/subtitle-overlay.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git add ui/subtitle-overlay.js ui/overlay.js tests/subtitle-overlay.test.mjs
git commit -m "fix(ui): normalize opacity decimal scale and standardize shadow classes"
```

---

### Task 2: Implement Reactive Callbacks and Safe Bounded Dragging in `ui/overlay.js`

**Files:**
- Modify: `ui/overlay.js:219-363, 1050-1055`
- Test: `tests/overlay.test.mjs`

**Interfaces:**
- Consumes: Options passed to `createOverlayController`:
  - `onLanguageChange(langCode)`
  - `onVoiceChange(voiceId)`
  - `onLayoutChange(preset)`
  - `onFontSizeChange(sizePx)`
  - `onOpacityChange(opacityPercent)`
  - `onShadowStyleChange(styleName)`
  - `onSubtitleOrderChange(orderKey)`
  - `onResetPosition()`
- Produces: Direct invocation of corresponding callbacks on submenu selection, safe pointer capture dragging on `.ytp-lumeo-header` clamped inside `#movie_player`, and reset position behavior.

- [ ] **Step 1: Write the failing unit tests in `tests/overlay.test.mjs`**

Add tests for direct callback dispatch and bounded drag reset:

```javascript
it("dispatches reactive onLanguageChange callback directly when language selected", () => {
  const onLangSpy = vi.fn();
  const controller = window.LumeoOverlay.createOverlayController({
    languages: [["en", "English"], ["vi", "Vietnamese"]],
    onLanguageChange: onLangSpy,
  });
  const root = controller.build();
  controller.setLanguage("vi");
  expect(onLangSpy).toHaveBeenCalledWith("vi");
});

it("resets popover position when reset position is triggered", () => {
  const onResetSpy = vi.fn();
  const controller = window.LumeoOverlay.createOverlayController({
    onResetPosition: onResetSpy,
  });
  const root = controller.build();
  const resetBtn = root.querySelector("[data-lumeo-reset-pos]");
  resetBtn.click();
  expect(onResetSpy).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/overlay.test.mjs`  
Expected: FAIL (`setLanguage` not defined or callback not called).

- [ ] **Step 3: Implement reactive callbacks and bounded dragging in `ui/overlay.js`**

1. Wire `options.onLanguageChange`, `options.onVoiceChange`, etc., into `SUBMENUS` so each selection calls the callback immediately in addition to setting storage and updating labels.
2. Add public helper methods on the controller: `setLanguage(val)`, `setVoice(val)`, `setLayoutPreset(val)`, `setFontSize(val)`, `setOpacity(val)`, `setShadowStyle(val)`.
3. Implement `bindDragResize()`:
```javascript
function bindDragResize() {
  const header = root.querySelector(".ytp-lumeo-header");
  if (!header) return;

  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let initialRootRect = null;
  let initialPlayerRect = null;

  const onPointerDown = (e) => {
    if (e.button !== 0 || e.target.closest("button, select, input, a")) return;
    const player = doc.querySelector("#movie_player, .html5-video-player") || doc.body;
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    initialRootRect = root.getBoundingClientRect();
    initialPlayerRect = player.getBoundingClientRect();
    try { header.setPointerCapture?.(e.pointerId); } catch {}
    e.preventDefault();
  };

  const onPointerMove = (e) => {
    if (!isDragging || !initialRootRect || !initialPlayerRect) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;

    const playerW = Math.max(1, initialPlayerRect.width);
    const playerH = Math.max(1, initialPlayerRect.height);
    const popW = initialRootRect.width;
    const popH = initialRootRect.height;

    const rawLeft = initialRootRect.left - initialPlayerRect.left + dx;
    const rawTop = initialRootRect.top - initialPlayerRect.top + dy;

    const clampedLeft = Math.max(8, Math.min(rawLeft, playerW - popW - 8));
    const clampedTop = Math.max(8, Math.min(rawTop, playerH - popH - 52));

    layout = { ...layout, left: clampedLeft, top: clampedTop, customPosition: true };
    root.style.left = `${clampedLeft}px`;
    root.style.top = `${clampedTop}px`;
    root.style.right = "auto";
    root.style.bottom = "auto";
  };

  const onPointerUp = (e) => {
    if (!isDragging) return;
    isDragging = false;
    try { header.releasePointerCapture?.(e.pointerId); } catch {}
    saveLayout();
  };

  header.addEventListener("pointerdown", onPointerDown);
  header.addEventListener("pointermove", onPointerMove);
  header.addEventListener("pointerup", onPointerUp);
  header.addEventListener("pointercancel", onPointerUp);

  header.addEventListener("dblclick", (e) => {
    if (e.target.closest("button, select, input, a")) return;
    resetPopoverPosition();
  });
}

function resetPopoverPosition() {
  layout = { ...layout, left: null, top: null, customPosition: false };
  saveLayout();
  applyLayout();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/overlay.test.mjs`  
Expected: PASS (all 11+ tests passing).

- [ ] **Step 5: Commit changes**

```bash
git add ui/overlay.js tests/overlay.test.mjs
git commit -m "feat(ui): implement reactive controller callbacks and bounded popover dragging"
```

---

### Task 3: Eliminate Zombie Controls & Connect Direct Callbacks in `content.js`

**Files:**
- Modify: `content.js:80-140, 219-265, 335-365`
- Test: `tests/overlay.test.mjs` and manual test verification

**Interfaces:**
- Consumes: Direct callbacks from `LumeoOverlay.createOverlayController`.
- Produces: Synchronous handler dispatch to `LumeoSessionManager`, `subtitleOverlay`, and `notifyBackground`. In-place reactive re-translation when changing language.

- [ ] **Step 1: Write integration test verifying reactive language update**

In `tests/overlay.test.mjs`:
```javascript
it("supports dynamic in-place language update without tearing down overlay", () => {
  const onLangChange = vi.fn();
  const controller = window.LumeoOverlay.createOverlayController({
    languages: [["en", "English"], ["ja", "Japanese"]],
    onLanguageChange,
  });
  controller.build();
  controller.setLanguage("ja");
  expect(onLangChange).toHaveBeenCalledWith("ja");
});
```

- [ ] **Step 2: Run test to verify it passes or fails**

Run: `npx vitest run tests/overlay.test.mjs`

- [ ] **Step 3: Refactor `content.js` to initialize bindings at creation time**

In `content.js`:
Pass direct callbacks to `createOverlayController`:
```javascript
const overlayController = window.LumeoOverlay?.createOverlayController?.({
  layoutKey: getOverlayLayoutKey,
  languages: LANGUAGES,
  collapsedOnStart: false,
  onButtonClick: () => {
    buildOverlay();
    const open = overlayController.isOpen?.();
    overlayController.toggleSideCollapsed(open);
  },
  onStartSession: handleStartFromUI,
  onStopSession: handleStopFromUI,
  onLanguageChange: (newLang) => {
    settings = { ...(settings || {}), targetLanguage: newLang };
    LumeoSessionManager.setSettings(settings);
    notifyBackground({ type: "UPDATE_SETTINGS", settings: { targetLanguage: newLang } });
    if (lastDisplayedCue && lastDisplayedCue.text) {
      void window.LumeoTranslate?.translateBatch?.([lastDisplayedCue.text], newLang)
        .then(([translated]) => {
          if (translated) {
            setTargetCue({ ...lastDisplayedCue, translated });
          }
        }).catch(() => {});
    }
  },
  onVoiceChange: (newVoice) => {
    const tier = settings?.tier || "realtime";
    if (tier === "caption") {
      settings.captionTtsProvider = newVoice;
      notifyBackground({ type: "UPDATE_SETTINGS", settings: { captionTtsProvider: newVoice } });
    } else if (tier === "standard") {
      settings.standardVoice = newVoice;
      notifyBackground({ type: "UPDATE_SETTINGS", settings: { standardVoice: newVoice } });
    } else {
      settings.realtimeVoice = newVoice;
      LumeoSessionManager.requestHandover({ realtimeVoice: newVoice });
    }
  },
  onLayoutChange: (preset) => {
    applyLayoutPreset(preset);
    saveCaptionStyle();
    applyCaptionStyle();
    if (lastDisplayedCue) setTargetCue(lastDisplayedCue);
  },
  onFontSizeChange: (size) => {
    captionStyle.fontSize = size;
    saveCaptionStyle();
    applyCaptionStyle();
  },
  onOpacityChange: (opacity) => {
    captionStyle.subBackgroundOpacity = opacity;
    saveCaptionStyle();
    applyCaptionStyle();
  },
  onShadowStyleChange: (shadow) => {
    captionStyle.subShadowStyle = shadow;
    saveCaptionStyle();
    applyCaptionStyle();
  },
  onSubtitleOrderChange: (order) => {
    captionStyle.subtitleOrder = order;
    saveCaptionStyle();
    applyCaptionStyle();
    if (lastDisplayedCue) setTargetCue(lastDisplayedCue);
  },
  onResetPosition: () => {
    subtitleOverlay?.resetPosition?.();
    overlayController?.resetPopoverPosition?.();
  },
});
```

Ensure `buildOverlay()` is called safely if the menu is opened via keyboard shortcut (`Alt+L`) or message:
```javascript
function ensureOverlayBuilt() {
  if (!root) buildOverlay();
}
```

- [ ] **Step 4: Run unit tests**

Run: `npx vitest run`  
Expected: 149+ tests passing.

- [ ] **Step 5: Commit changes**

```bash
git add content.js tests/overlay.test.mjs
git commit -m "fix(content): bind direct reactive callbacks and eliminate zombie controls"
```

---

### Task 4: Unify Session Handshake & Make `CONTENT_START` Idempotent

**Files:**
- Modify: `content.js:90-106, 574-580`
- Modify: `background.js:342-390`
- Test: `tests/realtime-pipeline.test.mjs`, `tests/caption-pipeline.test.mjs`

**Interfaces:**
- Consumes: `START` runtime message from content or popup, `CONTENT_START` tab message from background.
- Produces: Idempotent session initialization where pre-started sessions return `{ ok: true }` without crashing state machine.

- [ ] **Step 1: Check existing session lifecycle tests**

Run: `npx vitest run tests/caption-pipeline.test.mjs tests/realtime-pipeline.test.mjs`  
Confirm baseline passes.

- [ ] **Step 2: Update `content.js` and `background.js` handshake**

In `content.js`:
```javascript
case "CONTENT_START":
  settings = { ...(msg.settings || {}) };
  LumeoSessionManager.setSettings(settings);
  overlayController?.setSessionState?.({ isTranslating: true });
  // If session is already active from local start, return ok immediately
  if (LumeoSessionManager.getSession()) {
    sendResponse({ ok: true, alreadyRunning: true });
    break;
  }
  const startRes = await LumeoSessionManager.startSession(settings);
  sendResponse(startRes || { ok: true });
  break;
```

In `content.js:handleStartFromUI`:
```javascript
async function handleStartFromUI() {
  overlayController?.setSessionState?.({ isTranslating: true });
  const stored = await browserApi.sendRuntimeMessage({ type: "GET_STATE" }).catch(() => null);
  const currentSettings = stored?.state || settings || { tier: "caption", targetLanguage: "vi", translateProvider: "google-free" };
  settings = currentSettings;
  LumeoSessionManager.setSettings(currentSettings);
  if (!LumeoSessionManager.getSession()) {
    const res = await LumeoSessionManager.startSession(currentSettings).catch((err) => ({ ok: false, error: err?.message }));
    if (res && res.ok === false) {
      overlayController?.setSessionState?.({ isTranslating: false });
      overlayController?.showToast?.(res.error || "Failed to start translation", 5000);
      return;
    }
  }
  browserApi.sendRuntimeMessage({ type: "START", settings: currentSettings }).catch(() => {});
}
```

In `background.js:handleStart`:
If `state.running` is already true for the same tab, reply `{ ok: true, alreadyRunning: true }`.

- [ ] **Step 3: Run full Vitest suite to ensure no regressions**

Run: `npx vitest run`  
Expected: All 149+ tests pass.

- [ ] **Step 4: Commit changes**

```bash
git add content.js background.js
git commit -m "fix(lifecycle): make session startup handshake idempotent and eliminate race conditions"
```

---

### Task 5: Options Dashboard Modernization & Opt-In Automation Settings

**Files:**
- Modify: `options.html`
- Modify: `options.js`
- Modify: `ui/overlay.js` (header logo replacement + opt-in automations)
- Modify: `content.js` (auto-start, smart-skip, auto-pause logic)
- Test: `tests/options.test.mjs` or `tests/dynamic-models.test.mjs`

- [ ] **Step 1: Modernize `options.html`**
  - Remove confusing `<span class="badge">Free Default</span>` badge from Translation Provider card.
  - Add Default Target Language select (`targetLanguage`) under Translation Provider (Vietnamese, English, Japanese, Korean, Chinese, Spanish, etc.).
  - Add OpenRouter card to Key Vault:
    ```html
    <div class="key-field">
      <div class="key-label-row">
        <label for="openRouterKey">OpenRouter API Key</label>
        <a href="https://openrouter.ai/keys" target="_blank" rel="noopener" class="get-key-link">Get OpenRouter Key ↗</a>
      </div>
      <div class="key-input-wrap">
        <input type="password" id="openRouterKey" class="form-input mono" placeholder="sk-or-..." autocomplete="off" />
        <button type="button" class="btn-eye" data-target="openRouterKey" title="Toggle visibility">👁</button>
        <button type="button" class="btn-test" data-test="openrouter">Test</button>
      </div>
      <div class="key-sub-options">
        <label for="openRouterModel">Model:</label>
        <select id="openRouterModel" class="form-select select-compact">
          <option value="openrouter/free">OpenRouter Free (Default)</option>
          <option value="deepseek/deepseek-chat">DeepSeek Chat (V3)</option>
          <option value="google/gemini-2.5-flash">Gemini 2.5 Flash</option>
          <option value="anthropic/claude-3.5-haiku">Claude 3.5 Haiku</option>
          <option value="meta-llama/llama-3.3-70b-instruct">Llama 3.3 70B</option>
          <option value="custom">Custom Model ID...</option>
        </select>
        <input type="text" id="openRouterCustomModel" class="form-input input-compact hidden" placeholder="Enter custom model ID (e.g. qwen/qwen-2.5-72b)" />
      </div>
    </div>
    ```
  - Add Custom Model ID fallback `<input class="custom-model-input hidden">` for Gemini, OpenAI, Groq, and OpenRouter whenever "Custom Model..." is selected.
  - Add Custom Proxy / Third-Party Provider card with neutral empty Base URL (`customProxyBaseUrl`, default: `""`, placeholder: `e.g. https://openrouter.ai/api/v1 or http://localhost:11434/v1`), API Key, and Model selector + Custom Model ID.
  - Add Universal Custom AI Voice / Local TTS Engine (Vendor-Neutral, zero ElevenLabs favoritism):
    - Voice Engine toggle: "Browser Native Speech (Free Default)" vs "Custom AI Voice / Local TTS".
    - When "Custom AI Voice / Local TTS" is active, the standard browser voice dropdown list is **completely hidden/removed** because voice selection is 100% driven by the custom Voice ID.
    - User inputs required:
      - `customTtsBaseUrl` (Base URL: strictly empty `""` by default; placeholder: `e.g. https://api.elevenlabs.io/v1 or http://localhost:8880/v1`).
      - `customTtsApiKey` (API Key: required for paid cloud APIs, optional for local TTS).
      - `customTtsVoiceId` (Voice ID / Name: required, text input with auto-cleaning regex).
      - "🔊 Test Voice" button to verify synthesis before playing videos.
  - In in-player popover: If Custom AI Voice mode is active, the standard voice dropdown is replaced with a clean "Custom Voice (Active)" badge/label, avoiding clutter.
  - Add Default AI Voice dropdown (`standardVoice`) under Audio & Voice for Browser Native mode with automatic smart pairing to the active target language (e.g. Vietnamese -> HoaiMy Natural, Japanese -> Nanami Natural, English -> Jenny Natural).
  - Add Automation card (Opt-in, default OFF): `autoStart` (Auto-translate on video load), `smartSkipNative` (Skip if video language matches target), `autoPauseOnHover` (Pause video on subtitle hover/dictionary lookup), `navHotkeys` (A/S/D keys to jump prev/replay/next subtitle).
  - Add dynamic shortcut `<kbd id="shortcutToggle">` and direct button `Configure in Chrome ↗` (`chrome://extensions/shortcuts`).

- [ ] **Step 2: Update `options.js`**
  - Implement dynamic shortcut querying via `chrome.commands.getAll()`.
  - Wire up `btnExportSrt` click handler to download cached subtitle cues as `.srt`.
  - Connect Custom Proxy / Third-Party key testing, neutral Base URL, and dynamic model loading (`LumeoProviders.fetchProviderModels`).
  - Connect dynamic model fetching to Gemini (`fetchProviderModels("gemini", key)`), OpenAI, and Groq on key test.
  - Connect Universal Custom AI Voice testing with neutral Base URL, API key, and Voice ID (dynamically hiding regular voice dropdown when custom mode is chosen).
  - Handle toggle for Custom Model ID and Custom Voice inputs when custom mode is selected.
  - Read & save `openRouterKey`, `customProxyBaseUrl`, `openRouterModel`, `openRouterCustomModel`, `customTtsBaseUrl`, `customTtsApiKey`, `customTtsVoiceId`, `ttsEngineMode`, `autoStart`, `smartSkipNative`, `autoPauseOnHover`, `navHotkeys`, `targetLanguage`, and `standardVoice`.

- [ ] **Step 3: Update `ui/overlay.js` & `content.js` for Brand Icon, Transcript Drawer & Automations**
  - Replace temporary `+` circle SVG in popover header with official Lumeo icon (`icons/icon-32.png` or orange audio-waveform brand SVG matching Options page).
  - Unhide transcript button in `ui/overlay.js` and connect it to `ui/transcript.js` to open the Seekable Transcript Drawer.
  - In `content.js`: If `autoStart` is enabled, automatically trigger session on new video URL.
  - In `content.js`: If `autoPauseOnHover` is enabled, hook `pointerenter` and `pointerleave` on subtitle overlay to pause/resume video.
  - In `content.js`: If `smartSkipNative` is enabled and video native language matches `targetLanguage`, idle gracefully.
  - In `content.js`: Expand supported language registry from 13 to 30+ global languages with grouped "Popular / Recommended" tier.
  - In `services/captions.js` & `ui/subtitle-overlay.js`: Enforce a `1.0s` minimum display duration floor for short cues to prevent flickering, and merge fragmented ASR tokens into full grammatical sentences.
  - In `content.js`: If `navHotkeys` is enabled, listen for `A`, `S`, `D` when not in input/textarea to jump previous/replay/next cue.
  - In `content.js` / `services/tts-browser.js`: Implement smart language-to-voice pairing across all 30+ languages, auto-selecting the best native neural voice without manual friction.
  - Gated AI Summarization: Provide a "Summarize Video" button in Transcript drawer; if user is on Google-Free with no AI key, prompt to add a free Gemini/OpenRouter key.

- [ ] **Step 4: Verify with Vitest & Commit**

```bash
npx vitest run
git add options.html options.js ui/overlay.js content.js services/captions.js ui/subtitle-overlay.js manifest.json
git commit -m "feat(options): add OpenRouter & ElevenLabs vaults, dynamic models/voices, opt-in automation, 30+ languages, and live sync"
```



---

### Task 6: End-to-End Test Suite Verification & Code Standards Check

**Files:**
- Test: All tests in `tests/*.test.mjs`
- Verify: Syntax across all JavaScript files

- [ ] **Step 1: Run comprehensive Vitest tests**

Run: `npx vitest run`  
Expected: 100% pass rate.

- [ ] **Step 2: Run syntax validation across all files**

Run: `node scripts/check-all.mjs` or `git status`  
Expected: Clean status, zero syntax errors.

- [ ] **Step 3: Run Semgrep security check**

Run: `semgrep scan --config=p/javascript --config=p/security-audit --metrics=off --exclude="tests" --json`  
Expected: 0 findings.

- [ ] **Step 4: Final commit and cleanup**

```bash
git add -A
git commit -m "chore: complete reactive UI overhaul, bounded drag, and session sync"
```
