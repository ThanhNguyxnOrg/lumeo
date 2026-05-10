(() => {
  "use strict";

  if (window.LumeoTranslate?.__loaded) return;

  const DEFAULT_BATCH_SIZE = 40;
  const DEFAULT_TIMEOUT_MS = 30_000;

  const PROVIDERS = Object.freeze({
    GOOGLE_FREE: "google-free",
    GOOGLE_CLOUD: "google-cloud",
    OPENAI: "openai",
    GEMINI: "gemini",
    OPENROUTER: "openrouter",
    GROQ: "groq",
    LIBRETRANSLATE: "libretranslate",
  });

  const providerLabels = Object.freeze({
    [PROVIDERS.GOOGLE_FREE]: "Google Translate",
    [PROVIDERS.GOOGLE_CLOUD]: "Google Cloud Translation",
    [PROVIDERS.OPENAI]: "OpenAI",
    [PROVIDERS.GEMINI]: "Gemini",
    [PROVIDERS.OPENROUTER]: "OpenRouter",
    [PROVIDERS.GROQ]: "Groq",
    [PROVIDERS.LIBRETRANSLATE]: "LibreTranslate",
  });

  function labelFor(provider) {
    return providerLabels[provider] || provider;
  }

  function normalizeProvider(provider) {
    return Object.values(PROVIDERS).includes(provider)
      ? provider
      : PROVIDERS.GOOGLE_FREE;
  }

  function assertKey(value, providerName) {
    const key = String(value || "").trim();
    if (!key) throw new Error(`${providerName} API key is missing.`);
    return key;
  }

  function normalizeTexts(texts) {
    if (Array.isArray(texts)) {
      return texts.map((text) => String(text ?? ""));
    }
    return [String(texts ?? "")];
  }

  function chunk(items, size = DEFAULT_BATCH_SIZE) {
    const out = [];
    for (let i = 0; i < items.length; i += size) {
      out.push(items.slice(i, i + size));
    }
    return out;
  }

  function stripNumberedPrefix(line) {
    return String(line || "").replace(/^\[?\d+\]?[.)\s-]*/, "").trim();
  }

  function parseIndexedLines(raw, count, fallbackTexts) {
    const map = new Map();
    let current = -1;
    for (const line of String(raw || "").split(/\r?\n/)) {
      const match = line.match(/^\s*\[(\d+)]\s*(.*)$/);
      if (match) {
        current = Number(match[1]);
        map.set(current, match[2].trim());
      } else if (current >= 0 && line.trim()) {
        map.set(current, `${map.get(current) || ""} ${line.trim()}`.trim());
      }
    }
    if (map.size >= Math.ceil(count * 0.6)) {
      return Array.from({ length: count }, (_, i) => map.get(i) || fallbackTexts[i] || "");
    }
    const lines = String(raw || "")
      .split(/\r?\n/)
      .map(stripNumberedPrefix)
      .filter(Boolean);
    return Array.from({ length: count }, (_, i) => lines[i] || fallbackTexts[i] || "");
  }

  async function requestJSON(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        ...options,
        signal: options.signal || controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error?.message || data?.error || `HTTP ${response.status}`);
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async function translateGoogleFree(texts, targetLanguage) {
    const results = [];
    for (const text of texts) {
      if (!text.trim()) {
        results.push("");
        continue;
      }
      const url =
        "https://translate.googleapis.com/translate_a/single" +
        `?client=gtx&sl=auto&tl=${encodeURIComponent(targetLanguage)}` +
        `&dt=t&q=${encodeURIComponent(text)}`;
      try {
        const data = await requestJSON(url);
        const translated = Array.isArray(data?.[0])
          ? data[0].map((part) => part?.[0] || "").join("").trim()
          : "";
        results.push(translated || text);
      } catch {
        results.push(text);
      }
    }
    return results;
  }

  async function translateGoogleCloud(texts, targetLanguage, options) {
    const key = assertKey(options.googleCloudKey || options.apiKey, "Google Cloud");
    const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`;
    const data = await requestJSON(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        q: texts,
        target: targetLanguage,
        format: "text",
      }),
      signal: options.signal,
    });
    const translations = data?.data?.translations || [];
    return texts.map((text, i) => translations[i]?.translatedText || text);
  }

  async function translateLibreTranslate(texts, targetLanguage, options) {
    const baseUrl = String(options.libreTranslateUrl || "").trim().replace(/\/+$/, "");
    if (!baseUrl) throw new Error("LibreTranslate URL is missing.");
    const endpoint = `${baseUrl}/translate`;
    const key = String(options.libreTranslateKey || "").trim();
    const results = [];
    for (const text of texts) {
      if (!text.trim()) {
        results.push("");
        continue;
      }
      const data = await requestJSON(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          q: text,
          source: options.sourceLanguage || "auto",
          target: targetLanguage,
          format: "text",
          ...(key ? { api_key: key } : {}),
        }),
        signal: options.signal,
      });
      results.push(data?.translatedText || text);
    }
    return results;
  }

  function buildIndexedPrompt(texts, targetLanguageName, context = "") {
    const input = texts.map((text, i) => `[${i}] ${text.replace(/\s+/g, " ").trim()}`).join("\n");
    const system = [
      "You are a precise subtitle translator.",
      `Translate each numbered line into ${targetLanguageName}.`,
      "Rules:",
      "- Preserve the [number] prefix exactly.",
      "- Output one translated line per input line.",
      "- Do not merge, skip, explain, label, quote, or add commentary.",
      "- Preserve names, brand names, code, units, and technical terms unless they have a common target-language form.",
      context ? `Context: ${context}` : "",
    ].filter(Boolean).join("\n");
    return { system, input };
  }

  async function translateChatCompletions(texts, targetLanguage, options) {
    const provider = normalizeProvider(options.provider);
    const isOpenRouter = provider === PROVIDERS.OPENROUTER;
    const isGroq = provider === PROVIDERS.GROQ;
    const key = assertKey(
      isOpenRouter
        ? options.openRouterKey || options.apiKey
        : isGroq
          ? options.groqApiKey || options.apiKey
          : options.openaiKey || options.apiKey,
      isOpenRouter ? "OpenRouter" : isGroq ? "Groq" : "OpenAI",
    );
    const model = isOpenRouter
      ? options.openRouterModel || "openrouter/free"
      : isGroq
        ? options.groqModel || "llama-3.3-70b-versatile"
        : options.openaiModel || "gpt-4o-mini";
    const url = isOpenRouter
      ? "https://openrouter.ai/api/v1/chat/completions"
      : isGroq
        ? "https://api.groq.com/openai/v1/chat/completions"
        : "https://api.openai.com/v1/chat/completions";
    const { system, input } = buildIndexedPrompt(
      texts,
      options.targetLanguageName || targetLanguage,
      options.context || "",
    );
    const data = await requestJSON(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        ...(isOpenRouter ? {
          "HTTP-Referer": "https://github.com/ThanhNguyxnOrg/lumeo",
          "X-Title": "Lumeo",
        } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: input },
        ],
        temperature: 0.2,
      }),
      signal: options.signal,
    });
    const raw = data?.choices?.[0]?.message?.content || "";
    return parseIndexedLines(raw, texts.length, texts);
  }

  async function translateGemini(texts, targetLanguage, options) {
    const key = assertKey(options.geminiKey || options.apiKey, "Gemini");
    const model = options.geminiModel || "gemini-2.5-flash-lite";
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}` +
      `:generateContent?key=${encodeURIComponent(key)}`;
    const { system, input } = buildIndexedPrompt(
      texts,
      options.targetLanguageName || targetLanguage,
      options.context || "",
    );
    const data = await requestJSON(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `${system}\n\n${input}` }] }],
        generationConfig: { temperature: 0.2 },
      }),
      signal: options.signal,
    });
    const raw = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
    return parseIndexedLines(raw, texts.length, texts);
  }

  async function translateBatch(textsInput, targetLanguage, options = {}) {
    const provider = normalizeProvider(options.provider);
    const texts = normalizeTexts(textsInput);
    const outputs = [];
    const batchSize = options.batchSize || DEFAULT_BATCH_SIZE;
    for (const group of chunk(texts, batchSize)) {
      if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      let translated;
      switch (provider) {
        case PROVIDERS.GOOGLE_CLOUD:
          translated = await translateGoogleCloud(group, targetLanguage, options);
          break;
        case PROVIDERS.OPENAI:
        case PROVIDERS.OPENROUTER:
        case PROVIDERS.GROQ:
          translated = await translateChatCompletions(group, targetLanguage, { ...options, provider });
          break;
        case PROVIDERS.GEMINI:
          translated = await translateGemini(group, targetLanguage, options);
          break;
        case PROVIDERS.LIBRETRANSLATE:
          translated = await translateLibreTranslate(group, targetLanguage, options);
          break;
        case PROVIDERS.GOOGLE_FREE:
        default:
          translated = await translateGoogleFree(group, targetLanguage, options);
          break;
      }
      outputs.push(...translated);
    }
    return outputs;
  }

  window.LumeoTranslate = {
    __loaded: true,
    PROVIDERS,
    labelFor,
    translateBatch,
  };
})();
