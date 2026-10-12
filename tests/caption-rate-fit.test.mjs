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

  it("speeds up dense EN within 1.10 cap", () => {
    const dense = Array(20).fill("word").join(" ");
    expect(api.fitRateForCue({ text: dense, targetLanguage: "en", duration: 5, playbackRate: 1 })).toBeCloseTo(1.096, 3);
    const veryDense = Array(30).fill("word").join(" ");
    expect(api.fitRateForCue({ text: veryDense, targetLanguage: "en", duration: 5, playbackRate: 1 })).toBe(1.1);
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

  it("caps dense zh at 1.10", () => {
    const zhDense = "你".repeat(35);
    expect(api.fitRateForCue({ text: zhDense, targetLanguage: "zh", duration: 5, playbackRate: 1 })).toBe(1.1);
  });

  it("accounts for video playbackRate", () => {
    const ten = Array(10).fill("word").join(" ");
    expect(api.fitRateForCue({ text: ten, targetLanguage: "en", duration: 5, playbackRate: 2 })).toBeCloseTo(1.096, 3);
  });

  it("returns 1.0 for empty text", () => {
    expect(api.fitRateForCue({ text: "", targetLanguage: "vi", duration: 5, playbackRate: 1 })).toBe(1.0);
  });

  it("keeps th fit within bounds", () => {
    const rate = api.fitRateForCue({ text: "สวัสดีครับ ยินดีต้อนรับ", targetLanguage: "th", duration: 4, playbackRate: 1 });
    expect(rate).toBeGreaterThanOrEqual(0.9);
    expect(rate).toBeLessThanOrEqual(1.1);
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
