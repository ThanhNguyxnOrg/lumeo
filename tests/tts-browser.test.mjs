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

async function setupWithVoices(voices) {
  const { window } = await createSandboxWindow();
  window.speechSynthesis = {
    cancel: vi.fn(),
    speak: vi.fn(),
    getVoices: () => voices,
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

  it("maps every major caption code to a Cloud languageCode", () => {
    expect(api.normalizeLang("ms")).toBe("ms-MY");
    expect(api.normalizeLang("fil")).toBe("fil-PH");
    expect(api.normalizeLang("no")).toBe("nb-NO");
    expect(api.normalizeLang("zh-TW")).toBe("cmn-TW");
    expect(api.normalizeLang("zu")).toBe("zu-ZA");
    expect(api.normalizeLang("vi")).toBe("vi-VN");
  });

  it("keeps browser utterance lang as BCP-47, never Cloud-only codes", () => {
    expect(api.browserLang("zh-CN")).toBe("zh-CN");
    expect(api.browserLang("zh-TW")).toBe("zh-TW");
    expect(api.browserLang("ar")).toBe("ar-SA");
    expect(api.browserLang("vi")).toBe("vi-VN");
    expect(api.browserLang("th")).toBe("th-TH");
  });

  it("prefers full-tag voice matches and understands fil/tl aliases", async () => {
    const { api: aliased } = await setupWithVoices([
      { name: "Voice TW", lang: "zh-TW" },
      { name: "Voice CN", lang: "zh-CN" },
      { name: "Tagalog Voice", lang: "tl-PH" },
    ]);
    expect(aliased.getVoicesForLang("zh-CN")[0].lang).toBe("zh-CN");
    expect(aliased.getVoicesForLang("fil")).toHaveLength(1);
    expect(aliased.getVoicesForLang("lo")).toEqual([]);
  });

  it("never confuses related-but-distinct languages in matching", async () => {
    const { api: aliased } = await setupWithVoices([
      { name: "Bahasa Indonesia", lang: "id-ID" },
      { name: "Fake Thelang", lang: "the-X" },
      { name: "Thai Voice", lang: "th-TH" },
    ]);
    // ms must not match id-ID; th must not match the-X.
    expect(aliased.getVoicesForLang("ms")).toEqual([]);
    expect(aliased.getVoicesForLang("th").map((v) => v.lang)).toEqual(["th-TH"]);
    // cmn-TW intentionally has no Chirp3-HD voice (browser-only by design).
    expect(aliased.CHIRP3_HD_LOCALES.has("cmn-TW")).toBe(false);
    expect(aliased.CHIRP3_HD_LOCALES.has("cmn-CN")).toBe(true);
  });

  it("fails fast to browser speech for Cloud locales without Chirp3-HD", async () => {
    const fetch = vi.fn();
    window.fetch = fetch;
    const onFailover = vi.fn();
    const result = await api.speak("sabaidee", "lo", {
      provider: "google-cloud",
      googleCloudKey: "gcp-test",
      onFailover,
    });
    expect(result).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(onFailover).toHaveBeenCalledWith(expect.objectContaining({
      from: "google-cloud",
      to: "browser",
    }));
    expect(window.speechSynthesis.speak).toHaveBeenCalled();
  });

  it("cancels in-flight browser speech before starting cloud audio", async () => {
    window.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ audioContent: "ZmFrZS1tcDMtYnl0ZXM=" }),
    }));
    window.URL = { createObjectURL: () => "blob:cloud", revokeObjectURL: () => {} };
    window.Audio = class {
      constructor(src) { this.src = src; }
      play() { return Promise.resolve(); }
    };
    const result = await api.speak("xin chào", "vi", {
      provider: "google-cloud",
      googleCloudKey: "gcp-test",
    });
    expect(result).toBe(true);
    expect(window.speechSynthesis.cancel).toHaveBeenCalled();
  });
});
