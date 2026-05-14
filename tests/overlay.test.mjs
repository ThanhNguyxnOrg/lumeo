import { describe, it, expect, beforeEach, vi } from "vitest";
import { createSandboxWindow, loadService } from "./helpers/load-service.mjs";

async function setup() {
  const { window } = await createSandboxWindow();
  loadService("ui/overlay.js", window);
  const controller = window.LumeoOverlay.createOverlayController({
    languages: [["en", "English"], ["vi", "Vietnamese"]],
  });
  const root = controller.build();
  return { window, controller, root };
}

describe("ui/overlay.js keyboard shortcuts", () => {
  let window;
  let controller;
  let root;

  beforeEach(async () => {
    vi.useFakeTimers();
    ({ window, controller, root } = await setup());
  });

  it("collapses the overlay with Escape only when focus is inside the overlay", () => {
    root.querySelector("[data-ec-stop]").focus();
    window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(root.classList.contains("is-side-collapsed")).toBe(true);

    controller.toggleSideCollapsed();
    const outside = window.document.createElement("button");
    window.document.body.appendChild(outside);
    outside.focus();
    outside.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(root.classList.contains("is-side-collapsed")).toBe(false);
  });

  it("toggles overlay visibility with Ctrl+Shift+L", () => {
    window.document.dispatchEvent(new window.KeyboardEvent("keydown", {
      key: "L",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    }));

    expect(root.hidden).toBe(true);

    window.document.dispatchEvent(new window.KeyboardEvent("keydown", {
      key: "l",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    }));

    expect(root.hidden).toBe(false);
  });

  it("shows shortcut help with ? or h only when overlay focus is active", () => {
    root.querySelector("[data-ec-stop]").focus();
    window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "?", bubbles: true }));

    expect(root.querySelector(".ec-toast")?.textContent).toContain("Ctrl/Cmd+Shift+L");

    root.querySelector(".ec-toast").remove();
    const outside = window.document.createElement("button");
    window.document.body.appendChild(outside);
    outside.focus();
    outside.dispatchEvent(new window.KeyboardEvent("keydown", { key: "h", bubbles: true }));

    expect(root.querySelector(".ec-toast")).toBeNull();
  });

  it("ignores shortcuts from editable targets", () => {
    const input = window.document.createElement("input");
    window.document.body.appendChild(input);
    input.focus();

    input.dispatchEvent(new window.KeyboardEvent("keydown", {
      key: "L",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    }));

    expect(root.hidden).toBe(false);

    const editable = window.document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    root.appendChild(editable);
    editable.focus();
    editable.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(root.classList.contains("is-side-collapsed")).toBe(false);
  });
});

describe("ui/overlay.js accessibility", () => {
  it("keeps the overlay as a minimal toolbar without transcript or legacy grid chrome", async () => {
    const { controller, root } = await setup();
    const elements = controller.getElements();

    expect(root.querySelector("[data-ec-help]")?.getAttribute("aria-label")).toBe("Keyboard shortcuts");
    // ec-body and ec-target exist for in-panel subtitle display
    expect(root.querySelector(".ec-body")).not.toBeNull();
    expect(root.querySelector("[data-ec-target]")).not.toBeNull();
    expect(root.querySelector(".ec-controls")).toBeNull();
    expect(root.querySelector(".ec-side")).toBeNull();
    expect(root.textContent).not.toContain("AUDIO");
    expect(root.textContent).not.toContain("Mute original");
    expect(elements.target).not.toBeNull();
    expect(elements.source).toBeNull();
    expect(elements.history).toBeNull();
  });
});

describe("ui/overlay.js layout persistence", () => {
  it("loads scoped layout before global fallback", async () => {
    const { window } = await createSandboxWindow();
    loadService("ui/overlay.js", window);
    window.localStorage.setItem("lumeoOverlayLayout", JSON.stringify({ left: 10, top: 20, width: 400, height: 160 }));
    window.localStorage.setItem("lumeoOverlayLayout:video:abc123", JSON.stringify({ left: 120, top: 80, width: 640, height: 240 }));

    const controller = window.LumeoOverlay.createOverlayController({
      layoutKey: "lumeoOverlayLayout:video:abc123",
    });
    const root = controller.build();

    expect(root.style.left).toBe("120px");
    expect(root.style.top).toBe("80px");
    expect(root.style.width).toBe("640px");
    expect(root.style.height).toBe("auto");
  });

  it("falls back to the legacy global layout then saves to the scoped key", async () => {
    const { window } = await createSandboxWindow();
    loadService("ui/overlay.js", window);
    window.localStorage.setItem("lumeoOverlayLayout", JSON.stringify({ left: 22, top: 33, width: 444, height: 155 }));

    const controller = window.LumeoOverlay.createOverlayController({
      layoutKey: "lumeoOverlayLayout:channel:UCdemo",
    });
    const root = controller.build();

    expect(root.style.left).toBe("22px");
    expect(root.style.top).toBe("33px");

    controller.toggleSideCollapsed();

    expect(JSON.parse(window.localStorage.getItem("lumeoOverlayLayout:channel:UCdemo"))).toMatchObject({
      left: 22,
      top: 33,
      width: 444,
      height: 155,
      sideCollapsed: true,
    });
  });

  it("refreshes dynamic layout keys without changing drag/resize behavior", async () => {
    const { window } = await createSandboxWindow();
    loadService("ui/overlay.js", window);
    let key = "lumeoOverlayLayout:video:first";
    window.localStorage.setItem(key, JSON.stringify({ left: 30, top: 40, width: 500, height: 180 }));
    window.localStorage.setItem("lumeoOverlayLayout:video:second", JSON.stringify({ left: 90, top: 70, width: 600, height: 220 }));

    const controller = window.LumeoOverlay.createOverlayController({ layoutKey: () => key });
    const root = controller.build();
    expect(root.style.left).toBe("30px");

    key = "lumeoOverlayLayout:video:second";
    controller.refreshLayoutKey();

    expect(root.style.left).toBe("90px");
    expect(root.style.top).toBe("70px");
    expect(root.style.width).toBe("600px");
    expect(root.style.height).toBe("auto");
  });
});
