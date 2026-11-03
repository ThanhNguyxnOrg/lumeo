import { describe, it, expect, beforeAll } from "vitest";
import { createChromeMock } from "./helpers/chrome-mock.mjs";

let listener;

function ask(message, sender = {}) {
  return new Promise((resolve) => {
    const handled = listener(message, sender, resolve);
    if (handled !== true) {
      // Synchronous handlers already called sendResponse.
    }
  });
}

describe("background message boundary", () => {
  beforeAll(async () => {
    globalThis.chrome = createChromeMock();
    await import("../background.js");
    listener = globalThis.chrome.__runtimeListeners[0];
    globalThis.chrome.__storageData.geminiKey = "gm-secret";
    globalThis.chrome.__storageData.openaiKey = "oa-secret";
  });

  it("prunes provider keys from GET_STATE for content-script senders", async () => {
    const reply = await ask(
      { type: "GET_STATE" },
      { tab: { id: 7, url: "https://www.youtube.com/watch?v=test" } },
    );
    expect(reply.ok).toBe(true);
    expect(reply.state.geminiKey).toBe("");
    expect(reply.state.openaiKey).toBe("");
  });

  it("keeps the full state for extension-page senders", async () => {
    const reply = await ask({ type: "GET_STATE" }, { url: "chrome-extension://lumeo/popup.html" });
    expect(reply.ok).toBe(true);
    expect(reply.state.geminiKey).toBe("gm-secret");
  });

  it("serves a single provider key only to YouTube senders", async () => {
    const blocked = await ask(
      { type: "GET_PROVIDER_KEY", key: "geminiKey" },
      { url: "chrome-extension://lumeo/options.html" },
    );
    expect(blocked.ok).toBe(false);

    const allowed = await ask(
      { type: "GET_PROVIDER_KEY", key: "geminiKey" },
      { tab: { id: 7, url: "https://www.youtube.com/watch?v=test" } },
    );
    expect(allowed).toEqual({ ok: true, key: "gm-secret" });
  });

  it("rejects Soniox websocket messages from non-YouTube senders", async () => {
    const reply = await ask(
      { action: "startSonioxWs", apiKey: "soniox-secret" },
      { url: "chrome-extension://lumeo/popup.html" },
    );
    expect(reply.ok).toBe(false);
  });
});
