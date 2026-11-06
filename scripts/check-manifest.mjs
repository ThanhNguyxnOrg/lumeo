import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function addFile(files, value) {
  if (typeof value === "string" && value && !value.includes("*")) files.add(value);
}

export function collectReferencedFiles(manifest) {
  const files = new Set();

  if (manifest.background) {
    addFile(files, manifest.background.service_worker);
    addFile(files, manifest.background.page);
    for (const script of manifest.background.scripts || []) addFile(files, script);
  }

  for (const script of manifest.content_scripts || []) {
    for (const file of script.js || []) addFile(files, file);
    for (const file of script.css || []) addFile(files, file);
  }

  for (const file of Object.values(manifest.icons || {})) addFile(files, file);

  const action = manifest.action || manifest.browser_action || manifest.page_action || {};
  for (const file of Object.values(action.default_icon || {})) addFile(files, file);
  addFile(files, action.default_popup);

  addFile(files, manifest.options_page);
  addFile(files, manifest.options_ui?.page);
  addFile(files, manifest.devtools_page);
  addFile(files, manifest.side_panel?.default_path);
  addFile(files, manifest.storage?.managed_schema);

  for (const override of Object.values(manifest.chrome_url_overrides || {})) addFile(files, override);
  for (const resource of manifest.declarative_net_request?.rule_resources || []) addFile(files, resource.path);

  for (const entry of manifest.web_accessible_resources || []) {
    for (const resource of entry.resources || []) addFile(files, resource);
  }

  // Microsoft Edge Partner Center reads the listing languages from the
  // package's _locales directory, so the default locale file must ship.
  if (typeof manifest.default_locale === "string" && manifest.default_locale) {
    addFile(files, `_locales/${manifest.default_locale}/messages.json`);
  }

  return [...files].sort();
}

function readLocaleMessages(root, locale) {
  try {
    return JSON.parse(readFileSync(resolve(root, "_locales", locale, "messages.json"), "utf8"));
  } catch {
    return null;
  }
}

function resolveMessage(root, manifest, value) {
  const placeholder = /^__MSG_(.+)__$/.exec(String(value || ""));
  if (!placeholder) return { text: value, key: null };
  const key = placeholder[1];
  const locale = typeof manifest.default_locale === "string" ? manifest.default_locale : "";
  const messages = locale ? readLocaleMessages(root, locale) : null;
  const text = messages?.[key]?.message;
  return { text: typeof text === "string" ? text : null, key };
}

export function checkManifest(manifestPath = "manifest.json") {
  const absolutePath = resolve(process.cwd(), manifestPath);
  const root = resolve(absolutePath, "..");
  const manifest = JSON.parse(readFileSync(absolutePath, "utf8"));
  const errors = [];
  const warnings = [];

  if (manifest.manifest_version !== 3) errors.push("manifest_version must be 3.");
  if (!manifest.name) errors.push("name is required.");
  if (!manifest.version) errors.push("version is required.");

  if (manifest.default_locale !== undefined && typeof manifest.default_locale !== "string") {
    errors.push("default_locale must be a string.");
  }
  if (!manifest.default_locale && existsSync(resolve(root, "_locales"))) {
    errors.push("_locales exists but default_locale is not set.");
  }

  for (const field of ["name", "description"]) {
    const raw = manifest[field];
    const resolved = resolveMessage(root, manifest, raw);
    if (resolved.key && resolved.text === null) {
      errors.push(
        `${field} message key "${resolved.key}" was not found in _locales/${manifest.default_locale || "<unset>"}/messages.json.`
      );
    }
  }

  // Chrome and Microsoft Edge reject a manifest description longer than 132
  // characters during package validation, so catch it before a release. When
  // the field is a __MSG_ placeholder, check the resolved locale string.
  const MAX_DESCRIPTION_LENGTH = 132;
  const descriptionText = resolveMessage(root, manifest, manifest.description).text;
  if (typeof manifest.description !== "string" || !manifest.description.trim()) {
    errors.push("description is required.");
  } else if (typeof descriptionText === "string" && descriptionText.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(
      `description is ${descriptionText.length} characters after localization; Chrome and Edge allow at most ${MAX_DESCRIPTION_LENGTH}.`
    );
  }

  const seenHosts = new Set();
  for (const host of manifest.host_permissions || []) {
    if (seenHosts.has(host)) warnings.push(`duplicate host permission: ${host}`);
    seenHosts.add(host);
  }

  for (const file of collectReferencedFiles(manifest)) {
    if (!existsSync(resolve(root, file))) errors.push(`referenced file does not exist: ${file}`);
  }

  return { manifest, files: collectReferencedFiles(manifest), errors, warnings };
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || "" : "";
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename || "")) {
  const manifestPath = readArg("--manifest") || "manifest.json";
  const result = checkManifest(manifestPath);
  for (const warning of result.warnings) console.warn(`::warning::${warning}`);
  if (result.errors.length) {
    for (const error of result.errors) console.error(`::error::${error}`);
    process.exit(1);
  }
  console.log(`Manifest references OK — ${result.files.length} files checked.`);
}
