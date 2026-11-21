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

  it("speeds dense EN up by exactly what the slot needs, capped at 2.0", () => {
    // 20 words need 20 / 2.8 = 7.14s of natural speech for a 5s slot.
    const dense = Array(20).fill("word").join(" ");
    expect(api.fitRateForCue({ text: dense, targetLanguage: "en", duration: 5, playbackRate: 1 })).toBeCloseTo(1.429, 3);
    const veryDense = Array(50).fill("word").join(" ");
    expect(api.fitRateForCue({ text: veryDense, targetLanguage: "en", duration: 5, playbackRate: 1 })).toBe(2.0);
  });

  it("never slows a sparse line below natural speed", () => {
    expect(api.fitRateForCue({ text: "hi there", targetLanguage: "en", duration: 5, playbackRate: 1 })).toBe(1.0);
  });

  it("uses the measured pace of the active voice once it is known", () => {
    const dense = Array(20).fill("word").join(" ");
    // A voice measured at 4 words/s fits 20 words in 5s without speeding up.
    expect(api.fitRateForCue({ text: dense, targetLanguage: "en", duration: 5, pace: 4 })).toBe(1.0);
    // An absurd sample is clamped to a band around the default.
    expect(api.speechPace("en", 100)).toBeCloseTo(2.8 * 1.8, 5);
    expect(api.speechPace("en", 0.1)).toBeCloseTo(2.8 * 0.55, 5);
    expect(api.speechPace("vi")).toBe(4.0);
  });

  it("does not speed normal zh/ja (char triggers 5.5/6.5)", () => {
    const zhNormal = "你".repeat(20);
    expect(api.fitRateForCue({ text: zhNormal, targetLanguage: "zh", duration: 5, playbackRate: 1 })).toBe(1.0);
    const jaNormal = "あ".repeat(30);
    expect(api.fitRateForCue({ text: jaNormal, targetLanguage: "ja", duration: 5, playbackRate: 1 })).toBe(1.0);
  });

  it("caps dense zh at 2.0", () => {
    const zhDense = "你".repeat(60);
    expect(api.fitRateForCue({ text: zhDense, targetLanguage: "zh", duration: 5, playbackRate: 1 })).toBe(2.0);
  });

  it("accounts for video playbackRate", () => {
    const ten = Array(10).fill("word").join(" ");
    expect(api.fitRateForCue({ text: ten, targetLanguage: "en", duration: 5, playbackRate: 2 })).toBeCloseTo(1.429, 3);
  });

  it("returns 1.0 for empty text", () => {
    expect(api.fitRateForCue({ text: "", targetLanguage: "vi", duration: 5, playbackRate: 1 })).toBe(1.0);
  });

  it("keeps th fit within bounds", () => {
    const rate = api.fitRateForCue({ text: "สวัสดีครับ ยินดีต้อนรับ", targetLanguage: "th", duration: 4, playbackRate: 1 });
    expect(rate).toBeGreaterThanOrEqual(1.0);
    expect(rate).toBeLessThanOrEqual(2.0);
  });

  it("refits a late line to the time that is left", () => {
    const cue = { start: 10, end: 15, translated: Array(14).fill("word").join(" ") };
    const next = { start: 15, end: 18 };
    const settings = { targetLanguage: "en" };
    // 14 words need exactly the 5s slot.
    expect(api.buildCueSpeechPlan(cue, next, settings, { videoNow: 10 }).rate).toBe(1.0);
    // 2.5s late: half the slot is left, so the line must go twice as fast.
    const late = api.buildCueSpeechPlan(cue, next, settings, { videoNow: 12.5 });
    expect(late.rate).toBe(2.0);
    expect(late.lagSeconds).toBe(2.5);
    expect(late.remainingSeconds).toBe(2.5);
    // Asked for early (start-latency lead), it still gets the whole slot.
    expect(api.buildCueSpeechPlan(cue, next, settings, { videoNow: 9.7, leadSeconds: 0.3 }).rate).toBe(1.0);
    // A 2x video halves the real time available.
    expect(api.buildCueSpeechPlan(cue, next, settings, { videoNow: 10, videoRate: 2 }).rate).toBe(2.0);
  });

  it("drops a late line that could not get a third of itself out", () => {
    expect(api.cannotFitLateCue({ lagSeconds: 3, neededSeconds: 6, remainingSeconds: 0.5 })).toBe(true);
    expect(api.cannotFitLateCue({ lagSeconds: 3, neededSeconds: 6, remainingSeconds: 2 })).toBe(false);
    // On time, a dense line is still spoken (at the ceiling).
    expect(api.cannotFitLateCue({ lagSeconds: 0, neededSeconds: 6, remainingSeconds: 0.5 })).toBe(false);
  });

  it("uses adaptive rate in auto mode and a fixed capped rate in manual mode", () => {
    expect(api.resolveSpeechRate({ calculatedRate: 1.5 })).toBe(1.5);
    expect(api.resolveSpeechRate({ calculatedRate: 0.9 })).toBe(1);
    expect(api.resolveSpeechRate({ calculatedRate: 5 })).toBe(2.0);
    expect(api.resolveSpeechRate({
      calculatedRate: 1.5,
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
    // Overlapping auto-caption cue: gone as soon as the next line replaces it.
    expect(api.isCueStale(12.5, { start: 10, end: 16 }, 0.25, { start: 12 })).toBe(true);
    // A real gap before the next line may be borrowed, but only briefly.
    expect(api.isCueStale(14, cue, 0.25, { start: 30 })).toBe(false);
    expect(api.isCueStale(15, cue, 0.25, { start: 30 })).toBe(true);
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

  it("always reuses the prefetched clip for baked-rate providers", async () => {
    const { window } = await createSandboxWindow();
    loadService("pipelines/caption-orchestrator.js", window);
    const api = window.LumeoCaptionOrchestrator;
    const cue = { start: 10, end: 12 };
    const plan = { rate: 1.0 };
    const prefetchedPlan = { rate: 1.0 };

    expect(api.selectCuePlaybackPlan({
      plan, prefetchedPlan, provider: "google-cloud",
    })).toEqual({ rate: 1.0, reusePrefetched: true });

    // Late: still the prefetched clip. The player closes the gap with
    // playbackRate instead of paying for a second synthesis round-trip.
    expect(api.selectCuePlaybackPlan({
      plan: { rate: 1.4 }, prefetchedPlan, provider: "google-cloud",
    })).toEqual({ rate: 1.0, reusePrefetched: true });

    // Custom voice applies rate at playback, so it keeps adapting.
    expect(api.selectCuePlaybackPlan({
      plan: { rate: 1.2 }, prefetchedPlan, provider: "custom-voice-engine",
    })).toEqual({ rate: 1.2, reusePrefetched: false });
  });

  it("re-plans a prefetched line when the manual speed changes", async () => {
    const { window } = await createSandboxWindow();
    loadService("pipelines/caption-orchestrator.js", window);
    const api = window.LumeoCaptionOrchestrator;
    const prefetch = vi.fn(async () => true);
    window.LumeoTTS = { prefetch };
    const session = {};
    const video = { currentTime: 10, playbackRate: 1 };
    const cue = { start: 10, end: 12, translated: "xin chào" };
    const next = { start: 12, end: 14 };
    const settings = { captionTtsProvider: "google-cloud", targetLanguage: "vi", ttsSpeedMode: "manual", ttsSpeed: 1 };
    const key = api.cueSpeechKey(cue, "xin chào");

    expect(api.prefetchCueSpeech(cue, next, settings, video, {}, session)).toBe(true);
    expect(session.prefetchedTtsPlans.get(key).rate).toBe(1);
    // Same speed: still one plan, one synthesis.
    expect(api.prefetchCueSpeech(cue, next, settings, video, {}, session)).toBe(false);

    const faster = { ...settings, ttsSpeed: 1.5 };
    // Played before the new prefetch lands: the stale 1.0x clip is not reused.
    expect(api.selectCuePlaybackPlan({
      plan: { rate: 1.5 },
      prefetchedPlan: session.prefetchedTtsPlans.get(key),
      provider: "google-cloud",
      manual: true,
    })).toEqual({ rate: 1.5, reusePrefetched: false });

    expect(api.prefetchCueSpeech(cue, next, faster, video, {}, session)).toBe(true);
    expect(session.prefetchedTtsPlans.get(key).rate).toBe(1.5);
    expect(prefetch).toHaveBeenCalledTimes(2);
    expect(prefetch.mock.calls[1][2]).toMatchObject({ rate: 1.5 });
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
      fromNow: false,
    });
    const playback = api.buildCueSpeechPlan(cue, next, settings, {
      videoNow: 10,
      videoRate: 1,
    });

    expect(playback.rate).toBe(prefetch.rate);
  });
});

describe("caption speakDueCue", () => {
  async function setupDue({ latency = 0 } = {}) {
    const { window } = await createSandboxWindow();
    loadService("pipelines/caption-orchestrator.js", window);
    const api = window.LumeoCaptionOrchestrator;
    window.LumeoTTS = { getStartLatency: () => latency, getPace: () => null };
    const cues = [
      { start: 10, end: 13, translated: "dòng một" },
      { start: 13, end: 16, translated: "" },
      { start: 16, end: 19, translated: "source text", __fallback: true },
    ];
    const spoken = [];
    const pipeline = {
      cues,
      cueAt: (t) => {
        const index = cues.findIndex((c, i) => t >= c.start && t < (cues[i + 1]?.start ?? c.end));
        return index >= 0 ? { cue: cues[index], index } : { cue: null, index: -1 };
      },
      speakCue: vi.fn((cue, options) => {
        spoken.push({ cue, options });
        return Promise.resolve(true);
      }),
    };
    const video = { currentTime: 0, playbackRate: 1 };
    const session = {};
    const settings = { captionTtsProvider: "browser", targetLanguage: "vi" };
    const run = () => api.speakDueCue({ pipeline, video, settings, session, ctx: {} });
    return { api, cues, pipeline, spoken, video, session, settings, run };
  }

  it("speaks each line once", async () => {
    const { run, video, spoken } = await setupDue();
    video.currentTime = 10.05;
    expect(run()).toBe(true);
    expect(run()).toBe(false);
    expect(spoken).toHaveLength(1);
    expect(spoken[0].options.rate).toBe(1.0);
  });

  it("asks for the line early by the voice's start latency", async () => {
    const { run, video, spoken } = await setupDue({ latency: 0.3 });
    video.currentTime = 9.6;
    expect(run()).toBe(false);
    video.currentTime = 9.75;
    expect(run()).toBe(true);
    expect(spoken[0].cue.start).toBe(10);
  });

  it("caps the lead so a bad latency sample cannot run ahead of the subtitle", async () => {
    const { api, settings } = await setupDue({ latency: 3 });
    expect(api.speechLeadSeconds(settings)).toBe(0.4);
  });

  it("speaks a translation that arrives while its line is on screen", async () => {
    const { run, video, cues, spoken } = await setupDue();
    video.currentTime = 13.1;
    expect(run()).toBe(false);
    cues[1] = { ...cues[1], translated: "dòng hai" };
    video.currentTime = 13.3;
    expect(run()).toBe(true);
    expect(spoken[0].cue.translated).toBe("dòng hai");
  });

  it("does not read a failed translation in the target voice", async () => {
    const { run, video, spoken } = await setupDue();
    video.currentTime = 16.1;
    expect(run()).toBe(false);
    expect(spoken).toHaveLength(0);
  });

  it("skips a line the video is about to leave", async () => {
    const { run, video, cues, spoken } = await setupDue();
    cues[0] = { ...cues[0], translated: Array(30).fill("từ").join(" ") };
    video.currentTime = 12.8;
    expect(run()).toBe(false);
    expect(spoken).toHaveLength(0);
  });

  it("repeats a line cut off by a pause but not one that finished", async () => {
    const { run, video, session, spoken } = await setupDue();
    video.currentTime = 10.05;
    run();
    await Promise.resolve();
    expect(session.finishedSpeechKey).toBe(session.lastSpokenKey);
    expect(run()).toBe(false);
    expect(spoken).toHaveLength(1);
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
