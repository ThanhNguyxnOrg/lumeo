# ADR 0003: Session Lifecycle and Presentation Dock Decoupling

## Context
User reported two critical architectural defects in the in-player experience:
1. **Unwanted Auto-Start**: Simply clicking the YouTube bottom bar Lumeo icon (`.ytp-lumeo-button`) to view settings or change target language automatically triggered `START` translation and background pipeline polling, consuming API quotas and interrupting the user unexpectedly.
2. **Permanent Loss of UI on Stop ("Mất luôn cả cái kia")**: When translation stopped (or when calling `removeOverlay()`), the overlay controller's `destroy()` method was invoked. This removed `.ytp-lumeo-button` from YouTube's controls, disconnected the DOM mutation observer, and removed the root element. The user was left with no way to access Lumeo again without a full page refresh. Additionally, closing the popover menu had ambiguous semantics regarding whether active subtitles should terminate.

## Decision
1. **Decouple Presentation Lifecycle from Session Lifecycle**:
   - The native YouTube control button (`.ytp-lumeo-button`), DOM mutation observer, and popover container (`.ytp-lumeo-popover`) belong to the **Presentation Dock Lifecycle** and are persistent for the lifetime of the YouTube page tab. They must NEVER be destroyed by `stopSession()`, video pause/end, or subtitle clearing.
   - Translation streams, audio capture, transcription, and active subtitle cues belong to the **Session Lifecycle**. Stopping a session resets the translation state and clears active subtitle cues, but keeps the Presentation Dock fully intact.
2. **Explicit User-Driven Translation Control (No Auto-Start)**:
   - Clicking `.ytp-lumeo-button` toggles the Quick Popover menu open or closed. It NEVER starts translation automatically.
   - The popover menu features a prominent, explicit Primary Action button:
     - When Idle: "▶ Start Translation" (styled with Lumeo brand gradient, fires `START`).
     - When Active: "⏹ Stop Translation" (styled with active/danger accent, fires `STOP`).
3. **Three-State Native YouTube Button**:
   - **Idle**: Native YouTube subtle icon styling (`aria-pressed="false"`, no glow).
   - **Translating**: Active indicator (Lumeo orange brand glow + subtle badge/dot) indicating background translation is streaming.
   - **Popover Open**: Active native button state (`aria-pressed="true"`).
4. **Popover Minimization vs Subtitle Display**:
   - Closing or minimizing the popover (via `Esc`, `✕` close button, clicking outside, or clicking the toolbar button) ONLY hides the menu (`is-side-collapsed`).
   - If translation is currently active, subtitles (`.lumeo-video-sub`) continue to render on top of the video player uninterrupted.
5. **Clean Teardown Boundary**:
   - `overlayController.destroy()` is only invoked on full script unload / page teardown.
   - `removeOverlay()` in `content.js` is replaced with `clearSessionUI()`, which clears subtitle cues and sets button state to Idle, without touching `.ytp-lumeo-button` or DOM observers.

## Status
Accepted.

## Consequences
- Clicking the Lumeo button allows users to configure languages and inspect settings safely without triggering accidental API calls.
- Users can stop and restart translation sessions as many times as desired without losing the YouTube player button.
- Subtitle display is never accidentally killed by dismissing the settings popover.
- Clear mental model: Popover = configuration & controls; Subtitles = video companion output; YouTube button = permanent entry point.
