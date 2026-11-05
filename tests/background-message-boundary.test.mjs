import { describe, it, expect, beforeAll } from "vitest";
import { createChromeMock } from "./helpers/chrome-mock.mjs";

let listener;
let chromeMock;

const YT_TAB_7 = { tab: { id: 7, url: "https://www.youtube.com/watch?v=test" } };
const YT_TAB_8 = { tab: { id: 8, url: "https://www.youtube.com/watch?v=other" } };
const OPTIONS_PAGE = { url: "chrome-extension://lumeo/options.html" };

function ask(message, sender = {}) {
  return new Promise((resolve) => {
    listener(message, sender, resolve);
  });
}

async function extensionState() {
  const reply = await ask({ type: "GET_STATE" }, OPTIONS_PAGE);
  return reply.state;
}

describe("background message boundary", () => {
  beforeAll(async () => {
    chromeMock = createChromeMock({
      tabs: [{ id: 7, url: "https://www.youtube.com/watch?v=test", title: "Test video" }],
    });
    globalThis.chrome = chromeMock;
    await import("../background.js");
    listener = globalThis.chrome.__runtimeListeners[0];
    globalThis.chrome.__storageData.geminiKey = "gm-secret";
    globalThis.chrome.__storageData.openaiKey = "oa-secret";
    globalThis.chrome.__storageData.translateProvider = "gemini";
  });

  it("strips every provider key from GET_STATE for content-script senders", async () => {
    const reply = await ask({ type: "GET_STATE" }, YT_TAB_7);
    expect(reply.ok).toBe(true);
    expect(reply.state.geminiKey).toBe("");
    expect(reply.state.openaiKey).toBe("");
    expect(reply.state.translateProvider).toBe("gemini");
  });

  it("keeps the full state for extension-page senders", async () => {
    const reply = await ask({ type: "GET_STATE" }, OPTIONS_PAGE);
    expect(reply.ok).toBe(true);
    expect(reply.state.geminiKey).toBe("gm-secret");
    expect(reply.state.openaiKey).toBe("oa-secret");
  });

  it("rejects provider-key requests without an active session", async () => {
    const blocked = await ask(
      { type: "GET_PROVIDER_KEY", key: "geminiKey" },
      OPTIONS_PAGE,
    );
    expect(blocked.ok).toBe(false);

    const noSession = await ask(
      { type: "GET_PROVIDER_KEY", key: "geminiKey" },
      YT_TAB_7,
    );
    expect(noSession.ok).toBe(false);
    expect(noSession.error).toMatch(/no active lumeo session/i);
  });

  it("starts a session owned by the active YouTube tab", async () => {
    const reply = await ask(
      { type: "START", settings: { translateProvider: "gemini" } },
      OPTIONS_PAGE,
    );
    expect(reply.ok).toBe(true);
    expect(reply.state.running).toBe(true);
  });

  it("serves only the active provider key to the active session tab", async () => {
    const allowed = await ask(
      { type: "GET_PROVIDER_KEY", key: "geminiKey" },
      YT_TAB_7,
    );
    expect(allowed).toEqual({ ok: true, key: "gm-secret" });

    const otherTab = await ask(
      { type: "GET_PROVIDER_KEY", key: "geminiKey" },
      YT_TAB_8,
    );
    expect(otherTab.ok).toBe(false);

    const unusedKey = await ask(
      { type: "GET_PROVIDER_KEY", key: "openaiKey" },
      YT_TAB_7,
    );
    expect(unusedKey.ok).toBe(false);
    expect(unusedKey.error).toMatch(/not in use/i);
  });

  it("prunes state in UPDATE_SETTINGS replies and persists only writable fields", async () => {
    const reply = await ask(
      {
        type: "UPDATE_SETTINGS",
        settings: {
          targetLanguage: "vi",
          translateProvider: "openai",
          openaiKey: "attacker-key",
          geminiKey: "attacker-gemini",
        },
      },
      YT_TAB_7,
    );
    expect(reply.ok).toBe(true);
    expect(reply.state.geminiKey).toBe("");
    expect(reply.state.openaiKey).toBe("");

    const stored = await extensionState();
    expect(stored.targetLanguage).toBe("vi");
    expect(stored.translateProvider).toBe("gemini");
    expect(stored.geminiKey).toBe("gm-secret");
    expect(stored.openaiKey).toBe("oa-secret");
  });

  it("ignores UPDATE_SETTINGS from a non-owner YouTube tab", async () => {
    const reply = await ask(
      { type: "UPDATE_SETTINGS", settings: { targetLanguage: "fr" } },
      YT_TAB_8,
    );
    expect(reply).toEqual({ ok: true, ignored: true });

    const stored = await extensionState();
    expect(stored.targetLanguage).toBe("vi");
  });

  it("filters provider, tier and key fields out of a content-origin START", async () => {
    const stopped = await ask({ type: "STOP" }, YT_TAB_7);
    expect(stopped.ok).toBe(true);

    const started = await ask(
      {
        type: "START",
        settings: {
          tier: "standard",
          targetLanguage: "en",
          translateProvider: "openai",
          openaiKey: "attacker-key",
          kymaKey: "attacker-kyma",
        },
      },
      YT_TAB_7,
    );
    expect(started.ok).toBe(true);
    expect(started.state.geminiKey).toBe("");
    expect(started.state.openaiKey).toBe("");

    const stored = await extensionState();
    expect(stored.tier).toBe("caption");
    expect(stored.translateProvider).toBe("gemini");
    expect(stored.openaiKey).toBe("oa-secret");
    expect(stored.geminiKey).toBe("gm-secret");
    expect(stored.targetLanguage).toBe("en");
  });

  it("uses the stored Soniox key and requires an active session", async () => {
    await ask({ type: "STOP" }, YT_TAB_7);
    const blocked = await ask(
      { action: "startSonioxWs", apiKey: "attacker-key" },
      YT_TAB_7,
    );
    expect(blocked.ok).toBe(false);

    const instances = [];
    class FakeWebSocket {
      static OPEN = 1;
      constructor(url) {
        this.url = url;
        this.sent = [];
        this.readyState = 0;
        instances.push(this);
      }
      send(payload) { this.sent.push(payload); }
      close() { this.readyState = 3; }
    }
    const previousWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = FakeWebSocket;
    chromeMock.__storageData.sonioxApiKey = "soniox-stored-key";

    try {
      const started = await ask(
        { type: "START", settings: { sttProvider: "soniox" } },
        YT_TAB_7,
      );
      expect(started.ok).toBe(true);

      const reply = await ask(
        { action: "startSonioxWs", apiKey: "attacker-key" },
        YT_TAB_7,
      );
      expect(reply.ok).toBe(true);

      const socket = instances.at(-1);
      expect(socket.url).toBe("wss://stt-rt.soniox.com/transcribe-websocket");
      socket.onopen();
      const handshake = JSON.parse(socket.sent[0]);
      expect(handshake.api_key).toBe("soniox-stored-key");

      const otherTab = listener(
        { action: "sonioxAudio", samples: [1, 2, 3] },
        YT_TAB_8,
        () => {},
      );
      expect(otherTab).toBe(false);
    } finally {
      globalThis.WebSocket = previousWebSocket;
    }
  });

  it("ignores a caller-selected AI provider for word explanations", async () => {
    const translateApi = globalThis.LumeoTranslate;
    const original = translateApi.explainWordInContext;
    const calls = [];
    translateApi.explainWordInContext = async (word, sentence, targetLanguage, options) => {
      calls.push({ word, sentence, targetLanguage, options });
      return { meaning: "ok", nuance: "", synonyms: "" };
    };

    try {
      const reply = await ask(
        {
          type: "EXPLAIN_WORD_CONTEXT",
          word: "hello",
          sentence: "hello there",
          provider: "openai",
          targetLanguage: "vi",
        },
        YT_TAB_7,
      );
      expect(reply.ok).toBe(true);
      expect(calls).toHaveLength(1);
      // Stored translateProvider is gemini; the message cannot override it.
      expect(calls[0].options.provider).toBe("gemini");
      expect(calls[0].options.openaiKey).toBe("oa-secret");
    } finally {
      translateApi.explainWordInContext = original;
    }
  });

  it("does not treat look-alike hosts as YouTube", () => {
    const isYouTubeUrl = globalThis.LumeoBackground?.isYouTubeUrl;
    expect(typeof isYouTubeUrl).toBe("function");
    expect(isYouTubeUrl("https://www.youtube.com/watch?v=test")).toBe(true);
    expect(isYouTubeUrl("https://youtube.com/watch?v=test")).toBe(true);
    expect(isYouTubeUrl("https://notyoutube.com/watch?v=test")).toBe(false);
    expect(isYouTubeUrl("https://evil-youtube.com/watch?v=test")).toBe(false);
    expect(isYouTubeUrl("https://youtube.com.evil.example/watch?v=test")).toBe(false);
    expect(isYouTubeUrl("http://www.youtube.com/watch?v=test")).toBe(false);
  });

  it("rejects caption cache and Soniox messages from non-YouTube senders", async () => {
    const cache = await ask(
      { action: "captionCacheGet" },
      { url: "https://evil.example/page" },
    );
    expect(cache.ok).toBe(false);

    const soniox = await ask(
      { action: "startSonioxWs", apiKey: "soniox-secret" },
      { url: "chrome-extension://lumeo/popup.html" },
    );
    expect(soniox.ok).toBe(false);
  });
});
