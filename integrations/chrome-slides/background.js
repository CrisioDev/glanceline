// Schickt Folie und Notizen an Glanceline (die Seite selbst darf nicht auf localhost zugreifen).
const DEFAULT_URL = 'http://127.0.0.1:4890';

async function post(data) {
  const { url } = await chrome.storage.local.get({ url: DEFAULT_URL });
  const base = (url || DEFAULT_URL).replace(/\/+$/, '');
  const status = { at: Date.now(), slide: data.slide || 0, total: data.total || 0, presentation: data.presentation || '', running: data.running !== false };
  try {
    const res = await fetch(`${base}/api/slides`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    status.ok = res.ok;
    status.error = res.ok ? '' : `HTTP ${res.status}`;
  } catch (e) {
    status.ok = false;
    status.error = e.message;
  }
  await chrome.storage.session.set({ status });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'slides' && msg.data) post(msg.data);
});
