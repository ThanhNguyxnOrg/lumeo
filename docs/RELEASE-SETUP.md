# Release setup — accounts, secrets, and automation

Lumeo uses a $0 release path: Firefox AMO is the primary public store, Edge is the free Chromium store, Opera and
Naver Whale are manual, and Chrome/Brave users install the GitHub Release ZIP (the Chrome Web Store requires a
one-time fee).

## What the release workflow already does

Push a `v*` tag (or run the `Release` workflow manually with a tag). `.github/workflows/release.yml`:

1. validates the version and changelog,
2. runs tests, syntax checks, and manifest checks,
3. builds `dist/lumeo-v<version>-{chrome,edge,firefox,opera}.zip` + `SHA256SUMS.txt`,
4. submits Firefox to AMO when the AMO secrets exist,
5. updates Microsoft Edge when the Edge secrets exist,
6. publishes all ZIPs to GitHub Releases.

No store secrets are required for the GitHub Release itself.

## Org-level secrets

The workflow reads `secrets.*`, so **organization secrets work as-is** — create them at the org level and grant this
repository access in the org secret settings. Repository-level secrets with the same names would also work; org-level
is the better choice if several repos will reuse them.

| Secret | Used by | Required for |
|---|---|---|
| `WEB_EXT_API_KEY` | Firefox AMO | listed/unlisted submission |
| `WEB_EXT_API_SECRET` | Firefox AMO | listed/unlisted submission |
| `EDGE_PRODUCT_ID` | Microsoft Edge | update after the first manual listing |
| `EDGE_API_KEY` | Microsoft Edge | Edge API v1.1 authentication |
| `EDGE_CLIENT_ID` | Microsoft Edge | Edge API v1.1 authentication |
| `BOT_APP_ID` | GitHub release | GitHub App token for publishing the release |
| `BOT_PRIVATE_KEY` | GitHub release | GitHub App token for publishing the release |

Optional repository/organization variable: `GECKO_ID` (default `lumeo@thanhnguyxn.org`). Do not change it after the
first AMO submission.

## Firefox AMO (listed) — automated

Registration: free AMO account, no fee.

1. Create an account at <https://addons.mozilla.org/>.
2. Generate API credentials at <https://addons.mozilla.org/developers/addon/api/key/>.
3. Add repository secrets:
   - `WEB_EXT_API_KEY`
   - `WEB_EXT_API_SECRET`
4. Optional repository variable: `GECKO_ID` (defaults to `lumeo@thanhnguyxn.org`; changing it makes a different
   add-on identity, so only set it before the first submission).
5. The first submission uses `store-assets/amo-metadata.json` (summary, category, MIT license). Later tags only
   upload the new version.
6. AMO hosts the signed XPI and distributes updates automatically. No extra step is needed for users.

If the secrets are absent, the workflow prints a notice and skips the AMO step.

## Microsoft Edge Add-ons — first upload manual, updates automated

Registration: free Partner Center account. Microsoft documents "There is no registration fee".

1. Register at <https://partner.microsoft.com/dashboard/microsoftedge/public/login?ref=dd> and publish the first
   version manually (metadata, screenshots, privacy page). Initial publication and metadata changes are not
   available through the API.
2. Copy the **Product ID** from the extension overview page.
3. On the Partner Center **Publish API** page, enable the v1.1 experience and click **Create API credentials**.
4. Add repository secrets:
   - `EDGE_PRODUCT_ID`
   - `EDGE_API_KEY`
   - `EDGE_CLIENT_ID`
5. Subsequent tags upload `dist/lumeo-v<version>-edge.zip` to the draft submission, publish it, and poll the
   operation status. If any secret is missing, the step is skipped with a notice.

API reference: <https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/using-addons-api>

## Opera Add-ons — manual

Registration: free Opera developer account.

- Upload `dist/lumeo-v<version>-opera.zip` manually after each release.
- Opera has no confirmed publishing API and reviews are manual.
- Review their acceptance criteria: one clear purpose, no minified code, no unused files, and no sending private
  data to an external store.

## Naver Whale Store — manual

Registration: free Naver ID.

- Upload `dist/lumeo-v<version>-opera.zip` (Chromium ZIP; verify the current accepted archive format on the store).
- Listing needs a 128×128 icon and 1280×800 screenshots; review has no published SLA.

## Chrome / Brave / Vivaldi / other Chromium users — sideload

Chrome Web Store charging a one-time fee means these users install from GitHub Releases:

1. Download `lumeo-v<version>-chrome.zip` from the latest release.
2. `chrome://extensions` → Developer mode → **Load unpacked** → unzipped folder.

Auto-update outside the Chrome Web Store is only available to Linux users or through enterprise policy. Firefox
self-distribution can use `browser_specific_settings.gecko.update_url` with an HTTPS JSON manifest if we ever want
off-AMO updates.

## Self-hosted files (optional)

- GitHub Releases already serves the XPI with `application/x-xpinstall`, so Firefox can install it from the release
  asset.
- Cloudflare Pages free is a good secondary host for XPI/CRX (supports a `_headers` file for content types).
- Netlify free is now credit-limited (~300 credits/month), so it is not recommended for release assets.

## Checklist before tagging

- [ ] `npm run check:all`, `npm test`, `npm run check:versions`, `npm run check:manifest`
- [ ] `npm run build:targets`
- [ ] `npx web-ext lint --source-dir dist/firefox` reports no errors/warnings
- [ ] CHANGELOG has a `## [<version>]` section and the README badge matches
- [ ] AMO and Edge secrets are configured if those steps should run
