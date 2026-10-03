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
      summarizeBtn.textContent = "✨ Summarize";
      summarizeBtn.addEventListener("click", () => {
        if (typeof onSummarize === "function") {
          onSummarize(cues);
        }
      });

      const closeBtn = doc.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "lumeo-transcript-close";
      closeBtn.setAttribute("aria-label", "Close transcript drawer");
      closeBtn.textContent = "✕";
      closeBtn.addEventListener("click", () => toggle(false));

      const headerActions = doc.createElement("div");
      headerActions.style.display = "flex";
      headerActions.style.alignItems = "center";
      headerActions.style.gap = "8px";
      headerActions.append(summarizeBtn, count, closeBtn);

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
      (doc.body || doc.documentElement).appendChild(root);
      return root;
    }

    function renderCaptionTranscript(newCues = []) {
      cues = Array.isArray(newCues) ? newCues : [];
      if (!root) build();
      const countEl = root.querySelector(".lumeo-transcript-count");
      if (countEl) countEl.textContent = `${cues.length} cues`;
      if (!listEl) return;
      listEl.replaceChildren();

      cues.forEach((cue, index) => {
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

        textWrap.append(target, source);
        item.append(time, textWrap);

        item.addEventListener("click", () => {
          onSeek(cue.start);
          updateCaptionTranscriptHighlight(index);
        });

        listEl.appendChild(item);
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
      isOpen = typeof open === "boolean" ? open : root.hidden;
      root.hidden = !isOpen;
      if (isOpen && activeCueIndex >= 0) {
        updateCaptionTranscriptHighlight(activeCueIndex);
      }
      return isOpen;
    }

    function showSummaryLoading() {
      if (!summaryEl) build();
      summaryEl.hidden = false;
      summaryEl.innerHTML = '<div class="lumeo-summary-loading" style="padding: 10px; font-size: 12px; color: #38bdf8;">✨ Generating AI video summary...</div>';
    }

    function setSummary(summaryMarkdown) {
      if (!summaryEl) build();
      summaryEl.hidden = false;
      summaryEl.replaceChildren();

      const head = doc.createElement("div");
      head.className = "lumeo-summary-head";
      head.style.display = "flex";
      head.style.justifyContent = "space-between";
      head.style.alignItems = "center";
      head.style.marginBottom = "6px";

      const title = doc.createElement("strong");
      title.style.fontSize = "12px";
      title.style.color = "#f97316";
      title.textContent = "✨ AI Key Takeaways";

      const close = doc.createElement("button");
      close.type = "button";
      close.className = "lumeo-summary-close";
      close.style.background = "transparent";
      close.style.border = "none";
      close.style.color = "#94a3b8";
      close.style.cursor = "pointer";
      close.textContent = "✕";
      close.addEventListener("click", () => { summaryEl.hidden = true; });

      head.append(title, close);

      const content = doc.createElement("div");
      content.className = "lumeo-summary-content";
      content.style.fontSize = "12px";
      content.style.lineHeight = "1.5";
      content.style.whiteSpace = "pre-wrap";
      content.textContent = summaryMarkdown;

      summaryEl.append(head, content);
    }

    function setSummaryError(errMsg) {
      if (!summaryEl) build();
      summaryEl.hidden = false;
      summaryEl.innerHTML = `<div class="lumeo-summary-error" style="padding: 10px; font-size: 12px; color: #f87171;">${errMsg}</div>`;
    }

    function remove() {
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
