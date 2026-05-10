(() => {
  "use strict";

  if (window.LumeoCaptions?.__loaded) return;

  const SNIFFER_ID = "lumeo-caption-sniffer";
  const SNIFFER_SOURCE = "yt-trans-sniffer";
  const TIMEDTEXT_MIN_CHARS = 40;
  const sniffedLinks = new Map();
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

  async function fetchText(url) {
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
    if (!url.searchParams.has("fmt")) url.searchParams.set("fmt", "srv3");
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
    const xml = await fetchText(url);
    if (!xml) {
      diagnostics.reason = "timedtext-fetch-failed";
      return null;
    }
    if (xml.length <= TIMEDTEXT_MIN_CHARS) {
      diagnostics.reason = "timedtext-empty-body";
      return null;
    }
    const cues = parseSubtitleXml(xml);
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
      if (!parsed.searchParams.has("fmt")) parsed.searchParams.set("fmt", "srv3");
      const sourceLanguage = parsed.searchParams.get("lang") || "";
      const xml = await fetchText(parsed.toString());
      const cues = xml && xml.length > TIMEDTEXT_MIN_CHARS ? parseSubtitleXml(xml) : [];
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
    const cues = xml && xml.length > TIMEDTEXT_MIN_CHARS ? parseSubtitleXml(xml) : [];
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
      await fetchViaSniff(videoId);
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
    };
  }

  window.LumeoCaptions = {
    __loaded: true,
    injectSniffer,
    getVideoId,
    cleanSubtitleText,
    parseSubtitleXml,
    readCaptionTracksFromInnertube,
    fetchSubtitles,
    mergeBilingualCues,
    getDiagnosticsSummary,
  };
})();
