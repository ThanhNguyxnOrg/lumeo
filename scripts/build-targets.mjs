import {
  createHash,
} from "node:crypto";
import {
  execFileSync,
} from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { deflateRawSync } from "node:zlib";
import { dirname, join, relative, resolve } from "node:path";
import { normalizeVersion } from "./check-versions.mjs";

const RUNTIME_ROOT_FILES = new Set([
  "background.js",
  "content.css",
  "content.js",
  "options.css",
  "options.html",
  "options.js",
  "popup.css",
  "popup.html",
  "popup.js",
]);

const RUNTIME_DIRS = [
  "_locales/",
  "icons/",
  "lib/",
  "pipelines/",
  "services/",
  "ui/",
];

const SKIP_DIRS = new Set([
  ".git",
  ".github",
  ".playwright-mcp",
  ".sisyphus",
  ".vscode",
  ".idea",
  "_design_reference",
  "_echoly_extracted",
  "coverage",
  "dist",
  "docs",
  "ext",
  "node_modules",
  "output",
  "scripts",
  "store-assets",
  "tests",
]);

const TARGETS = ["chrome", "edge", "firefox", "opera"];
const GECKO_ID = process.env.GECKO_ID || "lumeo@thanhnguyxn.org";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipName(name) {
  return name.replace(/\\/g, "/").replace(/^\/+/, "");
}

export function createZip(entries) {
  const sorted = [...entries]
    .map((entry) => ({
      name: zipName(entry.name),
      data: Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of sorted) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

export function transformManifest(baseManifest, target) {
  if (!TARGETS.includes(target)) throw new Error(`Unknown target: ${target}`);
  const manifest = JSON.parse(JSON.stringify(baseManifest));
  delete manifest.browser_specific_settings;

  if (target === "firefox") {
    manifest.background = {
      scripts: ["background.js"],
      type: "module",
    };
    delete manifest.minimum_chrome_version;
    manifest.browser_specific_settings = {
      gecko: {
        id: GECKO_ID,
        // Firefox 140 introduced browser_specific_settings.gecko.data_collection_permissions;
        // a lower minimum would ship the manifest key to browsers that ignore it.
        strict_min_version: "140.0",
        data_collection_permissions: {
          // websiteContent: captions/audio sent to the user's chosen provider.
          // authenticationInfo: the user's own provider API keys are stored
          // locally and transmitted only to that provider.
          required: ["websiteContent", "authenticationInfo"],
        },
      },
      // Android got data_collection_permissions support in Firefox 142.
      gecko_android: {
        strict_min_version: "142.0",
      },
    };
  } else if (target !== "chrome") {
    delete manifest.minimum_chrome_version;
  }

  // Only the AudioWorklet must be readable by the YouTube page context (its
  // addModule URL is fetched from the page realm). The sniffer is injected by
  // the manifest/scripting API, and everything else is loaded by the content
  // script itself.
  manifest.web_accessible_resources = [{
    resources: ["services/audio-processor.js"],
    matches: ["https://*.youtube.com/*", "https://youtube.com/*"],
  }];

  return manifest;
}

export function isRuntimeFile(file) {
  const normalized = zipName(file);
  if (RUNTIME_ROOT_FILES.has(normalized)) return true;
  return RUNTIME_DIRS.some((dir) => normalized.startsWith(dir));
}

function listFilesFallback(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(absolute);
      } else if (entry.isFile()) {
        files.push(relative(root, absolute).replace(/\\/g, "/"));
      }
    }
  };
  walk(root);
  return files;
}

export function listRuntimeFiles(root = process.cwd()) {
  let files;
  try {
    // Package only committed paths. `--others` would let an untracked local
    // file under services/, lib/, or ui/ ride into a release ZIP even though it
    // is absent from review and from the tag's source tree.
    const output = execFileSync(
      "git",
      ["ls-files", "--cached", "-z"],
      { cwd: root, encoding: "buffer" },
    );
    files = output.toString("utf8").split("\0").filter(Boolean);
  } catch {
    files = listFilesFallback(root);
  }
  return files
    .map(zipName)
    .filter((file) => file !== "manifest.json" && isRuntimeFile(file))
    .filter((file) => !file.split("/").some((part) => SKIP_DIRS.has(part)))
    .filter((file) => !file.endsWith("/.gitkeep"))
    .filter((file) => !/^\.env(?:\.|$)/.test(file))
    .sort();
}

export function buildTargets({
  root = process.cwd(),
  outDir = "dist",
  targets = TARGETS,
  version = "",
} = {}) {
  const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
  const normalized = normalizeVersion(version || manifest.version);
  if (normalized !== manifest.version) {
    throw new Error(`Requested version ${normalized} does not match manifest.json ${manifest.version}.`);
  }

  const outputRoot = resolve(root, outDir);
  mkdirSync(outputRoot, { recursive: true });
  const files = listRuntimeFiles(root);
  const results = {};

  for (const target of targets) {
    if (!TARGETS.includes(target)) throw new Error(`Unknown target: ${target}`);
    const targetManifest = transformManifest(manifest, target);
    const targetDir = join(outputRoot, target);
    mkdirSync(targetDir, { recursive: true });

    const entries = files.map((file) => ({
      name: file,
      data: readFileSync(resolve(root, file)),
    }));
    entries.push({
      name: "manifest.json",
      data: Buffer.from(`${JSON.stringify(targetManifest, null, 2)}\n`, "utf8"),
    });

    for (const entry of entries) {
      const destination = join(targetDir, entry.name);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, entry.data);
    }

    const zipName = `lumeo-v${manifest.version}-${target}.zip`;
    const zip = createZip(entries);
    writeFileSync(join(outputRoot, zipName), zip);
    results[target] = {
      file: zipName,
      sha256: createHash("sha256").update(zip).digest("hex"),
      files: entries.length,
    };
  }

  const sums = Object.values(results)
    .map((result) => `${result.sha256}  ${result.file}`)
    .join("\n");
  writeFileSync(join(outputRoot, "SHA256SUMS.txt"), `${sums}\n`);
  writeFileSync(
    join(outputRoot, "build-metadata.json"),
    `${JSON.stringify({ version: manifest.version, targets: results }, null, 2)}\n`,
  );

  return results;
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || "" : "";
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename || "")) {
  try {
    const targetList = readArg("--targets");
    const targets = targetList ? targetList.split(",").map((t) => t.trim()).filter(Boolean) : TARGETS;
    const results = buildTargets({
      outDir: readArg("--out") || "dist",
      targets,
      version: readArg("--version"),
    });
    for (const [target, result] of Object.entries(results)) {
      console.log(`✓ ${target}: ${result.file} (${result.files} files, ${result.sha256.slice(0, 12)}…)`);
    }
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}
