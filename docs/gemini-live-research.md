# Gemini Live P7 Research

Date checked: 2026-05-12

## Verdict

Gemini Live appears usable for a future browser-extension realtime adapter in principle, but it is not a drop-in replacement for the current Kyma/OpenAI WebRTC path.

Recommended status: keep Gemini Live disabled behind the adapter seam until a prototype validates Chrome MV3 offscreen/service-worker behavior.

## What is supported

- Browser/client direct connection via Gemini Live WebSocket.
- Production browser auth via ephemeral token minted server-side.
- Raw audio streaming in/out.
- MV3 WebSocket keepalive is supported in Chrome 116+.
- MV3 offscreen documents can support audio capture/playback plumbing.

## Constraints / blockers

- No official direct Gemini Live WebRTC endpoint was found; available path is WebSocket, not media-track WebRTC.
- Audio must be converted to/from raw PCM:
  - input: 16-bit PCM, 16 kHz, little-endian
  - output: 16-bit PCM, 24 kHz, little-endian
- Session duration/reconnect behavior needs prototype validation.
- Live API maturity remains preview; production failure modes need measurement.
- A backend or trusted token minting path is required for ephemeral tokens. Lumeo currently has no Lumeo-operated backend by design.

## Adapter impact

Current Kyma/OpenAI Realtime adapter uses WebRTC SDP and remote media tracks. A Gemini adapter would need a different transport implementation:

- WebSocket session lifecycle
- PCM encode/resample from captured audio
- PCM decode/playback queue for output audio
- reconnect/resume policy
- ephemeral token provider UX or BYOK-safe token flow

## Comparison vs current Kyma/OpenAI path

| Area | Kyma/OpenAI Realtime | Gemini Live candidate |
|---|---|---|
| Transport | WebRTC SDP/media tracks | WebSocket raw PCM |
| Auth | User Kyma key in local storage | Ephemeral token recommended; backend/token mint needed |
| Audio plumbing | Browser media tracks | Custom PCM encode/decode/playback |
| Extension fit | Already implemented/tested | Needs MV3 offscreen prototype |
| Ship risk | Known current path | Preview API + custom audio path |

## Recommendation

- Keep P7 adapter foundation complete.
- Mark Gemini research complete.
- Do not implement Gemini Live until a prototype proves MV3 offscreen audio capture/playback and token minting story.
- Keep Gemini Live out of store metadata until implemented and manually smoke-tested.
