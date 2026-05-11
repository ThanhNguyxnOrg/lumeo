# Changelog

All notable changes to this project will be documented in this file.

The format is inspired by [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
