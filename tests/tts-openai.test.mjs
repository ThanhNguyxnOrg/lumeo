import { describe, it, expect, beforeEach, vi } from "vitest";
import { createSandboxWindow, loadService } from "./helpers/load-service.mjs";

async function setup() {
  const { window } = await createSandboxWindow();
  loadService("services/tts-openai.js", window);
  return { window, api: window.LumeoOpenAITTS };
}

describe("services/tts-openai.js", () => {
  let window;
  let api;

  beforeEach(async () => {
    ({ window, api } = await setup());
    window.URL.createObjectURL = vi.fn(() => "blob:tts");
    window.URL.revokeObjectURL = vi.fn();
  });

  it("synthesizes OpenAI TTS audio and caches by voice, format, speed, and text", async () => {
    const blob = new window.Blob(["mp3"], { type: "audio/mpeg" });
    window.fetch = vi.fn(async () => ({ ok: true, blob: async () => blob }));

    const first = await api.synthesize(" hello ", {
      apiKey: "openai-key",
      model: "tts-1-hd",
      voice: "nova",
      format: "mp3",
      speed: 1.1,
    });
    const second = await api.synthesize("hello", {
      apiKey: "openai-key",
      model: "tts-1-hd",
      voice: "nova",
      format: "mp3",
      speed: 1.1,
    });

    expect(first).toBe("blob:tts");
    expect(second).toBe("blob:tts");
    expect(window.fetch).toHaveBeenCalledOnce();
    expect(window.fetch).toHaveBeenCalledWith(api.OPENAI_TTS_URL, expect.objectContaining({
      method: "POST",
      headers: {
        Authorization: "Bearer openai-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "tts-1-hd", voice: "nova", input: "hello", format: "mp3", speed: 1.1 }),
    }));
  });

  it("returns null for empty text and throws on missing keys", async () => {
    expect(await api.synthesize("   ", { apiKey: "openai-key" })).toBeNull();
    await expect(api.synthesize("hello", {})).rejects.toThrow("OpenAI API key is missing.");
  });

  it("surfaces OpenAI errors with status and truncated detail", async () => {
    window.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => "bad key",
    }));

    await expect(api.synthesize("hello", { apiKey: "bad" }))
      .rejects.toThrow("OpenAI TTS 401: bad key");
  });

  it("plays synthesized audio and stop pauses current playback", async () => {
    window.fetch = vi.fn(async () => ({ ok: true, blob: async () => new window.Blob(["mp3"]) }));
    const addEventListener = vi.fn();
    const pause = vi.fn();
    const play = vi.fn(async () => {});
    window.Audio = vi.fn(function Audio(url) {
      this.url = url;
      this.addEventListener = addEventListener;
      this.pause = pause;
      this.play = play;
    });
    const onEnd = vi.fn();

    await expect(api.speak("hello", "en", { apiKey: "openai-key", volume: 0.4, onEnd })).resolves.toBe(true);

    expect(window.Audio).toHaveBeenCalledWith("blob:tts");
    expect(addEventListener).toHaveBeenCalledWith("ended", onEnd, { once: true });
    expect(play).toHaveBeenCalledOnce();

    api.stop();
    expect(pause).toHaveBeenCalledOnce();
  });

  it("clearCache revokes cached blob URLs", async () => {
    window.fetch = vi.fn(async () => ({ ok: true, blob: async () => new window.Blob(["mp3"]) }));
    await api.synthesize("hello", { apiKey: "openai-key" });

    api.clearCache();

    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith("blob:tts");
  });
});
