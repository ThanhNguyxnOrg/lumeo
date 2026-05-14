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
});
