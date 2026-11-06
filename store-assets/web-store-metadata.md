# Lumeo — store submission metadata (Chrome Web Store + Microsoft Edge)

> **Status:** v2.0.8 copy. Privacy policy is live at <https://thanhnguyxnorg.github.io/lumeo/privacy.html>.
> Lengths checked against current limits: long description 16,000; short description 132; **Edge/Chrome manifest
> description 132**. The same name, short description, and long description are used on the Microsoft Edge Partner
> Center listing. The manifest `name`/`description` are `__MSG_` placeholders resolved from
> `_locales/en/messages.json`; that file is also what makes Edge Partner Center detect the listing language.

---

## Name (50 char max)

```
Lumeo — Captions & AI Dub for YouTube
```

## Short description (132 char max)

```
Bilingual captions and live AI dubbing for YouTube: free caption translation, Standard dub (~5s), Realtime dub (<1s).
```

(117 characters — also the `manifest.json` description. The previous 134-character variant exceeded the 132 limit.)

## Category

- Chrome Web Store: `Productivity` (primary) or `Accessibility`.
- Microsoft Edge: pick the closest option in the dropdown — `Entertainment` (YouTube/video discovery) or
  `Productivity` (tool discovery).
- Firefox AMO: `Photos, Music & Videos` (already set in `amo-metadata.json`).

## Language

`English (United States)` — UI is English. Vietnamese localization can be added later as a localized listing.

## Long description (16,000 char max — using ~1,800)

```
Lumeo is the all-in-one YouTube translation extension. Three tiers, you pick what fits the moment.

Why Lumeo is different
• Free Caption tier — translate YouTube's existing subtitles into 100+ languages with bilingual on-screen lines, a clickable side panel that scrolls with the video, and optional text-to-speech. No account, no API key required.
• Standard Dub tier — when a video has no usable captions, capture the audio, run Whisper → Gemini → MiniMax through Kyma, and play a ~5-second-lag dub in 13 target languages over the original. Roughly $0.25 per 10 minutes on your own Kyma balance.
• Realtime Dub tier — sub-second lag, peer-to-peer WebRTC to OpenAI Realtime via a Kyma-minted ephemeral token. Optionally clones the speaker's voice. Roughly $0.46 per 10 minutes.

Pick a tier per video. Start free. Pay only when you want voice dubbing.

Captions tier in detail
• 100+ target languages via Google Translate (free) or your own Gemini / OpenRouter / Groq / OpenAI / Google Cloud / LibreTranslate key for higher quality or model choice.
• Bilingual subtitle overlay with full style control — font, size, color, background, stroke, opacity.
• Side panel listing every line in the video; click any line to seek the player to that moment.
• Optional TTS playback on each translated line: speech synthesis (free, browser-native voices) or Google Cloud Chirp3-HD voices (your key).
• Soniox STT fallback when a video has no captions and you want a free, no-Kyma alternative.
• Native bilingual mode: when YouTube already publishes a translation track in your target language, Lumeo uses that directly — zero translation cost.
• SRT + ZIP export of every translated transcript.

Standard and Realtime dub
• 13 target languages: English, Vietnamese, Japanese, Korean, Chinese, French, Spanish, German, Portuguese, Hindi, Indonesian, Italian, Russian.
• Independent volume sliders for the original audio and the dub. Voice amplification up to 2× via Web Audio.
• In-page panel you can drag, resize, and hide. Layout persists per-tab.
• Translation history scrolling.
• Pause/play YouTube and the dub follows instantly. No reconnect.
• 60-minute hard auto-stop with a 5-minute warning.
• Sessions end cleanly when the tab closes — no surprise charges.

Privacy
• No account, no telemetry, no analytics, no Lumeo-operated server.
• Any API key you save (Kyma, Gemini, OpenRouter, Groq, Hugging Face, OpenAI, Google Cloud, LibreTranslate, Soniox) stays on your device in `chrome.storage.local`, which page scripts cannot read. Content scripts read only non-secret preferences; only the key for the provider selected for the running session is sent to that YouTube tab, and other stored keys stay in the extension background.
• Audio and subtitle text are sent only to the provider you pick to produce the requested translation. Provider retention follows that provider's terms.

Get a Kyma key (only needed for Standard + Realtime tiers): kymaapi.com — free starter credit on signup; pay-as-you-go after that.
```

## Single purpose statement (mandatory)

```
Lumeo translates the captions or audio of the YouTube video on the active tab into a language the user picks, and presents the translation as on-screen bilingual subtitles, optional spoken TTS, or a live AI voice-over depending on the tier the user selects. That is its sole purpose.
```

## Permission justifications (each ≤ 1,000 char; reviewers read these closely)

### `activeTab`
```
Used so that when the user clicks the Lumeo toolbar icon and presses Start, the extension can run a content script on the YouTube tab they are looking at. We do not act on tabs the user has not explicitly invoked us on.
```

### `scripting`
```
Used by the background service worker to inject the content script into a YouTube tab that already existed before the extension was installed or reloaded. Without this, Start would only work after a tab refresh. We inject only into tabs whose URL is on youtube.com (verified before injection) and only after the user clicks Start.
```

### `storage`
```
Used to remember the user's settings (tier, target language, voice, volume, subtitle style) and any optional API keys (Kyma, Gemini, OpenRouter, Groq, Hugging Face, OpenAI, Google Cloud, LibreTranslate, Soniox) across sessions. Keys are stored locally in `chrome.storage.local`, which page scripts cannot read. The YouTube tab receives only the key required by the provider selected for that session. We do not store any video, audio, transcript, or browsing history.
```

### `host_permissions: https://*.youtube.com/*` and `https://youtube.com/*`
```
Required to read existing YouTube subtitle tracks (Caption tier) and to capture audio of the video the user is watching via HTMLMediaElement.captureStream() (Standard + Realtime tiers), and to render the translation overlay panel on the page. We never modify YouTube content, never read user account data, and never make requests to YouTube's API.
```

### `host_permissions: https://api.kymaapi.com/*`
```
Required by the Standard and Realtime tiers to send audio to the Kyma API gateway for transcription, translation, and text-to-speech. The user's Kyma API key authenticates each request. Kyma is the user's own paid account; the extension does not proxy through any Lumeo-operated server.
```

### `host_permissions: https://api.openai.com/*`
```
Required only when the user picks the Realtime dub tier (peer-to-peer WebRTC after Kyma mints an ephemeral token, so audio is processed end-to-end with sub-second latency) or the OpenAI Chat Completions translate option in the Caption tier (when the user supplies their own OpenAI key). The Kyma key is never sent to OpenAI; only the ephemeral token or the user's OpenAI key is.
```

### `host_permissions: https://generativelanguage.googleapis.com/*`
```
Caption tier — used only when the user supplies their own Gemini API key and explicitly picks Gemini as the translation provider.
```

### `host_permissions: https://openrouter.ai/*`
```
Caption tier — used only when the user supplies their own OpenRouter key and picks OpenRouter as the translation provider, including OpenRouter's free model router when available.
```

### `host_permissions: https://api.groq.com/*`
```
Caption tier — used only when the user supplies their own Groq key and picks Groq translation or STT options.
```

### `host_permissions: https://api-inference.huggingface.co/*` and `https://huggingface.co/*`
```
Caption tier — reserved for the advanced Hugging Face Inference Providers option. It is used only when the user supplies a Hugging Face token and explicitly selects that provider.
```

### `host_permissions: https://translate.googleapis.com/*`
```
Caption tier — used as the default free translation provider for translating YouTube subtitle text into the user's chosen target language. No authentication required; the public endpoint is what Google Translate's web UI itself uses.
```

### `host_permissions: https://translation.googleapis.com/*`
```
Caption tier — used only when the user supplies their own Google Cloud Translation API key and explicitly picks the Google Cloud option for higher quality and rate limits.
```

### `host_permissions: https://texttospeech.googleapis.com/*`
```
Caption tier — used only when the user supplies their own Google Cloud Text-to-Speech API key and picks the Google Cloud TTS option for premium Chirp3-HD voices on each translated subtitle line.
```

### `host_permissions: https://stt-rt.soniox.com/*`
```
Caption tier — used only when the user supplies their own Soniox API key as a fallback for videos that have no usable captions. With the user's permission, Lumeo captures shared tab audio via getDisplayMedia and streams 16 kHz PCM samples to Soniox's real-time STT WebSocket for transcription.
```

### `host_permissions: https://libretranslate.com/*`, `http://localhost/*`, and `http://127.0.0.1/*`
```
Caption tier — used only when the user chooses LibreTranslate. The user can use the managed LibreTranslate endpoint or a self-hosted local endpoint such as localhost:5000.
```

## Microsoft Edge notes

- The Edge Partner Center form asks for **one combined host-permission justification** (≤1000 characters), not one
  per host. Ready text:

```
Lumeo reads the captions or audio of the YouTube video the user chooses to translate and sends that text or audio only to the translation provider the user selects. youtube.com access is required to read subtitle tracks, capture the video tab audio through HTMLMediaElement.captureStream(), and draw the translation overlay. Provider hosts (Kyma, OpenAI, Google Gemini/Translate/Cloud TTS, OpenRouter, Groq, Hugging Face, Soniox, LibreTranslate) are contacted only when the user picks that provider and supplies their own API key; each request is authenticated with the user key and is never proxied through a Lumeo server. localhost and 127.0.0.1 are used only when the user runs a self-hosted LibreTranslate instance. No host is accessed unless the user presses Start.
```

- **"Are you using remote code?" → No.** Justification: "No. All JavaScript, the AudioWorklet processor, and every
  asset are packaged inside the extension. Lumeo does not load scripts, modules, or WebAssembly from remote servers
  and does not use eval() or similar dynamic code execution."
- Required listing logo: `store-assets/edge-store-logo-300x300.png`. Screenshots and promo tiles are optional.
- The first Edge listing must be published manually in Partner Center; later releases update through the API.

## Data usage disclosures (Web Store form checkboxes)

When the form asks "Does this extension collect or use any user data?":

- ✅ Yes (because audio/text is processed by third-party providers under the user's account)

When asked "What types of user data?":

- Personally identifiable information → **NO**
- Health information → **NO**
- Financial and payment information → **NO**
- Authentication information → **YES** (the user's Kyma / Gemini / OpenRouter / Groq / Hugging Face / OpenAI / Google Cloud / LibreTranslate / Soniox API keys, stored locally, sent only to the corresponding provider)
- Personal communications → **NO**
- Location → **NO**
- Web history → **NO**
- User activity → **NO** (Lumeo does not log clicks, scroll, mouse, keystrokes, or network activity)
- Website content → **YES** (the caption text or audio of the video the user chose to translate is sent to the selected AI provider for translation, then discarded)

The same categories are used in the Microsoft Edge Partner Center data-usage form.

When asked "How is the data used?":

- ✅ Authenticating the user (the API keys)
- ✅ Providing the core feature of the extension (the translation)

Required certifications:

- ✅ I do not sell or transfer user data to third parties, outside the approved use cases.
- ✅ I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- ✅ I do not use or transfer user data to determine creditworthiness or for lending purposes.

## Privacy policy URL

Live: `https://thanhnguyxnorg.github.io/lumeo/privacy.html`

GitHub Pages serves `docs/` from `main` (Settings → Pages → Deploy from a branch → `main` / `docs`). Update
`docs/privacy.html`, push, and Pages redeploys automatically. The same URL goes into the Chrome Web Store and
Microsoft Edge Partner Center forms.

## Audit references

- `store-assets/audits/permission-audit.md`
- `store-assets/audits/source-asset-audit.md`
- `store-assets/packaging-checklist.md`

## Test instructions for reviewer (under "Account" tab in the form)

```
Lumeo has three tiers. The Caption tier requires no account and works out of the box on any YouTube video with captions; please test that first:

1. Install the unpacked extension and pin the Lumeo icon.
2. Open any English YouTube video that has captions (e.g., a TED talk).
3. Click the Lumeo icon, leave tier on "Caption · Free", target language Vietnamese, press Start.
4. Within ~3 seconds the bilingual subtitle overlay and the side panel should populate.

For the Standard / Realtime dub tiers, a Kyma API key is required:

5. Sign up for a free account at https://kymaapi.com (free starter credit included).
6. Copy the API key from the dashboard, paste into the Lumeo popup.
7. Switch tier to "Realtime", press Start. Within ~2 seconds the dub should begin.

If you'd prefer a pre-loaded test key, please open an issue at the project's GitHub repo and we'll provide one for the duration of the review.
```

## Visibility

`Public` (after approval). Submit for review when all fields are green and final screenshots are captured per `screenshots-guide.md`.
