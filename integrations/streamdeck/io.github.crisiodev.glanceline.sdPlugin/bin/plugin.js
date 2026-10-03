'use strict';
// Glanceline-Plugin für das Elgato Stream Deck – ohne Abhängigkeiten (läuft im Node 20 der Stream-Deck-Software).
// Spricht mit der Stream-Deck-App über WebSocket und mit Glanceline über dessen lokale HTTP-API (siehe docs/API.md).
const http = require('http');
const crypto = require('crypto');

const PREFIX = 'io.github.crisiodev.glanceline.';
const DEFAULT_URL = 'http://127.0.0.1:4890';
const HOLD_DELAY_MS = 350; // ab hier gilt eine Scroll-Taste als gehalten
const RESET_HOLD_MS = 800; // Show-Timer: so lange halten = zurücksetzen

// ---------------------------------------------------------------- Startparameter
const args = {};
for (let i = 2; i < process.argv.length - 1; i += 2) args[process.argv[i].replace(/^-+/, '')] = process.argv[i + 1];
const info = (() => {
  try {
    return JSON.parse(args.info || '{}');
  } catch {
    return {};
  }
})();
const LANG = /^de/.test((info.application && info.application.language) || '') ? 'de' : 'en';
const TEXT = {
  de: { start: 'Start', pause: 'Pause', back: 'Zurück', forward: 'Vor', offline: 'offline', show: 'Show', speed: 'Tempo', blackout: 'Blackout', pick: 'Aktion wählen', mode: 'Modus' },
  en: { start: 'Start', pause: 'Pause', back: 'Back', forward: 'Forward', offline: 'offline', show: 'Show', speed: 'Speed', blackout: 'Blackout', pick: 'Pick an action', mode: 'Mode' },
}[LANG];
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------------------------------------------------------------- Minimaler WebSocket-Client (RFC 6455)
function websocket(port, onOpen, onMessage) {
  let socket = null;
  const frame = (op, data) => {
    const len = data.length;
    let head;
    if (len < 126) head = Buffer.from([0x80 | op, 0x80 | len]);
    else if (len < 65536) head = Buffer.from([0x80 | op, 0x80 | 126, len >> 8, len & 255]);
    else {
      head = Buffer.alloc(10);
      head[0] = 0x80 | op;
      head[1] = 0x80 | 127;
      head.writeBigUInt64BE(BigInt(len), 2);
    }
    const mask = crypto.randomBytes(4); // Clients müssen maskieren
    const body = Buffer.alloc(len);
    for (let i = 0; i < len; i++) body[i] = data[i] ^ mask[i & 3];
    if (socket) socket.write(Buffer.concat([head, mask, body]));
  };
  const send = (obj) => frame(0x1, Buffer.from(JSON.stringify(obj)));

  const req = http.request({
    host: '127.0.0.1',
    port: Number(port),
    path: '/',
    headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'), 'Sec-WebSocket-Version': '13' },
  });
  req.on('upgrade', (res, sock, head) => {
    socket = sock;
    let buf = head;
    let parts = [];
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 2) {
        const fin = (buf[0] & 0x80) !== 0;
        const op = buf[0] & 0x0f;
        let len = buf[1] & 0x7f;
        let off = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          off = 4;
        } else if (len === 127) {
          if (buf.length < 10) return;
          len = Number(buf.readBigUInt64BE(2));
          off = 10;
        }
        const masked = (buf[1] & 0x80) !== 0;
        const key = masked ? buf.subarray(off, off + 4) : null;
        if (masked) off += 4;
        if (buf.length < off + len) return;
        const payload = Buffer.from(buf.subarray(off, off + len));
        if (key) for (let i = 0; i < payload.length; i++) payload[i] ^= key[i & 3];
        buf = buf.subarray(off + len);
        if (op === 0x8) process.exit(0); // Stream Deck beendet das Plugin
        else if (op === 0x9) frame(0xa, payload);
        else if (op === 0x1 || op === 0x0) {
          parts.push(payload);
          if (fin) {
            const text = Buffer.concat(parts).toString('utf8');
            parts = [];
            try {
              onMessage(JSON.parse(text));
            } catch (e) {
              log('message error', e.message);
            }
          }
        }
      }
    });
    sock.on('close', () => process.exit(0));
    onOpen();
  });
  req.on('error', (e) => {
    log('stream deck connection failed', e.message);
    process.exit(1);
  });
  req.end();
  return send;
}

// ---------------------------------------------------------------- Glanceline
const gl = { url: DEFAULT_URL, live: null, settings: null, online: false, catalog: null, abort: null };

function apiUrl(path) {
  let base;
  try {
    base = new URL(gl.url || DEFAULT_URL);
  } catch {
    base = new URL(DEFAULT_URL);
  }
  const out = new URL(path, base.origin);
  const token = base.searchParams.get('t'); // Zugriff von einem anderen PC: Link mit Token aus dem Panel
  if (token) out.searchParams.set('t', token);
  return out.toString();
}

async function glAction(type, extra) {
  try {
    const res = await fetch(apiUrl('/api/action'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, ...(extra || {}), source: 'streamdeck' }),
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function loadCatalog() {
  try {
    const res = await fetch(apiUrl(`/api/actions?lang=${LANG}`), { signal: AbortSignal.timeout(4000) });
    if (res.ok) gl.catalog = await res.json();
  } catch { /* später erneut */ }
}

// Live-Zustand per Server-Sent Events – bricht die Verbindung ab, wird neu verbunden
async function followEvents() {
  for (;;) {
    const abort = new AbortController();
    gl.abort = abort;
    try {
      const res = await fetch(apiUrl('/events?role=api'), { headers: { Accept: 'text/event-stream' }, signal: abort.signal });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          let ev = 'message';
          let data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) ev = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (data) onGlanceline(ev, JSON.parse(data));
        }
      }
    } catch (e) {
      if (!abort.signal.aborted) log('glanceline events', e.message);
    }
    if (gl.online) {
      gl.online = false;
      scheduleRender();
      notifyInspectors();
    }
    if (!abort.signal.aborted) await new Promise((r) => setTimeout(r, 3000)); // Adresswechsel: sofort neu verbinden
  }
}

function onGlanceline(ev, data) {
  if (ev === 'init') {
    gl.settings = data.settings;
    gl.live = data.live;
    gl.clockOffset = data.live.now - Date.now();
    if (!gl.online) {
      gl.online = true;
      loadCatalog().then(() => {
        scheduleRender();
        notifyInspectors();
      });
    }
  } else if (ev === 'live') {
    gl.live = data;
    gl.clockOffset = data.now - Date.now();
  } else if (ev === 'settings') {
    gl.settings = data;
  } else return;
  scheduleRender();
}

// ---------------------------------------------------------------- Tastenbilder (SVG)
const ICONS = {
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  script: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="14" y2="17"/>',
  obs: '<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14"/>',
  ppt: '<path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/>',
  camera: '<path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
  play: '<polygon points="6 4 20 12 6 20 6 4"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  up: '<polyline points="18 15 12 9 6 15"/>',
  down: '<polyline points="6 9 12 15 18 9"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>',
  blackout: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>',
  any: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  speed: '<path d="M12 14l4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
};
const COLORS = { idle: '#211c19', on: '#7d3b34', warn: '#a35f00', over: '#b3261e', off: '#2a2522' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Lange Beschriftungen auf zwei Zeilen verteilen (möglichst gleich lang)
function splitLabel(label) {
  const words = label.split(' ');
  if (label.length <= 10 || words.length < 2) return [label];
  let best = [label];
  let score = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    if (Math.max(a.length, b.length) < score) {
      score = Math.max(a.length, b.length);
      best = [a, b];
    }
  }
  return best;
}

function keyImage({ icon, label, sub, tone = 'idle', dim = false }) {
  const fg = dim ? '#8c837a' : '#f4ede4';
  const font = 'font-family="Segoe UI, Helvetica, Arial, sans-serif"';
  const big = label && label.length <= 6 && /\d/.test(label); // Zeitangaben groß
  const lines = label ? splitLabel(label) : [];
  const longest = Math.max(0, ...lines.map((l) => l.length));
  const size = big ? 40 : Math.max(13, Math.min(23, Math.floor(134 / (longest * 0.6))));
  const two = lines.length > 1;
  const iconY = !label ? 40 : big ? 14 : two ? 12 : 22;
  const iconScale = big || two ? 1.6 : 2;
  const iconX = 72 - 12 * iconScale;
  const firstY = big ? (sub ? 104 : 112) : two ? (sub ? 80 : 92) : sub ? 98 : 110;
  const text = lines.map((l, i) => `<tspan x="72" y="${firstY + i * (size + 3)}">${esc(l)}</tspan>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
<rect width="144" height="144" fill="${COLORS[tone]}"/>
<g transform="translate(${iconX} ${iconY}) scale(${iconScale})" fill="none" stroke="${fg}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon] || ''}</g>
${label ? `<text text-anchor="middle" ${font} font-weight="700" font-size="${size}" fill="${fg}">${text}</text>` : ''}
${sub ? `<text x="72" y="128" text-anchor="middle" ${font} font-weight="600" font-size="17" fill="${fg}" opacity=".75">${esc(sub)}</text>` : ''}
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

// ---------------------------------------------------------------- Zustand → Taste
const fmtDur = (ms) => {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};
const now = () => Date.now() + (gl.clockOffset || 0);
const actionLabel = (type) => {
  const a = gl.catalog && gl.catalog.actions.find((x) => x.type === type);
  return a ? a.label : type;
};
const modeLabel = (id) => {
  const m = gl.catalog && gl.catalog.modes.find((x) => x.id === id);
  return m ? m.label : id;
};

function showClock() {
  const sh = (gl.live && gl.live.show) || { running: false, acc: 0, startedAt: 0 };
  const tm = (gl.settings && gl.settings.timers) || { minutes: 0, warn: 2 };
  const elapsed = sh.acc + (sh.running ? now() - sh.startedAt : 0);
  const total = (tm.minutes || 0) * 60000;
  return { elapsed, left: total ? total - elapsed : null, running: sh.running, warn: (tm.warn || 0) * 60000 };
}

// Aktionen mit sichtbarem An/Aus-Zustand
function actionActive(type) {
  const L = gl.live;
  const S = gl.settings;
  if (!L || !S) return false;
  if (type === 'passthrough') return L.passthrough;
  if (type === 'blackout') return L.blackout;
  if (type === 'chat:pause') return L.chat && L.chat.paused;
  if (type === 'voice:toggle') return S.voice.enabled;
  if (type === 'camera:toggle') return S.camera.enabled;
  if (type === 'script:toggle') return L.script.playing;
  if (type === 'show:toggle') return L.show && L.show.running;
  if (/^insert:\d$/.test(type)) return Boolean(L.insert && String(L.insert.slot) === type.slice(7));
  if (type.startsWith('mode:')) return L.mode === type.slice(5);
  return false;
}

function render(inst) {
  const L = gl.live;
  if (!gl.online || !L || !gl.settings) {
    const icon = { mode: inst.settings.mode || 'script', play: 'play', scroll: inst.settings.dir === 'back' ? 'up' : 'down', timer: 'timer', blackout: 'blackout', action: 'any', speed: 'speed' }[inst.kind];
    return { image: keyImage({ icon, label: '', sub: TEXT.offline, tone: 'off', dim: true }), feedback: { title: TEXT.speed, value: TEXT.offline, indicator: { value: 0 } } };
  }
  const sc = L.script || {};
  const speed = gl.settings.script.speed;
  switch (inst.kind) {
    case 'mode': {
      const mode = inst.settings.mode || 'script';
      return { image: keyImage({ icon: mode, label: modeLabel(mode), tone: L.mode === mode && !L.blackout ? 'on' : 'idle' }) };
    }
    case 'play': {
      const pct = sc.max > 0 ? Math.round((sc.pos / sc.max) * 100) : 0;
      return { image: keyImage({ icon: sc.playing ? 'pause' : 'play', label: sc.playing ? TEXT.pause : TEXT.start, sub: `${pct} % · ${speed}`, tone: sc.playing ? 'on' : 'idle' }) };
    }
    case 'scroll': {
      const back = inst.settings.dir === 'back';
      return { image: keyImage({ icon: back ? 'up' : 'down', label: back ? TEXT.back : TEXT.forward, tone: inst.down ? 'on' : 'idle' }) };
    }
    case 'timer': {
      const c = showClock();
      const over = c.left != null && c.left < 0;
      const label = c.left == null ? fmtDur(c.elapsed) : over ? `+${fmtDur(-c.left)}` : fmtDur(c.left);
      const tone = over ? 'over' : c.left != null && c.left <= c.warn && c.running ? 'warn' : c.running ? 'on' : 'idle';
      return { image: keyImage({ icon: 'timer', label, sub: TEXT.show, tone }) };
    }
    case 'blackout':
      return { image: keyImage({ icon: 'blackout', label: TEXT.blackout, tone: L.blackout ? 'over' : 'idle' }) };
    case 'action': {
      const type = inst.settings.type;
      if (!type) return { image: keyImage({ icon: 'any', label: '', sub: TEXT.pick, dim: true }) };
      return { image: keyImage({ icon: 'any', label: actionLabel(type), tone: actionActive(type) ? 'on' : 'idle' }) };
    }
    case 'speed':
      return {
        image: keyImage({ icon: 'speed', label: `${speed}`, sub: 'px/s', tone: sc.playing ? 'on' : 'idle' }),
        feedback: { title: TEXT.speed, value: `${speed} px/s${sc.playing ? ' ▶' : ''}`, indicator: { value: Math.round(Math.min(1, speed / 300) * 100) } },
      };
    default:
      return { image: keyImage({ icon: 'any', label: '?' }) };
  }
}

// ---------------------------------------------------------------- Stream Deck
const instances = new Map(); // context → { kind, settings, controller, down, … }
let sd = () => {};

function paint(context) {
  const inst = instances.get(context);
  if (!inst) return;
  const out = render(inst);
  if (inst.controller === 'Encoder' && out.feedback) {
    const fb = JSON.stringify(out.feedback);
    if (fb !== inst.lastFeedback) {
      inst.lastFeedback = fb;
      sd({ event: 'setFeedback', context, payload: out.feedback });
    }
  }
  if (out.image !== inst.lastImage) {
    inst.lastImage = out.image;
    sd({ event: 'setImage', context, payload: { image: out.image, target: 0 } });
  }
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  setTimeout(() => {
    renderQueued = false;
    for (const ctx of instances.keys()) paint(ctx);
  }, 120);
}
setInterval(scheduleRender, 1000); // laufende Uhren

function notifyInspectors() {
  for (const [context, inst] of instances) {
    if (!inst.inspector) continue;
    sd({ event: 'sendToPropertyInspector', action: inst.uuid, context, payload: { online: gl.online, url: gl.url, catalog: gl.catalog } });
  }
}

async function press(context, inst) {
  const s = inst.settings;
  let ok = true;
  switch (inst.kind) {
    case 'mode':
      ok = await glAction(`mode:${s.mode || 'script'}`);
      break;
    case 'play':
    case 'speed':
      ok = await glAction('script:toggle');
      break;
    case 'scroll': {
      const dir = s.dir === 'back' ? -1 : 1;
      ok = await glAction(dir > 0 ? 'view:forward' : 'view:back', { target: 'script', amount: 'line' });
      clearTimeout(inst.holdDelay);
      inst.holdDelay = setTimeout(() => {
        inst.holding = setInterval(() => glAction('script:hold', { dir }), 150);
        glAction('script:hold', { dir });
      }, HOLD_DELAY_MS);
      break;
    }
    case 'timer':
      inst.resetTimer = setTimeout(async () => {
        inst.resetDone = true;
        if (await glAction('show:reset')) sd({ event: 'showOk', context });
      }, RESET_HOLD_MS);
      return;
    case 'blackout':
      ok = await glAction('blackout');
      break;
    case 'action':
      if (!s.type) return sd({ event: 'showAlert', context });
      ok = await glAction(s.type);
      break;
    default:
  }
  if (!ok) sd({ event: 'showAlert', context });
}

function release(context, inst) {
  if (inst.kind === 'scroll') {
    clearTimeout(inst.holdDelay);
    if (inst.holding) {
      clearInterval(inst.holding);
      inst.holding = null;
      glAction('script:hold', { dir: 0 });
    }
  } else if (inst.kind === 'timer') {
    clearTimeout(inst.resetTimer);
    if (!inst.resetDone) glAction('show:toggle').then((ok) => ok || sd({ event: 'showAlert', context }));
    inst.resetDone = false;
  }
}

function onStreamDeck(msg) {
  const { event, context, action, payload } = msg;
  const kind = action ? action.slice(PREFIX.length) : '';
  switch (event) {
    case 'willAppear':
      instances.set(context, { kind, uuid: action, settings: payload.settings || {}, controller: payload.controller || 'Keypad' });
      paint(context);
      break;
    case 'willDisappear': {
      const inst = instances.get(context);
      if (inst) release(context, inst);
      instances.delete(context);
      break;
    }
    case 'didReceiveSettings': {
      const inst = instances.get(context);
      if (inst) {
        inst.settings = payload.settings || {};
        inst.lastImage = null;
        paint(context);
      }
      break;
    }
    case 'didReceiveGlobalSettings': {
      const url = (payload.settings && payload.settings.url) || DEFAULT_URL;
      if (!gl.started) {
        gl.started = true;
        gl.url = url;
        followEvents();
      } else if (url !== gl.url) {
        gl.url = url;
        gl.online = false;
        gl.catalog = null;
        if (gl.abort) gl.abort.abort(); // mit neuer Adresse neu verbinden
      }
      break;
    }
    case 'keyDown':
    case 'dialDown':
    case 'touchTap': {
      const inst = instances.get(context);
      if (!inst) break;
      inst.down = true;
      if (event === 'keyDown') press(context, inst);
      else glAction('script:toggle');
      paint(context);
      break;
    }
    case 'keyUp': {
      const inst = instances.get(context);
      if (!inst) break;
      inst.down = false;
      release(context, inst);
      paint(context);
      break;
    }
    case 'dialUp': {
      const inst = instances.get(context);
      if (inst) inst.down = false;
      break;
    }
    case 'dialRotate': {
      const ticks = Math.max(-5, Math.min(5, Number(payload.ticks) || 0));
      for (let i = 0; i < Math.abs(ticks); i++) glAction(ticks > 0 ? 'script:faster' : 'script:slower');
      break;
    }
    case 'propertyInspectorDidAppear': {
      const inst = instances.get(context);
      if (inst) inst.inspector = true;
      notifyInspectors();
      break;
    }
    case 'propertyInspectorDidDisappear': {
      const inst = instances.get(context);
      if (inst) inst.inspector = false;
      break;
    }
    case 'sendToPlugin':
      if (payload && payload.refresh) loadCatalog().then(notifyInspectors);
      break;
    default:
  }
}

if (require.main === module) {
  sd = websocket(
    args.port,
    () => {
      sd({ event: args.registerEvent, uuid: args.pluginUUID });
      sd({ event: 'getGlobalSettings', context: args.pluginUUID });
      // Verbinden, sobald die gespeicherte Adresse da ist (spätestens nach 2 s mit der Standardadresse)
      setTimeout(() => {
        if (!gl.started) {
          gl.started = true;
          followEvents();
        }
      }, 2000);
    },
    onStreamDeck,
  );
}

module.exports = { ICONS, keyImage, render, onGlanceline, gl, instances, apiUrl };
