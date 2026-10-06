import { describe, it, expect } from "vitest";
import {
  parseCommitMessage,
  extractChangelogSection,
  determineReleasePlan,
} from "../scripts/prepare-release.mjs";

describe("prepare-release script", () => {
  describe("parseCommitMessage", () => {
    it("extracts version from 'release 1.0.0'", () => {
      expect(parseCommitMessage("release 1.0.0", "2.0.0")).toBe("1.0.0");
    });

    it("extracts version from 'release: 1.0.0'", () => {
      expect(parseCommitMessage("release: 1.0.0", "2.0.0")).toBe("1.0.0");
    });

    it("extracts version from 'release: v2.0.1'", () => {
      expect(parseCommitMessage("release: v2.0.1", "2.0.0")).toBe("2.0.1");
    });

    it("extracts version from 'chore(release): 2.1.0'", () => {
      expect(parseCommitMessage("chore(release): 2.1.0", "2.0.0")).toBe("2.1.0");
    });

    it("extracts prerelease version from 'Release: 2.0.0-beta.1'", () => {
      expect(parseCommitMessage("Release: 2.0.0-beta.1", "2.0.0")).toBe("2.0.0-beta.1");
    });

    it("falls back to manifest version if message is just 'release'", () => {
      expect(parseCommitMessage("release", "2.0.0")).toBe("2.0.0");
      expect(parseCommitMessage("chore: release", "2.0.0")).toBe("2.0.0");
    });

    it("returns null for non-release commits", () => {
      expect(parseCommitMessage("feat: add subtitle popover", "2.0.0")).toBeNull();
      expect(parseCommitMessage("fix: solve race condition", "2.0.0")).toBeNull();
      expect(parseCommitMessage("", "2.0.0")).toBeNull();
      expect(parseCommitMessage(null, "2.0.0")).toBeNull();
    });
  });

  describe("extractChangelogSection", () => {
    const sampleChangelog = `
# Changelog

## [2.0.0] - 2026-10-06 — Production Release
Major changes here.
- Feature A
- Feature B

## [1.9.0] - 2026-09-01 — Older Release
- Old feature
`;

    it("extracts matching version section with headers", () => {
      const section = extractChangelogSection(sampleChangelog, "2.0.0");
      expect(section).toContain("## [2.0.0] - 2026-10-06 — Production Release");
      expect(section).toContain("Major changes here.");
      expect(section).toContain("- Feature A");
      expect(section).not.toContain("## [1.9.0]");
    });

    it("returns null if version is not in changelog", () => {
      const section = extractChangelogSection(sampleChangelog, "3.0.0");
      expect(section).toBeNull();
    });
  });

  describe("determineReleasePlan", () => {
    const changelog = "## [2.0.0] - 2026-10-06\n- New UI\n\n## [1.0.0]\n- Initial";

    it("creates release plan from commit message 'release 2.0.0'", () => {
      const plan = determineReleasePlan({
        eventName: "push",
        refName: "main",
        commitMessage: "release 2.0.0",
        manifestVersion: "2.0.0",
        changelogContent: changelog,
      });

      expect(plan.shouldRelease).toBe(true);
      expect(plan.version).toBe("2.0.0");
      expect(plan.tag).toBe("v2.0.0");
      expect(plan.notes).toContain("## [2.0.0]");
      expect(plan.notes).toContain("- New UI");
    });

    it("skips non-release commit", () => {
      const plan = determineReleasePlan({
        eventName: "push",
        refName: "main",
        commitMessage: "docs: update readme",
        manifestVersion: "2.0.0",
        changelogContent: changelog,
      });

      expect(plan.shouldRelease).toBe(false);
    });

    it("handles workflow_dispatch with tagInput", () => {
      const plan = determineReleasePlan({
        eventName: "workflow_dispatch",
        tagInput: "v2.0.0",
        manifestVersion: "2.0.0",
        changelogContent: changelog,
      });

      expect(plan.shouldRelease).toBe(true);
      expect(plan.tag).toBe("v2.0.0");
      expect(plan.version).toBe("2.0.0");
    });
  });
});
