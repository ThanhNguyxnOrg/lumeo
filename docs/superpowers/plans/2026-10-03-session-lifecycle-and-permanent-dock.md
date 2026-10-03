# Plan: Decouple Session Lifecycle from Presentation Dock

> **Goal:** Fix unwanted auto-start on toolbar click, make YouTube player button `.ytp-lumeo-button` permanent (never deleted on session stop), add explicit Start/Stop Translation control in the quick popover, and preserve active subtitles when popover is closed.

**Architecture:** See [ADR 0003](../../adr/0003-session-lifecycle-and-permanent-dock-decoupling.md) & [Spec](../specs/2026-10-03-session-lifecycle-and-permanent-dock.md).

---

## Task Breakdown

### Task 1: UI Components & Popover Primary Action (`ui/overlay.js`, `content.css`)
- [x] Add `onStartSession` and `onStopSession` callbacks to `createOverlayController(options)`.
- [x] Render `.ytp-lumeo-toggle-session-btn` in `.ytp-lumeo-popover` as the primary top action:
  - When idle: `▶ Start Translation` (with gradient class `.is-start`).
  - When active: `⏹ Stop Translation` (with active danger class `.is-stop`).
- [x] Add `setSessionState({ isTranslating })` to the returned controller API:
  - Updates the primary action button text and styles.
  - Toggles `.is-translating` class on `.ytp-lumeo-button`.
  - Updates button title/tooltip (`Lumeo AI Subtitles (Alt+L)` vs `Lumeo (Translating) - Alt+L`).
- [x] In `content.css`:
  - Style `.ytp-lumeo-toggle-session-btn` with clean, modern YouTube-dock aesthetics.
  - Style `.ytp-lumeo-button.is-translating` with active orange glow / dot indicator.
  - Ensure `.ytp-lumeo-button` hover, focus, and aria states are smooth.

### Task 2: Decouple Session Callbacks & Remove Auto-Start (`content.js`)
- [x] In `overlayController` instantiation in `content.js`:
  - Remove auto-start from `onButtonClick`. Only toggle popover visibility: `overlayController.toggleSideCollapsed(open)`.
  - Pass `onStartSession`: fetches current settings, sends `{ type: "START", settings: currentSettings }`.
  - Pass `onStopSession`: sends `{ type: "STOP" }`.
- [x] Refactor `removeOverlay()` to `clearSessionUI()`:
  - Do NOT call `overlayController?.destroy()`.
  - Call `subtitleOverlay?.remove()` and `overlayController?.setSessionState({ isTranslating: false })`.
  - Reset cached texts (`currentTargetText = ""`, `currentSourceText = ""`, `lastDisplayedCue = null`).
- [x] Pass `clearSessionUI` instead of destructive `destroy` to `LumeoSessionManager`:
  - Ensure `removeOverlay: clearSessionUI`.
- [x] Sync session state on runtime messages / session events:
  - When `SESSION_STARTED` or translation starts: `overlayController?.setSessionState({ isTranslating: true })`.
  - When `SESSION_STOPPED` or translation ends: `overlayController?.setSessionState({ isTranslating: false })`.

### Task 3: Unit Testing & Verification (`tests/overlay.test.mjs`, `tests/test_session_lifecycle_playwright.py`)
- [x] In `tests/overlay.test.mjs`:
  - Test that clicking `ytButton` does not invoke session start.
  - Test that `setSessionState({ isTranslating: true })` toggles button class and primary button text.
  - Test that clicking Start/Stop dispatches respective callbacks.
  - Test that closing popover does NOT destroy `ytButton` or clear DOM observer.
- [x] Run `npm run check:all` and `npx vitest run` (149 tests passed).
- [x] Run Playwright automated verification test to capture and assert DOM states.
