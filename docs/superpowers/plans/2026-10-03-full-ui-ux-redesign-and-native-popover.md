# Full UI/UX Redesign & YouTube Native Popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete end-to-end UI/UX overhaul of Lumeo: replace the obsolete floating window (`.ec-root`) with a YouTube-native bottom-up popover menu anchored cleanly above the control bar, unify live caption styling using `chrome.storage.local` as the single source of truth (fixing the bug where next caption lines overwrote settings), implement `Alt+L` keyboard shortcut, `A-`/`A+` quick size steppers, bilingual order swapping, and redesign `options.html` into a premium 16:9 cinema dashboard.

**Architecture:**
1. **Single Source of Truth Storage**: Migrate `content.js`, `ui/subtitle-overlay.js`, and `options.js` to rely exclusively on `chrome.storage.local` for caption styles (`fontSize`, `bottomOffset`, `highContrast`, `layoutPreset`, `subtitleOrder`, `subBackgroundOpacity`, `subShadowStyle`, volumes). Remove local YouTube `localStorage` synchronization conflicts that previously caused incoming cues to reset live user adjustments.
2. **Native YouTube Quick Popover (`ui/overlay.js`)**: Discontinue the draggable `.ec-root` floating box. Mount a YouTube-native popover menu (`.ytp-lumeo-popover`) anchored at `bottom: 60px; right: 12px` inside `#movie_player`, styled to match YouTube's native dark menus (12px rounded borders, slide-in submenus, quick `A-`/`A+` font size stepper, reset position button, and reliable "Full Settings ↗" navigation via service worker).
3. **Keyboard Commands (`manifest.json` & `background.js`)**: Declare `_execute_action` shortcut `Alt+L` in `manifest.json` `commands`, triggering instantaneous toggle without requiring mouse navigation.
4. **Cinematic Options Dashboard (`options.html` & `options.css`)**: Implement a responsive 16:9 cinema mock player utilizing the exact `.lumeo-video-sub` class hierarchy for 100% WYSIWYG fidelity, with official Lumeo branding, WCAG AAA dark form controls, bilingual order switcher, subtitle effect pickers, and live position reset.

**Tech Stack:** Vanilla JavaScript (ES Modules / IIFE), CSS3 (Modern custom properties, glassmorphism), Chrome Extensions MV3, Vitest, Playwright.

**Spec:** [docs/superpowers/specs/2026-10-03-ui-redesign-backlog.md](file:///d:/Code/lumeo/docs/superpowers/specs/2026-10-03-ui-redesign-backlog.md), [CONTEXT.md](file:///d:/Code/lumeo/CONTEXT.md), [docs/adr/0001-native-youtube-dock-and-draggable-subtitles.md](file:///d:/Code/lumeo/docs/adr/0001-native-youtube-dock-and-draggable-subtitles.md), [docs/adr/0002-options-branding-live-sync-and-dark-selects.md](file:///d:/Code/lumeo/docs/adr/0002-options-branding-live-sync-and-dark-selects.md).

## Global Constraints
- 100% International English for all UI copy, labels, tooltips, and messages.
- Zero bulky floating HUD boxes: `.ec-root` discontinued; replaced by `.ytp-lumeo-popover`.
- Strict single source of truth in `chrome.storage.local`; eliminate duplicate origin `localStorage` style keys.
- Options page navigation must only be dispatched via service worker message `{ type: "OPEN_OPTIONS_PAGE" }`.
- Contrast ratio >= 4.5:1 (WCAG AA/AAA) across all dark mode inputs and dropdowns.
- Zero regressions across the 145 Vitest test suite.

## Review Focus
1. **Zero Style Overwrite on Next Cue**: Adjusting font size or contrast in options remains active persistently across upcoming caption lines without snapping back.
2. **Popover Positioning**: Popover is anchored at `bottom: 60px; right: 12px` and never collides with or hides the YouTube video progress/scrub bar in standard, theater, or fullscreen modes.
3. **Drag vs Reset Priority**: Dragging subtitles saves `%` coordinates; clicking "Reset Position" in popover or options restores bottom-centered offset.
4. **Keyboard Toggle (`Alt+L`)**: Pressing `Alt+L` toggles the Lumeo popover / active state seamlessly.
5. **Bilingual Ordering**: Toggling `subtitleOrder` flips the vertical stacking of translated and source text correctly.

---

### Task 1: Single Source of Truth for Caption Style & Live Storage Synchronization
**Files:**
- Modify: `content.js:109-170`
- Modify: `ui/subtitle-overlay.js:175-225`
- Modify: `options.js:150-210`
- Test: `tests/subtitle-overlay.test.mjs`

**Interfaces:**
- Consumes: `chrome.storage.local` keys: `fontSize`, `bottomOffset`, `highContrast`, `layoutPreset`, `subtitleOrder`, `subBackgroundOpacity`, `subShadowStyle`.
- Produces: `content.js` listening to `chrome.storage.onChanged` to maintain internal `captionStyle` without reading YouTube's `localStorage["lumeoCaptionStyle"]`.
- Produces: `subtitleOverlay.applyStyle(style)` updating `--lumeo-caption-font-size`, `--lumeo-caption-bottom-offset`, `--lumeo-sub-opacity`, shadow classes, and ordering.

- [x] **Step 1: Write failing unit test in `tests/subtitle-overlay.test.mjs` for subtitle ordering and style options**
```javascript
it("supports subtitle ordering: translation-top vs source-top", () => {
  controller.updateCue(
    { text: "hello", translated: "xin chào" },
    { captionStyle: { layoutPreset: "stacked", subtitleOrder: "source-top" }, targetLanguage: "vi" }
  );
  const overlay = controller.getElement();
  const children = Array.from(overlay.children).map(c => c.className);
  expect(children.indexOf("lumeo-video-sub-source")).toBeLessThan(children.indexOf("lumeo-video-sub-translated"));
});
```

- [x] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/subtitle-overlay.test.mjs`
Expected: FAIL due to source line always appending after translated line.

- [x] **Step 3: Implement ordering and styling options in `ui/subtitle-overlay.js` & `content.js`**
- In `ui/subtitle-overlay.js`: In `appendSubtitleLines`, check `captionStyle.subtitleOrder === "source-top"` to order source line before translated line.
- Support `captionStyle.subBackgroundOpacity` (CSS var `--lumeo-sub-bg-opacity`) and `captionStyle.subShadowStyle` (e.g., `"glow"`, `"outline"`, `"box"`).
- In `content.js`: Remove `localStorage.getItem(CAPTION_STYLE_KEY)` override. Load defaults merged with `chrome.storage.local.get` and listen to `chrome.storage.onChanged` to update `captionStyle` and call `applyCaptionStyle()`.
- In `options.js`: Remove the redundant `chrome.tabs.query` broadcast loop since `storage.onChanged` already notifies content scripts.

- [x] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/subtitle-overlay.test.mjs`
Expected: PASS.

- [x] **Step 5: Run full test suite**
Run: `npx vitest run`
Expected: 145 passing.

- [x] **Step 6: Commit**
```bash
git add content.js ui/subtitle-overlay.js options.js tests/subtitle-overlay.test.mjs
git commit -m "fix(sync): establish chrome.storage.local as single source of truth for caption styles"
```

---

### Task 2: Native YouTube Quick Popover & In-Player Control Overhaul
**Files:**
- Modify: `ui/overlay.js`
- Modify: `content.css:200-380, 880-1050`
- Test: `tests/overlay.test.mjs`

**Interfaces:**
- Consumes: `#movie_player .ytp-right-controls`
- Produces: `.ytp-lumeo-popover` positioned at `bottom: 60px; right: 12px;` inside `#movie_player`.
- Produces: Quick controls:
  - Header: Logo, title, status indicator.
  - Stepper: `A-` / `A+` buttons modifying font size in `chrome.storage.local`.
  - Dropdown: Target Language & Voice.
  - Dropdown: Display Mode (Bilingual, Translation only, Original only) & Subtitle Order (Translation top / Original top).
  - Button: "Reset Subtitle Position" (clears `lumeoSubPosition` and resets to default offset).
  - Action: "Full Settings ↗" sending `{ type: "OPEN_OPTIONS_PAGE" }`.
- Produces: Complete removal of bottom coordinate clipping (`openTop = pBottom - 110` deleted).

- [x] **Step 1: Write failing unit test in `tests/overlay.test.mjs` for popover structure and A-/A+ stepper**
```javascript
it("renders YouTube-native popover menu above control bar with A-/A+ steppers", () => {
  const popover = root.querySelector(".ytp-lumeo-popover");
  expect(popover).not.toBeNull();
  const btnFontDec = root.querySelector("[data-lumeo-font-dec]");
  const btnFontInc = root.querySelector("[data-lumeo-font-inc]");
  expect(btnFontDec).not.toBeNull();
  expect(btnFontInc).not.toBeNull();
});
```

- [x] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/overlay.test.mjs`
Expected: FAIL.

- [x] **Step 3: Implement YouTube-native popover in `ui/overlay.js` and `content.css`**
- Replace the bulky floating `.ec-root` toolbar with an anchored `.ytp-lumeo-popover`.
- Style in `content.css`:
  - `position: absolute; bottom: 60px; right: 12px; width: 280px; background: rgba(22, 24, 32, 0.96); backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; box-shadow: 0 16px 40px rgba(0,0,0,0.8);`
  - Stepper buttons for `A-` / `A+` modifying font size smoothly between 14px and 36px.
  - Add "Reset Subtitle Position" button dispatching reset event to `subtitleOverlay`.
  - Fix Settings button to dispatch `{ type: "OPEN_OPTIONS_PAGE" }`.

- [x] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/overlay.test.mjs`
Expected: PASS.

- [x] **Step 5: Run full test suite**
Run: `npx vitest run`
Expected: All tests pass.

- [x] **Step 6: Commit**
```bash
git add ui/overlay.js content.css tests/overlay.test.mjs
git commit -m "feat(ui): implement YouTube-native quick popover menu replacing floating bar"
```

---

### Task 3: Global Keyboard Shortcut `Alt+L` & Manifest Cleanup
**Files:**
- Modify: `manifest.json`
- Modify: `background.js`
- Test: `tests/background-content-scripts.test.mjs`

**Interfaces:**
- Produces: `manifest.json` `commands` entry for `_execute_action` with suggested shortcut `Alt+L` (Mac: `Alt+L`).
- Produces: Deletion of dead code in `background.js` (unreachable duplicate `OPEN_OPTIONS_PAGE` switch cases).

- [x] **Step 1: Write test in `tests/background-content-scripts.test.mjs` verifying commands declaration**
- [x] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/background-content-scripts.test.mjs`
Expected: FAIL.

- [x] **Step 3: Add commands in `manifest.json` and cleanup dead code in `background.js`**
In `manifest.json`:
```json
"commands": {
  "_execute_action": {
    "suggested_key": {
      "default": "Alt+L",
      "mac": "Alt+L"
    },
    "description": "Toggle Lumeo in YouTube player"
  }
}
```
In `background.js`: Remove redundant secondary `OPEN_OPTIONS_PAGE` case.

- [x] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/background-content-scripts.test.mjs`
Expected: PASS.

- [x] **Step 5: Commit**
```bash
git add manifest.json background.js tests/background-content-scripts.test.mjs
git commit -m "feat: add Alt+L shortcut command and cleanup background handlers"
```

---

### Task 4: Premium Obsidian Cinema Redesign of `options.html`
**Files:**
- Modify: `options.html`
- Modify: `options.css`
- Modify: `options.js`

**Interfaces:**
- Produces: 16:9 Cinema preview mock stage reusing `.lumeo-video-sub` CSS classes directly.
- Produces: Additional subtitle controls:
  - Subtitle Order select (`Translation on top` / `Original on top`).
  - Subtitle Shadow style select (`Cinematic drop shadow`, `Contrast outline`, `Dark solid box`).
  - Background Opacity slider (`0%` to `100%`).
  - "Reset Dragged Position" button.
- Produces: Keyboard shortcut reference card pointing users to `chrome://extensions/shortcuts`.

- [x] **Step 1: Update `options.html` markup**
- Add Subtitle Order, Shadow Style, Background Opacity, and Reset Position controls.
- Add Keyboard Shortcuts informational card with `Alt+L` badge.
- Re-architect `#previewStage` to use a 16:9 ratio player with mock video visuals and identical `.lumeo-video-sub` layout.

- [x] **Step 2: Update `options.css` with Obsidian Cinema design tokens**
- Add cohesive color tokens: `--bg-base: #090a0f`, `--bg-card: #121520`, `--line-subtle: rgba(255,255,255,0.08)`, `--accent-orange: #f97316`.
- Style 16:9 mock player with cinema gradient and active subtitle styling classes.
- Ensure all `<select>` and `<option>` elements remain high contrast WCAG AAA compliant.

- [x] **Step 3: Update `options.js` controllers**
- Bind inputs for `subtitleOrder`, `subBackgroundOpacity`, `subShadowStyle`.
- Implement Reset Position button clearing `lumeoSubPosition` from storage and updating preview.
- Ensure `updatePreview()` dynamically updates font size, offset, opacity, shadow classes, and order.

- [x] **Step 4: Run syntax check and Vitest suite**
Run: `npm run check:all && npx vitest run`
Expected: All 31 files pass syntax checks, all 145 tests pass.

- [x] **Step 5: Visual verification with Playwright**
- Run test script capturing full page screenshots of `options.html` in default and adjusted states.

- [x] **Step 6: Commit**
```bash
git add options.html options.css options.js
git commit -m "feat(options): redesign options page into obsidian cinema dashboard with 16:9 preview"
```

---

### Task 5: End-to-End Visual Verification & Polish
**Files:**
- Test: `tests/test_native_dock_playwright.py`

- [x] **Step 1: Execute Playwright verification**
Verify popover positioning, font stepper, live sync, and dark theme contrast.
- [x] **Step 2: Save evidence screenshots to artifacts**
- [x] **Step 3: Commit final polish and documentation updates**
```bash
git add .
git commit -m "chore: complete full UI/UX overhaul and native popover implementation"
```

