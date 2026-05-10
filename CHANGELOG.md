# Changelog

All notable changes to this project will be documented in this file.

The format is inspired by [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2.0.0-beta.1] - 2026-05-09 — v2 merge, Phase 1

This release lays the foundation for Lumen Subtitle Studio v2, a unified Chrome extension that merges the existing Lumen v1 caption-translation tool with the Echoly v0.2.1 live AI dubbing engine. Phase 1 ships the Echoly baseline rebranded as Lumen, with scaffolding for the upcoming caption tier port.

### Added

- Echoly v0.2.1 codebase imported and rebranded as the Lumen v2 baseline (`background.js`, `content.js`, `content.css`, `popup.{html,css,js}`).
- Manifest now declares both Lumen-tier and Echoly-tier host permissions: Kyma, OpenAI, Google Translate (free + Cloud), Google Cloud TTS, Soniox.
- New folder scaffold for upcoming module split: `pipelines/`, `services/`, `lib/`, `ui/`, `store-assets/`, `docs/`.
- `pack.sh` and `release.sh` for one-shot zip packaging and release automation.
- Privacy policy refreshed for the three-tier model (Caption / Standard / Realtime).
- Web-store metadata template for the upcoming Chrome Web Store submission.

### Changed

- Brand: `Echoly — Live YouTube Translation` → `Lumen Subtitle Studio` across all user-visible UI strings, comments, and asset titles. Internal `.ec-` CSS namespace preserved to keep the v1.x → v2.x diff reviewable.
- `ECHOLY_VERSION` constant in `content.js` renamed to `LUMEN_VERSION`. `__echolyContentVersion` window guard renamed to `__lumenContentVersion`. `echolyOverlayLayout` localStorage key renamed to `lumenOverlayLayout`.
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
