import { describe, it, expect, vi, beforeEach } from "vitest";
import "../lib/browser-api.js";

function loadBrowserApi() {
  return globalThis.LumeoBrowserApi;
}

describe("browser API wrapper", () => {
  beforeEach(() => {
    delete globalThis.chrome;
    delete globalThis.browser;
  });

  it("wraps chrome callback APIs and rejects runtime lastError", async () => {
    globalThis.chrome = {
      runtime: {
        lastError: null,
        sendMessage: vi.fn((message, done) => done({ ok: true, message })),
      },
      tabs: {
        query: vi.fn((queryInfo, done) => done([{ id: 7, ...queryInfo }])),
        sendMessage: vi.fn((tabId, message, done) => done({ tabId, message })),
      },
    };
    const api = loadBrowserApi();

    await expect(api.sendRuntimeMessage({ type: "PING" })).resolves.toEqual({ ok: true, message: { type: "PING" } });
    await expect(api.queryTabs({ active: true })).resolves.toEqual([{ id: 7, active: true }]);
    await expect(api.sendTabMessage(7, { type: "HELLO" })).resolves.toEqual({ tabId: 7, message: { type: "HELLO" } });

    globalThis.chrome.runtime.lastError = { message: "No receiver" };
    await expect(api.sendRuntimeMessage({ type: "PING" })).rejects.toThrow("No receiver");
  });

  it("uses browser promise APIs when available", async () => {
    globalThis.chrome = {
      runtime: { sendMessage: vi.fn(() => Promise.resolve({ source: "chrome" })) },
    };
    globalThis.browser = {
      runtime: {
        getManifest: vi.fn(() => ({ version: "1.2.3" })),
        getURL: vi.fn((path) => `moz-extension://lumeo/${path}`),
        sendMessage: vi.fn(async (message) => ({ source: "browser", message })),
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      tabs: {
        query: vi.fn(async () => [{ id: 3 }]),
      },
      storage: {
        local: {
          get: vi.fn(async () => ({ existing: true })),
          set: vi.fn(async () => undefined),
        },
      },
    };
    const api = loadBrowserApi();

    await expect(api.sendRuntimeMessage({ type: "PING" })).resolves.toEqual({ source: "browser", message: { type: "PING" } });
    await expect(api.queryTabs({ currentWindow: true })).resolves.toEqual([{ id: 3 }]);
    await expect(api.storageGet(["existing"])).resolves.toEqual({ existing: true });
    await expect(api.storageSet({ existing: false })).resolves.toBeUndefined();
    expect(api.getManifest()).toEqual({ version: "1.2.3" });
    expect(api.getURL("content.js")).toBe("moz-extension://lumeo/content.js");
    expect(globalThis.chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(globalThis.browser.runtime.sendMessage).toHaveBeenCalledWith({ type: "PING" });
    expect(globalThis.browser.tabs.query).toHaveBeenCalledWith({ currentWindow: true });
    expect(globalThis.browser.storage.local.get).toHaveBeenCalledWith(["existing"]);
  });

  it("no-ops optional Chrome-only storage access level", async () => {
    globalThis.browser = { storage: { local: {} } };
    const api = loadBrowserApi();

    await expect(api.setStorageAccessLevel("TRUSTED_CONTEXTS")).resolves.toBeUndefined();
  });

  it("requests optional host permissions through either callback or promise APIs", async () => {
    globalThis.chrome = {
      permissions: {
        request: vi.fn((permissions, done) => done(true)),
        contains: vi.fn((permissions, done) => done(false)),
      },
    };
    const api = loadBrowserApi();

    await expect(api.requestPermissions({ origins: ["https://api.example.com/*"] })).resolves.toBe(true);
    await expect(api.containsPermissions({ origins: ["https://api.example.com/*"] })).resolves.toBe(false);
    expect(globalThis.chrome.permissions.request).toHaveBeenCalledWith(
      { origins: ["https://api.example.com/*"] },
      expect.any(Function),
    );

    globalThis.browser = {
      permissions: {
        request: vi.fn(async (permissions) => permissions.origins.length > 0),
      },
    };
    await expect(api.requestPermissions({ origins: ["https://api.example.com/*"] })).resolves.toBe(true);
    expect(globalThis.browser.permissions.request).toHaveBeenCalledWith({ origins: ["https://api.example.com/*"] });
  });

  it("resolves false when the permissions API is unavailable", async () => {
    const api = loadBrowserApi();
    await expect(api.requestPermissions({ origins: ["https://api.example.com/*"] })).resolves.toBe(false);
    await expect(api.containsPermissions({ origins: ["https://api.example.com/*"] })).resolves.toBe(false);
  });
});
