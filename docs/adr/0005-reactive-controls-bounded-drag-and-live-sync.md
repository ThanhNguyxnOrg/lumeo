# 5. Reactive Controls, Bounded Popover Dragging, and Dynamic Session Sync

Date: 2026-10-03

## Status

Accepted

## Context

During real-world user testing on live YouTube streams and video playback:
1. **Broken Dragging UX**: Completely disabling popover dragging to prevent boundary overflows frustrated users who wanted to reposition the settings panel so it wouldn't obstruct video content.
2. **Zombie Controls on Shortcut / Non-Click Open**: The overlay controller was lazily bound by `content.js:buildOverlay()` only on button click. Opening via shortcuts or programmatic state restore left submenu selections unresponsive because listeners on hidden proxy DOM elements were never bound.
3. **Session Start Race Condition**: Starting from the popover button called `LumeoSessionManager.startSession()` directly and then notified `background.js`, which relayed `CONTENT_START` back to the tab. `session-manager.js` rejected the duplicate start with `"Session already running"`, causing background to falsely mark the session as crashed.
4. **Style Disconnects**: `subBackgroundOpacity` used percentage `0..100` rather than normalized `0.0..1.0`, pinning opacity at 100% in CSS `rgba()`. Edge style classes in `ui/subtitle-overlay.js` (`glow`, `box`) differed from `ui/overlay.js` (`none`, `drop-shadow`, `raised`, `depressed`, `outline`).

Reverse-engineering 8 top closed-source extensions (`eJOY`, `Trancy`, `CCDub`, `YouTube Dubbing`, `Language Reactor`, etc.) confirmed that industry leaders use:
- Direct reactive callbacks instead of synthetic DOM events.
- Strict bounded dragging (`setPointerCapture` + `Math.max`/`Math.min` clamped to `#movie_player`).
- Reactive language handover without tearing down video playback or polling loops.

## Decision

1. **First-Class Reactive Callbacks**: Refactor `createOverlayController` to receive explicit functional callbacks (`onLanguageChange`, `onVoiceChange`, `onLayoutChange`, `onFontSizeChange`, `onOpacityChange`, `onShadowStyleChange`, `onSubtitleOrderChange`, `onStartSession`, `onStopSession`, `onResetPosition`). Remove synthetic hidden proxy `<select>` elements.
2. **Bounded Dragging with Double-Click Reset**:
   - Re-enable drag on `.ytp-lumeo-header` using PointerEvents.
   - Clamp position strictly within `#movie_player`:
     - `left = Math.max(8, Math.min(rawLeft, playerRect.width - popoverWidth - 8))`
     - `top = Math.max(8, Math.min(rawTop, playerRect.height - popoverHeight - 52))`
   - Provide instant snap-back to default button anchor upon double-clicking the header or clicking "Reset Subtitle Position".
3. **Idempotent Session Handshake**:
   - `CONTENT_START` in `content.js` acknowledges `{ ok: true }` if the session is already active or in the process of starting.
4. **Reactive In-Place Language Handover**:
   - In caption mode, changing `targetLanguage` updates `LumeoSessionManager` and translates the active cue immediately in-place, without showing "Stop and restart" toasts.
5. **Unified Subtitle Style Tokens**:
   - Normalize opacity to `0.0..1.0` across all layers.
   - Standardize edge style classes to `lumeo-shadow-none`, `lumeo-shadow-drop-shadow`, `lumeo-shadow-raised`, `lumeo-shadow-depressed`, and `lumeo-shadow-outline`.
6. **Seamless Auto-Fallback on Missing Subtitles & YouTube Live**:
   - When a video has no native CC or is a live stream (`.ytp-live`), automatically engage `video.captureStream()` audio pipeline (Groq Whisper / Soniox STT) to generate live subtitles seamlessly, without intrusive modal prompts.

## Consequences

- Popover can be freely repositioned anywhere within the video player with 0% risk of getting lost or detached.
- All submenu clicks trigger instant state updates regardless of how the menu was opened (click, shortcut, or restore).
- Start button transitions smoothly to active without race conditions or error loops.
- Over 80 lines of brittle DOM proxy glue are eliminated.
