'use strict';

// Netzwerkzugriff für Chat-Dienste. In der Desktop-App läuft er über Chromiums Netzwerk (Electron „net“):
// Kick blockt Anfragen, die nicht wie ein Browser aussehen. Ohne Electron (npm run server) bleibt fetch.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const TIMEOUT_MS = 15000;

let electronNet = null;
if (process.versions.electron) {
  try {
    const { net, app } = require('electron');
    if (net && app) electronNet = { net, app };
  } catch { /* kein Electron-Hauptprozess */ }
}

const inBrowserStack = () => Boolean(electronNet && electronNet.app.isReady());

// browser: true → über Chromium (nur nötig, wo normale Anfragen geblockt werden)
function webFetch(url, opts = {}) {
  const headers = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...(opts.headers || {}) };
  const { browser, ...rest } = opts;
  const init = { ...rest, headers, signal: opts.signal || AbortSignal.timeout(TIMEOUT_MS) };
  if (browser && inBrowserStack()) {
    delete init.headers['User-Agent']; // Chromium setzt seinen eigenen
    return electronNet.net.fetch(url, init);
  }
  return fetch(url, init);
}

async function getJson(url, opts) {
  const res = await webFetch(url, { ...opts, headers: { Accept: 'application/json', ...((opts && opts.headers) || {}) } });
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

module.exports = { webFetch, getJson, inBrowserStack, UA };
