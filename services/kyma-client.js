(() => {
  "use strict";

  if (window.LumeoKyma?.__loaded) return;

  const KYMA_BASE = "https://api.kymaapi.com/v1";

  function parseError(status, errText) {
    try {
      const parsed = JSON.parse(errText);
      const err = parsed.error || {};
      if (err.code === "insufficient_balance") {
        return {
          user: "Out of Kyma balance.",
          cta: err.cta_url || "https://kymaapi.com/billing",
          ctaLabel: "Top up",
        };
      }
      if (err.code === "too_many_sessions") {
        return { user: "Kyma session limit reached. Stop another Lumeo session, then retry." };
      }
      if (err.code === "upstream_error") {
        return { user: "Kyma provider is temporarily unavailable. Retry in a minute." };
      }
      if (err.code === "rate_limited") {
        return { user: "Kyma rate limit reached. Wait 30 seconds, then retry." };
      }
      if (err.message) return { user: `Kyma ${status}: ${err.message}. Check your Kyma key/session, then retry.` };
    } catch {
      // Fall through to raw text.
    }
    return { user: `Kyma ${status}: ${(errText || "").slice(0, 160)}. Check your Kyma key/session, then retry.` };
  }

  async function post(path, kymaKey, options = {}) {
    const response = await fetch(`${KYMA_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${kymaKey}`,
        ...(options.json ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
      body: options.json ? JSON.stringify(options.json) : options.body,
      keepalive: !!options.keepalive,
      signal: options.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const parsed = parseError(response.status, text);
      const error = new Error(parsed.user);
      error.cta = parsed.cta;
      error.ctaLabel = parsed.ctaLabel;
      error.status = response.status;
      throw error;
    }
    return options.raw ? response : response.json().catch(() => ({}));
  }

  function heartbeat(sessionId, kymaKey) {
    if (!sessionId || !kymaKey) return Promise.resolve();
    return post(`/realtime/translations/sessions/${sessionId}/heartbeat`, kymaKey)
      .catch(() => {});
  }

  function endSession(sessionId, kymaKey) {
    if (!sessionId || !kymaKey) return Promise.resolve();
    return post(`/realtime/translations/sessions/${sessionId}/end`, kymaKey, { keepalive: true })
      .catch(() => {});
  }

  window.LumeoKyma = {
    __loaded: true,
    KYMA_BASE,
    parseError,
    post,
    heartbeat,
    endSession,
  };
})();
