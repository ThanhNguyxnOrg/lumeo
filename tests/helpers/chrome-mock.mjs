import { vi } from "vitest";

export function createChromeMock(options = {}) {
  const storageData = { ...(options.storage || {}) };
  const runtimeListeners = [];
  const tabRemovedListeners = [];
  const tabUpdatedListeners = [];

  const chrome = {
    runtime: {
      lastError: null,
      getManifest: vi.fn(() => options.manifest || { version_name: "test", version: "0.0.0" }),
      getURL: vi.fn((path) => `chrome-extension://lumeo/${path}`),
      sendMessage: vi.fn((message, callback) => {
        const reply = options.onRuntimeMessage?.(message) ?? { ok: true };
        if (callback) callback(reply);
        return Promise.resolve(reply);
      }),
      onMessage: {
        addListener: vi.fn((listener) => runtimeListeners.push(listener)),
        removeListener: vi.fn((listener) => {
          const index = runtimeListeners.indexOf(listener);
          if (index >= 0) runtimeListeners.splice(index, 1);
        }),
      },
    },
    storage: {
      local: {
        get: vi.fn(async (keys) => {
          if (keys == null) return { ...storageData };
          if (typeof keys === "string") return { [keys]: storageData[keys] };
          if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, storageData[key]]));
          return { ...keys, ...Object.fromEntries(Object.keys(keys).map((key) => [key, storageData[key] ?? keys[key]])) };
        }),
        set: vi.fn(async (values) => {
          Object.assign(storageData, values);
        }),
        setAccessLevel: vi.fn(async () => {}),
      },
    },
    tabs: {
      query: vi.fn(async () => options.tabs || [{ id: 1, url: "https://www.youtube.com/watch?v=test", title: "Test video" }]),
      sendMessage: vi.fn(async (tabId, message) => options.onTabMessage?.(tabId, message) ?? { ok: true }),
      onRemoved: { addListener: vi.fn((listener) => tabRemovedListeners.push(listener)) },
      onUpdated: { addListener: vi.fn((listener) => tabUpdatedListeners.push(listener)) },
    },
    scripting: {
      executeScript: vi.fn(async () => []),
      insertCSS: vi.fn(async () => {}),
    },
    __storageData: storageData,
    __runtimeListeners: runtimeListeners,
    __tabRemovedListeners: tabRemovedListeners,
    __tabUpdatedListeners: tabUpdatedListeners,
  };

  return chrome;
}
