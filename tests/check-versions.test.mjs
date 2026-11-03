import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { normalizeVersion, validateVersions } from "../scripts/check-versions.mjs";

const base = {
  manifestVersion: "2.0.7",
  packageVersion: "2.0.7",
  contentVersion: "2.0.7",
  changelogContent: "## [2.0.7]\n\n- Fixed things.\n",
  readmeContent: "![Version](https://img.shields.io/badge/version-2.0.7-ff7a45)",
};

describe("scripts/check-versions.mjs", () => {
  it("normalizes a leading v", () => {
    expect(normalizeVersion(" v2.0.7 ")).toBe("2.0.7");
  });

  it("accepts matching versions", () => {
    expect(validateVersions(base)).toEqual({ ok: true, version: "2.0.7", errors: [] });
  });

  it("rejects a release tag that differs from the manifest", () => {
    const result = validateVersions({ ...base, tag: "v2.1.0" });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("does not match manifest.json");
  });

  it("rejects drift between manifest, package, content, and README", () => {
    const result = validateVersions({
      ...base,
      packageVersion: "2.0.6",
      contentVersion: "2.0.5",
      readmeContent: "badge/version-2.0.4-ff7a45",
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(3);
  });

  it("requires a changelog section for the release version", () => {
    const result = validateVersions({ ...base, changelogContent: "## [2.0.6]\n" });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("CHANGELOG.md");
  });

  it("does not treat a branch name in GITHUB_REF_NAME as a release tag", () => {
    const output = execFileSync(process.execPath, ["scripts/check-versions.mjs"], {
      cwd: resolve(import.meta.dirname, ".."),
      env: { ...process.env, GITHUB_REF_NAME: "main", GITHUB_REF_TYPE: "branch" },
      encoding: "utf8",
    });
    expect(output).toContain("Version checks passed");
  });
});
