import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { collectReferencedFiles, checkManifest } from "../scripts/check-manifest.mjs";

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));

function checkTemporaryManifest(overrides, extraFiles = {}) {
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
    for (const [relativePath, content] of Object.entries(extraFiles)) {
      const absolute = join(dir, relativePath);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, JSON.stringify(content));
    }
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
    expect(files).toContain("_locales/en/messages.json");
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

  it("checks the resolved __MSG_ description length", () => {
    const result = checkTemporaryManifest(
      { description: "__MSG_extensionDescription__", default_locale: "en" },
      { "_locales/en/messages.json": { extensionDescription: { message: "x".repeat(133) } } },
    );
    expect(result.errors.some((error) => /description is 133 characters after localization/.test(error))).toBe(true);
  });

  it("rejects a placeholder without a matching locale message", () => {
    const result = checkTemporaryManifest(
      { name: "__MSG_extensionName__", default_locale: "en" },
      { "_locales/en/messages.json": { otherKey: { message: "Lumeo" } } },
    );
    expect(result.errors.some((error) => /name message key "extensionName" was not found/.test(error))).toBe(true);
  });

  it("rejects _locales without default_locale", () => {
    const result = checkTemporaryManifest(
      {},
      { "_locales/en/messages.json": { extensionName: { message: "Lumeo" } } },
    );
    expect(result.errors.some((error) => /default_locale is not set/.test(error))).toBe(true);
  });
});
