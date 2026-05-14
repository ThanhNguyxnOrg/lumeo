(() => {
  "use strict";

  if (globalThis.LumeoTierRecommendation?.__loaded) return;

  function isLiveLike(tab = {}) {
    const text = `${tab.title || ""} ${tab.url || ""}`.toLowerCase();
    return /\blive\b|stream|premiere|podcast|webinar|conference|space\b/.test(text);
  }

  function recommendationFor(tab = {}, settings = {}) {
    const tier = settings.tier || "caption";
    if (tier === "realtime") {
      return isLiveLike(tab)
        ? "Recommended for live/podcast content where low latency matters."
        : "Use Realtime when latency matters more than cost.";
    }
    if (tier === "standard") {
      return "Recommended when captions are missing, low quality, or you prefer listening.";
    }
    if (settings.captionUnavailable) {
      return "Try Standard or an STT fallback because this video has no readable captions.";
    }
    return "Recommended first when YouTube captions exist: free, instant, and easiest to verify.";
  }

  globalThis.LumeoTierRecommendation = {
    __loaded: true,
    isLiveLike,
    recommendationFor,
  };
})();
