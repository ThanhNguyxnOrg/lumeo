import { describe, it, expect, beforeEach, vi } from "vitest";
import { createSandboxWindow, loadService } from "./helpers/load-service.mjs";

// Minimal Response stub matching the subset of the Fetch API that
// services/translate.js uses (ok, status, json()). Avoids relying on jsdom's
// Response implementation, which is partial in some Node versions.
function fakeResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
  };
}

async function setup() {
  const { window } = await createSandboxWindow();
  loadService("services/translate.js", window);
  return { window, api: window.LumeoTranslate };
}

describe("services/translate.js", () => {
  let window;
  let api;

  beforeEach(async () => {
    ({ window, api } = await setup());
  });

  it("exposes a normalized provider list", () => {
    expect(api.PROVIDERS.GOOGLE_FREE).toBe("google-free");
    expect(api.PROVIDERS.GEMINI).toBe("gemini");
    expect(api.labelFor("gemini")).toBe("Gemini");
  });

  it("calls Google Free with client=gtx and returns the joined translation", async () => {
    window.fetch = vi.fn(async (url) => {
      expect(url).toContain("client=gtx");
      expect(url).toContain("tl=vi");
      return fakeResponse([[["xin chào", "hello", null, null, 10]]]);
    });
    const out = await api.translateBatch(["hello"], "vi", { provider: "google-free" });
    expect(out).toEqual(["xin chào"]);
  });

  it("calls Gemini generateContent with the API key in the URL", async () => {
    window.fetch = vi.fn(async (url, init) => {
      expect(url).toContain("generativelanguage.googleapis.com");
      expect(url).toContain("key=AIzaFAKE");
      const body = JSON.parse(init.body);
      expect(body.contents[0].parts[0].text).toMatch(/\[0] hello/);
      return fakeResponse({
        candidates: [
          { content: { parts: [{ text: "[0] xin chào\n[1] thế giới" }] } },
        ],
      });
    });
    const out = await api.translateBatch(["hello", "world"], "vi", {
      provider: "gemini",
      geminiKey: "AIzaFAKE",
    });
    expect(out).toEqual(["xin chào", "thế giới"]);
  });

  it("calls OpenRouter with referer and title headers", async () => {
    window.fetch = vi.fn(async (url, init) => {
      expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
      expect(init.headers.Authorization).toBe("Bearer sk-or-xyz");
      expect(init.headers["HTTP-Referer"]).toContain("github.com");
      expect(init.headers["X-Title"]).toBe("Lumeo");
      return fakeResponse({ choices: [{ message: { content: "[0] hi" } }] });
    });
    const out = await api.translateBatch(["hello"], "vi", {
      provider: "openrouter",
      openRouterKey: "sk-or-xyz",
    });
    expect(out).toEqual(["hi"]);
  });

  it("calls LibreTranslate against the configured URL", async () => {
    window.fetch = vi.fn(async (url) => {
      expect(url).toBe("https://libretranslate.example.com/translate");
      return fakeResponse({ translatedText: "xin chào" });
    });
    const out = await api.translateBatch(["hello"], "vi", {
      provider: "libretranslate",
      libreTranslateUrl: "https://libretranslate.example.com",
    });
    expect(out).toEqual(["xin chào"]);
  });

  it("rejects when the API key is missing for a BYOK provider", async () => {
    await expect(
      api.translateBatch(["hello"], "vi", { provider: "gemini" }),
    ).rejects.toThrow(/Gemini API key/);
  });

  it("propagates AbortError when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      api.translateBatch(["a", "b"], "vi", {
        provider: "google-free",
        signal: controller.signal,
      }),
    ).rejects.toThrow(/Aborted/);
  });

  it("falls back to Google Free for an unknown provider id", async () => {
    window.fetch = vi.fn(async () =>
      fakeResponse([[["ok", "ok", null, null, 10]]]),
    );
    const out = await api.translateBatch(["ok"], "vi", { provider: "does-not-exist" });
    expect(out).toEqual(["ok"]);
    expect(window.fetch).toHaveBeenCalled();
  });

  it("calls Custom AI Gateway with custom base URL, model, and API key", async () => {
    window.fetch = vi.fn(async (url, init) => {
      expect(url).toBe("https://my-proxy.internal/v1/chat/completions");
      expect(init.headers.Authorization).toBe("Bearer custom-key-456");
      const body = JSON.parse(init.body);
      expect(body.model).toBe("custom-model-x");
      return fakeResponse({ choices: [{ message: { content: "[0] xin chào" } }] });
    });
    const out = await api.translateBatch(["hello"], "vi", {
      provider: "custom-gateway",
      customProxyApiKey: "custom-key-456",
      customProxyBaseUrl: "https://my-proxy.internal/v1",
      customProxyModelId: "custom-model-x",
    });
    expect(out).toEqual(["xin chào"]);
  });

  it("supports local Custom AI Gateway without API key and neutral model default", async () => {
    window.fetch = vi.fn(async (url, init) => {
      expect(url).toBe("http://localhost:11434/v1/chat/completions");
      expect(init.headers.Authorization).toBeUndefined();
      const body = JSON.parse(init.body);
      expect(body.model).toBe("custom-model");
      return fakeResponse({ choices: [{ message: { content: "[0] xin chào" } }] });
    });
    const out = await api.translateBatch(["hello"], "vi", {
      provider: "custom-gateway",
      customProxyBaseUrl: "http://localhost:11434/v1",
    });
    expect(out).toEqual(["xin chào"]);
  });

  it("retries rate-limited cues then falls back to source text per item", async () => {
    let calls = 0;
    window.fetch = vi.fn(async () => {
      calls += 1;
      return fakeResponse({ error: "HTTP 429" }, { status: 429 });
    });
    const onItemDone = vi.fn();
    const onPartialFailure = vi.fn();
    const out = await api.translateBatch(["hello", "world"], "vi", {
      provider: "google-free",
      retryDelayBaseMs: 20,
      onItemDone,
      onPartialFailure,
    });
    // One bad cue must not kill the batch: source text stands in.
    expect(out).toEqual(["hello", "world"]);
    expect(calls).toBe(6);
    expect(onItemDone).toHaveBeenLastCalledWith(2, 2);
    expect(onPartialFailure).toHaveBeenCalledTimes(1);
    const partial = onPartialFailure.mock.calls[0][0];
    expect(partial.failed).toBe(2);
    expect(partial.total).toBe(2);
    expect([...partial.indexes].sort()).toEqual([0, 1]);
  }, 15000);

  it("succeeds on retry after a transient 429", async () => {
    let calls = 0;
    window.fetch = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return fakeResponse({ error: "HTTP 429" }, { status: 429 });
      return fakeResponse([[["xin chào", "hello", null, null, 10]]]);
    });
    const out = await api.translateBatch(["hello"], "vi", { provider: "google-free", retryDelayBaseMs: 20 });
    expect(out).toEqual(["xin chào"]);
    expect(calls).toBe(2);
  }, 15000);

  it("offsets progress across internal groups and reports partials once", async () => {
    window.fetch = vi.fn(async () => fakeResponse([[["x", "y", null, null, 10]]]));
    const seen = [];
    const partials = [];
    const out = await api.translateBatch(["a", "b", "c", "d", "e"], "vi", {
      provider: "google-free",
      batchSize: 2,
      onItemDone: (done, total) => seen.push([done, total]),
      onPartialFailure: (info) => partials.push(info),
    });
    expect(out).toHaveLength(5);
    expect(seen[seen.length - 1]).toEqual([5, 5]);
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i][0]).toBeGreaterThanOrEqual(seen[i - 1][0]);
    }
    expect(partials).toEqual([]);
  });

  it("aborts promptly when stopped during backoff", async () => {
    // Deterministic: abort synchronously inside the first fetch so no
    // wall-clock race decides whether the abort lands mid-backoff. (A 50ms
    // setTimeout race flaked on loaded CI runners.)
    const controller = new AbortController();
    window.fetch = vi.fn(async () => {
      controller.abort();
      return fakeResponse({ error: "HTTP 429" }, { status: 429 });
    });
    const promise = api.translateBatch(["hello"], "vi", { provider: "google-free", signal: controller.signal, retryDelayBaseMs: 200 });
    await expect(promise).rejects.toThrow(/Aborted/);
    expect(window.fetch).toHaveBeenCalledTimes(1);
  }, 10000);

  it("bounds hung requests instead of parking a worker for the 30s default", async () => {
    window.fetch = vi.fn((url, init) => new Promise((_, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const started = Date.now();
    const out = await api.translateBatch(["hello"], "vi", { provider: "google-free", translateTimeoutMs: 60, retryDelayBaseMs: 20 });
    expect(out).toEqual(["hello"]);
    expect(Date.now() - started).toBeLessThan(8000);
  }, 15000);
});
