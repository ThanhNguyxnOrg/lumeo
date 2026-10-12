(() => {
  "use strict";

  if (globalThis.LumeoTranslate?.__loaded) return;

  const DEFAULT_BATCH_SIZE = 40;
  const DEFAULT_TIMEOUT_MS = 30_000;

  const PROVIDERS = Object.freeze({
    GOOGLE_FREE: "google-free",
    GOOGLE_CLOUD: "google-cloud",
    OPENAI: "openai",
    GEMINI: "gemini",
    OPENROUTER: "openrouter",
    CUSTOM_GATEWAY: "custom-gateway",
    GROQ: "groq",
    LIBRETRANSLATE: "libretranslate",
  });

  const providerLabels = Object.freeze({
    [PROVIDERS.GOOGLE_FREE]: "Google Translate",
    [PROVIDERS.GOOGLE_CLOUD]: "Google Cloud Translation",
    [PROVIDERS.OPENAI]: "OpenAI",
    [PROVIDERS.GEMINI]: "Gemini",
    [PROVIDERS.OPENROUTER]: "OpenRouter",
    [PROVIDERS.CUSTOM_GATEWAY]: "Custom AI Gateway",
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
    // Link the caller signal when AbortSignal.any is unavailable so the
    // internal timeout still applies (MV3 Chrome always has .any; defensive).
    if (typeof AbortSignal.any !== "function" && options.signal && typeof options.signal.addEventListener === "function") {
      options.signal.addEventListener("abort", () => {
        try { controller.abort(); } catch {}
      }, { once: true });
    }
    const signal = typeof AbortSignal.any === "function" && options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : (options.signal || controller.signal);
    try {
      const response = await fetch(url, {
        ...options,
        signal,
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

  async function mapConcurrent(items, concurrency, fn) {
    const results = new Array(items.length);
    let index = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (index < items.length) {
        const i = index++;
        results[i] = await fn(items[i], i);
      }
    });
    await Promise.all(workers);
    return results;
  }

  function isRetryableTranslateError(err, signal) {
    if (signal?.aborted) return false;
    // Internal per-request timeouts surface as AbortError (user stops surface
    // via signal.aborted above); both 429/5xx and network failures are worth one retry.
    if (err?.name === "AbortError") return true;
    return /429|HTTP 5\d\d|Failed to fetch|NetworkError|Load failed|Network request failed/i.test(err?.message || String(err));
  }

  function translateDelay(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener?.("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      };
      if (typeof signal?.addEventListener === "function") {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  // Backoff for an already-throttled endpoint: start at 1.5s with jitter so
  // a full batch retrying at once does not deepen the throttle in lockstep.
  function translateBackoffMs(attempt) {
    return 1500 * 2 ** attempt + Math.floor(Math.random() * 500);
  }

  async function translateGoogleFree(texts, targetLanguage, options = {}) {
    const cache = new Map();
    const total = texts.length;
    let done = 0;
    let failed = 0;
    const failedIndexes = [];
    const report = () => {
      try { options.onItemDone?.(done, total); } catch {}
    };
    // Concurrency 3 (not 5): the unofficial gtx endpoint throttles bursty
    // parallel hits, and a throttle here used to stall the whole batch.
    const out = await mapConcurrent(texts, 3, async (text, itemIndex) => {
      if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const trimmed = String(text ?? "").trim();
      if (!trimmed) {
        done += 1;
        report();
        return "";
      }
      if (cache.has(trimmed)) {
        done += 1;
        report();
        return cache.get(trimmed);
      }
      const url =
        "https://translate.googleapis.com/translate_a/single" +
        `?client=gtx&sl=auto&tl=${encodeURIComponent(targetLanguage)}` +
        `&dt=t&q=${encodeURIComponent(trimmed)}`;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        try {
          // Explicit per-request timeout: a hung request must surface as a
          // retryable failure, never park a worker slot for the 30s default.
          const data = await requestJSON(url, { signal: options.signal, timeoutMs: options.translateTimeoutMs || 12000 });
          const translated = Array.isArray(data?.[0])
            ? data[0].map((part) => part?.[0] || "").join("").trim()
            : "";
          const result = translated || text;
          if (translated) cache.set(trimmed, result);
          done += 1;
          report();
          return result;
        } catch (err) {
          if (options.signal?.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }
          if (attempt < 2 && isRetryableTranslateError(err, options.signal)) {
            try {
              await translateDelay(translateBackoffMs(attempt), options.signal);
            } catch (abortErr) {
              throw abortErr;
            }
            continue;
          }
          // Per-item fallback: one rate-limited cue must not kill the batch.
          // The item index is reported so callers can flag it for retry
          // instead of caching it as a successful translation.
          failed += 1;
          failedIndexes.push(itemIndex);
          done += 1;
          report();
          return text;
        }
      }
      failed += 1;
      failedIndexes.push(itemIndex);
      done += 1;
      report();
      return text;
    });
    if (failed > 0) {
      try { options.onPartialFailure?.({ failed, total, indexes: failedIndexes }); } catch {}
    }
    return out;
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
    const isCustomGateway = provider === PROVIDERS.CUSTOM_GATEWAY;
    const isGroq = provider === PROVIDERS.GROQ;
    const key = isCustomGateway
      ? String(options.customProxyApiKey || options.apiKey || "").trim()
      : assertKey(
          isOpenRouter
            ? options.openRouterKey || options.apiKey
            : isGroq
              ? options.groqApiKey || options.apiKey
              : options.openaiKey || options.apiKey,
          isOpenRouter ? "OpenRouter" : isGroq ? "Groq" : "OpenAI",
        );
    const model = isCustomGateway
      ? options.customProxyModelId || "custom-model"
      : isOpenRouter
        ? options.openRouterModel || "openrouter/free"
        : isGroq
          ? options.groqModel || "llama-3.3-70b-versatile"
          : options.openaiModel || "gpt-4o-mini";
    let url;
    if (isCustomGateway) {
      const base = String(options.customProxyBaseUrl || "").trim().replace(/\/+$/, "");
      if (!base) throw new Error("Custom AI Gateway Base URL is required.");
      url = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
    } else if (isOpenRouter) {
      url = "https://openrouter.ai/api/v1/chat/completions";
    } else if (isGroq) {
      url = "https://api.groq.com/openai/v1/chat/completions";
    } else {
      url = "https://api.openai.com/v1/chat/completions";
    }
    const { system, input } = buildIndexedPrompt(
      texts,
      options.targetLanguageName || targetLanguage,
      options.context || "",
    );
    const data = await requestJSON(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        ...(isOpenRouter || isCustomGateway ? {
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
    // Incremental progress is google-free-only (single-request providers such
    // as chat-completions/Gemini resolve a whole group at once and ignore
    // these callbacks). Aggregate across internal groups so progress stays
    // monotonic and the partial toast fires once per call, not per group.
    let failedTotal = 0;
    const failedIndexes = [];
    const hasProgress = typeof options.onItemDone === "function";
    const hasPartial = typeof options.onPartialFailure === "function";
    for (const group of chunk(texts, batchSize)) {
      if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const offset = outputs.length;
      const groupOptions = (hasProgress || hasPartial) ? {
        ...options,
        onItemDone: hasProgress ? (done) => options.onItemDone(offset + done, texts.length) : undefined,
        onPartialFailure: hasPartial
          ? ({ failed, indexes }) => {
            failedTotal += failed;
            for (const i of (indexes || [])) failedIndexes.push(offset + i);
          }
          : undefined,
      } : options;
      let translated;
      switch (provider) {
        case PROVIDERS.GOOGLE_CLOUD:
          translated = await translateGoogleCloud(group, targetLanguage, groupOptions);
          break;
        case PROVIDERS.OPENAI:
        case PROVIDERS.OPENROUTER:
        case PROVIDERS.CUSTOM_GATEWAY:
        case PROVIDERS.GROQ:
          translated = await translateChatCompletions(group, targetLanguage, { ...groupOptions, provider });
          break;
        case PROVIDERS.GEMINI:
          translated = await translateGemini(group, targetLanguage, groupOptions);
          break;
        case PROVIDERS.LIBRETRANSLATE:
          translated = await translateLibreTranslate(group, targetLanguage, groupOptions);
          break;
        case PROVIDERS.GOOGLE_FREE:
        default:
          translated = await translateGoogleFree(group, targetLanguage, groupOptions);
          break;
      }
      outputs.push(...translated);
    }
    if (failedTotal > 0 && hasPartial) {
      try { options.onPartialFailure({ failed: failedTotal, total: texts.length, indexes: failedIndexes }); } catch {}
    }
    return outputs;
  }

  function parseExplanation(rawText) {
    const text = String(rawText || "").trim();
    const getField = (names) => {
      const re = new RegExp(`(?:^|\\n)[\\s-*•\\d.]*\\*{0,2}(?:${names})\\*{0,2}[:*\\s]+([^\\n]+)`, "i");
      const m = text.match(re);
      return m ? m[1].replace(/^[\s:*]+|[\s:*]+$/g, "").trim() : "";
    };
    const meaning = getField("Meaning|Nghĩa");
    const nuance = getField("Nuance|Sắc thái");
    const synonyms = getField("Synonyms|Từ đồng nghĩa");

    if (meaning) {
      return { meaning, nuance, synonyms, raw: text };
    }
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    return {
      meaning: lines[0] || text,
      nuance: lines[1] || "",
      synonyms: lines[2] || "",
      raw: text,
    };
  }

  async function explainWordInContext(word, sentence, targetLanguage = "en", options = {}) {
    const provider = normalizeProvider(options.provider || PROVIDERS.GOOGLE_FREE);
    const lang = options.targetLanguageName || targetLanguage;
    const cleanWord = String(word || "").trim();
    const cleanSentence = String(sentence || cleanWord).trim();
    if (!cleanWord) return { meaning: "", nuance: "", synonyms: "" };

    const hasSentence = cleanSentence && cleanSentence.toLowerCase() !== cleanWord.toLowerCase();
    const system = hasSentence
      ? "You are a concise language learning tutor. Explain the exact meaning of the word/phrase in the context of the given sentence. Keep definitions crisp and punchy."
      : "You are a concise language learning tutor. Explain the core definition, common nuances, and synonyms of the word/phrase. Keep definitions crisp and punchy.";
    const userPrompt = hasSentence
      ? `Word: "${cleanWord}"\nSentence: "${cleanSentence}"\nTarget Language: ${lang}\n\nRespond strictly in this format:\nMeaning: <precise meaning in this sentence in ${lang}>\nNuance: <brief note on tone or register in ${lang}>\nSynonyms: <1-3 synonyms in this context>`
      : `Word: "${cleanWord}"\nTarget Language: ${lang}\n\nRespond strictly in this format:\nMeaning: <precise definition in ${lang}>\nNuance: <brief note on tone, register, or usage in ${lang}>\nSynonyms: <1-3 common synonyms in ${lang}>`;

    if (provider === PROVIDERS.GEMINI) {
      const key = assertKey(options.geminiKey || options.apiKey, "Gemini");
      const model = options.geminiModel || "gemini-2.5-flash-lite";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
      const data = await requestJSON(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${system}\n\n${userPrompt}` }] }],
          generationConfig: { temperature: 0.2 },
        }),
        signal: options.signal,
      });
      const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      return parseExplanation(raw);
    }

    if ([PROVIDERS.OPENAI, PROVIDERS.GROQ, PROVIDERS.OPENROUTER, PROVIDERS.CUSTOM_GATEWAY].includes(provider)) {
      const isOpenRouter = provider === PROVIDERS.OPENROUTER;
      const isCustomGateway = provider === PROVIDERS.CUSTOM_GATEWAY;
      const isGroq = provider === PROVIDERS.GROQ;
      const key = isCustomGateway
        ? String(options.customProxyApiKey || options.apiKey || "").trim()
        : assertKey(
            isOpenRouter
              ? options.openRouterKey || options.apiKey
              : isGroq
                ? options.groqApiKey || options.apiKey
                : options.openaiKey || options.apiKey,
            isOpenRouter ? "OpenRouter" : isGroq ? "Groq" : "OpenAI",
          );
      const model = isCustomGateway
        ? options.customProxyModelId || "custom-model"
        : isOpenRouter
          ? options.openRouterModel || "openrouter/free"
          : isGroq
            ? options.groqModel || "llama-3.3-70b-versatile"
            : options.openaiModel || "gpt-4o-mini";
      let url;
      if (isCustomGateway) {
        const base = String(options.customProxyBaseUrl || "").trim().replace(/\/+$/, "");
        if (!base) throw new Error("Custom AI Gateway Base URL is required.");
        url = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
      } else if (isOpenRouter) {
        url = "https://openrouter.ai/api/v1/chat/completions";
      } else if (isGroq) {
        url = "https://api.groq.com/openai/v1/chat/completions";
      } else {
        url = "https://api.openai.com/v1/chat/completions";
      }

      const data = await requestJSON(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
          ...(isOpenRouter || isCustomGateway ? {
            "HTTP-Referer": "https://github.com/ThanhNguyxnOrg/lumeo",
            "X-Title": "Lumeo",
          } : {}),
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.2,
        }),
        signal: options.signal,
      });
      const raw = data?.choices?.[0]?.message?.content || "";
      return parseExplanation(raw);
    }

    // Fallback: Google Free Translate
    const textsToTranslate = cleanSentence !== cleanWord ? [cleanWord, cleanSentence] : [cleanWord];
    const trans = await translateGoogleFree(textsToTranslate, targetLanguage, options);
    return {
      meaning: trans[0] || cleanWord,
      nuance: trans[1] ? `Sentence: "${trans[1]}"` : "",
      synonyms: "",
      raw: trans[0] || "",
    };
  }

  async function summarizeTranscript(textOrCues, targetLanguage, options = {}) {
    let combinedText = "";
    if (Array.isArray(textOrCues)) {
      combinedText = textOrCues
        .map((c) => (c.translated || c.text || "").trim())
        .filter(Boolean)
        .join(" ");
    } else {
      combinedText = String(textOrCues || "").trim();
    }
    if (!combinedText) {
      throw new Error("No transcript content available to summarize.");
    }
    if (combinedText.length > 15000) {
      combinedText = combinedText.slice(0, 15000) + "...";
    }

    const provider = normalizeProvider(options.provider);
    if (provider === PROVIDERS.GOOGLE_FREE) {
      throw new Error("AI Video Summary requires an AI provider with an API key (Gemini, Groq, OpenAI, or Custom Gateway).");
    }

    const langName = options.targetLanguageName || targetLanguage || "English";
    const systemPrompt = `You are an expert video summarizer. Summarize the following video transcript clearly into 3-5 structured bullet points highlighting the main ideas and key takeaways. Output ONLY in ${langName}. Use clean markdown bullet points.`;
    const userPrompt = `Transcript:\n${combinedText}`;

    if (provider === PROVIDERS.GEMINI) {
      const key = assertKey(options.geminiKey || options.apiKey, "Gemini");
      const model = options.geminiModel || "gemini-2.5-flash-lite";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
      const data = await requestJSON(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
          generationConfig: { temperature: 0.3 },
        }),
        signal: options.signal,
      });
      const summary = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
      return { summary: summary.trim(), provider: "gemini" };
    }

    const isOpenRouter = provider === PROVIDERS.OPENROUTER;
    const isCustomGateway = provider === PROVIDERS.CUSTOM_GATEWAY;
    const isGroq = provider === PROVIDERS.GROQ;
    const key = assertKey(
      isCustomGateway
        ? options.customProxyApiKey || options.apiKey
        : isOpenRouter
          ? options.openRouterKey || options.apiKey
          : isGroq
            ? options.groqApiKey || options.apiKey
            : options.openaiKey || options.apiKey,
      isCustomGateway ? "Custom AI Gateway" : isOpenRouter ? "OpenRouter" : isGroq ? "Groq" : "OpenAI",
    );
    const model = isCustomGateway
      ? options.customProxyModelId || "openrouter/free"
      : isOpenRouter
        ? options.openRouterModel || "openrouter/free"
        : isGroq
          ? options.groqModel || "llama-3.3-70b-versatile"
          : options.openaiModel || "gpt-4o-mini";

    let url;
    if (isCustomGateway) {
      const base = String(options.customProxyBaseUrl || "").trim().replace(/\/+$/, "");
      if (!base) throw new Error("Custom AI Gateway Base URL is required.");
      url = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
    } else if (isOpenRouter) {
      url = "https://openrouter.ai/api/v1/chat/completions";
    } else if (isGroq) {
      url = "https://api.groq.com/openai/v1/chat/completions";
    } else {
      url = "https://api.openai.com/v1/chat/completions";
    }

    const data = await requestJSON(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        ...(isOpenRouter || isCustomGateway ? {
          "HTTP-Referer": "https://github.com/ThanhNguyxnOrg/lumeo",
          "X-Title": "Lumeo",
        } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
      }),
      signal: options.signal,
    });
    const summary = data?.choices?.[0]?.message?.content || "";
    return { summary: summary.trim(), provider };
  }

  const api = {
    __loaded: true,
    PROVIDERS,
    labelFor,
    translateBatch,
    explainWordInContext,
    parseExplanation,
    summarizeTranscript,
  };

  globalThis.LumeoTranslate = api;
  if (typeof window !== "undefined") {
    window.LumeoTranslate = api;
  }
})();
