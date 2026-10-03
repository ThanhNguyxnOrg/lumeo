# Spec: Decoupling Session Lifecycle from Presentation Dock (2026-10-03)

> References: [CONTEXT.md](../../../CONTEXT.md), [ADR 0003](../../adr/0003-session-lifecycle-and-permanent-dock-decoupling.md)

## 1. Problem Statement & Root Cause Analysis

User reported two critical architectural flaws in the in-player experience:
1. **Unwanted Auto-Start**: Clicking the YouTube player toolbar Lumeo button (`.ytp-lumeo-button`) to change target language or inspect settings immediately initiated a live translation session (`START` message to background), polling captions and consuming API quota.
   - **Root Cause**: `content.js:91-95` executed:
     ```javascript
     if (!LumeoSessionManager.getSession()) {
       browserApi.sendRuntimeMessage({ type: "START", settings: currentSettings });
     }
     ```
     whenever `onButtonClick` was called.
2. **Permanent UI Disappearance on Stop ("Mất luôn cả cái kia")**: When stopping translation or when video ended / errored:
   - `services/session-manager.js:569` called `callbacks.removeOverlay?.()`.
   - `content.js:422` implemented `removeOverlay` as:
     ```javascript
     function removeOverlay() {
       if (!root) return;
       overlayController?.destroy();
       root = null;
       elements = {};
       subtitleOverlay?.remove();
     }
     ```
   - `ui/overlay.js:616` `destroy()` explicitly executed:
     ```javascript
     ytObserver.disconnect();
     ytButton.remove();
     root.remove();
     ```
   - Consequently, the `.ytp-lumeo-button` was permanently removed from YouTube's player controls, leaving the user with no entry point to ever open Lumeo again without refreshing the entire browser tab.
3. **Ambiguity Between Popover and Subtitles**: Users expected closing/minimizing the popover to hide the menu while keeping translated subtitles playing on the video.

---

## 2. Decoupled Lifecycle Architecture

```mermaid
graph TD
    subgraph Tab Lifecycle [Tab Presentation Dock - Permanent]
        InjectBtn[Inject .ytp-lumeo-button] --> Observe[MutationObserver watches .ytp-right-controls]
        Observe --> Popover[Render .ytp-lumeo-popover on demand]
        ClickBtn[Click Lumeo Button] --> TogglePop[Toggle Popover Open / Close]
        TogglePop --> UpdateAria[Update aria-pressed]
    end

    subgraph Session Lifecycle [Translation Session - Ephemeral]
        StartClick[Click 'Start Translation' in Popover] --> FireStart[Send START message]
        FireStart --> Active[Session Active: Audio/Captions streaming]
        Active --> RenderSub[Render Subtitle Overlay .lumeo-video-sub]
        Active --> SetBtnGlow[Set .ytp-lumeo-button.is-translating]
        StopClick[Click 'Stop Translation' in Popover / End of Video] --> FireStop[Send STOP message]
        FireStop --> ClearSub[Clear Subtitle Cues]
        ClearSub --> RemoveGlow[Remove is-translating glow]
    end

    Tab Lifecycle -.->|Provides User Action| StartClick
    Tab Lifecycle -.->|Provides User Action| StopClick
    Session Lifecycle -.->|Updates State Only| SetBtnGlow
    Session Lifecycle -.->|Updates State Only| RemoveGlow
```

### Core Architecture Rules:
1. **Never call `overlayController.destroy()` from session callbacks.** `destroy()` is strictly reserved for tab unload / extension reload.
2. **Session cleanup only touches session artifacts**:
   - Clears active subtitle cues in `subtitleOverlay`.
   - Updates `overlayController.setSessionState({ isTranslating: false })`.
   - Updates `.ytp-lumeo-button` CSS class to remove `.is-translating`.
   - Leaves `.ytp-lumeo-button` mounted and `ytObserver` active.
3. **Popover close is purely visual**:
   - Pressing `Esc`, clicking `✕`, or clicking outside sets `layout.sideCollapsed = true` (or hides `.ytp-lumeo-popover`).
   - Does NOT touch active translation or subtitle overlay.

---

## 3. UI & Interaction Design

### A. YouTube Player Button (`.ytp-lumeo-button`)
- **Idle State**:
  - Native YouTube subtle fill (`fill: #eee; opacity: 0.9`).
  - `aria-pressed="false"`.
  - Tooltip: `Lumeo AI Subtitles (Alt+L)`.
- **Translating State (`.is-translating`)**:
  - Visual pulse / badge: Orange accent `#f97316` or dot indicator showing real-time activity.
  - Tooltip: `Lumeo (Translating) - Alt+L`.
- **Popover Open State**:
  - `aria-pressed="true"`.
  - Native active highlight.

### B. Popover Translation Control
- In `.ytp-lumeo-popover-header` or top action row:
  - Add explicit primary action button: `.ytp-lumeo-toggle-session-btn`.
  - **When Idle**:
    - Text: `▶ Start Translation`
    - Background: `linear-gradient(135deg, #f97316 0%, #ea580c 100%)`
    - On Click: Dispatches `onStartSession()` callback to `content.js` -> sends `{ type: "START", settings: currentSettings }`.
  - **When Active**:
    - Text: `⏹ Stop Translation`
    - Background: `rgba(239, 68, 68, 0.2)` with border `rgba(239, 68, 68, 0.4)` and text `#fca5a5`
    - On Click: Dispatches `onStopSession()` callback to `content.js` -> sends `{ type: "STOP" }`.

---

## 4. Technical Implementation Plan

1. **`content.js`**:
   - Remove auto-start from `onButtonClick`:
     ```javascript
     onButtonClick: () => {
       buildOverlay();
       const open = overlayController.isOpen?.();
       overlayController.toggleSideCollapsed(open);
     }
     ```
   - Connect `onStartSession` and `onStopSession` callbacks in `overlayController` instantiation:
     ```javascript
     onStartSession: async () => {
       const stored = await browserApi.sendRuntimeMessage({ type: "GET_STATE" }).catch(() => null);
       const currentSettings = stored?.state || { tier: "caption", targetLanguage: "vi", translateProvider: "google-free" };
       browserApi.sendRuntimeMessage({ type: "START", settings: currentSettings }).catch(() => {});
     },
     onStopSession: async () => {
       browserApi.sendRuntimeMessage({ type: "STOP" }).catch(() => {});
     }
     ```
   - Refactor `removeOverlay()` to `clearSessionUI()`:
     ```javascript
     function clearSessionUI() {
       subtitleOverlay?.remove();
       overlayController?.setSessionState({ isTranslating: false });
       currentTargetText = "";
       currentSourceText = "";
       lastDisplayedCue = null;
     }
     ```
     Ensure `overlayController?.destroy()` is NOT called here.
   - Sync session state changes (`SESSION_STARTED`, `SESSION_STOPPED`, state updates) to `overlayController.setSessionState({ isTranslating: true/false })`.

2. **`ui/overlay.js`**:
   - Add `.ytp-lumeo-toggle-session-btn` in `.ytp-lumeo-popover`.
   - Maintain internal `isTranslating` state.
   - Expose `setSessionState({ isTranslating })`:
     - Updates button text/class: `▶ Start Translation` vs `⏹ Stop Translation`.
     - Updates `.ytp-lumeo-button`: toggles `.is-translating` class.
   - Ensure `destroy()` is clean if called on page unload, but ensure internal methods don't self-destruct on popover close.

3. **`ui/overlay.css`**:
   - Style `.ytp-lumeo-toggle-session-btn`:
     - Height: 32px, border-radius: 8px, font-weight: 600, display: flex, align-items: center, justify-content: center.
     - Smooth transitions for hover/active.
   - Style `.ytp-lumeo-button.is-translating`:
     - Add subtle orange dot or svg indicator.

4. **`tests/overlay.test.mjs`**:
   - Add unit tests verifying:
     - Button click toggles popover without starting session.
     - Stopping session does not remove `.ytp-lumeo-button` from DOM.
     - `setSessionState({ isTranslating: true })` toggles button visuals and popover button text.
     - Calling `clearSessionUI` preserves `.ytp-lumeo-button`.

---

## 5. Verification Checklist

1. `npm run check:all` passes without syntax or lint issues.
2. `npx vitest run` passes 100% of test suites.
3. Interactive browser test (Playwright):
   - Opens mock player.
   - Verifies `.ytp-lumeo-button` is in `.ytp-right-controls`.
   - Clicks button -> popover opens, translation session has NOT started.
   - Clicks "Start Translation" -> session activates, button glows `.is-translating`.
   - Closes popover -> subtitles remain visible if cues arrive.
   - Clicks "Stop Translation" -> subtitles clear, `.ytp-lumeo-button` remains in controls, ready for next use.
