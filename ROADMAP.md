# Lumeo Roadmap

Lumeo is the merge of two predecessor codebases:

- **Lumen v1** — caption-first YouTube subtitle translator. Preserved on the `v1-legacy` branch.
- **Echoly v0.2.1** — live AI dubbing extension from `echoly-main.zip`. Imported into `main` as the v2 baseline.

`main` is the only product branch. `v1-legacy` is a reference branch and should stay until every useful v1 feature has been ported into clean modules.

## Source Analysis

### Lumen v1.2.1 — Caption-First Translator

**Philosophy:** translate existing YouTube subtitles, render bilingual captions, optionally read each translated line with TTS.

How it works:

- `sniffer.js` patches page-context `fetch` / `XMLHttpRequest` to detect YouTube `timedtext` URLs and read `ytInitialPlayerResponse.captions`.
- It fetches subtitle XML, parses timed text nodes, translates in batches of ~50 lines, and caches by video ID.
- Translation providers:
  - Google Translate public endpoint
  - Google Cloud Translation API
  - OpenAI Chat Completions
- UI features:
  - bilingual subtitle overlay
  - side panel with timed subtitle rows
  - click a row to seek the YouTube video
  - highlight current subtitle row
  - subtitle style controls: font, size, color, background, opacity, stroke
  - SRT / ZIP export
- Fallback when a video has no captions:
  - asks for tab audio via `getDisplayMedia`
  - converts audio with `AudioWorklet`
  - streams PCM chunks to Soniox STT through `background.js` WebSocket bridge
- TTS:
  - browser `speechSynthesis`
  - Google Cloud Chirp3-HD TTS

Known problems:

- `content.js` and `popup.js` are heavily obfuscated and hard to maintain.
- No tests or module boundaries.
- It translates text only; it does not provide real live dubbing over the original audio.

### Echoly v0.2.1 — Live AI Dubbing Baseline

**Philosophy:** live AI voice-over for YouTube, so the user hears the translated speech directly.

Two dubbing tiers:

- **Realtime:** capture YouTube audio, open WebRTC P2P to OpenAI Realtime through a Kyma-minted ephemeral token. Target latency: sub-second. Supports speaker auto-clone or 9 OpenAI voices.
- **Standard:** capture audio in 5-second chunks, re-encode to 16 kHz WAV, then run Whisper → Gemini → MiniMax TTS through Kyma. Target latency: ~5 seconds.

Technical strengths we keep:

- Clean vanilla JS, no build step, commented code.
- Three-layer state model:
  - `background.js` = single source of truth
  - `popup.js` = passive renderer
  - `content.js` = pipeline owner
- `BACKGROUND_STATE_UPDATE` push model prevents popup/content desync.
- Token-guarded async pattern (`pageToken`) prevents stale callbacks after user settings change.
- `AbortController` per session stops in-flight Whisper / Translate / TTS work when the user presses Stop.
- Zero-gap handover for Realtime voice/language changes: build new session, swap when ready, close old one shortly after.
- Draggable/resizable overlay with viewport clamp and persisted layout.
- Kyma heartbeat, 60-minute auto-stop, 5-minute warning, tab-close `keepalive` cleanup.
- Web Audio `GainNode` allows voice amplification up to 2x, separate from original YouTube volume.
- Existing release assets: `pack.sh`, `release.sh`, privacy policy, screenshots guide, Web Store metadata.

Known gaps we fill from Lumen v1:

- Only 13 dubbing languages versus 100+ caption languages.
- Requires Kyma key for core dubbing; no free mode.
- Does not read existing YouTube captions, so it can waste Whisper calls on videos that already have good captions.
- No SRT / ZIP export.
- No custom subtitle style editor.
- History panel is not a clickable timed transcript.

## Feature Merge Matrix

| Feature | Lumen v1 | Echoly zip | Lumeo target |
|---|---:|---:|---|
| YouTube subtitle sniffing | Yes | No | Keep Lumen |
| Free caption translation | Yes | No | Keep Lumen, add provider choices |
| Native bilingual YouTube track use | Yes | No | Keep Lumen |
| Realtime AI dubbing (<1s) | No | Yes | Keep Echoly |
| Standard chunked dubbing (~5s) | No | Yes | Keep Echoly |
| STT fallback for no-caption videos | Soniox | Whisper via Kyma | Keep both; choose by tier/provider |
| Language coverage | 100+ caption languages | 13 dub languages | 100+ for Caption, curated 13+ for Dub |
| Line-by-line TTS | Browser + Google Cloud | No | Keep Lumen |
| Speaker voice clone | No | Yes | Keep Echoly |
| SRT / ZIP export | Yes | No | Keep Lumen, extend to all tiers |
| Subtitle style editor | Yes | No | Keep Lumen, redesign UI |
| Clickable transcript side panel | Yes | History only | Keep Lumen behavior, redesign visually |
| Drag + resize overlay | No | Yes | Keep Echoly overlay mechanics |
| Background as source of truth | No | Yes | Keep Echoly architecture |
| Token guard + abort cancellation | Limited | Yes | Apply Echoly pattern to all tiers |
| Heartbeat / auto-stop / keepalive | No | Yes | Keep Echoly for dub tiers |
| Original/dub volume split | No | Yes | Keep Echoly |
| Web Store metadata / privacy | Basic | Strong | Keep Echoly, expand for all providers |
| Code quality | Obfuscated | Clean | Use Echoly as skeleton; rewrite Lumen logic cleanly |

## Product Architecture

Lumeo is a three-tier extension:

```text
Tier 1 — Caption (Free / BYOK)
Sniff YouTube subtitles → translate text → bilingual overlay + transcript side panel + optional TTS
Best for: videos with captions, language learning, reading while listening

Tier 2 — Standard Dub (Kyma BYOK)
Capture audio → 5s chunks → Whisper → Gemini → MiniMax → translated voice over original
Best for: videos without captions, cheaper voice-over

Tier 3 — Realtime Dub (Kyma BYOK)
Capture audio → WebRTC P2P → OpenAI Realtime → sub-second translated voice
Best for: live streams, podcasts, low-latency sessions
```

Target file layout:

```text
/
├─ manifest.json
├─ background.js              Echoly state machine + Caption/Soniox message bridge
├─ popup.html / popup.css     final Lumeo popup shell
├─ popup.js                   passive renderer over background state
├─ content.js                 thin orchestrator and router
├─ pipelines/
│  ├─ caption.js              clean Lumen rewrite: captions, translation, TTS, export
│  ├─ standard.js             Echoly chunked dub pipeline
│  └─ realtime.js             Echoly WebRTC pipeline
├─ ui/
│  ├─ overlay.js              draggable/resizable shell
│  ├─ side-panel.js           clickable transcript side panel
│  ├─ subtitle-overlay.js     bilingual subtitle renderer
│  └─ style-editor.js         caption style controls
├─ services/
│  ├─ sniffer.js              YouTube timedtext sniffer
│  ├─ translate.js            Google / Gemini / OpenRouter / LibreTranslate / OpenAI
│  ├─ tts-browser.js          SpeechSynthesis + Google Cloud TTS
│  ├─ stt-soniox.js           Soniox STT fallback
│  ├─ kyma-client.js          Kyma errors, heartbeat, session end
│  └─ srt-export.js           SRT + ZIP export
├─ lib/
│  ├─ token-guard.js          reusable stale-callback guard
│  └─ audio-utils.js          captureStream retry, WAV encoding, gain helpers
├─ icons/
├─ store-assets/
├─ docs/
├─ pack.sh
└─ release.sh
```

## Technical Decisions

- **Use Echoly as the skeleton.** It has the cleanest architecture and avoids carrying forward v1 obfuscation.
- **Keep `background.js` as the single source of truth.** Popup renders state; content owns pipelines.
- **Apply token guard to every tier.** Caption batch translation must not mutate state after language/provider/session changes.
- **Apply `AbortController` to Caption tier too.** Stop should cancel pending translation requests and avoid burning user quota.
- **One overlay shell, multiple modes.** Caption uses bilingual subtitle + timed side panel + style editor; Standard/Realtime use current dub + source caption + history.
- **Tier-aware voice picker.** Browser/Google voices for Caption, MiniMax voices for Standard, OpenAI voices/auto-clone for Realtime.
- **Provider vault.** All user API keys stay in `chrome.storage.local` with trusted-context storage access where possible.
- **Do not preserve compatibility with the obfuscated v1 internals.** Preserve behavior, not code shape.

## Branch Plan

- `main`: active Lumeo v2 development and release branch.
- `v1-legacy`: read-only preservation branch for the old caption pipeline, subtitle style editor, Soniox fallback, cache, and SRT export.
- Delete `v1-legacy` only after Phase 4 is complete and the Caption tier has feature parity with v1.

## Merge Plan

### Phase 1 — Foundation (done)

- Imported the Echoly v0.2.1 baseline into `main`.
- Rebranded the project to **Lumeo**.
- Preserved Lumen v1 on `v1-legacy`.
- Moved clean v1 files into `services/`:
  - `services/sniffer.js`
  - `services/audio-processor.js`
- Fixed CI after the folder move.
- Renamed GitHub repo to `ThanhNguyxnOrg/lumeo`.
- Removed local archive/extract trash after import.

### Phase 2 — Caption Tier

Goal: bring back the best Lumen v1 features, but rewrite them cleanly instead of keeping the obfuscated bundle.

- Extract v1 logic from `v1-legacy:content.js`:
  - YouTube caption-track detection
  - `timedtext` URL sniff fallback
  - XML subtitle parsing
  - Native bilingual track merge
  - Translation dispatch
  - Browser / Google TTS
  - Soniox STT fallback
  - subtitle cache
  - SRT / ZIP export
- Implement clean modules:
  - `pipelines/caption.js`
  - `services/translate.js`
  - `services/tts-browser.js`
  - `services/stt-soniox.js`
  - `services/srt-export.js`
- Integrate Caption tier with the existing background/content state machine.

### Phase 3 — Unified UI

- Add tier picker with three options:
  - Caption Free
  - Standard Dub
  - Realtime Dub
- Add provider/key sections:
  - Kyma
  - OpenAI
  - Google Cloud
  - Gemini
  - Groq
  - OpenRouter
  - Soniox
  - LibreTranslate
- Add Caption UI:
  - bilingual subtitle overlay
  - clickable subtitle side panel
  - subtitle style editor
  - SRT / ZIP export button

### Phase 4 — Polish

- Auto-pick best tier:
  - use Caption if YouTube captions exist
  - suggest Standard if no captions exist
  - suggest Realtime for live / low-latency use
- Add per-video cache policy:
  - invalidate by target language + provider + source track
  - cap at 50 videos or 5 MB local storage
- Export transcript for all tiers.
- Update README, screenshots guide, privacy copy, and Web Store metadata.

### Phase 5 — Release

- Host privacy page on GitHub Pages.
- Capture 5 Chrome Web Store screenshots.
- Render 440x280 promo tile.
- Run `pack.sh`.
- Submit Chrome Web Store listing.

## AI Provider Plan

Lumeo should support three provider categories: no-key free, free-tier BYOK, and premium BYOK. Keep every provider optional and user-controlled; never hardcode project-owned keys.

### Free Without API Key

- **Google Translate public endpoint** (`translate.googleapis.com`) for Caption tier translation. Default free mode. Risk: unofficial endpoint, so implement graceful fallback + rate-limit messaging.
- **Browser SpeechSynthesis** for Caption tier TTS. Default free TTS. Risk: quality and available voices vary by OS/browser.
- **Native YouTube translated captions**, when YouTube already exposes a target-language track. Best free path: no AI call, no user key, no extra provider.
- **Self-hosted LibreTranslate** endpoint URL. User can point Lumeo at `http://localhost:5000` or their own server. No proprietary dependency; powered by Argos Translate. Useful for privacy/offline users.

### Free-Tier API Keys

These require the user to paste their own API key, but usually have a free tier or free model options.

| Provider | Lumeo use | Key fields | Why add it | Notes |
|---|---|---|---|---|
| **Gemini API** | Caption translation, optional context-aware subtitle rewrite | `geminiApiKey`, `geminiModel` | Google AI Studio offers a free tier with per-project rate limits; good quality/latency for multilingual translation. | Default model candidate: `gemini-2.5-flash-lite` or latest Flash-Lite. Surface quota errors clearly. |
| **Groq API** | Fast STT for no-caption videos; optional caption translation via Llama/DeepSeek models | `groqApiKey`, `groqModel`, `groqSttModel` | Very fast inference; Groq docs expose Whisper endpoints for transcription/translation. | Candidate STT models: `whisper-large-v3`, `whisper-large-v3-turbo`. Keep chunk-size limits and file-size constraints visible. |
| **OpenRouter** | Caption translation via free model router or user-selected models | `openRouterApiKey`, `openRouterModel` | Free Models Router can route requests to currently available zero-cost models. | Default model candidate: `openrouter/free`. Always show selected provider/model in debug logs because router may choose different models. |
| **Hugging Face Inference Providers** | Experimental translation/STT fallback | `huggingFaceToken`, `hfProvider`, `hfModel` | Unified API for many model/provider backends; monthly credits available for users. | Treat as advanced/experimental because free credits/rate limits are small and provider availability can change. |
| **LibreTranslate managed/self-hosted** | Caption translation | `libreTranslateUrl`, `libreTranslateApiKey?` | Open-source translation API; can be self-hosted or used through a managed instance. | Support both no-key local URL and API-key deployments. |
| **Soniox** | STT fallback when YouTube has no captions | `sonioxApiKey` | Existing v1 fallback; good for turning audio into captions before translation. | Keep disabled by default; requires explicit tab-audio permission via `getDisplayMedia`. |

### Paid / Premium BYOK

- **Kyma** — Standard and Realtime dubbing; the fastest route to preserve Echoly's current dub pipelines.
- **OpenAI** — Realtime dubbing via Kyma; optional direct caption translation for users who already have an OpenAI key.
- **Google Cloud Translation** — higher-limit Caption translation.
- **Google Cloud Text-to-Speech** — premium Chirp3-HD voices.

### Provider Implementation Order

1. Keep Caption default free: Google Translate public endpoint + Browser SpeechSynthesis + native YouTube captions.
2. Add Gemini translation as the first BYOK AI provider because it is straightforward chat-completions style translation and has a free tier.
3. Add OpenRouter `openrouter/free` as the second BYOK provider for model diversity and zero-cost model routing.
4. Add LibreTranslate URL mode for self-hosters/privacy users.
5. Add Groq STT for no-caption videos (complements Soniox fallback).
6. Keep Hugging Face under Advanced until rate limits/provider differences are tested.

### Mode / Engine Fit

Do not show the same provider controls for every mode. "Mode" is the user-facing workflow; "Engine" is the provider used inside that workflow.

| Mode | Primary engine choices | Fallback choices | UI rule |
|---|---|---|---|
| **Caption Free** | Google Translate public endpoint only | Soniox STT when no captions exist; Standard Dub if the user has a dub gateway key | Do not show Engine in the main UI. Free means Google Free. BYOK engines live in Advanced. |
| **Standard Dub** | Existing Kyma Standard pipeline (Whisper -> Gemini -> MiniMax) | Future direct pipeline: Groq STT -> Gemini/OpenRouter translation -> TTS provider | Hide Caption Engine selector. Show voice, language, and required dub gateway key. |
| **Realtime Dub** | Existing Kyma Realtime pipeline (OpenAI Realtime via ephemeral token) | Future direct realtime providers if available | Hide Caption Engine selector. Show realtime voice/clone controls and required dub gateway key. |

Copy rule: avoid "No Kyma" or provider-centric wording in the main UI. Use neutral product language such as "Caption - Free", "Standard - Audio", "Realtime - Live", and "Dub gateway key". Provider names belong inside the key vault or advanced settings.

### Provider Sources To Re-check Before Implementation

- Gemini pricing and rate limits: <https://ai.google.dev/gemini-api/docs/pricing> and <https://ai.google.dev/gemini-api/docs/rate-limits>
- Groq Speech-to-Text docs: <https://console.groq.com/docs/speech-to-text>
- OpenRouter free models router: <https://openrouter.ai/openrouter/free/api>
- LibreTranslate docs: <https://docs.libretranslate.com/>
- Hugging Face Inference Providers: <https://huggingface.co/inference-api/> and <https://huggingface.co/docs/api-inference/pricing>

## Cleanup Checklist

Run this before marking v2 stable:

- Remove any local-only archives or extracts.
- Confirm `.gitignore` blocks generated zip files and vendor dumps.
- Confirm `git status --short` is clean.
- Confirm CI is green on `main`.
- Confirm `v1-legacy` is no longer needed, or keep it clearly documented.
- Confirm all docs say **Lumeo** except historical references to Lumen v1 / Echoly.
- Confirm `manifest.json`, `README.md`, `CHANGELOG.md`, `store-assets/web-store-metadata.md`, and `store-assets/privacy-policy.html` agree on the same permissions and provider list.
