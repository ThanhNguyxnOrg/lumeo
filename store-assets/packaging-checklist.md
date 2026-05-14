# P5 packaging checklist

Status: ready for release candidate. Packaging execution is manual until a final zip path/version is chosen.
Date: 2026-05-12

## Preflight

1. Confirm `manifest.json` version and `README.md` badge match the planned release.
2. Confirm privacy policy URL is hosted and reachable.
3. Confirm `store-assets/web-store-metadata.md` copy matches current behavior.
4. Confirm manual screenshots exist outside the extension zip:
   - `01-popup-idle.png`
   - `02-panel-caption.png`
   - `03-realtime-dub.png`
   - `04-standard-tier.png`
   - `05-style-export.png`

## Required local checks

```powershell
npm run check:all
npm test
```

## Package allowlist

Include:

- `manifest.json`
- `background.js`
- `content.js`
- `content.css`
- `popup.html`
- `popup.js`
- `popup.css`
- `lib/`
- `services/`
- `pipelines/`
- `ui/`
- `icons/`

Optional, if desired for reviewer context:

- `docs/privacy.html`
- `README.md`
- `SECURITY.md`

Exclude:

- `.git/`, `.github/`
- `.sisyphus/`, `.playwright-mcp/`
- `node_modules/`
- `coverage/`
- `output/`
- `tests/`
- generated browser profiles
- generated screenshots
- local logs
- `.env*`

## Windows package command

Use PowerShell from repo root:

```powershell
$dest = "store-assets/lumeo-2.0.0.zip"
Remove-Item -LiteralPath $dest -ErrorAction SilentlyContinue
Compress-Archive -LiteralPath @(
  "manifest.json",
  "background.js",
  "content.js",
  "content.css",
  "popup.html",
  "popup.js",
  "popup.css",
  "lib",
  "services",
  "pipelines",
  "ui",
  "icons"
) -DestinationPath $dest
```

## Shell package command

Use Git Bash or WSL from repo root:

```bash
zip -r store-assets/lumeo-2.0.0.zip \
  manifest.json background.js content.js content.css popup.html popup.js popup.css \
  lib services pipelines ui icons
```

## Post-package audit

```powershell
$tmp = Join-Path $env:TEMP "lumeo-package-check"
Remove-Item -Recurse -Force -LiteralPath $tmp -ErrorAction SilentlyContinue
Expand-Archive -LiteralPath "store-assets/lumeo-2.0.0.zip" -DestinationPath $tmp -Force
Get-ChildItem -Recurse -File $tmp | ForEach-Object { $_.FullName.Replace($tmp, "") } | Sort-Object
```

Verify no excluded paths appear.

## Manual blocks

- Chrome Web Store upload is manual.
- Store form approval is manual.
- Clean Chrome profile test is manual unless a safe local profile script is added later.
