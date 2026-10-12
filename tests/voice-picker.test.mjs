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

  it("renders caption natural voice options with auto pairing and custom voice support", () => {
    api.populate(select, "caption", { captionTtsProvider: "browser" });
    expect(optionValues(select)).toContain("auto");
    expect(optionValues(select)).toContain("off");
    expect(optionLabels(select)).toContain("Auto (No en voice installed — uses default)");
    expect(select.value).toBe("auto");
    expect(select.getAttribute("aria-label")).toBe("Caption speech voice");

    // When custom-voice-engine is active
    api.populate(select, "caption", { captionTtsProvider: "custom-voice-engine", customTtsVoiceId: "21m00Tcm4TlvDq8ikWAM" });
    expect(optionValues(select)).toEqual(["custom-voice-engine", "off"]);
    expect(optionLabels(select)[0]).toContain("Custom Voice");
    expect(select.value).toBe("custom-voice-engine");
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

  it("prioritizes natural voices and cleans voice labels for Vietnamese", () => {
    const mockVoices = [
      { name: "Microsoft HoaiMy Online (Natural) - Vietnamese (Vietnam)", lang: "vi-VN" },
      { name: "Google tiếng Việt", lang: "vi-VN" },
      { name: "Microsoft An (Standard)", lang: "vi-VN" },
      { name: "Microsoft David", lang: "en-US" },
    ];
    const top = api.getTopVoicesForLanguage("vi", mockVoices);
    expect(top).toHaveLength(3);
    expect(top[0].name).toContain("HoaiMy");
    expect(top[1].name).toContain("Google");
    expect(api.cleanVoiceLabel(top[0].name)).toBe("HoaiMy (Natural)");
    expect(api.cleanVoiceLabel(top[1].name)).toBe("Google tiếng Việt");
  });

  it("filters popup list to only the selected translation language", () => {
    const { window: win } = { window: select.ownerDocument.defaultView };
    win.speechSynthesis = {
      getVoices: () => [
        { name: "Microsoft Premwadee Online (Natural) - Thai (Thailand)", lang: "th-TH" },
        { name: "Google ภาษาไทย", lang: "th-TH" },
        { name: "Microsoft HoaiMy Online (Natural) - Vietnamese (Vietnam)", lang: "vi-VN" },
        { name: "Google US English", lang: "en-US" },
      ],
    };
    api.populate(select, "caption", { targetLanguage: "th", captionTtsProvider: "browser" });
    const values = optionValues(select);
    const labels = optionLabels(select).join(" ");
    expect(values).toContain("auto");
    expect(values).toContain("off");
    expect(labels).toContain("Premwadee");
    expect(labels).not.toContain("HoaiMy");
    expect(labels).not.toContain("US English");
  });

  it("prefers full-tag zh-CN over zh-TW and matches fil/tl aliases", () => {
    const voices = [
      { name: "Voice TW", lang: "zh-TW" },
      { name: "Voice CN", lang: "zh-CN" },
    ];
    expect(api.getTopVoicesForLanguage("zh-CN", voices)[0].lang).toBe("zh-CN");
    expect(api.autoPairVoice("zh-CN", voices).lang).toBe("zh-CN");
    expect(api.getTopVoicesForLanguage("fil", [{ name: "Tagalog Voice", lang: "tl-PH" }])).toHaveLength(1);
  });

  it("signals empty state and drops stale cross-language voice picks", () => {
    const { window: win } = { window: select.ownerDocument.defaultView };
    win.speechSynthesis = { getVoices: () => [] };
    api.populate(select, "caption", { targetLanguage: "lo", captionTtsProvider: "browser" });
    expect(optionLabels(select).join(" ")).toContain("No lo voice installed");

    win.speechSynthesis = {
      getVoices: () => [{ name: "Google tiếng Việt", lang: "vi-VN" }],
    };
    api.populate(select, "caption", { targetLanguage: "vi", captionTtsProvider: "browser", standardVoice: "Stale Other-Lang Voice" });
    expect(select.value).toBe("auto");
  });
});
