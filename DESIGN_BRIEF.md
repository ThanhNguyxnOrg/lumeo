# Lumeo Design Brief

This replaces the inherited Echoly visual direction. The old orange glass panel is functional but not the final product look.

## Product Positioning

Lumeo is a YouTube companion for:

- bilingual subtitle reading
- AI translation
- live dubbing
- transcript export

The UI should feel like a premium media tool, not a generic browser popup.

## Design Direction

Recommended style: **cinematic command center**

- Dark-first interface with a soft "studio light" gradient.
- High contrast text; no low-contrast gray-on-glass.
- Calm premium palette: ink, graphite, moon white, electric violet, cyan, and warm amber only for live/recording emphasis.
- Rounded but not bubbly: 14-20px radius.
- Use SVG icons only. No emoji icons in UI controls.
- Motion is subtle: opacity/transform only, 150-240ms, respect `prefers-reduced-motion`.
- Accessibility first:
  - visible focus rings
  - 44px minimum click targets
  - 4.5:1 contrast for normal text
  - no color-only status indicators

## Core Surfaces

### Browser Popup

Target dimensions:

- width: 400-430px
- min height: 560px
- max height: 640px

Sections:

1. Header
   - Lumeo wordmark
   - small status pill: Idle / Connecting / Live / Paused / Error
   - compact latency/cost hint when tier is Standard or Realtime

2. Tier switcher
   - three large segmented cards:
     - Caption Free
     - Standard Dub
     - Realtime Dub
   - each card has latency, cost, and "best for" microcopy

3. Primary settings
   - target language
   - provider/model
   - voice (tier-aware)
   - source captions toggle

4. Keys drawer
   - collapsed by default
   - key status badges only, never show raw key unless the field is focused
   - fields:
     - Kyma
     - Gemini
     - OpenRouter
     - Groq
     - OpenAI
     - Google Cloud
     - Soniox
     - LibreTranslate URL + optional key

5. Mix controls
   - original volume
   - dub voice volume
   - subtitle size if Caption tier

6. Main CTA
   - Start / Stop
   - fixed at bottom of popup so it is always reachable

### In-Page Overlay

The overlay is a draggable, resizable panel on top of YouTube.

Modes:

1. Caption mode
   - large bilingual subtitle line
   - source line smaller, target line primary
   - right side panel list of timed transcript rows
   - active row highlighted
   - export button in toolbar

2. Standard / Realtime mode
   - main translated text
   - source caption/transcript if enabled
   - compact history stream
   - volume/mute controls
   - latency and tier badge

Behavior:

- Persist panel position/size per user.
- Clamp to viewport.
- Must not block YouTube controls unless the user places it there.
- Small mode when width < 520px.
- Wide mode when width > 760px.

## Suggested Visual System

Palette:

- Background: `#070A12`
- Surface: `#0E1422`
- Raised surface: `#151C2E`
- Border: `rgba(255,255,255,0.10)`
- Text primary: `#F8FAFC`
- Text secondary: `#AAB4C8`
- Text muted: `#667085`
- Accent violet: `#8B5CF6`
- Accent cyan: `#22D3EE`
- Live green: `#22C55E`
- Warning amber: `#F59E0B`
- Error red: `#EF4444`

Typography:

- Product/UI: Inter, SF Pro Text, system-ui
- Wordmark/headings: Satoshi, Inter Display, or SF Pro Display
- Mono readouts: JetBrains Mono or SF Mono

Effects:

- subtle radial gradient behind header
- 1px border highlights
- no heavy blur on text-heavy panels
- shadows only for layering, not decoration

## Design Tool Prompt

Use this prompt in any design assistant or UI mockup tool. Export frames as PNG plus a share link, then send it back for implementation.

```text
Design a premium Chrome extension UI for "Lumeo", a YouTube companion that provides bilingual captions and live AI dubbing.

Brand:
- Name: Lumeo
- Tagline: Bilingual captions and live AI dubbing for YouTube
- Personality: cinematic, precise, premium, fast, trustworthy
- Avoid: generic SaaS dashboard, playful cartoon style, emoji icons, old orange glassmorphism

Style:
- Dark-first cinematic command center
- Background #070A12 with soft radial gradients
- Surfaces #0E1422 and #151C2E
- Accent violet #8B5CF6 and cyan #22D3EE
- Live state green #22C55E, warning #F59E0B, error #EF4444
- Typography: Inter or SF Pro for UI, Satoshi or Inter Display for headings, JetBrains Mono for small technical readouts
- Use clean SVG icons, no emoji
- Rounded 14-20px corners, subtle borders, high contrast

Create these frames:

1. Browser popup, idle state, 420x620
- Header with Lumeo wordmark and status pill "Ready"
- Three tier cards: Caption Free, Standard Dub, Realtime Dub
- Each tier shows latency, cost, and best-for microcopy
- Target language select
- Provider/model select
- Collapsed "API keys" drawer with status badges
- Original and voice volume controls
- Large sticky bottom CTA: Start

2. Browser popup, live Realtime state, 420x620
- Realtime tier selected
- Status pill "Live"
- Voice picker visible
- Kyma key badge saved
- Cost/latency microcopy visible
- Bottom CTA: Stop

3. In-page YouTube overlay, Caption mode, 720x360
- Draggable toolbar with Lumeo wordmark, tier badge "Caption Free", language picker, export button, close/minimize
- Main bilingual subtitle area: smaller source line above, larger translated line below
- Right transcript side panel with timed rows and active row highlighted
- Include a small style-control button

4. In-page YouTube overlay, Realtime mode, 640x300
- Toolbar with tier badge "Realtime"
- Main translated sentence
- Source caption toggle area
- History stream with 3 recent turns
- Volume mini controls
- Live pulse indicator

5. Key management drawer, 420x620
- API keys grouped by provider category:
  - Dubbing: Kyma
  - Translation: Gemini, OpenRouter, OpenAI, Google Cloud, LibreTranslate
  - STT: Groq, Soniox, Hugging Face
- Each provider row shows icon placeholder, short label, saved/missing badge, password field, help link
- Do not expose raw keys unless field is focused

Interaction notes:
- All click targets at least 44px
- Visible keyboard focus rings
- Light reduced-motion alternative
- No horizontal overflow at 375px width
- Avoid relying only on color for status

Deliver:
- Full component names and spacing tokens
- Color and typography tokens
- Hover, focus, disabled, loading, error states
- PNG previews and a share link
```

## Implementation Notes

When implementing the design:

- Keep vanilla JS/CSS, no build step unless the project explicitly adopts one later.
- Prefer CSS variables for tokens.
- Keep popup CSS and overlay CSS separate.
- Preserve accessibility states in CSS before adding visual polish.
- Match the approved design tokens exactly, then tune for Chrome extension constraints.
