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
        sections.push({ title: h[2], level });
        out.push(`<h${level} dir="auto" data-sec="${sections.length - 1}">${inline(h[2])}</h${level}>`);
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
    api,
    connect,
    action: (type, extra) => api('/api/action', { type, ...(extra || {}) }),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
})();
