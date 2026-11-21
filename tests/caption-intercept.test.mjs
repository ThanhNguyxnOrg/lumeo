import { describe, it, expect, vi } from "vitest";
import { createChromeMock } from "./helpers/chrome-mock.mjs";
import { createSandboxWindow, loadService } from "./helpers/load-service.mjs";

const JSON3 = JSON.stringify({
  events: [
    { tStartMs: 0, dDurationMs: 1500, segs: [{ utf8: "hello there" }] },
    { tStartMs: 1500, dDurationMs: 2000, segs: [{ utf8: "general kenobi" }] },
  ],
});

async function setup(body = JSON3) {
  const { window } = await createSandboxWindow();
  window.chrome = createChromeMock();
  window.fetch = vi.fn(async () => ({
    status: 200,
    clone: () => ({ text: async () => body }),
  }));
  // jsdom's postMessage leaves event.source/origin unset; deliver the way a
  // browser does so the content-script filter sees a same-window message.
  window.postMessage = (data) => {
    window.dispatchEvent(new window.MessageEvent("message", {
      data,
      origin: window.location.origin,
      source: window,
    }));
  };
  loadService("services/captions.js", window);
  loadService("services/sniffer.js", window);
  return window;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

describe("page sniffer → content script caption interception", () => {
  it("stores the player's own timedtext response", async () => {
    const window = await setup();

    await window.fetch("https://www.youtube.com/api/timedtext?v=test&lang=en&pot=abc&fmt=json3");
    await settle();

    expect(window.LumeoCaptions.getDiagnosticsSummary()).toMatchObject({
      sniffedUrlCount: 1,
      interceptedCaptionCount: 1,
    });
  });

  it("keeps the envelope source and reports the transport separately", async () => {
    const window = await setup();
    const posted = [];
    window.addEventListener("message", (event) => posted.push(event.data));

    await window.fetch("https://www.youtube.com/api/timedtext?v=test&lang=en&pot=abc");
    await settle();

    const body = posted.find((msg) => msg?.type === "caption-body");
    expect(body).toMatchObject({ source: "yt-trans-sniffer", via: "fetch" });
  });

  it("does not treat an auto-translated response as the source track", async () => {
    const window = await setup();

    await window.fetch("https://www.youtube.com/api/timedtext?v=test&lang=en&tlang=vi&pot=abc");
    await settle();

    expect(window.LumeoCaptions.getDiagnosticsSummary().interceptedCaptionCount).toBe(0);
  });
});

describe("native transcript fallback", () => {
  it("opens YouTube's transcript section, not hidden or Lumeo controls", async () => {
    const window = await setup();
    const { document } = window;
    document.body.innerHTML = `
      <aside class="ec-root"><button data-ec-transcript hidden aria-label="Transcript" type="button"></button></aside>
      <div hidden><button id="hidden-more" aria-label="More"></button></div>
      <ytd-structured-description-content-renderer>
        <button id="view-all">View all</button>
        <ytd-video-description-transcript-section-renderer>
          <button id="native-transcript">Show transcript</button>
        </ytd-video-description-transcript-section-renderer>
      </ytd-structured-description-content-renderer>
      <ytd-engagement-panel-section-list-renderer target-id="engagement-panel-searchable-transcript" id="panel">
      </ytd-engagement-panel-section-list-renderer>`;

    const clicked = [];
    for (const id of ["hidden-more", "view-all", "native-transcript"]) {
      document.getElementById(id).addEventListener("click", () => clicked.push(id));
    }
    document.querySelector("[data-ec-transcript]").addEventListener("click", () => clicked.push("lumeo"));
    document.getElementById("native-transcript").addEventListener("click", () => {
      document.getElementById("panel").innerHTML = `
        <ytd-transcript-segment-renderer>
          <div class="segment-timestamp">0:01</div><div class="segment-text">hello there</div>
        </ytd-transcript-segment-renderer>
        <ytd-transcript-segment-renderer>
          <div class="segment-timestamp">0:05</div><div class="segment-text">general kenobi</div>
        </ytd-transcript-segment-renderer>`;
    });

    const diagnostics = {};
    const result = await window.LumeoCaptions.fetchViaTranscriptPanel(diagnostics);

    expect(clicked).toEqual(["native-transcript"]);
    expect(result.cues.map((cue) => cue.text)).toEqual(["hello there", "general kenobi"]);
    expect(diagnostics.transcriptPanel).toBe("dom-2");
  }, 15000);
});
