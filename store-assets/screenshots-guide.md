# Lumeo — Screenshot capture guide

Web Store needs **5 screenshots** at **1280×800** OR **640×400** (PNG, no alpha). Use the bigger size — Web Store auto-resizes; bigger looks crisper on the listing.

Tool: macOS `Cmd+Shift+4` then drag a 1280×800 region. Or use CleanShot / Kap (mac) / ShareX (Windows) and pick a custom size. Output to `store-assets/screenshots/01-popup-idle.png`, `02-panel-caption.png`, etc.

> **P5 status.** Screenshot capture is manual and currently blocked until a clean local Chrome run confirms the final UI states. Do not mark the roadmap screenshot task complete until all 5 PNGs exist and match current behavior.

## The 5 screenshots

### 01 — Popup idle, ready to start
- Open any YouTube video in the background (e.g., a TED talk thumbnail visible).
- Click the Lumeo icon. Popup is in `idle` state, key already saved.
- Capture popup + a strip of the YouTube video behind it for context.
- Sells: clean UI, "saved" badge, three-tier dropdown visible (Caption / Standard / Realtime), Start button highlighted.

### 02 — Caption tier in action (HERO shot)
- Free Caption tier, target Vietnamese, original English audio.
- Pick a TED talk or Apple keynote where the captions are clean.
- Capture the bilingual subtitle overlay + the side panel listing scrolling lines, both populated and aligned to the current video time.
- This is the money shot for the free tier — proves the value prop without any API key.

### 03 — Realtime dub translating live
- Switch to Realtime tier, target Vietnamese, voice Marin.
- Wait until the panel's main area shows ~2 lines of Vietnamese text and the status pill says "Translating".
- Capture full browser at 1280×800 with the panel + a healthy slice of the YouTube player visible.
- Make sure the dub text is meaningful and looks like a real translation, not a half-formed phrase.

### 04 — Standard tier with source captions on
- Switch to Standard tier, voice Captivating Female, language Vietnamese, toggle "Show source captions" ON.
- Start. Wait until both the source caption (English) and the dub (Vietnamese) are populated.
- Capture the panel showing both — proves the side-by-side mode works.

### 05 — Subtitle style editor + SRT export
- Open the Caption tier with style editor visible (font, size, color, background, stroke).
- Show the export-ZIP button or the menu so the SRT export feature is discoverable.

## Composition tips
- YouTube player on the left, Lumeo panel on the right — natural English reading flow.
- Target the same video in all 5 shots so the listing feels coherent. Suggestion: a recent Apple keynote or a TED talk (English narrator, clear speech, recognizable thumbnail).
- Keep the YouTube UI clean — pause the video at a non-distracting frame, hide the YT controls (mouse-out for 3s), close any popups.
- After capture, run through `pngcrush` or just leave as-is — Web Store doesn't care about file size as long as <16 MB each.

---

## Promo tile (separate field)

Web Store wants a **440×280 PNG** "Small promo tile" used in search results.

Base source included: `store-assets/promo-tile-440x280.svg`. Export that SVG to PNG at 440×280 before Web Store submission.
