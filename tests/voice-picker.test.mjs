import { describe, it, expect, beforeEach } from "vitest";
import { createSandboxWindow, loadService } from "./helpers/load-service.mjs";

async function setup() {
  const { window } = await createSandboxWindow();
  loadService("ui/voice-picker.js", window);
  const select = window.document.createElement("select");
  window.document.body.appendChild(select);
  return { window, api: window.LumeoVoicePicker, select };
}

function optionValues(select) {
  return Array.from(select.options).map((option) => option.value);
}

function optionLabels(select) {
  return Array.from(select.options).map((option) => option.textContent);
}

describe("ui/voice-picker.js", () => {
  let api;
  let select;

  beforeEach(async () => {
    ({ api, select } = await setup());
  });

  it("renders caption TTS options with accessible copy", () => {
    api.populate(select, "caption", { captionTtsProvider: "browser" });
    expect(optionValues(select)).toEqual(["off", "browser", "google-cloud", "openai-tts"]);
    expect(select.value).toBe("browser");
    expect(select.getAttribute("aria-label")).toBe("Caption speech (read aloud)");
    expect(select.title).toContain("Read translated captions aloud");
  });

  it("renders Standard voices and defaults to Magnetic Man", () => {
    api.populate(select, "standard", {});
    expect(optionValues(select)).toContain("English_magnetic_voiced_man");
    expect(optionLabels(select)).toContain("Magnetic Man");
    expect(select.value).toBe(api.STANDARD_DEFAULT_VOICE);
    expect(select.getAttribute("aria-label")).toBe("Dub voice");
    expect(select.hasAttribute("title")).toBe(false);
  });

  it("honors selected Standard voice", () => {
    api.populate(select, "standard", { standardVoice: "English_ConfidentWoman" });
    expect(select.value).toBe("English_ConfidentWoman");
  });

  it("renders realtime Auto plus named voices", () => {
    api.populate(select, "realtime", { realtimeVoice: "verse" });
    expect(optionValues(select)[0]).toBe("");
    expect(optionLabels(select)[0]).toBe("Auto");
    expect(optionValues(select)).toContain("marin");
    expect(optionLabels(select)).toContain("Marin");
    expect(select.value).toBe("verse");
    expect(select.getAttribute("aria-label")).toBe("Realtime voice");
  });
});
