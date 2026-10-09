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

describe("ui/overlay.js YouTube control bar button integration", () => {
  it("injects .ytp-lumeo-button into .ytp-right-controls and toggles overlay", async () => {
    const { window } = await createSandboxWindow();
    loadService("ui/overlay.js", window);

    // Mock YouTube player structure in document
    const moviePlayer = window.document.createElement("div");
    moviePlayer.id = "movie_player";
    const chromeBottom = window.document.createElement("div");
    chromeBottom.className = "ytp-chrome-bottom";
    const rightControls = window.document.createElement("div");
    rightControls.className = "ytp-right-controls";
    const settingsBtn = window.document.createElement("button");
    settingsBtn.className = "ytp-button ytp-settings-button";
    rightControls.appendChild(settingsBtn);
    chromeBottom.appendChild(rightControls);
    moviePlayer.appendChild(chromeBottom);
    window.document.body.appendChild(moviePlayer);

    const controller = window.LumeoOverlay.createOverlayController();
    const root = controller.build();

    const ytBtn = rightControls.querySelector(".ytp-lumeo-button");
    expect(ytBtn).not.toBeNull();
    expect(ytBtn.classList.contains("ytp-lumeo-active")).toBe(true);

    // Clicking native YouTube button collapses the overlay
    ytBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(root.classList.contains("is-side-collapsed")).toBe(true);
    expect(ytBtn.classList.contains("ytp-lumeo-active")).toBe(false);

    // Clicking again expands it
    ytBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(root.classList.contains("is-side-collapsed")).toBe(false);
    expect(ytBtn.classList.contains("ytp-lumeo-active")).toBe(true);

    // Calling destroy cleans up YouTube control button
    controller.destroy();
    expect(rightControls.querySelector(".ytp-lumeo-button")).toBeNull();
  });

  it("re-binds listeners to pre-existing or cloned YouTube control button", async () => {
    const { window } = await createSandboxWindow();
    loadService("ui/overlay.js", window);

    const moviePlayer = window.document.createElement("div");
    moviePlayer.id = "movie_player";
    const chromeBottom = window.document.createElement("div");
    chromeBottom.className = "ytp-chrome-bottom";
    const rightControls = window.document.createElement("div");
    rightControls.className = "ytp-right-controls";

    // Simulate an unbound / cloned button existing in DOM
    const existingBtn = window.document.createElement("button");
    existingBtn.className = "ytp-button ytp-lumeo-button";
    rightControls.appendChild(existingBtn);
    chromeBottom.appendChild(rightControls);
    moviePlayer.appendChild(chromeBottom);
    window.document.body.appendChild(moviePlayer);

    const controller = window.LumeoOverlay.createOverlayController();
    const root = controller.build();

    expect(existingBtn.dataset.lumeoBound).toBe("true");

    // Click on pre-existing button toggles overlay
    existingBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(root.classList.contains("is-side-collapsed")).toBe(true);

    existingBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(root.classList.contains("is-side-collapsed")).toBe(false);

    controller.destroy();
  });
});

describe("ui/overlay.js native YouTube popover menu", () => {
  it("renders YouTube-native popover menu with A-/A+ steppers and reset position", async () => {
    const { root } = await setup();
    const popover = root.querySelector(".ytp-lumeo-popover");
    expect(popover).not.toBeNull();
    const btnFontDec = root.querySelector("[data-lumeo-font-dec]");
    const btnFontInc = root.querySelector("[data-lumeo-font-inc]");
    expect(btnFontDec).not.toBeNull();
    expect(btnFontInc).not.toBeNull();
    const btnResetPos = root.querySelector("[data-lumeo-reset-pos]");
    expect(btnResetPos).not.toBeNull();
  });

  it("handles explicit Start/Stop Translation and preserves YouTube control button across session states", async () => {
    const { window } = await createSandboxWindow();
    loadService("ui/overlay.js", window);

    const moviePlayer = window.document.createElement("div");
    moviePlayer.id = "movie_player";
    const chromeBottom = window.document.createElement("div");
    chromeBottom.className = "ytp-chrome-bottom";
    const rightControls = window.document.createElement("div");
    rightControls.className = "ytp-right-controls";
    chromeBottom.appendChild(rightControls);
    moviePlayer.appendChild(chromeBottom);
    window.document.body.appendChild(moviePlayer);

    let startCalled = false;
    let stopCalled = false;

    const controller = window.LumeoOverlay.createOverlayController({
      onStartSession: () => { startCalled = true; },
      onStopSession: () => { stopCalled = true; },
    });
    const root = controller.build();
    const ytBtn = rightControls.querySelector(".ytp-lumeo-button");
    expect(ytBtn).not.toBeNull();
    expect(controller.isTranslating()).toBe(false);

    const toggleBtn = root.querySelector("[data-lumeo-toggle-session]");
    expect(toggleBtn).not.toBeNull();
    expect(toggleBtn.textContent).toContain("Start Translation");

    // Clicking toggle while idle triggers onStartSession
    toggleBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(startCalled).toBe(true);

    // Update state to active translating
    controller.setSessionState({ isTranslating: true });
    expect(controller.isTranslating()).toBe(true);
    expect(ytBtn.classList.contains("is-translating")).toBe(true);
    expect(toggleBtn.textContent).toContain("Stop Translation");
    expect(toggleBtn.classList.contains("is-stop")).toBe(true);

    // Clicking toggle while translating triggers onStopSession
    toggleBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(stopCalled).toBe(true);

    // Minimizing / closing popover preserves YouTube button and translating state
    controller.toggleSideCollapsed(true);
    expect(root.classList.contains("is-side-collapsed")).toBe(true);
    expect(rightControls.querySelector(".ytp-lumeo-button")).not.toBeNull();

    // Ending session does not remove YouTube control button
    controller.setSessionState({ isTranslating: false });
    expect(controller.isTranslating()).toBe(false);
    expect(ytBtn.classList.contains("is-translating")).toBe(false);
    expect(rightControls.querySelector(".ytp-lumeo-button")).toBe(ytBtn);

    controller.destroy();
    expect(rightControls.querySelector(".ytp-lumeo-button")).toBeNull();
  });

  it("supports bounded dragging within movie_player and double-click reset", async () => {
    const { window } = await createSandboxWindow();
    if (!window.PointerEvent) {
      window.PointerEvent = class extends window.MouseEvent {
        constructor(type, params = {}) {
          super(type, params);
          this.pointerId = params.pointerId || 1;
        }
      };
    }
    loadService("ui/overlay.js", window);

    const moviePlayer = window.document.createElement("div");
    moviePlayer.id = "movie_player";
    moviePlayer.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600 });
    window.document.body.appendChild(moviePlayer);

    let layoutChanged = null;
    let resetCalled = false;

    const controller = window.LumeoOverlay.createOverlayController({
      onLayoutChange: (l) => { layoutChanged = l; },
      onResetPosition: () => { resetCalled = true; },
    });
    const root = controller.build();
    moviePlayer.appendChild(root);

    root.getBoundingClientRect = () => ({ left: 660, top: 200, width: 320, height: 340, right: 980, bottom: 540 });
    const header = root.querySelector(".ytp-lumeo-header");
    expect(header).not.toBeNull();

    // Drag header left by 100px, up by 50px
    header.dispatchEvent(new window.PointerEvent("pointerdown", { clientX: 700, clientY: 220, button: 0, bubbles: true }));
    header.dispatchEvent(new window.PointerEvent("pointermove", { clientX: 600, clientY: 170, bubbles: true }));
    header.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true }));

    expect(root.style.left).toBe("560px");
    expect(root.style.top).toBe("150px");
    expect(layoutChanged).toMatchObject({ left: 560, top: 150, customPosition: true });

    // Double-click header restores default anchor position
    header.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true }));
    expect(root.style.left).toBe("auto");
    expect(root.style.top).toBe("auto");
    expect(resetCalled).toBe(true);
  });

  it("fires direct reactive callbacks when submenus select options", async () => {
    const { window } = await createSandboxWindow();
    loadService("ui/overlay.js", window);

    let langSelected = null;
    let fontSelected = null;
    let opacitySelected = null;
    let shadowSelected = null;

    const controller = window.LumeoOverlay.createOverlayController({
      onLanguageChange: (lang) => { langSelected = lang; },
      onFontSizeChange: (size) => { fontSelected = size; },
      onOpacityChange: (op) => { opacitySelected = op; },
      onShadowStyleChange: (s) => { shadowSelected = s; },
    });
    const root = controller.build();

    // Open language submenu
    const langBtn = root.querySelector('[data-open-sub="language"]');
    langBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const subContainer = root.querySelector("[data-lumeo-sub-container]");
    const enItem = Array.from(subContainer.querySelectorAll(".ytp-lumeo-sub-item")).find(b => b.textContent.includes("English"));
    expect(enItem).toBeDefined();
    enItem.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(langSelected).toBe("en");

    // Open fontsize submenu
    const fontBtn = root.querySelector('[data-open-sub="fontsize"]');
    fontBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const size14 = Array.from(subContainer.querySelectorAll(".ytp-lumeo-sub-item")).find(b => b.textContent.includes("50%"));
    expect(size14).toBeDefined();
    size14.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(fontSelected).toBe(14);

    // Open opacity submenu
    const opBtn = root.querySelector('[data-open-sub="opacity"]');
    opBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const op50 = Array.from(subContainer.querySelectorAll(".ytp-lumeo-sub-item")).find(b => b.textContent.includes("50%"));
    expect(op50).toBeDefined();
    op50.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(opacitySelected).toBe(50);

    // Open edge submenu
    const edgeBtn = root.querySelector('[data-open-sub="edge"]');
    edgeBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const edgeOutline = Array.from(subContainer.querySelectorAll(".ytp-lumeo-sub-item")).find(b => b.textContent.includes("Outline"));
    expect(edgeOutline).toBeDefined();
    edgeOutline.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(shadowSelected).toBe("outline");
  });

  it("remains collapsed on start when collapsedOnStart: true, even if localStorage has sideCollapsed: false", async () => {
    const { window } = await createSandboxWindow();
    loadService("ui/overlay.js", window);

    const moviePlayer = window.document.createElement("div");
    moviePlayer.id = "movie_player";
    const chromeBottom = window.document.createElement("div");
    chromeBottom.className = "ytp-chrome-bottom";
    const rightControls = window.document.createElement("div");
    rightControls.className = "ytp-right-controls";
    chromeBottom.appendChild(rightControls);
    moviePlayer.appendChild(chromeBottom);
    window.document.body.appendChild(moviePlayer);

    window.localStorage.setItem("lumeoOverlayLayout", JSON.stringify({
      left: 100,
      top: 100,
      width: 320,
      sideCollapsed: false,
    }));

    const controller = window.LumeoOverlay.createOverlayController({
      collapsedOnStart: true,
      onButtonClick: () => {
        const open = controller.isOpen();
        controller.toggleSideCollapsed(open);
      },
    });
    const root = controller.build();

    expect(root.classList.contains("is-side-collapsed")).toBe(true);
    expect(controller.isOpen()).toBe(false);

    const ytBtn = rightControls.querySelector(".ytp-lumeo-button");
    expect(ytBtn).not.toBeNull();
    expect(ytBtn.classList.contains("ytp-lumeo-active")).toBe(false);

    // User clicks button to open popover
    ytBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(root.classList.contains("is-side-collapsed")).toBe(false);
    expect(controller.isOpen()).toBe(true);
    expect(ytBtn.classList.contains("ytp-lumeo-active")).toBe(true);

    // User clicks button again to close popover
    ytBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(root.classList.contains("is-side-collapsed")).toBe(true);
    expect(controller.isOpen()).toBe(false);
    expect(ytBtn.classList.contains("ytp-lumeo-active")).toBe(false);
  });

  it("opens originalvolume and voicevolume submenus and triggers callbacks", async () => {
    let origVolChanged = null;
    let voiceVolChanged = null;

    const { window } = await createSandboxWindow();
    loadService("ui/overlay.js", window);
    const controller = window.LumeoOverlay.createOverlayController({
      onOriginalVolumeChange: (vol) => { origVolChanged = vol; },
      onVoiceVolumeChange: (vol) => { voiceVolChanged = vol; },
    });
    const root = controller.build();
    const subContainer = root.querySelector("[data-lumeo-sub-container]");

    // Verify buttons exist in menu list
    const origVolBtn = root.querySelector('[data-open-sub="originalvolume"]');
    const voiceVolBtn = root.querySelector('[data-open-sub="voicevolume"]');
    expect(origVolBtn).not.toBeNull();
    expect(voiceVolBtn).not.toBeNull();

    // Open original volume submenu
    origVolBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const origMute = Array.from(subContainer.querySelectorAll(".ytp-lumeo-sub-item")).find(b => b.textContent.includes("0%"));
    expect(origMute).toBeDefined();
    origMute.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(origVolChanged).toBe(0);

    const origLabel = root.querySelector('[data-val="originalvolume"]');
    expect(origLabel.textContent).toBe("0%");

    // Open dubbed voice volume submenu
    voiceVolBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const voiceMax = Array.from(subContainer.querySelectorAll(".ytp-lumeo-sub-item")).find(b => b.textContent.includes("150%"));
    expect(voiceMax).toBeDefined();
    voiceMax.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(voiceVolChanged).toBe(150);

    const voiceLabel = root.querySelector('[data-val="voicevolume"]');
    expect(voiceLabel.textContent).toBe("150%");
  });

  it("updates loading spinner and status badge when session is loading", async () => {
    const { window } = await createSandboxWindow();
    loadService("ui/overlay.js", window);
    const controller = window.LumeoOverlay.createOverlayController();
    const root = controller.build();
    const toggleBtn = root.querySelector("[data-lumeo-toggle-session]");
    const statusBadge = root.querySelector("[data-lumeo-status-badge]");

    controller.setSessionState({
      isTranslating: true,
      isLoading: true,
      statusText: "Loading captions...",
    });

    expect(toggleBtn.classList.contains("is-loading")).toBe(true);
    expect(toggleBtn.querySelector(".ytp-lumeo-session-spinner")).not.toBeNull();
    expect(toggleBtn.textContent).toContain("Loading captions...");
    expect(statusBadge.style.display).toBe("flex");
    expect(statusBadge.textContent).toBe("Loading captions...");

    // Transition to live
    controller.setSessionState({
      isTranslating: true,
      isLoading: false,
    });
    expect(toggleBtn.classList.contains("is-loading")).toBe(false);
    expect(toggleBtn.classList.contains("is-stop")).toBe(true);
    expect(toggleBtn.textContent).toContain("Stop Translation");
  });

  it("toggles transcript button active class and exposes setTranscriptActive", async () => {
    let transcriptToggled = false;
    const { window } = await createSandboxWindow();
    loadService("ui/overlay.js", window);
    const controller = window.LumeoOverlay.createOverlayController({
      onToggleTranscript: () => {
        transcriptToggled = !transcriptToggled;
        return transcriptToggled;
      },
    });
    const root = controller.build();
    const transcriptBtn = root.querySelector("[data-lumeo-toggle-transcript]");
    expect(transcriptBtn).not.toBeNull();
    expect(transcriptBtn.classList.contains("is-active")).toBe(false);

    transcriptBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(transcriptToggled).toBe(true);
    expect(transcriptBtn.classList.contains("is-active")).toBe(true);

    controller.setTranscriptActive(false);
    expect(transcriptBtn.classList.contains("is-active")).toBe(false);
  });

  it("exposes Secondary Subtitle submenu and fires onSecondaryLanguageChange callback", async () => {
    let chosenSecondary = "";
    const { window } = await createSandboxWindow();
    loadService("ui/overlay.js", window);
    const controller = window.LumeoOverlay.createOverlayController({
      languages: [["en", "English"], ["ja", "Japanese"]],
      onSecondaryLanguageChange: (lang) => {
        chosenSecondary = lang;
      },
    });
    const root = controller.build();
    const secondaryRow = root.querySelector("[data-lumeo-secondary-row]");
    const secondaryVal = root.querySelector('[data-val="secondarylanguage"]');
    expect(secondaryRow).not.toBeNull();
    expect(secondaryVal.textContent).toBe("Original Audio");

    // Open submenu and pick Japanese
    secondaryRow.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const subContainer = root.querySelector("[data-lumeo-sub-container]");
    const jaBtn = Array.from(subContainer.querySelectorAll(".ytp-lumeo-sub-item")).find(b => b.dataset.subId === "ja");
    expect(jaBtn).not.toBeUndefined();

    jaBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(chosenSecondary).toBe("ja");
    expect(secondaryVal.textContent).toBe("Japanese");
  });
});



