import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { createChromeMock } from "./helpers/chrome-mock.mjs";

describe("background content script injection", () => {
  it("injects the manifest's isolated-world content scripts, in manifest order", async () => {
    const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
    // The tab has no content script yet, so Start has to inject it.
    const chrome = createChromeMock({
      manifest,
      onTabMessage: (_tabId, message) => {
        if (message.type === "CONTENT_PING") throw new Error("Receiving end does not exist.");
        return { ok: true };
      },
    });
    chrome.storage.onChanged = { addListener: vi.fn() };
    const previous = globalThis.chrome;
    globalThis.chrome = chrome;
    try {
      vi.resetModules();
      await import("../background.js");
      const sender = { tab: { id: 7, url: "https://www.youtube.com/watch?v=test" } };
      await new Promise((resolve) => chrome.__runtimeListeners[0]({ type: "START" }, sender, resolve));
      const moduleCall = chrome.scripting.executeScript.mock.calls
        .map(([details]) => details)
        .find((details) => details.files?.includes("content.js"));
      expect(moduleCall.files).toEqual(manifest.content_scripts[1].js);
      expect(moduleCall.files).not.toContain("services/sniffer.js");
    } finally {
      globalThis.chrome = previous;
    }
  });

  it("health-checks every runtime-critical content module", () => {
    const background = fs.readFileSync("background.js", "utf8");
    const content = fs.readFileSync("content.js", "utf8");

    expect(content).toContain("browserApi: !!globalThis.LumeoBrowserApi");
    expect(background).toContain("reply.browserApi");
    for (const key of [
      "captionPipeline",
      "realtimePipeline",
      "standardPipeline",
      "overlayModule",
      "subtitleOverlayModule",
      "captionOrchestrator",
    ]) {
      expect(content).toContain(`${key}: !!window.`);
      expect(background).toContain(`reply.${key}`);
    }
  });

  it("declares Alt+L keyboard shortcut command for toggling in player", () => {
    const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
    expect(manifest.commands?._execute_action?.suggested_key?.default).toBe("Alt+L");
  });

  it("injects the page-world sniffer before content modules", () => {
    const background = fs.readFileSync("background.js", "utf8");
    const snifferIndex = background.indexOf("await ensureSniffer(tabId);");
    const modulesIndex = background.indexOf("files: CONTENT_SCRIPT_FILES");
    expect(snifferIndex).toBeGreaterThan(-1);
    expect(modulesIndex).toBeGreaterThan(snifferIndex);
  });
});
