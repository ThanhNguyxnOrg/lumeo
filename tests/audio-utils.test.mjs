import { describe, it, expect, beforeAll } from "vitest";
import { createSandboxWindow, loadService } from "./helpers/load-service.mjs";

describe("lib/audio-utils.js — pure helpers", () => {
  let api;
  let window;

  beforeAll(async () => {
    ({ window } = await createSandboxWindow());
    loadService("lib/audio-utils.js", window);
    api = window.LumeoAudioUtils;
  });

  it("publishes the expected helper surface", () => {
    expect(api.__loaded).toBe(true);
    expect(typeof api.captureWithRetry).toBe("function");
    expect(typeof api.webmBlobToWav).toBe("function");
    expect(typeof api.audioBufferToWavBlob).toBe("function");
    expect(typeof api.downmixAndResample).toBe("function");
    expect(typeof api.pickRecorderMime).toBe("function");
  });

  it("downmixAndResample halves the buffer when target rate is half the source rate", () => {
    const srcRate = 32000;
    const targetRate = 16000;
    const samples = new Float32Array(1000);
    for (let i = 0; i < samples.length; i += 1) samples[i] = Math.sin(i / 50);
    const audioBuf = {
      sampleRate: srcRate,
      numberOfChannels: 1,
      length: samples.length,
      getChannelData: () => samples,
    };
    const out = api.downmixAndResample(audioBuf, targetRate);
    expect(out.length).toBe(Math.floor(samples.length / 2));
  });

  it("downmixAndResample averages stereo channels to mono", () => {
    const left = new Float32Array([1, 1, 1, 1]);
    const right = new Float32Array([-1, -1, -1, -1]);
    const audioBuf = {
      sampleRate: 16000,
      numberOfChannels: 2,
      length: 4,
      getChannelData: (ch) => (ch === 0 ? left : right),
    };
    const out = api.downmixAndResample(audioBuf, 16000);
    expect(Array.from(out)).toEqual([0, 0, 0, 0]);
  });

  it("audioBufferToWavBlob emits a WAV with the correct RIFF header", async () => {
    const samples = new Float32Array(16); // 1ms at 16 kHz
    const audioBuf = {
      sampleRate: 16000,
      numberOfChannels: 1,
      length: samples.length,
      getChannelData: () => samples,
    };
    const blob = api.audioBufferToWavBlob(audioBuf);
    expect(blob.type).toBe("audio/wav");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // "RIFF....WAVEfmt "
    const header = String.fromCharCode(...bytes.slice(0, 4));
    expect(header).toBe("RIFF");
    const format = String.fromCharCode(...bytes.slice(8, 12));
    expect(format).toBe("WAVE");
    const fmt = String.fromCharCode(...bytes.slice(12, 16));
    expect(fmt).toBe("fmt ");
  });
});
