(() => {
  "use strict";

  if (window.LumeoRealtimePipeline?.__loaded) return;

  const OPENAI_CALLS_URL = "https://api.openai.com/v1/realtime/translations/calls";

  const DELTA_TYPES = new Set([
    "session.output_transcript.delta",
    "response.audio_transcript.delta",
    "response.output_audio_transcript.delta",
  ]);

  const DONE_TYPES = new Set([
    "session.output_transcript.done",
    "response.audio_transcript.done",
    "response.output_audio_transcript.done",
    "response.text.done",
  ]);

  function parseEvent(raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function assertFresh(ctx) {
    if (ctx.isFresh && !ctx.isFresh()) throw new Error("Stale session.");
  }

  function createKymaOpenAIRealtimeAdapter(adapterOptions = {}) {
    const {
      fetch: fetchImpl = window.fetch,
      RTCPeerConnection: PeerConnection = window.RTCPeerConnection,
      document: doc = window.document,
      AudioContext: AudioCtx = window.AudioContext || window.webkitAudioContext,
    } = adapterOptions;

    return {
      name: "kyma-openai-realtime",
      async connect(options = {}) {
        const {
          token,
          audioStream,
          kymaKey,
          targetLanguage = "vi",
          realtimeVoice = "",
          kyma,
          isFresh = () => true,
          onRealtimeEvent,
          onConnectionLost,
          computeGain = (voiceVolume) => voiceVolume / 100,
          getVoiceVolume = () => 100,
        } = options;

        let mintResp;
        try {
          mintResp = await fetchImpl(`${kyma.KYMA_BASE}/realtime/translations/client_secrets`, {
            method: "POST",
            headers: { Authorization: `Bearer ${kymaKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              session: {
                model: "gpt-realtime-translate",
                audio: { output: { language: targetLanguage, ...(realtimeVoice ? { voice: realtimeVoice } : {}) } },
              },
            }),
          });
        } catch {
          throw new Error("Cannot reach Kyma to start Realtime. Check your connection, then retry.");
        }

        assertFresh({ isFresh });
        if (!mintResp.ok) {
          const text = await mintResp.text().catch(() => "");
          const parsed = kyma.parseError(mintResp.status, text);
          const err = new Error(parsed.user);
          err.cta = parsed.cta;
          err.ctaLabel = parsed.ctaLabel;
          throw err;
        }

        const mint = await mintResp.json();
        assertFresh({ isFresh });
        const clientSecret = mint.value;
        const kymaSessionId = mint.kyma_session_id;
        if (!clientSecret) throw new Error("Kyma did not return a Realtime token. Check your Kyma key/session, then retry.");

        const pc = new PeerConnection();
        for (const track of audioStream.getAudioTracks()) pc.addTrack(track, audioStream);

        const dc = pc.createDataChannel("oai-events");
        dc.addEventListener("message", (event) => {
          if (!isFresh()) return;
          onRealtimeEvent?.(event.data, token);
        });

        const newSession = {
          token,
          pc,
          dc,
          stream: audioStream,
          remoteAudio: null,
          audioCtx: null,
          outputGain: null,
          kymaSessionId,
          kymaKey,
          targetLanguage,
          realtimeVoice,
          realtimeAdapter: this,
        };

        pc.addEventListener("track", (event) => {
          if (newSession.remoteAudio) return;
          const audio = doc.createElement("audio");
          audio.autoplay = true;
          audio.muted = true;
          audio.srcObject = event.streams[0];
          doc.body.appendChild(audio);
          newSession.remoteAudio = audio;

          try {
            const ctx = new AudioCtx();
            if (ctx.state === "suspended") ctx.resume().catch(() => {});
            const src = ctx.createMediaStreamSource(event.streams[0]);
            const gain = ctx.createGain();
            gain.gain.value = computeGain(getVoiceVolume());
            src.connect(gain);
            gain.connect(ctx.destination);
            newSession.audioCtx = ctx;
            newSession.outputGain = gain;
          } catch {
            audio.muted = false;
            audio.volume = Math.min(getVoiceVolume() / 100, 1.0);
          }
        });

        pc.addEventListener("iceconnectionstatechange", () => {
          if (!isFresh()) return;
          if (["closed", "failed", "disconnected"].includes(pc.iceConnectionState)) {
            onConnectionLost?.(newSession);
          }
        });

        const offer = await pc.createOffer();
        assertFresh({ isFresh });
        await pc.setLocalDescription(offer);

        const sdpResp = await fetchImpl(OPENAI_CALLS_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${clientSecret}`, "Content-Type": "application/sdp" },
          body: offer.sdp,
        });

        if (!isFresh()) {
          try { pc.close(); } catch {}
          throw new Error("Stale session.");
        }

        if (!sdpResp.ok) {
          const text = await sdpResp.text().catch(() => "");
          try { pc.close(); } catch {}
          void kyma.endSession(kymaSessionId, kymaKey);
          throw new Error(`Realtime WebRTC connection failed (${sdpResp.status}). Retry; if it repeats, check your Kyma key/session. ${text.slice(0, 120)}`.trim());
        }

        const answerSdp = await sdpResp.text();
        if (!isFresh()) {
          try { pc.close(); } catch {}
          throw new Error("Stale session.");
        }
        await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

        return newSession;
      },
      sendAudio() {},
      onTranscript() {},
      onAudio() {},
      onError() {},
      close(session) {
        try { session?.pc?.close(); } catch {}
      },
    };
  }

  async function buildSession(options = {}) {
    const {
      fetch: fetchImpl = window.fetch,
      RTCPeerConnection: PeerConnection = window.RTCPeerConnection,
      document: doc = window.document,
      AudioContext: AudioCtx = window.AudioContext || window.webkitAudioContext,
      realtimeAdapter,
      onStatus,
      onOverlayState,
    } = options;

    onStatus?.("Connecting");
    onOverlayState?.("connecting");

    const adapter = realtimeAdapter || createKymaOpenAIRealtimeAdapter({
      fetch: fetchImpl,
      RTCPeerConnection: PeerConnection,
      document: doc,
      AudioContext: AudioCtx,
    });

    return adapter.connect(options);
  }

  function handleEvent(raw, ctx = {}) {
    if (ctx.isFresh && !ctx.isFresh()) return "stale";
    const evt = parseEvent(raw);
    if (!evt) return "ignored";

    if (evt.type === "error") {
      ctx.setStatusText?.("Translation error");
      return "error";
    }

    const isTextDelta = evt.type === "response.text.delta" && typeof evt.delta === "string";
    const isDelta = DELTA_TYPES.has(evt.type) || isTextDelta;
    if (isDelta && evt.delta) {
      const nextText = ctx.appendTargetDelta
        ? ctx.appendTargetDelta(evt.delta)
        : `${ctx.currentTargetText || ""}${evt.delta}`;
      ctx.setTargetText?.(nextText);
      ctx.setOverlayState?.("live");
      return "delta";
    }

    if (DONE_TYPES.has(evt.type)) {
      const finalText = evt.transcript || ctx.currentTargetText || "";
      ctx.setTargetText?.(finalText);
      ctx.pushHistoryTurn?.(finalText);
      return "done";
    }

    return "ignored";
  }

  window.LumeoRealtimePipeline = {
    __loaded: true,
    buildSession,
    handleEvent,
    parseEvent,
    createKymaOpenAIRealtimeAdapter,
  };
})();
