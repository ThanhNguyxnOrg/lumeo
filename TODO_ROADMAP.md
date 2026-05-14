# Lumeo TODO Roadmap

> Single English source of truth for Lumeo execution. Consolidates the previous `PLAN.md`, `ROADMAP.md`, `MASTER_PLAN.md`, repo archaeology, local `output/research` corpus review, and OSS research notes from May 2026.

## Product goal

Ship Lumeo v2 as a stable Chrome MV3 YouTube companion with three production-grade tiers:

1. **Caption** — translate YouTube captions, render bilingual subtitles, support optional TTS and no-caption STT fallback.
2. **Standard Dub** — capture YouTube audio, process chunked STT -> translation -> TTS, play a translated dub with acceptable latency.
3. **Realtime Dub** — low-latency live audio bridge using Kyma/OpenAI Realtime now, with Gemini Live as a future candidate.

Minimum viable ship: **P0 -> P1 -> P2 -> P3 -> P4 -> P5**.
Expansion after store-ready: **P6 -> P7 -> P8**.

## Reference policy

Local `output/research` sources are allowed for internal reuse per owner instruction. Still prefer clean adaptation over blind copy so Lumeo keeps one coherent architecture.

Best references:

- `output/research/youtube-gemini-translator` — best close-fit caption translation UX, cache, overlay, export/import patterns.
- `output/research/yt-caption-kit` — best typed caption/transcript model and SRT/WebVTT formatter ideas.
- `output/research/subtide` — best full-stack subtitle processing, cache, backend/API, testing mindset.
- `output/research/youtube-pip-subtitles` — best PiP subtitle differentiator.
- `output/research/lingocub` — best dubbing-specific UX/provider/audio ideas.
- `asbplayer/asbplayer` — mature subtitle lifecycle/sync/list architecture reference.
- `GoogleChrome/chrome-extensions-samples` — canonical MV3/offscreen/tabCapture/user-media reference.

Avoid using `closed-ext/*` as architecture source unless necessary; use it mainly for UX benchmarking because it is minified/vendor-shaped.

## Current repo state snapshot

Already done or partially done:

- Chrome MV3 extension baseline exists with `background.js`, `popup.js`, `content.js`, `services/*`, and `pipelines/caption.js`.
- `background.js` is the canonical state owner for popup/content session state.
- `pipelines/caption.js` is already modular and should be the pattern for new pipelines.
- `lib/token-guard.js` exists for stale async/session protection.
- `lib/audio-utils.js` exists for capture, recorder MIME selection, WAV encoding, downmix/resample helpers.
- `services/stt-groq.js` exists as a Groq Whisper STT service.
- `services/tts-openai.js` exists as an OpenAI TTS helper.
- Vitest/jsdom test harness exists with tests for captions, translate, providers, SRT export, token guard, and audio utils.
- `scripts/check-all.mjs` exists and checks all repo JavaScript files with `node --check`.

Main blocker:

- `content.js` is still the large runtime monolith. It owns UI, caption orchestration, Standard dub, Realtime dub, audio/session glue, and provider-specific behavior. Finish P1 before adding large features.

## P0 — Hygiene and source-of-truth cleanup

Status: **Complete**.

### Tasks

- [x] P0.1 Sync public version labels.
  - README badge, `manifest.json`, and product copy should agree on `2.0.0-beta.12` / `2.0.0` package version semantics.
- [x] P0.2 Pin Soniox realtime model.
  - `background.js` should use `model: "stt-rt-v4"` instead of stale preview naming.
- [x] P0.3 Re-evaluate MiniMax voices.
  - External dependency: confirm whether Kyma exposes MiniMax Speech-2.8 voices.
  - If yes, update `STANDARD_VOICES` in `content.js` and popup voice UI.
  - If no, document current Speech-02 voice IDs as intentionally pinned.
  - 2026-05-11 check: Kyma voice docs expose MiniMax catalog via `/v1/audio/voices?provider=minimax`, but `/v1/audio/speech` does not document Speech-2.8 model IDs. Keep current MiniMax system voice IDs pinned until Kyma documents supported Speech-2.8 SKUs for `/v1/audio/speech`.
- [x] P0.4 Harden `.gitignore`.
  - Ignore `node_modules/`, `coverage/`, Playwright artifacts, generated browser profiles, screenshots, and local output noise.
- [x] P0.5 Clarify reserved provider/key fields.
  - Add comments near `huggingFaceToken`, `replicateKey`, `minimaxKey`, `elevenLabsKey`, and provider registry entries explaining reserved/coming-soon intent.
  - Ensure no key appears as required unless a runtime path actually uses it.
- [x] P0.6 Consolidate planning docs.
  - Use this file as the single roadmap/TODO doc.
  - Remove old `PLAN.md`, `ROADMAP.md`, and `MASTER_PLAN.md` after this file is created.
- [x] P0.7 Keep `.sisyphus/` out of commits unless intentionally needed.

### Acceptance criteria

- `npm run check:all` passes.
- `npm test` passes.
- `git status` contains no accidental generated artifacts.
- Only this file remains as the roadmap/TODO source of truth.

## P1 — Module split, no behavior change

Status: **Partially complete**.

Goal: turn `content.js` into a thin runtime router while preserving current behavior.

### Rules

- Do not redesign UX during P1.
- Do not change provider behavior during P1.
- Do not change API payloads during P1 except when moving code verbatim into modules.
- Every extraction must keep the no-build MV3 IIFE/global style.
- Every new file must be added to both `manifest.json.content_scripts[1].js` and `web_accessible_resources` when needed.

### Target modules

- [x] `lib/token-guard.js` — stale session guard.
- [x] `lib/audio-utils.js` — capture/WAV/downmix helpers.
- [x] `ui/overlay.js` — base overlay creation, drag/resize, shell rendering, status classes.
- [x] `ui/subtitle-overlay.js` — bilingual caption line, transcript/history rendering, active cue highlighting.
- [x] `ui/voice-picker.js` — Standard/Reatime voice lists, selected voice validation, voice labels.
- [x] `ui/caption-fallback-choice.js` — no-caption fallback choice rendering and diagnostics UI.
- [x] `ui/transcript.js` — realtime history, caption transcript rows, export helpers, and active row highlighting.
- [x] `pipelines/standard.js` — Standard constants, guards, chunk loop, and chunk processing extracted.
- [x] `pipelines/realtime.js` — WebRTC session build and event handling extracted.
- [x] `services/kyma-client.js` cleanup — heartbeat/end/error parsing delegated from `content.js`.
- [ ] `content.js` — reduce to initialization, event wiring, state handoff, and pipeline selection. Remaining blocker: caption fallback/live-STT orchestration still owns session/UI state tightly; further extraction needs a dedicated controller seam + Chrome smoke to avoid behavior drift.

### Implementation slices

1. Extract UI shell only.
   - Move DOM creation helpers and overlay shell state into `ui/overlay.js`.
   - Keep public API small, e.g. `window.LumeoOverlay.create()` / `update()` / `destroy()`.
   - Verify caption, standard, realtime still render.
2. Extract subtitle/history UI.
   - Use `youtube-gemini-translator`, `youtube-live-translate`, and `asbplayer` as references for transcript-row UX.
   - Preserve current compact toolbar behavior.
3. Extract voice picker.
   - Keep MiniMax/OpenAI voice data centralized.
   - Ensure popup/content do not drift on voice IDs.
4. Extract Standard pipeline.
   - Use existing `LumeoAudioUtils` and `LumeoKymaClient`.
   - Keep chunk timing, volume behavior, and error copy unchanged first.
5. Extract Realtime pipeline.
   - Keep Kyma/OpenAI Realtime flow unchanged first.
   - Use `LumeoTokenGuard` to protect late WebRTC/event callbacks.
6. Shrink `content.js`.
   - Target: orchestration only, not business logic.

### Acceptance criteria

- `npm run check:all` passes after each slice.
- `npm test` passes after each slice.
- Manual Chrome smoke: extension loads on YouTube, popup opens, Caption starts/stops, overlay appears, no console errors.
- No large behavior changes mixed into extraction commits.

## P2 — Testing foundation

Status: **Complete**.

### Existing coverage

- Caption parser tests.
- Translation provider tests.
- Provider registry tests.
- SRT export tests.
- Token guard tests.
- Audio utils tests.

### Remaining tasks

- [x] Add `chrome.*` mock helper for popup/background/provider tests.
- [x] Add tests for `services/kyma-client.js` request/error normalization.
- [x] Add tests for `services/stt-groq.js` request construction and chunk callback behavior with mocked fetch/MediaRecorder.
- [x] Add tests for `services/tts-openai.js` cache key, stop behavior, and error handling.
- [x] Add tests for `pipelines/caption.js` cache cap, cue lookup, and no-caption fallback decision.
- [x] Add tests for extracted `ui/*` modules.
- [x] Add tests for `pipelines/standard.js` and `pipelines/realtime.js` with fake timers/events.
- [x] Add GitHub Actions CI steps for `npm ci`, `npm test`, and `npm run check:all`.

### Acceptance criteria

- CI runs syntax + unit tests on every PR.
- Pure services have deterministic tests with mocked network/browser APIs.
- Pipeline tests focus on observable state/events, not implementation internals.

## P3 — Provider capability architecture

Status: **Complete**.

Goal: make providers capability-driven instead of scattered mode-specific conditionals.

### Tasks

- [x] Define provider capability fields in `services/providers.js`:
  - `translate`
  - `stt`
  - `tts`
  - `standardDub`
  - `realtimeDub`
  - `requiresKey`
  - `free`
  - `localOnly`
  - `comingSoon`
- [x] Reframe direct providers as integration/completion, not greenfield.
  - `services/stt-groq.js` already exists.
  - `services/tts-openai.js` already exists.
- [x] Add routing policy for Caption fallback STT.
  - No-caption fallback UI now prefers Groq Whisper before Soniox, with key-aware missing-provider prompts.
- [x] Add direct OpenAI TTS as Caption TTS option where key exists.
- [x] Decide whether direct OpenAI chunked Standard dub ships before or after store submission.
  - Decision: after store submission; keep direct OpenAI Standard marked roadmap-only until the existing Kyma path is stable in store smoke tests.
- [x] Keep Kyma as default Standard/Realtime path until direct providers are stable.
- [x] Add provider health/status copy in popup.
- [x] Add privacy/cost microcopy per provider.

### Acceptance criteria

- Popup shows only providers relevant to the selected tier/slot.
- Required-key detection matches runtime use.
- Missing-key errors tell users exactly which provider/field is missing.
- No coming-soon provider blocks start.

## P4 — UX polish and cache improvements

Status: **Pending**.

Goal: make the product feel premium and predictable before store submission.

### References

- `DESIGN_BRIEF.md` for cinematic command-center visual direction.
- `youtube-gemini-translator` for progress/cache/export bundle ideas.
- `asbplayer` for subtitle list and seekable transcript UX.
- `youtube-live-translate` for live overlay flow.

### Tasks

- [x] Implement auto-tier recommendation copy.
  - Caption if captions exist.
  - Standard if no captions or user prefers listening.
  - Realtime for live streams/podcasts/low-latency cases.
- [~] Improve per-video caption cache.
  - [x] Size cap.
  - [x] TTL/version key.
  - [x] Clear-cache action.
  - [x] Translation progress state.
  - [x] Resume state.
- [x] Add export/import translation bundle UX.
- [x] Add subtitle source quality indicator.
  - YouTube caption track.
  - Auto-generated caption.
  - STT fallback.
  - Unknown/unavailable.
- [x] Improve error copy.
  - Provider missing key.
  - YouTube audio not capturable.
  - Timedtext unavailable.
  - Kyma token/session failure.
  - Realtime WebRTC failure.
- [x] Add overlay keyboard shortcuts.
- [x] Persist overlay position/size per video or channel.
- [x] Ensure all focus targets are at least 44px and have visible focus rings.

### Acceptance criteria

- User can understand why a tier/provider is unavailable.
- Caption translation progress is visible and resumable.
- Overlay state survives reloads without breaking YouTube controls.
- UI meets contrast and keyboard accessibility requirements.

## P5 — Chrome Web Store submission

Status: **Docs/audits ready; manual store tasks blocked**.

### Tasks

- [x] Finalize privacy policy page draft.
  - No telemetry.
  - Keys stored locally.
  - Provider calls go directly to selected provider/Kyma.
  - No Lumeo-operated server unless added later.
  - Legal/store-owner review still required before publication.
- [x] Audit host permissions.
  - Keep only required origins.
  - Explain each permission in store notes.
  - See `store-assets/audits/permission-audit.md`.
- [x] Audit bundled assets and source references.
  - No accidental closed-extension assets.
  - No generated screenshots/profiles committed.
  - See `store-assets/audits/source-asset-audit.md`.
- [x] Update store metadata draft.
  - See `store-assets/web-store-metadata.md`.
- [ ] Blocked/manual: create screenshot set:
  - Caption mode.
  - Standard mode.
  - Realtime mode.
  - Popup settings/key state.
  - Error/recovery state.
  - See `store-assets/screenshots-guide.md`.
- [ ] Blocked/manual: run packaging scripts on Windows and shell path.
  - Commands documented in `store-assets/packaging-checklist.md`.
  - Requires final release zip/version decision.
- [ ] Blocked/manual: test unpacked extension in a clean Chrome profile.
  - Requires browser run with final build and user-visible evidence.

### Acceptance criteria

- Packed extension contains only required source/assets/docs.
- Store listing matches actual behavior.
- Privacy claims are verifiable from code.
- Clean-profile smoke test passes.

## P6 — Competitive features

Status: **Implemented pending full verification**.

Goal: beat basic subtitle translators with premium learning/media features.

### Tasks

- [x] Add seekable side transcript panel.
  - Reference: `asbplayer` and Lumen v1.
  - Rows clickable to seek video.
  - Active row highlighted.
- [x] Add hover dictionary / word lookup.
  - Local word inspector ships for current subtitle tokens and selected transcript text.
  - No provider dependency; copy-word action included.
- [x] Add subtitle style editor.
  - Font size.
  - Text color.
  - Background opacity.
  - Stroke/shadow.
  - Layout presets.
- [x] Add PiP subtitles.
  - Uses optional Document Picture-in-Picture API when available.
  - Gracefully toasts unsupported browsers; no new permissions.
- [x] Add bilingual layout presets.
  - Verified presets: stacked, translated-only, source-only, compact.
  - Persisted in `lumeoCaptionStyle`.
- [x] Add export formats beyond SRT if useful:
  - [x] WebVTT.
  - [x] TXT.
  - [x] JSON bundle (P4 popup bundle already existed; subtitle ZIP now also includes a minimal JSON bundle).

### Acceptance criteria

- Competitive features are optional and do not complicate core start/stop flow.
- Caption mode remains fast and stable.
- No feature depends on closed/proprietary source shape.

## P7 — Gemini Live tier

Status: **Partial** — adapter foundation and Gemini research complete; Gemini Live implementation blocked pending MV3 prototype/token strategy.

Goal: evaluate Gemini Live as a Realtime alternative without coupling Lumeo to one vendor.

### Tasks

- [x] Design generic realtime adapter interface.
  - `connect()`
  - `sendAudio()`
  - `onTranscript()`
  - `onAudio()`
  - `close()`
  - `onError()`
- [x] Wrap current Kyma/OpenAI Realtime behind the adapter.
- [x] Build fake realtime adapter tests before adding Gemini.
- [x] Research current Gemini Live browser/WebSocket constraints.
  - See `docs/gemini-live-research.md`.
- [ ] Blocked/prototype: add Gemini Live only if API supports the needed browser-extension flow.
  - Current research says Gemini Live is WebSocket/raw-PCM-first, not a direct WebRTC drop-in.
  - Needs MV3 offscreen audio prototype plus ephemeral-token strategy before implementation.
- [x] Compare latency, cost, language quality, and failure modes at research level.
  - Deeper quality/cost benchmark remains blocked until a Gemini prototype exists.

### Acceptance criteria

- Existing Realtime behavior still works behind adapter.
- Gemini can be disabled without affecting OpenAI/Kyma Realtime.
- Provider choice is visible and understandable in popup.

## P8 — Cross-browser and long-term cleanup

Status: **Code/docs complete for incremental P8 seam; Firefox implementation blocked pending validation prototype**.

### Tasks

- [x] Add browser API wrapper around `chrome.*` calls.
  - `lib/browser-api.js` wraps tested runtime/tabs/storage-access helpers.
  - Initial migration covers popup active-tab/runtime calls, content runtime message wiring, and background runtime/tab relay/storage-access setup. Remaining direct calls migrate only when touched by tested work.
- [x] Identify Chrome-only APIs:
  - MV3 service worker behavior.
  - `chrome.scripting`.
  - `chrome.storage.local.setAccessLevel`.
  - content script `world: MAIN`.
  - video `captureStream()`.
  - future offscreen/tabCapture/docPiP work.
  - See `docs/cross-browser-scope.md`.
- [x] Decide Firefox target scope.
  - Future/unsupported until API validation prototype exists.
  - Caption-only first.
  - Then Standard.
  - Realtime last.
  - See `docs/cross-browser-scope.md`.
- [ ] Blocked/manual: remove assumptions that content scripts load exactly like Chrome if Firefox differs.
  - Needs Firefox manifest/prototype validation before code changes.
- [x] Add browser-specific smoke checklist.
  - See `docs/cross-browser-scope.md`.

### Acceptance criteria

- Chrome path remains stable.
- Firefox work is isolated behind compatibility wrappers.
- No provider or UI module directly depends on Chrome-only APIs unless explicitly documented.

## Manual smoke checklist

Run after every major P1/P3/P4 change:

1. Load unpacked extension in Chrome.
2. Open a YouTube video with captions.
3. Open popup.
4. Switch to Caption tier.
5. Start.
6. Confirm overlay appears.
7. Confirm translated caption line updates with video time.
8. Toggle source caption line.
9. Stop.
10. Reload page and start again.
11. Test a video without captions if available.
12. Test Standard tier with Kyma key.
13. Test Realtime tier with Kyma key.
14. Check extension service worker console.
15. Check page console.

## Verification commands

```bash
npm test
npm run check
npm run check:all
```

Expected current baseline after the latest harness fix:

- `npm test` -> 31 tests passing.
- `npm run check` -> pass.
- `npm run check:all` -> 17 JavaScript files passing syntax checks.

## Do-not-forget list

- Do not commit `.sisyphus/` unless intentionally needed.
- Do not mix behavior changes into module-extraction commits.
- Do not make `content.js` smaller by moving tangled state without tests or smoke checks.
- Do not let popup/provider key requirements drift from runtime provider use.
- Do not add new host permissions without store/privacy justification.
- Do not ship Gemini Live until current 2026 API/browser-extension constraints are rechecked.
