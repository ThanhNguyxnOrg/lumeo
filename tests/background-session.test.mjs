import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChromeMock } from "./helpers/chrome-mock.mjs";

const owner = { tab: { id: 7, url: "https://www.youtube.com/watch?v=test" } };
const otherTab = { tab: { id: 8, url: "https://www.youtube.com/watch?v=other" } };
const popup = { url: "chrome-extension://lumeo/popup.html" };
const sessionKey = "lumeoSessionTab";

let sessionStorage;
let chrome;

async function boot(onTabMessage) {
  vi.resetModules();
  globalThis.chrome = chrome = createChromeMock({ onTabMessage });
  chrome.storage.session = {
    get: vi.fn(async () => ({ ...sessionStorage })),
    set: vi.fn(async (items) => { Object.assign(sessionStorage, items); }),
    remove: vi.fn(async (key) => { delete sessionStorage[key]; }),
  };
  await import("../background.js");
}

function ask(message, sender = popup) {
  return new Promise((resolve) => chrome.__runtimeListeners[0](message, sender, resolve));
}

describe("background session ownership", () => {
  beforeEach(() => {
    sessionStorage = {};
  });

  it("restores the active tab after restart and routes Stop to it", async () => {
    await boot(() => ({ ok: true }));
    await expect(ask({ type: "START" }, owner)).resolves.toMatchObject({ ok: true });
    expect(sessionStorage).toEqual({ [sessionKey]: 7 });

    await boot((tabId, message) => message.type === "CONTENT_SESSION_STATE"
      ? { running: true, paused: true, status: "Paused" }
      : { ok: true });
    await expect(ask({ type: "GET_STATE" })).resolves.toMatchObject({
      state: { running: true, paused: true, status: "Paused", tabId: 7 },
    });
    await expect(ask({ type: "STOP" }, otherTab)).resolves.toMatchObject({ ignored: true });
    await expect(ask({ type: "STOP" })).resolves.toMatchObject({
      state: { running: false, tabId: null },
    });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { type: "CONTENT_STOP" }, expect.any(Function));
    expect(sessionStorage).toEqual({});
  });

  it.each([false, true])("clears a stale owner when the tab is inactive or missing (missing=%s)", async (missing) => {
    sessionStorage[sessionKey] = 7;
    await boot(() => {
      if (missing) throw new Error("Receiving end does not exist.");
      return { running: false };
    });
    await expect(ask({ type: "GET_STATE" })).resolves.toMatchObject({
      state: { running: false, tabId: null },
    });
    expect(sessionStorage).toEqual({});
  });

  it("does not let unsolicited content events create an ownerless session", async () => {
    await boot();
    await ask({ type: "CONTENT_STATE", running: true }, otherTab);
    await expect(ask({ type: "GET_STATE" })).resolves.toMatchObject({
      state: { running: false, tabId: null },
    });
  });

  it("accepts only one start while background settings are loading", async () => {
    await boot();
    const results = await Promise.all([
      ask({ type: "START" }, owner),
      ask({ type: "START" }, otherTab),
    ]);
    expect(results[0].state.tabId).toBe(7);
    expect(results[1].alreadyRunning).toBe(true);
    const starts = chrome.tabs.sendMessage.mock.calls.filter(([, message]) => message.type === "CONTENT_START");
    expect(starts.map(([tabId]) => tabId)).toEqual([7]);
  });

  it("does not resurrect a start that replied after YouTube navigation", async () => {
    const dispatched = Promise.withResolvers();
    const reply = Promise.withResolvers();
    await boot((_tabId, message) => {
      if (message.type !== "CONTENT_START") return { ok: true };
      dispatched.resolve();
      return reply.promise;
    });
    const starting = ask({ type: "START" }, owner);
    await dispatched.promise;
    chrome.__tabUpdatedListeners[0](7, { url: otherTab.tab.url });
    reply.resolve({ ok: true });
    await expect(starting).resolves.toMatchObject({ ok: false, error: "Start cancelled." });
    await expect(ask({ type: "GET_STATE" })).resolves.toMatchObject({
      state: { running: false, tabId: null },
    });
    expect(sessionStorage).toEqual({});
  });
});
