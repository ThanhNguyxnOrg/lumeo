// pipelines/caption-orchestrator.js

(() => {
  // Ask the background for a single provider key when a fallback path needs
  // one. Content scripts must not read the whole storage area, and the
  // background only serves this to YouTube senders.
  function requestProviderKey(name) {
    return new Promise((resolve) => {
      try {
        const reply = chrome.runtime.sendMessage(
          { type: "GET_PROVIDER_KEY", key: name },
          (response) => {
            void chrome.runtime.lastError;
            resolve(response?.ok ? String(response.key || "") : "");
          },
        );
        if (reply && typeof reply.catch === "function") reply.catch(() => resolve(""));
      } catch {
        resolve("");
      }
    });
  }

  const MAX_SPEECH_RATE = 2.0;
  // Speech units per second at 1.0x: words for most languages, syllables for
  // Vietnamese (space-separated), characters for zh/ja.
  const NATURAL_PACE = { default: 2.8, vi: 4.0, zh: 5.5, ja: 6.5 };
  const BAKED_RATE_PROVIDERS = new Set(["google-cloud", "openai-tts", "openai"]);
  const MAX_LEAD_SECONDS = 0.4;
  const LATE_START_SECONDS = 0.4;
  const STALE_GAP_SECONDS = 1.5;
  const CAPTION_TICK_MS = 80;

  window.LumeoCaptionOrchestrator = {
    missingCaptionDependencies() {
      const required = [
        ["LumeoTranslate", window.LumeoTranslate],
        ["LumeoSrtExport", window.LumeoSrtExport],
        ["LumeoTTS", window.LumeoTTS],
        ["LumeoSonioxSTT", window.LumeoSonioxSTT],
        ["LumeoCaptions", window.LumeoCaptions],
        ["LumeoCaptionPipeline", window.LumeoCaptionPipeline],
      ];
      return required.filter(([, value]) => !value).map(([name]) => name);
    },

    async enableYouTubeCaptions() {
      const button = document.querySelector(".ytp-subtitles-button");
      if (!button) return false;
      const label = button.getAttribute("aria-label") || "";
      if (/unavailable/i.test(label)) return false;
      if (button.getAttribute("aria-pressed") !== "true") {
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
      return button.getAttribute("aria-pressed") === "true";
    },

    async translateLiveCaptionLine(text, ctx) {
      const settings = ctx.getSettings();
      const [translated] = await window.LumeoTranslate.translateBatch([text], settings.targetLanguage || "en", {
        provider: settings.translateProvider || "google-free",
        targetLanguageName: ctx.getLangName(settings.targetLanguage) || settings.targetLanguage || "English",
        openaiKey: settings.openaiKey,
        openaiModel: settings.openaiModel,
        geminiKey: settings.geminiKey,
        geminiModel: settings.geminiModel,
        openRouterKey: settings.openRouterKey,
        openRouterModel: settings.openRouterModel,
        groqApiKey: settings.groqApiKey,
        groqModel: settings.groqModel,
        googleCloudKey: settings.googleCloudKey,
        libreTranslateUrl: settings.libreTranslateUrl,
        libreTranslateKey: settings.libreTranslateKey,
        customProxyBaseUrl: settings.customProxyBaseUrl,
        customProxyApiKey: settings.customProxyApiKey,
        customProxyModelId: settings.customProxyModelId,
        context: settings.translationContext,
      });
      return translated || text;
    },

    async appendLiveSttCue(video, pipeline, sourceText, ctx) {
      const session = ctx.getSession();
      const settings = ctx.getSettings();
      const clean = String(sourceText || "").trim();
      if (!clean || session?.type !== "caption" || !session.liveStt) return;

      const start = video.currentTime || 0;
      const cue = { start, end: start + 4, text: clean, translated: clean };
      try {
        cue.translated = await this.translateLiveCaptionLine(clean, ctx);
      } catch {
        cue.translated = clean;
      }

      if (session?.type !== "caption" || !session.liveStt) return;
      cue.end = Math.max(video.currentTime || cue.end, cue.start + 2);
      session.cues.push(cue);
      pipeline.cues = session.cues;

      ctx.setCurrentTexts(cue.text, cue.translated);
      ctx.setTargetCue(cue);

      const elements = ctx.getElements();
      if (elements.source && settings.showSource) {
        elements.source.textContent = cue.text.slice(-260);
      }

      const transcript = ctx.getTranscriptController();
      transcript?.appendCaptionRow(cue, session.cues.length - 1);
      transcript?.updateCaptionTranscriptCount(session.cues.length);
      transcript?.updateCaptionTranscriptHighlight(session.cues.length - 1);

      if (settings.captionTtsProvider && settings.captionTtsProvider !== "off") {
        pipeline.speakCue(cue, {
          provider: settings.captionTtsProvider,
          targetLanguage: settings.targetLanguage || "en",
          googleCloudKey: settings.googleCloudKey,
          openaiKey: settings.openaiKey,
          customTtsBaseUrl: settings.customTtsBaseUrl,
          customTtsVoiceId: settings.customTtsVoiceId,
          customTtsApiKey: settings.customTtsApiKey,
          customTtsModelId: settings.customTtsModelId,
          voiceName: settings.standardVoice,
          rate: window.LumeoCaptionOrchestrator.resolveSpeechRate({ settings }),
          volume: Math.min((settings.voiceVolume ?? 100) / 100, 1),
          onSkip: () => ctx.showToast("⚠️ Spoken audio is catching up; oldest line skipped.", 3500),
          onFailover: () => {
            ctx.showToast("⚠️ Custom voice error. Temporarily fell back to browser speech.", 5000);
          },
        }).catch(() => { });
      }
    },

    renderCaptionFallbackChoice(video, token, pipeline, reason, diagnostics, ctx) {
      const session = {
        token,
        type: "caption",
        choiceOnly: true,
        pipeline,
        captionTimer: null,
        lastCueIndex: -1,
        kymaKey: null,
        stream: null,
        pc: null,
        dc: null,
      };
      ctx.onSessionCreated(session);
      ctx.applyTierToolbar();
      ctx.setStatusText("Choose fallback");
      ctx.setOverlayState("error");

      const elements = ctx.getElements();
      if (elements.history) elements.history.hidden = true;

      const wrap = window.LumeoCaptionFallbackChoice.create({
        reason,
        diagnostics,
        onChromeLiveCaption: async () => {
          const reply = await globalThis.LumeoBrowserApi
            .sendRuntimeMessage({ type: "OPEN_CHROME_ACCESSIBILITY_SETTINGS" }).catch(() => null);
          if (token !== ctx.getPageToken()) return;
          if (!reply?.ok) {
            ctx.showToast(reply?.error || "Could not open Chrome accessibility settings.", 7000);
            return;
          }
          ctx.showToast("⚡ Opened Chrome Settings. Turn on 'Live Caption' for free offline speech recognition.", 8000);
          ctx.onSessionEnded("chrome-live-caption", "Using Chrome Live Caption");
        },
        onGemini: () => this.startGeminiChoice(video, token, pipeline, reason, ctx),
        onGroq: () => this.startGroqChoice(video, token, pipeline, reason, ctx),
        onOpenAI: () => this.startOpenAIChoice(video, token, pipeline, reason, ctx),
        onSoniox: () => this.startSonioxChoice(video, token, pipeline, reason, ctx),
        onStandard: () => ctx.onSwitchToStandard(() => requestProviderKey("kymaKey")),
        onRetry: () => this.retryCaptionChoice(pipeline, ctx),
        onCancel: () => ctx.onSessionEnded("caption-fallback-cancel", "Caption fallback cancelled."),
      });
      ctx.setCaptionFallbackChoice(wrap);

      ctx.onStateChange({
        running: true,
        paused: false,
        status: "Choose fallback",
        errorMessage: "",
        errorCode: "missing-caption-track",
        missingProviders: ["soniox", "kyma"],
        slotsMissingKeys: [],
      });
    },

    async startGeminiChoice(video, token, pipeline, reason, ctx) {
      const settings = ctx.getSettings() || {};
      if (!settings.geminiKey) {
        try {
          const key = await requestProviderKey("geminiKey");
          if (key) {
            settings.geminiKey = key;
            settings.sttProvider = "gemini-stt";
            ctx.notifyBackground?.({ type: "UPDATE_SETTINGS", settings: { sttProvider: "gemini-stt" } });
          }
        } catch {}
      }
      if (!settings.geminiKey) {
        ctx.showToast("Add a Gemini key in the no-caption fallback card.", 7000);
        ctx.onStateChange({
          running: true,
          status: "Add Gemini key",
          errorMessage: "",
          errorCode: "missing-caption-track",
          missingProviders: ["gemini-stt"],
          slotsMissingKeys: ["stt"],
        });
        return;
      }
      const reply = await this.startCaptionGeminiFallback(video, token, pipeline, reason, ctx);
      if (!reply?.ok) {
        ctx.showToast(reply?.error || "Could not start Gemini STT fallback.", 7000);
        ctx.onStateChange({ running: false, status: "Gemini error", errorMessage: reply?.error || "Gemini error" });
      }
    },

    async startOpenAIChoice(video, token, pipeline, reason, ctx) {
      const settings = ctx.getSettings() || {};
      if (!settings.openaiKey) {
        try {
          const key = await requestProviderKey("openaiKey");
          if (key) {
            settings.openaiKey = key;
            settings.sttProvider = "openai-whisper";
            ctx.notifyBackground?.({ type: "UPDATE_SETTINGS", settings: { sttProvider: "openai-whisper" } });
          }
        } catch {}
      }
      if (!settings.openaiKey) {
        ctx.showToast("Add an OpenAI key in the no-caption fallback card.", 7000);
        ctx.onStateChange({
          running: true,
          status: "Add OpenAI key",
          errorMessage: "",
          errorCode: "missing-caption-track",
          missingProviders: ["openai-whisper"],
          slotsMissingKeys: ["stt"],
        });
        return;
      }
      const reply = await this.startCaptionOpenAIFallback(video, token, pipeline, reason, ctx);
      if (!reply?.ok) {
        ctx.showToast(reply?.error || "Could not start OpenAI Whisper fallback.", 7000);
        ctx.onStateChange({ running: false, status: "OpenAI error", errorMessage: reply?.error || "OpenAI error" });
      }
    },

    async startGroqChoice(video, token, pipeline, reason, ctx) {
      const settings = ctx.getSettings() || {};
      if (!settings.groqApiKey) {
        try {
          const key = await requestProviderKey("groqApiKey");
          if (key) {
            settings.groqApiKey = key;
            settings.sttProvider = "groq-whisper";
            ctx.notifyBackground?.({ type: "UPDATE_SETTINGS", settings: { sttProvider: "groq-whisper" } });
          }
        } catch {}
      }
      if (!settings.groqApiKey) {
        ctx.showToast("Add a Groq key in the no-caption fallback card.", 7000);
        ctx.onStateChange({
          running: true,
          status: "Add Groq key",
          errorMessage: "",
          errorCode: "missing-caption-track",
          missingProviders: ["groq-whisper"],
          slotsMissingKeys: ["stt"],
        });
        return;
      }
      const reply = await this.startCaptionGroqFallback(video, token, pipeline, reason, ctx);
      if (!reply?.ok) {
        ctx.showToast(reply?.error || "Could not start Groq Whisper fallback.", 7000);
        ctx.onStateChange({ running: false, status: "Groq error", errorMessage: reply?.error || "Groq error" });
      }
    },

    async startSonioxChoice(video, token, pipeline, reason, ctx) {
      const settings = ctx.getSettings() || {};
      if (!settings.sonioxApiKey) {
        try {
          const key = await requestProviderKey("sonioxApiKey");
          if (key) {
            settings.sonioxApiKey = key;
            settings.sttProvider = "soniox";
            ctx.notifyBackground?.({ type: "UPDATE_SETTINGS", settings: { sttProvider: "soniox" } });
          }
        } catch {}
      }
      if (!settings.sonioxApiKey) {
        ctx.showToast("Add a Soniox key in Lumeo Settings.", 7000);
        ctx.onStateChange({
          running: true,
          status: "Add Soniox key",
          errorMessage: "",
          errorCode: "missing-caption-track",
          missingProviders: ["soniox"],
          slotsMissingKeys: ["stt"],
        });
        return;
      }
      const reply = await this.startCaptionSonioxFallback(video, token, pipeline, reason, ctx);
      if (!reply?.ok) {
        ctx.showToast(reply?.error || "Could not start Soniox fallback.", 7000);
        ctx.onStateChange({ running: false, status: "Soniox error", errorMessage: reply?.error || "Soniox error" });
      }
    },

    async retryCaptionChoice(pipeline, ctx) {
      pipeline.stop?.();
      ctx.onSessionCreated(null);
      const reply = await this.start(ctx);
      if (!reply?.ok) ctx.showToast(reply?.error || "Retry failed.", 7000);
    },

    async startCaptionDomFallback(video, token, pipeline, reason, diagnostics, ctx) {
      const captionsEnabled = await this.enableYouTubeCaptions();
      if (token !== ctx.getPageToken()) return { ok: false, error: "Stale session." };

      const session = {
        token,
        type: "caption",
        liveDomCc: true,
        pipeline,
        captionTimer: null,
        lastCueIndex: -1,
        lastDomText: "",
        lastDomAt: Date.now(),
        cues: [],
        kymaKey: null,
        stream: null,
        pc: null,
        dc: null,
      };
      ctx.onSessionCreated(session);
      ctx.setCurrentTexts("", "");
      ctx.applyTierToolbar();
      ctx.applySourceVisibility();

      const transcript = ctx.getTranscriptController();
      transcript?.renderCaptionTranscript(session.cues);
      ctx.setStatusText(captionsEnabled ? "YouTube CC live" : "Waiting for CC");
      ctx.setOverlayState("connecting");
      ctx.setTargetText("Waiting for YouTube captions...");
      ctx.onStateChange({ running: true, paused: false, status: "Captioning (YouTube CC)" });

      let translating = false;
      const startedAt = Date.now();
      const settings = ctx.getSettings();
      const elements = ctx.getElements();

      const tick = async () => {
        const currentSession = ctx.getSession();
        if (currentSession?.type !== "caption" || !currentSession.liveDomCc || currentSession.token !== token) return;
        const text = ctx.readYTCaptions();
        if (!text) {
          if (!currentSession.cues.length && Date.now() - startedAt > 9000) {
            if (currentSession.captionTimer) {
              clearInterval(currentSession.captionTimer);
              currentSession.captionTimer = null;
            }
            this.renderCaptionFallbackChoice(
              video,
              token,
              pipeline,
              captionsEnabled
                ? `${reason} YouTube CC turned on, but no rendered caption text appeared.`
                : `${reason} The YouTube player says captions are unavailable.`,
              diagnostics,
              ctx
            );
          }
          return;
        }
        currentSession.lastDomAt = Date.now();
        if (text === currentSession.lastDomText || translating) return;
        currentSession.lastDomText = text;
        translating = true;
        const start = video.currentTime || 0;
        const cue = { start, end: start + 3, text, translated: text };
        try {
          cue.translated = await this.translateLiveCaptionLine(text, ctx);
        } catch {
          cue.translated = text;
        } finally {
          translating = false;
        }

        const latestSession = ctx.getSession();
        if (latestSession?.type !== "caption" || !latestSession.liveDomCc || latestSession.token !== token) return;
        cue.end = Math.max(video.currentTime || cue.end, cue.start + 1.5);
        latestSession.cues.push(cue);
        pipeline.cues = latestSession.cues;

        ctx.setCurrentTexts(cue.text, cue.translated);
        ctx.setTargetCue(cue);
        const liveSettings = ctx.getSettings() || settings;
        if (elements.source && liveSettings.showSource) elements.source.textContent = cue.text.slice(-260);

        transcript?.appendCaptionRow(cue, latestSession.cues.length - 1);
        transcript?.updateCaptionTranscriptCount(latestSession.cues.length);
        transcript?.updateCaptionTranscriptHighlight(latestSession.cues.length - 1);

        if (liveSettings.captionTtsProvider && liveSettings.captionTtsProvider !== "off") {
          pipeline.speakCue(cue, {
            provider: liveSettings.captionTtsProvider,
            targetLanguage: liveSettings.targetLanguage || "en",
            googleCloudKey: liveSettings.googleCloudKey,
            openaiKey: liveSettings.openaiKey,
            customTtsBaseUrl: liveSettings.customTtsBaseUrl,
            customTtsVoiceId: liveSettings.customTtsVoiceId,
            customTtsApiKey: liveSettings.customTtsApiKey,
            voiceName: liveSettings.standardVoice,
            rate: window.LumeoCaptionOrchestrator.resolveSpeechRate({ settings: liveSettings }),
            volume: Math.min((liveSettings.voiceVolume ?? 100) / 100, 1),
            onSkip: () => ctx.showToast("⚠️ Spoken audio is catching up; oldest line skipped.", 3500),
          }).catch(() => { });
        }
        ctx.setStatusText("YouTube CC live");
        ctx.setOverlayState("live");
      };

      session.captionTimer = setInterval(() => { void tick(); }, 350);
      void tick();

      ctx.setYTPauseHandler(() => {
        window.LumeoTTS?.stop?.();
        ctx.setStatusText("Paused");
        ctx.setOverlayState("paused");
        ctx.onStateChange({ paused: true, status: "Paused" });
      });
      ctx.setYTPlayHandler(() => {
        ctx.setStatusText("YouTube CC live");
        ctx.setOverlayState("live");
        ctx.onStateChange({ paused: false, status: "Captioning (YouTube CC)" });
      });

      return { ok: true };
    },

    async startCaptionGeminiFallback(video, token, pipeline, reason, ctx) {
      if (!window.LumeoGeminiSTT) {
        ctx.removeOverlay();
        return { ok: false, error: "Gemini STT service not loaded." };
      }
      ctx.setStatusText("Gemini STT");
      ctx.setOverlayState("connecting");
      ctx.showToast(reason ? `${reason} Starting Gemini Audio fallback.` : "Starting Gemini Audio fallback.", 5000);

      let stream;
      try {
        stream = await ctx.captureWithRetry(video);
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }

      const session = {
        token,
        type: "caption",
        liveStt: true,
        pipeline,
        captionTimer: null,
        lastCueIndex: -1,
        cues: [],
        kymaKey: null,
        stream,
        pc: null,
        dc: null,
        sttLoop: null,
      };
      ctx.onSessionCreated(session);
      ctx.applyTierToolbar();
      ctx.getTranscriptController()?.renderCaptionTranscript(session.cues);

      const settings = ctx.getSettings();
      try {
        const loop = window.LumeoGeminiSTT.create({
          stream,
          apiKey: settings.geminiKey,
          model: settings.geminiModel || "gemini-2.5-flash-lite",
          language: settings.sourceLanguage || "",
          onText: (result) => {
            void this.appendLiveSttCue(video, pipeline, result?.text || "", ctx);
          },
          onError: (err) => {
            ctx.setStatusText("Gemini error");
            ctx.showToast(err?.message || "Gemini STT error", 7000);
            ctx.onStateChange({ running: false, paused: false, status: "Gemini error", errorMessage: err?.message || "Gemini STT error" });
          },
        });
        session.sttLoop = loop;
        loop.start();
      } catch (err) {
        stream.getTracks().forEach((track) => track.stop());
        ctx.removeOverlay();
        return { ok: false, error: err?.message || String(err) };
      }

      ctx.setStatusText("Gemini AI Live");
      ctx.setOverlayState("live");
      ctx.onStateChange({ running: true, paused: false, status: "Captioning (Gemini STT)" });
      return { ok: true };
    },

    async startCaptionOpenAIFallback(video, token, pipeline, reason, ctx) {
      if (!window.LumeoGroqSTT) {
        ctx.removeOverlay();
        return { ok: false, error: "Whisper STT service not loaded." };
      }
      ctx.setStatusText("OpenAI Whisper");
      ctx.setOverlayState("connecting");
      ctx.showToast(reason ? `${reason} Starting OpenAI Whisper fallback.` : "Starting OpenAI Whisper fallback.", 5000);

      let stream;
      try {
        stream = await ctx.captureWithRetry(video);
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }

      const session = {
        token,
        type: "caption",
        liveStt: true,
        pipeline,
        captionTimer: null,
        lastCueIndex: -1,
        cues: [],
        kymaKey: null,
        stream,
        pc: null,
        dc: null,
        sttLoop: null,
      };
      ctx.onSessionCreated(session);
      ctx.applyTierToolbar();
      ctx.getTranscriptController()?.renderCaptionTranscript(session.cues);

      const settings = ctx.getSettings();
      try {
        const loop = window.LumeoGroqSTT.create({
          stream,
          apiKey: settings.openaiKey,
          provider: "openai",
          model: "whisper-1",
          language: settings.sourceLanguage || "",
          onText: (result) => {
            void this.appendLiveSttCue(video, pipeline, result?.text || "", ctx);
          },
          onError: (err) => {
            ctx.setStatusText("OpenAI error");
            ctx.showToast(err?.message || "OpenAI Whisper error", 7000);
            ctx.onStateChange({ running: false, paused: false, status: "OpenAI error", errorMessage: err?.message || "OpenAI Whisper error" });
          },
        });
        session.sttLoop = loop;
        loop.start();
      } catch (err) {
        stream.getTracks().forEach((track) => track.stop());
        ctx.removeOverlay();
        return { ok: false, error: err?.message || String(err) };
      }

      ctx.setStatusText("OpenAI Whisper Live");
      ctx.setOverlayState("live");
      ctx.onStateChange({ running: true, paused: false, status: "Captioning (OpenAI STT)" });
      return { ok: true };
    },

    async startCaptionGroqFallback(video, token, pipeline, reason, ctx) {
      if (!window.LumeoGroqSTT) {
        ctx.removeOverlay();
        return { ok: false, error: "Groq fallback service not loaded." };
      }
      ctx.setStatusText("Groq Whisper");
      ctx.setOverlayState("connecting");
      ctx.showToast(reason ? `${reason} Starting Groq Whisper fallback.` : "Starting Groq Whisper fallback.", 5000);

      let stream;
      try {
        stream = await ctx.captureWithRetry(video);
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }

      const session = {
        token,
        type: "caption",
        liveStt: true,
        pipeline,
        captionTimer: null,
        lastCueIndex: -1,
        cues: [],
        kymaKey: null,
        stream,
        pc: null,
        dc: null,
        sttLoop: null,
      };
      ctx.onSessionCreated(session);
      ctx.applyTierToolbar();
      ctx.getTranscriptController()?.renderCaptionTranscript(session.cues);

      const settings = ctx.getSettings();
      try {
        const loop = window.LumeoGroqSTT.create({
          stream,
          apiKey: settings.groqApiKey,
          model: settings.groqSttModel || "whisper-large-v3-turbo",
          language: settings.sourceLanguage || "",
          onText: (result) => {
            void this.appendLiveSttCue(video, pipeline, result?.text || "", ctx);
          },
          onError: (err) => {
            ctx.setStatusText("Groq error");
            ctx.showToast(err?.message || "Groq Whisper error", 7000);
            ctx.onStateChange({ running: false, paused: false, status: "Groq error", errorMessage: err?.message || "Groq Whisper error" });
          },
        });
        session.sttLoop = loop;
        loop.start();
      } catch (err) {
        stream.getTracks().forEach((track) => track.stop());
        ctx.removeOverlay();
        return { ok: false, error: err?.message || String(err) };
      }

      ctx.setStatusText("Groq Whisper Live");
      ctx.setOverlayState("live");
      ctx.onStateChange({ running: true, paused: false, status: "Captioning (Groq STT)" });
      return { ok: true };
    },

    async startCaptionSonioxFallback(video, token, pipeline, reason, ctx) {
      if (!window.LumeoSonioxSTT) {
        ctx.removeOverlay();
        return { ok: false, error: "Soniox fallback service not loaded." };
      }
      ctx.setStatusText("Soniox STT");
      ctx.setOverlayState("connecting");
      ctx.showToast(reason ? `${reason} Starting Soniox fallback.` : "Starting Soniox fallback.", 5000);

      const session = {
        token,
        type: "caption",
        liveStt: true,
        pipeline,
        captionTimer: null,
        lastCueIndex: -1,
        cues: [],
        tokenBuffer: [],
        kymaKey: null,
        stream: null,
        pc: null,
        dc: null,
        sttLoop: {
          stop: () => {
            try { window.LumeoSonioxSTT?.stop?.(); } catch {}
          },
        },
      };
      ctx.onSessionCreated(session);
      ctx.applyTierToolbar();
      ctx.getTranscriptController()?.renderCaptionTranscript(session.cues);

      const settings = ctx.getSettings();
      const elements = ctx.getElements();

      const flushBuffer = async () => {
        const currentSession = ctx.getSession();
        if (currentSession?.type !== "caption" || !currentSession.liveStt || !currentSession.tokenBuffer.length) return;
        const sourceText = currentSession.tokenBuffer.map((t) => t.text || "").join("").trim();
        currentSession.tokenBuffer = [];
        if (!sourceText) return;
        await this.appendLiveSttCue(video, pipeline, sourceText, ctx);
      };

      try {
        await window.LumeoSonioxSTT.start({
          apiKey: settings.sonioxApiKey,
          onStatus: (status) => {
            ctx.setStatusText(status === "connected" ? "Soniox Live" : status || "Soniox STT");
            ctx.setOverlayState("live");
            ctx.onStateChange({ running: true, paused: false, status: "Captioning (STT)" });
          },
          onError: (error) => {
            ctx.setStatusText("Soniox error");
            ctx.showToast(error || "Soniox error", 7000);
            ctx.onStateChange({ running: false, paused: false, status: "Soniox error", errorMessage: error || "Soniox error" });
          },
          onResult: (data) => {
            const currentSession = ctx.getSession();
            if (!currentSession) return;
            if (data?.finished) {
              void flushBuffer();
              return;
            }
            const tokens = (data?.tokens || []).filter((t) => t?.text && !String(t.text).startsWith("<"));
            const finals = tokens.filter((t) => t.is_final);
            if (finals.length) currentSession.tokenBuffer.push(...finals);
            const interim = tokens.filter((t) => !t.is_final).map((t) => t.text).join("").trim();
            const finalText = currentSession.tokenBuffer.map((t) => t.text || "").join("").trim();
            const preview = (finalText + " " + interim).trim();
            if (preview) {
              ctx.setCurrentTexts(preview, ctx.getCurrentTexts().target);
              ctx.setTargetText(preview);
              if (elements.source && settings.showSource) elements.source.textContent = preview.slice(-260);
            }
            if (/[.!?。！？]$/.test(finalText) || finalText.length > 120) {
              void flushBuffer();
            }
          },
        });
      } catch (err) {
        ctx.removeOverlay();
        return { ok: false, error: err?.message || String(err) };
      }

      ctx.setStatusText("Soniox Live");
      ctx.setOverlayState("live");
      ctx.onStateChange({ running: true, paused: false, status: "Captioning (STT)" });
      return { ok: true };
    },

    // Speech units are what a voice spends time on: characters for zh/ja,
    // segmented words for Thai, whitespace tokens elsewhere.
    countSpeechUnits(text = "", targetLanguage = "en") {
      const clean = String(text || "").trim();
      if (!clean) return 0;
      const lang = String(targetLanguage || "en").split("-")[0].toLowerCase();
      if (lang === "zh" || lang === "ja") return clean.replace(/\s+/g, "").length;
      if (lang === "th") {
        const approx = Math.ceil(clean.replace(/\s+/g, "").length / 3.5);
        try {
          if (typeof Intl !== "undefined" && Intl.Segmenter) {
            return [...new Intl.Segmenter("th", { granularity: "word" }).segment(clean)]
              .filter((s) => s.isWordLike).length || approx;
          }
        } catch {}
        return approx;
      }
      return clean.split(/\s+/).length;
    },

    // Units per second a voice speaks at 1.0x. The table is only the starting
    // guess: once the active voice has spoken a few lines, its measured pace
    // replaces it (kept within a sane band of the default).
    speechPace(targetLanguage = "en", measured = null) {
      const lang = String(targetLanguage || "en").split("-")[0].toLowerCase();
      const base = NATURAL_PACE[lang] || NATURAL_PACE.default;
      const value = Number(measured);
      if (!Number.isFinite(value) || value <= 0) return base;
      return Math.min(base * 1.8, Math.max(base * 0.55, value));
    },

    estimateSpeechSeconds({ text = "", targetLanguage = "en", pace = null } = {}) {
      const units = this.countSpeechUnits(text, targetLanguage);
      return units > 0 ? units / this.speechPace(targetLanguage, pace) : 0;
    },

    // Rate at which a line ends exactly when its slot does. `duration` is in
    // video seconds, so a faster video leaves less real time to speak.
    fitRateForCue({ text = "", targetLanguage = "en", duration = 3.0, playbackRate = 1, pace = null } = {}) {
      const needed = this.estimateSpeechSeconds({ text, targetLanguage, pace });
      const rate = Number(playbackRate) || 1;
      const available = Number(duration) > 0 ? Number(duration) / rate : 3.0;
      if (!(needed > 0 && available > 0)) return 1.0;
      return this.rateForRemaining(needed, available);
    },

    // Never slower than natural speech, never faster than the product ceiling.
    rateForRemaining(neededSeconds, remainingSeconds) {
      const needed = Number(neededSeconds);
      const remaining = Number(remainingSeconds);
      if (!(needed > 0)) return 1.0;
      if (!(remaining > 0)) return MAX_SPEECH_RATE;
      return Math.min(MAX_SPEECH_RATE, Math.max(1.0, needed / remaining));
    },

    // Where a cue's speech slot ends, in video time. A line may use the
    // natural gap until the next cue starts, not only its own display window.
    cueSlotEnd(cue, nextCue) {
      const start = Number(cue?.start) || 0;
      const nextStart = Number(nextCue?.start);
      const cueEnd = Number(cue?.end);
      if (Number.isFinite(nextStart) && nextStart > start) return nextStart;
      return Number.isFinite(cueEnd) && cueEnd > start ? cueEnd : start + 3.0;
    },

    // A cue is stale once the video has moved past the point where the next
    // subtitle replaces it (plus a short grace period). Skipping stale cues is
    // what keeps the voice from drifting behind the subtitles.
    isCueStale(mediaNow, cue, graceSeconds = 0.25, nextCue = null) {
      const now = Number(mediaNow);
      if (!Number.isFinite(now)) return false;
      const start = Number(cue?.start) || 0;
      let end = cue?.end != null && Number(cue.end) > start ? Number(cue.end) : start + 3.0;
      const nextStart = Number(nextCue?.start);
      if (Number.isFinite(nextStart) && nextStart > start) {
        // Overlapping auto-caption cues end when the next one starts; a real
        // gap may be borrowed, but only briefly.
        end = Math.min(nextStart, end + STALE_GAP_SECONDS);
      }
      return now > end + (Number(graceSeconds) || 0);
    },

    // A line that starts late and could not get even a third of itself out
    // before its slot ends is dropped: speaking it would only push the next
    // line late as well.
    cannotFitLateCue({ lagSeconds = 0, neededSeconds = 0, remainingSeconds = 0 } = {}) {
      if (!(Number(lagSeconds) > LATE_START_SECONDS)) return false;
      return Number(remainingSeconds) * MAX_SPEECH_RATE < Number(neededSeconds) * 0.35;
    },

    isManualSpeed(settings = {}) {
      const legacy = Number(settings.ttsRate);
      return settings.ttsSpeedMode === "manual"
        || (!settings.ttsSpeedMode && Number.isFinite(legacy) && legacy > 0);
    },

    // Auto mode adapts to the line and the time left; manual mode is a fixed
    // user speed (the old numeric `ttsRate` migrates to manual). Both clamp to
    // the 0.5-2.0 product band.
    resolveSpeechRate({ calculatedRate = 1, settings = {} } = {}) {
      if (this.isManualSpeed(settings)) {
        const legacy = Number(settings.ttsRate);
        const manual = Number(settings.ttsSpeed) > 0 ? Number(settings.ttsSpeed) : legacy;
        return Math.min(MAX_SPEECH_RATE, Math.max(0.5, Number.isFinite(manual) && manual > 0 ? manual : 1));
      }
      return Math.min(MAX_SPEECH_RATE, Math.max(1.0, Number(calculatedRate) || 1));
    },

    // Providers that bake the speaking rate into the generated clip (Google,
    // OpenAI) only hit their prefetched cache if playback asks for the exact
    // same rate. The clip player closes any remaining gap with playbackRate,
    // so a prefetched clip is always reused instead of synthesized again.
    // A manual speed is the user's choice, so a clip prefetched before the
    // speed was changed is not reused.
    selectCuePlaybackPlan({ plan, prefetchedPlan, provider = "", manual = false } = {}) {
      const reusePrefetched = !!(BAKED_RATE_PROVIDERS.has(provider) && prefetchedPlan)
        && (!manual || prefetchedPlan.rate === plan?.rate);
      return {
        rate: reusePrefetched ? prefetchedPlan.rate : plan?.rate,
        reusePrefetched,
      };
    },

    // Identifies the voice whose pace and start latency are being measured.
    speechVoiceKey(settings = {}) {
      return [
        settings.captionTtsProvider || "browser",
        settings.targetLanguage || "en",
        settings.standardVoice || settings.customTtsVoiceId || "",
      ].join("|");
    },

    // How early (real seconds) to ask for a line so it is heard on the cue
    // boundary. Measured per voice; capped so a bad sample cannot make the
    // voice run ahead of the subtitle.
    speechLeadSeconds(settings = {}) {
      const latency = Number(window.LumeoTTS?.getStartLatency?.(this.speechVoiceKey(settings)));
      if (!Number.isFinite(latency) || latency <= 0) return 0;
      return Math.min(MAX_LEAD_SECONDS, latency);
    },

    // Stable key for the prefetched plan of one cue. Start time + text means a
    // seek or retranslation never reuses the wrong clip.
    cueSpeechKey(cue, text) {
      return [
        (Number(cue?.start) || 0).toFixed(3),
        String(text ?? cue?.translated ?? cue?.text ?? "").trim(),
      ].join("\u0001");
    },

    // Build the rate/slot plan for one cue. Prefetch calls this for the whole
    // slot (`fromNow: false`); playback calls it for the time actually left.
    buildCueSpeechPlan(cue, nextCue, settings = {}, { videoNow = 0, videoRate = 1, fromNow = true, leadSeconds = 0 } = {}) {
      const text = String(cue?.translated || cue?.text || "").trim();
      if (!text) return null;
      const targetLanguage = settings.targetLanguage || "en";
      const start = Number(cue?.start) || 0;
      const slotEnd = this.cueSlotEnd(cue, nextCue);
      const duration = Math.max(0.5, slotEnd - start);
      const rate = Number(videoRate) || 1;
      const pace = window.LumeoTTS?.getPace?.(this.speechVoiceKey(settings)) ?? null;
      const units = this.countSpeechUnits(text, targetLanguage);
      const neededSeconds = this.estimateSpeechSeconds({ text, targetLanguage, pace });
      // Asked for early, a line still starts on its cue; asked for late, it
      // starts one start-latency from now.
      const fullSlot = (slotEnd - start) / rate;
      const remainingSeconds = fromNow
        ? Math.min(fullSlot, (slotEnd - (Number(videoNow) || 0)) / rate - (Number(leadSeconds) || 0))
        : fullSlot;
      const lagSeconds = Math.max(0, (Number(videoNow) || 0) - start) / rate;
      return {
        text,
        units,
        slotEnd,
        duration,
        neededSeconds,
        remainingSeconds,
        lagSeconds,
        rate: this.resolveSpeechRate({
          calculatedRate: this.rateForRemaining(neededSeconds, Math.max(0.5 / rate, remainingSeconds)),
          settings,
        }),
      };
    },

    // Pre-synthesize a future cue for network TTS providers. This removes the
    // network round-trip from the cue boundary, which is the main reason the
    // spoken voice used to trail the subtitle line.
    prefetchCueSpeech(cue, nextCue, settings = {}, video = null, ctx = null, session = null) {
      const provider = settings.captionTtsProvider;
      if (!cue?.translated || !provider || provider === "off" || provider === "browser") return false;
      const plans = session?.prefetchedTtsPlans
        || (session ? (session.prefetchedTtsPlans = new Map()) : null);
      const cueKey = this.cueSpeechKey(cue, cue.translated);
      // One plan per line. The measured pace moves a little after every clip;
      // re-planning would re-synthesize (and bill) the same line at a new rate.
      // A changed manual speed is the exception: the old plan no longer
      // matches what the user asked for.
      const known = plans?.get(cueKey);
      const speedChanged = known && this.isManualSpeed(settings)
        && known.rate !== this.resolveSpeechRate({ settings });
      if (known && !speedChanged) return false;
      const plan = this.buildCueSpeechPlan(cue, nextCue, settings, {
        videoNow: Number(video?.currentTime) || 0,
        videoRate: Number(video?.playbackRate) || 1,
        fromNow: false,
      });
      if (!plan) return false;
      plans?.set(cueKey, plan);
      const key = [
        provider,
        settings.targetLanguage || "en",
        settings.standardVoice || "",
        plan.rate.toFixed(3),
        plan.text,
      ].join("\u0001");
      const seen = session?.prefetchedTts || (session ? (session.prefetchedTts = new Set()) : null);
      if (seen?.has(key)) return false;
      seen?.add(key);
      const pending = window.LumeoTTS?.prefetch?.(plan.text, settings.targetLanguage || "en", {
        provider,
        rate: plan.rate,
        googleCloudKey: settings.googleCloudKey,
        openaiKey: settings.openaiKey,
        openaiVoice: settings.openaiVoice,
        customTtsBaseUrl: settings.customTtsBaseUrl,
        customTtsVoiceId: settings.customTtsVoiceId,
        customTtsApiKey: settings.customTtsApiKey,
        customTtsModelId: settings.customTtsModelId,
        voiceName: settings.standardVoice,
      });
      Promise.resolve(pending).catch(() => {});
      return true;
    },

    // Speak the line that is due. Runs on every tick; the cue is looked up a
    // little ahead of the video (the voice's measured start latency) so the
    // sound lands on the cue boundary instead of after it.
    speakDueCue({ pipeline, video, settings = {}, session, ctx } = {}) {
      const provider = settings.captionTtsProvider;
      if (!provider || provider === "off" || !pipeline || !session) return false;
      const mediaNow = Number(video?.currentTime) || 0;
      const videoRate = Number(video?.playbackRate) || 1;
      const leadSeconds = this.speechLeadSeconds(settings);
      const due = pipeline.cueAt(mediaNow + leadSeconds * videoRate);
      const cue = due?.cue;
      // Untranslated and failed-translation lines hold source-language text,
      // which the target-language voice would mispronounce. They are retried
      // on the next tick, so a late translation is still spoken.
      const text = String(cue?.translated || "").trim();
      if (!cue || !text || cue.__fallback) return false;
      const key = this.cueSpeechKey(cue, text);
      if (key === session.lastSpokenKey) return false;
      session.lastSpokenKey = key;

      const nextCue = pipeline.cues?.[due.index + 1];
      const planOptions = () => ({
        videoNow: Number(video?.currentTime) || 0,
        videoRate: Number(video?.playbackRate) || 1,
        leadSeconds,
      });
      const plan = this.buildCueSpeechPlan(cue, nextCue, settings, planOptions());
      if (!plan) return false;
      const manual = this.isManualSpeed(settings);
      const tooLate = (livePlan) => this.isCueStale(Number(video?.currentTime) || 0, cue, 0.25, nextCue)
        || (!manual && this.cannotFitLateCue(livePlan));
      if (tooLate(plan)) return false;

      const prefetchedPlan = session.prefetchedTtsPlans?.get(key);
      const { rate, reusePrefetched } = this.selectCuePlaybackPlan({ plan, prefetchedPlan, provider, manual });
      const voiceKey = this.speechVoiceKey(settings);

      pipeline.speakCue(cue, {
        provider,
        targetLanguage: settings.targetLanguage || "en",
        googleCloudKey: settings.googleCloudKey,
        openaiKey: settings.openaiKey,
        openaiVoice: settings.openaiVoice,
        customTtsBaseUrl: settings.customTtsBaseUrl,
        customTtsVoiceId: settings.customTtsVoiceId,
        customTtsApiKey: settings.customTtsApiKey,
        customTtsModelId: settings.customTtsModelId,
        voiceName: settings.standardVoice,
        rate,
        // If the line waited behind the previous one, refit it to the time
        // that is left when the queue actually starts it.
        getRate: reusePrefetched
          ? undefined
          : () => this.buildCueSpeechPlan(cue, nextCue, settings, planOptions())?.rate,
        // Network clips report their real length, so the player can fit them
        // to the slot exactly instead of relying on the estimate above.
        getSlotSeconds: manual
          ? undefined
          : () => this.buildCueSpeechPlan(cue, nextCue, settings, { ...planOptions(), leadSeconds: 0 })?.remainingSeconds,
        speechUnits: plan.units,
        paceKey: voiceKey,
        latencyKey: voiceKey,
        volume: Math.min((settings.voiceVolume ?? 100) / 100, 1),
        isStale: () => tooLate(this.buildCueSpeechPlan(cue, nextCue, settings, planOptions()) || plan),
        onSkip: () => ctx?.showToast?.("⚠️ Spoken audio is catching up; oldest line skipped.", 3500),
        onFailover: () => {
          ctx?.showToast?.("⚠️ Custom voice error. Temporarily fell back to browser speech.", 5000);
        },
      }).then((ok) => {
        if (ok && session.lastSpokenKey === key) session.finishedSpeechKey = key;
      }).catch(() => { });
      return true;
    },

    updateCaptionProgress(progress = {}, ctx) {
      const completed = Number(progress.completed || 0);
      const total = Number(progress.total || 0);
      const suffix = total ? ` ${completed}/${total}` : "";
      let status;
      if (progress.phase === "cached") status = `Caption cache${suffix}`;
      else if (progress.phase === "native") status = `Native captions${suffix}`;
      else if (progress.phase === "translated") status = `Translated captions${suffix}`;
      else status = `Translating captions${suffix}`;
      ctx.setStatusText(status);
      ctx.setTargetText(status);
      ctx.onStateChange({ running: true, paused: false, status });
    },

    async start(ctx) {
      const video = ctx.getVideo();
      if (!video) return { ok: false, error: "No YouTube video on this page." };

      ctx.buildOverlay();
      ctx.setStatusText("Loading captions");
      ctx.setOverlayState("connecting");
      ctx.applyTierToolbar();
      ctx.applySourceVisibility();
      ctx.onStateChange({ running: true, paused: false, status: "Loading captions" });

      const token = ctx.getPageToken();
      const missingDeps = this.missingCaptionDependencies();
      if (missingDeps.length) {
        return {
          ok: false,
          error: `Caption dependencies not loaded: ${missingDeps.join(", ")}. Reload the extension and this YouTube tab.`,
        };
      }

      const pipeline = window.LumeoCaptionPipeline.create();
      ctx.setActivePipeline?.(pipeline);
      const settings = ctx.getSettings();

      let result;
      try {
        result = await pipeline.start({
          targetLanguage: settings.targetLanguage || "en",
          targetLanguageName: ctx.getLangName(settings.targetLanguage) || settings.targetLanguage || "English",
          translateProvider: settings.translateProvider || "google-free",
          openaiKey: settings.openaiKey,
          openaiModel: settings.openaiModel,
          geminiKey: settings.geminiKey,
          geminiModel: settings.geminiModel,
          openRouterKey: settings.openRouterKey,
          openRouterModel: settings.openRouterModel,
          groqApiKey: settings.groqApiKey,
          groqModel: settings.groqModel,
          googleCloudKey: settings.googleCloudKey,
          libreTranslateUrl: settings.libreTranslateUrl,
          libreTranslateKey: settings.libreTranslateKey,
          customProxyBaseUrl: settings.customProxyBaseUrl,
          customProxyApiKey: settings.customProxyApiKey,
          customProxyModelId: settings.customProxyModelId,
          secondaryLanguage: settings.secondaryLanguage || "original",
          context: settings.translationContext,
          currentTime: video?.currentTime || 0,
          onProgress: (p) => this.updateCaptionProgress(p, ctx),
          onFailover: ({ from, to }) => {
            const label = from === "custom-gateway" ? "Custom AI Gateway" : (from ? from.charAt(0).toUpperCase() + from.slice(1) : "AI Translation");
            ctx.showToast(`⚠️ ${label} error or quota reached. Temporarily switched to Google Free.`, 6000);
          },
          onPartialFailure: ({ failed, total }) => {
            // Forward lines self-heal in the background within a minute;
            // lines already played need Stop then Start to fix.
            ctx.showToast(`⚠️ ${failed}/${total} lines hit the free translation limit and show original text. Upcoming lines retry automatically; press Stop then Start to fix earlier lines.`, 7000);
          },
        });
      } catch (err) {
        ctx.setActivePipeline?.(null);
        if (token !== ctx.getPageToken()) {
          pipeline.stop();
          return { ok: false, error: "Cancelled before captions loaded." };
        }
        // Loud failure: keep the overlay with an error state instead of
        // removing it silently — the translating phase must never stall mute.
        const message = err?.message || String(err);
        ctx.setStatusText("Caption failed");
        ctx.setOverlayState("error");
        ctx.setTargetText(`Could not translate captions: ${message}`);
        ctx.showToast(`Caption failed: ${message} — press Stop then Start to retry.`, 8000);
        ctx.onStateChange({ running: false, paused: false, status: "Caption error", errorMessage: message });
        return { ok: false, error: message };
      } finally {
        ctx.setActivePipeline?.(null);
      }

      if (token !== ctx.getPageToken()) {
        pipeline.stop();
        return { ok: false, error: "Cancelled before captions loaded." };
      }

      if (!result?.ok) {
        return this.startCaptionDomFallback(
          video,
          token,
          pipeline,
          result?.error || "Could not load captions.",
          result?.diagnostics,
          ctx
        );
      }

      const session = {
        token,
        type: "caption",
        pipeline,
        captionTimer: null,
        lastCueIndex: -1,
        kymaKey: null,
        stream: null,
        pc: null,
        dc: null,
      };
      ctx.onSessionCreated(session);
      ctx.setCurrentTexts("", "");

      ctx.setStatusText(window.LumeoCaptionPipeline.describeCaptionQuality?.(result.meta) || (result.meta?.nativeTarget ? "Native captions" : "Caption Free"));
      ctx.setOverlayState("live");
      ctx.getTranscriptController()?.renderCaptionTranscript(result.cues || pipeline.cues || []);
      ctx.applyTierToolbar();
      ctx.onStateChange({ running: true, paused: false, status: "Captioning" });

      const elements = ctx.getElements();

      const tick = () => {
        const currentSession = ctx.getSession();
        if (currentSession?.type !== "caption" || currentSession.token !== token) return;
        if (video.paused) return;
        const liveSettings = ctx.getSettings() || settings;
        const orchestrator = window.LumeoCaptionOrchestrator;
        const mediaNow = Number(video?.currentTime) || 0;
        const current = pipeline.cueAt(mediaNow);

        // While the current line is on screen, synthesize the next one or two
        // lines. Network TTS then starts on the cue boundary instead of after a
        // round-trip, which is what made the voice trail the subtitle.
        if (current.cue) {
          for (let offset = 1; offset <= 2; offset += 1) {
            const upcoming = pipeline.cues?.[current.index + offset];
            if (!upcoming) break;
            if (Number(upcoming.start) - mediaNow > 14) break;
            orchestrator.prefetchCueSpeech(
              upcoming,
              pipeline.cues?.[current.index + offset + 1],
              liveSettings,
              video,
              ctx,
              currentSession,
            );
          }
        }

        orchestrator.speakDueCue({ pipeline, video, settings: liveSettings, session: currentSession, ctx });

        // Keyed on the text as well as the index: a translation that lands
        // while its line is already on screen must replace the source text.
        const displayKey = current.cue
          ? `${current.index}\u0001${current.cue.translated || ""}`
          : "";
        if (displayKey === currentSession.lastCueKey) return;
        currentSession.lastCueKey = displayKey;
        currentSession.lastCueIndex = current.index;

        if (!current.cue) {
          ctx.setCurrentTexts("", "");
          ctx.setTargetCue(null);
          if (elements.source) elements.source.textContent = "";
          ctx.getTranscriptController()?.updateCaptionTranscriptHighlight(-1);
          return;
        }

        const sourceText = current.cue.text;
        const targetText = current.cue.translated || current.cue.text;
        ctx.setCurrentTexts(sourceText, targetText);
        ctx.setTargetCue(current.cue);

        if (elements.source && liveSettings.showSource) {
          elements.source.textContent = sourceText.slice(-260);
        }
        ctx.getTranscriptController()?.updateCaptionTranscriptHighlight(current.index);
      };

      session.captionTimer = setInterval(tick, CAPTION_TICK_MS);
      tick();

      const resetSpeech = () => {
        window.LumeoTTS?.stop?.();
        const currentSession = ctx.getSession();
        if (currentSession?.token !== token) return;
        // A line that was cut off may be spoken again; one that already
        // finished must not repeat.
        if (currentSession.lastSpokenKey !== currentSession.finishedSpeechKey) {
          currentSession.lastSpokenKey = null;
        }
      };
      ctx.setYTPauseHandler(() => {
        resetSpeech();
        ctx.setStatusText("Paused");
        ctx.setOverlayState("paused");
        ctx.onStateChange({ paused: true, status: "Paused" });
      });
      ctx.setYTPlayHandler(() => {
        ctx.setStatusText("Captioning");
        ctx.setOverlayState("live");
        ctx.onStateChange({ paused: false, status: "Captioning" });
      });
      // Without this the voice keeps reading the old position after a seek
      // and every line queued behind it starts late.
      ctx.setYTSeekHandler?.(() => {
        window.LumeoTTS?.stop?.();
        const currentSession = ctx.getSession();
        if (currentSession?.token !== token) return;
        currentSession.lastSpokenKey = null;
        currentSession.finishedSpeechKey = null;
      });
      return { ok: true };
    }
  };
})();
