import { describe, it, expect, beforeAll } from "vitest";
import { createChromeMock } from "./helpers/chrome-mock.mjs";
import { createSandboxWindow, loadService } from "./helpers/load-service.mjs";

describe("services/captions.js — pure parser surface", () => {
  let api;
  let window;

  beforeAll(async () => {
    ({ window } = await createSandboxWindow());
    window.chrome = createChromeMock();
    loadService("services/captions.js", window);
    api = window.LumeoCaptions;
  });

  it("parseSubtitleXml produces one cue per <text> node", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<transcript>
  <text start="0" dur="1.5">hello</text>
  <text start="1.5" dur="2">world</text>
</transcript>`;
    const cues = api.parseSubtitleXml(xml);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ start: 0, end: 1.5, text: "hello" });
    expect(cues[1]).toMatchObject({ start: 1.5, end: 3.5, text: "world" });
  });

  it("parseSubtitleJson3 decodes YouTube's event-based transcript", () => {
    const json = JSON.stringify({
      events: [
        { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "hi" }] },
        { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: "there" }] },
      ],
    });
    const cues = api.parseSubtitleJson3(json);
    expect(cues).toHaveLength(2);
    expect(cues[0].text).toBe("hi");
    expect(cues[1].start).toBe(1);
  });

  it("cleanSubtitleText strips tags and decodes HTML entities", () => {
    expect(api.cleanSubtitleText("<b>hi</b> &amp; bye")).toBe("hi & bye");
    expect(api.cleanSubtitleText("  multiple   spaces  ")).toBe("multiple spaces");
  });

  it("mergeBilingualCues picks the highest-overlap target cue", () => {
    const src = [
      { start: 0, end: 2, text: "hello", translated: "" },
      { start: 2, end: 4, text: "world", translated: "" },
    ];
    const tgt = [
      { start: 0, end: 2.1, text: "xin chào" },
      { start: 2.1, end: 4, text: "thế giới" },
    ];
    const merged = api.mergeBilingualCues(src, tgt);
    expect(merged[0].translated).toBe("xin chào");
    expect(merged[1].translated).toBe("thế giới");
  });

  it("auto-detects JSON vs XML subtitle payloads", () => {
    const json = '{"events":[{"tStartMs":0,"dDurationMs":1000,"segs":[{"utf8":"hi"}]}]}';
    const xml = '<transcript><text start="0" dur="1">hi</text></transcript>';
    expect(api.parseSubtitleText(json)).toHaveLength(1);
    expect(api.parseSubtitleText(xml)).toHaveLength(1);
    expect(api.parseSubtitleText("")).toEqual([]);
  });
});
