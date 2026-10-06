import { describe, it, expect, vi, beforeEach } from "vitest";
import "../ui/transcript.js";

describe("LumeoTranscriptDrawer", () => {
  let controller;
  let onSeek;

  beforeEach(() => {
    document.body.innerHTML = "";
    onSeek = vi.fn();
    controller = window.LumeoTranscript.createTranscriptController({
      doc: document,
      win: window,
      onSeek,
    });
  });

  it("builds transcript drawer with header and empty list", () => {
    const root = controller.build();
    expect(root).toBeDefined();
    expect(root.className).toBe("lumeo-transcript-drawer");
    expect(root.hidden).toBe(true);
    expect(root.querySelector(".lumeo-transcript-header")).not.toBeNull();
    expect(root.querySelector(".lumeo-transcript-count").textContent).toBe("0 cues");
  });

  it("renders cues and formats time correctly", () => {
    const cues = [
      { start: 12, end: 15, text: "Hello world", translated: "Xin chào thế giới" },
      { start: 75, end: 80, text: "Second line", translated: "Dòng thứ hai" },
    ];

    controller.renderCaptionTranscript(cues);
    const root = controller.getElement();
    expect(root.querySelector(".lumeo-transcript-count").textContent).toBe("2 cues");

    const items = root.querySelectorAll(".lumeo-transcript-item");
    expect(items).toHaveLength(2);
    expect(items[0].querySelector(".lumeo-transcript-time").textContent).toBe("0:12");
    expect(items[0].querySelector(".lumeo-transcript-target").textContent).toBe("Xin chào thế giới");
    expect(items[0].querySelector(".lumeo-transcript-source").textContent).toBe("Hello world");

    expect(items[1].querySelector(".lumeo-transcript-time").textContent).toBe("1:15");
  });

  it("calls onSeek when an item is clicked", () => {
    const cues = [
      { start: 30, end: 35, text: "Click me", translated: "Bấm vào tôi" },
    ];
    controller.renderCaptionTranscript(cues);

    const item = controller.getElement().querySelector(".lumeo-transcript-item");
    item.click();

    expect(onSeek).toHaveBeenCalledWith(30);
  });

  it("updates highlight and toggles visibility", () => {
    const cues = [
      { start: 0, text: "Zero" },
      { start: 5, text: "Five" },
    ];
    controller.renderCaptionTranscript(cues);

    expect(controller.isOpen()).toBe(false);
    expect(controller.toggle()).toBe(true);
    expect(controller.isOpen()).toBe(true);

    controller.updateCaptionTranscriptHighlight(1);
    const items = controller.getElement().querySelectorAll(".lumeo-transcript-item");
    expect(items[0].classList.contains("is-active")).toBe(false);
    expect(items[1].classList.contains("is-active")).toBe(true);

    expect(controller.toggle(false)).toBe(false);
    expect(controller.isOpen()).toBe(false);

    controller.remove();
    expect(controller.getElement()).toBeNull();
  });

  it("handles AI summarization trigger and summary view state", () => {
    const onSummarize = vi.fn();
    const ctrl = window.LumeoTranscript.createTranscriptController({
      doc: document,
      win: window,
      onSummarize,
    });
    ctrl.build();
    const cues = [{ start: 1, text: "A" }, { start: 2, text: "B" }];
    ctrl.renderCaptionTranscript(cues);

    const summarizeBtn = ctrl.getElement().querySelector(".lumeo-transcript-summarize");
    expect(summarizeBtn).not.toBeNull();
    summarizeBtn.click();
    expect(onSummarize).toHaveBeenCalledWith(cues);

    ctrl.showSummaryLoading();
    expect(ctrl.getElement().querySelector(".lumeo-summary-loading")).not.toBeNull();

    ctrl.setSummary("### Key Takeaways\n- Point 1\n- Point 2");
    const summaryBox = ctrl.getElement().querySelector(".lumeo-transcript-summary");
    expect(summaryBox.hidden).toBe(false);
    expect(ctrl.getElement().querySelector(".lumeo-summary-content").textContent).toContain("Point 1");
  });

  it("renders empty state placeholder when no cues are available", () => {
    const root = controller.build();
    controller.renderCaptionTranscript([]);
    const emptyEl = root.querySelector(".lumeo-transcript-empty");
    expect(emptyEl).not.toBeNull();
    expect(emptyEl.querySelector(".lumeo-transcript-empty-title").textContent).toBe("No subtitles yet");
  });

  it("fires onToggle callback when drawer visibility changes", () => {
    const onToggle = vi.fn();
    const ctrl = window.LumeoTranscript.createTranscriptController({
      doc: document,
      win: window,
      onToggle,
    });
    expect(ctrl.toggle()).toBe(true);
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(ctrl.toggle(false)).toBe(false);
    expect(onToggle).toHaveBeenCalledWith(false);
  });
});
