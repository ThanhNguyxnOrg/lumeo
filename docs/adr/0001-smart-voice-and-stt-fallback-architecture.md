# ADR 0001: Smart Voice Selection and Explicit Multi-STT Fallback Architecture

## Status
Accepted

## Context
1. **TTS Voice Inconsistency**: While `ui/voice-picker.js` implemented `SMART_VOICE_PREFERENCES` for the in-player overlay, `popup.js` bypassed it entirely with a hardcoded 3-element list (`CAPTION_VOICES`), and `options.js` lacked reactive filtering by `targetLanguage`.
2. **Missing Caption Track STT Routing**: When YouTube videos lack caption tracks (`missing-caption-track`), Lumeo previously only offered Groq Whisper or Soniox, forcing users to register for Groq even if they already had free Gemini keys or OpenAI keys.
3. **Explicit User Consent & Quota Protection**: Users configure provider slots via explicit dropdowns. Audio processing must strictly avoid physical microphones and must never silently consume user API keys unless explicitly selected in the `sttProvider` dropdown or chosen via the fallback card.

## Decisions

1. **Unify Voice Selection via `LumeoVoicePicker`**:
   - `LumeoVoicePicker` becomes the single authority for speech synthesis voice lists across Popup, Options, and Video Overlay.
   - When `targetLanguage` changes, voice dropdowns dynamically refresh to display prioritized natural voices (e.g. for `vi`: Hoài My Natural, Google tiếng Việt, Nam Minh Natural) followed by an "Off / Mute" option.

2. **Expand STT Slot in Provider Registry**:
   - Add `gemini-stt` (Gemini Multimodal Audio transcription using existing `geminiKey` under Google's 15 RPM Free Tier).
   - Add `openai-whisper` (OpenAI Whisper-1 using existing `openaiKey`).
   - Retain `groq-whisper` (Groq Whisper Large v3 Turbo using `groqApiKey`).
   - Retain `none` as default fallback setting.

3. **Strict Video Audio Capture (No Mic)**:
   - All audio transcription strictly uses internal HTML5 video element streams (`video.captureStream()`).
   - No microphone hardware or permissions are ever requested.

4. **Zero-Key Chrome Live Caption Fallback**:
   - When no API keys exist or `sttProvider` is `none`, the in-player fallback card offers a 1-click button to open `chrome://settings/accessibility` via `background.js` and provides concise instructions to enable Chrome Live Caption.

5. **International Default Target Language (`"en"`)**:
   - The default target language is standardized to English (`"en"`) across all extension interfaces.

6. **Preserve Original Audio Track for Bilingual Subtitles**:
   - `chooseCaptionTrack()` prioritizes the video's original spoken track (ASR or matching native track) as `sourceTrack` when `targetLanguage` differs.
   - `fetchNativeTargetTrack()` fetches or auto-translates target language cues, preserving distinct `cue.text` (source) and `cue.translated` (target) for bilingual (`stacked`) rendering.

7. **In-Player Popover Anchoring & Click Isolation**:
   - The popover container is strictly anchored within `#movie_player` / `.html5-video-player` (or active fullscreen element).
   - Added `mousedown` event propagation stoppage to `.ytp-lumeo-button` to prevent YouTube player pause/play event interference.

## Consequences
- **Positive**: Seamless UX; zero cost for Gemini users when captions are missing; voice dropdowns always show high-quality voices matching the target language; 0-key users have a clear free path via Chrome Live Caption; bilingual subtitles always retain the original language; in-player button reliably toggles popover.
- **Negative / Trade-offs**: Gemini Audio STT requires sending 15s WAV chunks via base64, which adds a slight payload overhead (~300KB/chunk) compared to streaming WebSockets.
