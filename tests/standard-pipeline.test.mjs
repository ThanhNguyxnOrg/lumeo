import { describe, it, expect, beforeEach, vi } from "vitest";
import { createSandboxWindow, loadService } from "./helpers/load-service.mjs";

async function setup() {
  const { window } = await createSandboxWindow();
  loadService("pipelines/standard.js", window);
  return window.LumeoStandardPipeline;
}

describe("pipelines/standard.js", () => {
  let api;

  beforeEach(async () => {
    api = await setup();
  });

  it("publishes Standard pipeline constants and helper surface", () => {
    expect(api.__loaded).toBe(true);
    expect(api.DEFAULT_CHUNK_MS).toBe(5000);
    expect(api.MIN_CHUNK_BYTES).toBe(2000);
    expect(api.RECORDER_MIMES).toContain("audio/webm;codecs=opus");
    expect(typeof api.pickRecorderMime).toBe("function");
    expect(typeof api.shouldProcessChunk).toBe("function");
  });

  it("delegates recorder MIME selection to audio utils with Standard candidates", () => {
    const pickRecorderMime = vi.fn(() => "audio/webm");
    expect(api.pickRecorderMime({ pickRecorderMime })).toBe("audio/webm");
    expect(pickRecorderMime).toHaveBeenCalledWith(api.RECORDER_MIMES);
  });

  it("rejects stale, inactive, and tiny chunks", () => {
    const active = { token: 2 };
    expect(api.shouldProcessChunk(active, active, 2, { size: 2000 })).toBe(true);
    expect(api.shouldProcessChunk(active, {}, 2, { size: 2000 })).toBe(false);
    expect(api.shouldProcessChunk(active, active, 3, { size: 2000 })).toBe(false);
    expect(api.shouldProcessChunk(active, active, 2, { size: 1999 })).toBe(false);
  });

  it("records one chunk and passes the combined blob to processChunk", () => {
    const timers = [];
    const processChunk = vi.fn(async () => {});
    class FakeRecorder {
      constructor() {
        this.listeners = new Map();
        this.state = "inactive";
      }
      addEventListener(type, handler) {
        this.listeners.set(type, handler);
      }
      start() {
        this.state = "recording";
        this.listeners.get("dataavailable")?.({ data: new Blob(["abcd"], { type: "audio/webm" }) });
      }
      stop() {
        this.state = "inactive";
        this.listeners.get("stop")?.();
      }
    }
    const session = { token: 1, stream: {}, recorderMime: "audio/webm", stopFlag: false };
    api.runChunkLoop(session, {
      getActiveSession: () => session,
      isVideoPaused: () => false,
      MediaRecorder: FakeRecorder,
      setTimeout: (fn) => { timers.push(fn); return timers.length; },
      processChunk,
    });
    expect(timers).toHaveLength(1);
    timers[0]();
    session.stopFlag = true;
    expect(processChunk).toHaveBeenCalledOnce();
    expect(processChunk.mock.calls[0][0]).toBe(session);
    expect(processChunk.mock.calls[0][1].type).toBe("audio/webm");
  });

  it("processes Standard STT, translation, TTS, and playback", async () => {
    const sourceNode = { connect: vi.fn(), start: vi.fn() };
    const audioBuffer = { duration: 1.25 };
    const audioCtx = {
      currentTime: 3,
      decodeAudioData: vi.fn(async () => audioBuffer),
      createBufferSource: vi.fn(() => sourceNode),
    };
    const session = {
      token: 7,
      kymaKey: "kyma-test",
      audioCtx,
      outputGain: {},
      nextPlayAt: 0,
      abortController: new AbortController(),
    };
    const formData = { append: vi.fn() };
    const fetch = vi.fn(async (url) => {
      if (url.endsWith("/audio/transcriptions")) return { ok: true, json: async () => ({ text: "hello" }) };
      if (url.endsWith("/chat/completions")) return { ok: true, json: async () => ({ choices: [{ message: { content: "xin chào" } }] }) };
      if (url.endsWith("/audio/speech")) return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
      throw new Error("unexpected url");
    });
    const callbacks = {
      onSourceText: vi.fn(),
      onTargetText: vi.fn(),
      onChunkDone: vi.fn(),
      onError: vi.fn(),
    };

    await api.processChunk(session, { size: 3000 }, {
      getActiveSession: () => session,
      getPageToken: () => 7,
      getSettings: () => ({ targetLanguage: "vi", standardVoice: "English_magnetic_voiced_man" }),
      langNameByCode: { vi: "Vietnamese" },
      kymaBase: "https://kyma.test/v1",
      audioUtils: { webmBlobToWav: vi.fn(async () => new Blob(["wav"])) },
      fetch,
      FormData: vi.fn(() => formData),
      parseKymaError: vi.fn(),
      ...callbacks,
    });

    expect(formData.append).toHaveBeenCalledWith("model", "whisper-v3-turbo");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(callbacks.onSourceText).toHaveBeenCalledWith("hello");
    expect(callbacks.onTargetText).toHaveBeenCalledWith("xin chào");
    expect(sourceNode.connect).toHaveBeenCalledWith(session.outputGain);
    expect(sourceNode.start).toHaveBeenCalledWith(3.05);
    expect(session.nextPlayAt).toBe(4.3);
    expect(callbacks.onChunkDone).toHaveBeenCalledOnce();
    expect(callbacks.onError).not.toHaveBeenCalled();
  });
});
