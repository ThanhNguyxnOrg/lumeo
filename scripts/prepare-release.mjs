import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

export function parseCommitMessage(message, fallbackVersion) {
  if (!message || typeof message !== "string") {
    return null;
  }

  const trimmed = message.trim();

  // Pattern 1: Any message containing release followed by version (e.g. release 1.0.0, release: 1.0.0, release: v1.0.0, chore(release): 2.1.0, release v1.0.0)
  const explicitMatch = trimmed.match(
    /(?:release(?:\([^)]*\))?|chore\(release\))[:\s]+v?(\d+\.\d+\.\d+(?:-[\w.]+)?)/i
  );
  if (explicitMatch) {
    return explicitMatch[1];
  }

  // Pattern 2: Commit message starts with or is solely "release" / "chore: release"
  const keywordMatch = trimmed.match(
    /^(?:chore(?:\([^)]*\))?:\s*)?release\b/i
  );
  if (keywordMatch) {
    return fallbackVersion;
  }

  return null;
}

export function extractChangelogSection(changelogContent, version) {
  if (!changelogContent || !version) {
    return null;
  }

  const escapedVer = version.replace(/\./g, "\\.");
  // Matches "## [2.0.0]" or "## 2.0.0" or "## [v2.0.0]" up to the next "## [" or "## " header
  const regex = new RegExp(
    `(^|\\n)(##\\s*\\[?v?${escapedVer}\\]?[^\\n]*\\n[\\s\\S]*?)(?=\\n##\\s*\\[|\\n##\\s*v?\\d+\\.\\d+|$)`,
    "i"
  );
  const match = changelogContent.match(regex);
  if (match && match[2]) {
    return match[2].trim();
  }

  return null;
}

export function determineReleasePlan({
  eventName,
  refName,
  tagInput,
  commitMessage,
  manifestVersion,
  changelogContent,
}) {
  let version = null;

  // Case 1: Manual workflow_dispatch with explicit tag input
  if (eventName === "workflow_dispatch" && tagInput) {
    version = tagInput.replace(/^v/, "").trim();
  }
  // Case 2: Pushed git tag (e.g. v2.0.0)
  else if (refName && refName.startsWith("v")) {
    version = refName.replace(/^v/, "").trim();
  }
  // Case 3: Push commit to main branch
  else if (commitMessage) {
    version = parseCommitMessage(commitMessage, manifestVersion);
  }

  if (!version) {
    return { shouldRelease: false };
  }

  const tag = `v${version}`;
  let notes = extractChangelogSection(changelogContent, version);

  if (!notes) {
    const firstLine = (commitMessage || "").trim().split("\n")[0] || tag;
    notes = `## ${tag}\n\nAutomated release from commit: ${firstLine}`;
  }

  return {
    shouldRelease: true,
    version,
    tag,
    notes,
  };
}

// CLI execution when run directly
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename || "")) {
  const rootDir = process.cwd();
  const manifest = JSON.parse(readFileSync(resolve(rootDir, "manifest.json"), "utf8"));
  const changelog = readFileSync(resolve(rootDir, "CHANGELOG.md"), "utf8");

  const eventName = process.env.GITHUB_EVENT_NAME || "push";
  const refName = process.env.GITHUB_REF_NAME || "";
  const tagInput = process.env.INPUT_TAG || "";

  let commitMessage = process.env.COMMIT_MESSAGE || "";
  if (!commitMessage) {
    try {
      commitMessage = execSync("git log -1 --pretty=%B", { encoding: "utf8" });
    } catch {
      commitMessage = "";
    }
  }

  const plan = determineReleasePlan({
    eventName,
    refName,
    tagInput,
    commitMessage,
    manifestVersion: manifest.version,
    changelogContent: changelog,
  });

  if (!plan.shouldRelease) {
    console.log("Not a release commit or event. Skipping release.");
    if (process.env.GITHUB_OUTPUT) {
      writeFileSync(process.env.GITHUB_OUTPUT, "should_release=false\n", { flag: "a" });
    }
    process.exit(0);
  }

  console.log(`Release identified: ${plan.tag} (version ${plan.version})`);
  const notesFile = resolve(rootDir, "RELEASE_NOTES.md");
  writeFileSync(notesFile, plan.notes + "\n", "utf8");

  if (process.env.GITHUB_OUTPUT) {
    const output = [
      "should_release=true",
      `version=${plan.version}`,
      `tag=${plan.tag}`,
      `notes_file=RELEASE_NOTES.md`,
    ].join("\n") + "\n";
    writeFileSync(process.env.GITHUB_OUTPUT, output, { flag: "a" });
  }
}
