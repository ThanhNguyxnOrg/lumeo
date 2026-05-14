# Cross-browser scope and smoke checklist

## Target decision

Firefox support is **future/unsupported** until API validation proves the core flows. Current product target remains Chrome MV3.

Planned Firefox order:

1. Caption tier only: translated YouTube captions, overlay, cache import/export.
2. Standard tier after audio capture behavior is validated.
3. Realtime tier last; depends on extension audio capture, long-lived networking, and provider auth behavior.

No Firefox manifest conversion is planned in P8. Work is limited to a small compatibility seam plus docs so future ports do not rewrite product code blindly.

## Compatibility seam

`lib/browser-api.js` exposes `globalThis.LumeoBrowserApi`:

- `sendRuntimeMessage(message)`
- `sendTabMessage(tabId, message)`
- `queryTabs(queryInfo)`
- `getManifest()`
- `getURL(path)`
- `addRuntimeMessageListener(listener)`
- `setStorageAccessLevel(accessLevel)`
- `callbackToPromise(call, api)`

Current migration is intentionally narrow: popup active-tab/runtime calls, content runtime message wiring, and background tab/runtime relay/storage-access setup. Other `chrome.*` calls stay direct until touched by a tested change.

## Chrome-only / Chrome-sensitive APIs

- MV3 background service worker: Chrome lifetime/cold-start behavior remains the baseline. Firefox MV3 service worker parity must be re-tested before support claims.
- `chrome.scripting.executeScript` / `chrome.scripting.insertCSS`: used by `background.js` to inject content modules/CSS after install or refresh. Firefox injection timing and permissions need validation.
- `chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })`: Chrome-only hardening. Wrapper no-ops when unavailable.
- Manifest content script `world: "MAIN"`: used for `services/sniffer.js`. Firefox support/semantics need validation.
- Video `captureStream()`: content-page API used for Standard/Realtime audio. Browser availability, autoplay, CORS, and YouTube player behavior need smoke testing.
- Offscreen documents / Document Picture-in-Picture: not required by current manifest, but any future tabCapture/offscreen/docPiP work is Chrome-sensitive and must be separately documented/tested.
- `tabCapture`: not currently declared in `manifest.json`; future use is Chrome-sensitive.

## Manual smoke checklist

### Chrome stable baseline

1. Load unpacked extension in Chrome stable.
2. Open YouTube watch page with captions.
3. Open popup; confirm build badge renders.
4. Start Caption tier; confirm overlay appears.
5. Confirm translated caption updates with video time.
6. Toggle source caption display.
7. Export caption bundle; import it back.
8. Clear caption cache.
9. Stop; reload page; start again.
10. Open a no-caption video; verify fallback UX/provider prompts.
11. Start Standard tier with Kyma key; verify audio capture and stop.
12. Start Realtime tier with Kyma key; verify bridge and stop.
13. Inspect extension service worker console for errors.
14. Inspect page console for errors.

### Chrome MV3 injection/cold-start

1. Load extension, open YouTube, wait 2 minutes.
2. Stop service worker from `chrome://extensions` if available.
3. Open popup and start Caption tier.
4. Confirm `background.js` reinjects content modules without page refresh.
5. Confirm duplicate overlay roots are not left behind.

### Firefox future validation gate

Blocked until a Firefox manifest/prototype exists.

1. Validate manifest format/permissions.
2. Validate `browser.*` promise APIs through `LumeoBrowserApi`.
3. Validate content script injection timing and MAIN-world sniffer behavior.
4. Validate YouTube caption tier end-to-end.
5. Validate `captureStream()` for Standard/Realtime before enabling those tiers.
6. Record unsupported APIs and remove any UI claims before release.
