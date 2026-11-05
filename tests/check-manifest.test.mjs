import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectReferencedFiles, checkManifest } from "../scripts/check-manifest.mjs";

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));

function checkTemporaryManifest(overrides) {
  const dir = mkdtempSync(join(tmpdir(), "lumeo-manifest-"));
  try {
    const file = join(dir, "manifest.json");
    const fixture = {
      manifest_version: 3,
      name: "Lumeo",
      version: "1.0.0",
      description: "Short enough.",
      ...overrides,
    };
    writeFileSync(file, JSON.stringify(fixture));
    return checkManifest(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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

  it("rejects a manifest description over the 132-character store limit", () => {
    const result = checkTemporaryManifest({ description: "x".repeat(133) });
    expect(result.errors.some((error) => /description is 133 characters/.test(error))).toBe(true);
  });

  it("accepts a manifest description at the 132-character limit", () => {
    const result = checkTemporaryManifest({ description: "x".repeat(132) });
    expect(result.errors.some((error) => /description is/.test(error))).toBe(false);
  });
});
