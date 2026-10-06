import { describe, it, expect, beforeEach } from "vitest";
import { createChromeMock } from "./helpers/chrome-mock.mjs";

describe("Phase 1: Security Pruning & Shorts URL Support", () => {
  beforeEach(async () => {
    globalThis.chrome = createChromeMock();
    await import("../services/providers.js");
    await import("../background.js");
    await import("../lib/platform-adapters.js");
  });

  it("pruneSettingsForContent leaves only needed keys for google-free caption mode", () => {
    const prune = globalThis.LumeoBackground?.pruneSettingsForContent;
    expect(typeof prune).toBe("function");

    const fullSettings = {
      tier: "caption",
      translateProvider: "google-free",
      captionTtsProvider: "off",
      sttProvider: "none",
      openaiKey: "sk-openai-secret",
      geminiKey: "ai-gemini-secret",
      kymaKey: "kyma-secret-token",
      groqApiKey: "gsk-groq-secret",
    };

    const pruned = prune(fullSettings);
    // For free caption, all commercial keys must be stripped/blanked out
    expect(pruned.openaiKey).toBe("");
    expect(pruned.geminiKey).toBe("");
    expect(pruned.kymaKey).toBe("");
    expect(pruned.groqApiKey).toBe("");
  });

  it("pruneSettingsForContent preserves openaiKey when openai translate is active", () => {
    const prune = globalThis.LumeoBackground?.pruneSettingsForContent;
    const settings = {
      tier: "caption",
      translateProvider: "openai",
      captionTtsProvider: "off",
      sttProvider: "none",
      openaiKey: "sk-my-openai-key",
      geminiKey: "ai-gemini-secret",
      kymaKey: "kyma-secret-token",
    };

    const pruned = prune(settings);
    expect(pruned.openaiKey).toBe("sk-my-openai-key");
    expect(pruned.geminiKey).toBe("");
    expect(pruned.kymaKey).toBe("");
  });

  it("extracts video ID accurately from standard and Shorts URLs", () => {
    const adapter = globalThis.LumeoPlatformAdapters?.getAdapter("https://www.youtube.com");
    expect(adapter).toBeDefined();

    expect(adapter.getVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(adapter.getVideoId("https://www.youtube.com/shorts/9bZkp7q19f0")).toBe("9bZkp7q19f0");
    expect(adapter.getVideoId("https://www.youtube.com/shorts/abc-123_XYZ?feature=share")).toBe("abc-123_XYZ");
    expect(adapter.getVideoId("https://www.youtube.com/live/liveVideo123")).toBe("liveVideo123");
    expect(adapter.getVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(adapter.getVideoId("https://example.com/other")).toBe(null);
  });
});
