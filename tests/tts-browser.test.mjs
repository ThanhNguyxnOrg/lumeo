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

  it("synthesizes OpenAI TTS through LumeoOpenAITTS and plays the clip itself", async () => {
    const synthesize = vi.fn(async () => "blob:openai");
    window.LumeoOpenAITTS = { synthesize };
    const pause = vi.fn();
    const audios = [];
    window.Audio = class {
      constructor(url) { this.url = url; audios.push(this); }
      addEventListener() {}
      play() { return Promise.resolve(); }
      pause() { pause(); }
    };

    await expect(api.speak("hello", "en", {
      provider: "openai-tts",
      openaiKey: "sk-test",
      rate: 1.1,
      volume: 0.7,
    })).resolves.toBe(true);

    expect(synthesize).toHaveBeenCalledWith("hello", expect.objectContaining({
      apiKey: "sk-test",
      voice: "alloy",
      speed: 1.1,
    }));
    expect(audios[0].url).toBe("blob:openai");
    expect(audios[0].volume).toBe(0.7);
    expect(window.speechSynthesis.cancel).toHaveBeenCalled();

    // stop() must silence OpenAI audio too, or the voice keeps talking after
    // the video is paused.
    api.stop();
    expect(pause).toHaveBeenCalledOnce();
  });

  it("speeds a network clip up just enough to end inside its slot", async () => {
    window.fetch = vi.fn(async () => ({ ok: true, blob: async () => ({}) }));
    window.URL.createObjectURL = () => "blob:custom";
    const audios = [];
    window.Audio = class {
      constructor() { this.readyState = 1; this.duration = 6; this.playbackRate = 1; audios.push(this); }
      addEventListener() {}
      play() { return Promise.resolve(); }
      pause() {}
    };
    const base = {
      provider: "custom-voice-engine",
      customTtsBaseUrl: "https://api.example.com/v1",
      customTtsVoiceId: "voice-1",
      rate: 1.9,
    };

    await api.speak("a six second clip", "en", { ...base, getSlotSeconds: () => 4 });
    expect(audios[0].playbackRate).toBeCloseTo(1.5, 5);

    // Shorter than the slot: natural speed, never slowed down.
    await api.speak("a six second clip", "en", { ...base, getSlotSeconds: () => 10 });
    expect(audios[1].playbackRate).toBe(1);

    // No time left: product ceiling.
    await api.speak("a six second clip", "en", { ...base, getSlotSeconds: () => 0 });
    expect(audios[2].playbackRate).toBe(2);

    // Manual speed: no slot, the requested rate is used as-is.
    await api.speak("a six second clip", "en", base);
    expect(audios[3].playbackRate).toBe(1.9);
  });

  it("reports a clip that fails to decode so the queue moves on", async () => {
    window.fetch = vi.fn(async () => ({ ok: true, blob: async () => ({}) }));
    window.URL.createObjectURL = () => "blob:custom";
    const listeners = {};
    window.Audio = class {
      addEventListener(type, cb) { listeners[type] = cb; }
      play() { return Promise.resolve(); }
      pause() {}
    };
    const onEnd = vi.fn();
    await api.speak("broken clip", "en", {
      provider: "custom-voice-engine",
      customTtsBaseUrl: "https://api.example.com/v1",
      customTtsVoiceId: "voice-1",
      onEnd,
    });
    listeners.error();
    expect(onEnd).toHaveBeenCalledWith(false);
  });

  it("learns a voice's pace and start latency from what it actually spoke", async () => {
    let clock = 1000;
    window.performance.now = () => clock;
    let utterance;
    window.speechSynthesis.speak = (u) => { utterance = u; };

    const task = api.speakQueued("one two three four five six", "en", {
      rate: 1.5,
      speechUnits: 6,
      paceKey: "browser|en|",
      latencyKey: "browser|en|",
    });
    await Promise.resolve();
    expect(api.getPace("browser|en|")).toBeNull();
    expect(api.getStartLatency("browser|en|")).toBe(0);

    clock += 300;
    utterance.onstart();
    clock += 2000;
    utterance.onend();
    await expect(task).resolves.toBe(true);

    // 2s at 1.5x is 3s of natural speech for 6 words.
    expect(api.getPace("browser|en|")).toBeCloseTo(2, 5);
    expect(api.getStartLatency("browser|en|")).toBeCloseTo(0.3, 5);
  });

  it("throws a clear error if OpenAI TTS provider is selected but not loaded", async () => {
    await expect(api.speak("hello", "en", { provider: "openai-tts" }))
      .rejects.toThrow("OpenAI TTS service is not loaded");
  });

  it("uses eleven_flash_v2_5 as default model for ElevenLabs custom voice", async () => {
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
    expect(capturedBody.model_id).toBe("eleven_flash_v2_5");
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

  it("prefetches a Google line once and reuses the cached clip at playback", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ audioContent: "ZmFrZS1tcDMtYnl0ZXM=" }),
    }));
    window.fetch = fetch;
    const play = vi.fn(() => Promise.resolve());
    window.URL = { createObjectURL: () => "blob:prefetched", revokeObjectURL: () => {} };
    window.Audio = class {
      constructor(src) { this.src = src; }
      play() { return play(); }
      addEventListener() {}
      pause() {}
    };
    const options = {
      provider: "google-cloud",
      googleCloudKey: "gcp-test",
      rate: 1.2,
    };

    await expect(api.prefetch("xin chào", "vi", options)).resolves.toBe(true);
    await expect(api.speak("xin chào", "vi", options)).resolves.toBe(true);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("prefetches a custom-voice line once and reuses the cached clip at playback", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      blob: async () => ({}),
    }));
    window.fetch = fetch;
    const play = vi.fn(() => Promise.resolve());
    window.URL = { createObjectURL: () => "blob:custom-prefetched", revokeObjectURL: () => {} };
    window.Audio = class {
      constructor(src) { this.src = src; }
      play() { return play(); }
      addEventListener() {}
      pause() {}
    };
    const options = {
      provider: "custom-voice-engine",
      customTtsBaseUrl: "https://api.example.com/v1",
      customTtsVoiceId: "voice-1",
      customTtsModelId: "tts-1",
    };

    await expect(api.prefetch("xin chào", "vi", options)).resolves.toBe(true);
    await expect(api.speak("xin chào", "vi", options)).resolves.toBe(true);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight request when playback starts before prefetch settles", async () => {
    let resolveFetch;
    const fetch = vi.fn(() => new Promise((resolve) => {
      resolveFetch = resolve;
    }));
    window.fetch = fetch;
    const play = vi.fn(() => Promise.resolve());
    let objects = 0;
    window.URL = {
      createObjectURL: () => `blob:shared-${++objects}`,
      revokeObjectURL: () => {},
    };
    window.Audio = class {
      constructor(src) { this.src = src; }
      play() { return play(); }
      addEventListener() {}
      pause() {}
    };
    const options = {
      provider: "custom-voice-engine",
      customTtsBaseUrl: "https://api.example.com/v1",
      customTtsVoiceId: "voice-1",
    };

    const prefetch = api.prefetch("xin chào", "vi", options);
    const speak = api.speak("xin chào", "vi", options);

    resolveFetch({ ok: true, blob: async () => ({}) });
    await expect(prefetch).resolves.toBe(true);
    await expect(speak).resolves.toBe(true);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(objects).toBe(1);
  });

  it("does not prefetch browser speech", async () => {
    expect(await api.prefetch("hello", "en", { provider: "browser" })).toBe(false);
  });
});

describe("services/tts-browser.js queue", () => {
  async function setupQueue() {
    const { window } = await createSandboxWindow();
    const utterances = [];
    window.speechSynthesis = {
      cancel: vi.fn(),
      speak: vi.fn(),
      getVoices: () => [{ name: "Test Voice", lang: "en-US" }],
    };
    window.SpeechSynthesisUtterance = function SpeechSynthesisUtterance(text) {
      this.text = text;
      utterances.push(this);
    };
    loadService("services/tts-browser.js", window);
    return { window, api: window.LumeoTTS, utterances };
  }

  it("lets the current utterance finish before starting the next cue", async () => {
    const { api, utterances } = await setupQueue();
    const first = api.speakQueued("first line", "en", {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(utterances).toHaveLength(1);

    const second = api.speakQueued("second line", "en", {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(utterances).toHaveLength(1);

    utterances[0].onend();
    await expect(first).resolves.toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(utterances).toHaveLength(2);
    expect(utterances[1].text).toBe("second line");

    utterances[1].onend();
    await expect(second).resolves.toBe(true);
  });

  it("drops the oldest pending cue and reports it when the backlog grows", async () => {
    const { api, utterances } = await setupQueue();
    const first = api.speakQueued("first line", "en", {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    const skipped = vi.fn();
    const second = api.speakQueued("second line", "en", { onSkip: skipped });
    const third = api.speakQueued("third line", "en", {});
    const fourth = api.speakQueued("fourth line", "en", {});
    await expect(second).resolves.toBe(false);
    expect(skipped).toHaveBeenCalledWith(expect.objectContaining({ reason: "backlog" }));

    utterances[0].onend();
    await expect(first).resolves.toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(utterances).toHaveLength(2);
    expect(utterances[1].text).toBe("third line");

    utterances[1].onend();
    await expect(third).resolves.toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(utterances).toHaveLength(3);
    expect(utterances[2].text).toBe("fourth line");

    utterances[2].onend();
    await expect(fourth).resolves.toBe(true);
  });

  it("never starts a line the video already moved past", async () => {
    const { api } = await setupQueue();
    const skipped = vi.fn();
    const result = await api.speakQueued("old line", "en", {
      isStale: () => true,
      onSkip: skipped,
    });
    expect(result).toBe(false);
    expect(skipped).toHaveBeenCalledWith(expect.objectContaining({ reason: "stale" }));
  });
});
