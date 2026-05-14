import { describe, expect, it } from "vitest";
import fs from "node:fs";

function extractArrayLiteral(source, name) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
  if (!match) throw new Error(`Missing ${name}`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

describe("background content script injection", () => {
  it("keeps dynamic injection order aligned with manifest content scripts", () => {
    const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
    const background = fs.readFileSync("background.js", "utf8");

    expect(extractArrayLiteral(background, "CONTENT_SCRIPT_FILES")).toEqual(
      manifest.content_scripts[1].js,
    );
  });

  it("health-checks every runtime-critical content module", () => {
    const background = fs.readFileSync("background.js", "utf8");
    const content = fs.readFileSync("content.js", "utf8");

    for (const key of [
      "browserApi",
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
});
