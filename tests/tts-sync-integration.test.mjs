import { describe, it, expect, vi } from "vitest";
import { createSandboxWindow, loadService } from "./helpers/load-service.mjs";

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

// Simulates speechSynthesis with a deterministic duration per utterance so the
// queue/catch-up behavior can be tested without a browser.
async function setupTts({ msPerChar = 30 } = {}) {
  const { window } = await createSandboxWindow();
  const utterances = [];
  let active = 0;
  let maxActive = 0;

  window.speechSynthesis = {
    cancel: vi.fn(),
    speak: vi.fn((utterance) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      const rate = Math.max(0.1, Number(utterance.rate) || 1);
      const duration = Math.max(5, Math.min(600, Math.round(String(utterance.text || "").length * msPerChar / rate)));
      window.setTimeout(() => {
        active = Math.max(0, active - 1);
        try {
          utterance.onend?.();
        } catch {}
      }, duration);
    }),
    getVoices: () => [{ name: "Test Voice", lang: "en-US" }],
  };
  window.SpeechSynthesisUtterance = function SpeechSynthesisUtterance(text) {
    this.text = text;
    utterances.push(this);
  };
  loadService("services/tts-browser.js", window);
  return {
    window,
    api: window.LumeoTTS,
    utterances,
    stats: () => ({ active, maxActive }),
  };
}

describe("TTS sync behavior (integration)", () => {
  it("finishes the active line before the next one starts", async () => {
    const { window, api, utterances, stats } = await setupTts();
    const first = api.speakQueued("first line", "en", {});
    await tick(5);
    expect(utterances).toHaveLength(1);

    const cancelCallsBefore = window.speechSynthesis.cancel.mock.calls.length;
    const second = api.speakQueued("second line", "en", {});
    await tick(5);
    // The second line must wait: no new utterance and no mid-line cancel.
    expect(utterances).toHaveLength(1);
    expect(window.speechSynthesis.cancel.mock.calls.length).toBe(cancelCallsBefore);

    await expect(first).resolves.toBe(true);
    await tick(5);
    expect(utterances).toHaveLength(2);
    await expect(second).resolves.toBe(true);
    expect(stats().maxActive).toBe(1);
  });

  it("drops a queued line once the video has moved past it", async () => {
    const video = { currentTime: 0 };
    const { api } = await setupTts();
    const first = api.speakQueued("first line", "en", {});
    await tick(5);

    const skipped = vi.fn();
    const second = api.speakQueued("second line", "en", {
      isStale: () => video.currentTime > 10,
      onSkip: skipped,
    });
    video.currentTime = 20;
    const third = api.speakQueued("third line", "en", {});

    await expect(second).resolves.toBe(false);
    expect(skipped).toHaveBeenCalledWith(expect.objectContaining({ reason: "stale" }));
    await expect(first).resolves.toBe(true);
    await expect(third).resolves.toBe(true);
  });

  it("clamps requested rates to the browser-safe range", async () => {
    const { api, utterances } = await setupTts();
    const fast = api.speakQueued("fast line", "en", { rate: 3.5 });
    await tick(5);
    expect(utterances[0].rate).toBe(2.0);
    await expect(fast).resolves.toBe(true);

    const slow = api.speakQueued("slow line", "en", { rate: 0.1 });
    await tick(5);
    expect(utterances[1].rate).toBe(0.5);
    await expect(slow).resolves.toBe(true);
  });

  it("recovers by skipping a late cue and plays the newest line", async () => {
    const video = { currentTime: 0 };
    const { api, utterances } = await setupTts();
    const first = api.speakQueued("first line", "en", {});
    await tick(5);

    // Simulate the video running 2 seconds ahead of the queued cue.
    video.currentTime = 2;
    const skipped = vi.fn();
    const late = api.speakQueued("late line", "en", {
      rate: Math.min(2.0, 1.0 + video.currentTime * 0.25),
      isStale: () => video.currentTime > 10,
      onSkip: skipped,
    });
    video.currentTime = 11;
    const newest = api.speakQueued("newest line", "en", {});

    await expect(late).resolves.toBe(false);
    expect(skipped).toHaveBeenCalledWith(expect.objectContaining({ reason: "stale" }));
    await expect(first).resolves.toBe(true);
    await expect(newest).resolves.toBe(true);
  });

  it("never plays a cloud line whose fetch finishes after stop", async () => {
    const { window, api } = await setupTts();
    let releaseFetch;
    const play = vi.fn(() => Promise.resolve());
    window.fetch = vi.fn(() => new Promise((resolve) => {
      releaseFetch = () => resolve({ ok: true, blob: async () => ({}) });
    }));
    window.URL = { createObjectURL: () => "blob:cloud", revokeObjectURL: () => {} };
    window.Audio = class {
      constructor() { this.play = play; }
      addEventListener() {}
      pause() {}
    };

    const task = api.speakQueued("cloud line", "en", {
      provider: "custom-voice-engine",
      customTtsBaseUrl: "https://api.example.com/v1",
      customTtsVoiceId: "voice-1",
      stallTimeoutMs: 200,
    });
    await tick(5);
    api.stop();
    releaseFetch();
    await expect(task).resolves.toBe(false);
    expect(play).not.toHaveBeenCalled();
  });

  it("treats a speech error as failed so the queue does not stall", async () => {
    const { window, api, utterances } = await setupTts();
    window.speechSynthesis.speak = vi.fn(() => {
      const utterance = utterances[utterances.length - 1];
      window.setTimeout(() => utterance.onerror?.({ error: "not-allowed" }), 2);
    });
    const result = await api.speakQueued("blocked line", "en", {});
    expect(result).toBe(false);
  });

  it("advances the queue when an utterance never ends", async () => {
    const { window, api } = await setupTts();
    window.speechSynthesis.speak = vi.fn();
    const result = await api.speakQueued("stuck line", "en", { stallTimeoutMs: 20 });
    expect(result).toBe(false);
  });

  it("stop() drains queued lines and a late end starts nothing new", async () => {
    const { window, api, utterances } = await setupTts();
    const first = api.speakQueued("first line", "en", { stallTimeoutMs: 200 });
    await tick(5);
    const second = api.speakQueued("second line", "en", { stallTimeoutMs: 200 });
    const third = api.speakQueued("third line", "en", { stallTimeoutMs: 200 });

    api.stop();
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(false);
    await expect(third).resolves.toBe(false);

    const count = utterances.length;
    utterances[0]?.onend?.();
    await tick(10);
    expect(utterances.length).toBe(count);
    expect(window.speechSynthesis.speak).toHaveBeenCalledTimes(count);
  });
});
