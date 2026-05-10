(() => {
  "use strict";

  if (window.LumeoCaptionPipeline?.__loaded) return;

  const DEFAULT_TRANSLATE_PROVIDER = "google-free";
  const DEFAULT_TARGET_LANGUAGE = "vi";
  const CACHE_LIMIT = 50;

  function now() {
    return Date.now();
  }

  function cacheKey(videoId, targetLanguage, provider, sourceLanguage) {
    return [videoId, targetLanguage, provider, sourceLanguage || "auto"].join("::");
  }

  async function readCache() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "captionCacheGet" }, (reply) => {
        resolve(reply?.ok ? reply.cache : { entries: {} });
      });
    });
  }

  async function writeCache(cache) {
    const entries = Object.entries(cache.entries || {})
      .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
      .slice(0, CACHE_LIMIT);
    const nextCache = { entries: Object.fromEntries(entries) };
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "captionCacheSet", cache: nextCache }, () => resolve());
    });
  }

  async function getCachedResult(key) {
    const cache = await readCache();
    return cache.entries?.[key] || null;
  }

  async function setCachedResult(key, value) {
    const cache = await readCache();
    cache.entries ||= {};
    cache.entries[key] = { ...value, updatedAt: now() };
    await writeCache(cache);
  }

  function withAbortError(signal) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  }

  class CaptionPipeline {
    constructor() {
      this.token = 0;
      this.abortController = null;
      this.cues = [];
      this.meta = null;
    }

    stop() {
      this.token += 1;
      this.abortController?.abort();
      this.abortController = null;
      window.LumeoTTS?.stop?.();
      window.LumeoSonioxSTT?.stop?.();
    }

    async start(options = {}) {
      this.stop();
      const token = ++this.token;
      this.abortController = new AbortController();
      const signal = this.abortController.signal;

      const targetLanguage = options.targetLanguage || DEFAULT_TARGET_LANGUAGE;
      const provider = options.translateProvider || DEFAULT_TRANSLATE_PROVIDER;
      const subtitles = await window.LumeoCaptions.fetchSubtitles({
        targetLanguage,
        videoId: options.videoId,
      });
      withAbortError(signal);
      if (token !== this.token) return { ok: false, error: "stale" };
      if (!subtitles?.cues?.length) {
        return { ok: false, error: "This video does not expose a YouTube caption track." };
      }

      const key = cacheKey(subtitles.videoId, targetLanguage, provider, subtitles.sourceLanguage);
      const cached = await getCachedResult(key);
      if (cached?.cues?.length) {
        this.cues = cached.cues;
        this.meta = { ...subtitles, cached: true, provider };
        return { ok: true, cues: this.cues, meta: this.meta };
      }

      let cues = subtitles.cues;
      if (!subtitles.nativeTarget) {
        const sourceTexts = cues.map((cue) => cue.text);
        const translated = await window.LumeoTranslate.translateBatch(
          sourceTexts,
          targetLanguage,
          {
            ...options,
            provider,
            signal,
            targetLanguageName: options.targetLanguageName || targetLanguage,
          },
        );
        withAbortError(signal);
        if (token !== this.token) return { ok: false, error: "stale" };
        cues = cues.map((cue, index) => ({
          ...cue,
          translated: translated[index] || cue.text,
        }));
      }

      this.cues = cues;
      this.meta = { ...subtitles, provider, cached: false };
      await setCachedResult(key, { cues, meta: this.meta });
      return { ok: true, cues, meta: this.meta };
    }

    cueAt(timeSeconds) {
      const t = Number(timeSeconds || 0);
      let lo = 0;
      let hi = this.cues.length - 1;
      let best = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (this.cues[mid].start <= t) {
          best = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (best >= 0 && t < this.cues[best].end) {
        return { cue: this.cues[best], index: best };
      }
      return { cue: null, index: -1 };
    }

    speakCue(cue, options = {}) {
      if (!cue?.translated) return Promise.resolve(false);
      return window.LumeoTTS.speak(cue.translated, options.targetLanguage || DEFAULT_TARGET_LANGUAGE, options);
    }

    exportZip(title = "video") {
      const blob = window.LumeoSrtExport.makeSubtitleZip(this.cues, title);
      const safeTitle = window.LumeoSrtExport.sanitizeFilename(title);
      window.LumeoSrtExport.downloadBlob(blob, `${safeTitle}_lumeo_subtitles.zip`);
    }
  }

  window.LumeoCaptionPipeline = {
    __loaded: true,
    CaptionPipeline,
    create: () => new CaptionPipeline(),
  };
})();
