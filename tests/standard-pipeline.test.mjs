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
      FormData: vi.fn(function() { return formData; }),
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

  it("applies speed-stretching and auto-ducking when duration is long and video is available", async () => {
    const sourceNode = { connect: vi.fn(), start: vi.fn(), playbackRate: { value: 1.0 } };
    const audioBuffer = { duration: 6.0 };
    const audioCtx = {
      currentTime: 3,
      decodeAudioData: vi.fn(async () => audioBuffer),
      createBufferSource: vi.fn(() => sourceNode),
    };
    const session = {
      token: 8,
      kymaKey: "kyma-test",
      audioCtx,
      outputGain: {},
      nextPlayAt: 0,
      abortController: new AbortController(),
    };
    const video = { volume: 1.0 };
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

    vi.useFakeTimers();

    await api.processChunk(session, { size: 3000 }, {
      getActiveSession: () => session,
      getPageToken: () => 8,
      getSettings: () => ({ targetLanguage: "vi", standardVoice: "English_magnetic_voiced_man", originalVolume: 50 }),
      langNameByCode: { vi: "Vietnamese" },
      kymaBase: "https://kyma.test/v1",
      audioUtils: { webmBlobToWav: vi.fn(async () => new Blob(["wav"])) },
      getVideo: () => video,
      fetch,
      FormData: vi.fn(function() { return formData; }),
      parseKymaError: vi.fn(),
      ...callbacks,
    });

    expect(sourceNode.playbackRate.value).toBeCloseTo(1.1, 5);
    expect(session.nextPlayAt).toBeCloseTo(8.5045, 4);
    expect(video.volume).toBe(1.0);

    vi.advanceTimersByTime(50);
    expect(video.volume).toBeCloseTo(0.075, 5);

    audioCtx.currentTime = 8.5045;
    vi.advanceTimersByTime(6000);
    expect(video.volume).toBeCloseTo(0.5, 5);

    vi.useRealTimers();
  });

  it("sends the glossary and rolling transcript context to translation", async () => {
    const sourceNode = { connect: vi.fn(), start: vi.fn() };
    const audioCtx = {
      currentTime: 3,
      decodeAudioData: vi.fn(async () => ({ duration: 1.0 })),
      createBufferSource: vi.fn(() => sourceNode),
    };
    const session = {
      token: 21,
      kymaKey: "kyma-test",
      audioCtx,
      outputGain: {},
      nextPlayAt: 0,
      contextLines: ["first line"],
      abortController: new AbortController(),
    };
    let chatBody = null;
    const fetch = vi.fn(async (url, init) => {
      if (url.endsWith("/audio/transcriptions")) return { ok: true, json: async () => ({ text: "second line" }) };
      if (url.endsWith("/chat/completions")) {
        chatBody = JSON.parse(init.body);
        return { ok: true, json: async () => ({ choices: [{ message: { content: "dòng hai" } }] }) };
      }
      if (url.endsWith("/audio/speech")) return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
      throw new Error("unexpected url");
    });

    await api.processChunk(session, { size: 3000 }, {
      getActiveSession: () => session,
      getPageToken: () => 21,
      getSettings: () => ({ targetLanguage: "vi", translationContext: "Keep the brand Lumeo." }),
      langNameByCode: { vi: "Vietnamese" },
      kymaBase: "https://kyma.test/v1",
      audioUtils: { webmBlobToWav: vi.fn(async () => new Blob(["wav"])) },
      fetch,
      FormData: vi.fn(function() { return { append: vi.fn() }; }),
      parseKymaError: vi.fn(),
      onSourceText: vi.fn(),
      onTargetText: vi.fn(),
      onChunkDone: vi.fn(),
      onError: vi.fn(),
    });

    expect(chatBody.messages[0].content).toContain("Keep the brand Lumeo.");
    expect(chatBody.messages[0].content).toContain("first line");
    expect(session.contextLines).toEqual(["first line", "second line"]);
  });

  it("captures the chunk slot start when recording begins, not when it stops", () => {
    let recorder;
    let videoTime = 10;
    class FakeRecorder {
      constructor() {
        this.listeners = new Map();
        this.state = "inactive";
        recorder = this;
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
    const processChunk = vi.fn(async () => {});
    const session = { token: 1, stream: {}, recorderMime: "audio/webm", stopFlag: false };
    api.runChunkLoop(session, {
      getActiveSession: () => session,
      isVideoPaused: () => false,
      MediaRecorder: FakeRecorder,
      setTimeout: () => 1,
      getVideoTime: () => videoTime,
      processChunk,
    });

    videoTime = 15;
    recorder.stop();

    expect(processChunk).toHaveBeenCalledOnce();
    const blob = processChunk.mock.calls[0][1];
    expect(blob.__lumeoChunk).toEqual({
      index: 0,
      sourceStartMs: 10000,
      sourceEndMs: 15000,
    });
    session.stopFlag = true;
  });

  it("discards an in-flight chunk that straddles a seek", () => {
    let recorder;
    class FakeRecorder {
      constructor() {
        this.listeners = new Map();
        this.state = "inactive";
        recorder = this;
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
    const processChunk = vi.fn(async () => {});
    const session = {
      token: 1,
      stream: {},
      recorderMime: "audio/webm",
      stopFlag: false,
      chunkGeneration: 0,
    };
    api.runChunkLoop(session, {
      getActiveSession: () => session,
      isVideoPaused: () => false,
      MediaRecorder: FakeRecorder,
      setTimeout: () => 1,
      processChunk,
    });

    session.chunkGeneration += 1;
    recorder.stop();

    expect(processChunk).not.toHaveBeenCalled();
    session.stopFlag = true;
  });

  it("plays out-of-order chunks in sequence order", () => {
    const starts = [];
    const audioCtx = {
      currentTime: 100,
      createBufferSource: vi.fn(() => ({
        connect: vi.fn(),
        start: vi.fn((at) => starts.push(at)),
        playbackRate: { value: 1 },
      })),
    };
    const session = {
      token: 1,
      audioCtx,
      outputGain: {},
      nextPlayAt: 0,
      activeSources: new Set(),
      dubStartIndex: 0,
      dubGeneration: 0,
    };
    const context = { getVideo: () => ({ currentTime: 0, playbackRate: 1 }), getSettings: () => ({}) };

    api.enqueueOrderedDub(session, { index: 1, sourceStartMs: 5000, sourceEndMs: 10000 }, { duration: 1 }, context);
    expect(starts).toHaveLength(0);
    // A later chunk is buffered, so a drain timer must keep the gap bounded.
    expect(session.dubState.drainTimer).toBeTruthy();

    api.enqueueOrderedDub(session, { index: 0, sourceStartMs: 0, sourceEndMs: 5000 }, { duration: 1 }, context);
    expect(starts).toHaveLength(2);
    expect(starts[0]).toBeLessThanOrEqual(starts[1]);
    expect(session.dubState.drainTimer).toBeFalsy();
  });

  it("skips a missing chunk after the video has moved past its slot", () => {
    const starts = [];
    const audioCtx = {
      currentTime: 10,
      createBufferSource: vi.fn(() => ({
        connect: vi.fn(),
        start: vi.fn((at) => starts.push(at)),
        playbackRate: { value: 1 },
      })),
    };
    const session = {
      token: 1,
      audioCtx,
      outputGain: {},
      nextPlayAt: 0,
      activeSources: new Set(),
      dubStartIndex: 0,
      dubGeneration: 0,
    };
    const context = { getVideo: () => ({ currentTime: 8, playbackRate: 1 }), getSettings: () => ({}) };

    api.enqueueOrderedDub(session, { index: 1, sourceStartMs: 5000, sourceEndMs: 10000 }, { duration: 1 }, context);

    expect(starts).toHaveLength(1);
    expect(session.dubState.skipped).toBe(1);
  });

  it("resets the queue after a seek and anchors the first new chunk to its own start", () => {
    const starts = [];
    const audioCtx = {
      currentTime: 100,
      createBufferSource: vi.fn(() => ({
        connect: vi.fn(),
        start: vi.fn((at) => starts.push(at)),
        playbackRate: { value: 1 },
      })),
    };
    const session = {
      token: 1,
      audioCtx,
      outputGain: {},
      nextPlayAt: 0,
      activeSources: new Set(),
      dubStartIndex: 0,
      dubGeneration: 0,
    };
    const video = { currentTime: 5, playbackRate: 1 };
    const context = { getVideo: () => video, getSettings: () => ({}) };

    api.enqueueOrderedDub(session, { index: 1, sourceStartMs: 5000, sourceEndMs: 10000 }, { duration: 1 }, context);
    expect(session.dubState.drainTimer).toBeTruthy();

    session.dubGeneration += 1;
    api.resetDubState(session, 3);
    expect(session.dubState).toBeNull();
    expect(session.dubStartIndex).toBe(3);

    video.currentTime = 15;
    api.enqueueOrderedDub(session, { index: 3, sourceStartMs: 15000, sourceEndMs: 20000 }, { duration: 1 }, context);

    expect(starts).toHaveLength(1);
    expect(session.dubState.skipped).toBe(0);
    expect(session.dubState.nextIndex).toBe(4);
  });

  it("skips a buffered gap on its own drain timer without a new enqueue", async () => {
    const { window } = await createSandboxWindow();
    const pending = [];
    window.setTimeout = (fn, ms) => {
      pending.push({ fn, ms });
      return pending.length;
    };
    window.clearTimeout = (id) => {
      const timer = pending[id - 1];
      if (timer) timer.cancelled = true;
    };
    loadService("pipelines/standard.js", window);
    const localApi = window.LumeoStandardPipeline;
    const starts = [];
    const audioCtx = {
      currentTime: 100,
      createBufferSource: vi.fn(() => ({
        connect: vi.fn(),
        start: vi.fn((at) => starts.push(at)),
        playbackRate: { value: 1 },
      })),
    };
    const session = {
      token: 1,
      audioCtx,
      outputGain: {},
      nextPlayAt: 0,
      activeSources: new Set(),
      dubStartIndex: 0,
      dubGeneration: 0,
      stopFlag: false,
    };
    const video = { currentTime: 5, playbackRate: 1 };
    const context = {
      getActiveSession: () => session,
      getVideo: () => video,
      getSettings: () => ({ muteOriginal: true }),
    };

    localApi.enqueueOrderedDub(session, { index: 1, sourceStartMs: 5000, sourceEndMs: 10000 }, { duration: 1 }, context);
    expect(starts).toHaveLength(0);
    const drainTimer = pending.find((timer) => timer.ms === localApi.DRAIN_TICK_MS);
    expect(drainTimer).toBeTruthy();

    video.currentTime = 8;
    drainTimer.fn();

    expect(starts).toHaveLength(1);
    expect(session.dubState.skipped).toBe(1);
  });

  it("drops a late duplicate chunk instead of playing twice", () => {
    const starts = [];
    const audioCtx = {
      currentTime: 100,
      createBufferSource: vi.fn(() => ({
        connect: vi.fn(),
        start: vi.fn((at) => starts.push(at)),
        playbackRate: { value: 1 },
      })),
    };
    const session = {
      token: 1,
      audioCtx,
      outputGain: {},
      nextPlayAt: 0,
      activeSources: new Set(),
      dubStartIndex: 0,
      dubGeneration: 0,
    };
    const context = { getVideo: () => ({ currentTime: 0, playbackRate: 1 }), getSettings: () => ({}) };

    api.enqueueOrderedDub(session, { index: 0, sourceStartMs: 0, sourceEndMs: 5000 }, { duration: 1 }, context);
    api.enqueueOrderedDub(session, { index: 0, sourceStartMs: 0, sourceEndMs: 5000 }, { duration: 1 }, context);

    expect(starts).toHaveLength(1);
    expect(session.dubState.dropped).toBe(1);
  });
});
