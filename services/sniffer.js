(() => {
  'use strict';

  const PATCH_FLAG = '__ytTransSnifferPatchedV2__';
  if (window[PATCH_FLAG]) {
    if (typeof window.__ytTransSnifferRepublish === 'function') {
      window.__ytTransSnifferRepublish();
    }
    return;
  }

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
        { source: SOURCE, type, ...payload },
        TARGET_ORIGIN,
      );
    } catch {
      // postMessage can throw on cross-origin frames; safe to drop.
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

  let lastSummaryKey = '';

  const publishCaptionTracks = () => {
    try {
      const renderer =
        window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer;
      const tracks = renderer?.captionTracks;
      if (Array.isArray(tracks) && tracks.length > 0) {
        const summary = tracks.map((track) => ({
          languageCode: track.languageCode,
          name: track.name?.simpleText || track.name?.runs?.[0]?.text || '',
          kind: track.kind || '',
        }));
        const summaryKey = JSON.stringify(summary);
        if (summaryKey !== lastSummaryKey) {
          lastSummaryKey = summaryKey;
          postSnifferMessage('caption-tracks', { tracks, summary });
        }
        return true;
      }
      postSnifferMessage('caption-tracks-empty', {
        hasRenderer: !!renderer,
        hasPlayerResponse: !!window.ytInitialPlayerResponse,
      });
      return false;
    } catch {
      return false;
    }
  };

  // Stagger republishes: ytInitialPlayerResponse can be hydrated late on slow
  // networks or after SPA navigation. Hammering early then backing off catches
  // both fast and slow loads without spamming postMessage.
  const PUBLISH_DELAYS = [0, 200, 500, 1000, 2000, 4000, 8000];
  let activeTimers = [];

  const schedulePublishes = () => {
    activeTimers.forEach(clearTimeout);
    lastSummaryKey = '';
    activeTimers = PUBLISH_DELAYS.map((delay) =>
      setTimeout(publishCaptionTracks, delay),
    );
  };

  Object.defineProperty(window, '__ytTransSnifferRepublish', {
    value: schedulePublishes,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  schedulePublishes();

  window.addEventListener('yt-navigate-finish', () => {
    setTimeout(schedulePublishes, 50);
  });

  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      schedulePublishes();
    }
  }, 750);
})();
