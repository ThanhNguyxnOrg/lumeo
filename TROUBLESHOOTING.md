# Lumeo Troubleshooting

## Developer Mode Reload

After changing code locally:

1. Open `chrome://extensions`.
2. Click the reload icon on the Lumeo extension card.
3. Reload the YouTube tab.
4. Open Lumeo again.

Reason: YouTube tabs that were open before the extension reload can keep an older content script until the tab is refreshed.

## Popup Shows Only a Thin Slice

This usually means Chrome is still showing an older popup document or the popup is stuck after an extension reload.

Fix:

1. Close the popup.
2. Reload the extension card.
3. Reopen the popup.

The popup is designed at `420x540` for developer mode so it should fit without clipping.

## Caption Dependencies Not Loaded

If the popup or overlay says:

```text
Caption dependencies not loaded: ...
```

Reload the extension card and the YouTube tab. The background service worker also attempts to inject missing dependencies automatically, but a tab reload is the cleanest reset.

## "Download this video" Overlay on YouTube

That overlay is not part of Lumeo. It is likely injected by another browser extension. Disable other YouTube/video helper extensions when testing Lumeo UI.

## Caption Tier Finds No Subtitles

Use Standard Dub when the video has no captions. Caption Free works best when YouTube has published a caption track for the video.

## Debugging Console

For service worker errors:

1. Open `chrome://extensions`.
2. Find Lumeo.
3. Click `service worker`.
4. Copy the red console error.

For YouTube content script errors:

1. Open DevTools on the YouTube tab.
2. Check the Console tab.
3. Filter by `Lumeo`, `content.js`, or extension errors.
