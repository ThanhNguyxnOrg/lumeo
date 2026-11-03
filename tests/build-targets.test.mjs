import { describe, it, expect } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import {
  buildTargets,
  createZip,
  isRuntimeFile,
  transformManifest,
} from "../scripts/build-targets.mjs";

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));

describe("scripts/build-targets.mjs", () => {
  it("keeps the Chrome service worker and removes only non-runtime web resources", () => {
    const chrome = transformManifest(manifest, "chrome");
    expect(chrome.background.service_worker).toBe("background.js");
    expect(chrome.minimum_chrome_version).toBe("116");
    expect(chrome.web_accessible_resources[0].resources).toEqual([
      "services/audio-processor.js",
    ]);
  });

  it("creates a Firefox manifest with background scripts and gecko metadata", () => {
    const firefox = transformManifest(manifest, "firefox");
    expect(firefox.background).toEqual({ scripts: ["background.js"], type: "module" });
    expect(firefox.background.service_worker).toBeUndefined();
    expect(firefox.minimum_chrome_version).toBeUndefined();
    expect(firefox.browser_specific_settings.gecko.id).toBeTruthy();
    expect(firefox.browser_specific_settings.gecko.strict_min_version).toBe("128.0");
    expect(firefox.browser_specific_settings.gecko.data_collection_permissions.required)
      .toEqual(["websiteContent", "authenticationInfo"]);
  });

  it("removes the Chrome-only minimum version from Edge and Opera", () => {
    for (const target of ["edge", "opera"]) {
      expect(transformManifest(manifest, target).minimum_chrome_version).toBeUndefined();
    }
  });

  it("allows only runtime paths", () => {
    expect(isRuntimeFile("background.js")).toBe(true);
    expect(isRuntimeFile("services/captions.js")).toBe(true);
    expect(isRuntimeFile("tests/session-manager.test.mjs")).toBe(false);
    expect(isRuntimeFile("docs/research/multi-platform-release.md")).toBe(false);
    expect(isRuntimeFile(".env")).toBe(false);
  });

  it("produces deterministic ZIP bytes", () => {
    const entries = [
      { name: "b.js", data: "console.log('b');" },
      { name: "a.js", data: "console.log('a');" },
    ];
    const first = createZip(entries);
    const second = createZip([...entries].reverse());
    expect(first.equals(second)).toBe(true);
    expect(first.subarray(0, 2).toString()).toBe("PK");
    expect(first.includes(Buffer.from("a.js"))).toBe(true);
    expect(first.includes(Buffer.from("b.js"))).toBe(true);
  });

  it("builds all four target packages", () => {
    try {
      const results = buildTargets({ outDir: "dist-test", targets: ["chrome", "edge", "firefox", "opera"] });
      expect(Object.keys(results).sort()).toEqual(["chrome", "edge", "firefox", "opera"]);
      for (const result of Object.values(results)) {
        expect(result.files).toBeGreaterThan(30);
        expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
      }
    } finally {
      rmSync("dist-test", { recursive: true, force: true });
    }
  });
});
