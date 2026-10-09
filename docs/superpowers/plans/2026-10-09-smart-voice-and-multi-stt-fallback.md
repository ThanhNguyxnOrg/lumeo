# Smart Voice Selection & Multi-STT Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the Smart Voice Picker across Popup and Options so voice options automatically filter to the best natural voices for the selected target language, and expand the no-caption STT fallback with Gemini Audio STT, OpenAI Whisper STT, and a 1-click 0-Key Chrome Live Caption launcher.

**Architecture:** 
1. Use `LumeoVoicePicker` as the single authority across Popup, Options, and Overlay, dynamically updating the voice list whenever `targetLanguage` changes.
2. Expand the `stt` slot in `services/providers.js` to register `gemini-stt` (multimodal audio via `geminiKey`) and `openai-whisper` (Whisper-1 via `openaiKey`).
3. Maintain zero microphone usage (`video.captureStream()` only), and strictly respect the user's STT dropdown setting and consent before making audio API calls.
4. Add a 1-click Chrome Live Caption launcher to the in-player fallback card via `background.js` for zero-key users.

**Tech Stack:** Vanilla JS (ES6+), Chrome Extension MV3, Web Speech API (`speechSynthesis`), Web Audio API / `captureStream()`, Vitest.

**Spec:** [docs/adr/0001-smart-voice-and-stt-fallback-architecture.md](file:///d:/Code/lumeo/docs/adr/0001-smart-voice-and-stt-fallback-architecture.md)

## Global Constraints
- Strictly NO microphone access (`navigator.mediaDevices.getUserMedia`); only HTML5 `<video>` capture.
- Strictly respect user's STT dropdown choice: never silently trigger paid or quota-consuming STT without configuration or confirmation.
- Keep all 201 existing tests passing without regression.
- Code style: pure vanilla JS without build-step dependencies for runtime.

## Review Focus
1. `speechSynthesis.getVoices()` asynchronously loading or empty on initial popup render: must attach `onvoiceschanged` listener and gracefully fall back.
2. Language switching in Popup: must immediately refresh the voice dropdown options and preserve or select the best natural voice.
3. Audio stream error handling when a video is DRM-protected or cross-origin canvas tainted: must display a user-friendly error without crashing.
4. Gemini Audio STT payload structure: must handle both silent chunks (empty transcript) and multi-sentence transcripts without throwing JSON parse errors.
5. Opening `chrome://settings/accessibility`: content scripts cannot open chrome:// URLs directly; must delegate to `background.js` via `chrome.tabs.create`.

---

### Task 1: Unify Smart Voice Picker in Popup & Options

**Files:**
- Modify: `ui/voice-picker.js`
- Modify: `popup.js`
- Modify: `options.js`
- Test: `tests/voice-picker.test.mjs`

**Interfaces:**
- Consumes: `LumeoVoicePicker.getTopVoicesForLanguage(targetLang, voices)`, `LumeoVoicePicker.cleanVoiceLabel(name)`
- Produces: Dynamic reactive voice options in Popup and Options pages based on `targetLanguage`.

- [ ] **Step 1: Write test for reactive voice list generation by target language**
```javascript
// In tests/voice-picker.test.mjs
it("returns prioritized natural voices for Vietnamese", () => {
  const voices = [
    { name: "Microsoft HoaiMy Online (Natural) - Vietnamese (Vietnam)", lang: "vi-VN" },
    { name: "Google tiếng Việt", lang: "vi-VN" },
    { name: "Microsoft David", lang: "en-US" }
  ];
  const viVoices = api.getTopVoicesForLanguage("vi", voices);
  expect(viVoices).toHaveLength(2);
  expect(viVoices[0].name).toContain("HoaiMy");
});
```

- [ ] **Step 2: Run test to verify behavior**
Run: `npx vitest run tests/voice-picker.test.mjs`
Expected: PASS

- [ ] **Step 3: Update `popup.js` to populate voices via `LumeoVoicePicker`**
Replace hardcoded `CAPTION_VOICES` in `popup.js` with dynamic generation using `window.speechSynthesis.getVoices()`, filtered by `langSelect.value`, and add change listener to `langSelect` to refresh voices.

- [ ] **Step 4: Update `options.js` to refresh voices when `targetLanguage` changes**
Bind `change` event on `targetLanguage` in `options.js` to call `populateBrowserVoices()` with prioritized order.

- [ ] **Step 5: Run unit tests**
Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**
```bash
git commit -m "feat(tts): synchronize smart voice selector across popup and options"
```

---

### Task 2: Register New STT Providers in Provider Registry

**Files:**
- Modify: `services/providers.js`
- Test: `tests/providers.test.mjs`

**Interfaces:**
- Consumes: `geminiKey`, `openaiKey`, `groqApiKey`
- Produces: `gemini-stt` and `openai-whisper` provider definitions under slot `stt`.

- [ ] **Step 1: Write failing test in `tests/providers.test.mjs` for new STT providers**
```javascript
it("registers gemini-stt and openai-whisper as valid STT fallback providers", () => {
  const providers = LumeoProviders.listForSlot("stt", "caption");
  const ids = providers.map(p => p.id);
  expect(ids).toContain("gemini-stt");
  expect(ids).toContain("openai-whisper");
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/providers.test.mjs`
Expected: FAIL

- [ ] **Step 3: Update `services/providers.js`**
Add `geminiStt` (`id: "gemini-stt"`, `label: "Gemini Audio STT (Free Tier)"`, `keyFields: ["geminiKey"]`) and `openaiWhisper` (`id: "openai-whisper"`, `label: "OpenAI Whisper"`, `keyFields: ["openaiKey"]`). Update slot definition and helper functions.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/providers.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git commit -m "feat(providers): register gemini-stt and openai-whisper providers"
```

---

### Task 3: Implement Gemini Multimodal Audio STT Service

**Files:**
- Create: `services/stt-gemini.js`
- Modify: `manifest.json` (add to content scripts and web accessible resources)
- Modify: `background.js` (add to injection lists)
- Create: `tests/stt-gemini.test.mjs`

**Interfaces:**
- Consumes: `MediaStream`, `geminiKey`, `targetLanguage`
- Produces: `LumeoGeminiSTT.transcribeBlob(wavBlob, options)` and `LumeoGeminiSTT.create(options)`

- [ ] **Step 1: Write failing test for `services/stt-gemini.js`**
```javascript
// tests/stt-gemini.test.mjs
it("encodes wav blob to base64 and formats Gemini generateContent payload", async () => { ... });
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/stt-gemini.test.mjs`
Expected: FAIL

- [ ] **Step 3: Implement `services/stt-gemini.js`**
Implement continuous chunk loop sending 15s audio chunks to Gemini Flash endpoint with temperature 0.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/stt-gemini.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git commit -m "feat(stt): add Gemini Multimodal Audio STT service"
```

---

### Task 4: Generalize Whisper STT to Support OpenAI & Groq

**Files:**
- Modify: `services/stt-groq.js`
- Test: `tests/stt-groq.test.mjs`

**Interfaces:**
- Consumes: `apiKey`, `provider: "groq" | "openai"`, `model`, `stream`
- Produces: `LumeoWhisperSTT` (backward compatible with `LumeoGroqSTT`).

- [ ] **Step 1: Write test for OpenAI endpoint routing**
Verify that when `provider: "openai"` or `openaiKey` is supplied, requests target `https://api.openai.com/v1/audio/transcriptions` with model `whisper-1`.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/stt-groq.test.mjs`

- [ ] **Step 3: Implement endpoint and model parameterization in `services/stt-groq.js`**

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/stt-groq.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git commit -m "feat(stt): support OpenAI Whisper endpoint alongside Groq"
```

---

### Task 5: Upgrade Fallback Choice UI & Chrome Live Caption Launcher

**Files:**
- Modify: `ui/caption-fallback-choice.js`
- Modify: `pipelines/caption-orchestrator.js`
- Modify: `background.js`
- Test: `tests/caption-fallback-choice.test.mjs`

**Interfaces:**
- Consumes: User's stored keys (`geminiKey`, `groqApiKey`, `openaiKey`, `sttProvider`)
- Produces: Smart contextual action buttons in the in-player fallback card and background handler to open `chrome://settings/accessibility`.

- [ ] **Step 1: Write test for dynamic fallback button generation**
```javascript
it("renders Chrome Live Caption and available key buttons", () => {
  const card = LumeoCaptionFallbackChoice.create({
    hasGeminiKey: true,
    hasGroqKey: false,
    onGemini: vi.fn(),
    onChromeLiveCaption: vi.fn(),
  });
  expect(card.textContent).toContain("Gemini AI STT");
  expect(card.textContent).toContain("Chrome Live Caption");
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/caption-fallback-choice.test.mjs`

- [ ] **Step 3: Implement dynamic card rendering in `ui/caption-fallback-choice.js`**
Add 1-click button for Chrome Live Caption (`0-Key · 100% Free`) and contextual buttons for configured keys.

- [ ] **Step 4: Add `OPEN_CHROME_SETTINGS` message handler in `background.js`**
```javascript
if (msg.type === "OPEN_CHROME_SETTINGS") {
  chrome.tabs.create({ url: "chrome://settings/accessibility" });
  sendResponse({ ok: true });
}
```

- [ ] **Step 5: Wire handlers in `pipelines/caption-orchestrator.js`**

- [ ] **Step 6: Run test suite**
Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**
```bash
git commit -m "feat(fallback): add 1-click Chrome Live Caption and contextual multi-STT buttons"
```

---

### Task 6: Comprehensive Verification

- [ ] **Step 1: Run all syntax checks**
Run: `npm run check:all`
Expected: 32+ JS files pass syntax checks.

- [ ] **Step 2: Run all Vitest suites**
Run: `npm test`
Expected: All suites pass (205+ tests).

- [ ] **Step 3: Final commit & status check**
```bash
git status
```
