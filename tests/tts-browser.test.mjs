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
});
