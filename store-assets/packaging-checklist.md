# Release packaging checklist

Status: automated by `scripts/build-targets.mjs` and `.github/workflows/release.yml`.

## Preflight

1. Confirm the version is consistent everywhere:
   ```bash
   npm run check:versions
   ```
2. Confirm every file referenced by `manifest.json` exists:
   ```bash
   npm run check:manifest
   ```
3. Confirm the AMO first-submission metadata is valid:
   ```bash
   node -e "const m=JSON.parse(require('fs').readFileSync('store-assets/amo-metadata.json','utf8')); if(!m.summary?.['en-US']||!m.categories?.length||!m.version?.license) throw new Error('bad AMO metadata');"
   ```
4. Confirm hosted privacy policy URL and screenshots are current:
   - `01-popup-idle.png`
   - `02-panel-caption.png`
   - `03-realtime-dub.png`
   - `04-standard-tier.png`
   - `05-style-export.png`

## Required local checks

```bash
npm run check:all
npm test
npm run build:targets
```

## Build output

`npm run build:targets` writes four deterministic ZIPs plus checksums to `dist/`:

- `lumeo-v<version>-chrome.zip` (Chrome / Brave sideload)
- `lumeo-v<version>-edge.zip` (Edge Add-ons, manual upload)
- `lumeo-v<version>-firefox.zip` (AMO submission source, automated when secrets exist)
- `lumeo-v<version>-opera.zip` (Opera Add-ons, manual upload)
- `SHA256SUMS.txt`
- `build-metadata.json`

The builder packages only tracked runtime files. `.env*`, `tests/`, `docs/`, `scripts/`, `store-assets/`, `node_modules/`, local logs, and generated browser profiles are never included.

## Automation

Push a version tag (`v<version>`) or run the `Release` workflow manually with a tag. The workflow validates versions, runs tests and manifest checks, builds every target, verifies packaged manifest versions, submits Firefox to AMO when `WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET` exist, and publishes all ZIPs to GitHub Releases.

## Manual blocks

- Edge Add-ons upload and certification.
- Opera Add-ons upload and review.
- Chrome Web Store / Brave store listing (requires the paid Chrome Web Store developer registration).
- AMO listing review is manual on Mozilla's side; the submission itself is automated.
