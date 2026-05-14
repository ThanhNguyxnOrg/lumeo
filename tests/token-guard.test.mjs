import { describe, it, expect, beforeAll } from "vitest";
import { createSandboxWindow, loadService } from "./helpers/load-service.mjs";

describe("lib/token-guard.js", () => {
  let api;

  beforeAll(async () => {
    const { window } = await createSandboxWindow();
    loadService("lib/token-guard.js", window);
    api = window.LumeoTokenGuard;
  });

  it("bump() returns a monotonically increasing value", () => {
    const guard = api.create();
    const a = guard.bump();
    const b = guard.bump();
    const c = guard.bump();
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it("isStale reports true for any token that is not the current one", () => {
    const guard = api.create();
    const captured = guard.bump();
    expect(guard.isStale(captured)).toBe(false);
    guard.bump();
    expect(guard.isStale(captured)).toBe(true);
  });

  it("assertFresh throws a named StaleSessionError when stale", () => {
    const guard = api.create();
    const captured = guard.bump();
    guard.bump();
    try {
      guard.assertFresh(captured, "nope");
      throw new Error("did not throw");
    } catch (err) {
      expect(err.name).toBe("StaleSessionError");
      expect(err.message).toBe("nope");
    }
  });
});
