<p align="center">
  <img src="./icons/icon-128.png" alt="Lumeo" width="96" height="96" />
</p>

<h1 align="center">Lumeo</h1>

<p align="center">
  <strong>Bilingual captions & live AI dubbing for YouTube — one extension, three tiers.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0.0-ff7a45?style=for-the-badge" alt="Version">
  <img src="https://img.shields.io/badge/Chrome-MV3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Chrome MV3">
  <img src="https://img.shields.io/badge/tests-118%20passed-2ea043?style=for-the-badge" alt="Tests">
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

Lumeo is a Chrome extension that lets you watch any YouTube video in your language. It offers **three tiers** — from free caption translation to real-time AI dubbing — so you can pick the one that fits the moment.

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

- **Browser TTS** — Free, on-device speech synthesis
- **Google Cloud TTS** — Chirp3-HD voices (BYOK)
- **OpenAI TTS** — High-quality neural voices (BYOK)

### 🔒 Privacy-First

- Zero data collection or telemetry
- API keys stored locally in `chrome.storage.local`
- Audio only leaves the browser when you explicitly choose a cloud provider
- Full [privacy policy](store-assets/privacy-policy.html) included

---

## Installation

### From Source (Developer Mode)

```bash
git clone https://github.com/ThanhNguyxnOrg/lumeo.git
cd lumeo
npm install
```

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `lumeo` folder
4. Pin Lumeo to your toolbar

### Update

```bash
git pull
```

Then click the ↻ reload icon on the extension card in `chrome://extensions`.

> **Note:** After reloading the extension, also refresh any open YouTube tabs to pick up the new content script.

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
├── tests/                          # 117 unit tests (Vitest)
│   ├── helpers/
│   │   ├── chrome-mock.mjs         # Chrome API mock for testing
│   │   └── load-service.mjs        # Service loader helper
│   └── *.test.mjs                  # Test files for each module
│
├── icons/                          # Extension icons (16, 48, 128px)
├── store-assets/                   # Web Store metadata, screenshots, privacy policy
├── docs/                           # Technical documentation
├── scripts/                        # Build & check scripts
└── .github/workflows/ci.yml        # GitHub Actions CI pipeline
```

---

## Testing

```bash
# Run all 117 unit tests
npm test

# Syntax check all JavaScript files
npm run check:all
```

All tests run via [Vitest](https://vitest.dev/) with a custom Chrome API mock. No browser required.

---

## Build a Release Zip

```bash
# macOS / Linux
./pack.sh
# → ~/lumeo-v1.0.0.zip

# Windows / PowerShell
.\pack.ps1
# → $HOME\lumeo-v1.0.0.zip
```

Reads the version from `manifest.json`, excludes dev files (`.git`, `node_modules`, `tests/`). Drop the zip into the Chrome Web Store Developer Console.

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
| `https://texttospeech.googleapis.com/*` | Google Cloud TTS (BYOK) |
| `https://stt-rt.soniox.com/*` | Soniox STT fallback (BYOK) |

---

## Roadmap

- [ ] Per-tab session log with live cost meter
- [ ] Language warming on hover (sub-200ms switches)
- [ ] Dictionary lookup on highlighted caption text
- [ ] Auto-pick tier based on available captions
- [ ] SRT/ZIP export across all tiers
- [ ] Firefox MV3 port

---

## Contributing

PRs welcome on `main`. The codebase is **plain vanilla JS** — no build step, no framework dependencies.

Before opening a PR:

```bash
npm test                    # All 117 tests must pass
npm run check:all           # Syntax check
```

If you bump `manifest.json` version, also update `LUMEO_VERSION` in `content.js` and `EXPECTED_CONTENT_VERSION` in `background.js`.

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) • [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) • [`SECURITY.md`](./SECURITY.md)

---

## License

[MIT](./LICENSE) © 2026 Lumeo contributors.


