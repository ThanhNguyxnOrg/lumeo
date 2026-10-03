(() => {
  "use strict";

  if (window.LumeoPlatformAdapters?.__loaded) return;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  const YouTubeAdapter = {
    name: "youtube",
    isMatch: (url = window.location.href) => {
      try {
        return new URL(url).hostname.includes("youtube.com");
      } catch {
        return window.location.hostname.includes("youtube.com");
      }
    },
    getVideoElement: () => {
      return document.querySelector("video.html5-main-video") || document.querySelector("video");
    },
    getVideoId: (url = window.location.href) => {
      try {
        const parsed = new URL(url);
        return parsed.searchParams.get("v") || parsed.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/)?.[1] || null;
      } catch {
        return null;
      }
    },
    triggerCCButton: async () => {
      const button = document.querySelector(".ytp-subtitles-button");
      if (!button) return false;
      const wasOn = button.getAttribute("aria-pressed") === "true";
      if (!wasOn) {
        button.click();
        await sleep(700);
      }
      return true;
    },
    readLiveSubtitles: () => {
      const win = document.querySelector(".ytp-caption-window-bottom") ||
                  document.querySelector(".ytp-caption-window-top") ||
                  document.querySelector(".ytp-caption-window-rollup") ||
                  document.querySelector(".html5-video-player .ytp-caption-window-container");
      const segs = win ? win.querySelectorAll(".ytp-caption-segment") : document.querySelectorAll(".ytp-caption-segment");
      if (!segs.length) return "";
      return Array.from(segs).map((s) => s.textContent || "").join(" ").replace(/\s+/g, " ").trim();
    }
  };

  const GenericAdapter = {
    name: "generic",
    isMatch: () => true,
    getVideoElement: () => document.querySelector("video"),
    getVideoId: (url = window.location.href) => {
      try {
        const parsed = new URL(url);
        if (parsed.searchParams.get("v")) return parsed.searchParams.get("v");
        const shortsMatch = parsed.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
        if (shortsMatch) return shortsMatch[1];
        const watchMatch = parsed.pathname.match(/\/watch\/(\d+)/);
        if (watchMatch) return watchMatch[1];
        if (parsed.pathname !== "/" && parsed.pathname !== "") {
          return parsed.hostname + parsed.pathname;
        }
        return "generic-video";
      } catch {
        return "generic-video";
      }
    },
    triggerCCButton: async () => {
      const selectors = [
        "button[aria-label*='captions']",
        "button[aria-label*='subtitles']",
        ".netflix-subtitles-button",
        ".udemy-captions-button"
      ];
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el && typeof el.click === "function") {
          el.click();
          return true;
        }
      }
      return false;
    },
    readLiveSubtitles: () => {
      const selectors = [
        ".player-timedtext-text-container", // Netflix
        ".captions-display--captions-container", // Udemy
        ".jw-text-track-container", // JWPlayer
        ".video-js .vjs-text-track-display", // VideoJS
        ".subtitles", ".captions"
      ];
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el && el.textContent) {
          return el.textContent.replace(/\s+/g, " ").trim();
        }
      }
      const video = document.querySelector("video");
      if (video) {
        for (const track of video.textTracks || []) {
          if ((track.mode === "showing" || track.mode === "hidden") && track.activeCues) {
            const texts = Array.from(track.activeCues).map(c => c.text || "");
            if (texts.join("").trim()) {
              return texts.join(" ").replace(/\s+/g, " ").trim();
            }
          }
        }
      }
      return "";
    }
  };

  const adapters = [YouTubeAdapter, GenericAdapter];
  function getAdapter(url = window.location.href) {
    return adapters.find(a => a.isMatch(url)) || GenericAdapter;
  }

  window.LumeoPlatformAdapters = {
    __loaded: true,
    getAdapter,
    adapters,
  };
})();
