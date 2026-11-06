# Lumeo — Screenshot capture guide

Every store accepts **1280×800**; use that size everywhere.

| Store | Screenshots | Notes |
|---|---|---|
| Chrome Web Store | 1–5 required | 1280×800 preferred, 640×400 accepted |
| Microsoft Edge | Optional, max 6 | Must be exactly 640×480 or 1280×800 |
| Firefox AMO | Optional | 1280×800 recommended (1.6:1) |

Use the bigger size — stores auto-resize; bigger looks crisper on the listing.

Tool: macOS `Cmd+Shift+4` then drag a 1280×800 region. Or use CleanShot / Kap (mac) / ShareX (Windows) and pick a custom size. Output to `store-assets/screenshots/01-popup-idle.png`, `02-panel-caption.png`, etc.

> **Status:** capture still pending — no PNGs exist yet. Chrome requires at least one screenshot; Edge and AMO can be submitted without them and updated later.

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

## Promo tiles and logo (already prepared)

- `edge-store-logo-300x300.png` — Microsoft Edge **required** listing logo (1:1, min 128×128).
- `promo-tile-440x280.png` — Edge/Chrome small promo tile (optional). Exported from `promo-tile-440x280.svg`; re-export both if the artwork changes.
- `amo-icon-64x64.png` + `icons/icon-32.png` — optional AMO listing icon.
- Large Edge tile 1400×560 — optional, not created yet.
