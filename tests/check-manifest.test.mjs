import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { collectReferencedFiles, checkManifest } from "../scripts/check-manifest.mjs";

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));

describe("scripts/check-manifest.mjs", () => {
  it("collects runtime files referenced by the manifest", () => {
    const files = collectReferencedFiles(manifest);
    expect(files).toContain("background.js");
    expect(files).toContain("content.js");
    expect(files).toContain("services/sniffer.js");
    expect(files).toContain("services/audio-processor.js");
  });

  it("passes against the checked-in manifest", () => {
    const result = checkManifest("manifest.json");
    expect(result.errors).toEqual([]);
  });
});
