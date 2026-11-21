import { describe, it, expect, vi } from "vitest";
import { createSandboxWindow, loadService } from "./helpers/load-service.mjs";

describe("no-caption fallback provider key", () => {
  it("selects the STT provider before asking the background for its key", async () => {
    const { window } = await createSandboxWindow();
    const calls = [];
    let selected = "none";
    window.LumeoBrowserApi = {
      sendRuntimeMessage: vi.fn(async (message) => {
        calls.push(message.type);
        selected = message.settings.sttProvider;
        return { ok: true };
      }),
    };
    window.chrome = {
      runtime: {
        // Mirrors the background: a key is served only to the selected provider.
        sendMessage: vi.fn((message, callback) => {
          calls.push(message.type);
          callback(selected === "groq-whisper" && message.key === "groqApiKey"
            ? { ok: true, key: "gsk-secret" }
            : { ok: false, error: "Provider key is not in use." });
        }),
      },
    };
    loadService("pipelines/caption-orchestrator.js", window);
    const api = window.LumeoCaptionOrchestrator;
    const settings = { translateProvider: "google-free", sttProvider: "none" };
    const start = vi.fn(async () => ({ ok: true }));
    api.startCaptionGroqFallback = start;
    const showToast = vi.fn();

    await api.startGroqChoice({}, 1, {}, "no captions", {
      getSettings: () => settings,
      showToast,
      onStateChange: vi.fn(),
    });

    expect(calls).toEqual(["UPDATE_SETTINGS", "GET_PROVIDER_KEY"]);
    expect(settings).toMatchObject({ groqApiKey: "gsk-secret", sttProvider: "groq-whisper" });
    expect(start).toHaveBeenCalledTimes(1);
    expect(showToast).not.toHaveBeenCalled();
  });
});
