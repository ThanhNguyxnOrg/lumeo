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

| Secret | Used by | Level | Required for |
|---|---|---|---|
| `AMO_API_KEY` | Firefox AMO | org (shared) | AMO account JWT issuer |
| `AMO_API_SECRET` | Firefox AMO | org (shared) | AMO account JWT secret |
| `EDGE_API_KEY` | Microsoft Edge | org (shared) | Partner Center account API key |
| `EDGE_CLIENT_ID` | Microsoft Edge | org (shared) | Partner Center account client ID |
| `EDGE_PRODUCT_ID` | Microsoft Edge | **repo** | unique product GUID per extension |
| `BOT_APP_ID` | GitHub release | org (shared) | GitHub App token |
| `BOT_PRIVATE_KEY` | GitHub release | org (shared) | GitHub App token |

The Firefox and Edge credentials are **account-wide**: one pair works for every extension published under the same
account, so they belong at the organization level. The Edge `Product ID` is per-extension, so keep that one in the
repository (or in a per-repo variable named `EDGE_PRODUCT_ID`).

Optional repository/organization variable: `GECKO_ID` (default `lumeo@thanhnguyxn.org`). Do not change it after the
first AMO submission.

**Do not set `GECKO_ID` as an organization-wide variable.** Each extension must have its own add-on identity; a shared
org variable would make a future extension reuse Lumeo's ID. Keep `GECKO_ID` as a repository variable for this repo
(or rely on the code default). The AMO API credentials are account-level and can be shared across add-ons, but the
add-on identity is per-extension.

## Firefox AMO (listed) — automated

Registration: free AMO account, no fee.

1. Create an account at <https://addons.mozilla.org/>.
2. Generate API credentials at <https://addons.mozilla.org/developers/addon/api/key/>. Copy the **JWT issuer** as
   `AMO_API_KEY` and the **JWT secret** as `AMO_API_SECRET`; the secret is shown only once.
3. Add organization secrets (shared by every Firefox extension under the same AMO account):
   - `AMO_API_KEY`
   - `AMO_API_SECRET`

   The workflow maps them to `WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET` for the `web-ext` CLI. The old
   `WEB_EXT_*` secret names still work as a fallback.
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
2. Copy the **Product ID** from the extension overview page. The Product ID already exists while the submission is
   in draft; keep that draft and use its GUID. Discarding and recreating the draft can change it.
3. On the Partner Center **Publish API** page, enable the v1.1 experience and click **Create API credentials**.
   Copy the **Client ID** and **API key** immediately: the key is shown only once and has an expiry date. Rotate it
   before that date and update the `EDGE_API_KEY` secret.
4. Add the Product ID as a repository **variable** `EDGE_PRODUCT_ID` (preferred), or as a repository secret with the
   same name. Add the account-wide credentials as organization secrets:
   - `EDGE_PRODUCT_ID` (repo variable or repo secret)
   - `EDGE_API_KEY` (org secret)
   - `EDGE_CLIENT_ID` (org secret)

   The workflow reads `vars.EDGE_PRODUCT_ID` first and falls back to `secrets.EDGE_PRODUCT_ID`.
5. Subsequent tags upload `dist/lumeo-v<version>-edge.zip` to the draft submission, publish it, and poll the
   operation status. If any secret is missing, the step is skipped with a notice.

API reference: <https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/using-addons-api>

### Example mapping

| GitHub secret | Example value | Where it comes from |
|---|---|---|
| `EDGE_CLIENT_ID` (org) | `ad56c2f2-fccf-49f5-a6c3-436aa6f9aebe` | Publish API page → Client ID |
| `EDGE_API_KEY` (org) | `fRD4…` (new key after rotation) | Publish API page → New API key |
| `EDGE_PRODUCT_ID` (repo) | `641ea3c7-9cfd-4bf1-a919-eee5d8f48c1e` | Extension overview → Product ID |

Account-wide values (`Client ID`, API keys) are shared by every Edge extension under the account. The `Product ID`
is unique per extension and stays stable for that extension.

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

## Troubleshooting store credentials

- **AMO `Upload failed: Unauthorized` / `Error decoding signature`:** the JWT issuer and secret do not match. Re-copy
  both from the AMO API credentials page. The issuer must look like `user:<id>:<id>`. The release workflow trims
  trailing CR/LF and spaces before signing, and logs only the credential lengths and the issuer shape.
- **Edge `curl: (3) URL rejected: Malformed input`:** usually a trailing newline or space in `EDGE_PRODUCT_ID`. The
  release workflow trims it and validates the GUID before calling the API.
- **Checking secret configuration:** GitHub never returns secret values through the REST API or MCP. Use
  `gh secret list --org <org>` and `gh secret list --repo <owner>/<repo>` to verify names, visibility, and update
  time; use the workflow logs to verify formatting and delivery. Repository secrets shadow organization secrets with
  the same name, so keep only one copy of each.
