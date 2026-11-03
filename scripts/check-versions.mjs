import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function normalizeVersion(value) {
  return String(value || "").trim().replace(/^v/i, "");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function validateVersions({
  manifestVersion,
  packageVersion,
  contentVersion,
  changelogContent = "",
  readmeContent = "",
  tag = "",
} = {}) {
  const errors = [];
  const version = normalizeVersion(manifestVersion);

  if (!SEMVER_RE.test(version)) {
    errors.push(`manifest.json version "${manifestVersion || ""}" is not valid semver.`);
  }
  if (normalizeVersion(packageVersion) !== version) {
    errors.push(`package.json version "${packageVersion}" does not match manifest.json "${version}".`);
  }
  if (normalizeVersion(contentVersion) !== version) {
    errors.push(`content.js LUMEO_VERSION "${contentVersion}" does not match manifest.json "${version}".`);
  }

  if (version && !new RegExp(`^##\\s*\\[?v?${escapeRegExp(version)}\\]?`, "m").test(changelogContent)) {
    errors.push(`CHANGELOG.md is missing a "## [${version}]" section.`);
  }

  const readmeVersion = readmeContent.match(/badge\/version-([0-9]+\.[0-9]+\.[0-9]+)-/i)?.[1];
  if (readmeVersion && normalizeVersion(readmeVersion) !== version) {
    errors.push(`README.md version badge "${readmeVersion}" does not match manifest.json "${version}".`);
  }

  const normalizedTag = normalizeVersion(tag);
  if (normalizedTag && normalizedTag !== version) {
    errors.push(`Release tag "${tag}" does not match manifest.json "${version}".`);
  }

  return { ok: errors.length === 0, version, errors };
}

export function checkVersions(root = process.cwd(), tag = "") {
  const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const content = readFileSync(resolve(root, "content.js"), "utf8");
  const changelog = readFileSync(resolve(root, "CHANGELOG.md"), "utf8");
  const readme = readFileSync(resolve(root, "README.md"), "utf8");
  const contentVersion = content.match(/const\s+LUMEO_VERSION\s*=\s*["']([^"']+)["']/)?.[1] || "";

  return validateVersions({
    manifestVersion: manifest.version,
    packageVersion: pkg.version,
    contentVersion,
    changelogContent: changelog,
    readmeContent: readme,
    tag,
  });
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || "" : "";
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename || "")) {
  // Only an explicit --tag (or RELEASE_TAG) is checked. GITHUB_REF_NAME is a
  // branch name on normal pushes and must not be treated as a release tag.
  const tag = readArg("--tag") || process.env.RELEASE_TAG || "";
  const result = checkVersions(process.cwd(), tag);
  if (!result.ok) {
    for (const error of result.errors) console.error(`::error::${error}`);
    process.exit(1);
  }
  console.log(`Version checks passed — ${result.version}`);
}
