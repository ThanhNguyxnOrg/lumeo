(() => {
  "use strict";

  if (window.LumeoCaptions?.__loaded) return;

  const SNIFFER_ID = "lumeo-caption-sniffer";
  const SNIFFER_SOURCE = "yt-trans-sniffer";
  const TIMEDTEXT_MIN_CHARS = 40;
  const sniffedLinks = new Map();
  const pageFetchRequests = new Map();
  const interceptedCaptionBodies = new Map();
  let sniffedTracks = null;
  let sniffedTrackSummary = null;
  let sniffedEmptyReason = null;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getVideoId(url = location.href) {
    try {
      return new URL(url).searchParams.get("v");
    } catch {
      return null;
    }
  }

  function injectSniffer() {
    document.getElementById(SNIFFER_ID)?.remove();
    const script = document.createElement("script");
    script.id = SNIFFER_ID;
    script.src = chrome.runtime.getURL("services/sniffer.js");
    (document.head || document.documentElement).appendChild(script);
  }

  function onSnifferMessage(event) {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || typeof data !== "object" || data.source !== SNIFFER_SOURCE) return;

    if (data.type === "subtitle-url" && typeof data.url === "string") {
      try {
        const parsed = new URL(data.url);
        const videoId = parsed.searchParams.get("v") || getVideoId();
        if (!videoId || sniffedLinks.has(videoId)) return;
        parsed.searchParams.delete("fmt");
        sniffedLinks.set(videoId, parsed.toString());
      } catch {
        // Ignore malformed URLs from page context.
      }
      return;
    }

    if (data.type === "caption-body" && typeof data.url === "string") {
      try {
        const parsed = new URL(data.url);
        const videoId = parsed.searchParams.get("v") || getVideoId();
        const text = String(data.text || "");
        if (!videoId || text.length <= TIMEDTEXT_MIN_CHARS) return;
        const cues = parseSubtitleText(text);
        if (!cues.length) return;
        const sourceLanguage = parsed.searchParams.get("lang") || parsed.searchParams.get("tlang") || "";
        interceptedCaptionBodies.set(videoId, {
          cues,
          sourceLanguage,
          url: parsed.toString(),
          status: data.status,
          source: data.source || "page",
          receivedAt: Date.now(),
        });
      } catch {
        // Ignore malformed intercepted messages.
      }
      return;
    }

    if (data.type === "caption-fetch-response" && data.id) {
      const pending = pageFetchRequests.get(String(data.id));
      if (!pending) return;
      pageFetchRequests.delete(String(data.id));
      pending.resolve(data);
      return;
    }

    if (data.type === "caption-tracks" && Array.isArray(data.tracks)) {
      sniffedTracks = data.tracks;
      if (Array.isArray(data.summary)) sniffedTrackSummary = data.summary;
      sniffedEmptyReason = null;
    }

    if (data.type === "caption-tracks-empty") {
      sniffedEmptyReason = {
        hasRenderer: !!data.hasRenderer,
        hasPlayerResponse: !!data.hasPlayerResponse,
      };
    }
  }

  window.addEventListener("message", onSnifferMessage);

  // Inject the sniffer eagerly so it can publish captionTracks before the user
  // clicks Start. Caption discovery races YouTube's SPA hydration; the earlier
  // we patch fetch/XHR and read ytInitialPlayerResponse, the more likely we
  // capture caption tracks for the current watch page.
  try { injectSniffer(); } catch {}

  function isTimedTextUrl(url) {
    try {
      return new URL(url, location.href).pathname.includes("/api/timedtext");
    } catch {
      return false;
    }
  }

  async function fetchTextViaPage(url, timeoutMs = 9000) {
    if (!isTimedTextUrl(url)) return null;
    try { injectSniffer(); } catch {}
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pageFetchRequests.delete(id);
        resolve(null);
      }, timeoutMs);
      pageFetchRequests.set(id, {
        resolve: (reply) => {
          clearTimeout(timer);
          if (reply?.ok && typeof reply.text === "string") {
            resolve(reply.text);
          } else {
            resolve(null);
          }
        },
      });
      window.postMessage({
        source: SNIFFER_SOURCE,
        type: "caption-fetch-request",
        id,
        url,
      }, window.location.origin);
    });
  }

  async function fetchText(url) {
    const pageText = await fetchTextViaPage(url);
    if (pageText !== null) return pageText;
    try {
      const response = await fetch(url);
      if (response.ok) return response.text();
    } catch {
      // Fall back to extension background proxy.
    }
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "fetchUrl", url }, (reply) => {
        resolve(reply?.ok ? reply.text : null);
      });
    });
  }

  function decodeHtml(value) {
    const textarea = document.createElement("textarea");
    let text = String(value || "");
    let previous;
    do {
      previous = text;
      textarea.innerHTML = text;
      text = textarea.value;
    } while (text !== previous);
    return text;
  }

  function cleanSubtitleText(value) {
    return decodeHtml(String(value || "").replace(/<[^>]+>/g, ""))
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseSubtitleXml(xmlText) {
    const xml = new DOMParser().parseFromString(String(xmlText || ""), "application/xml");
    return Array.from(xml.getElementsByTagName("text"))
      .map((node) => {
        const start = Number.parseFloat(node.getAttribute("start") || "0");
        const dur = Number.parseFloat(node.getAttribute("dur") || "0");
        const text = cleanSubtitleText(node.textContent);
        return {
          start,
          end: start + dur,
          text,
          translated: "",
        };
      })
      .filter((cue) => Number.isFinite(cue.start) && cue.text);
  }

  function parseSubtitleJson3(jsonText) {
    let data;
    try {
      data = JSON.parse(String(jsonText || ""));
    } catch {
      return [];
    }
    const events = Array.isArray(data?.events) ? data.events : [];
    return events
      .map((event) => {
        const text = (event.segs || [])
          .map((seg) => seg?.utf8 || "")
          .join("")
          .replace(/\n+/g, " ");
        const start = Number(event.tStartMs || 0) / 1000;
        const dur = Number(event.dDurationMs || 0) / 1000;
        return {
          start,
          end: start + Math.max(dur, 0.25),
          text: cleanSubtitleText(text),
          translated: "",
        };
      })
      .filter((cue) => Number.isFinite(cue.start) && cue.text);
  }

  function parseSubtitleText(text) {
    const raw = String(text || "").trim();
    if (!raw) return [];
    if (raw.startsWith("{") || raw.startsWith("[")) {
      const cues = parseSubtitleJson3(raw);
      if (cues.length) return cues;
    }
    return parseSubtitleXml(raw);
  }

  function parseTimestamp(label) {
    const parts = String(label || "")
      .trim()
      .split(":")
      .map((part) => Number.parseInt(part, 10));
    if (!parts.length || parts.some((part) => !Number.isFinite(part))) return null;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return null;
  }

  const TRANSCRIPT_PANEL_SELECTOR =
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"], ' +
    'ytd-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"], ' +
    'ytd-engagement-panel-section-list-renderer';
  const TRANSCRIPT_SEGMENT_SELECTOR = "ytd-transcript-segment-renderer, transcript-segment-view-model";
  const TRANSCRIPT_DESCENDANT_SELECTOR =
    "ytd-transcript-renderer, ytd-transcript-search-panel-renderer, ytd-transcript-segment-list-renderer, " +
    "transcript-segment-view-model, ytd-transcript-segment-renderer, .ytwTranscriptSegmentViewModelHost";
  const TRANSCRIPT_TEXT_SELECTORS = [
    ".segment-text",
    "#segment-text",
    ".yt-core-attributed-string",
    "yt-formatted-string",
    ".ytAttributedStringHost",
    ".ytwTranscriptSegmentViewModelBody",
  ];
  const TRANSCRIPT_TIMESTAMP_SELECTORS = [
    ".segment-timestamp",
    "#start-time",
    ".ytwTranscriptSegmentViewModelTimestamp",
    "[class*='timestamp']:not([class*='A11y']):not([class*='a11y'])",
    "[id*='timestamp']",
  ];
  // The modern YT transcript panel adds an a11y label element that contains
  // human-readable durations like "9 seconds" or "1 minute, 6 seconds".
  // These MUST be excluded from both timestamp and text candidate pools.
  const A11Y_TIMESTAMP_RE = /^\d+\s+(second|minute|hour|giây|phút|giờ)/i;

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function isElementVisible(element) {
    if (!element?.isConnected) return false;
    if (element.hidden || element.getAttribute("hidden") !== null) return false;
    if (element.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function looksLikeTimestamp(text) {
    return /^\d{1,2}:\d{2}(?::\d{2})?$/.test(normalizeText(text));
  }

  function collectTextCandidates(root, selectors) {
    const out = [];
    for (const selector of selectors) {
      for (const element of root.querySelectorAll(selector)) {
        const text = normalizeText(element.innerText || element.textContent);
        if (text) out.push(text);
      }
    }
    return [...new Set(out)];
  }

  function transcriptPanelCandidates() {
    return Array.from(document.querySelectorAll(TRANSCRIPT_PANEL_SELECTOR))
      .filter((panel) => {
        const targetId = normalizeText(panel.getAttribute("target-id")).toLowerCase();
        const panelId = normalizeText(panel.id).toLowerCase();
        return (
          targetId.includes("transcript") ||
          targetId.includes("pamodern_transcript") ||
          panelId.includes("transcript") ||
          !!panel.querySelector(TRANSCRIPT_DESCENDANT_SELECTOR)
        );
      });
  }

  function transcriptPanel() {
    return transcriptPanelCandidates().find((panel) =>
      isElementVisible(panel) &&
      (panel.offsetHeight > 0 || panel.querySelector(TRANSCRIPT_DESCENDANT_SELECTOR))
    ) || transcriptPanelCandidates()[0] || document;
  }

  function transcriptSegments() {
    return Array.from(transcriptPanel().querySelectorAll(TRANSCRIPT_SEGMENT_SELECTOR));
  }

  function isA11yTimestamp(text) {
    return A11Y_TIMESTAMP_RE.test(text);
  }

  function extractTranscriptCuesFromDom() {
    const rows = transcriptSegments();
    const cues = [];
    for (const row of rows) {
      // Collect timestamp candidates, filtering out a11y labels which contain
      // human-readable durations like "9 seconds" instead of "0:09".
      const tsPool = collectTextCandidates(row, TRANSCRIPT_TIMESTAMP_SELECTORS)
        .filter((t) => !isA11yTimestamp(t));
      const timeText =
        tsPool.find(looksLikeTimestamp) ||
        collectTextCandidates(row, ["span", "div", "yt-formatted-string", ".yt-core-attributed-string", ".ytAttributedStringHost"])
          .filter((t) => !isA11yTimestamp(t))
          .find(looksLikeTimestamp) ||
        "";
      // Text candidates: exclude timestamps AND a11y timestamp labels.
      const textFilter = (t) => !looksLikeTimestamp(t) && !isA11yTimestamp(t);
      const directPool = collectTextCandidates(row, TRANSCRIPT_TEXT_SELECTORS).filter(textFilter);
      const fallbackPool = collectTextCandidates(row, [
        "span",
        "div",
        "yt-formatted-string",
        ".yt-core-attributed-string",
        ".ytAttributedStringHost",
      ]).filter(textFilter);
      // Pick the longest in-band candidate: actual lyrics are always longer
      // than any remaining timestamp artifacts or short labels.
      function pickLineBody(pool) {
        if (!pool.length) return "";
        const inBand = pool.filter((t) => t.length >= 2 && t.length <= 320);
        const ranked = (inBand.length ? inBand : pool).slice();
        ranked.sort((a, b) => b.length - a.length);
        return ranked[0] || "";
      }
      const text = cleanSubtitleText(pickLineBody(directPool) || pickLineBody(fallbackPool) || "");
      const start = parseTimestamp(timeText);
      if (start === null || !text) continue;
      cues.push({
        start,
        end: start + 4,
        text,
        translated: "",
      });
    }
    for (let i = 0; i < cues.length; i += 1) {
      const nextStart = cues[i + 1]?.start;
      if (Number.isFinite(nextStart) && nextStart > cues[i].start) {
        cues[i].end = nextStart;
      }
    }
    return cues;
  }

  function clickableText(el) {
    return [
      el.getAttribute?.("aria-label"),
      el.getAttribute?.("title"),
      el.innerText,
      el.textContent,
    ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }

  function findClickable(patterns) {
    const candidates = Array.from(document.querySelectorAll(
      "button, yt-button-shape button, tp-yt-paper-item, ytd-menu-service-item-renderer, a",
    ));
    return candidates.find((candidate) => {
      const text = clickableText(candidate);
      return text && patterns.some((pattern) => pattern.test(text));
    }) || null;
  }

  async function clickIfFound(patterns, delay = 700) {
    const el = findClickable(patterns);
    if (!el) return false;
    try {
      el.click();
      await sleep(delay);
      return true;
    } catch {
      return false;
    }
  }

  async function openTranscriptPanel() {
    if (extractTranscriptCuesFromDom().length) return true;

    await clickIfFound([
      /^more$/i,
      /show more/i,
      /read more/i,
      /thêm/i,
      /xem thêm/i,
    ], 500);

    const scopedTranscriptButton = Array.from(document.querySelectorAll(
      "ytd-video-description-transcript-section-renderer button, ytd-structured-description-content-renderer button",
    )).find(isElementVisible);
    if (scopedTranscriptButton) {
      scopedTranscriptButton.click();
      await sleep(1200);
      if (extractTranscriptCuesFromDom().length) return true;
    }

    if (await clickIfFound([
      /show transcript/i,
      /^transcript$/i,
      /open transcript/i,
      /transcription/i,
      /스크립트|대본|내용\s*대본/i,
      /bản chép/i,
      /phụ đề.*văn bản/i,
    ], 1200)) {
      return !!extractTranscriptCuesFromDom().length;
    }

    const moreButtons = Array.from(document.querySelectorAll("button")).filter((button) =>
      /more actions|more options|actions|thêm/i.test(clickableText(button)) ||
      button.querySelector("svg path[d*='12']"),
    );
    for (const button of moreButtons.slice(0, 4)) {
      try {
        button.click();
        await sleep(500);
        if (await clickIfFound([
          /show transcript/i,
          /^transcript$/i,
          /open transcript/i,
          /transcription/i,
          /스크립트|대본|내용\s*대본/i,
          /bản chép/i,
        ], 1200)) {
          return !!extractTranscriptCuesFromDom().length;
        }
      } catch {
        // Try the next menu button.
      }
    }

    return !!extractTranscriptCuesFromDom().length;
  }

  async function fetchViaTranscriptPanel(diagnostics = {}) {
    diagnostics.steps ||= [];
    diagnostics.steps.push("transcript-panel");
    const opened = await openTranscriptPanel();
    if (!opened) {
      diagnostics.transcriptPanel = "not-opened";
      return null;
    }
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const cues = extractTranscriptCuesFromDom();
      if (cues.length) {
        diagnostics.transcriptPanel = `dom-${cues.length}`;
        return {
          cues,
          sourceLanguage: "transcript",
          track: null,
          tracks: [],
          transcriptPanel: true,
        };
      }
      await sleep(500);
    }
    diagnostics.transcriptPanel = "empty";
    return null;
  }

  function parseCaptionTracksFromHtml(html) {
    const marker = '"captionTracks":';
    const markerIndex = String(html || "").indexOf(marker);
    if (markerIndex === -1) return null;
    const start = html.indexOf("[", markerIndex);
    if (start === -1) return null;
    let depth = 0;
    for (let i = start; i < html.length; i++) {
      if (html[i] === "[") depth += 1;
      if (html[i] === "]") depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  function readCaptionTracksFromScripts() {
    for (const script of document.querySelectorAll("script")) {
      if (!script.textContent?.includes('"captionTracks"')) continue;
      const tracks = parseCaptionTracksFromHtml(script.textContent);
      if (tracks?.length) return tracks;
    }
    return sniffedTracks;
  }

  async function readCaptionTracksFromWatchHtml() {
    const videoId = getVideoId();
    const targets = [
      videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en` : null,
      videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` : null,
      location.href,
    ].filter(Boolean);
    for (const target of targets) {
      try {
        const html = await fetchText(target);
        if (!html) continue;
        const tracks = parseCaptionTracksFromHtml(html);
        if (tracks?.length) return tracks;
      } catch {
        // Try the next URL.
      }
    }
    return null;
  }

  async function readCaptionTracksFromInnertube(videoId) {
    if (!videoId) return null;
    try {
      const response = await fetch("https://www.youtube.com/youtubei/v1/player", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: {
            client: {
              clientName: "ANDROID",
              clientVersion: "20.10.38",
              androidSdkVersion: 35,
            },
          },
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return null;
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      return Array.isArray(tracks) && tracks.length ? tracks : null;
    } catch {
      return null;
    }
  }

  function parseTimedTextTrackList(xmlText) {
    const xml = new DOMParser().parseFromString(String(xmlText || ""), "application/xml");
    const tracks = Array.from(xml.getElementsByTagName("track"));
    return tracks.map((track) => {
      const languageCode = track.getAttribute("lang_code") || "";
      const name = track.getAttribute("name") || "";
      const kind = track.getAttribute("kind") || "";
      const videoId = getVideoId();
      const url = new URL("https://www.youtube.com/api/timedtext");
      url.searchParams.set("v", videoId || "");
      url.searchParams.set("lang", languageCode);
      if (name) url.searchParams.set("name", name);
      if (kind) url.searchParams.set("kind", kind);
      url.searchParams.set("fmt", "srv3");
      return {
        languageCode,
        name: { simpleText: name },
        kind: kind === "asr" ? "asr" : undefined,
        baseUrl: url.toString(),
      };
    }).filter((track) => track.languageCode && track.baseUrl);
  }

  async function readCaptionTracksFromTimedTextList(videoId) {
    if (!videoId) return null;
    try {
      const url = `https://www.youtube.com/api/timedtext?type=list&v=${encodeURIComponent(videoId)}`;
      const xml = await fetchText(url);
      const tracks = parseTimedTextTrackList(xml);
      return tracks.length ? tracks : null;
    } catch {
      return null;
    }
  }

  function chooseCaptionTrack(tracks, targetLanguage) {
    if (!Array.isArray(tracks) || !tracks.length) return null;
    const targetBase = String(targetLanguage || "").split("-")[0];
    const manual = (track) => track.kind !== "asr";
    // Prefer manual tracks when available, then any auto-generated (asr) track.
    return (
      tracks.find((track) => manual(track) && track.languageCode === targetLanguage) ||
      tracks.find((track) => manual(track) && track.languageCode?.split("-")[0] === targetBase) ||
      tracks.find((track) => manual(track)) ||
      tracks.find((track) => track.languageCode === targetLanguage) ||
      tracks.find((track) => track.languageCode?.split("-")[0] === targetBase) ||
      tracks.find((track) => track.languageCode === "en") ||
      tracks[0]
    );
  }

  function buildTimedTextUrl(track, options = {}) {
    if (!track?.baseUrl) return "";
    const url = new URL(String(track.baseUrl).replace(/\\u0026/g, "&"));
    if (options.targetLanguage) url.searchParams.set("lang", options.targetLanguage);
    if (options.translateTo) url.searchParams.set("tlang", options.translateTo);
    if (!url.searchParams.has("fmt")) url.searchParams.set("fmt", "json3");
    return url.toString();
  }

  async function triggerCCButton() {
    const button = document.querySelector(".ytp-subtitles-button");
    if (!button) return;
    const wasOn = button.getAttribute("aria-pressed") === "true";
    if (!wasOn) {
      button.click();
      await sleep(700);
    }
    await sleep(300);
    if (!wasOn && button.getAttribute("aria-pressed") === "true") {
      button.click();
    }
  }

  async function waitForSniffedUrl(videoId, timeoutMs = 3000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (sniffedLinks.has(videoId)) return sniffedLinks.get(videoId);
      await sleep(150);
    }
    return null;
  }

  async function waitForInterceptedCaptions(videoId, timeoutMs = 3500) {
    if (!videoId) return null;
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const hit = interceptedCaptionBodies.get(videoId);
      if (hit?.cues?.length) return hit;
      await sleep(150);
    }
    return null;
  }

  async function waitForTracks(maxWaitMs = 4500) {
    let tracks = readCaptionTracksFromScripts();
    if (tracks?.length) return tracks;
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      await sleep(250);
      tracks = readCaptionTracksFromScripts();
      if (tracks?.length) return tracks;
    }
    return null;
  }

  async function fetchViaPageData(targetLanguage, options = {}) {
    const videoId = getVideoId();
    const diagnostics = options.diagnostics || {};
    diagnostics.steps = diagnostics.steps || [];

    let tracks = await waitForTracks(4500);
    if (tracks?.length) diagnostics.steps.push("scripts");

    if (!tracks?.length) {
      // Force YT player to load timedtext URLs by toggling the CC button.
      diagnostics.steps.push("cc-trigger");
      void triggerCCButton();
      const intercepted = await waitForInterceptedCaptions(videoId, 2500);
      if (intercepted?.cues?.length) {
        diagnostics.steps.push(`intercepted-${intercepted.source || "page"}`);
        return {
          cues: intercepted.cues,
          sourceLanguage: intercepted.sourceLanguage,
          track: null,
          tracks: [],
          intercepted: true,
        };
      }
      tracks = await waitForTracks(2500);
      if (tracks?.length) diagnostics.steps.push("scripts-after-cc");
    }

    if (!tracks?.length) {
      tracks = await readCaptionTracksFromWatchHtml();
      if (tracks?.length) diagnostics.steps.push("watch-html");
    }
    if (!tracks?.length) {
      tracks = await readCaptionTracksFromInnertube(videoId);
      if (tracks?.length) diagnostics.steps.push("innertube");
    }
    if (!tracks?.length) {
      tracks = await readCaptionTracksFromTimedTextList(videoId);
      if (tracks?.length) diagnostics.steps.push("timedtext-list");
    }

    if (!tracks?.length) {
      diagnostics.reason = "no-tracks";
      diagnostics.snifferEmpty = sniffedEmptyReason;
      return null;
    }

    diagnostics.tracks = tracks.map((track) => ({
      languageCode: track.languageCode,
      kind: track.kind || "manual",
      name: track.name?.simpleText || track.name?.runs?.[0]?.text || "",
    }));

    const track = chooseCaptionTrack(tracks, targetLanguage);
    if (!track) {
      diagnostics.reason = "no-target-language";
      return null;
    }
    diagnostics.chosen = {
      languageCode: track.languageCode,
      kind: track.kind || "manual",
    };

    const sourceLanguage = track.languageCode || "";
    const url = buildTimedTextUrl(track);
    const interceptedBeforeFetch = await waitForInterceptedCaptions(videoId, 500);
    if (interceptedBeforeFetch?.cues?.length) {
      diagnostics.steps.push(`intercepted-${interceptedBeforeFetch.source || "page"}`);
      return {
        cues: interceptedBeforeFetch.cues,
        sourceLanguage: interceptedBeforeFetch.sourceLanguage || sourceLanguage,
        track,
        tracks,
        intercepted: true,
      };
    }
    const xml = await fetchText(url);
    if (!xml) {
      diagnostics.reason = "timedtext-fetch-failed";
      return null;
    }
    if (xml.length <= TIMEDTEXT_MIN_CHARS) {
      const intercepted = await waitForInterceptedCaptions(videoId, 2500);
      if (intercepted?.cues?.length) {
        diagnostics.steps.push(`intercepted-${intercepted.source || "page"}`);
        return {
          cues: intercepted.cues,
          sourceLanguage: intercepted.sourceLanguage || sourceLanguage,
          track,
          tracks,
          intercepted: true,
        };
      }
      diagnostics.reason = "timedtext-empty-body";
      return null;
    }
    const cues = parseSubtitleText(xml);
    if (!cues.length) {
      diagnostics.reason = "timedtext-unparsable";
      return null;
    }

    return {
      cues,
      sourceLanguage,
      track,
      tracks,
    };
  }

  async function fetchViaSniff(videoId) {
    let url = sniffedLinks.get(videoId);
    if (!url) {
      for (let i = 0; i < 3 && !url; i++) {
        await triggerCCButton();
        url = await waitForSniffedUrl(videoId, 1500);
      }
    }
    if (!url) return null;
    try {
      const parsed = new URL(url);
      parsed.searchParams.delete("tlang");
      if (!parsed.searchParams.has("fmt")) parsed.searchParams.set("fmt", "json3");
      const sourceLanguage = parsed.searchParams.get("lang") || "";
      const xml = await fetchText(parsed.toString());
      const cues = xml && xml.length > TIMEDTEXT_MIN_CHARS ? parseSubtitleText(xml) : [];
      if (!cues.length) return null;
      return { cues, sourceLanguage, url: parsed.toString() };
    } catch {
      return null;
    }
  }

  async function fetchNativeTargetTrack(sourceResult, targetLanguage) {
    const sourceTrack = sourceResult?.track;
    if (!sourceTrack) return null;
    const tracks = sourceResult.tracks || [];
    const targetBase = String(targetLanguage || "").split("-")[0];
    const nativeTrack = tracks.find((track) =>
      track.languageCode === targetLanguage ||
      track.languageCode?.split("-")[0] === targetBase
    );
    if (!nativeTrack || nativeTrack === sourceTrack) return null;
    const xml = await fetchText(buildTimedTextUrl(nativeTrack));
    const cues = xml && xml.length > TIMEDTEXT_MIN_CHARS ? parseSubtitleText(xml) : [];
    return cues.length ? cues : null;
  }

  function mergeBilingualCues(sourceCues, targetCues) {
    return sourceCues.map((source) => {
      let bestText = "";
      let bestOverlap = 0;
      for (const target of targetCues) {
        if (target.start >= source.end) break;
        const overlap = Math.min(source.end, target.end) - Math.max(source.start, target.start);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestText = target.text;
        }
      }
      return { ...source, translated: bestText };
    });
  }

  async function fetchSubtitles(options = {}) {
    injectSniffer();
    const targetLanguage = options.targetLanguage || "vi";
    const videoId = options.videoId || getVideoId();
    const diagnostics = options.diagnostics || {};
    if (!videoId) {
      diagnostics.reason = "no-video-id";
      return null;
    }

    const source =
      await fetchViaPageData(targetLanguage, { diagnostics }) ||
      await fetchViaSniff(videoId) ||
      await fetchViaTranscriptPanel(diagnostics);
    if (!source?.cues?.length) {
      diagnostics.snifferTracks = sniffedTrackSummary;
      return null;
    }

    const targetBase = targetLanguage.split("-")[0];
    const isAlreadyTarget =
      source.sourceLanguage === targetLanguage ||
      source.sourceLanguage?.split("-")[0] === targetBase;
    if (isAlreadyTarget) {
      source.cues.forEach((cue) => { cue.translated = cue.text; });
      return { ...source, nativeTarget: true, videoId };
    }

    const nativeTargetCues = await fetchNativeTargetTrack(source, targetLanguage);
    if (nativeTargetCues?.length) {
      return {
        ...source,
        cues: mergeBilingualCues(source.cues, nativeTargetCues),
        nativeTarget: true,
        videoId,
      };
    }

    return { ...source, nativeTarget: false, videoId };
  }

  function getDiagnosticsSummary() {
    return {
      sniffedTracks: sniffedTrackSummary,
      sniffedEmpty: sniffedEmptyReason,
      sniffedUrlCount: sniffedLinks.size,
      interceptedCaptionCount: interceptedCaptionBodies.size,
    };
  }

  /** Prefer the in-player caption window so live DOM reads stay subtitle-sized. */
  function getYtpCaptionWindow() {
    return (
      document.querySelector(".ytp-caption-window-bottom") ||
      document.querySelector(".ytp-caption-window-top") ||
      document.querySelector(".ytp-caption-window-rollup") ||
      document.querySelector(".html5-video-player .ytp-caption-window-container")
    );
  }

  function normalizeCaptionSegmentText(segment) {
    return String(segment.textContent || "").replace(/\s+/g, " ").trim();
  }

  /**
   * Text currently shown on the YouTube CC overlay — one or two lines like normal TV subtitles,
   * not every visible segment concatenated.
   */
  function readYTCaptions() {
    const win = getYtpCaptionWindow();
    const segs = win
      ? win.querySelectorAll(".ytp-caption-segment")
      : document.querySelectorAll(".ytp-caption-segment");
    if (!segs.length) return "";

    if (win) {
      const rowLines = [];
      for (const child of win.children) {
        if (!(child instanceof HTMLElement)) continue;
        const parts = child.querySelectorAll(".ytp-caption-segment");
        if (!parts.length) continue;
        const line = Array.from(parts)
          .map(normalizeCaptionSegmentText)
          .filter(Boolean)
          .join(" ")
          .trim();
        if (line) rowLines.push(line);
      }
      if (rowLines.length) {
        return rowLines.slice(-2).join("\n");
      }
    }

    const flat = Array.from(segs).map(normalizeCaptionSegmentText).filter(Boolean);
    if (!flat.length) return "";
    const avgLen = flat.reduce((n, t) => n + t.length, 0) / flat.length;
    // Karaoke / word-by-word: many short segments → one spoken line.
    if (flat.length >= 6 && avgLen < 22) {
      return flat.join(" ");
    }
    return flat.slice(-2).join("\n");
  }

  window.LumeoCaptions = {
    __loaded: true,
    injectSniffer,
    getVideoId,
    cleanSubtitleText,
    parseSubtitleXml,
    parseSubtitleJson3,
    parseSubtitleText,
    readCaptionTracksFromInnertube,
    fetchSubtitles,
    fetchViaTranscriptPanel,
    mergeBilingualCues,
    getDiagnosticsSummary,
    readYTCaptions,
  };
})();
