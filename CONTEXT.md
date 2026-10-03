# Lumeo Domain Context & Architecture Specification

## 1. Domain Glossary & Ubiquitous Language

- **Lumeo Extension**: A lightweight browser extension providing real-time YouTube video companion features: AI translation, live dubbing, and interactive bilingual subtitles.
- **Native Control Dock (`ytButton` & `ytMenu`)**: The control surface injected directly into YouTube's native bottom bar (`.ytp-right-controls`), styled identically to YouTube's native controls (`CC`, `Settings`). Clicking toggles active translation and reveals a clean, YouTube-style quick menu for target language, dubbing voice, and display modes.
- **Cinematic Subtitle Overlay (`.lumeo-video-sub`)**: An on-video subtitle layer rendering sharp, high-contrast typography without bulky enclosing window frames.
- **Draggable Subtitle Positioning**: Interactive dragging allowing users to reposition the subtitle anywhere within the video player bounds. Coordinates are tracked and persisted as normalized percentages (`x%`, `y%`) relative to `#movie_player` to maintain exact relative placement across window resizing and fullscreen transitions.
- **Native Caption Suppression**: A non-destructive CSS rule (`opacity: 0 !important; pointer-events: none !important;`) applied to YouTube's native caption container (`.ytp-caption-window-container`) when Lumeo is active, completely eliminating double/overlapping subtitle artifacts while preserving DOM caption availability for background translation polling.
- **Word Lookup Guard**: A pointer gesture discriminator that distinguishes between dragging (pointer down + move > 4px) and clicking (< 4px displacement) so dragging never accidentally triggers word definition or AI context popovers.
- **Options Management Dashboard (`options.html`)**: The full-page settings surface for user API keys (Kyma, OpenAI, Gemini, Groq), model selection, voice testing, and cache management.
- **Bi-directional Live Synchronization**: Real-time broadcast mechanism using `chrome.storage.onChanged` bridging the Options dashboard and YouTube player content scripts so styling, layout, and volume modifications take effect immediately without page reload.
- **WYSIWYG Live Preview**: Interactive mock video stage on the Options dashboard dynamically reflecting exact font size, offset percentages, high-contrast borders, and bilingual/single layouts.

## 2. Settled Architectural Decisions

1. **100% International English**: All extension UI elements, labels, tooltips, and settings are rendered in English.
2. **Zero Extension-Icon Popup**: `default_popup` is disabled in `manifest.json`. Clicking the Chrome toolbar icon toggles the on-player Lumeo dock or opens `options.html`.
3. **No Bulky Floating HUD Box**: The obsolete draggable window frame (`.ec-root`) is superseded by the Native Control Dock and Draggable Subtitle Overlay.
4. **Clean Restoral on Deactivation**: When Lumeo is deactivated or paused, native YouTube captions immediately restore full visibility (`opacity: 1`).
5. **Uniform Brand Identity**: Standardized usage of official Lumeo icon assets (`icons/icon-48.png` / `icons/icon-128.png`) across dashboard navigation, favicon, and in-player headers, eliminating generic placeholders.
6. **Dark Scheme Accessibility (WCAG AAA)**: Explicit `color-scheme: dark;` applied to `:root` alongside customized `#12151f` surfaces for form inputs, native selects, and options, eliminating browser light-menu glitches.
7. **Options Navigation via Service Worker Only**: Content scripts cannot call `chrome.runtime.openOptionsPage()` and `options.html` is not web-accessible, so `window.open(getURL("options.html"))` is blocked. The in-player Settings button sends `{ type: "OPEN_OPTIONS_PAGE" }` to `background.js`, which calls `openOptionsPage()`. No fallback paths.
8. **Decoupled Presentation & Session Lifecycles**: The native YouTube control button (`.ytp-lumeo-button`), DOM mutation observer, and popover container are permanent for the tab lifecycle. Session termination or subtitle clearing must NEVER destroy the YouTube button or disconnect the observer.
9. **Explicit Translation Control (No Auto-Start)**: Opening the popover via `.ytp-lumeo-button` must never automatically fire translation. Translation is initiated solely via an explicit "▶ Start Translation" action inside the popover or dedicated global shortcut. Dismissing the popover never halts active subtitle rendering.
10. **Strictly Anchored Native Popover (Zero Popover Dragging)**: The settings popover (`.ytp-lumeo-popover`) is strictly anchored within `#movie_player` vertically above `.ytp-lumeo-button`. It cannot be freely dragged across the screen or stranded off-screen into sidebars. Only the subtitles (`.lumeo-video-sub`) support dragging.
11. **Native YouTube Toolbar Alignment**: `.ytp-lumeo-button` adheres to YouTube's native button layout with `display: inline-flex; align-items: center; justify-content: center; vertical-align: middle;`, removing `vertical-align: top` and standardizing the SVG at 36x36px to align on the exact vertical centerline with `[CC]` and `⚙`.
12. **Hierarchical Drill-Down Submenus (Matching & Exceeding YouTube Native)**: The popover mirrors YouTube's native settings architecture with drill-down submenus (font size, background opacity, character edge style, display mode, subtitle order) and eliminates redundant footer links.


