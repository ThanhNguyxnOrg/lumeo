import { describe, it, expect, vi, beforeEach } from "vitest";
import "../services/providers.js";

describe("Dynamic Model Management", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("fetchProviderModels", () => {
    it("throws if API key is missing", async () => {
      await expect(
        window.LumeoProviders.fetchProviderModels("gemini", "")
      ).rejects.toThrow(/API key is required/);
    });

    it("fetches and filters Gemini models supporting generateContent", async () => {
      const mockGeminiResponse = {
        models: [
          {
            name: "models/gemini-2.5-flash",
            displayName: "Gemini 2.5 Flash",
            supportedGenerationMethods: ["generateContent", "countTokens"],
          },
          {
            name: "models/gemini-embedding-exp",
            displayName: "Gemini Embedding",
            supportedGenerationMethods: ["embedContent"],
          },
          {
            name: "models/gemini-3.0-flash-preview",
            displayName: "Gemini 3.0 Flash Preview",
            supportedGenerationMethods: ["generateContent"],
          },
        ],
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockGeminiResponse,
      });

      const models = await window.LumeoProviders.fetchProviderModels("gemini", "AIza-test-key", {
        fetch: mockFetch,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("generativelanguage.googleapis.com");
      expect(url).toContain("AIza-test-key");

      expect(models).toEqual([
        { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
        { id: "gemini-3.0-flash-preview", name: "Gemini 3.0 Flash Preview" },
      ]);
    });

    it("fetches and filters Groq chat models", async () => {
      const mockGroqResponse = {
        data: [
          { id: "llama-3.3-70b-versatile", active: true },
          { id: "whisper-large-v3", active: true },
          { id: "mixtral-8x7b-32768", active: true },
          { id: "deprecated-model", active: false },
        ],
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockGroqResponse,
      });

      const models = await window.LumeoProviders.fetchProviderModels("groq", "gsk_test_key", {
        fetch: mockFetch,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.groq.com/openai/v1/models");
      expect(init.headers.Authorization).toBe("Bearer gsk_test_key");

      expect(models).toEqual([
        { id: "llama-3.3-70b-versatile", name: "llama-3.3-70b-versatile" },
        { id: "mixtral-8x7b-32768", name: "mixtral-8x7b-32768" },
      ]);
    });

    it("fetches and filters OpenAI chat models", async () => {
      const mockOpenAIResponse = {
        data: [
          { id: "gpt-4o-mini", created: 1700000000 },
          { id: "text-embedding-3-small", created: 1690000000 },
          { id: "o1-preview", created: 1710000000 },
          { id: "dall-e-3", created: 1680000000 },
        ],
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockOpenAIResponse,
      });

      const models = await window.LumeoProviders.fetchProviderModels("openai", "sk-test", {
        fetch: mockFetch,
      });

      expect(models).toEqual([
        { id: "o1-preview", name: "o1-preview" },
        { id: "gpt-4o-mini", name: "gpt-4o-mini" },
      ]);
    });

    it("fetches OpenRouter models list", async () => {
      const mockOpenRouterResponse = {
        data: [
          { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet" },
          { id: "google/gemini-flash-1.5", name: "Gemini Flash 1.5" },
        ],
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockOpenRouterResponse,
      });

      const models = await window.LumeoProviders.fetchProviderModels("openrouter", "sk-or-test", {
        fetch: mockFetch,
      });

      expect(models).toEqual([
        { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet (anthropic/claude-3.5-sonnet)" },
        { id: "google/gemini-flash-1.5", name: "Gemini Flash 1.5 (google/gemini-flash-1.5)" },
      ]);
    });
  });

  describe("getCachedModels and setCachedModels", () => {
    it("stores and retrieves cached models in mock storage", async () => {
      const storageState = {};
      const mockStorage = {
        get: (key, cb) => cb({ [key]: storageState[key] }),
        set: (obj, cb) => {
          Object.assign(storageState, obj);
          cb?.();
        },
      };

      const testModels = [
        { id: "custom-gemini-next", name: "Gemini Next" },
      ];

      await window.LumeoProviders.setCachedModels("gemini", testModels, mockStorage);
      const retrieved = await window.LumeoProviders.getCachedModels("gemini", mockStorage);

      expect(retrieved).toEqual(testModels);
    });
  });
});
