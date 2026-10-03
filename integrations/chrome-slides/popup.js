const de = /^de/.test(navigator.language);
const T = de
  ? {
      steps: ['Glanceline starten.', 'In Google Slides auf „Präsentation“ klicken.', 'Beim Präsentieren „S“ drücken (Vortragsnotizen).'],
      waiting: 'Noch keine Präsentation erkannt.',
      sent: (s) => `Folie ${s.slide} von ${s.total} gesendet${s.presentation ? ` · ${s.presentation}` : ''}`,
      failed: (e) => `Glanceline nicht erreichbar (${e}) – läuft es?`,
      ended: 'Präsentation beendet.',
      url: 'Glanceline-Adresse',
    }
  : {
      steps: ['Start Glanceline.', 'In Google Slides click “Slideshow”.', 'While presenting press “S” (speaker notes).'],
      waiting: 'No presentation detected yet.',
      sent: (s) => `Sent slide ${s.slide} of ${s.total}${s.presentation ? ` · ${s.presentation}` : ''}`,
      failed: (e) => `Glanceline not reachable (${e}) – is it running?`,
      ended: 'Presentation ended.',
      url: 'Glanceline address',
    };

const $ = (id) => document.getElementById(id);
$('steps').innerHTML = T.steps.map((s) => `<li>${s}</li>`).join('');
$('urlLabel').textContent = T.url;

async function render() {
  const { status } = await chrome.storage.session.get('status');
  const el = $('state');
  el.className = 'state';
  if (!status) el.textContent = T.waiting;
  else if (!status.ok) {
    el.textContent = T.failed(status.error);
    el.classList.add('bad');
  } else if (!status.running) el.textContent = T.ended;
  else {
    el.textContent = `✓ ${T.sent(status)}`;
    el.classList.add('ok');
  }
}

chrome.storage.local.get({ url: '' }).then(({ url }) => ($('url').value = url));
$('url').addEventListener('change', (e) => chrome.storage.local.set({ url: e.target.value.trim() }));
render();
setInterval(render, 1000);
