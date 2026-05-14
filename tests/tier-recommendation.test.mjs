import { describe, it, expect } from "vitest";
import { createSandboxWindow, loadService } from "./helpers/load-service.mjs";

async function setup() {
  const { window } = await createSandboxWindow();
  loadService("services/tier-recommendation.js", window);
  return window.LumeoTierRecommendation;
}

describe("services/tier-recommendation.js", () => {
  it("detects live-like video contexts", async () => {
    const api = await setup();

    expect(api.isLiveLike({ title: "Lo-fi live stream - YouTube" })).toBe(true);
    expect(api.isLiveLike({ title: "Static tutorial - YouTube" })).toBe(false);
  });

  it("recommends tiers with user-facing rationale", async () => {
    const api = await setup();

    expect(api.recommendationFor({}, { tier: "caption" })).toContain("YouTube captions exist");
    expect(api.recommendationFor({}, { tier: "caption", captionUnavailable: true })).toContain("no readable captions");
    expect(api.recommendationFor({}, { tier: "standard" })).toContain("captions are missing");
    expect(api.recommendationFor({ title: "Live podcast" }, { tier: "realtime" })).toContain("low latency");
  });
});
