# Lumeo Bug Audit & Architecture Fix Register

**Date:** 2026-10-03  
**Audited Components:** `content.js`, `ui/overlay.js`, `ui/subtitle-overlay.js`, `background.js`, `services/session-manager.js`, `content.css`

---

## 1. Executive Bug Summary

| # | Bug | Severity | Root Cause File | Impact |
|---|-----|----------|-----------------|--------|
| **1** | **Race Condition on "Start Translation"** | 🔴 Critical | [`content.js`](file:///d:/Code/lumeo/content.js#L90-L100), [`background.js`](file:///d:/Code/lumeo/background.js#L366-L375) | Start button fails/jams; background treats duplicate start as fatal error `"Session already running"`. |
| **2** | **Disabled Popover Dragging** | 🔴 Critical | [`ui/overlay.js`](file:///d:/Code/lumeo/ui/overlay.js#L1050-L1055) | User cannot drag popup dialog; `bindDragResize()` was completely stubbed out. |
| **3** | **Subtitle Opacity Fixed to 100%** | 🟠 High | [`ui/subtitle-overlay.js`](file:///d:/Code/lumeo/ui/subtitle-overlay.js#L242-L244) | Value passed as `0-100` instead of normalized `0.0-1.0`; CSS `rgba` alpha >= 1 renders 100% opaque black. |
| **4** | **Character Edge Style Class Mismatch** | 🟠 High | [`ui/subtitle-overlay.js`](file:///d:/Code/lumeo/ui/subtitle-overlay.js#L252-L255) | Toggled legacy `glow`/`box` classes instead of `lumeo-shadow-none`, `drop-shadow`, `raised`, `depressed`, `outline`. |
| **5** | **Dead Key in Storage for Voice** | 🟠 High | [`ui/overlay.js`](file:///d:/Code/lumeo/ui/overlay.js#L284) | Stored `{ voice: val }` which does not exist in `DEFAULT_SETTINGS` (`realtimeVoice`, `standardVoice`, `captionTtsProvider`). |
| **6** | **Disruptive "Stop & Restart" on Language Change** | 🟡 Medium | [`content.js`](file:///d:/Code/lumeo/content.js#L228-L242) | Showed intrusive toast instead of dynamic in-place handover in `LumeoSessionManager`. |
| **7** | **Reset Subtitle Position Ignores Popover** | 🟡 Medium | [`ui/overlay.js`](file:///d:/Code/lumeo/ui/overlay.js#L840-L855) | "Reset Subtitle Position" button only cleared `lumeoSubPosition`, leaving dragged popovers un-reset. |
| **8** | **Zombie Listeners on Keyboard / Direct Open** | 🔴 Critical | [`content.js`](file:///d:/Code/lumeo/content.js#L85-L100), [`ui/overlay.js`](file:///d:/Code/lumeo/ui/overlay.js#L703-L715) | `buildOverlay()` only runs on toolbar button click; opening via shortcut `Alt+L`/`Esc` creates DOM without binding `content.js` listeners, causing all submenu selections to fail. |

---

## 2. Detailed Technical Root Cause Analysis

### Bug 1: Dual Start Handshake Collision
- **Mechanism:**
  1. User clicks `▶ Start Translation` in Popover.
  2. `content.js:onStartSession` starts the session directly: `await LumeoSessionManager.startSession(currentSettings)`.
  3. `content.js` immediately dispatches `START` to `background.js`.
  4. `background.js:handleStart` relays `CONTENT_START` back to the tab.
  5. `content.js:onMessage(CONTENT_START)` calls `startSession(settings)` again.
  6. `services/session-manager.js:358` detects `session` already active and returns `{ ok: false, error: "Session already running." }`.
  7. `background.js` interprets `!reply.ok` as startup crash, switches `state.running = false`, broadcasts error to popup, and halts.
- **Fix:** If `LumeoSessionManager` is already running the requested session when `CONTENT_START` arrives, immediately reply with `{ ok: true }`.

### Bug 2: Empty `bindDragResize()` Stub
- **Mechanism:** To solve a previous issue where unconstrained dragging escaped off-screen, `bindDragResize()` in `ui/overlay.js` was emptied.
- **Fix:** Re-implement drag listeners on `.ytp-lumeo-header` using PointerEvents and strict clamping inside `#movie_player`:
  - `left = Math.max(8, Math.min(rawLeft, playerWidth - popoverWidth - 8))`
  - `top = Math.max(8, Math.min(rawTop, playerHeight - popoverHeight - 48))`

### Bug 3: Opacity Unit Normalization Bug
- **Mechanism:** Submenu stores integer `0`, `25`, `50`, `75`, `100`. In `ui/subtitle-overlay.js`, it set `--lumeo-sub-bg-opacity` to `75`. In `content.css`: `rgba(12, 13, 18, var(--lumeo-sub-bg-opacity, 0.92))`. Any number $\ge 1$ clamps to `1.0` in CSS.
- **Fix:** Normalize before assigning: `const alpha = num > 1 ? num / 100 : num; target.style.setProperty("--lumeo-sub-bg-opacity", String(alpha));`.

### Bug 4: Edge Style Class Disconnect
- **Mechanism:** Popover UI applies `none`, `drop-shadow`, `raised`, `depressed`, `outline`. `ui/subtitle-overlay.js` toggled `lumeo-shadow-glow` and `lumeo-shadow-box`.
- **Fix:** Map `subShadowStyle` directly:
  `target.classList.remove("lumeo-shadow-none", "lumeo-shadow-drop-shadow", "lumeo-shadow-raised", "lumeo-shadow-depressed", "lumeo-shadow-outline");`
  `target.classList.add("lumeo-shadow-" + style);`

### Bug 8: Unbound Zombie Listeners on Non-Click Open
- **Mechanism:** `buildOverlay()` in `content.js` attaches listeners to `elements.langSelect`, `elements.voiceSelect`, `elements.layoutPreset`, etc., but is only invoked inside `options.onButtonClick`. If the popover is opened via shortcut `Alt+L`, or programmatically via `toggleSideCollapsed()`, the root DOM is built by `ui/overlay.js` alone, so `content.js` never binds its listeners. Clicking items in the submenu has zero effect.
- **Fix:** Refactor `createOverlayController` to accept direct callbacks (`onLanguageChange`, `onVoiceChange`, `onLayoutChange`, etc.) and ensure `buildOverlay()` is called lazily on any open event, or initialize bindings during controller creation.

---

## 3. Approved Fix Plan
1. **Unify Session Lifecycle Handshake:** Eliminate duplicate execution between `content.js` and `background.js`.
2. **Direct First-Class Reactive Callbacks:** Pass explicit callbacks to `createOverlayController` so interactions never depend on synthetic `<select>` proxies or click-order timing.
3. **Safe Clamped Popover Drag:** Provide smooth, fluid dragging restricted strictly within `#movie_player`.
4. **Submenu Live Sync:** Synchronize edge style, opacity, and target language dynamically into active subtitles and active sessions.
5. **Ponytail Bloat Cleanup:** Remove ~40 lines of hidden surrogate `<select>` proxy elements in `ui/overlay.js`.
