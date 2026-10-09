# Changelog

All notable changes to this project will be documented in this file.

The format is inspired by [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2.0.6] - 2026-10-09 — Bilingual Layout Sync & Cache Resume Guard

### Fixed & Improved

- **Bilingual Subtitle Layout Auto-Reconciliation:**
  - Automatically re-applies `applyLayoutPreset("stacked")` when overlay is initialized and when storage is read, ensuring `showSource = true` and `showSourceSub = true` are always active for bilingual subtitles without needing manual toggle back-and-forth from single language mode.
- **Cache Resume Cue Count Guard:**
  - Added strict total cue count check (`entry.cues.length === total`) in `isResumableCacheEntry` to prevent attempting to resume stale or mismatched cached subtitle tracks across different video sessions, eliminating the infinite loading spinner on "Loading captions...".

## [2.0.5] - 2026-10-09 — In-Player Button Resilient Binding & Popover Fix

### Fixed & Improved

- **In-Player Control Bar Button Resilient Event Binding:**
  - Added auto-rebinding on YouTube control bar mutations (`dataset.lumeoBound`) so that clicking `.ytp-lumeo-button` reliably opens the quick settings popover even when YouTube clones or re-renders controls during playback.
  - Added capture-phase delegated click and mousedown handling on `document` with duplicate suppression (`__lumeoHandled`) to ensure in-player button clicks are never absorbed or ignored.
- **Session Start Overlay Initialization:**
  - Initialized overlay host and YouTube control bar button immediately on `CONTENT_START` when starting translation from the popup.
  - Synchronized `LUMEO_VERSION` to match `manifest.json` (`2.0.5`), preventing unnecessary content script teardown.

## [2.0.4] - 2026-10-09 — Smart Voice Sync, Multi-STT Fallback & Player UI Fixes

### Added & Improved

- **Smart Voice Selection Synchronization:**
  - Unified `LumeoVoicePicker` across Popup, Options, and Overlay, dynamically filtering to top natural voices for the selected target language.
- **Multi-STT Fallback & 0-Key Chrome Live Caption:**
  - Added `gemini-stt` (Gemini Multimodal Audio transcription) and `openai-whisper` (Whisper-1) providers.
  - Added 1-click Chrome Live Caption guidance and in-video contextual buttons when no subtitle tracks exist, strictly using `captureStream()` from the video element without microphone prompts.
- **International Default Target Language:**
  - Standardized default `targetLanguage` to English (`"en"`) across background, popup, options, and content scripts.
- **In-Player Button Responsiveness & Popover Anchoring:**
  - Fixed popover DOM container anchoring to `#movie_player` to prevent popovers from dropping to the bottom of the page when exiting fullscreen.
  - Added resilient event listener binding (`dataset.lumeoBound`) and capture-phase event delegation for `.ytp-lumeo-button` to ensure clicking the in-player button always toggles the quick settings popover even after YouTube clones or re-renders controls.
  - Synchronized `LUMEO_VERSION` in `content.js` to match `manifest.json` (`2.0.4`), preventing unnecessary script re-injection on session start.
  - Initialized overlay and player controls on `CONTENT_START` so the in-player button is immediately active when starting translation from the popup.
- **Bilingual Subtitle Track Preservation:**
  - Fixed `chooseCaptionTrack()` to preserve the video's original spoken track as source when target language differs, ensuring both original and translated lines display simultaneously in bilingual mode.

## [2.0.3] - 2026-10-09 — Two-Way Realtime Settings Sync & Bilingual Subtitle Fix

### Fixed & Improved

- **Two-Way Realtime Settings Synchronization:**
  - Added live `chrome.storage.onChanged` listeners to Options page (`options.js`) and Popup (`popup.js`), ensuring changes made to languages, models, providers, volumes, and API keys immediately synchronize across open tabs and popups without needing page refresh.
  - Implemented active input focus preservation in Options page to avoid cursor disruption while editing keys or settings.
  - Updated storage queries to preserve complete configuration objects (`STORAGE.get(null)`), preventing accidental erasure of popup or in-player settings when saving.
- **Bilingual Subtitle Display Restoration:**
  - Fixed a state conflict where selecting `Bilingual (Original + Translated)` in the in-player subtitle popover failed to render the source line due to legacy unchecked `showSource: false` state in storage.
  - Configured `layoutPreset: "stacked"` to consistently ensure `showSource: true`, `showSourceSub: true`, and `showTranslatedSub: true` in storage and overlay rendering.
- **No-Caption Fallback Clarity:**
  - Updated diagnostics and documentation for YouTube videos lacking native subtitle tracks (such as music videos or live streams), outlining speech-to-text fallback options.

---

## [2.0.2] - 2026-10-08 — Multi-Tab Audio Isolation & Subtitle Track Matching Patch

### Fixed & Improved

- **Multi-Tab YouTube Audio Isolation:**
  - Prevented volume sync changes from interfering with inactive YouTube tabs. Only active dubbing sessions now adjust the player volume.
- **Accurate Original Subtitle Track Selection:**
  - Fixed track priority in `chooseCaptionTrack`: always prioritizes target language and native audio tracks (including ASR) over foreign manual tracks. Native Vietnamese videos now correctly display Vietnamese as the original/secondary subtitle instead of falling back to uploaded English tracks.
- **ElevenLabs Voice Selection Clarity:**
  - Clarified Voice Provider dropdown label to "ElevenLabs / Custom Neural Voice" in Settings for better discoverability.

---

## [2.0.1] - 2026-10-08 — Performance & Cache Resilience Patch

### Fixed & Optimized

- **Instant Subtitles on Long Videos (Sliding-Window Translation):**
  - Activated sliding-window translation for Google Free caption mode (180s lookahead, 25 cues initial window).
  - Long videos (20-60+ mins) now display translated subtitles almost instantly (1-2s) instead of blocking until hundreds of cues finish translating.
  - Subsequent video chunks are seamlessly pre-translated in the background as playback advances.
- **Instant Abort & Zero-Leak Cancellation:**
  - Added native `AbortSignal` pass-through to `translateGoogleFree`.
  - Stopping the session or skipping forward immediately halts pending translation requests, eliminating network resource contention.
- **Race Condition & Language Switch Fix:**
  - Tracked active starting pipeline (`activeStartingPipeline`) to ensure stopping or switching languages mid-initialization safely aborts prior pipelines.
  - Added reactive in-place session restart when switching `targetLanguage` or `secondaryLanguage` during active captioning.
- **Cleaned internal planning documents:**
  - Removed outdated design specifications (`DESIGN_BRIEF.md`, `TODO_ROADMAP.md`).

---

## [2.0.0] - 2026-10-06 — Production Release: Three-Tier Dub & Captions, Unified AI Gateway, and YouTube-Native UI

This major milestone completes the full merger of Lumen and Echoly into **Lumeo 2.0.0**, delivering YouTube-native bilingual subtitles, live AI dubbing across three tiers, and a vendor-neutral AI Gateway.

### Added

- **YouTube-Native Popover & Controls:**
  - Integrated 24x24 YouTube player toolbar control button and sleek native popover menu (`Alt+L`).
  - Interactive drill-down navigation for Subtitle Style, Audio & Voice, Subtitle Order, and Secondary Subtitle language selection.
  - Picture-in-Picture (PiP) window for subtitles and video with aspect-ratio clamping for YouTube Shorts.
  - Bounded draggable subtitle overlay with position persistence and instant center-reset button.
- **Unified Custom AI Gateway & Complete Key Vault:**
  - Consolidated OpenAI-compatible Custom AI Gateway supporting OpenRouter, DeepSeek, Ollama, LM Studio, vLLM, and custom local proxies.
  - Full vendor neutrality: required Base URL validation without hardcoded vendor fallback bias, plus first-class support for keyless local endpoints (`http://localhost:11434/v1`).
  - Freeform model ID entry across translation and voice engines with dynamic voice discovery and automatic fallback.
- **Hybrid Bilingual Subtitles & Customizable Subtitle Order:**
  - Real-time toggle between "Translation on top" and "Original / Secondary on top" with dynamic symmetrical typography.
  - Secondary subtitle language selection allowing viewers to pair the primary translation with original audio or any of 30+ supported translated languages.
  - In-place reactive session restart during language handover without pausing video playback or resetting player elements.
- **AI Transcript Drawer & Video Summarizer:**
  - Collapsible transcript drawer with active cue synchronization and seek navigation.
  - Structured bullet-point AI Video Summarizer powered by configured AI providers with BYOK gating.
- **Smart Failover & Storage Resilience:**
  - Automatic smart failover to Google Free translation upon paid provider 429 quota exhaustion or network disruption.
  - High-performance 5 MB subtitle cache with LRU eviction and isolated bilingual cache keys preserving 100% backward compatibility.
  - Sliding-window lookahead translation for paid AI models to dramatically minimize API token spend.

### Changed

- Replaced standalone OpenRouter settings card with unified Custom AI Gateway dashboard with seamless automatic migration.
- Redesigned Options page into an Obsidian Cinema dashboard with real-time 16:9 subtitle preview and debounced auto-save.
- Standardized character edge styling, high-contrast mode, and opacity controls mapped to single-source-of-truth Chrome storage.

### Fixed

- Fixed double-toggle conflict on the header Transcript Drawer button.
- Fixed background service worker persistence sync dropping `customTtsModelId`, `subtitleOrder`, and `secondaryLanguage`.
- Fixed local keyless AI Gateway rejection in background Word Context and Transcript Summarizer.
- Fixed in-place language handover and string tier argument mangling in `session-manager.js`.
- Fixed options page subtitle cache reset synchronization broadcast.

---

## [2.0.0-beta.12] - 2026-05-11 — Compact toolbar + in-video overlay

### Changed

- **Panel redesigned to settings-only toolbar.** Removed branding/title, transcript history, and all in-panel subtitle text. The `.ec-side` and `.ec-history` sections are completely removed from the DOM. The panel now contains only: language/voice selectors, Export/Hide/Stop buttons, and control toggles (Audio, Subtitles, Size).
- **In-video subtitle overlay (`.lumeo-video-sub`)** is now the sole subtitle display. Rendered inside `#movie_player` with bilingual support (translated + original), line-clamping, and `aria-live="polite"` for accessibility.
- **Control toggles added:** Mute original audio, show/hide translated subtitles, show/hide original subtitles, font size slider. All persisted in `localStorage`.
- DOM selectors in `services/captions.js` updated for YouTube's May 2026 redesign (new caption container classes, timestamp format changes).
- Caption rendering switched from full-DOM rebuilds to incremental append-only model to reduce UI lag.

### Fixed

- Subtitle text overflow on long sentences (added `max-height` + `-webkit-line-clamp`).
- Panel no longer renders lyrics/transcript — all subtitle rendering goes exclusively to the in-video overlay.

---

## [2.0.0-beta.3] - 2026-05-09 — Caption tier merge + design reference port

This release is the first functional merge of the best parts of Lumen v1 and Echoly v0.2.1 under the Lumeo brand.

### Added

- Ported the latest user-provided design reference into the vanilla extension UI:
  - popup now uses the media-remote / subtitle-tool visual direction instead of the old orange glass UI;
  - in-page overlay now uses the graphite transcript/timeline style system;
  - no React, Vite, Tailwind, or shadcn runtime from the design export was added to the extension.
- Added `ROADMAP.md` with the full source analysis, feature merge matrix, 3-tier architecture, phase plan, AI provider plan, and cleanup checklist.
- Added `DESIGN_BRIEF.md` with the finalized UI/UX direction for future design iterations.
- Added Caption-tier services:
  - `services/providers.js` — canonical provider/mode/key registry so Mode, Engine, Key Vault, and Fallback are no longer conflated.
  - `services/captions.js` — YouTube caption track detection, timedtext sniff fallback, XML parser, native target-language track merge.
  - `services/translate.js` — Google Free, Gemini, OpenRouter, Groq, OpenAI, Google Cloud Translation, LibreTranslate.
  - `services/tts-browser.js` — Browser SpeechSynthesis + Google Cloud Chirp3-HD TTS.
  - `services/stt-soniox.js` — content-side tab audio capture + PCM bridge for Soniox fallback.
  - `services/srt-export.js` — SRT + ZIP export.
  - `services/kyma-client.js` — shared Kyma error parsing, session heartbeat, and session end helpers for the upcoming Standard/Realtime module split.
  - `pipelines/caption.js` — Caption tier orchestrator with local cache and AbortController cancellation.
- Added provider key vault fields in the popup for Kyma, Gemini, OpenRouter, Groq, Hugging Face, OpenAI, Google Cloud, LibreTranslate, and Soniox.
- Added typed startup errors (`missing-caption-track`, `missingProviders`) so the popup can open/highlight the relevant key vault section instead of relying on error-string regexes.
- Added Caption Free mode to the popup and content runtime. Main Caption Free mode now uses Google Free by default; BYOK caption engines live under Advanced rather than the main mode controls.
- Added caption transcript side panel with clickable seek rows, active-row highlight, Export ZIP button, and a small caption style popover.
- Added `pack.ps1` so Windows contributors can build the Web Store zip without WSL/Git Bash.

### Changed

- Default tier is now `caption`, so Lumeo can start with a free/no-Kyma path.
- Background manual injection now injects all service scripts and `pipelines/caption.js` before `content.js`, so pre-existing YouTube tabs work after extension reload.
- Background service worker now carries forward the useful Lumen v1 helpers:
  - `fetchUrl`
  - `fetchJSON`
  - Soniox WebSocket bridge
- Manifest host permissions expanded for the new provider matrix:
  - Gemini
  - OpenRouter
  - Groq
  - Hugging Face
  - LibreTranslate managed/self-hosted URL support

### Removed

- Local design export zip and extracted reference folder after porting the usable UI pieces.
- Any product/docs references to a specific design tool; design-tool references stay generic.

---

## [2.0.0-beta.2] - 2026-05-09 — Rebrand to Lumeo + CI fix

A naming and infrastructure pass on top of beta.1.

### Changed

- **Brand: `Lumen Subtitle Studio` → `Lumeo`.** The interim "Lumen Subtitle Studio" name from beta.1 was a holdover from v1; "Subtitle Studio" implied caption-only and didn't fit the three-tier model that includes audio dubbing. "Lumeo" is a portmanteau of the two predecessor brands (**Lum**en + **E**ch**o**ly) and matches the maintainer's other org repo naming style (`judgeloom`, `blendops`).
- `LUMEN_VERSION` → `LUMEO_VERSION` (content.js).
- `__lumenContentVersion` → `__lumeoContentVersion` (window guard key).
- `lumenOverlayLayout` → `lumeoOverlayLayout` (localStorage key).
- GitHub repository renamed `lumen-subtitle-studio` → `lumeo` (GitHub auto-redirects the old URL).
- Release-zip filename: `lumen-subtitle-studio-vX.Y.Z.zip` → `lumeo-vX.Y.Z.zip`.

### Fixed

- CI workflow (`.github/workflows/ci.yml`) was checking `sniffer.js` and `audio-processor.js` at the project root, but Phase 1 moved them into `services/`. The hard-coded file list is now replaced with a glob over all tracked `.js` files (auto-covers the upcoming Phase 2 modules under `services/`, `pipelines/`, `lib/`, `ui/`), and a package-structure assertion verifies the v2 layout.

---

## [2.0.0-beta.1] - 2026-05-09 — v2 merge foundation, Phase 1

This release lays the foundation for v2, a unified Chrome extension that merges the existing Lumen v1 caption-translation tool with the Echoly v0.2.1 live AI dubbing engine. Phase 1 shipped the Echoly baseline rebranded (initially as "Lumen Subtitle Studio", subsequently renamed to **Lumeo** in beta.2 — see entry above), with scaffolding for the upcoming caption tier port.

### Added

- Echoly v0.2.1 codebase imported as the v2 baseline (`background.js`, `content.js`, `content.css`, `popup.{html,css,js}`).
- Manifest now declares the union of Lumen v1 and Echoly host permissions: Kyma, OpenAI, Google Translate (free + Cloud), Google Cloud TTS, Soniox.
- New folder scaffold for upcoming module split: `pipelines/`, `services/`, `lib/`, `ui/`, `store-assets/`, `docs/`.
- `pack.sh` and `release.sh` for one-shot zip packaging and release automation.
- Privacy policy refreshed for the three-tier model (Caption / Standard / Realtime).
- Web-store metadata template for the upcoming Chrome Web Store submission.

### Changed

- Internal `.ec-` CSS namespace from Echoly preserved to keep the v1.x → v2.x diff reviewable.
- `ECHOLY_VERSION` constant in `content.js` renamed to `LUMEN_VERSION` (further renamed to `LUMEO_VERSION` in beta.2).
- `__echolyContentVersion` window guard renamed to `__lumenContentVersion` (then `__lumeoContentVersion` in beta.2).
- `echolyOverlayLayout` localStorage key renamed to `lumenOverlayLayout` (then `lumeoOverlayLayout` in beta.2).
- Icons moved from project root into `icons/` subfolder, normalised naming `icon-{16,48,128}.png`.
- README rewritten to describe the three-tier vision and merge roadmap.

### Migrated / Preserved

- Lumen v1 source preserved on the `v1-legacy` branch for reference. The obfuscated `content.js` and `popup.js` from v1.2.1 will be reverse-engineered and rewritten cleanly into `pipelines/caption.js` and `services/{translate,tts-browser,stt-soniox,srt-export}.js` during Phase 2.
- v1 `sniffer.js` and `audio-processor.js` (already clean, non-obfuscated) carried forward to `services/sniffer.js` and `services/audio-processor.js`.

### Removed

- v1's obfuscated `content.js`, `popup.html`, `popup.js`, `subtitle.css` (replaced by Echoly baseline; will be re-implemented from scratch in Phase 2).
- v1's `background.js` (replaced by Echoly's state-machine version).

---

## [1.2.1] - 2026-04-03 — Final v1 release (preserved on `v1-legacy`)

### Added

- Professional repository documentation set
- Structured contribution, security, and governance docs
- New icon set for extension branding

### Changed

- Cleaned repository structure for public release
- Hardened subtitle sniffer message flow and config consistency
