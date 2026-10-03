(() => {
  "use strict";

  if (window.LumeoTranscript?.__loaded) return;

  function createTranscriptController(options = {}) {
    const doc = options.doc || document;
    const win = options.win || window;
    const onSeek = options.onSeek || (() => {});

    let root = null;
    let listEl = null;
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

      const closeBtn = doc.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "lumeo-transcript-close";
      closeBtn.setAttribute("aria-label", "Close transcript drawer");
      closeBtn.textContent = "✕";
      closeBtn.addEventListener("click", () => toggle(false));

      header.append(title, count, closeBtn);

      const body = doc.createElement("div");
      body.className = "lumeo-transcript-body";

      listEl = doc.createElement("div");
      listEl.className = "lumeo-transcript-list";
      listEl.setAttribute("role", "list");
      body.appendChild(listEl);

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

    function remove() {
      root?.remove();
      root = null;
      listEl = null;
      isOpen = false;
      cues = [];
      activeCueIndex = -1;
    }

    return {
      build,
      renderCaptionTranscript,
      updateCaptionTranscriptHighlight,
      toggle,
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
