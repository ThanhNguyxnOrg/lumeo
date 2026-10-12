(() => {
  "use strict";

  if (window.LumeoTranscript?.__loaded) return;

  function createTranscriptController(options = {}) {
    const doc = options.doc || document;
    const win = options.win || window;
    const onSeek = options.onSeek || (() => {});
    const onSummarize = options.onSummarize || null;

    let root = null;
    let listEl = null;
    let summaryEl = null;
    let activeCueIndex = -1;
    let cues = [];
    let isOpen = false;

    function formatTime(seconds) {
      const s = Math.floor(seconds || 0);
      const m = Math.floor(s / 60);
      const rem = s % 60;
      return `${m}:${rem.toString().padStart(2, "0")}`;
    }

    function svgIcon(inner, viewBox = "0 0 16 16") {
      return `<svg viewBox="${viewBox}" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
    }

    const ICON_SPARK = '<path d="M8 1.5l1.6 4.2 4.2 1.6-4.2 1.6L8 13.1 6.4 8.9 2.2 7.3l4.2-1.6L8 1.5z" fill="currentColor" stroke="none"/>';
    const ICON_DOWNLOAD = '<path d="M8 2v7.5m0 0L5.2 6.7M8 9.5l2.8-2.8M2.8 12.5h10.4"/>';
    const ICON_DOC = '<g stroke-width="1.4"><rect x="3" y="1.8" width="10" height="12.4" rx="1.6"/><path d="M5.6 5.4h4.8M5.6 8h4.8M5.6 10.6h3"/></g>';

    function build() {
      if (root) return root;
      root = doc.createElement("aside");
      root.className = "lumeo-transcript-drawer";
      root.hidden = true;
      root.setAttribute("aria-label", "Transcript Drawer");

      const header = doc.createElement("div");
      header.className = "lumeo-transcript-header";

      const title = doc.createElement("strong");
      title.textContent = "Transcript";

      const count = doc.createElement("span");
      count.className = "lumeo-transcript-count";
      count.textContent = "0 cues";

      const summarizeBtn = doc.createElement("button");
      summarizeBtn.type = "button";
      summarizeBtn.className = "lumeo-transcript-summarize";
      summarizeBtn.setAttribute("aria-label", "Summarize video with AI");
      summarizeBtn.innerHTML = `${svgIcon(ICON_SPARK)}<span>Summarize</span>`;
      summarizeBtn.addEventListener("click", () => {
        if (typeof onSummarize === "function") {
          onSummarize(cues);
        }
      });

      const exportBtn = doc.createElement("button");
      exportBtn.type = "button";
      exportBtn.className = "lumeo-transcript-export";
      exportBtn.setAttribute("aria-label", "Export subtitles as SRT");
      exportBtn.innerHTML = `${svgIcon(ICON_DOWNLOAD)}<span>SRT</span>`;
      exportBtn.addEventListener("click", () => {
        if (!cues || cues.length === 0) return;
        if (win.LumeoSrtExport?.toSrt && win.LumeoSrtExport?.downloadText) {
          const srtText = win.LumeoSrtExport.toSrt(cues);
          const safeTitle = win.LumeoSrtExport.sanitizeFilename(doc.title || "video-subtitles");
          win.LumeoSrtExport.downloadText(srtText, `${safeTitle}.srt`);
        }
      });

      const closeBtn = doc.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "lumeo-transcript-close";
      closeBtn.setAttribute("aria-label", "Close transcript drawer");
      closeBtn.textContent = "✕";
      closeBtn.addEventListener("click", () => toggle(false));

      const headerActions = doc.createElement("div");
      headerActions.className = "lumeo-transcript-actions";
      headerActions.append(summarizeBtn, exportBtn, count, closeBtn);

      header.append(title, headerActions);

      const body = doc.createElement("div");
      body.className = "lumeo-transcript-body";

      summaryEl = doc.createElement("div");
      summaryEl.className = "lumeo-transcript-summary";
      summaryEl.hidden = true;

      listEl = doc.createElement("div");
      listEl.className = "lumeo-transcript-list";
      listEl.setAttribute("role", "list");
      body.append(summaryEl, listEl);

      root.append(header, body);
      const container = doc.fullscreenElement || doc.webkitFullscreenElement || doc.body || doc.documentElement;
      try { container.appendChild(root); } catch {}

      doc.addEventListener("fullscreenchange", handleFullscreenChange);
      doc.addEventListener("webkitfullscreenchange", handleFullscreenChange);

      renderCaptionTranscript(cues);
      return root;
    }

    function handleFullscreenChange() {
      if (!root) return;
      const fsEl = doc.fullscreenElement || doc.webkitFullscreenElement;
      if (fsEl) {
        if (!fsEl.contains(root)) {
          try { fsEl.appendChild(root); } catch {}
        }
      } else {
        const defaultContainer = doc.body || doc.documentElement;
        if (root.parentElement !== defaultContainer) {
          try { defaultContainer.appendChild(root); } catch {}
        }
      }
    }

    function createCueItem(cue, index) {
      const item = doc.createElement("button");
      item.type = "button";
      item.className = "lumeo-transcript-item";
      item.dataset.index = String(index);
      item.setAttribute("role", "listitem");
      item.setAttribute("aria-label", `Seek to ${formatTime(cue.start)}`);

      const time = doc.createElement("span");
      time.className = "lumeo-transcript-time";
      time.textContent = formatTime(cue.start);

      const textWrap = doc.createElement("div");
      textWrap.className = "lumeo-transcript-texts";

      const target = doc.createElement("div");
      target.className = "lumeo-transcript-target";
      target.textContent = cue.translated || cue.text;

      const source = doc.createElement("div");
      source.className = "lumeo-transcript-source";
      source.textContent = cue.text;

      if (cue.__fallback) {
        item.classList.add("is-fallback");
        item.title = "Translation failed — showing original text";
      }

      textWrap.append(target, source);
      item.append(time, textWrap);

      item.addEventListener("click", () => {
        onSeek(cue.start);
        updateCaptionTranscriptHighlight(index);
      });
      return item;
    }

    function updateCaptionTranscriptCount(count) {
      if (!root) build();
      const countEl = root.querySelector(".lumeo-transcript-count");
      if (countEl) countEl.textContent = `${count} cues`;
    }

    function appendCaptionRow(cue, index) {
      if (!root) build();
      const idx = typeof index === "number" ? index : cues.length;
      cues.push(cue);
      updateCaptionTranscriptCount(cues.length);
      if (!listEl) return;
      const item = createCueItem(cue, idx);
      listEl.appendChild(item);
    }

    function renderCaptionTranscript(newCues = []) {
      cues = Array.isArray(newCues) ? newCues : [];
      if (!root) build();
      updateCaptionTranscriptCount(cues.length);
      if (!listEl) return;
      listEl.replaceChildren();

      if (cues.length === 0) {
        const empty = doc.createElement("div");
        empty.className = "lumeo-transcript-empty";
        empty.innerHTML = `
          <div class="lumeo-transcript-empty-icon"><svg viewBox="0 0 16 16" width="30" height="30" fill="none" stroke="currentColor" aria-hidden="true" focusable="false">${ICON_DOC}</svg></div>
          <div class="lumeo-transcript-empty-title">No subtitles yet</div>
          <div class="lumeo-transcript-empty-hint">Press Start Translation in the player to load bilingual subtitles here</div>
        `;
        listEl.appendChild(empty);
        return;
      }

      cues.forEach((cue, index) => {
        listEl.appendChild(createCueItem(cue, index));
      });
      updateCaptionTranscriptHighlight(activeCueIndex);
    }

    function updateCaptionTranscriptHighlight(cueIndex) {
      activeCueIndex = cueIndex;
      if (!listEl) return;
      const items = listEl.querySelectorAll(".lumeo-transcript-item");
      items.forEach((item, idx) => {
        const isActive = idx === cueIndex;
        item.classList.toggle("is-active", isActive);
        if (isActive && isOpen) {
          try {
            item.scrollIntoView({ block: "nearest", behavior: "smooth" });
          } catch {}
        }
      });
    }

    function toggle(open) {
      if (!root) build();
      handleFullscreenChange();
      isOpen = typeof open === "boolean" ? open : root.hidden;
      root.hidden = !isOpen;
      if (isOpen && cues.length === 0) {
        renderCaptionTranscript([]);
      }
      if (isOpen && activeCueIndex >= 0) {
        updateCaptionTranscriptHighlight(activeCueIndex);
      }
      if (typeof options.onToggle === "function") {
        try { options.onToggle(isOpen); } catch {}
      }
      return isOpen;
    }

    function showSummaryLoading() {
      if (!summaryEl) build();
      summaryEl.hidden = false;
      summaryEl.innerHTML = '<div class="lumeo-summary-loading">Generating video summary…</div>';
    }

    function setSummary(summaryMarkdown) {
      if (!summaryEl) build();
      summaryEl.hidden = false;
      summaryEl.replaceChildren();

      const head = doc.createElement("div");
      head.className = "lumeo-summary-head";

      const title = doc.createElement("strong");
      title.className = "lumeo-summary-title";
      title.textContent = "Key takeaways";

      const close = doc.createElement("button");
      close.type = "button";
      close.className = "lumeo-summary-close";
      close.setAttribute("aria-label", "Dismiss summary");
      close.textContent = "✕";
      close.addEventListener("click", () => { summaryEl.hidden = true; });

      head.append(title, close);

      const content = doc.createElement("div");
      content.className = "lumeo-summary-content";
      content.textContent = summaryMarkdown;

      summaryEl.append(head, content);
    }

    function setSummaryError(errMsg) {
      if (!summaryEl) build();
      summaryEl.hidden = false;
      summaryEl.replaceChildren();
      const errDiv = doc.createElement("div");
      errDiv.className = "lumeo-summary-error";
      errDiv.textContent = String(errMsg || "Summary generation failed.");
      summaryEl.appendChild(errDiv);
    }

    function remove() {
      try {
        doc.removeEventListener("fullscreenchange", handleFullscreenChange);
        doc.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
      } catch {}
      root?.remove();
      root = null;
      listEl = null;
      summaryEl = null;
      isOpen = false;
      cues = [];
      activeCueIndex = -1;
    }

    return {
      build,
      renderCaptionTranscript,
      appendCaptionRow,
      updateCaptionTranscriptCount,
      updateCaptionTranscriptHighlight,
      toggle,
      showSummaryLoading,
      setSummary,
      setSummaryError,
      isOpen: () => isOpen,
      getElement: () => root,
      remove,
    };
  }

  window.LumeoTranscript = {
    __loaded: true,
    createTranscriptController,
  };
})();
