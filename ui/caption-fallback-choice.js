(() => {
  "use strict";

  if (window.LumeoCaptionFallbackChoice?.__loaded) return;

  function fallbackTitle(diagnostics = {}) {
    if (diagnostics.reason === "no-target-language") return "No matching caption language";
    if (diagnostics.reason === "timedtext-empty-body") return "YouTube returned empty captions";
    return "No YouTube captions found";
  }

  function createButton(doc, className, text, onClick) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = text;
    button.addEventListener("click", onClick);
    return button;
  }

  function createTrackInfo(doc, tracks = []) {
    if (!Array.isArray(tracks) || !tracks.length) return null;
    const trackInfo = doc.createElement("div");
    trackInfo.className = "ec-choice-tracks";
    const head = doc.createElement("strong");
    head.textContent = `Detected tracks (${tracks.length})`;
    trackInfo.appendChild(head);
    const list = doc.createElement("ul");
    for (const track of tracks.slice(0, 12)) {
      const item = doc.createElement("li");
      const tag = track.kind === "asr" ? " · auto" : "";
      item.textContent = `${track.languageCode}${tag}${track.name ? ` — ${track.name}` : ""}`;
      list.appendChild(item);
    }
    trackInfo.appendChild(list);
    return trackInfo;
  }

  function create(options = {}) {
    const doc = options.document || document;
    const diagnostics = options.diagnostics || {};
    const wrap = doc.createElement("div");
    wrap.className = "ec-choice";

    const title = doc.createElement("strong");
    title.textContent = fallbackTitle(diagnostics);

    const copy = doc.createElement("small");
    copy.textContent = options.reason || "This video did not expose a readable caption track.";

    const trackInfo = createTrackInfo(doc, diagnostics.tracks);
    const actions = doc.createElement("div");
    actions.className = "ec-choice-actions";
    actions.append(
      createButton(doc, "ec-choice-btn", "Try Groq Whisper", () => options.onGroq?.()),
      createButton(doc, "ec-choice-btn", "Try Soniox STT", () => options.onSoniox?.()),
      createButton(doc, "ec-choice-btn", "Switch to Standard Dub", () => options.onStandard?.()),
      createButton(doc, "ec-choice-btn ec-choice-btn-muted", "Retry caption fetch", () => options.onRetry?.()),
      createButton(doc, "ec-choice-btn ec-choice-btn-muted", "Cancel", () => options.onCancel?.()),
    );

    wrap.append(title, copy);
    if (trackInfo) wrap.append(trackInfo);
    wrap.append(actions);
    return wrap;
  }

  window.LumeoCaptionFallbackChoice = {
    __loaded: true,
    fallbackTitle,
    create,
  };
})();
