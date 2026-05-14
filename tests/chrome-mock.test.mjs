import { describe, it, expect, vi } from "vitest";
import { createChromeMock } from "./helpers/chrome-mock.mjs";

describe("chrome mock helper", () => {
  it("mocks storage get/set with default values", async () => {
    const chrome = createChromeMock({ storage: { existing: "value" } });

    await chrome.storage.local.set({ added: 42 });

    await expect(chrome.storage.local.get("existing")).resolves.toEqual({ existing: "value" });
    await expect(chrome.storage.local.get(["existing", "added"])).resolves.toEqual({ existing: "value", added: 42 });
    await expect(chrome.storage.local.get({ missing: "fallback", added: 0 })).resolves.toEqual({ missing: "fallback", added: 42 });
  });

  it("supports runtime and tab message handlers", async () => {
    const onRuntimeMessage = vi.fn(() => ({ ok: true, from: "runtime" }));
    const onTabMessage = vi.fn(() => ({ ok: true, from: "tab" }));
    const chrome = createChromeMock({ onRuntimeMessage, onTabMessage });
    const listener = vi.fn();

    chrome.runtime.onMessage.addListener(listener);

    await expect(chrome.runtime.sendMessage({ type: "PING" })).resolves.toEqual({ ok: true, from: "runtime" });
    await expect(chrome.tabs.sendMessage(1, { type: "PING" })).resolves.toEqual({ ok: true, from: "tab" });
    expect(chrome.__runtimeListeners).toEqual([listener]);
    expect(onRuntimeMessage).toHaveBeenCalledWith({ type: "PING" });
    expect(onTabMessage).toHaveBeenCalledWith(1, { type: "PING" });
  });
});
