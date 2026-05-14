import { defineConfig } from "vitest/config";

// Vitest runs pure-function unit tests against Lumeo's vanilla-JS services.
// We mount each service module inside a jsdom sandbox that emulates the
// subset of the browser API each one needs (window.Lumeo*, DOMParser,
// localStorage). No bundler, no TS — matches the zero-build philosophy of
// the extension itself.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.mjs"],
    globals: false,
    reporters: ["default"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: [
        "services/**/*.js",
        "pipelines/**/*.js",
        "lib/**/*.js",
      ],
      exclude: [
        "services/sniffer.js",
        "services/audio-processor.js",
      ],
    },
  },
});
