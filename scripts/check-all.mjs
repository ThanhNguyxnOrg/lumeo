import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
const SKIP_DIRS = new Set([
  ".git",
  ".sisyphus",
  "coverage",
  "node_modules",
  "output",
]);

async function collectJsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...await collectJsFiles(join(dir, entry.name)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(join(dir, entry.name));
    }
  }

  return files;
}

function nodeCheck(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--check", file], {
      cwd: ROOT,
      stdio: "pipe",
    });

    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("close", (code) => {
      resolve({ file, code, output: output.trim() });
    });
  });
}

const files = (await collectJsFiles(ROOT)).sort();
const results = await Promise.all(files.map(nodeCheck));
const failures = results.filter((result) => result.code !== 0);

for (const result of results) {
  const label = relative(ROOT, result.file).replaceAll("\\", "/");
  if (result.code === 0) {
    console.log(`ok ${label}`);
  } else {
    console.error(`fail ${label}`);
    if (result.output) console.error(result.output);
  }
}

if (failures.length) {
  console.error(`\n${failures.length}/${files.length} JavaScript files failed syntax checks.`);
  process.exit(1);
}

console.log(`\n${files.length} JavaScript files passed syntax checks.`);
