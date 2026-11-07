import { describe, it, expect, beforeEach, vi } from "vitest";
import { createSandboxWindow, loadService } from "./helpers/load-service.mjs";

async function setupOrchestrator() {
  const { window } = await createSandboxWindow();
  loadService("pipelines/caption-orchestrator.js", window);
  return window.LumeoCaptionOrchestrator;
}

describe("caption fitRateForCue (multilingual)", () => {
  let api;
  beforeEach(async () => {
    api = await setupOrchestrator();
  });

  it("returns 1.0 for normal EN pace", () => {
    expect(api.fitRateForCue({ text: "hello world foo bar baz qux quux corge grault garply waldo fred", targetLanguage: "en", duration: 5, playbackRate: 1 })).toBe(1.0);
  });

  it("speeds up dense EN within 1.6 cap", () => {
    const dense = Array(20).fill("word").join(" ");
    expect(api.fitRateForCue({ text: dense, targetLanguage: "en", duration: 5, playbackRate: 1 })).toBeCloseTo(1.144, 3);
    const veryDense = Array(50).fill("word").join(" ");
    expect(api.fitRateForCue({ text: veryDense, targetLanguage: "en", duration: 5, playbackRate: 1 })).toBe(1.6);
  });

  it("slows down sparse EN to floor 0.90", () => {
    expect(api.fitRateForCue({ text: "hi there", targetLanguage: "en", duration: 5, playbackRate: 1 })).toBeCloseTo(0.922, 3);
  });

  it("does not speed normal zh/ja (char triggers 5.5/6.5)", () => {
    const zhNormal = "你".repeat(20);
    expect(api.fitRateForCue({ text: zhNormal, targetLanguage: "zh", duration: 5, playbackRate: 1 })).toBe(1.0);
    const jaNormal = "あ".repeat(30);
    expect(api.fitRateForCue({ text: jaNormal, targetLanguage: "ja", duration: 5, playbackRate: 1 })).toBe(1.0);
  });

  it("caps dense zh at 1.6", () => {
    const zhDense = "你".repeat(60);
    expect(api.fitRateForCue({ text: zhDense, targetLanguage: "zh", duration: 5, playbackRate: 1 })).toBe(1.6);
  });

  it("accounts for video playbackRate", () => {
    const ten = Array(10).fill("word").join(" ");
    expect(api.fitRateForCue({ text: ten, targetLanguage: "en", duration: 5, playbackRate: 2 })).toBeCloseTo(1.144, 3);
  });

  it("returns 1.0 for empty text", () => {
    expect(api.fitRateForCue({ text: "", targetLanguage: "vi", duration: 5, playbackRate: 1 })).toBe(1.0);
  });

  it("keeps th fit within bounds", () => {
    const rate = api.fitRateForCue({ text: "สวัสดีครับ ยินดีต้อนรับ", targetLanguage: "th", duration: 4, playbackRate: 1 });
    expect(rate).toBeGreaterThanOrEqual(0.9);
    expect(rate).toBeLessThanOrEqual(1.6);
  });

  it("accelerates a late cue toward the 2.0x catch-up cap", () => {
    expect(api.catchUpRateForLag(0)).toBe(1.0);
    expect(api.catchUpRateForLag(-2)).toBe(1.0);
    expect(api.catchUpRateForLag(1)).toBeCloseTo(1.25, 3);
    expect(api.catchUpRateForLag(10)).toBe(2.0);
  });

  it("uses adaptive rate in auto mode and a fixed capped rate in manual mode", () => {
    expect(api.resolveSpeechRate({ calculatedRate: 1.2, catchUpRate: 1.5 })).toBe(1.5);
    expect(api.resolveSpeechRate({ calculatedRate: 0.9, catchUpRate: 1 })).toBe(1);
    expect(api.resolveSpeechRate({ calculatedRate: 1, catchUpRate: 5 })).toBe(2.0);
    expect(api.resolveSpeechRate({
      calculatedRate: 1.2,
      catchUpRate: 1.5,
      settings: { ttsSpeedMode: "manual", ttsSpeed: 0.9 },
    })).toBe(0.9);
    expect(api.resolveSpeechRate({
      calculatedRate: 1.2,
      settings: { ttsRate: 1.7 },
    })).toBe(1.7);
  });

  it("marks cues the video has already moved past as stale", () => {
    const cue = { start: 10, end: 13 };
    expect(api.isCueStale(13.2, cue)).toBe(false);
    expect(api.isCueStale(13.5, cue)).toBe(true);
    expect(api.isCueStale(5, { start: 10 })).toBe(false);
    expect(api.isCueStale(14.5, { start: 10 })).toBe(true);
  });
});

describe("caption TTS prefetch", () => {
  it("prefetches an upcoming network line once and skips browser speech", async () => {
    const { window } = await createSandboxWindow();
    loadService("pipelines/caption-orchestrator.js", window);
    const api = window.LumeoCaptionOrchestrator;
    const prefetch = vi.fn(async () => true);
    window.LumeoTTS = { prefetch };
    const session = {};
    const video = { currentTime: 10, playbackRate: 1 };
    const cue = { start: 10, end: 12, translated: "xin chào" };
    const next = { start: 12, end: 14 };
    const settings = {
      captionTtsProvider: "google-cloud",
      targetLanguage: "vi",
      standardVoice: "Achernar",
    };

    expect(api.prefetchCueSpeech(cue, next, settings, video, {}, session)).toBe(true);
    expect(api.prefetchCueSpeech(cue, next, settings, video, {}, session)).toBe(false);
    expect(prefetch).toHaveBeenCalledTimes(1);
    expect(prefetch).toHaveBeenCalledWith(
      "xin chào",
      "vi",
      expect.objectContaining({ provider: "google-cloud", voiceName: "Achernar" }),
    );

    const stored = session.prefetchedTtsPlans.get(api.cueSpeechKey(cue, "xin chào"));
    expect(stored.rate).toBe(1.0);

    expect(api.prefetchCueSpeech(
      cue,
      next,
      { ...settings, captionTtsProvider: "browser" },
      video,
      {},
      {},
    )).toBe(false);
  });

  it("reuses the prefetched rate for baked-rate providers while on time", async () => {
    const { window } = await createSandboxWindow();
    loadService("pipelines/caption-orchestrator.js", window);
    const api = window.LumeoCaptionOrchestrator;
    const cue = { start: 10, end: 12 };
    const plan = { rate: 1.0 };
    const prefetchedPlan = { rate: 1.0 };

    expect(api.selectCuePlaybackPlan({
      plan, prefetchedPlan, mediaNow: 10.2, cue, provider: "google-cloud",
    })).toEqual({ rate: 1.0, reusePrefetched: true });

    // Late enough that the voice should catch up instead of replaying the
    // prefetched pace.
    expect(api.selectCuePlaybackPlan({
      plan: { rate: 1.4 }, prefetchedPlan, mediaNow: 12, cue, provider: "google-cloud",
    })).toEqual({ rate: 1.4, reusePrefetched: false });

    // Custom voice applies rate at playback, so it keeps adapting.
    expect(api.selectCuePlaybackPlan({
      plan: { rate: 1.2 }, prefetchedPlan, mediaNow: 10.2, cue, provider: "custom-voice-engine",
    })).toEqual({ rate: 1.2, reusePrefetched: false });
  });

  it("builds the same rate for prefetch and on-time playback", async () => {
    const { window } = await createSandboxWindow();
    loadService("pipelines/caption-orchestrator.js", window);
    const api = window.LumeoCaptionOrchestrator;
    const cue = { start: 10, end: 12, translated: "xin chào các bạn" };
    const next = { start: 12, end: 14 };
    const settings = { targetLanguage: "vi", captionTtsProvider: "google-cloud" };

    const prefetch = api.buildCueSpeechPlan(cue, next, settings, {
      videoNow: 10,
      videoRate: 1,
      includeCatchUp: false,
    });
    const playback = api.buildCueSpeechPlan(cue, next, settings, {
      videoNow: 10,
      videoRate: 1,
    });

    expect(playback.rate).toBe(prefetch.rate);
  });
});

describe("standard backlog guard", () => {
  it("fast-forwards stale nextPlayAt instead of queueing unbounded lag", async () => {
    const { window } = await createSandboxWindow();
    loadService("pipelines/standard.js", window);
    const api = window.LumeoStandardPipeline;
    const sourceNode = { connect: vi.fn(), start: vi.fn(), playbackRate: { value: 1.0 } };
    const audioCtx = {
      currentTime: 0,
      decodeAudioData: vi.fn(async () => ({ duration: 1.0 })),
      createBufferSource: vi.fn(() => sourceNode),
    };
    const session = {
      token: 9,
      kymaKey: "k",
      audioCtx,
      outputGain: {},
      nextPlayAt: 10,
      abortController: new AbortController(),
    };
    const formData = { append: vi.fn() };
    const fetch = vi.fn(async (url) => {
      if (url.endsWith("/audio/transcriptions")) return { ok: true, json: async () => ({ text: "hello" }) };
      if (url.endsWith("/chat/completions")) return { ok: true, json: async () => ({ choices: [{ message: { content: "hi" } }] }) };
      if (url.endsWith("/audio/speech")) return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
      throw new Error("unexpected");
    });
    await api.processChunk(session, { size: 3000 }, {
      getActiveSession: () => session,
      getPageToken: () => 9,
      getSettings: () => ({ targetLanguage: "en" }),
      langNameByCode: { en: "English" },
      kymaBase: "https://k.test/v1",
      audioUtils: { webmBlobToWav: vi.fn(async () => new Blob(["wav"])) },
      fetch,
      FormData: vi.fn(function () { return formData; }),
    });
    expect(session.nextPlayAt).toBeLessThan(3);
  });
});
