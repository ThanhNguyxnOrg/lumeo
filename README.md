<p align="center">
  <img src="./icons/icon-128.png" alt="Lumeo" width="96" height="96" />
</p>

<h1 align="center">Lumeo</h1>

<p align="center">
  <strong>Bilingual captions & live AI dubbing for YouTube — one extension, three tiers.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0.9-ff7a45?style=for-the-badge" alt="Version">
  <img src="https://img.shields.io/badge/Chrome-MV3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Chrome MV3">
  <img src="https://img.shields.io/badge/tests-306%20passed-2ea043?style=for-the-badge" alt="Tests">
  <img src="https://img.shields.io/badge/license-MIT-2ea043?style=for-the-badge" alt="License">
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Install</a> •
  <a href="#usage">Usage</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#project-structure">Structure</a> •
  <a href="#contributing">Contributing</a>
</p>

---

## What is Lumeo?

Lumeo is a browser extension for Chrome, Edge, Firefox, Opera, and other Chromium-based browsers. It lets you watch any YouTube video in your language. It offers **three tiers** — from free caption translation to real-time AI dubbing — so you can pick the one that fits the moment.

No account required. No telemetry. No Lumeo-operated server. Your API keys stay on your device.

---

## Features

### 🎬 Three Translation Tiers

| Tier | How it works | Latency | Cost |
|------|-------------|---------|------|
| **Caption** | Translates YouTube's existing subtitles into 100+ languages. Shows a bilingual in-video overlay with optional TTS read-aloud. Falls back to Groq Whisper or Soniox STT when no captions exist. | Instant | Free (Google Translate default) |
| **Standard** | Captures audio → Kyma Whisper v3 Turbo → Gemini 2.5 Flash → MiniMax Speech Turbo. Full multilingual dub over the original audio. | ~5 seconds | ~$0.25 / 10 min |
| **Realtime** | Captures audio → WebRTC P2P with OpenAI Realtime via Kyma. Sub-second dubbing with selectable voices. | <1 second | ~$0.46 / 10 min |

### 🌍 Language Support

- **13 dubbing languages**: English, Vietnamese, Japanese, Korean, Chinese, French, Spanish, German, Portuguese, Hindi, Indonesian, Italian, Russian
- **100+ caption translation languages** via Google Translate, Gemini, OpenRouter, Groq, OpenAI, Google Cloud, or LibreTranslate

### 🎨 In-Video Subtitle Overlay

- Native-like bilingual subtitles rendered directly on the video player
- Customizable font size, position, and contrast
- Layout presets: Stacked (translated + source), Translated only, Source only
- RTL language support (Arabic, Hebrew, Farsi, Urdu)
- Picture-in-Picture subtitle support

### 🎛️ Compact Settings Toolbar

- Draggable and resizable overlay panel
- Language and voice selector
- Original audio volume & voice volume controls
- Mute original audio toggle
- Keyboard shortcuts (`Esc` to collapse, `?` for help, `Ctrl+Shift+L` to toggle)

### 🔊 Text-to-Speech (Caption Tier)

- **Browser TTS** — Free, on-device speech synthesis for 100+ languages with per-language voice auto-pairing; the voice list auto-filters to the selected target language
- **Google Cloud TTS** — Chirp3-HD voices (BYOK); locales without a Chirp3-HD voice fall back to browser speech automatically
- **OpenAI TTS** — High-quality neural voices (BYOK)
- **Custom / ElevenLabs voices** — Bring your own voice; playback rate auto-fits the subtitle timing
- Spoken lines auto-fit their subtitle window (0.90–1.10×) so narration keeps pace with the video without chipmunking

### 🔒 Privacy-First

- Zero data collection or telemetry
- API keys stored locally in `chrome.storage.local`
- Audio only leaves the browser when you explicitly choose a cloud provider
- Full [privacy policy](store-assets/privacy-policy.html) included

---

## Installation

### Firefox (AMO)

**Status: Public · v2.0.9**

Install Lumeo from the [Firefox Add-ons listing](https://addons.mozilla.org/en-US/firefox/addon/lumeo-captions-ai-dub-for-yout/). Firefox receives future updates through AMO automatically. Mozilla's automated screening marked v2.0.9 tentatively approved; a later human review may still request changes.

### Chrome / Brave (sideload ZIP)

Chrome Web Store currently requires a paid developer registration, so the Chrome/Brave package is distributed through GitHub Releases:

1. Download `lumeo-v<version>-chrome.zip` from the [latest release](https://github.com/ThanhNguyxnOrg/lumeo/releases/latest).
2. Unzip it to a folder you keep.
3. Open `chrome://extensions` (or `brave://extensions`).
4. Enable **Developer mode** (top-right toggle).
5. Click **Load unpacked** → select the unzipped folder.
6. Pin Lumeo to your toolbar.

### Edge

1. Download `lumeo-v<version>-edge.zip` from the [latest release](https://github.com/ThanhNguyxnOrg/lumeo/releases/latest).
2. Open `edge://extensions`, enable **Developer mode**, and choose **Load unpacked**.

**Store status:** Lumeo is not publicly listed on Microsoft Edge Add-ons yet. The first listing must be created and submitted manually in Partner Center; the Edge Add-ons API is for updating an existing listing. See [store status and submission notes](store-assets/store-status.md).

### Opera

1. Download `lumeo-v<version>-opera.zip` from the [latest release](https://github.com/ThanhNguyxnOrg/lumeo/releases/latest).
2. Open `opera://extensions`, enable **Developer mode**, and choose **Load unpacked**.

### From Source (Developer Mode)

```bash
git clone https://github.com/ThanhNguyxnOrg/lumeo.git
cd lumeo
npm install
npm run build:targets
```

Then load `dist/chrome` (or `dist/firefox`, `dist/edge`, `dist/opera`) as an unpacked extension.

### Update

Pull the repo or download the newer ZIP, then reload the extension card. After reloading the extension, also refresh any open YouTube tabs to pick up the new content script.

---

## Usage

1. **Open any YouTube video**
2. **Click the Lumeo toolbar icon** to open the popup
3. **Pick a tier:**

   | Tier | Setup |
   |------|-------|
   | **Caption** | Select target language → Start. Free by default. |
   | **Standard** | Paste a [Kyma API key](https://kymaapi.com) → select language & voice → Start |
   | **Realtime** | Paste a [Kyma API key](https://kymaapi.com) → select language & voice → Start |

4. **Control playback** via the in-video toolbar:
   - Switch language or voice on the fly
   - Adjust original/voice volume
   - Toggle subtitle visibility
   - Change font size and position

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Esc` | Collapse/expand toolbar |
| `?` or `h` | Show shortcuts help |
| `Ctrl+Shift+L` | Toggle toolbar visibility |

---

## Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Popup UI   │◄────│   Background SW  │◄────│   Content Script │
│  popup.html  │     │  background.js   │     │   content.js     │
│  popup.js    │────►│  (state machine) │────►│   (orchestrator) │
└──────────────┘     └──────────────────┘     └──────────────────┘
                                                       │
                            ┌──────────────────────────┤
                            ▼                          ▼
                    ┌───────────────┐        ┌──────────────────┐
                    │  Subtitle     │        │   Pipeline       │
                    │  Overlay      │        │   Engine         │
                    │  (in-video)   │        │                  │
                    └───────────────┘        ├──────────────────┤
                                             │ caption.js       │
                                             │ standard.js      │
                                             │ realtime.js      │
                                             └──────────────────┘
```

### Data Flow

```
popup ◄── BACKGROUND_STATE_UPDATE ─── background ◄── CONTENT_STATE ─── content
       ── START / UPDATE_SETTINGS ──►              ── CONTENT_START ──►
```

### Pipeline Architecture

- **Caption Pipeline**: YouTube captions → translate (7 providers) → bilingual overlay → optional TTS
- **Standard Pipeline**: captureStream → MediaRecorder chunks → Whisper STT → Gemini translate → MiniMax TTS → Web Audio playback
- **Realtime Pipeline**: captureStream → WebRTC PeerConnection → OpenAI Realtime → voice output with gain control

---

## Project Structure

```
lumeo/
├── manifest.json                   # Chrome MV3 manifest
├── background.js                   # Service worker — state machine & message router
├── content.js                      # Content script — orchestrator, overlay, session management
├── content.css                     # All overlay & subtitle styling
├── popup.html / .css / .js         # Extension popup UI
│
├── pipelines/
│   ├── caption.js                  # Caption tier — translate & cache YouTube subtitles
│   ├── caption-orchestrator.js     # Caption lifecycle — fallback choice, progress, TTS
│   ├── standard.js                 # Standard tier — chunked Whisper→Gemini→MiniMax
│   └── realtime.js                 # Realtime tier — WebRTC P2P to OpenAI
│
├── ui/
│   ├── overlay.js                  # Draggable/resizable settings toolbar
│   ├── subtitle-overlay.js         # In-video bilingual subtitle renderer
│   ├── voice-picker.js             # Voice/TTS dropdown population
│   └── caption-fallback-choice.js  # UI for caption fallback selection
│
├── services/
│   ├── captions.js                 # YouTube caption track detection & XML parsing
│   ├── translate.js                # 7 translation providers (Google, Gemini, OpenRouter, etc.)
│   ├── tts-browser.js              # Browser SpeechSynthesis + Google Cloud TTS
│   ├── tts-openai.js               # OpenAI TTS integration
│   ├── stt-groq.js                 # Groq Whisper STT fallback
│   ├── stt-soniox.js               # Soniox WebSocket STT fallback
│   ├── kyma-client.js              # Kyma API — session, heartbeat, error parsing
│   ├── providers.js                # Provider/mode/key registry
│   ├── tier-recommendation.js      # Auto-tier selection logic
│   ├── translation-bundle.js       # Translation bundle utilities
│   ├── srt-export.js               # SRT + ZIP subtitle export
│   ├── sniffer.js                  # Timedtext & caption track interceptor
│   └── audio-processor.js          # PCM AudioWorklet for STT
│
├── lib/
│   ├── audio-utils.js              # captureStream retry, downmix, WAV encode
│   ├── browser-api.js              # Cross-browser API abstraction
│   └── token-guard.js              # Page-level async token guard
│
├── tests/                          # 306 unit tests across 36 test suites (Vitest)
│   ├── helpers/
│   │   ├── chrome-mock.mjs         # Chrome API mock for testing
│   │   └── load-service.mjs        # Service loader helper
│   └── *.test.mjs                  # Test files for each module
│
├── icons/                          # Extension icons (16, 48, 128px)
├── store-assets/                   # Store metadata, screenshots, privacy policy, AMO listing metadata
├── docs/                           # Technical documentation and release research
├── scripts/                        # Target builder, version/manifest checks, release prep
└── .github/workflows/
    ├── ci.yml                      # Syntax, tests, and target-package verification
    └── release.yml                 # Tag-gated multi-target release + optional AMO submission
```

---

## Testing

```bash
# Run all 306 unit tests across 36 suites
npm test

# Syntax check all JavaScript files
npm run check:all

# Version + manifest-reference checks (same checks CI/release run)
npm run check:versions
npm run check:manifest
```

All tests run via [Vitest](https://vitest.dev/) with a custom Chrome API mock. No browser required.

---

## Build Release Packages

```bash
# Build all four store ZIPs into dist/
npm run build:targets

# Chrome-only quick package (macOS/Linux)
./pack.sh

# Chrome-only quick package (Windows/PowerShell)
.\pack.ps1
```

`dist/` then contains:

- `lumeo-v<version>-chrome.zip`
- `lumeo-v<version>-edge.zip`
- `lumeo-v<version>-firefox.zip`
- `lumeo-v<version>-opera.zip`
- `SHA256SUMS.txt` and `build-metadata.json`

The builder reads `manifest.json`, packages only tracked runtime files (`.env`, tests, docs, and local artifacts can never leak in), writes per-target manifest transforms, and produces deterministic ZIP bytes. The same ZIPs are published automatically on every version tag by [`.github/workflows/release.yml`](.github/workflows/release.yml). Firefox is submitted to AMO when the `WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET` secrets are configured. Microsoft Edge's first listing must be created manually in Partner Center; after that first publication, later releases can use the Edge Add-ons API. Opera and Naver Whale uploads stay manual. See [store status](store-assets/store-status.md) and [account / secret setup](docs/RELEASE-SETUP.md).

---

## Permissions

| Permission | Purpose |
|---|---|
| `activeTab`, `scripting` | Inject overlay into the YouTube tab |
| `storage` | Persist settings and API keys locally |
| `https://*.youtube.com/*` | Read captions and capture video audio |
| `https://api.kymaapi.com/*` | Standard + Realtime tier gateway |
| `https://api.openai.com/*` | Realtime P2P + OpenAI translation/TTS |
| `https://generativelanguage.googleapis.com/*` | Gemini translation (BYOK) |
| `https://openrouter.ai/*` | OpenRouter translation (BYOK) |
| `https://api.groq.com/*` | Groq STT/translation (BYOK) |
| `https://translate.googleapis.com/*` | Free Google Translate |
| `https://translation.googleapis.com/*` | Google Cloud Translation (BYOK) |
| `https://texttospeech.googleapis.com/*` | Google Cloud TTS (BYOK) |
| `https://stt-rt.soniox.com/*` | Soniox STT fallback (BYOK) |
| `https://api.elevenlabs.io/*` | ElevenLabs / custom neural voice (BYOK) |
| `https://api.deepseek.com/*` | DeepSeek through the custom AI gateway (BYOK) |
| `optional_host_permissions` | Requested from Settings only when you enter a custom gateway or voice base URL (e.g. Ollama, LM Studio, a LAN TTS server). Nothing is granted at install time. |

---

## Roadmap

- [ ] Per-tab session log with live cost meter
- [ ] Language warming on hover (sub-200ms switches)
- [ ] Dictionary lookup on highlighted caption text
- [ ] Auto-pick tier based on available captions
- [ ] SRT/ZIP export across all tiers
- [x] Firefox MV3 port and public AMO listing
- [ ] First Microsoft Edge Add-ons publication and Opera Add-ons submission

---

## Contributing

PRs welcome on `main`. The codebase is **plain vanilla JS** — no build step, no framework dependencies.

Before opening a PR:

```bash
npm test                    # All 306 tests must pass
npm run check:all           # Syntax check
npm run check:versions      # Manifest/package/content/README/CHANGELOG versions
npm run check:manifest      # Every file referenced by manifest.json exists
```

Version bumps are handled by `./release.sh patch|minor|major|x.y.z`, which updates `manifest.json`, `package.json`, `content.js`, and the README badge together, then verifies them with `scripts/check-versions.mjs`. Do not edit those versions by hand.

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) • [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) • [`SECURITY.md`](./SECURITY.md)

---

## License

[MIT](./LICENSE) © 2026 Lumeo contributors.


