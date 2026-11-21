import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChromeMock } from "./helpers/chrome-mock.mjs";

const owner = { tab: { id: 7, url: "https://www.youtube.com/watch?v=test" } };
const otherTab = { tab: { id: 8, url: "https://www.youtube.com/watch?v=other" } };
const popup = { url: "chrome-extension://lumeo/popup.html" };
const sessionKey = "lumeoSessionTab";

let sessionStorage;
let chrome;

async function boot(onTabMessage, options = {}) {
  vi.resetModules();
  globalThis.chrome = chrome = createChromeMock({ onTabMessage, ...options });
  chrome.storage.local.remove = vi.fn(async (keys) => {
    for (const key of keys) delete chrome.__storageData[key];
  });
  chrome.storage.onChanged = { addListener: vi.fn() };
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

  it("persists only settings when the standalone popup starts without a YouTube tab", async () => {
    await boot(undefined, { tabs: [] });
    const { state } = await ask({ type: "GET_STATE" });
    await expect(ask({ type: "START", settings: { ...state, targetLanguage: "vi" } })).resolves.toMatchObject({
      ok: false,
      error: "No active tab.",
    });
    expect(chrome.__storageData).toMatchObject({ targetLanguage: "vi" });
    for (const key of ["running", "connecting", "paused", "tabId", "status", "errorMessage", "errorCode", "missingProviders", "slotsMissingKeys"]) {
      expect(chrome.__storageData).not.toHaveProperty(key);
    }
  });

  it("removes legacy session fields without touching other stored data", async () => {
    const cache = { entries: { example: {} } };
    await boot(undefined, { storage: { running: false, tabId: null, targetLanguage: "vi", lumeoCaptionCacheV1: cache } });
    expect(chrome.__storageData).toEqual({ targetLanguage: "vi", lumeoCaptionCacheV1: cache });
  });

  it("keeps the owner when stale session fields appear in storage during a live session", async () => {
    await boot();
    await expect(ask({ type: "START" }, owner)).resolves.toMatchObject({ ok: true });
    await ask({ type: "CONTENT_STATE", paused: true, status: "Paused" }, owner);
    const stale = { running: false, connecting: false, paused: false, tabId: null, status: "Ready" };
    Object.assign(chrome.__storageData, stale, { targetLanguage: "vi" });
    const onChanged = chrome.storage.onChanged.addListener.mock.calls[0][0];
    onChanged(Object.fromEntries(Object.entries(stale).map(([key, newValue]) => [key, { newValue }])), "local");
    await expect(ask({ type: "STOP" }, otherTab)).resolves.toEqual({ ok: true, ignored: true });
    await expect(ask({ type: "GET_STATE" })).resolves.toMatchObject({
      state: { running: true, paused: true, tabId: 7, status: "Paused", targetLanguage: "vi" },
    });
    await expect(ask({ type: "STOP" }, otherTab)).resolves.toEqual({ ok: true, ignored: true });
    await expect(ask({ type: "START" }, otherTab)).resolves.toMatchObject({ alreadyRunning: true });
    expect(chrome.tabs.sendMessage.mock.calls.filter(([, msg]) => msg.type === "CONTENT_START")).toHaveLength(1);
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
