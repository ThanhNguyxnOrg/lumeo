# Lumeo

<p align="center">
  <img src="./icons/icon-128.png" alt="Lumeo" width="96" height="96" />
</p>

<p align="center">
  <strong>Captions and live AI dubbing for YouTube. One Chrome MV3 extension. Three tiers, your call.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0.0--beta.1-ff7a45?style=for-the-badge" alt="Version">
  <img src="https://img.shields.io/badge/Chrome-MV3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Chrome MV3">
  <img src="https://img.shields.io/badge/license-MIT-2ea043?style=for-the-badge" alt="License">
</p>

---

## Overview

Lumeo gives you three ways to consume any YouTube video in your own language. Pick the one that fits the moment:

| Tier | What it does | Latency | Cost | When to use |
|---|---|---|---|---|
| **Caption** | Translates YouTube's existing subtitles into 100+ languages, shows bilingual lines + clickable side panel, optional TTS, and can fall back to Soniox STT when no captions exist | None for captions; live for STT fallback | Free (Google Translate) or your own Gemini / OpenRouter / Groq / OpenAI / Google Cloud / LibreTranslate / Soniox key | Reading captions first; STT fallback when a video has no caption track |
| **Standard** | Captures the audio, runs Whisper → Gemini → MiniMax through Kyma, plays a multilingual dub over the original | ~5 seconds | ~$0.25 / 10 min on your Kyma balance | The video has no usable captions, or you prefer listening |
| **Realtime** | Captures the audio, opens WebRTC P2P with OpenAI Realtime via a Kyma ephemeral token, dubs with sub-second lag and optional speaker voice cloning | <1 second | ~$0.46 / 10 min on your Kyma balance | Live streams, podcasts, anywhere lag matters |

13 dubbing target languages (English, Vietnamese, Japanese, Korean, Chinese, French, Spanish, German, Portuguese, Hindi, Indonesian, Italian, Russian) and 100+ caption-translation languages. No account, no telemetry, no Lumeo-operated server.

---

## Project status — v2.0 merge

This repository is the merge of two predecessor projects, both authored by the same maintainer:

- **Lumen v1** — caption-based bilingual translator with Soniox STT fallback, polyglot TTS, and SRT export. Source preserved on the [`v1-legacy`](../../tree/v1-legacy) branch.
- **Echoly v0.2.1** — live AI dub engine with Realtime + Standard tiers, polished overlay, state-machine architecture. Vendored as the v2 baseline.

The merge is in progress on `main`:

- ✅ **Phase 1** — Echoly baseline rebranded as Lumeo (interim "Lumen Subtitle Studio" naming dropped — see CHANGELOG entry [2.0.0-beta.2]), manifest merged, scaffold for `pipelines/`, `services/`, `lib/`, `ui/` ready, store-assets refreshed.
- 🚧 **Phase 2** — Reverse and rewrite Lumen v1 caption pipeline (currently obfuscated in `v1-legacy`) into clean modules under `pipelines/caption.js` and `services/`.
- 🚧 **Phase 3** — Extend overlay + popup to expose all three tiers, add subtitle style editor and clickable side panel.
- 🚧 **Phase 4** — SRT/ZIP export across all tiers, auto-tier picker, per-video cache.
- 🚧 **Phase 5** — Final store assets, screenshots, packaging, Web Store submission.

See [`ROADMAP.md`](./ROADMAP.md) for the working task plan, [`DESIGN_BRIEF.md`](./DESIGN_BRIEF.md) for the UI/UX redesign prompt, [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) for developer-mode debugging, and [`CHANGELOG.md`](./CHANGELOG.md) for the running merge log.

---

## Architecture

```text
YouTube tab
├─ content.js                  in-page orchestrator + overlay panel
├─ content.css                 overlay styling (.ec- namespace)
└─ services/sniffer.js         timedtext + caption-track interceptor (Caption tier)

Extension runtime
├─ background.js               state machine — single source of truth
├─ popup.html / .css / .js     passive renderer over background state
└─ services/audio-processor.js PCM AudioWorklet (Soniox STT fallback)

(Phase 2+) modular pipelines
├─ pipelines/caption.js        free/BYOK YouTube caption translation
├─ pipelines/standard.js       Whisper → Gemini → MiniMax via Kyma
└─ pipelines/realtime.js       WebRTC P2P to OpenAI Realtime via Kyma

(Phase 2+) shared services
├─ services/translate.js       Google free / Gemini / OpenRouter / Groq / OpenAI / Google Cloud / LibreTranslate
├─ services/tts-browser.js     speechSynthesis + Google Cloud TTS
├─ services/stt-soniox.js      Soniox WebSocket STT
├─ services/srt-export.js      SRT + ZIP packer
└─ services/kyma-client.js     Kyma error parser, heartbeat, end

(Phase 2+) shared lib
├─ lib/token-guard.js          page-level async token guard
└─ lib/audio-utils.js          captureStream retry, downmix, WAV encode
```

State flow (Echoly baseline, applies to every tier):

```text
popup ◄── BACKGROUND_STATE_UPDATE ─── background ◄── CONTENT_STATE ─── content
       ── START / UPDATE_SETTINGS ──►             ── CONTENT_START ──►
```

---

## Quick start (developer mode)

1. Clone the repo and switch to the v2 working branch:
   ```bash
   git clone https://github.com/ThanhNguyxnOrg/lumeo.git
   cd lumeo
   git checkout v2-rewrite
   ```
2. Open `chrome://extensions`.
3. Toggle **Developer mode** (top-right).
4. Click **Load unpacked** and select the project folder.
5. Pin Lumeo to the toolbar.

Update with `git pull` and click the reload icon on the extension card.

When testing in developer mode, reload both the extension card and the YouTube tab after code changes. YouTube tabs that were already open can retain an older content script until the tab is refreshed.

---

## Use

1. Open any YouTube video.
2. Click the Lumeo toolbar icon.
3. Pick a tier:
   - **Caption** — pick a target language, choose a translate provider (free Google by default), press Start. Bilingual subtitles + side panel will populate.
   - **Standard** or **Realtime** — paste a Kyma key from [kymaapi.com](https://kymaapi.com), pick a target language and voice, press Start. The dub plays over the video and the panel shows live translation.
4. Drag the panel by its toolbar; resize from any edge or corner.

You can change voice or language mid-session — Realtime hot-swaps in <1s, Standard picks up the change on the next 5s chunk, Caption re-translates the remaining lines on the fly.

---

## Permissions

| Permission | Why |
|---|---|
| `activeTab`, `scripting` | Inject the overlay into the YouTube tab on Start |
| `storage` | Remember your settings + any keys you save |
| `https://*.youtube.com/*`, `https://youtube.com/*` | Read captions / capture audio of the video you're watching |
| `https://api.kymaapi.com/*` | Standard + Realtime tiers — gateway for AI providers |
| `https://api.openai.com/*` | Realtime tier (P2P after Kyma mints an ephemeral token); also OpenAI translate option in the Caption tier |
| `https://generativelanguage.googleapis.com/*` | Caption tier — Gemini translation if you supply a key |
| `https://openrouter.ai/*` | Caption tier — OpenRouter free model router / BYOK models |
| `https://api.groq.com/*` | Caption tier — planned Groq STT/translation provider |
| `https://api-inference.huggingface.co/*`, `https://huggingface.co/*` | Caption tier — planned Hugging Face Inference Provider option |
| `https://translate.googleapis.com/*` | Caption tier — free Google Translate option |
| `https://translation.googleapis.com/*` | Caption tier — Google Cloud Translation if you supply a key |
| `https://texttospeech.googleapis.com/*` | Caption tier — Google Cloud TTS if you supply a key |
| `https://stt-rt.soniox.com/*` | Caption tier — Soniox STT fallback when the video has no captions |
| `https://libretranslate.com/*`, `http://localhost/*`, `http://127.0.0.1/*` | Caption tier — LibreTranslate managed/self-hosted endpoint |

The Kyma key is stored at `TRUSTED_CONTEXTS` access level so that page scripts on youtube.com cannot read it.

---

## Privacy

Lumeo does not collect, store, or sell any personal data. API keys you enter stay on your device. Subtitle text or audio you choose to translate is sent directly to the provider you pick, for the sole purpose of producing the translation, then discarded. There is no Lumeo-operated server.

Full policy: [`store-assets/privacy-policy.html`](store-assets/privacy-policy.html).

---

## Build a release zip

```bash
./pack.sh
# -> ~/lumeo-vX.Y.Z.zip
```

On Windows / PowerShell:

```powershell
.\pack.ps1
# -> $HOME\lumeo-vX.Y.Z.zip
```

Reads the version from `manifest.json`, excludes `.git`, `.DS_Store`, `node_modules`, vendor archives. Drop the resulting zip into the Chrome Web Store Developer Console for an update, or share it for manual sideload.

---

## Roadmap (post-merge)

- [ ] Per-tab session log with live cost meter (Standard + Realtime)
- [ ] Language warming on hover (sub-200ms switches in Realtime)
- [ ] Dictionary lookup on highlighted source caption text
- [ ] Auto-pick tier — start with Caption if YouTube already has captions, fall back to Standard otherwise
- [ ] Firefox port (MV3 manifest portability TBD)

---

## Contributing

PRs are welcome on `v2-rewrite`. Please read:

- [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)
- [`SECURITY.md`](./SECURITY.md)

The codebase is plain vanilla JS — no build step, no dependencies. Pre-flight before opening a PR:

- `node --check content.js && node --check background.js && node --check popup.js`
- Manual test in a freshly reloaded extension on at least one English YouTube video, on whichever tier you touched.
- If you bump `manifest.json`, also bump `LUMEO_VERSION` in `content.js` (or run `./release.sh patch`).

---

## License

[MIT](./LICENSE) © 2026 Lumeo contributors.

This v2 is a direct merge / rebuild of two prior MIT-licensed projects by the same maintainer. The Echoly v0.2.1 baseline (background.js, content.js, popup, content.css, store-assets) carries forward its original copyright in commit history; Lumen v1 carries forward as the `v1-legacy` branch.
