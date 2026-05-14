// Lumeo audio utilities — pure leaf helpers for capturing, re-encoding, and
// downmixing the YouTube video's audio stream. Extracted from content.js so
// the Standard pipeline (and future Groq / OpenAI direct pipelines) can
// share the same WAV-encoding path and be unit-testable.
//
// Contract:
//   - No dependency on session state, overlay, or settings.
//   - Safe to load in any frame; publishes globals on window for the main
//     world content script to consume via `window.LumeoAudioUtils`.

(() => {
  "use strict";

  if (window.LumeoAudioUtils?.__loaded) return;

  // Chrome MediaRecorder only emits webm/opus or mp4; Kyma and OpenAI
  // Whisper gateways whitelist mp3/wav/m4a. So we emit what the browser
  // supports, decode it locally, and re-encode to WAV upstream.
  const DEFAULT_RECORDER_MIMES = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];

  function findVideo() {
    return (
      document.querySelector("video.html5-main-video") ||
      document.querySelector("video")
    );
  }

  // Playback nudge: captureStream() on a paused <video> returns a stream with
  // zero audio tracks. Kicking play() for up to 250ms lets the first track
  // attach so the caller's retry loop has something to bind to.
  function nudgePlay(video) {
    if (!video || !video.paused) return Promise.resolve();
    const p = video.play();
    if (!p?.then) return Promise.resolve();
    return Promise.race([
      p.catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 250)),
    ]);
  }

  // Repeatedly try captureStream() on the YouTube video until we get an audio
  // track or time out. Returns a fresh MediaStream containing only the audio
  // tracks so the caller can dispose without touching the original video.
  async function captureWithRetry(video, timeoutMs = 9000) {
    if (
      typeof video.captureStream !== "function" &&
      typeof video.mozCaptureStream !== "function"
    ) {
      throw new Error("This Chrome build cannot capture YouTube audio.");
    }
    const start = Date.now();
    let lastStream;
    while (Date.now() - start < timeoutMs) {
      if (video.paused) await nudgePlay(video);
      lastStream = (video.captureStream || video.mozCaptureStream).call(video);
      if (lastStream.getAudioTracks().length) {
        return new MediaStream(lastStream.getAudioTracks());
      }
      lastStream.getTracks().forEach((t) => t.stop());
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error("YouTube audio not ready. Press play, then Start again.");
  }

  function pickRecorderMime(candidates = DEFAULT_RECORDER_MIMES) {
    if (typeof MediaRecorder === "undefined") return "";
    for (const mime of candidates) {
      try {
        if (MediaRecorder.isTypeSupported(mime)) return mime;
      } catch {
        // Browser rejected the mime probe; keep going.
      }
    }
    return "";
  }

  // Decode any MediaRecorder blob and re-encode as 16-bit PCM WAV @ 16 kHz
  // mono. Caller may pass a shared AudioContext to avoid allocation churn
  // across chunks; otherwise we create a short-lived one and close it.
  async function webmBlobToWav(blob, sharedCtx) {
    const arrayBuf = await blob.arrayBuffer();
    let ownCtx;
    let ctx = sharedCtx;
    if (!ctx) {
      ownCtx = new (window.AudioContext || window.webkitAudioContext)();
      ctx = ownCtx;
    }
    let audioBuf;
    try {
      audioBuf = await ctx.decodeAudioData(arrayBuf);
    } finally {
      if (ownCtx) ownCtx.close().catch(() => {});
    }
    return audioBufferToWavBlob(audioBuf);
  }

  function audioBufferToWavBlob(audioBuf, targetRate = 16000) {
    // Whisper/ASR pipelines run at 16 kHz internally; higher sample rates
    // waste bandwidth without improving WER.
    const monoSamples = downmixAndResample(audioBuf, targetRate);
    const dataSize = monoSamples.length * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    let p = 0;
    function wstr(s) {
      for (let i = 0; i < s.length; i += 1) view.setUint8(p++, s.charCodeAt(i));
    }
    function w32(n) {
      view.setUint32(p, n, true);
      p += 4;
    }
    function w16(n) {
      view.setUint16(p, n, true);
      p += 2;
    }
    wstr("RIFF"); w32(36 + dataSize); wstr("WAVE");
    wstr("fmt "); w32(16); w16(1); w16(1); w32(targetRate);
    w32(targetRate * 2); w16(2); w16(16);
    wstr("data"); w32(dataSize);
    for (let i = 0; i < monoSamples.length; i += 1) {
      const s = Math.max(-1, Math.min(1, monoSamples[i]));
      view.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      p += 2;
    }
    return new Blob([buffer], { type: "audio/wav" });
  }

  function downmixAndResample(audioBuf, targetRate) {
    const srcRate = audioBuf.sampleRate;
    const channels = audioBuf.numberOfChannels;
    const srcLen = audioBuf.length;
    // Average channels to a single mono track first.
    const mono = new Float32Array(srcLen);
    for (let ch = 0; ch < channels; ch += 1) {
      const data = audioBuf.getChannelData(ch);
      for (let i = 0; i < srcLen; i += 1) mono[i] += data[i];
    }
    if (channels > 1) for (let i = 0; i < srcLen; i += 1) mono[i] /= channels;
    if (srcRate === targetRate) return mono;
    // Linear resample: adequate for speech at 16 kHz target; skip heavier
    // polyphase filtering because ASR accuracy is barely affected.
    const ratio = srcRate / targetRate;
    const outLen = Math.floor(srcLen / ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i += 1) {
      const src = i * ratio;
      const i0 = Math.floor(src);
      const i1 = Math.min(i0 + 1, srcLen - 1);
      const f = src - i0;
      out[i] = mono[i0] * (1 - f) + mono[i1] * f;
    }
    return out;
  }

  window.LumeoAudioUtils = {
    __loaded: true,
    DEFAULT_RECORDER_MIMES,
    findVideo,
    nudgePlay,
    captureWithRetry,
    pickRecorderMime,
    webmBlobToWav,
    audioBufferToWavBlob,
    downmixAndResample,
  };
})();
