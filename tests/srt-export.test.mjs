import { describe, it, expect, beforeAll } from "vitest";
import { createSandboxWindow, loadService } from "./helpers/load-service.mjs";

describe("services/srt-export.js", () => {
  let api;

  beforeAll(async () => {
    const { window } = await createSandboxWindow();
    loadService("services/srt-export.js", window);
    api = window.LumeoSrtExport;
  });

  it("formats SRT timestamps with millisecond precision", () => {
    expect(api.formatSrtTime(0)).toBe("00:00:00,000");
    expect(api.formatSrtTime(61.5)).toBe("00:01:01,500");
    expect(api.formatSrtTime(3661.25)).toBe("01:01:01,250");
    expect(api.formatSrtTime(-1)).toBe("00:00:00,000");
  });

  it("sanitizes filenames: strips Windows/Unix-illegal characters", () => {
    expect(api.sanitizeFilename("a/b\\c")).not.toMatch(/[\\/]/);
    expect(api.sanitizeFilename("  ")).toBe("lumeo-subtitles");
    expect(api.sanitizeFilename("x".repeat(200))).toHaveLength(120);
    expect(api.sanitizeFilename("a:b*c?")).not.toMatch(/[:*?]/);
  });

  it("renders a numbered SRT block per cue", () => {
    const cues = [
      { start: 0, end: 1, text: "hello", translated: "xin chào" },
      { start: 1, end: 2, text: "world", translated: "thế giới" },
    ];
    const srt = api.toSrt(cues);
    expect(srt).toMatch(/^1\n00:00:00,000 --> 00:00:01,000\nxin chào/);
    expect(srt).toMatch(/2\n00:00:01,000 --> 00:00:02,000\nthế giới/);
  });

  it("falls back to source text when translated is empty", () => {
    const srt = api.toSrt([{ start: 0, end: 1, text: "hi" }]);
    expect(srt).toContain("hi");
    const srtSource = api.toSrt([{ start: 0, end: 1, text: "hi" }], { translated: false });
    expect(srtSource).toContain("hi");
  });

  it("makeZip emits the ZIP local-file magic bytes and central directory", async () => {
    const blob = api.makeZip([
      { name: "a.srt", content: "hello" },
      { name: "b.srt", content: "world" },
    ]);
    const buf = new Uint8Array(await blob.arrayBuffer());
    // "PK\x03\x04" local file header
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    expect(buf[2]).toBe(0x03);
    expect(buf[3]).toBe(0x04);
    // End-of-central-directory signature appears near the tail
    const tail = Array.from(buf.slice(-22, -18));
    expect(tail).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });

  it("makeSubtitleZip names both original and translated tracks", async () => {
    const blob = api.makeSubtitleZip(
      [{ start: 0, end: 1, text: "a", translated: "b" }],
      "Lumeo Demo",
    );
    const text = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
    expect(text).toContain("Lumeo Demo_original.srt");
    expect(text).toContain("Lumeo Demo_translated.srt");
  });

  it("renders WebVTT and plain-text subtitle exports", () => {
    const cues = [{ start: 0, end: 1.25, text: "hello", translated: "xin chào" }];

    expect(api.toVtt(cues)).toBe("WEBVTT\n\n00:00:00.000 --> 00:00:01.250\nxin chào\n");
    expect(api.toPlainText(cues, { bilingual: true })).toBe("xin chào\nhello");
  });

  it("includes SRT, VTT, TXT, and JSON bundle in subtitle ZIP", async () => {
    const blob = api.makeSubtitleZip(
      [{ start: 0, end: 1, text: "a", translated: "b" }],
      "Lumeo Demo",
    );
    const text = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
    expect(text).toContain("Lumeo Demo_translated.vtt");
    expect(text).toContain("Lumeo Demo_bilingual.txt");
    expect(text).toContain("Lumeo Demo_bundle.json");
  });
});
