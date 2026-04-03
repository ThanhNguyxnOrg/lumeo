(() => {
  'use strict';

  const PATCH_FLAG = '__ytTransSnifferPatched__';
  if (window[PATCH_FLAG]) return;

  Object.defineProperty(window, PATCH_FLAG, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  const SOURCE = 'yt-trans-sniffer';
  const TARGET_ORIGIN = window.location.origin;
  const TIMEDTEXT_RE = /\/api\/timedtext(?:\/|$|\?)/;

  const isTimedtextUrl = (value) =>
    typeof value === 'string' && TIMEDTEXT_RE.test(value);

  const postSnifferMessage = (type, payload) => {
    try {
      window.postMessage(
        {
          source: SOURCE,
          type,
          ...payload,
        },
        TARGET_ORIGIN,
      );
    } catch {
    }
  };

  const extractUrl = (input) => {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    return null;
  };

  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function patchedFetch(...args) {
      const requestUrl = extractUrl(args[0]);
      if (isTimedtextUrl(requestUrl)) {
        postSnifferMessage('subtitle-url', { url: requestUrl });
      }
      return originalFetch.apply(this, args);
    };
  }

  const originalXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function patchedXhrOpen(method, url, ...rest) {
    if (isTimedtextUrl(url)) {
      postSnifferMessage('subtitle-url', { url });
    }
    return originalXhrOpen.call(this, method, url, ...rest);
  };

  const publishCaptionTracks = () => {
    try {
      const tracks =
        window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer
          ?.captionTracks;
      if (Array.isArray(tracks) && tracks.length > 0) {
        postSnifferMessage('caption-tracks', { tracks });
      }
    } catch {
    }
  };

  publishCaptionTracks();
  setTimeout(publishCaptionTracks, 500);
})();
