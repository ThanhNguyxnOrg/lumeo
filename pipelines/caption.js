(() => {
  "use strict";

  if (window.LumeoCaptionPipeline?.__loaded) return;

  const DEFAULT_TRANSLATE_PROVIDER = "google-free";
  const DEFAULT_TARGET_LANGUAGE = "vi";
  const CACHE_LIMIT = 50;
  // Bumped to 3: v2 entries may hold rate-limit fallback lines stored as
  // successful translations. Those must be retranslated, never trusted.
  const CACHE_VERSION = 3;
  const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  // 5 MB soft cap — each cached video's translated cues average ~40 KB, so
  // 50 videos ≈ 2 MB. Cap is defense against edge cases: 3-hour podcasts,
  // users who flip languages several times in a session, etc.
  const CACHE_MAX_BYTES = 5 * 1024 * 1024;

  function now() {
    return Date.now();
  }

  function cacheKey(videoId, targetLanguage, provider, sourceLanguage, secondaryLanguage) {
    const normSource = !sourceLanguage || sourceLanguage === "transcript" ? "auto" : sourceLanguage;
    const base = [videoId, targetLanguage, provider, normSource].join("::");
    if (secondaryLanguage && secondaryLanguage !== "original" && secondaryLanguage !== normSource) {
      return `${base}::${secondaryLanguage}`;
    }
    return base;
  }

  async function readCache() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "captionCacheGet" }, (reply) => {
        resolve(reply?.ok ? reply.cache : { entries: {} });
      });
    });
  }

  async function writeCache(cache) {
    // Sort newest-first, then drop entries that exceed either the count cap
    // or the byte budget. JSON.stringify length is a coarse but zero-dep
    // proxy for storage footprint; chrome.storage.local has a 10 MB default
    // so 5 MB leaves headroom for settings + the legacy caption cache.
    const sorted = Object.entries(cache.entries || {}).sort(
      (a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0),
    );
    const keptEntries = [];
    let totalBytes = 0;
    const cutoff = now() - CACHE_TTL_MS;
    for (const entry of sorted) {
      if (keptEntries.length >= CACHE_LIMIT) break;
      const value = entry[1] || {};
      if (value.version !== CACHE_VERSION || (value.updatedAt || 0) < cutoff) continue;
      const size = safeSize(value);
      if (totalBytes + size > CACHE_MAX_BYTES && keptEntries.length > 0) break;
      keptEntries.push(entry);
      totalBytes += size;
    }
    const nextCache = {
      entries: Object.fromEntries(keptEntries),
      version: CACHE_VERSION,
      stats: { bytes: totalBytes, count: keptEntries.length, updatedAt: now(), ttlMs: CACHE_TTL_MS },
    };
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "captionCacheSet", cache: nextCache }, () => resolve());
    });
  }

  function safeSize(value) {
    try {
      return JSON.stringify(value).length;
    } catch {
      return 0;
    }
  }

  function isFreshCacheEntry(entry) {
    if (!entry?.cues?.length) return false;
    if (entry.version !== CACHE_VERSION) return false;
    if ((entry.updatedAt || 0) < now() - CACHE_TTL_MS) return false;
    return countTranslated(entry.cues) === entry.cues.length;
  }

  async function setCachedResult(key, value) {
    const cache = await readCache();
    cache.entries ||= {};
    cache.entries[key] = { ...value, version: CACHE_VERSION, updatedAt: now() };
    await writeCache(cache);
  }

  function countTranslated(cues = []) {
    // Fallback lines (rate-limited, showing source text) are NOT done — they
    // must be retranslated on retry, so they never count toward completion.
    return cues.filter((cue) => !cue?.__fallback && typeof cue?.translated === "string" && cue.translated.length > 0).length;
  }

  function mergeCachedCues(sourceCues, cachedCues = []) {
    return sourceCues.map((cue, index) => {
      const cached = cachedCues[index];
      if (cached?.__fallback) return { ...cue };
      const translated = cached?.translated;
      return typeof translated === "string" && translated.length > 0
        ? { ...cue, translated }
        : { ...cue };
    });
  }

  function isResumableCacheEntry(entry, total) {
    if (!entry?.cues?.length || entry.cues.length !== total) return false;
    if (entry.version !== CACHE_VERSION) return false;
    if ((entry.updatedAt || 0) < now() - CACHE_TTL_MS) return false;
    const completed = countTranslated(entry.cues);
    return completed > 0 && completed < total;
  }

  function progressMeta(meta, completed, total) {
    return { ...meta, progress: { completed, total }, resume: completed < total };
  }

  function withAbortError(signal) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  }

  function describeCaptionQuality(meta = {}) {
    if (!meta) return "Unknown captions";
    const tracks = Array.isArray(meta.tracks) ? meta.tracks : [];
    const sourceTrack = tracks.find((track) => track.languageCode === meta.sourceLanguage) || tracks[0];
    const source = meta.nativeTarget
      ? "YouTube native"
      : sourceTrack?.kind === "asr"
        ? "Auto captions"
        : meta.sourceLanguage
          ? "YouTube captions"
          : "Unknown captions";
    const mode = meta.cached
      ? "cached"
      : meta.nativeTarget
        ? "direct"
        : "translated";
    return `${source} · ${mode}`;
  }

  function explainCaptionFailure(diagnostics, targetLanguageName) {
    const reason = diagnostics?.reason;
    const tracks = diagnostics?.tracks || [];
    const tracksLabel = tracks.length
      ? tracks
          .slice(0, 6)
          .map((t) => `${t.languageCode}${t.kind === "asr" ? " auto" : ""}`)
          .join(", ")
      : "";
    if (reason === "no-tracks") {
      return "YouTube did not expose any caption tracks for this video. The channel likely disabled subtitles and auto-captions.";
    }
    if (reason === "no-target-language") {
      return tracksLabel
        ? `Found tracks (${tracksLabel}) but none in ${targetLanguageName}. Pick a language YouTube has, or use a fallback below.`
        : `No caption track matches ${targetLanguageName}.`;
    }
    if (reason === "timedtext-empty-body" || reason === "timedtext-fetch-failed") {
      return `YouTube captions are temporarily unavailable${tracksLabel ? ` (tracks: ${tracksLabel})` : ""}. Open the YouTube CC button once, then Retry; if captions still fail, choose a fallback below.`;
    }
    if (reason === "timedtext-unparsable") {
      return "YouTube captions downloaded but could not be read. Retry, or choose a fallback below.";
    }
    if (reason === "no-video-id") {
      return "Open a /watch?v= page to use Caption Free.";
    }
    return "Could not load YouTube captions for this video.";
  }

  const SENTENCE_END_RE = /[.?!。！？]\s*$/;

  function findBatchEndIndex(cues, startIndex, targetBatchSize = 40, maxLookahead = 10) {
    const minEnd = Math.min(cues.length, startIndex + Math.max(15, targetBatchSize - 10));
    const preferredEnd = Math.min(cues.length, startIndex + targetBatchSize);
    const maxEnd = Math.min(cues.length, startIndex + targetBatchSize + maxLookahead);

    if (preferredEnd >= cues.length) return cues.length;

    for (let i = preferredEnd; i < maxEnd; i++) {
      if (SENTENCE_END_RE.test(String(cues[i]?.text || "").trim())) {
        return i + 1;
      }
    }
    for (let i = preferredEnd - 1; i >= minEnd; i--) {
      if (SENTENCE_END_RE.test(String(cues[i]?.text || "").trim())) {
        return i + 1;
      }
    }
    return preferredEnd;
  }

  function findInitialSlidingWindowLimit(cues, currentTime, lookaheadSeconds = 180, minCues = 25) {
    const targetTime = currentTime + lookaheadSeconds;
    let limit = 0;
    while (limit < cues.length) {
      if (cues[limit].start > targetTime && limit >= minCues) {
        break;
      }
      limit += 1;
    }
    return Math.max(Math.min(minCues, cues.length), limit);
  }

  class CaptionPipeline {
    constructor() {
      this.token = 0;
      this.abortController = null;
      this.cues = [];
      this.meta = null;
      this.activeProvider = null;
      this.targetLanguage = null;
      this.key = null;
      this.subtitles = null;
      this.options = {};
      this.isTranslatingAhead = false;
      this.isPaidProvider = false;
      this.lastFallbackRetryAt = 0;
    }

    stop() {
      this.token += 1;
      this.abortController?.abort();
      this.abortController = null;
      this.isTranslatingAhead = false;
      this.lastFallbackRetryAt = 0;
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
      const diagnostics = {};
      const subtitles = await window.LumeoCaptions.fetchSubtitles({
        targetLanguage,
        videoId: options.videoId,
        diagnostics,
      });
      withAbortError(signal);
      if (token !== this.token) return { ok: false, error: "stale" };
      if (!subtitles?.cues?.length) {
        return {
          ok: false,
          error: explainCaptionFailure(diagnostics, options.targetLanguageName || targetLanguage),
          diagnostics,
        };
      }

      const key = cacheKey(subtitles.videoId, targetLanguage, provider, subtitles.sourceLanguage, options.secondaryLanguage);
      const cache = await readCache();
      const cached = cache.entries?.[key] || null;
      if (isFreshCacheEntry(cached)) {
        options.onProgress?.({ phase: "cached", completed: cached.cues.length, total: cached.cues.length });
        this.cues = cached.cues;
        this.meta = { ...subtitles, cached: true, provider };
        return { ok: true, cues: this.cues, meta: this.meta };
      }

      let cues = subtitles.cues;
      let activeProvider = provider;
      const isPaidProvider = activeProvider !== "google-free";
      this.isPaidProvider = isPaidProvider;
      this.activeProvider = activeProvider;
      this.targetLanguage = targetLanguage;
      this.key = key;
      this.subtitles = subtitles;
      this.options = options;

      if (!subtitles.nativeTarget) {
        const total = cues.length;
        const resumable = isResumableCacheEntry(cached, total);
        cues = resumable ? mergeCachedCues(cues, cached.cues) : cues;
        let completed = resumable ? countTranslated(cues) : 0;
        options.onProgress?.({ phase: resumable ? "resuming" : "translating", completed, total });
        const batchSize = Math.max(1, Number(options.batchSize || (isPaidProvider ? 20 : 40)));

        const currentTime = Number(options.currentTime || 0);
        const maxInitialCues = (!options.eagerTranslateAll && total > 35)
          ? findInitialSlidingWindowLimit(cues, currentTime, 180, 25)
          : total;

        let start = 0;
        let totalFailed = 0;
        while (start < maxInitialCues) {
          const nextEnd = Math.min(maxInitialCues, findBatchEndIndex(cues, start, batchSize));
          const batchIndexes = [];
          const sourceTexts = [];
          for (let index = start; index < nextEnd; index += 1) {
            // Fallback lines (showing source text after a rate limit) re-enter
            // the batch so retry translates them for real.
            if (cues[index]?.translated && !cues[index]?.__fallback) continue;
            batchIndexes.push(index);
            sourceTexts.push(cues[index].text);
          }
          start = nextEnd;
          if (!sourceTexts.length) continue;

          let translated;
          const baseCompleted = completed;
          const batchFailed = new Set();
          const batchOptions = {
            ...options,
            provider: activeProvider,
            signal,
            targetLanguageName: options.targetLanguageName || targetLanguage,
            // Incremental progress so the overlay never freezes at 0/N while
            // a 40-cue google-free batch works through its request queue.
            onItemDone: (done) => {
              options.onProgress?.({ phase: "translating", completed: baseCompleted + done, total });
            },
            // Collect failed item indexes (relative to sourceTexts); the
            // aggregate partial toast fires once after the loop below.
            onPartialFailure: ({ indexes }) => {
              for (const i of (indexes || [])) batchFailed.add(i);
            },
          };
          try {
            translated = await window.LumeoTranslate.translateBatch(
              sourceTexts,
              targetLanguage,
              batchOptions,
            );
          } catch (batchErr) {
            if (activeProvider !== "google-free" && !signal.aborted) {
              console.warn(`[CaptionPipeline] ${activeProvider} failed, falling back to google-free:`, batchErr);
              options.onFailover?.({ from: activeProvider, to: "google-free", error: batchErr?.message || String(batchErr) });
              activeProvider = "google-free";
              this.activeProvider = "google-free";
              this.isPaidProvider = false;
              translated = await window.LumeoTranslate.translateBatch(
                sourceTexts,
                targetLanguage,
                {
                  ...batchOptions,
                  provider: "google-free",
                },
              );
            } else {
              throw batchErr;
            }
          }

          withAbortError(signal);
          if (token !== this.token) return { ok: false, error: "stale" };

          let secTranslated = null;
          if (options.secondaryLanguage && options.secondaryLanguage !== "original" && options.secondaryLanguage !== subtitles.sourceLanguage) {
            try {
              // Secondary translation is best-effort: strip the primary
              // progress/partial callbacks so its counts never leak into the
              // primary progress bar or partial-limit toast.
              secTranslated = await window.LumeoTranslate.translateBatch(
                sourceTexts,
                options.secondaryLanguage,
                {
                  ...options,
                  provider: activeProvider,
                  signal,
                  targetLanguageName: options.secondaryLanguage,
                  onItemDone: undefined,
                  onPartialFailure: undefined,
                },
              );
            } catch (e) {
              console.warn("[CaptionPipeline] Secondary translation error:", e);
            }
          }

          cues = cues.map((cue, index) => {
            const translatedIndex = batchIndexes.indexOf(index);
            if (translatedIndex >= 0) {
              const updated = { ...cue, translated: translated[translatedIndex] || cue.text };
              if (batchFailed.has(translatedIndex)) {
                updated.__fallback = true;
              } else {
                delete updated.__fallback;
              }
              if (secTranslated && secTranslated[translatedIndex]) {
                updated.secondaryTranslated = secTranslated[translatedIndex];
              }
              return updated;
            }
            return cue;
          });
          totalFailed += batchFailed.size;
          completed = countTranslated(cues);
          await setCachedResult(key, {
            cues,
            meta: progressMeta({ ...subtitles, provider: activeProvider, cached: false }, completed, total),
          });
          options.onProgress?.({ phase: completed === total ? "translated" : "translating", completed, total });
        }

        if (totalFailed > 0) {
          try { options.onPartialFailure?.({ failed: totalFailed, total }); } catch {}
          // Start the cooldown clock: upcoming fallback lines self-heal via
          // the background lookahead; already-played ones need manual retry.
          this.lastFallbackRetryAt = now();
        }
      }

      if (subtitles.nativeTarget) {
        options.onProgress?.({ phase: "native", completed: cues.length, total: cues.length });
      }
      this.cues = cues;
      const completedCues = countTranslated(cues);
      this.meta = {
        ...subtitles,
        provider: activeProvider,
        cached: false,
        progress: { completed: completedCues, total: cues.length },
        resume: completedCues < cues.length,
      };
      await setCachedResult(key, { cues, meta: this.meta });
      return { ok: true, cues, meta: this.meta };
    }

    async checkAndTranslateAhead(currentTime) {
      if (this.isTranslatingAhead || !this.abortController) return;
      const lookahead = currentTime + 120;
      const needsTranslation = this.cues.findIndex(
        (cue) => cue.start >= currentTime && cue.start <= lookahead && (!cue.translated || cue.__fallback),
      );
      if (needsTranslation === -1) return;

      this.isTranslatingAhead = true;
      const signal = this.abortController.signal;
      const token = this.token;
      const targetLanguage = this.targetLanguage || DEFAULT_TARGET_LANGUAGE;
      let activeProvider = this.activeProvider || DEFAULT_TRANSLATE_PROVIDER;
      const batchSize = Math.max(1, Number(this.options.batchSize || 20));
      // Skip check mirrors start(): fallback lines re-enter so a later retry
      // translates them instead of trusting the cached source text.
      const skipTranslated = (cue) => cue?.translated && !cue?.__fallback;

      try {
        const nextEnd = Math.min(this.cues.length, findBatchEndIndex(this.cues, needsTranslation, batchSize));
        const batchIndexes = [];
        const sourceTexts = [];
        for (let i = needsTranslation; i < nextEnd; i++) {
          if (!skipTranslated(this.cues[i])) {
            batchIndexes.push(i);
            sourceTexts.push(this.cues[i].text);
          }
        }
      if (!sourceTexts.length) {
          this.isTranslatingAhead = false;
          return;
        }

        // Fallback-only batches (rate-limited lines showing source text) are
        // auto-retried at most once per minute so a persistent throttle is
        // healed without hammering it every tick; batches containing genuinely
        // untranslated cues always proceed immediately.
        if (batchIndexes.every((i) => this.cues[i]?.translated)) {
          if (now() - (this.lastFallbackRetryAt || 0) < 60000) {
            this.isTranslatingAhead = false;
            return;
          }
          this.lastFallbackRetryAt = now();
        }

        let translated;
        const aheadFailed = new Set();
        const aheadOptions = {
          ...this.options,
          provider: activeProvider,
          signal,
          targetLanguageName: this.options.targetLanguageName || targetLanguage,
          // Collect only — no progress/toast here (background lookahead);
          // flags below keep these lines retryable like the main loop.
          onItemDone: undefined,
          onPartialFailure: ({ indexes }) => {
            for (const i of (indexes || [])) aheadFailed.add(i);
          },
        };
        try {
          translated = await window.LumeoTranslate.translateBatch(
            sourceTexts,
            targetLanguage,
            aheadOptions,
          );
        } catch (batchErr) {
          if (activeProvider !== "google-free" && !signal.aborted) {
            console.warn(`[CaptionPipeline] ${activeProvider} ahead failed, falling back to google-free:`, batchErr);
            this.options.onFailover?.({ from: activeProvider, to: "google-free", error: batchErr?.message || String(batchErr) });
            activeProvider = "google-free";
            this.activeProvider = "google-free";
            this.isPaidProvider = false;
            translated = await window.LumeoTranslate.translateBatch(
              sourceTexts,
              targetLanguage,
              {
                ...aheadOptions,
                provider: "google-free",
              },
            );
          } else {
            throw batchErr;
          }
        }

        withAbortError(signal);
        if (token !== this.token) return;

        let secTranslated = null;
        if (this.options.secondaryLanguage && this.options.secondaryLanguage !== "original" && this.options.secondaryLanguage !== this.subtitles?.sourceLanguage) {
          try {
            secTranslated = await window.LumeoTranslate.translateBatch(
              sourceTexts,
              this.options.secondaryLanguage,
              {
                ...this.options,
                provider: activeProvider,
                signal,
                targetLanguageName: this.options.secondaryLanguage,
                onItemDone: undefined,
                onPartialFailure: undefined,
              },
            );
          } catch (e) {
            console.warn("[CaptionPipeline] Secondary lookahead translation error:", e);
          }
        }

        withAbortError(signal);
        if (token !== this.token) return;

        this.cues = this.cues.map((cue, index) => {
          const matchIdx = batchIndexes.indexOf(index);
          if (matchIdx >= 0) {
            const updated = { ...cue, translated: translated[matchIdx] || cue.text };
            if (aheadFailed.has(matchIdx)) {
              updated.__fallback = true;
            } else {
              delete updated.__fallback;
            }
            if (secTranslated && secTranslated[matchIdx]) {
              updated.secondaryTranslated = secTranslated[matchIdx];
            }
            return updated;
          }
          return cue;
        });

        const completed = countTranslated(this.cues);
        const total = this.cues.length;
        if (this.key && this.subtitles) {
          await setCachedResult(this.key, {
            cues: this.cues,
            meta: progressMeta({ ...this.subtitles, provider: activeProvider, cached: false }, completed, total),
          });
        }
        this.options.onProgress?.({ phase: completed === total ? "translated" : "translating", completed, total });
      } catch (err) {
        if (!signal.aborted) {
          console.warn("[CaptionPipeline] Error in checkAndTranslateAhead:", err);
        }
      } finally {
        this.isTranslatingAhead = false;
      }
    }

    cueAt(timeSeconds) {
      const t = Number(timeSeconds || 0);
      if (!this.isTranslatingAhead && this.abortController) {
        this.checkAndTranslateAhead(t);
      }
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
      if (best >= 0) {
        const cue = this.cues[best];
        const nextStart = this.cues[best + 1] ? this.cues[best + 1].start : Infinity;
        const effectiveEnd = Math.min(nextStart, Math.max(cue.end, cue.start + 1.0));
        if (t < effectiveEnd) {
          return { cue, index: best };
        }
      }
      return { cue: null, index: -1 };
    }

    speakCue(cue, options = {}) {
      if (!cue?.translated) return Promise.resolve(false);
      return window.LumeoTTS.speak(
        cue.translated,
        options.targetLanguage || DEFAULT_TARGET_LANGUAGE,
        { ...options, volume: options.volume ?? 1 },
      );
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
    CACHE_VERSION,
    CACHE_TTL_MS,
    describeCaptionQuality,
    create: () => new CaptionPipeline(),
  };
})();
