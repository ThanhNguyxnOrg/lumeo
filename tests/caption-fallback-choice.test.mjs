import { describe, it, expect, vi } from "vitest";
import { createSandboxWindow, loadService } from "./helpers/load-service.mjs";

async function setup() {
  const { window } = await createSandboxWindow();
  loadService("ui/caption-fallback-choice.js", window);
  return { window, api: window.LumeoCaptionFallbackChoice };
}

describe("ui/caption-fallback-choice.js", () => {
  it("renders no-caption fallback choices and track diagnostics", async () => {
    const { window, api } = await setup();
    const callbacks = {
      onGroq: vi.fn(),
      onSoniox: vi.fn(),
      onStandard: vi.fn(),
      onRetry: vi.fn(),
      onCancel: vi.fn(),
    };

    const node = api.create({
      reason: "No track",
      diagnostics: { reason: "no-target-language", tracks: [{ languageCode: "en", kind: "asr", name: "English" }] },
      ...callbacks,
    });

    expect(node.querySelector("strong").textContent).toBe("No matching caption language");
    expect(node.textContent).toContain("No track");
    expect(node.textContent).toContain("Detected tracks (1)");
    expect(node.textContent).toContain("en · auto — English");

    const buttons = Array.from(node.querySelectorAll("button"));
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Try Groq Whisper",
      "Try Soniox STT",
      "Switch to Standard Dub",
      "Retry caption fetch",
      "Cancel",
    ]);

    for (const button of buttons) button.click();
    expect(callbacks.onGroq).toHaveBeenCalledOnce();
    expect(callbacks.onSoniox).toHaveBeenCalledOnce();
    expect(callbacks.onStandard).toHaveBeenCalledOnce();
    expect(callbacks.onRetry).toHaveBeenCalledOnce();
    expect(callbacks.onCancel).toHaveBeenCalledOnce();
    expect(window.LumeoCaptionFallbackChoice.__loaded).toBe(true);
  });

  it("maps fallback titles by failure reason", async () => {
    const { api } = await setup();

    expect(api.fallbackTitle({ reason: "timedtext-empty-body" })).toBe("YouTube returned empty captions");
    expect(api.fallbackTitle({ reason: "other" })).toBe("No YouTube captions found");
  });
});
