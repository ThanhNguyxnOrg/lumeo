import { describe, it, expect, beforeEach, vi } from "vitest";
import { createSandboxWindow, loadService } from "./helpers/load-service.mjs";

async function setup() {
  const { window } = await createSandboxWindow();
  loadService("pipelines/realtime.js", window);
  return window.LumeoRealtimePipeline;
}

class FakePeerConnection {
  constructor() {
    this.listeners = new Map();
    this.tracks = [];
    this.closed = false;
    this.iceConnectionState = "new";
    FakePeerConnection.last = this;
  }

  addTrack(track, stream) {
    this.tracks.push({ track, stream });
  }

  createDataChannel(label) {
    this.dataChannel = { label, addEventListener: vi.fn() };
    return this.dataChannel;
  }

  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }

  async createOffer() {
    return { type: "offer", sdp: "offer-sdp" };
  }

  async setLocalDescription(offer) {
    this.localDescription = offer;
  }

  async setRemoteDescription(answer) {
    this.remoteDescription = answer;
  }

  close() {
    this.closed = true;
  }
}

describe("pipelines/realtime.js", () => {
  let api;

  beforeEach(async () => {
    api = await setup();
  });

  it("publishes a realtime pipeline surface", () => {
    expect(api.__loaded).toBe(true);
    expect(typeof api.handleEvent).toBe("function");
    expect(typeof api.parseEvent).toBe("function");
    expect(typeof api.createKymaOpenAIRealtimeAdapter).toBe("function");
  });

  it("appends transcript deltas and marks overlay live", () => {
    let text = "";
    const setTargetText = vi.fn();
    const setOverlayState = vi.fn();
    const result = api.handleEvent(
      JSON.stringify({ type: "response.audio_transcript.delta", delta: "hello" }),
      {
        appendTargetDelta: (delta) => {
          text += delta;
          return text;
        },
        setTargetText,
        setOverlayState,
      },
    );
    expect(result).toBe("delta");
    expect(text).toBe("hello");
    expect(setTargetText).toHaveBeenCalledWith("hello");
    expect(setOverlayState).toHaveBeenCalledWith("live");
  });

  it("handles response.text.delta events", () => {
    const setTargetText = vi.fn();
    const result = api.handleEvent(
      JSON.stringify({ type: "response.text.delta", delta: "xin" }),
      { currentTargetText: "", setTargetText, setOverlayState: vi.fn() },
    );
    expect(result).toBe("delta");
    expect(setTargetText).toHaveBeenCalledWith("xin");
  });

  it("uses done transcript and pushes history", () => {
    const setTargetText = vi.fn();
    const pushHistoryTurn = vi.fn();
    const result = api.handleEvent(
      JSON.stringify({ type: "response.audio_transcript.done", transcript: "final" }),
      { currentTargetText: "draft", setTargetText, pushHistoryTurn },
    );
    expect(result).toBe("done");
    expect(setTargetText).toHaveBeenCalledWith("final");
    expect(pushHistoryTurn).toHaveBeenCalledOnce();
  });

  it("reports realtime errors without throwing", () => {
    const setStatusText = vi.fn();
    const result = api.handleEvent(JSON.stringify({ type: "error" }), { setStatusText });
    expect(result).toBe("error");
    expect(setStatusText).toHaveBeenCalledWith("Translation error");
  });

  it("ignores stale and invalid events", () => {
    expect(api.handleEvent("not-json", {})).toBe("ignored");
    expect(api.handleEvent(JSON.stringify({ type: "response.audio_transcript.delta", delta: "x" }), {
      isFresh: () => false,
    })).toBe("stale");
  });

  it("delegates buildSession through an injected realtime adapter", async () => {
    const fakeSession = { token: 99, provider: "fake" };
    const realtimeAdapter = {
      name: "fake-realtime",
      connect: vi.fn(async (options) => fakeSession),
      sendAudio: vi.fn(),
      onTranscript: vi.fn(),
      onAudio: vi.fn(),
      close: vi.fn(),
      onError: vi.fn(),
    };
    const onStatus = vi.fn();
    const onOverlayState = vi.fn();

    const built = await api.buildSession({
      token: 99,
      audioStream: { getAudioTracks: () => [] },
      kymaKey: "unused",
      realtimeAdapter,
      onStatus,
      onOverlayState,
    });

    expect(built).toBe(fakeSession);
    expect(onStatus).toHaveBeenCalledWith("Connecting");
    expect(onOverlayState).toHaveBeenCalledWith("connecting");
    expect(realtimeAdapter.connect).toHaveBeenCalledWith(expect.objectContaining({
      token: 99,
      kymaKey: "unused",
      realtimeAdapter,
    }));
  });

  it("creates a Kyma/OpenAI realtime adapter with the generic adapter surface", () => {
    const adapter = api.createKymaOpenAIRealtimeAdapter({
      fetch: vi.fn(),
      RTCPeerConnection: FakePeerConnection,
    });

    expect(adapter.name).toBe("kyma-openai-realtime");
    expect(typeof adapter.connect).toBe("function");
    expect(typeof adapter.sendAudio).toBe("function");
    expect(typeof adapter.onTranscript).toBe("function");
    expect(typeof adapter.onAudio).toBe("function");
    expect(typeof adapter.close).toBe("function");
    expect(typeof adapter.onError).toBe("function");
  });

  it("builds a realtime WebRTC session through Kyma and OpenAI SDP exchange", async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      if (url.includes("client_secrets")) {
        return {
          ok: true,
          async json() {
            return { value: "client-secret", kyma_session_id: "sess-1" };
          },
        };
      }
      return {
        ok: true,
        async text() {
          return "answer-sdp";
        },
      };
    });
    const audioStream = {
      getAudioTracks: () => [{ id: "track-1" }],
    };

    const built = await api.buildSession({
      token: 7,
      audioStream,
      kymaKey: "kyma-key",
      targetLanguage: "vi",
      realtimeVoice: "marin",
      kyma: {
        KYMA_BASE: "https://api.kymaapi.com/v1",
        parseError: vi.fn(),
        endSession: vi.fn(),
      },
      fetch: fetchImpl,
      RTCPeerConnection: FakePeerConnection,
      isFresh: () => true,
      onStatus: vi.fn(),
      onOverlayState: vi.fn(),
      onRealtimeEvent: vi.fn(),
    });

    expect(built.token).toBe(7);
    expect(built.kymaSessionId).toBe("sess-1");
    expect(built.kymaKey).toBe("kyma-key");
    expect(built.targetLanguage).toBe("vi");
    expect(built.realtimeVoice).toBe("marin");
    expect(FakePeerConnection.last.tracks).toHaveLength(1);
    expect(FakePeerConnection.last.localDescription.sdp).toBe("offer-sdp");
    expect(FakePeerConnection.last.remoteDescription.sdp).toBe("answer-sdp");
    expect(calls[0].init.body).toContain("gpt-realtime-translate");
    expect(calls[1].init.body).toBe("offer-sdp");
  });

  it("explains missing Kyma realtime token", async () => {
    await expect(api.buildSession({
      token: 1,
      audioStream: { getAudioTracks: () => [] },
      kymaKey: "kyma-key",
      kyma: {
        KYMA_BASE: "https://api.kymaapi.com/v1",
        parseError: vi.fn(),
        endSession: vi.fn(),
      },
      fetch: vi.fn(async () => ({ ok: true, json: async () => ({ kyma_session_id: "sess-missing" }) })),
      RTCPeerConnection: FakePeerConnection,
      isFresh: () => true,
    })).rejects.toThrow("Kyma did not return a Realtime token");
  });

  it("ends the Kyma session and closes the peer connection on SDP failure", async () => {
    const endSession = vi.fn();
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes("client_secrets")) {
        return {
          ok: true,
          async json() {
            return { value: "client-secret", kyma_session_id: "sess-2" };
          },
        };
      }
      return {
        ok: false,
        status: 500,
        async text() {
          return "bad sdp";
        },
      };
    });

    await expect(api.buildSession({
      token: 1,
      audioStream: { getAudioTracks: () => [] },
      kymaKey: "kyma-key",
      kyma: {
        KYMA_BASE: "https://api.kymaapi.com/v1",
        parseError: vi.fn(),
        endSession,
      },
      fetch: fetchImpl,
      RTCPeerConnection: FakePeerConnection,
      isFresh: () => true,
    })).rejects.toThrow("Realtime WebRTC connection failed (500)");

    expect(FakePeerConnection.last.closed).toBe(true);
    expect(endSession).toHaveBeenCalledWith("sess-2", "kyma-key");
  });
});
