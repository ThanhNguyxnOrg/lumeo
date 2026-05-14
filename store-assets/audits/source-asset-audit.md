# P5 source and asset audit

Status: repo audit ready, packaging run still manual/blocked until release zip is created.
Date: 2026-05-12

## Bundled source

Current extension source is plain JavaScript, CSS, HTML, JSON, PNG icons, and docs. No minified vendor bundle was found in the tracked extension tree during this audit.

Expected runtime files:

- `manifest.json`
- `background.js`, `content.js`, `popup.js`, `popup.html`, `popup.css`, `content.css`
- `lib/*.js`
- `services/*.js`
- `pipelines/*.js`
- `ui/*.js`
- `icons/icon-16.png`, `icons/icon-48.png`, `icons/icon-128.png`

## Assets

| Path | Status | Notes |
|---|---|---|
| `icons/icon-16.png` | Keep | Manifest icon. |
| `icons/icon-48.png` | Keep | Manifest icon. |
| `icons/icon-128.png` | Keep | Manifest and README icon. |
| `store-assets/screenshots/.gitkeep` | Keep | Placeholder only. No generated screenshots committed. |
| `docs/privacy.html` | Keep | Public privacy page copy for static hosting. |
| `store-assets/privacy-policy.html` | Keep | Store asset copy of privacy page. |
| `store-assets/web-store-metadata.md` | Keep | Store form draft copy and reviewer notes. |
| `store-assets/screenshots-guide.md` | Keep | Manual screenshot plan. |

## Exclusions confirmed

- `node_modules/` ignored.
- `coverage/` ignored.
- `output/` ignored, including Playwright profiles and screenshots.
- `*.zip` ignored, except `store-assets/*.zip` by current `.gitignore` rule.
- No generated profile files found by `**/*profile*` glob.
- No committed screenshot PNGs found under `store-assets/screenshots/`, only `.gitkeep`.

## Review flags

1. `store-assets/*.zip` is currently allowed by `.gitignore`. Before committing a release zip, inspect its contents and size. Don't include dev/test/generated files.
2. Roadmap references `output/research` and `closed-ext/*` as research sources only. Those paths are ignored or absent from the tracked extension tree.
3. If packaging automation is added later, it should allowlist runtime files rather than zipping the whole repo.

## Suggested package contents check

Run after creating a release zip:

```powershell
Expand-Archive -LiteralPath "store-assets/lumeo-2.0.0.zip" -DestinationPath "$env:TEMP\lumeo-package-check" -Force
Get-ChildItem -Recurse -File "$env:TEMP\lumeo-package-check" | ForEach-Object { $_.FullName.Replace("$env:TEMP\lumeo-package-check\", "") }
```

Expected: runtime files above plus optional docs/store assets. Not expected: `node_modules`, `coverage`, `.git`, `output`, browser profiles, screenshots unless intentionally packaged for store assets outside extension zip.
