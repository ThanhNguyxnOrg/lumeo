# Research: Real-Time YouTube Subtitle Translation & AI Dubbing Architecture

**Date:** 2026-10-03  
**Target:** Architecture benchmarks for real-time bilingual subtitles, player overlay injection, audio capture, and live AI dubbing in Chromium extensions.

---

## 1. Overview of Leading Implementations

| Solution | Open Source | Architecture Pattern | Rendering Mechanism | Sync Strategy | Audio / Dubbing Support |
|----------|-------------|----------------------|----------------------|---------------|-------------------------|
| **[Echoly](https://github.com/sonpiaz/echoly)** | Yes | WebRTC P2P (Realtime) + Chunked Whisper/Gemini (Standard) | DOM Overlay inside `#movie_player` | Native video `timeupdate` + WebRTC audio clock | Full AI Dubbing (`captureStream` + GainNode) |
| **[Bilingual-Tube](https://github.com/rxliuli/bilingual-tube)** | Yes (GPL-3.0) | Adapter-based DOM Overlay | Relative `div` layer over video player | Intercepts `timedtext` API JSON/XML | Subtitles only |
| **[Dual-Captions](https://github.com/dual-captions)** | Yes | Decoupled Host Adapter + Redux Store | Injected host layer below controls | MutationObserver on native `.ytp-caption-window-container` | Subtitles only |
| **Language Reactor** | Proprietary | Custom player controller wrapper | Direct DOM replacement of subtitle layer | Intercepts video timecode & audio events | Dictation & hover vocabulary, no dubbing |
| **Trancy** | Proprietary | Shadow DOM overlay + AI sentence splitter | Shadow DOM inside player wrapper | Full transcript timeline matching | TTS readback, no live video ducking |

---

## 2. Key Architecture Insights & Lessons for Lumeo

### A. Popover & Subtitle DOM Anchoring (Lessons from Dual-Captions & Bilingual-Tube)
1. **Never anchor floating UI to `window` or `document.body` on YouTube:**
   - When entering fullscreen, `document.fullscreenElement` becomes `#movie_player`. Anything anchored to `body` disappears behind the fullscreen layer.
   - **Best Practice:** Always append the root container to `document.fullscreenElement || document.querySelector("#movie_player") || document.body`.
2. **Strict Clamping for Draggable Elements:**
   - Open-source implementations that allow dragging subtitles or menus use **PointerEvents** (`setPointerCapture`) and calculate positions relative to the bounding box of `#movie_player`:
     ```javascript
     const clampedLeft = Math.max(8, Math.min(rawLeft, playerRect.width - popoverWidth - 8));
     const clampedTop = Math.max(8, Math.min(rawTop, playerRect.height - popoverHeight - 48));
     ```
   - This prevents popovers from ever being dragged off-screen, behind YouTube's sidebar, or below the control bar.

### B. Subtitle Synchronization & Extraction
1. **Two Extraction Strategies:**
   - **Strategy 1 (DOM Sniffing via MutationObserver):**
     Observing `.ytp-caption-window-container`. High compatibility, zero extra network overhead, works seamlessly with user-chosen YouTube auto-captions.
   - **Strategy 2 (Network Interception of `timedtext`):**
     Fetching the complete VTT/JSON track when available. Allows pre-fetching and caching full sentence translations, avoiding latency during playback.
   - **Lumeo's Hybrid Approach:** Lumeo currently sniffs DOM captions for immediate responsiveness, while maintaining an LRU translation cache and falling back to audio-based STT (Groq Whisper) when no native captions exist.

### C. Live Language Switching Without Session Restart
- In systems like Language Reactor and Bilingual-Tube, changing target language is **reactive**:
  - The caption pipeline maintains the current timecode and the original source text.
  - When the target language dropdown changes, it immediately invalidates the current translated cue, issues an asynchronous translation request for the active sentence, and updates the display in-place.
  - **Takeaway for Lumeo:** Remove the legacy "Stop and restart" toast. Update `settings.targetLanguage` immediately in `LumeoSessionManager` and trigger an immediate re-translation of `lastDisplayedCue`.

### D. Audio Capture & Ducking for AI Dubbing (Lessons from Echoly)
1. **Zero-Extension Audio Routing:**
   - Instead of asking for intrusive desktop capture permissions (`chrome.tabCapture`), use HTML5 Media Capture directly on the DOM video element:
     ```javascript
     const stream = video.captureStream ? video.captureStream() : video.mozCaptureStream();
     ```
2. **Volume Ducking Pattern:**
   - Set original video volume to a ducked level (`video.volume = 0.18`), while routing synthesized TTS audio through a Web Audio `GainNode` connected to `audioCtx.destination`.
   - When pausing or seeking, both the original video and the TTS audio stream must sync immediately.

---

## 3. High-Priority Recommendations for Lumeo

1. **Adopt Strict Bounded Dragging for Popover:** Match `ui/subtitle-overlay.js`'s robust clamping on `ui/overlay.js`'s header so users can freely reposition the settings dialog without risk of stranding.
2. **Streamline Session Handshake:** Decouple the popup and content script command paths so `CONTENT_START` acts as an idempotent state acknowledgment.
3. **Make Submenu Dynamic & Reactive:** Ensure every submenu click triggers live style and translation updates without requiring video pause or session restarts.
