import { describe, it, expect, beforeEach, vi } from "vitest";
import { createChromeMock } from "./helpers/chrome-mock.mjs";
import { createSandboxWindow, loadService } from "./helpers/load-service.mjs";

function cues() {
  return [
    { start: 0, end: 1, text: "hello" },
    { start: 1, end: 2, text: "world" },
  ];
}

async function setup({ cache = { entries: {} }, subtitles } = {}) {
  const { window } = await createSandboxWindow();
  window.Date.now = () => Date.now();
  let storedCache = cache;
  window.chrome = createChromeMock({
    onRuntimeMessage(message) {
      if (message.action === "captionCacheGet") return { ok: true, cache: storedCache };
      if (message.action === "captionCacheSet") {
        storedCache = message.cache;
        return { ok: true };
      }
      return { ok: true };
    },
  });
  window.LumeoCaptions = {
    fetchSubtitles: vi.fn(async (options) => {
      if (subtitles) return subtitles;
      options.diagnostics.reason = "no-tracks";
      return { cues: [] };
    }),
  };
  window.LumeoTranslate = { translateBatch: vi.fn(async (texts) => texts.map((text) => `${text}-vi`)) };
  window.LumeoTTS = { speak: vi.fn(async () => true), stop: vi.fn() };
  window.LumeoSonioxSTT = { stop: vi.fn() };
  window.LumeoSrtExport = {
    makeSubtitleZip: vi.fn(() => new window.Blob(["zip"])),
    sanitizeFilename: vi.fn((title) => title.replaceAll(" ", "_")),
    downloadBlob: vi.fn(),
  };
  loadService("pipelines/caption.js", window);
  return { window, api: window.LumeoCaptionPipeline, getCache: () => storedCache };
}

describe("pipelines/caption.js", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
  });

  it("returns no-caption fallback diagnostics when YouTube exposes no tracks", async () => {
    const { window, api } = await setup();
    const pipeline = api.create();

    const result = await pipeline.start({ videoId: "missing", targetLanguage: "vi", targetLanguageName: "Vietnamese" });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("YouTube did not expose any caption tracks");
    expect(result.diagnostics.reason).toBe("no-tracks");
    expect(window.LumeoTranslate.translateBatch).not.toHaveBeenCalled();
  });

  it("explains timedtext unavailability with retry and fallback CTA", async () => {
    const { window, api } = await setup({
      subtitles: null,
    });
    const pipeline = api.create();
    window.LumeoCaptions.fetchSubtitles.mockImplementationOnce(async (options) => {
      options.diagnostics.reason = "timedtext-fetch-failed";
      options.diagnostics.tracks = [{ languageCode: "en", kind: "asr" }];
      return { cues: [] };
    });

    const result = await pipeline.start({ videoId: "timedtext", targetLanguage: "vi" });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("YouTube captions are temporarily unavailable");
    expect(result.error).toContain("Retry");
    expect(result.error).toContain("fallback");
  });

  it("translates source cues, writes cache, and finds active cue by time", async () => {
    const { window, api, getCache } = await setup({
      subtitles: { videoId: "abc", sourceLanguage: "en", nativeTarget: false, cues: cues() },
    });
    const pipeline = api.create();
    const onProgress = vi.fn();

    const result = await pipeline.start({ videoId: "abc", targetLanguage: "vi", translateProvider: "google-free", onProgress });

    expect(result.ok).toBe(true);
    expect(window.LumeoTranslate.translateBatch).toHaveBeenCalledWith(["hello", "world"], "vi", expect.objectContaining({ provider: "google-free" }));
    expect(result.cues.map((cue) => cue.translated)).toEqual(["hello-vi", "world-vi"]);
    expect(onProgress).toHaveBeenNthCalledWith(1, { phase: "translating", completed: 0, total: 2 });
    expect(onProgress).toHaveBeenNthCalledWith(2, { phase: "translated", completed: 2, total: 2 });
    expect(pipeline.cueAt(1.25)).toEqual({ cue: result.cues[1], index: 1 });
    expect(pipeline.cueAt(3)).toEqual({ cue: null, index: -1 });
    expect(Object.keys(getCache().entries)).toEqual(["abc::vi::google-free::en"]);
    expect(getCache().entries["abc::vi::google-free::en"]).toMatchObject({ version: api.CACHE_VERSION });
    expect(getCache().entries["abc::vi::google-free::en"].updatedAt).toBeGreaterThan(0);
    expect(getCache().stats.ttlMs).toBe(api.CACHE_TTL_MS);
  });

  it("uses cached translated cues without calling translation", async () => {
    const cachedCues = [{ start: 0, end: 1, text: "hello", translated: "xin chào" }];
    const { window, api } = await setup({
      cache: { entries: { "abc::vi::google-free::en": { cues: cachedCues, version: 2, updatedAt: 9_000_000_000_000 } } },
      subtitles: { videoId: "abc", sourceLanguage: "en", nativeTarget: false, cues: cues() },
    });

    const onProgress = vi.fn();
    const result = await api.create().start({ videoId: "abc", targetLanguage: "vi", translateProvider: "google-free", onProgress });

    expect(result.ok).toBe(true);
    expect(result.cues).toBe(cachedCues);
    expect(onProgress).toHaveBeenCalledWith({ phase: "cached", completed: 1, total: 1 });
    expect(result.meta.cached).toBe(true);
    expect(window.LumeoTranslate.translateBatch).not.toHaveBeenCalled();
  });

  it("resumes translation from partial cached cues", async () => {
    const partialCues = [
      { start: 0, end: 1, text: "hello", translated: "xin chào" },
      { start: 1, end: 2, text: "world" },
    ];
    const { window, api, getCache } = await setup({
      cache: {
        entries: {
          "abc::vi::google-free::en": {
            cues: partialCues,
            meta: { progress: { completed: 1, total: 2 }, resume: true },
            version: 2,
            updatedAt: 9_000_000_000_000,
          },
        },
      },
      subtitles: { videoId: "abc", sourceLanguage: "en", nativeTarget: false, cues: cues() },
    });
    const onProgress = vi.fn();

    const result = await api.create().start({ videoId: "abc", targetLanguage: "vi", translateProvider: "google-free", onProgress });

    expect(result.ok).toBe(true);
    expect(window.LumeoTranslate.translateBatch).toHaveBeenCalledWith(["world"], "vi", expect.objectContaining({ provider: "google-free" }));
    expect(result.cues.map((cue) => cue.translated)).toEqual(["xin chào", "world-vi"]);
    expect(onProgress).toHaveBeenNthCalledWith(1, { phase: "resuming", completed: 1, total: 2 });
    expect(onProgress).toHaveBeenLastCalledWith({ phase: "translated", completed: 2, total: 2 });
    expect(getCache().entries["abc::vi::google-free::en"].meta.progress).toEqual({ completed: 2, total: 2 });
    expect(getCache().entries["abc::vi::google-free::en"].meta.resume).toBe(false);
  });

  it("persists partial resume state after each translation batch", async () => {
    const { window, api, getCache } = await setup({
      subtitles: { videoId: "abc", sourceLanguage: "en", nativeTarget: false, cues: cues() },
    });
    window.LumeoTranslate.translateBatch = vi
      .fn()
      .mockResolvedValueOnce(["xin chào"])
      .mockRejectedValueOnce(new Error("provider down"));

    await expect(api.create().start({ videoId: "abc", targetLanguage: "vi", translateProvider: "google-free", batchSize: 1 })).rejects.toThrow("provider down");

    const entry = getCache().entries["abc::vi::google-free::en"];
    expect(entry).toMatchObject({ version: api.CACHE_VERSION });
    expect(entry.cues.map((cue) => cue.translated || null)).toEqual(["xin chào", null]);
    expect(entry.meta.progress).toEqual({ completed: 1, total: 2 });
    expect(entry.meta.resume).toBe(true);
  });

  it("ignores stale cache entries by version and TTL", async () => {
    const cachedCues = [{ start: 0, end: 1, text: "hello", translated: "stale" }];
    const { window, api } = await setup({
      cache: {
        entries: {
          "abc::vi::google-free::en": { cues: cachedCues, version: 1, updatedAt: 1_700_000_000_000 },
          "abc::vi::google-free::auto": { cues: cachedCues, version: 2, updatedAt: 1_700_000_000_000 - (30 * 24 * 60 * 60 * 1000) - 1 },
        },
      },
      subtitles: { videoId: "abc", sourceLanguage: "en", nativeTarget: false, cues: cues() },
    });

    const result = await api.create().start({ videoId: "abc", targetLanguage: "vi", translateProvider: "google-free" });

    expect(result.ok).toBe(true);
    expect(result.meta.cached).toBe(false);
    expect(window.LumeoTranslate.translateBatch).toHaveBeenCalled();
  });

  it("caps cache by newest 50 entries", async () => {
    const entries = Object.fromEntries(
      Array.from({ length: 55 }, (_, index) => [
        `old-${index}`,
        { version: 2, updatedAt: Date.now() - 1000 - index, cues: [{ text: `old ${index}` }] },
      ]),
    );
    const { api, getCache } = await setup({
      cache: { entries },
      subtitles: { videoId: "fresh", sourceLanguage: "en", nativeTarget: true, cues: cues() },
    });

    await api.create().start({ videoId: "fresh", targetLanguage: "vi", translateProvider: "google-free" });

    const keys = Object.keys(getCache().entries);
    expect(keys).toHaveLength(50);
    expect(keys).toContain("fresh::vi::google-free::en");
    expect(keys).not.toContain("old-54");
  });

  it("describes caption source and cache quality", async () => {
    const { api } = await setup();

    expect(api.describeCaptionQuality({ nativeTarget: true, sourceLanguage: "vi" })).toBe("YouTube native · direct");
    expect(api.describeCaptionQuality({ cached: true, sourceLanguage: "en" })).toBe("YouTube captions · cached");
    expect(api.describeCaptionQuality({ sourceLanguage: "en", tracks: [{ languageCode: "en", kind: "asr" }] })).toBe("Auto captions · translated");
    expect(api.describeCaptionQuality(null)).toBe("Unknown captions");
  });

  it("delegates speech and export helpers", async () => {
    const { window, api } = await setup({
      subtitles: { videoId: "abc", sourceLanguage: "en", nativeTarget: true, cues: cues() },
    });
    const pipeline = api.create();
    await pipeline.start({ videoId: "abc", targetLanguage: "vi" });

    await expect(pipeline.speakCue({ translated: "xin chào" }, { targetLanguage: "vi", volume: 0.5 })).resolves.toBe(true);
    pipeline.exportZip("my video");
    pipeline.stop();

    expect(window.LumeoTTS.speak).toHaveBeenCalledWith("xin chào", "vi", expect.objectContaining({ volume: 0.5 }));
    expect(window.LumeoSrtExport.downloadBlob).toHaveBeenCalledWith(expect.any(window.Blob), "my_video_lumeo_subtitles.zip");
    expect(window.LumeoTTS.stop).toHaveBeenCalled();
    expect(window.LumeoSonioxSTT.stop).toHaveBeenCalled();
  });

  it("smart failover to google-free when paid translation provider fails", async () => {
    const { window, api } = await setup({
      subtitles: { videoId: "failover-test", sourceLanguage: "en", nativeTarget: false, cues: cues() },
    });
    const pipeline = api.create();
    const onFailover = vi.fn();

    // Mock translateBatch: first call fails (e.g. 429 quota exhaustion on openrouter), fallback call succeeds with google-free
    window.LumeoTranslate.translateBatch = vi.fn()
      .mockRejectedValueOnce(new Error("429 Quota Exceeded"))
      .mockResolvedValueOnce(["hello-gf", "world-gf"]);

    const result = await pipeline.start({
      videoId: "failover-test",
      targetLanguage: "vi",
      translateProvider: "openrouter",
      onFailover,
    });

    expect(result.ok).toBe(true);
    expect(onFailover).toHaveBeenCalledWith({
      from: "openrouter",
      to: "google-free",
      error: "429 Quota Exceeded",
    });
    expect(result.cues.map((c) => c.translated)).toEqual(["hello-gf", "world-gf"]);
    expect(window.LumeoTranslate.translateBatch).toHaveBeenNthCalledWith(
      1,
      ["hello", "world"],
      "vi",
      expect.objectContaining({ provider: "openrouter" }),
    );
    expect(window.LumeoTranslate.translateBatch).toHaveBeenNthCalledWith(
      2,
      ["hello", "world"],
      "vi",
      expect.objectContaining({ provider: "google-free" }),
    );
  });

  it("translates secondaryLanguage when different from source and stores isolated cache", async () => {
    const { window, api, getCache } = await setup({
      subtitles: { videoId: "bilingual-test", sourceLanguage: "en", nativeTarget: false, cues: cues() },
    });
    const pipeline = api.create();

    window.LumeoTranslate.translateBatch = vi.fn()
      .mockResolvedValueOnce(["hello-vi", "world-vi"])
      .mockResolvedValueOnce(["konnichiwa", "sekai"]);

    const result = await pipeline.start({
      videoId: "bilingual-test",
      targetLanguage: "vi",
      secondaryLanguage: "ja",
      translateProvider: "google-free",
    });

    expect(result.ok).toBe(true);
    expect(result.cues[0].translated).toBe("hello-vi");
    expect(result.cues[0].secondaryTranslated).toBe("konnichiwa");
    expect(result.cues[1].secondaryTranslated).toBe("sekai");

    const expectedKey = "bilingual-test::vi::google-free::en::ja";
    expect(Object.keys(getCache().entries)).toEqual([expectedKey]);
  });

  it("applies sliding-window lookahead for google-free when total cues exceed 35", async () => {
    const longCues = Array.from({ length: 60 }, (_, i) => ({
      start: i * 5,
      end: (i + 1) * 5,
      text: `cue ${i}`,
    }));
    const { window, api } = await setup({
      subtitles: { videoId: "long-video", sourceLanguage: "en", nativeTarget: false, cues: longCues },
    });
    const pipeline = api.create();

    window.LumeoTranslate.translateBatch = vi.fn((texts) => texts.map((t) => `${t}-vi`));

    const result = await pipeline.start({
      videoId: "long-video",
      targetLanguage: "vi",
      translateProvider: "google-free",
      currentTime: 0,
    });

    expect(result.ok).toBe(true);
    // Initial batch translates only sliding window (~25 to 40 cues), not all 60 cues
    const translatedCount = result.cues.filter((c) => c.translated).length;
    expect(translatedCount).toBeLessThan(60);
    expect(translatedCount).toBeGreaterThanOrEqual(25);

    // Later cue is untranslated initially
    expect(result.cues[55].translated).toBeFalsy();

    // Advancing playback triggers checkAndTranslateAhead
    pipeline.cueAt(260); // near cue 52 (52 * 5 = 260s)
    await new Promise((r) => setTimeout(r, 10));

    expect(window.LumeoTranslate.translateBatch).toHaveBeenCalled();
  });
});

