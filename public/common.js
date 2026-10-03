// Gemeinsame Helfer für Prompter und Panel
(function () {
  'use strict';

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

  // **fett**, *kursiv*, ==markiert==, [Regieanweisung]
  function inline(s) {
    return esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+?)\*/g, '<em>$1</em>')
      .replace(/==(.+?)==/g, '<mark>$1</mark>')
      .replace(/\[([^\]\n]{1,48})\]/g, '<span class="cue">$1</span>');
  }

  // Zielzeit am Ende einer Überschrift: {2:00}, {1:30:00}, {90s}, {2m}, {1.5h}
  const TARGET_RE = /\s*\{\s*(\d{1,3}(?::\d{1,2}){0,2}|\d+(?:[.,]\d+)?\s*[smh])\s*\}\s*$/i;
  function targetSeconds(v) {
    const u = v.slice(-1).toLowerCase();
    if ('smh'.includes(u)) return Math.round(parseFloat(v.replace(',', '.')) * (u === 'h' ? 3600 : u === 'm' ? 60 : 1));
    return v.split(':').reduce((a, p) => a * 60 + Number(p), 0);
  }

  function renderScript(md) {
    const out = [];
    const sections = [];
    let para = [];
    const flush = () => {
      if (para.length) out.push(`<p dir="auto">${para.map(inline).join('<br>')}</p>`);
      para = [];
    };
    for (const raw of String(md || '').replace(/\r\n?/g, '\n').split('\n')) {
      const line = raw.trimEnd();
      const h = /^(#{1,3})\s+(.*)$/.exec(line);
      if (h) {
        flush();
        const level = h[1].length;
        let title = h[2];
        let target = 0;
        const tm = TARGET_RE.exec(title);
        if (tm) {
          target = targetSeconds(tm[1].replace(/\s+/g, ''));
          title = title.slice(0, tm.index);
        }
        sections.push({ title, level, target });
        const chip = target ? `<span class="tgt">${fmtDur(target * 1000)}</span>` : '';
        out.push(`<h${level} dir="auto" data-sec="${sections.length - 1}">${inline(title)}${chip}</h${level}>`);
      } else if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
        flush();
        out.push('<hr>');
      } else if (!line.trim()) {
        flush();
      } else {
        para.push(line);
      }
    }
    flush();
    return { html: out.join('\n'), sections };
  }

  function renderNotes(text) {
    return String(text || '')
      .split('\n')
      .map((l) => (l.trim() ? `<div class="nl" dir="auto">${inline(l)}</div>` : '<div class="nl gap"></div>'))
      .join('');
  }

  function fmtDur(ms) {
    const t = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = String(t % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }

  // Run of Show: liegt der aktuelle Abschnitt vor oder hinter dem Zeitplan?
  // sec = live.section, elapsed = aktuelle Laufzeit des Show-Timers (ms). Ergebnis delta > 0 = Rückstand.
  function runOfShow(sections, sec, elapsed) {
    if (!sec || !sections || !sections.some((s) => s.target)) return null;
    const cur = sections[sec.index];
    if (!cur) return null;
    const planned = sections.slice(sec.baseIndex, sec.index).reduce((n, s) => n + (s.target || 0), 0) * 1000;
    const inSec = Math.max(0, elapsed - sec.at);
    const target = (cur.target || 0) * 1000;
    const delta = sec.at - sec.base - planned + (target ? Math.max(0, inSec - target) : 0);
    return { title: cur.title, inSec, target, delta };
  }

  // Show-Timer: Laufzeit und – bei Countdown – Restzeit
  function showClock(show, timers, now) {
    const elapsed = show.acc + (show.running ? now - show.startedAt : 0);
    const total = (timers.minutes || 0) * 60000;
    return { elapsed, total, left: total ? total - elapsed : null, started: show.running || show.acc > 0 };
  }

  const fmtSigned = (ms) => `${ms < 0 ? '−' : '+'}${fmtDur(Math.abs(ms))}`;

  async function api(path, body) {
    const init = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    const res = await fetch(path, init);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // Server-Sent Events mit automatischem Wiederverbinden
  function connect(role, handlers) {
    let es;
    const open = () => {
      es = new EventSource(`/events?role=${role}`);
      for (const [name, fn] of Object.entries(handlers)) {
        if (name.startsWith('_')) continue;
        es.addEventListener(name, (e) => {
          try {
            fn(JSON.parse(e.data));
          } catch (err) {
            console.error(`[${name}]`, err);
          }
        });
      }
      es.onopen = () => handlers._online && handlers._online(true);
      es.onerror = () => {
        if (handlers._online) handlers._online(false);
        if (es.readyState === EventSource.CLOSED) setTimeout(open, 3000);
      };
    };
    open();
  }

  window.Glanceline = {
    esc,
    inline,
    renderScript,
    renderNotes,
    fmtDur,
    fmtSigned,
    runOfShow,
    showClock,
    api,
    connect,
    action: (type, extra) => api('/api/action', { type, ...(extra || {}) }),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
})();
