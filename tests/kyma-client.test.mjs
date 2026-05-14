import { describe, it, expect, beforeEach, vi } from "vitest";
import { createSandboxWindow, loadService } from "./helpers/load-service.mjs";

async function setup() {
  const { window } = await createSandboxWindow();
  loadService("services/kyma-client.js", window);
  return { window, api: window.LumeoKyma };
}

describe("services/kyma-client.js", () => {
  let window;
  let api;

  beforeEach(async () => {
    ({ window, api } = await setup());
  });

  it("normalizes known Kyma error codes", () => {
    expect(api.parseError(402, JSON.stringify({ error: { code: "insufficient_balance", cta_url: "https://pay" } })))
      .toEqual({ user: "Out of Kyma balance.", cta: "https://pay", ctaLabel: "Top up" });
    expect(api.parseError(409, JSON.stringify({ error: { code: "too_many_sessions" } })).user)
      .toBe("Kyma session limit reached. Stop another Lumeo session, then retry.");
    expect(api.parseError(502, JSON.stringify({ error: { code: "upstream_error" } })).user)
      .toBe("Kyma provider is temporarily unavailable. Retry in a minute.");
    expect(api.parseError(429, JSON.stringify({ error: { code: "rate_limited" } })).user)
      .toBe("Kyma rate limit reached. Wait 30 seconds, then retry.");
  });

  it("falls back to provider messages and raw response text", () => {
    expect(api.parseError(400, JSON.stringify({ error: { message: "bad payload" } })).user)
      .toBe("Kyma 400: bad payload. Check your Kyma key/session, then retry.");
    expect(api.parseError(500, "bad gateway").user)
      .toBe("Kyma 500: bad gateway. Check your Kyma key/session, then retry.");
  });

  it("posts JSON with bearer auth and returns parsed JSON", async () => {
    window.fetch = vi.fn(async (url, init) => ({
      ok: true,
      async json() {
        return { ok: true, url, init };
      },
    }));

    const result = await api.post("/test", "kyma-key", { json: { hello: "world" } });

    expect(window.fetch).toHaveBeenCalledWith("https://api.kymaapi.com/v1/test", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer kyma-key",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ hello: "world" }),
    }));
    expect(result.ok).toBe(true);
  });

  it("returns raw responses without parsing JSON", async () => {
    const response = { ok: true, json: vi.fn() };
    window.fetch = vi.fn(async () => response);

    await expect(api.post("/raw", "kyma-key", { raw: true })).resolves.toBe(response);
    expect(response.json).not.toHaveBeenCalled();
  });

  it("passes raw body, custom headers, keepalive, and signal without JSON content type", async () => {
    const signal = new AbortController().signal;
    window.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));

    await api.post("/body", "kyma-key", {
      body: "abc",
      headers: { "X-Test": "1" },
      keepalive: true,
      signal,
    });

    expect(window.fetch).toHaveBeenCalledWith("https://api.kymaapi.com/v1/body", expect.objectContaining({
      method: "POST",
      headers: {
        Authorization: "Bearer kyma-key",
        "X-Test": "1",
      },
      body: "abc",
      keepalive: true,
      signal,
    }));
  });

  it("throws decorated errors on non-ok responses", async () => {
    window.fetch = vi.fn(async () => ({
      ok: false,
      status: 402,
      async text() {
        return JSON.stringify({ error: { code: "insufficient_balance", cta_url: "https://billing" } });
      },
    }));

    await expect(api.post("/test", "kyma-key")).rejects.toMatchObject({
      message: "Out of Kyma balance.",
      cta: "https://billing",
      ctaLabel: "Top up",
      status: 402,
    });
  });

  it("heartbeat and endSession call session endpoints and swallow failures", async () => {
    window.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));

    await api.heartbeat("sess", "kyma-key");
    await api.endSession("sess", "kyma-key");

    expect(window.fetch).toHaveBeenNthCalledWith(
      1,
      "https://api.kymaapi.com/v1/realtime/translations/sessions/sess/heartbeat",
      expect.objectContaining({ method: "POST", headers: { Authorization: "Bearer kyma-key" } }),
    );
    expect(window.fetch).toHaveBeenNthCalledWith(
      2,
      "https://api.kymaapi.com/v1/realtime/translations/sessions/sess/end",
      expect.objectContaining({ method: "POST", keepalive: true }),
    );

    window.fetch = vi.fn(async () => { throw new Error("network"); });
    await expect(api.heartbeat("", "kyma-key")).resolves.toBeUndefined();
    await expect(api.endSession("sess", "")).resolves.toBeUndefined();
    await expect(api.endSession("sess", "kyma-key")).resolves.toBeUndefined();
  });
});
