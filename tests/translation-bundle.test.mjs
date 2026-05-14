import { describe, it, expect, beforeAll } from "vitest";
import { createSandboxWindow, loadService } from "./helpers/load-service.mjs";

describe("services/translation-bundle.js", () => {
  let api;

  beforeAll(async () => {
    const { window } = await createSandboxWindow();
    window.LumeoSrtExport = { sanitizeFilename: (value) => String(value).replaceAll("/", "_") };
    loadService("services/translation-bundle.js", window);
    api = window.LumeoTranslationBundle;
  });

  it("creates a portable JSON bundle from a cached caption entry", () => {
    const bundle = api.createBundle(
      {
        cues: [
          { start: 0, end: 1, text: "hello", translated: "xin chào" },
          { start: 1, end: 2, text: "world", translated: "thế giới" },
        ],
        meta: { videoId: "abc", sourceLanguage: "en", targetLanguage: "vi", provider: "google-free" },
      },
      { title: "Demo/Video" },
    );

    expect(bundle.kind).toBe("lumeo.translationBundle");
    expect(bundle.version).toBe(1);
    expect(bundle.videoId).toBe("abc");
    expect(bundle.targetLanguage).toBe("vi");
    expect(bundle.cues).toHaveLength(2);
    expect(api.filenameForBundle(bundle)).toBe("Demo_Video_vi_lumeo_bundle.json");
  });

  it("parses a bundle into a caption-cache entry key", () => {
    const parsed = api.parseBundle({
      kind: "lumeo.translationBundle",
      version: 1,
      videoId: "abc",
      targetLanguage: "vi",
      provider: "google-free",
      sourceLanguage: "en",
      cues: [{ start: 0, end: 1, text: "hello", translated: "xin chào" }],
      meta: { title: "Demo" },
    });

    expect(parsed.key).toBe("abc::vi::google-free::en");
    expect(parsed.entry.version).toBe(2);
    expect(parsed.entry.updatedAt).toEqual(expect.any(Number));
    expect(parsed.entry.meta.cached).toBe(true);
    expect(parsed.entry.meta.progress).toEqual({ completed: 1, total: 1 });
  });

  it("rejects malformed or incompatible bundles", () => {
    expect(() => api.parseBundle({ kind: "other", version: 1 })).toThrow("Not a Lumeo");
    expect(() => api.parseBundle({ kind: api.KIND, version: 99 })).toThrow("Unsupported");
    expect(() => api.parseBundle({ kind: api.KIND, version: 1, videoId: "abc", targetLanguage: "vi", cues: [] })).toThrow("no cues");
  });
});
