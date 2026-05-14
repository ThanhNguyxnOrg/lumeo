// Test helper: load one of Lumeo's IIFE service modules into a fresh jsdom
// window. Each service publishes itself on `window.LumeoXxx`, so we return
// that handle for assertions. Keeping the loader tiny avoids pulling in a
// bundler just for tests.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

export function loadService(relativePath, windowRef) {
  const source = fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
  // jsdom's `runScripts: "dangerously"` mode exposes `window.eval` which runs
  // code inside the dom's own realm, so `window`, `document`, and
  // `localStorage` resolve naturally. This matches how Chrome loads content
  // scripts without needing a bundler or manual vm setup.
  windowRef.eval(source);
}

export async function createSandboxWindow({
  url = "https://www.youtube.com/watch?v=test",
} = {}) {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url,
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  const win = dom.window;
  // jsdom's older Blob implementation may lack arrayBuffer(); polyfill if
  // missing so WAV/ZIP payload tests can decode the output blob.
  if (typeof win.Blob.prototype.arrayBuffer !== "function") {
    win.Blob.prototype.arrayBuffer = function readArrayBuffer() {
      return new Promise((resolve) => {
        const reader = new win.FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsArrayBuffer(this);
      });
    };
  }
  // `TextEncoder` and `TextDecoder` are globals in modern browsers but may be
  // missing on the jsdom window; bring them in from Node's util module.
  if (typeof win.TextEncoder === "undefined") {
    const util = await import("node:util");
    win.TextEncoder = util.TextEncoder;
    win.TextDecoder = util.TextDecoder;
  }
  return { dom, window: win };
}
