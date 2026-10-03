import { describe, it, expect, beforeEach, vi } from "vitest";
import { createSandboxWindow, loadService } from "./helpers/load-service.mjs";

async function setup() {
  const { window } = await createSandboxWindow();
  if (!window.PointerEvent) {
    window.PointerEvent = class extends window.MouseEvent {
      constructor(type, params = {}) {
        super(type, params);
        this.pointerId = params.pointerId || 1;
      }
    };
  }
  const player = window.document.createElement("div");
  player.id = "movie_player";
  window.document.body.appendChild(player);
  loadService("ui/subtitle-overlay.js", window);
  const controller = window.LumeoSubtitleOverlay.createSubtitleOverlayController();
  return { window, player, controller };
}

describe("ui/subtitle-overlay.js", () => {
  let window;
  let player;
  let controller;

  beforeEach(async () => {
    ({ window, player, controller } = await setup());
  });

  it("builds a polite subtitle overlay inside the YouTube player", () => {
    const overlay = controller.build();
    expect(overlay).toBeTruthy();
    expect(overlay.className).toBe("lumeo-video-sub");
    expect(overlay.getAttribute("aria-live")).toBe("polite");
    expect(player.contains(overlay)).toBe(true);
  });

  it("suppresses native YouTube captions when active and restores on remove", () => {
    expect(player.classList.contains("lumeo-active-player")).toBe(false);
    controller.build();
    expect(player.classList.contains("lumeo-active-player")).toBe(true);
    expect(player.getAttribute("data-lumeo-active")).toBe("true");

    controller.remove();
    expect(player.classList.contains("lumeo-active-player")).toBe(false);
    expect(player.getAttribute("data-lumeo-active")).toBe("false");
  });

  it("renders translated and source text for bilingual cues", () => {
    controller.updateCue(
      { text: "hello", translated: "xin chào" },
      { captionStyle: { showSource: true }, targetLanguage: "vi", rtlLangs: new Set() },
    );
    const overlay = controller.getElement();
    expect(overlay.hidden).toBe(false);
    expect(overlay.querySelector(".lumeo-video-sub-translated").textContent).toBe("xin chào");
    expect(overlay.querySelector(".lumeo-video-sub-source").textContent).toBe("hello");
    expect(overlay.dir).toBe("ltr");
  });

  it("hides source text when caption style disables it", () => {
    controller.updateCue(
      { text: "hello", translated: "xin chào" },
      { captionStyle: { showSource: false }, targetLanguage: "vi", rtlLangs: new Set() },
    );
    const overlay = controller.getElement();
    expect(overlay.querySelector(".lumeo-video-sub-translated").textContent).toBe("xin chào");
    expect(overlay.querySelector(".lumeo-video-sub-source")).toBeNull();
  });

  it("applies bilingual layout preset classes", () => {
    controller.updateCue(
      { text: "hello", translated: "xin chào" },
      { captionStyle: { layoutPreset: "compact" }, targetLanguage: "vi", rtlLangs: new Set() },
    );
    const overlay = controller.getElement();
    expect(overlay.classList.contains("lumeo-layout-compact")).toBe(true);
  });

  it("supports subtitle ordering: translation-top vs source-top", () => {
    controller.updateCue(
      { text: "hello", translated: "xin chào" },
      { captionStyle: { layoutPreset: "stacked", subtitleOrder: "source-top" }, targetLanguage: "vi", rtlLangs: new Set() },
    );
    const overlay = controller.getElement();
    const children = Array.from(overlay.children).map(c => c.className);
    expect(children.indexOf("lumeo-video-sub-source")).toBeLessThan(children.indexOf("lumeo-video-sub-translated"));
  });

  it("applies style flags and RTL direction", () => {
    controller.updateCue(
      { text: "hello", translated: "مرحبا" },
      {
        captionStyle: { fontSize: 30, bottomOffset: 21, highContrast: true, showTranslatedSub: false, showSourceSub: false },
        targetLanguage: "ar",
        rtlLangs: new Set(["ar"]),
      },
    );
    const overlay = controller.getElement();
    expect(overlay.style.getPropertyValue("--lumeo-caption-font-size")).toBe("30px");
    expect(overlay.style.getPropertyValue("--lumeo-caption-bottom-offset")).toBe("21%");
    expect(overlay.classList.contains("lumeo-high-contrast")).toBe(true);
    expect(overlay.classList.contains("lumeo-hide-translated")).toBe(true);
    expect(overlay.classList.contains("lumeo-hide-source")).toBe(true);
    expect(overlay.dir).toBe("rtl");
  });

  it("normalizes subBackgroundOpacity scale to 0.0..1.0 and applies standardized shadow classes", () => {
    // Test percentage 75 -> 0.75
    controller.updateCue(
      { text: "hello", translated: "xin chào" },
      {
        captionStyle: { subBackgroundOpacity: 75, subShadowStyle: "drop-shadow" },
        targetLanguage: "vi",
        rtlLangs: new Set(),
      },
    );
    let overlay = controller.getElement();
    expect(overlay.style.getPropertyValue("--lumeo-sub-bg-opacity")).toBe("0.75");
    expect(overlay.classList.contains("lumeo-shadow-drop-shadow")).toBe(true);
    expect(overlay.classList.contains("lumeo-shadow-outline")).toBe(false);

    // Test float 0.4 -> 0.4 and outline shadow
    controller.updateCue(
      { text: "hello", translated: "xin chào" },
      {
        captionStyle: { subBackgroundOpacity: 0.4, subShadowStyle: "outline" },
        targetLanguage: "vi",
        rtlLangs: new Set(),
      },
    );
    expect(overlay.style.getPropertyValue("--lumeo-sub-bg-opacity")).toBe("0.4");
    expect(overlay.classList.contains("lumeo-shadow-outline")).toBe(true);
    expect(overlay.classList.contains("lumeo-shadow-drop-shadow")).toBe(false);

    // Test raised shadow
    controller.updateCue(
      { text: "hello", translated: "xin chào" },
      {
        captionStyle: { subShadowStyle: "raised" },
        targetLanguage: "vi",
        rtlLangs: new Set(),
      },
    );
    expect(overlay.classList.contains("lumeo-shadow-raised")).toBe(true);

    // Test depressed shadow
    controller.updateCue(
      { text: "hello", translated: "xin chào" },
      {
        captionStyle: { subShadowStyle: "depressed" },
        targetLanguage: "vi",
        rtlLangs: new Set(),
      },
    );
    expect(overlay.classList.contains("lumeo-shadow-depressed")).toBe(true);

    // Test none shadow
    controller.updateCue(
      { text: "hello", translated: "xin chào" },
      {
        captionStyle: { subShadowStyle: "none" },
        targetLanguage: "vi",
        rtlLangs: new Set(),
      },
    );
    expect(overlay.classList.contains("lumeo-shadow-none")).toBe(true);

    // Test legacy "glow" backward-compatibility -> maps to drop-shadow
    controller.updateCue(
      { text: "hello", translated: "xin chào" },
      {
        captionStyle: { subShadowStyle: "glow" },
        targetLanguage: "vi",
        rtlLangs: new Set(),
      },
    );
    expect(overlay.classList.contains("lumeo-shadow-drop-shadow")).toBe(true);
  });

  it("allows dragging subtitle with normalized percentage coordinates", () => {
    controller.updateCue(
      { text: "hello", translated: "xin chào" },
      { captionStyle: { showSource: true }, targetLanguage: "vi", rtlLangs: new Set() },
    );
    const overlay = controller.getElement();
    player.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600 });
    overlay.getBoundingClientRect = () => ({ left: 400, top: 500, width: 200, height: 50, right: 600, bottom: 550 });

    overlay.dispatchEvent(new window.PointerEvent("pointerdown", { clientX: 450, clientY: 520, button: 0, bubbles: true }));
    window.dispatchEvent(new window.PointerEvent("pointermove", { clientX: 550, clientY: 420, bubbles: true }));
    window.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true }));

    expect(overlay.style.left).toBe("50%");
    expect(overlay.style.top).toBe("66.66666666666666%");
    expect(overlay.style.transform).toBe("none");
    expect(JSON.parse(window.localStorage.getItem("lumeoSubPosition"))).toEqual({
      leftPercent: 50,
      topPercent: 66.66666666666666,
    });
  });

  it("does not trigger word lookup when pointer movement exceeds drag threshold", () => {
    controller.updateCue(
      { text: "Source", translated: "Running fast" },
      { captionStyle: { showSource: true }, targetLanguage: "en", rtlLangs: new Set() },
    );
    const overlay = controller.getElement();
    player.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600 });
    overlay.getBoundingClientRect = () => ({ left: 400, top: 500, width: 200, height: 50, right: 600, bottom: 550 });

    const word = overlay.querySelector(".lumeo-lookup-word");
    word.dispatchEvent(new window.PointerEvent("pointerdown", { clientX: 450, clientY: 520, button: 0, bubbles: true }));
    window.dispatchEvent(new window.PointerEvent("pointermove", { clientX: 470, clientY: 530, bubbles: true }));
    word.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    window.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true }));

    const popover = overlay.querySelector(".lumeo-lookup-popover");
    expect(popover).toBeNull();
  });

  it("tokenizes caption words without losing punctuation", () => {
    expect(window.LumeoSubtitleOverlay.tokenizeLookupText("Hello, world—again!")).toEqual([
      { text: "Hello", word: "Hello" },
      { text: ", ", word: "" },
      { text: "world", word: "world" },
      { text: "—", word: "" },
      { text: "again", word: "again" },
      { text: "!", word: "" },
    ]);
    expect(window.LumeoSubtitleOverlay.normalizeLookupWord("“Running!”")).toBe("running");
  });

  it("renders accessible word lookup controls for the current subtitle only", () => {
    controller.updateCue(
      { text: "Source phrase", translated: "Hello, world!" },
      { captionStyle: { showSource: true }, targetLanguage: "en", rtlLangs: new Set() },
    );

    const overlay = controller.getElement();
    const words = overlay.querySelectorAll(".lumeo-lookup-word");
    expect(words).toHaveLength(4);
    expect(words[0].tagName).toBe("BUTTON");
    expect(words[0].getAttribute("aria-label")).toBe("Inspect word Hello");
    expect(words[0].dataset.lookupWord).toBe("Hello");
    expect(overlay.textContent).toContain("Hello, world!");
    expect(overlay.textContent).toContain("Source phrase");
  });

  it("opens keyboard-accessible local lookup popover and copies word", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(window.navigator, "clipboard", { value: { writeText }, configurable: true });
    controller.updateCue(
      { text: "Source phrase", translated: "Running fast" },
      { captionStyle: { showSource: true }, targetLanguage: "en", rtlLangs: new Set() },
    );

    const overlay = controller.getElement();
    const word = overlay.querySelector(".lumeo-lookup-word");
    word.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    const popover = overlay.querySelector(".lumeo-lookup-popover");
    expect(popover.hidden).toBe(false);
    expect(popover.getAttribute("role")).toBe("dialog");
    expect(popover.textContent).toContain("Running");
    expect(popover.textContent).toContain("running");
    expect(popover.textContent).toContain("Source phrase");
    expect(popover.textContent).toContain("Running fast");

    popover.querySelector(".lumeo-lookup-copy").click();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith("Running");

    // Close button dismisses popover
    const closeBtn = popover.querySelector(".lumeo-lookup-close");
    expect(closeBtn).not.toBeNull();
    closeBtn.click();
    expect(popover.hidden).toBe(true);

    // Reopen and test Escape key dismisses popover
    word.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(popover.hidden).toBe(false);
    window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(popover.hidden).toBe(true);
  });

  it("reports PiP unsupported when Document Picture-in-Picture is unavailable", async () => {
    expect(controller.isPictureInPictureSupported()).toBe(false);
    expect(controller.getPictureInPictureState()).toEqual({ supported: false, open: false });
    await expect(controller.openPictureInPicture()).resolves.toEqual({ ok: false, reason: "unsupported" });
  });

  it("opens PiP subtitles and mirrors cue/style updates", async () => {
    let pipWindow;
    Object.defineProperty(window, "documentPictureInPicture", {
      configurable: true,
      value: {
        requestWindow: vi.fn(async () => {
          pipWindow = await createSandboxWindow();
          pipWindow.window.close = vi.fn(() => { pipWindow.window.closed = true; });
          return pipWindow.window;
        }),
      },
    });

    controller.updateCue(
      { text: "hello", translated: "xin chào" },
      { captionStyle: { fontSize: 26, showSource: true }, targetLanguage: "vi", rtlLangs: new Set() },
    );

    await expect(controller.openPictureInPicture()).resolves.toEqual({ ok: true });
    expect(controller.getPictureInPictureState()).toEqual({ supported: true, open: true });
    const pipRoot = pipWindow.window.document.querySelector(".lumeo-pip-sub");
    expect(pipRoot.textContent).toContain("xin chào");
    expect(pipRoot.textContent).toContain("hello");
    expect(pipRoot.style.getPropertyValue("--lumeo-caption-font-size")).toBe("26px");

    controller.updateCue(
      { text: "source", translated: "dịch" },
      { captionStyle: { fontSize: 28, showSource: false }, targetLanguage: "vi", rtlLangs: new Set() },
    );
    expect(pipRoot.textContent).toContain("dịch");
    expect(pipRoot.textContent).not.toContain("source");
    expect(pipRoot.style.getPropertyValue("--lumeo-caption-font-size")).toBe("28px");
  });

  it("toggles PiP closed and removes cleanly", async () => {
    let pipWindow;
    Object.defineProperty(window, "documentPictureInPicture", {
      configurable: true,
      value: {
        requestWindow: vi.fn(async () => {
          pipWindow = await createSandboxWindow();
          pipWindow.window.close = vi.fn(() => { pipWindow.window.closed = true; });
          return pipWindow.window;
        }),
      },
    });

    await expect(controller.togglePictureInPicture()).resolves.toMatchObject({ ok: true, open: true });
    await expect(controller.togglePictureInPicture()).resolves.toMatchObject({ ok: true, open: false });
    const firstClose = pipWindow.window.close;
    expect(firstClose).toHaveBeenCalledOnce();

    await controller.openPictureInPicture();
    const secondClose = pipWindow.window.close;
    controller.remove();
    expect(secondClose).toHaveBeenCalledOnce();
    expect(controller.getElement()).toBeNull();
    expect(player.querySelector(".lumeo-video-sub")).toBeNull();
  });

  it("clamps PiP window height for vertical videos such as YouTube Shorts", async () => {
    const video = window.document.createElement("video");
    video.className = "html5-main-video";
    Object.defineProperty(video, "videoWidth", { value: 1080, configurable: true });
    Object.defineProperty(video, "videoHeight", { value: 1920, configurable: true });
    player.appendChild(video);

    const requestWindow = vi.fn(async () => {
      const pip = await createSandboxWindow();
      return pip.window;
    });
    Object.defineProperty(window, "documentPictureInPicture", {
      configurable: true,
      value: { requestWindow },
    });

    await controller.openPictureInPicture();
    expect(requestWindow).toHaveBeenCalledWith({ width: 270, height: 480 });
  });

  it("hides on empty cue and removes cleanly", () => {
    controller.updateCue({ text: "hello", translated: "xin chào" }, { captionStyle: {} });
    const overlay = controller.getElement();
    controller.updateCue(null, { captionStyle: {} });
    expect(overlay.hidden).toBe(true);
    controller.remove();
    expect(controller.getElement()).toBeNull();
    expect(player.querySelector(".lumeo-video-sub")).toBeNull();
  });
});
