import { describe, it, expect, beforeEach, vi } from "vitest";
import { createSandboxWindow, loadService } from "./helpers/load-service.mjs";

async function setup() {
  const { window } = await createSandboxWindow();
  window.speechSynthesis = {
    cancel: vi.fn(),
    speak: vi.fn(),
    getVoices: () => [{ name: "Test Voice", lang: "en-US" }],
  };
  window.SpeechSynthesisUtterance = function SpeechSynthesisUtterance(text) {
    this.text = text;
  };
  loadService("services/tts-browser.js", window);
  return { window, api: window.LumeoTTS };
}

describe("services/tts-browser.js", () => {
  let window;
  let api;

  beforeEach(async () => {
    ({ window, api } = await setup());
  });

  it("delegates OpenAI TTS provider to LumeoOpenAITTS", async () => {
    const speak = vi.fn(async () => true);
    window.LumeoOpenAITTS = { speak };

    await expect(api.speak("hello", "en", {
      provider: "openai-tts",
      openaiKey: "sk-test",
      rate: 1.1,
      volume: 0.7,
    })).resolves.toBe(true);

    expect(speak).toHaveBeenCalledWith("hello", "en", {
      apiKey: "sk-test",
      voice: "alloy",
      speed: 1.1,
      volume: 0.7,
    });
  });

  it("throws a clear error if OpenAI TTS provider is selected but not loaded", async () => {
    await expect(api.speak("hello", "en", { provider: "openai-tts" }))
      .rejects.toThrow("OpenAI TTS service is not loaded");
  });

  it("uses eleven_turbo_v2_5 as default model for ElevenLabs custom voice", async () => {
    let capturedUrl = null;
    let capturedBody = null;
    window.fetch = vi.fn(async (url, init) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init.body);
      return {
        ok: true,
        blob: async () => ({}),
      };
    });
    window.URL = { createObjectURL: () => "blob:test", revokeObjectURL: () => {} };
    window.Audio = class {
      constructor(src) { this.src = src; }
      play() { return Promise.resolve(); }
    };

    await api.speak("hello world", "vi", {
      provider: "custom-voice-engine",
      customTtsBaseUrl: "https://api.elevenlabs.io/v1",
      customTtsVoiceId: "21m00Tcm4TlvDq8ikWAM",
      customTtsApiKey: "eleven-key",
    });

    expect(capturedUrl).toBe("https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM");
    expect(capturedBody.model_id).toBe("eleven_turbo_v2_5");
  });

  it("fails-soft to browser speech when custom voice engine fails", async () => {
    window.fetch = vi.fn().mockRejectedValueOnce(new Error("Network failed"));
    const onFailover = vi.fn();

    const result = await api.speak("fallback text", "en", {
      provider: "custom-voice-engine",
      customTtsBaseUrl: "https://api.elevenlabs.io/v1",
      customTtsVoiceId: "v123",
      onFailover,
    });

    expect(result).toBe(true);
    expect(onFailover).toHaveBeenCalledWith(expect.objectContaining({
      from: "custom-voice-engine",
      to: "browser",
    }));
    expect(window.speechSynthesis.speak).toHaveBeenCalled();
  });
});
