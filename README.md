# Lumen Subtitle Studio

<p align="center">
  <img src="./icon128.png" alt="Lumen Subtitle Studio" width="96" height="96" />
</p>

<p align="center">
  <strong>Professional YouTube subtitle translation + speech extension for Chrome (Manifest V3).</strong>
</p>

<p align="center">
  <a href="https://github.com/ThanhNguyxn07/lumen-subtitle-studio/blob/main/LICENSE"><img src="https://img.shields.io/github/license/ThanhNguyxn07/lumen-subtitle-studio?style=for-the-badge" alt="License"></a>
  <a href="https://github.com/ThanhNguyxn07/lumen-subtitle-studio/stargazers"><img src="https://img.shields.io/github/stars/ThanhNguyxn07/lumen-subtitle-studio?style=for-the-badge" alt="Stars"></a>
  <a href="https://github.com/ThanhNguyxn07/lumen-subtitle-studio/network/members"><img src="https://img.shields.io/github/forks/ThanhNguyxn07/lumen-subtitle-studio?style=for-the-badge" alt="Forks"></a>
  <a href="https://github.com/ThanhNguyxn07/lumen-subtitle-studio/commits/main/"><img src="https://img.shields.io/github/last-commit/ThanhNguyxn07/lumen-subtitle-studio?style=for-the-badge" alt="Last Commit"></a>
  <img src="https://img.shields.io/badge/Chrome-MV3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Chrome MV3">
</p>

---

## ✨ Highlights

- 🌐 Translate YouTube subtitles into **90+ languages**
- 🈯 Show **bilingual subtitle lines** for learning and comprehension
- 🔊 Text-to-speech playback support
- ⚡ Fast subtitle track detection from active YouTube sessions
- 🧩 Built as a lightweight Chrome Extension (Manifest V3)

---

## 🧱 Architecture

```text
YouTube Page
   ├─ content.js          (inject + orchestration + subtitle flow)
   ├─ sniffer.js          (timedtext/caption track interception)
   └─ subtitle.css        (overlay styling)

Extension Runtime
   ├─ popup.html/js       (UI + user settings)
   ├─ background.js       (fetch proxy + websocket bridge)
   └─ audio-processor.js  (audio pipeline helper)
```

---

## 📁 Repository Structure

```text
.
├─ .github/
│  ├─ ISSUE_TEMPLATE/
│  ├─ workflows/
│  └─ PULL_REQUEST_TEMPLATE.md
├─ audio-processor.js
├─ background.js
├─ content.js
├─ icon16.png
├─ icon48.png
├─ icon128.png
├─ manifest.json
├─ popup.html
├─ popup.js
├─ sniffer.js
├─ subtitle.css
├─ CHANGELOG.md
├─ CODE_OF_CONDUCT.md
├─ CONTRIBUTING.md
├─ LICENSE
├─ README.md
└─ SECURITY.md
```

---

## 🚀 Quick Start (Local)

1. Clone repository:
   ```bash
   git clone https://github.com/ThanhNguyxn07/lumen-subtitle-studio.git
   cd lumen-subtitle-studio
   ```
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select this project folder

---

## ⚙️ Permissions & APIs

Defined in `manifest.json`:

- Extension permissions: `storage`, `activeTab`, `scripting`
- Host permissions:
  - `https://www.youtube.com/*`
  - `https://*.youtube.com/*`
  - Google translate/TTS endpoints
  - Optional OpenAI endpoint

> Do not hardcode personal API keys in source. Use user-side extension settings or secure secret management in your release process.

---

## 🛡️ Security Notes

- Message passing between page context and content script should validate source/origin and payload shape.
- Subtitle extraction relies on YouTube internals (`ytInitialPlayerResponse` / timedtext paths), which may change.
- Review [`SECURITY.md`](./SECURITY.md) before production distribution.

---

## 🗺️ Roadmap

- [ ] Store settings sync and profile presets
- [ ] Better subtitle fallback for videos without standard tracks
- [ ] Enhanced translation quality options
- [ ] Optional word-level timestamp UX
- [ ] CI checks for extension packaging sanity

---

## 🤝 Contributing

PRs are welcome. Please read:

- [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)
- [`SECURITY.md`](./SECURITY.md)

---

## 📜 License

This project is licensed under the **MIT License** — see [`LICENSE`](./LICENSE).
