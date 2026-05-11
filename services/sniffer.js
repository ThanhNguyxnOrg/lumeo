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
  const postCaptionBody = (url, text, status = 200, source = 'fetch') => {
    if (!isTimedtextUrl(url)) return;
    postSnifferMessage('caption-body', {
      url,
      text: String(text || ''),
      status,
      source,
    });
  };

  if (typeof originalFetch === 'function') {
    window.fetch = function patchedFetch(...args) {
      const requestUrl = extractUrl(args[0]);
      if (isTimedtextUrl(requestUrl)) {
        postSnifferMessage('subtitle-url', { url: requestUrl });
      }
      const promise = originalFetch.apply(this, args);
      if (isTimedtextUrl(requestUrl)) {
        promise
          .then((response) => {
            try {
              response.clone().text()
                .then((text) => postCaptionBody(requestUrl, text, response.status, 'fetch'))
                .catch(() => {});
            } catch {
              // Some opaque/body-used responses cannot be cloned; XHR hook may still catch them.
            }
          })
          .catch(() => {});
      }
      return promise;
    };
  }

  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function patchedXhrOpen(method, url, ...rest) {
    this.__lumeoTimedTextUrl = typeof url === 'string' || url instanceof URL ? String(url) : '';
    if (isTimedtextUrl(url)) {
      postSnifferMessage('subtitle-url', { url });
    }
    return originalXhrOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function patchedXhrSend(...args) {
    const url = this.__lumeoTimedTextUrl || '';
    if (isTimedtextUrl(url)) {
      this.addEventListener('load', () => {
        try {
          postCaptionBody(url, this.responseText || '', this.status, 'xhr');
        } catch {
          // Ignore unreadable response bodies.
        }
      });
    }
    return originalXhrSend.apply(this, args);
  };

  const fetchCaptionInPage = async (id, url) => {
    try {
      if (!isTimedtextUrl(url)) {
        postSnifferMessage('caption-fetch-response', {
          id,
          ok: false,
          status: 0,
          error: 'Rejected non-timedtext URL',
        });
        return;
      }
      const response = await originalFetch.call(window, url, {
        credentials: 'include',
        cache: 'no-store',
      });
      const text = await response.text();
      postSnifferMessage('caption-fetch-response', {
        id,
        ok: response.ok,
        status: response.status,
        text,
      });
    } catch (error) {
      postSnifferMessage('caption-fetch-response', {
        id,
        ok: false,
        status: 0,
        error: error?.message || String(error),
      });
    }
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== TARGET_ORIGIN) return;
    const data = event.data;
    if (!data || data.source !== SOURCE || data.type !== 'caption-fetch-request') return;
    if (!data.id || typeof data.url !== 'string') return;
    void fetchCaptionInPage(String(data.id), data.url);
  });

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
