(() => {
  "use strict";

  if (window.LumeoTranslationBundle?.__loaded) return;

  const BUNDLE_VERSION = 1;
  const KIND = "lumeo.translationBundle";
  const CACHE_VERSION = 2;

  function cleanString(value, fallback = "") {
    return String(value ?? fallback).trim();
  }

  function cacheKey(videoId, targetLanguage, provider, sourceLanguage) {
    return [videoId, targetLanguage, provider, sourceLanguage || "auto"].join("::");
  }

  function normalizeCue(cue) {
    const start = Number(cue?.start ?? 0);
    const end = Number(cue?.end ?? cue?.start ?? 0);
    return {
      start: Number.isFinite(start) ? start : 0,
      end: Number.isFinite(end) ? end : 0,
      text: cleanString(cue?.text),
      translated: cleanString(cue?.translated ?? cue?.target),
    };
  }

  function normalizeCues(cues) {
    if (!Array.isArray(cues)) return [];
    return cues
      .map(normalizeCue)
      .filter((cue) => cue.text || cue.translated);
  }

  function createBundle(entry, fallback = {}) {
    const meta = entry?.meta || {};
    const videoId = cleanString(meta.videoId || fallback.videoId);
    const targetLanguage = cleanString(meta.targetLanguage || fallback.targetLanguage);
    const provider = cleanString(meta.provider || fallback.provider || "google-free");
    const sourceLanguage = cleanString(meta.sourceLanguage || fallback.sourceLanguage || "auto") || "auto";
    const cues = normalizeCues(entry?.cues);
    if (!videoId) throw new Error("Translation bundle needs a videoId.");
    if (!targetLanguage) throw new Error("Translation bundle needs a target language.");
    if (!cues.length) throw new Error("No translated cues found for this video/language.");
    return {
      kind: KIND,
      version: BUNDLE_VERSION,
      exportedAt: new Date().toISOString(),
      videoId,
      targetLanguage,
      provider,
      sourceLanguage,
      meta: {
        title: cleanString(fallback.title || meta.title),
        sourceLanguage,
        targetLanguage,
        provider,
        progress: meta.progress || { completed: cues.filter((cue) => cue.translated).length, total: cues.length },
      },
      cues,
    };
  }

  function parseBundle(input) {
    const bundle = typeof input === "string" ? JSON.parse(input) : input;
    if (bundle?.kind !== KIND) throw new Error("Not a Lumeo translation bundle.");
    if (bundle.version !== BUNDLE_VERSION) throw new Error("Unsupported translation bundle version.");
    const cues = normalizeCues(bundle.cues);
    const videoId = cleanString(bundle.videoId);
    const targetLanguage = cleanString(bundle.targetLanguage);
    const provider = cleanString(bundle.provider || bundle.meta?.provider || "google-free");
    const sourceLanguage = cleanString(bundle.sourceLanguage || bundle.meta?.sourceLanguage || "auto") || "auto";
    if (!videoId) throw new Error("Bundle is missing videoId.");
    if (!targetLanguage) throw new Error("Bundle is missing targetLanguage.");
    if (!cues.length) throw new Error("Bundle has no cues.");
    return {
      key: cacheKey(videoId, targetLanguage, provider, sourceLanguage),
      entry: {
        version: CACHE_VERSION,
        updatedAt: Date.now(),
        cues,
        meta: {
          ...(bundle.meta || {}),
          videoId,
          targetLanguage,
          provider,
          sourceLanguage,
          cached: true,
          progress: { completed: cues.filter((cue) => cue.translated).length, total: cues.length },
          resume: cues.some((cue) => !cue.translated),
        },
      },
      bundle: { ...bundle, videoId, targetLanguage, provider, sourceLanguage, cues },
    };
  }

  function filenameForBundle(bundle) {
    const title = cleanString(bundle?.meta?.title || bundle?.videoId || "lumeo-translation");
    const safe = window.LumeoSrtExport?.sanitizeFilename
      ? window.LumeoSrtExport.sanitizeFilename(title, "lumeo-translation")
      : title.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 120) || "lumeo-translation";
    return `${safe}_${bundle.targetLanguage || "target"}_lumeo_bundle.json`;
  }

  window.LumeoTranslationBundle = {
    __loaded: true,
    BUNDLE_VERSION,
    KIND,
    cacheKey,
    createBundle,
    parseBundle,
    filenameForBundle,
  };
})();
