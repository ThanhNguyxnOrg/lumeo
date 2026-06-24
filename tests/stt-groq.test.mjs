import { describe, it, expect, beforeEach, vi } from "vitest";
import { createSandboxWindow, loadService } from "./helpers/load-service.mjs";

async function setup() {
  const { window } = await createSandboxWindow();
  loadService("services/stt-groq.js", window);
  return { window, api: window.LumeoGroqSTT };
}

describe("services/stt-groq.js", () => {
  let window;
  let api;

  beforeEach(async () => {
    ({ window, api } = await setup());
  });

  it("builds a Groq transcription request and normalizes the response", async () => {
    const append = vi.fn();
    window.FormData = vi.fn(function() { return { append }; });
    window.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ text: " hello world ", language: "en", segments: [{ start: 0 }] }),
    }));

    const result = await api.transcribeBlob(new window.Blob(["wav"]), {
      apiKey: "groq-key",
      model: "whisper-large-v3-turbo",
      language: "en",
      prompt: "context",
      temperature: 0,
    });

    expect(window.fetch).toHaveBeenCalledWith(api.GROQ_URL, expect.objectContaining({
      method: "POST",
      headers: { Authorization: "Bearer groq-key" },
      signal: undefined,
    }));
    expect(append).toHaveBeenCalledWith("file", expect.any(window.Blob), "chunk.wav");
    expect(append).toHaveBeenCalledWith("model", "whisper-large-v3-turbo");
    expect(append).toHaveBeenCalledWith("response_format", "verbose_json");
    expect(append).toHaveBeenCalledWith("language", "en");
    expect(append).toHaveBeenCalledWith("prompt", "context");
    expect(append).toHaveBeenCalledWith("temperature", "0");
    expect(result).toEqual({ text: "hello world", language: "en", segments: [{ start: 0 }] });
  });

  it("throws concise API errors", async () => {
    window.FormData = vi.fn(function() { return { append: vi.fn() }; });
    window.fetch = vi.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: "rate limited" } }),
    }));

    await expect(api.transcribeBlob(new window.Blob(["wav"]), { apiKey: "groq-key" }))
      .rejects.toThrow("rate limited");
  });

  it("records chunks, converts to WAV, and emits transcribed text", async () => {
    const timers = [];
    const onText = vi.fn();
    const onError = vi.fn();
    const wavBlob = new window.Blob(["wav"]);
    window.LumeoAudioUtils = {
      pickRecorderMime: vi.fn(() => "audio/webm"),
      webmBlobToWav: vi.fn(async () => wavBlob),
    };
    window.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ text: "caption text", language: "en" }),
    }));
    window.setTimeout = vi.fn((fn) => { timers.push(fn); return timers.length; });

    let recorder;
    class FakeRecorder {
      constructor(stream, options) {
        this.stream = stream;
        this.options = options;
        this.state = "inactive";
        this.ondataavailable = null;
        recorder = this;
      }
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
      }
    }
    window.MediaRecorder = FakeRecorder;

    const loop = api.create({ stream: {}, apiKey: "groq-key", onText, onError, chunkMs: 10 });
    loop.start();
    await recorder.ondataavailable({ data: new window.Blob(["x".repeat(2000)], { type: "audio/webm" }) });

    expect(window.LumeoAudioUtils.pickRecorderMime).toHaveBeenCalled();
    expect(window.LumeoAudioUtils.webmBlobToWav).toHaveBeenCalled();
    expect(onText).toHaveBeenCalledWith(expect.objectContaining({ text: "caption text", language: "en" }));
    expect(onError).not.toHaveBeenCalled();
    expect(timers).toHaveLength(1);

    loop.stop();
    expect(loop.stopped).toBe(true);
  });
});
