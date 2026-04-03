// Background service worker - fetch subtitle proxy + Soniox WebSocket
let sonioxWs = null, sonioxTabId = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'fetchUrl') {
    fetch(msg.url)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
      .then(text => sendResponse({ ok: true, text }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.action === 'fetchJSON') {
    fetch(msg.url, {
      method: msg.method || 'GET',
      headers: msg.headers || {},
      body: msg.body || undefined
    })
      .then(async r => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) sendResponse({ ok: false, error: data?.error?.message || `HTTP ${r.status}` });
        else sendResponse({ ok: true, data });
      })
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.action === 'startSonioxWs') {
    sonioxTabId = sender.tab?.id;
    startSonioxWebSocket(msg.apiKey, msg.langHints);
    sendResponse({ ok: true });
  }

  if (msg.action === 'sonioxAudio') {
    // Receive PCM audio chunk from content script, forward to Soniox
    if (sonioxWs?.readyState === WebSocket.OPEN) {
      sonioxWs.send(new Int16Array(msg.samples).buffer);
    }
  }

  if (msg.action === 'stopSonioxWs') {
    closeSonioxWebSocket();
    sendResponse({ ok: true });
  }
});

function startSonioxWebSocket(apiKey, langHints) {
  closeSonioxWebSocket();

  sonioxWs = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket');

  sonioxWs.onopen = () => {
    sonioxWs.send(JSON.stringify({
      api_key: apiKey,
      model: 'stt-rt-preview',
      audio_format: 'pcm_s16le',
      sample_rate: 16000,
      num_channels: 1,
      language_hints: langHints || [],
      enable_endpoint_detection: true,
      enable_language_identification: true
    }));
    forwardToTab({ action: 'sonioxStatus', status: 'connected' });
  };

  sonioxWs.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.error_code) {
        forwardToTab({ action: 'sonioxError', error: `${data.error_code}: ${data.error_message}` });
        closeSonioxWebSocket();
        return;
      }
      forwardToTab({ action: 'sonioxResult', data });
    } catch {}
  };

  sonioxWs.onerror = () => {
    forwardToTab({ action: 'sonioxError', error: 'WebSocket connection failed' });
  };

  sonioxWs.onclose = () => {
    forwardToTab({ action: 'sonioxResult', data: { tokens: [], finished: true } });
    sonioxWs = null;
  };
}

function closeSonioxWebSocket() {
  if (sonioxWs) {
    try { if (sonioxWs.readyState === WebSocket.OPEN) sonioxWs.send(''); } catch {}
    sonioxWs.close();
    sonioxWs = null;
  }
}

function forwardToTab(msg) {
  if (sonioxTabId) chrome.tabs.sendMessage(sonioxTabId, msg).catch(() => {});
}
