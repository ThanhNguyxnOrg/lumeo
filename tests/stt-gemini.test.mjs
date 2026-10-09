import { describe, it, expect, beforeEach, vi } from "vitest";
import { createSandboxWindow, loadService } from "./helpers/load-service.mjs";

async function setup() {
  const { window } = await createSandboxWindow();
  loadService("services/stt-gemini.js", window);
  return { window, api: window.LumeoGeminiSTT };
}

describe("services/stt-gemini.js", () => {
  let window;
  let api;

  beforeEach(async () => {
    ({ window, api } = await setup());
  });

  it("builds a Gemini transcription request with audio inlineData and parses response", async () => {
    window.fetch = vi.fn(async (url, init) => {
      expect(url).toContain("generativelanguage.googleapis.com");
      expect(url).toContain("key=AIza-gemini-key");
      const body = JSON.parse(init.body);
      expect(body.contents[0].parts[0].inlineData.mimeType).toBe("audio/wav");
      expect(body.contents[0].parts[1].text).toContain("Transcribe");
      return {
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: "  Hello world from Gemini audio transcript!  " }],
              },
            },
          ],
        }),
      };
    });

    const result = await api.transcribeBlob(new window.Blob(["fake-wav-content"]), {
      apiKey: "AIza-gemini-key",
      model: "gemini-2.5-flash-lite",
      language: "en",
    });

    expect(window.fetch).toHaveBeenCalledTimes(1);
    expect(result.text).toBe("Hello world from Gemini audio transcript!");
  });

  it("throws clear error on Gemini API failure", async () => {
    window.fetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: "API key expired" } }),
    }));

    await expect(
      api.transcribeBlob(new window.Blob(["fake-wav-content"]), { apiKey: "bad-key" })
    ).rejects.toThrow("API key expired");
  });

  it("throws when apiKey is missing", async () => {
    await expect(
      api.transcribeBlob(new window.Blob(["fake-wav-content"]), { apiKey: "" })
    ).rejects.toThrow("Gemini API key is missing.");
  });
});
