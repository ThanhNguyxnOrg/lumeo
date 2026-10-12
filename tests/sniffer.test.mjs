import { describe, it, expect, vi } from "vitest";
import { createSandboxWindow, loadService } from "./helpers/load-service.mjs";

async function setupSniffer() {
  const { window } = await createSandboxWindow();
  window.fetch = vi.fn(async () => ({
    status: 200,
    clone: () => ({ text: async () => "[Subtitle]" }),
  }));
  loadService("services/sniffer.js", window);
  return window;
}

describe("services/sniffer.js — nonce handoff", () => {
  it("exposes a setter that adopts the dynamic loader nonce into live messages", async () => {
    const window = await setupSniffer();
    expect(typeof window.__ytTransSnifferSetNonce).toBe("function");

    const posted = [];
    window.postMessage = (message) => { posted.push(message); };

    window.__ytTransSnifferSetNonce("handed-nonce-1");
    await window.fetch("https://www.youtube.com/api/timedtext?v=test&lang=en");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const snifferMessages = posted.filter((msg) => msg?.source === "yt-trans-sniffer");
    expect(snifferMessages.length).toBeGreaterThan(0);
    for (const msg of snifferMessages) {
      expect(msg.nonce).toBe("handed-nonce-1");
    }
  });

  it("ignores empty nonce handoffs", async () => {
    const window = await setupSniffer();
    const posted = [];
    window.postMessage = (message) => { posted.push(message); };

    window.__ytTransSnifferSetNonce("");
    window.__ytTransSnifferSetNonce(null);
    await window.fetch("https://www.youtube.com/api/timedtext?v=test&lang=en");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const snifferMessages = posted.filter((msg) => msg?.source === "yt-trans-sniffer");
    expect(snifferMessages.length).toBeGreaterThan(0);
    for (const msg of snifferMessages) {
      expect(msg.nonce).toBe("");
    }
  });
});
