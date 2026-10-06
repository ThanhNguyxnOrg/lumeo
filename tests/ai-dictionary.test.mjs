import { describe, it, expect, vi, beforeEach } from "vitest";
import "../services/translate.js";
import "../ui/subtitle-overlay.js";

describe("AI Contextual Dictionary", () => {
  describe("parseExplanation", () => {
    it("parses clean standard Meaning / Nuance / Synonyms output", () => {
      const raw = `Meaning: Very careful and precise about details
Nuance: Formal, complimentary tone
Synonyms: Thorough, diligent, painstaking`;

      const result = window.LumeoTranslate.parseExplanation(raw);
      expect(result.meaning).toBe("Very careful and precise about details");
      expect(result.nuance).toBe("Formal, complimentary tone");
      expect(result.synonyms).toBe("Thorough, diligent, painstaking");
    });

    it("parses markdown bold labeled output", () => {
      const raw = `**Meaning:** Extremely hungry or ravenous
**Nuance:** Informal, expressive and colloquial
**Synonyms:** Starving, famished`;

      const result = window.LumeoTranslate.parseExplanation(raw);
      expect(result.meaning).toBe("Extremely hungry or ravenous");
      expect(result.nuance).toBe("Informal, expressive and colloquial");
      expect(result.synonyms).toBe("Starving, famished");
    });

    it("parses bullet-point markdown output from LLMs", () => {
      const raw = `- **Meaning:** To inspect or examine closely
- **Nuance:** Formal, clinical or investigative
- **Synonyms:** Scrutinize, examine, probe`;

      const result = window.LumeoTranslate.parseExplanation(raw);
      expect(result.meaning).toBe("To inspect or examine closely");
      expect(result.nuance).toBe("Formal, clinical or investigative");
      expect(result.synonyms).toBe("Scrutinize, examine, probe");
    });

    it("falls back to splitting lines if labels are absent", () => {
      const raw = `To start or begin something
Informal
Kick off, initiate`;

      const result = window.LumeoTranslate.parseExplanation(raw);
      expect(result.meaning).toBe("To start or begin something");
      expect(result.nuance).toBe("Informal");
      expect(result.synonyms).toBe("Kick off, initiate");
    });
  });

  describe("explainWordInContext service call", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("throws if API key is missing for Gemini", async () => {
      await expect(
        window.LumeoTranslate.explainWordInContext("meticulous", "He was meticulous.", "en", {
          provider: "gemini",
          geminiKey: "",
        })
      ).rejects.toThrow(/Gemini API key is missing/);
    });

    it("queries Gemini API and parses response", async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: "Meaning: Showing great attention to detail\nNuance: Positive professional nuance\nSynonyms: Precise, exact",
                },
              ],
            },
          },
        ],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const res = await window.LumeoTranslate.explainWordInContext(
        "meticulous",
        "She was meticulous with records.",
        "en",
        {
          provider: "gemini",
          geminiKey: "test-gemini-key",
        }
      );

      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, init] = fetch.mock.calls[0];
      expect(url).toContain("generativelanguage.googleapis.com");
      expect(url).toContain("test-gemini-key");
      expect(init.method).toBe("POST");
      expect(res.meaning).toBe("Showing great attention to detail");
      expect(res.nuance).toBe("Positive professional nuance");
      expect(res.synonyms).toBe("Precise, exact");
    });

    it("queries Groq API and parses response", async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: "Meaning: Rapid and energetic\nNuance: Informal\nSynonyms: Swift, brisk",
            },
          },
        ],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const res = await window.LumeoTranslate.explainWordInContext(
        "snappy",
        "That was a snappy answer.",
        "en",
        {
          provider: "groq",
          groqApiKey: "test-groq-key",
        }
      );

      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, init] = fetch.mock.calls[0];
      expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
      expect(init.headers.Authorization).toBe("Bearer test-groq-key");
      expect(res.meaning).toBe("Rapid and energetic");
      expect(res.nuance).toBe("Informal");
      expect(res.synonyms).toBe("Swift, brisk");
    });

    it("queries Custom AI Gateway API and parses response", async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: "Meaning: Lucid and crystal clear\nNuance: Technical\nSynonyms: Clear, transparent",
            },
          },
        ],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const res = await window.LumeoTranslate.explainWordInContext(
        "lucid",
        "Her explanation was lucid.",
        "en",
        {
          provider: "custom-gateway",
          customProxyApiKey: "test-gateway-key",
          customProxyBaseUrl: "https://my-gateway.example.com/v1",
          customProxyModelId: "custom-model-1",
        }
      );

      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, init] = fetch.mock.calls[0];
      expect(url).toBe("https://my-gateway.example.com/v1/chat/completions");
      expect(init.headers.Authorization).toBe("Bearer test-gateway-key");
      expect(JSON.parse(init.body).model).toBe("custom-model-1");
      expect(res.meaning).toBe("Lucid and crystal clear");
    });
  });

  describe("UI Subtitle Overlay AI Context Button & Box", () => {
    let container;
    let mockBrowserApi;

    beforeEach(() => {
      document.body.innerHTML = '<div id="movie_player"></div>';
      container = document.getElementById("movie_player");
      mockBrowserApi = {
        sendRuntimeMessage: vi.fn(),
      };
    });

    it("renders AI Context button and triggers runtime message on click", async () => {
      const controller = window.LumeoSubtitleOverlay.createSubtitleOverlayController({
        document,
        window,
        browserApi: mockBrowserApi,
      });

      controller.build();
      controller.updateCue(
        { text: "He was very articulate today.", translated: "Hôm nay anh ấy nói rất lưu loát." },
        { targetLanguage: "en" }
      );

      const overlay = controller.getElement();
      const wordBtn = overlay.querySelector('[data-lookup-word="articulate"]');
      expect(wordBtn).not.toBeNull();

      // Click word to open popover
      wordBtn.click();

      const popover = overlay.querySelector(".lumeo-lookup-popover");
      expect(popover).not.toBeNull();
      expect(popover.hidden).toBe(false);

      const aiBtn = popover.querySelector(".lumeo-lookup-ai-btn");
      expect(aiBtn).not.toBeNull();
      expect(aiBtn.textContent).toContain("AI Context");

      const aiBox = popover.querySelector(".lumeo-lookup-ai-box");
      expect(aiBox).not.toBeNull();
      expect(aiBox.hidden).toBe(true);

      // Mock background response
      mockBrowserApi.sendRuntimeMessage.mockResolvedValueOnce({
        ok: true,
        data: {
          meaning: "Expressing ideas clearly and effectively",
          nuance: "Complimentary, formal",
          synonyms: "Eloquent, fluent",
          provider: "gemini",
        },
      });

      // Click AI button
      aiBtn.click();

      // Wait for async handler
      await new Promise((r) => setTimeout(r, 10));

      expect(mockBrowserApi.sendRuntimeMessage).toHaveBeenCalledWith({
        type: "EXPLAIN_WORD_CONTEXT",
        word: "articulate",
        sentence: "He was very articulate today.",
        targetLanguage: "en",
      });

      expect(aiBox.hidden).toBe(false);
      expect(aiBox.querySelector(".lumeo-lookup-ai-provider").textContent).toBe("gemini");
      expect(aiBox.querySelector(".lumeo-lookup-ai-meaning").textContent).toBe("Expressing ideas clearly and effectively");
      expect(aiBox.querySelector(".lumeo-lookup-ai-nuance").textContent).toContain("Complimentary, formal");
      expect(aiBox.querySelector(".lumeo-lookup-ai-synonyms").textContent).toContain("Eloquent, fluent");
    });

    it("displays error message cleanly in English if AI lookup fails", async () => {
      const controller = window.LumeoSubtitleOverlay.createSubtitleOverlayController({
        document,
        window,
        browserApi: mockBrowserApi,
      });

      controller.build();
      controller.updateCue(
        { text: "A sudden mystery occurred.", translated: "Một bí ẩn bất ngờ xảy ra." },
        { targetLanguage: "en" }
      );

      const overlay = controller.getElement();
      const wordBtn = overlay.querySelector('[data-lookup-word="mystery"]');
      wordBtn.click();

      const popover = overlay.querySelector(".lumeo-lookup-popover");
      const aiBtn = popover.querySelector(".lumeo-lookup-ai-btn");
      const aiBox = popover.querySelector(".lumeo-lookup-ai-box");

      mockBrowserApi.sendRuntimeMessage.mockResolvedValueOnce({
        ok: false,
        error: "Rate limit exceeded. Please try again later.",
      });

      aiBtn.click();
      await new Promise((r) => setTimeout(r, 10));

      expect(aiBox.hidden).toBe(false);
      const errEl = aiBox.querySelector(".lumeo-lookup-ai-error");
      expect(errEl).not.toBeNull();
      expect(errEl.textContent).toBe("Rate limit exceeded. Please try again later.");
    });
  });
});
