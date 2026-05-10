(() => {
  "use strict";

  if (window.LumeoSrtExport?.__loaded) return;

  function sanitizeFilename(value, fallback = "lumeo-subtitles") {
    return String(value || fallback)
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || fallback;
  }

  function formatSrtTime(seconds) {
    const totalMs = Math.max(0, Math.round(Number(seconds || 0) * 1000));
    const ms = totalMs % 1000;
    const totalSeconds = Math.floor(totalMs / 1000);
    const s = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const m = totalMinutes % 60;
    const h = Math.floor(totalMinutes / 60);
    return [
      String(h).padStart(2, "0"),
      String(m).padStart(2, "0"),
      String(s).padStart(2, "0"),
    ].join(":") + "," + String(ms).padStart(3, "0");
  }

  function normalizeCue(cue) {
    return {
      start: Number(cue?.start || 0),
      end: Number(cue?.end || cue?.start || 0),
      text: String(cue?.text || ""),
      translated: String(cue?.translated || cue?.target || ""),
    };
  }

  function toSrt(cuesInput, options = {}) {
    const useTranslated = options.translated !== false;
    const cues = (cuesInput || []).map(normalizeCue).filter((cue) => cue.text || cue.translated);
    return cues.map((cue, index) => {
      const text = useTranslated
        ? (cue.translated || cue.text)
        : cue.text;
      return [
        String(index + 1),
        `${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}`,
        text,
        "",
      ].join("\n");
    }).join("\n");
  }

  function makeCRCTable() {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c >>> 0;
    }
    return table;
  }

  const crcTable = makeCRCTable();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (const b of bytes) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function writeU16(view, offset, value) {
    view.setUint16(offset, value, true);
  }

  function writeU32(view, offset, value) {
    view.setUint32(offset, value, true);
  }

  function makeZip(files) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const file of files) {
      const nameBytes = encoder.encode(file.name);
      const dataBytes = encoder.encode(file.content);
      const crc = crc32(dataBytes);

      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      writeU32(lv, 0, 0x04034b50);
      writeU16(lv, 4, 20);
      writeU16(lv, 6, 0);
      writeU16(lv, 8, 0);
      writeU16(lv, 10, 0);
      writeU16(lv, 12, 0);
      writeU32(lv, 14, crc);
      writeU32(lv, 18, dataBytes.length);
      writeU32(lv, 22, dataBytes.length);
      writeU16(lv, 26, nameBytes.length);
      writeU16(lv, 28, 0);
      local.set(nameBytes, 30);
      localParts.push(local, dataBytes);

      const central = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(central.buffer);
      writeU32(cv, 0, 0x02014b50);
      writeU16(cv, 4, 20);
      writeU16(cv, 6, 20);
      writeU16(cv, 8, 0);
      writeU16(cv, 10, 0);
      writeU16(cv, 12, 0);
      writeU16(cv, 14, 0);
      writeU32(cv, 16, crc);
      writeU32(cv, 20, dataBytes.length);
      writeU32(cv, 24, dataBytes.length);
      writeU16(cv, 28, nameBytes.length);
      writeU16(cv, 30, 0);
      writeU16(cv, 32, 0);
      writeU16(cv, 34, 0);
      writeU16(cv, 36, 0);
      writeU32(cv, 38, 0);
      writeU32(cv, 42, offset);
      central.set(nameBytes, 46);
      centralParts.push(central);

      offset += local.length + dataBytes.length;
    }

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    writeU32(ev, 0, 0x06054b50);
    writeU16(ev, 4, 0);
    writeU16(ev, 6, 0);
    writeU16(ev, 8, files.length);
    writeU16(ev, 10, files.length);
    writeU32(ev, 12, centralSize);
    writeU32(ev, 16, offset);
    writeU16(ev, 20, 0);

    return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
  }

  function makeSubtitleZip(cues, title = "video") {
    const safeTitle = sanitizeFilename(title);
    return makeZip([
      { name: `${safeTitle}_original.srt`, content: toSrt(cues, { translated: false }) },
      { name: `${safeTitle}_translated.srt`, content: toSrt(cues, { translated: true }) },
    ]);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  window.LumeoSrtExport = {
    __loaded: true,
    formatSrtTime,
    sanitizeFilename,
    toSrt,
    makeZip,
    makeSubtitleZip,
    downloadBlob,
  };
})();
