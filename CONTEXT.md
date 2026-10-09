# CONTEXT.md — Lumeo Domain Glossary & Model

## Ubiquitous Language & Domain Terms

### 1. Tiers & Execution Modes
- **Caption Tier (`caption`)**: Text-first mode. Translates YouTube native captions/cues via lightweight translation providers (`google-free`, `gemini`, `openrouter`, `groq`, `openai`, `custom-gateway`). Includes two auxiliary sub-slots:
  - **TTS Slot (`tts`)**: Spoken playback of translated caption lines.
  - **STT Fallback Slot (`stt`)**: Audio transcription triggered ONLY when a video lacks readable YouTube caption tracks (`missing-caption-track`).
- **Standard Dubbing Tier (`standard`)**: Chunked audio translation (~5s latency). Streams tab audio chunks through Kyma (Whisper → Gemini → MiniMax) or BYOK pipeline.
- **Realtime Dubbing Tier (`realtime`)**: Low-latency live dubbing (<1s latency) via ephemeral WebRTC audio bridge.

---

### 2. Audio Capture & Fallback Mechanics
- **Tab Audio Capture (`captureStream()`)**: Captures internal digital audio from the `<video>` element directly using HTML5 MediaStream.
  - **Crucial Rule**: NEVER uses hardware microphone (`navigator.mediaDevices.getUserMedia`).
  - Works silently without browser microphone permission prompts.
  - Functions identically whether listening via headphones, muted speakers, or physical sound cards.
- **No-Caption Fallback Choice (`missing-caption-track`)**: State encountered when YouTube returns no usable caption tracks (e.g. music videos, live streams, uncaptioned uploads).
  - Controlled by the user's **STT Provider dropdown** (`sttProvider` in settings/popup/options).
  - Extension NEVER silently drains API keys or quota without explicit user selection or user-confirmed action.

---

### 3. Voice Selection & Synthesis (TTS)
- **Smart Voice Picker (`LumeoVoicePicker`)**: Shared subsystem responsible for pairing target languages with the highest quality, human-sounding browser speech synthesis voices.
- **Smart Voice Preferences (`SMART_VOICE_PREFERENCES`)**: Prioritized mapping of language codes to natural voices (e.g., `vi` prioritizes `Microsoft HoaiMy Online (Natural)`, `Google tiếng Việt`, `Microsoft NamMinh Online (Natural)`).
- **Target Language Reactive Filtering**: Whenever the user changes `targetLanguage` in Popup, Options, or Player, the voice dropdown dynamically re-filters and displays only top matching natural voices for that language.
- **Voice Clean Label**: Strips redundant platform prefixes/suffixes for clean, intuitive UI display (e.g. `Microsoft HoaiMy Online (Natural) - Vietnamese (Vietnam)` becomes `HoaiMy (Natural)`).

---

### 4. Providers & Key Vault
- **Provider Slot (`slot`)**: Functional role in a pipeline (`translator`, `stt`, `tts`, `dubPipeline`, `realtimeBridge`).
- **Key Vault**: Secure, client-only `chrome.storage.local` store for user API keys (`geminiKey`, `groqApiKey`, `openaiKey`, `customProxyApiKey`, etc.).
- **Zero-Key Mode (0-Key)**: Free mode operating without user API keys. Supported for translation via `google-free`, TTS via `browser`, and no-caption fallback via Chrome Live Caption.
