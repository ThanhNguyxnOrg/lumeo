import { describe, it, expect, beforeEach, vi } from "vitest";
import { createSandboxWindow, loadService } from "./helpers/load-service.mjs";

async function setup() {
  const { window } = await createSandboxWindow();
  window.LumeoAudioUtils = {
    findVideo: () => {
      const v = window.document.createElement("video");
      v.volume = 1;
      v.muted = false;
      return v;
    },
  };
  window.LumeoCaptionOrchestrator = {
    start: vi.fn(async (ctx) => {
      ctx.onSessionCreated({ type: "caption", cues: [] });
      return { ok: true };
    }),
  };

  loadService("services/session-manager.js", window);
  const manager = window.LumeoSessionManager;

  const callbacks = {
    removeOverlay: vi.fn(),
    buildOverlay: vi.fn(),
    setStatusText: vi.fn(),
    setOverlayState: vi.fn(),
    applyTierToolbar: vi.fn(),
    applySourceVisibility: vi.fn(),
    emitState: vi.fn(),
    emitEnded: vi.fn(),
  };

  manager.init(callbacks);
  manager.setSettings({ targetLanguage: "vi", tier: "caption" });
  return { window, manager, callbacks };
}

describe("services/session-manager.js", () => {
  let manager;
  let callbacks;

  beforeEach(async () => {
    ({ manager, callbacks } = await setup());
  });

  it("handles startSession with a string tier without mangling settings", async () => {
    const res = await manager.startSession("caption");
    expect(res.ok).toBe(true);
    expect(manager.getSession()).toBeTruthy();
    expect(manager.getSettings().tier).toBe("caption");
    expect(manager.getSettings().targetLanguage).toBe("vi");
  });

  it("prevents starting a duplicate session when already running", async () => {
    await manager.startSession("caption");
    const duplicate = await manager.startSession("caption");
    expect(duplicate.ok).toBe(false);
    expect(duplicate.error).toBe("Session already running.");
  });

  it("gracefully stops with restart reason without removing overlay", async () => {
    await manager.startSession("caption");
    expect(manager.getSession()).toBeTruthy();

    manager.stopSession("restart");
    expect(manager.getSession()).toBeNull();
    expect(callbacks.removeOverlay).not.toHaveBeenCalled();
  });

  it("invokes removeOverlay on standard stop", async () => {
    await manager.startSession("caption");
    manager.stopSession("user-stop");
    expect(manager.getSession()).toBeNull();
    expect(callbacks.removeOverlay).toHaveBeenCalled();
  });

  it("restarts session with new settings via restartSession", async () => {
    await manager.startSession({ tier: "caption", targetLanguage: "vi" });
    expect(manager.getSettings().targetLanguage).toBe("vi");

    const restartRes = await manager.restartSession({ targetLanguage: "ja" });
    expect(restartRes.ok).toBe(true);
    expect(manager.getSession()).toBeTruthy();
    expect(manager.getSettings().targetLanguage).toBe("ja");
  });
});
