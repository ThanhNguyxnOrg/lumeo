// pipelines/caption-orchestrator.js

(() => {
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
      const [translated] = await window.LumeoTranslate.translateBatch([text], settings.targetLanguage || "vi", {
        provider: settings.translateProvider || "google-free",
        targetLanguageName: ctx.getLangName(settings.targetLanguage) || settings.targetLanguage || "Vietnamese",
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
          targetLanguage: settings.targetLanguage || "vi",
          googleCloudKey: settings.googleCloudKey,
          openaiKey: settings.openaiKey,
          rate: settings.ttsRate || 1,
          volume: Math.min((settings.voiceVolume ?? 100) / 100, 1),
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
      if (!elements.target) return;
      elements.target.textContent = "";

      const wrap = window.LumeoCaptionFallbackChoice.create({
        reason,
        diagnostics,
        onGroq: () => this.startGroqChoice(video, token, pipeline, reason, ctx),
        onSoniox: () => this.startSonioxChoice(video, token, pipeline, reason, ctx),
        onStandard: () => ctx.onSwitchToStandard(pipeline),
        onRetry: () => this.retryCaptionChoice(pipeline, ctx),
        onCancel: () => ctx.onSessionEnded("caption-fallback-cancel", "Caption fallback cancelled."),
      });
      elements.target.appendChild(wrap);

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

    async startGroqChoice(video, token, pipeline, reason, ctx) {
      const settings = ctx.getSettings();
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
        ctx.onOpenPopup("stt");
        return;
      }
      const reply = await this.startCaptionGroqFallback(video, token, pipeline, reason, ctx);
      if (!reply?.ok) {
        ctx.showToast(reply?.error || "Could not start Groq Whisper fallback.", 7000);
        ctx.onStateChange({ running: false, status: "Groq error", errorMessage: reply?.error || "Groq error" });
      }
    },

    async startSonioxChoice(video, token, pipeline, reason, ctx) {
      const settings = ctx.getSettings();
      if (!settings.sonioxApiKey) {
        ctx.showToast("Add a Soniox key in the popup marketplace.", 7000);
        ctx.onStateChange({
          running: true,
          status: "Add Soniox key",
          errorMessage: "",
          errorCode: "missing-caption-track",
          missingProviders: ["soniox"],
          slotsMissingKeys: ["stt"],
        });
        ctx.onOpenPopup("stt");
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
        if (elements.source && settings.showSource) elements.source.textContent = cue.text.slice(-260);

        transcript?.appendCaptionRow(cue, latestSession.cues.length - 1);
        transcript?.updateCaptionTranscriptCount(latestSession.cues.length);
        transcript?.updateCaptionTranscriptHighlight(latestSession.cues.length - 1);

        if (settings.captionTtsProvider && settings.captionTtsProvider !== "off") {
          pipeline.speakCue(cue, {
            provider: settings.captionTtsProvider,
            targetLanguage: settings.targetLanguage || "vi",
            googleCloudKey: settings.googleCloudKey,
            openaiKey: settings.openaiKey,
            rate: settings.ttsRate || 1,
            volume: Math.min((settings.voiceVolume ?? 100) / 100, 1),
          }).catch(() => { });
        }
        ctx.setStatusText("YouTube CC live");
        ctx.setOverlayState("live");
      };

      session.captionTimer = setInterval(() => { void tick(); }, 350);
      void tick();

      ctx.setYTPauseHandler(() => {
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
      ctx.setTargetText("Loading captions...");
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
      const settings = ctx.getSettings();

      let result;
      try {
        result = await pipeline.start({
          targetLanguage: settings.targetLanguage || "vi",
          targetLanguageName: ctx.getLangName(settings.targetLanguage) || settings.targetLanguage || "Vietnamese",
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
          context: settings.translationContext,
          onProgress: (p) => this.updateCaptionProgress(p, ctx),
        });
      } catch (err) {
        ctx.removeOverlay();
        return { ok: false, error: err?.message || String(err) };
      }

      if (token !== ctx.getPageToken()) {
        pipeline.stop();
        ctx.removeOverlay();
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
        const current = pipeline.cueAt(video.currentTime);
        if (current.index === currentSession.lastCueIndex) return;
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

        if (elements.source && settings.showSource) {
          elements.source.textContent = sourceText.slice(-260);
        }
        ctx.getTranscriptController()?.updateCaptionTranscriptHighlight(current.index);

        if (settings.captionTtsProvider && settings.captionTtsProvider !== "off") {
          pipeline.speakCue(current.cue, {
            provider: settings.captionTtsProvider,
            targetLanguage: settings.targetLanguage || "vi",
            googleCloudKey: settings.googleCloudKey,
            openaiKey: settings.openaiKey,
            rate: settings.ttsRate || 1,
            volume: Math.min((settings.voiceVolume ?? 100) / 100, 1),
          }).catch(() => { });
        }
      };

      session.captionTimer = setInterval(tick, 120);
      tick();

      ctx.setYTPauseHandler(() => {
        ctx.setStatusText("Paused");
        ctx.setOverlayState("paused");
        ctx.onStateChange({ paused: true, status: "Paused" });
      });
      ctx.setYTPlayHandler(() => {
        ctx.setStatusText("Captioning");
        ctx.setOverlayState("live");
        ctx.onStateChange({ paused: false, status: "Captioning" });
      });
      return { ok: true };
    }
  };
})();
