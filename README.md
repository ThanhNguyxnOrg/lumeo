# YouTube Translate & Speak Extension

Chrome extension to translate YouTube subtitles into 90+ languages with bilingual display and text-to-speech support.

## Features

- Detect subtitle tracks directly from YouTube player requests
- Translate subtitle text via Google/OpenAI APIs
- Bilingual subtitle rendering
- Text-to-speech playback support
- Works on `youtube.com/watch` pages

## Project Structure

- `manifest.json` — Chrome Extension Manifest V3 config
- `content.js` — content script injected on YouTube pages
- `sniffer.js` — page-level subtitle request/caption track interceptor
- `background.js` — service worker (fetch proxy + Soniox websocket bridge)
- `popup.html`, `popup.js` — popup UI and settings logic
- `subtitle.css` — subtitle overlay styles
- `audio-processor.js` — audio handling utilities
- `icon16.png`, `icon48.png`, `icon128.png` — extension icons

## Setup (Local)

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this project folder

## Required Permissions

Defined in `manifest.json`:

- `storage`, `activeTab`, `scripting`
- Host permissions for YouTube and translation/TTS APIs

## Notes

- Subtitle extraction relies on current YouTube internal player response/request patterns, which may change over time.
- If subtitle sniffing breaks, inspect `sniffer.js` and related message handling in `content.js`.
