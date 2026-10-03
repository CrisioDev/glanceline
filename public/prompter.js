// Glanceline – Prompter-Ansicht
// role=main    → das echte Prompter-Fenster (scrollt das Skript, nutzt die Kamera, meldet Position)
// role=preview → Live-Vorschau im Panel (folgt nur der gemeldeten Position)
(() => {
  'use strict';
  const S = window.Glanceline;
  const QUERY = new URLSearchParams(location.search);
  const ROLE = QUERY.get('role') === 'preview' ? 'preview' : 'main';
  const NO_MIC = QUERY.has('nomic'); // automatische Tests speisen Audio von außen ein
  const IS_MAIN = ROLE === 'main';
  const OUTPUT_ID = QUERY.get('output') || ''; // weitere Ausgabe mit eigenem Modus
  const VIRTUAL = QUERY.get('virtual') === '1'; // schwebendes Fenster statt Strahlteiler – nie spiegeln
  if (VIRTUAL) document.documentElement.classList.add('virtual');
  const root = document.documentElement;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  root.classList.add(`role-${ROLE}`);

  let settings = null;
  let scripts = null;
  let live = null;
  let t = window.GlancelineI18n.translator('auto'); // wird mit den Einstellungen gesetzt
  let locale = 'de-DE';
  const evText = (ev) => (ev.key ? t(ev.key, ev.vars) : ev.text || '');
  let clockOffset = 0; // Serverzeit − lokale Zeit

  const chatView = $('v-chat');
  const chatList = $('chatList');
  const scriptViewport = $('scriptViewport');
  const scriptText = $('scriptText');
  const progressBar = $('progress').firstElementChild;
  const countdownEl = $('countdown');
  const pptBox = $('pptBox');
  const pptNotes = $('pptNotes');
  const pptNext = $('pptNext');
  const pptBadge = $('pptBadge');
  const video = $('cam');
  const canvas = $('camCanvas');
  const camMsg = $('camMsg');
  const toasts = $('toasts');
  const st = { live: $('stLive'), rec: $('stRec'), center: $('stCenter'), clock: $('stClock'), delta: $('stDelta'), show: $('stShow') };
  const obsEl = { state: $('obsState'), time: $('obsTime'), rec: $('obsRec'), scene: $('obsScene'), stats: $('obsStats') };

  const SERIF = ['Cormorant Garamond', 'Georgia'];
  const fontStack = (name) => `'${name}', ${SERIF.includes(name) ? 'Georgia, serif' : "'Segoe UI', system-ui, sans-serif"}`;
  const serverNow = () => Date.now() + clockOffset;

  // ---------------------------------------------------------------- Einstellungen

  // ---------------------------------------------------------------- MIDI-Controller
  // Nur das Haupt-Prompter-Fenster liest MIDI und meldet Tasten/Regler an den Server (Zuordnung dort).
  const midi = { access: null, pending: false, cc: new Map() };

  async function syncMidi() {
    if (!IS_MAIN || !settings || !navigator.requestMIDIAccess) return;
    const want = settings.midi.enabled;
    if (want && !midi.access && !midi.pending) {
      midi.pending = true;
      try {
        midi.access = await navigator.requestMIDIAccess({ sysex: false });
        midi.access.onstatechange = bindMidi;
        bindMidi();
      } catch (e) {
        reportMidiDevices(String((e && e.message) || e));
      }
      midi.pending = false;
    } else if (!want && midi.access) {
      for (const input of midi.access.inputs.values()) input.onmidimessage = null;
      midi.access.onstatechange = null;
      midi.access = null;
      reportMidiDevices('');
    }
  }

  function bindMidi() {
    if (!midi.access) return;
    for (const input of midi.access.inputs.values()) input.onmidimessage = (e) => onMidi(e.data);
    reportMidiDevices('');
  }

  function reportMidiDevices(error) {
    const devices = midi.access ? [...midi.access.inputs.values()].filter((i) => i.state !== 'disconnected').map((i) => i.name) : [];
    S.api('/api/report', { kind: 'midi-devices', devices, error }).catch(() => {});
  }

  // Rohdaten → { key, down, value }; Regler (CC) gelten ab Wert 64 als „gedrückt“
  function parseMidi(data, ccState) {
    const [status, d1 = 0, d2 = 0] = data;
    const type = status & 0xf0;
    const ch = (status & 0x0f) + 1;
    if (type === 0x90 && d2 > 0) return { key: `note:${ch}:${d1}`, down: true };
    if (type === 0x80 || type === 0x90) return { key: `note:${ch}:${d1}`, down: false };
    if (type === 0xc0) return { key: `pc:${ch}:${d1}`, down: true };
    if (type === 0xb0) {
      const key = `cc:${ch}:${d1}`;
      const prev = ccState.has(key) ? ccState.get(key) : 0;
      ccState.set(key, d2);
      const down = d2 >= 64 && prev < 64 ? true : d2 < 64 && prev >= 64 ? false : null;
      return { key, down, value: d2 };
    }
    return null;
  }
  window.GlancelineMidi = { parseMidi }; // für Tests

  function onMidi(data) {
    const m = parseMidi(data, midi.cc);
    if (m) S.api('/api/report', { kind: 'midi', ...m }).catch(() => {});
  }

  function outputCfg() {
    return OUTPUT_ID && settings ? settings.outputs.find((o) => o.id === OUTPUT_ID) || null : null;
  }

  // Was diese Anzeige zeigt: den Modus des Haupt-Prompters oder den festen Modus der Ausgabe
  function viewMode() {
    const o = outputCfg();
    return o && o.mode !== 'follow' ? o.mode : live ? live.mode : 'chat';
  }

  function applySettings() {
    const s = settings;
    const lang = window.GlancelineI18n.resolveLang(s.general.language);
    t = window.GlancelineI18n.translator(lang);
    locale = lang === 'de' ? 'de-DE' : 'en-US';
    document.documentElement.lang = lang;
    window.GlancelineI18n.apply(document, t);
    const set = (k, v) => root.style.setProperty(k, String(v));
    set('--font', fontStack(s.display.fontFamily));
    set('--text', s.display.textColor);
    set('--accent', s.display.accentColor);
    set('--fs-chat', `${s.chat.fontSize}px`);
    set('--emote-scale', s.chat.emoteScale);
    set('--fs-script', `${s.script.fontSize}px`);
    set('--lh-script', s.script.lineHeight);
    set('--guide', s.script.guide);
    set('--dim', s.camera.dim);
    set('--plate', s.camera.plate);
    set('--text-opacity', s.camera.textOpacity);
    set('--margin', s.script.margin);
    set('--align', s.script.align === 'center' ? 'center' : 'start');
    set('--cx', s.display.crossX);
    set('--cy', s.display.crossY);
    set('--cs', `${s.display.crossSize}px`);
    set('--co', s.display.crossOpacity);
    set('--dimmer', (1 - s.display.brightness).toFixed(2));
    root.classList.toggle('hc', s.display.highContrast);
    root.classList.toggle('crosshair', s.display.crosshair);
    const out = outputCfg();
    root.classList.toggle('mirror', out ? out.mirror : s.display.mirror && !VIRTUAL);
    if (out) document.body.dataset.mode = viewMode();
    root.classList.toggle('no-status', !s.display.statusBar);
    root.classList.toggle('no-guide', !s.script.showGuide);
    root.classList.toggle('selfie', s.camera.selfie);
    root.classList.toggle('no-badges', !s.chat.showBadges);
    root.classList.toggle('no-events', !s.chat.showEvents);
    layoutScript();
    renderPpt(true);
    trimChat();
    syncMidi();
  }

  // ---------------------------------------------------------------- Chat

  const BADGE = { broadcaster: '▶', moderator: '⚔', vip: '◆', subscriber: '★', founder: '★' };
  // Plattform-Symbole – erscheinen, sobald mehr als eine Chat-Plattform eingerichtet ist
  const PLAT = {
    twitch: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4.3 3 3 6.4v13.1h4.4V22h2.5l2.5-2.5h3.6l4.9-4.9V3zm15 10.8-2.8 2.8h-4.4l-2.5 2.5v-2.5H5.9V4.6h13.4zM16.5 7.9h-1.6v4.8h1.6zm-4.4 0h-1.6v4.8h1.6z"/></svg>',
    youtube: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.6 15.6V8.4l6.2 3.6z"/></svg>',
    kick: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 2h7v6h2V5h2V2h7v7h-2v2h-2v2h2v2h2v7h-7v-3h-2v-3h-2v6H3z"/></svg>',
  };
  const multiPlatform = () => [settings.chat.channel, settings.chat.youtube, settings.chat.kick].filter(Boolean).length > 1;
  function platEl(m) {
    const p = PLAT[m.platform] ? m.platform : 'twitch';
    const span = el('span', `plat p-${p}`);
    span.innerHTML = PLAT[p];
    return span;
  }
  const TWITCH_COLORS = ['#FF0000', '#0000FF', '#00FF00', '#B22222', '#FF7F50', '#9ACD32', '#FF4500', '#2E8B57', '#DAA520', '#D2691E', '#5F9EA0', '#1E90FF', '#FF69B4', '#8A2BE2', '#00FF7F'];
  const colorCache = new Map();

  // Twitch-Namensfarben auf dunklem Grund lesbar machen (Mindesthelligkeit)
  function readableColor(hex, login) {
    const key = `${hex}|${login}`;
    if (colorCache.has(key)) return colorCache.get(key);
    let c = hex;
    if (!/^#[0-9a-f]{6}$/i.test(c || '')) {
      let h = 0;
      for (const ch of login || '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      c = TWITCH_COLORS[h % TWITCH_COLORS.length];
    }
    const r = parseInt(c.slice(1, 3), 16) / 255;
    const g = parseInt(c.slice(3, 5), 16) / 255;
    const b = parseInt(c.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    const out = `hsl(${Math.round(h)} ${Math.round(Math.min(s, 0.9) * 100)}% ${Math.round(Math.max(l, 0.64) * 100)}%)`;
    colorCache.set(key, out);
    return out;
  }

  function emoteUrl(e) {
    const px = settings.chat.fontSize * settings.chat.emoteScale * (window.devicePixelRatio || 1);
    const i = px <= 34 ? 0 : px <= 68 ? 1 : 2;
    return e.u[i] || e.u[e.u.length - 1];
  }

  function emoteEl(e) {
    const wrap = el('span', 'emote');
    const img = new Image();
    img.src = emoteUrl(e);
    img.alt = e.n;
    img.decoding = 'async';
    img.draggable = false;
    if (e.r) img.style.aspectRatio = String(e.r);
    img.onload = scheduleTrim;
    wrap.append(img);
    for (const z of e.zw || []) {
      const zi = new Image();
      zi.src = emoteUrl(z);
      zi.alt = z.n;
      zi.className = 'zw';
      zi.draggable = false;
      wrap.append(zi);
    }
    return wrap;
  }

  function tokensFrag(tokens) {
    const frag = document.createDocumentFragment();
    for (const t of tokens || []) {
      if (t.t === 'text') frag.append(t.v);
      else if (t.t === 'mention') frag.append(el('span', t.me ? 'mention me' : 'mention', t.v));
      else if (t.t === 'emote') frag.append(emoteEl(t));
    }
    return frag;
  }

  function msgEl(m) {
    const div = el('div', 'msg');
    div.dataset.id = m.id;
    div.dataset.plat = m.platform || 'twitch';
    if (m.user && m.user.id) div.dataset.uid = m.user.id;
    const plat = multiPlatform() ? platEl(m) : null;

    if (m.kind === 'event') {
      div.classList.add('event', `ev-${m.event.type}`);
      const head = el('div', 'ev-head');
      if (plat) head.append(plat);
      head.append(el('span', 'ev-icon', m.event.icon), el('span', 'ev-text', evText(m.event)));
      div.append(head);
      if (m.tokens && m.tokens.length) {
        const body = el('div', 'ev-body');
        body.append(tokensFrag(m.tokens));
        div.append(body);
      }
      return div;
    }

    if (m.highlight) div.classList.add('hl');
    if (m.action) div.classList.add('action');
    if (plat) div.append(plat);
    if (m.first) div.append(el('span', 'chip', t('p.new')));
    else if (m.returning) div.append(el('span', 'chip back', t('p.returning')));
    if (m.reward) div.append(el('span', 'chip reward', t('p.reward')));
    if (m.shared) div.append(el('span', 'chip shared', '↔'));
    for (const b of m.user.badges || []) div.append(el('span', `badge b-${b}`, BADGE[b] || '•'));
    const color = readableColor(m.user.color, m.user.login);
    const name = el('span', 'name', m.user.name);
    name.style.color = color;
    div.append(name, el('span', 'sep', m.action ? ' ' : ': '));
    const text = el('span', 'text');
    text.dir = 'auto'; // Rechts-nach-links-Nachrichten richtig darstellen
    if (m.action) text.style.color = color;
    text.append(tokensFrag(m.tokens));
    div.append(text);
    return div;
  }

  let trimQueued = false;
  function scheduleTrim() {
    if (trimQueued) return;
    trimQueued = true;
    requestAnimationFrame(() => {
      trimQueued = false;
      trimChat();
    });
  }

  function trimChat() {
    if (!settings) return;
    while (chatList.childElementCount > settings.chat.maxMessages) chatList.firstElementChild.remove();
    // Was oben aus dem Bild gerutscht ist, kann weg
    const limit = chatView.clientHeight + 200;
    while (chatList.childElementCount > 1 && chatList.offsetHeight > limit) chatList.firstElementChild.remove();
  }

  function addMessage(m, quiet) {
    const node = msgEl(m);
    if (quiet) node.style.animation = 'none';
    chatList.append(node);
    trimChat();
    const fade = settings.chat.fadeAfter;
    if (fade > 0 && !chatHeld()) {
      const age = Date.now() - (m.ts || Date.now());
      const left = fade * 1000 - age;
      if (left <= 0) node.classList.add('gone');
      else setTimeout(() => node.classList.add('gone'), left);
    }
  }

  // Alle Nachrichten bleiben im Puffer – für Pause und Zurückspulen
  const chatBuf = [];
  const chatState = { offset: 0, held: false, pending: 0 };
  const chatHeld = () => Boolean(live && live.chat && (live.chat.paused || live.chat.offset > 0));

  function onChat(m) {
    chatBuf.push(m);
    if (chatBuf.length > 300) chatBuf.shift();
    const toastWorthy = m.kind === 'event' && m.event.type !== 'emote'; // Emote-Änderungen nur im Chat
    if (toastWorthy && live && viewMode() !== 'chat' && !live.blackout && settings.chat.eventToasts) toast(m);
    if (chatHeld()) {
      chatState.pending++;
      updateChatBadge();
      return;
    }
    addMessage(m, false);
  }

  // Ausschnitt neu zeichnen, der „offset“ Nachrichten vor dem neuesten Stand endet
  function renderChatWindow() {
    chatList.replaceChildren();
    const end = Math.max(0, chatBuf.length - chatState.offset);
    for (const m of chatBuf.slice(Math.max(0, end - settings.chat.maxMessages), end)) addMessage(m, true);
  }

  function syncChatState() {
    const c = (live && live.chat) || { paused: false, offset: 0 };
    const held = c.paused || c.offset > 0;
    if (c.offset !== chatState.offset || (chatState.held && !held)) {
      chatState.offset = c.offset;
      if (!held) chatState.pending = 0;
      renderChatWindow();
    }
    chatState.held = held;
    updateChatBadge();
  }

  function updateChatBadge() {
    const badge = $('chatBadge');
    let text = '';
    if (chatState.held) {
      text = chatState.offset > 0 ? `⏪ ${t('p.chatRewind', { n: chatState.offset })}` : `⏸ ${t('p.chatPaused')}`;
      if (chatState.pending) text += ` · ${t('p.chatNew', { n: chatState.pending })}`;
    }
    setText(badge, text);
  }

  function renderHistory(history) {
    chatBuf.length = 0;
    chatBuf.push(...(history || []));
    renderChatWindow();
  }

  function clearChat(c) {
    const ofPlatform = (m) => !c.platform || (m.platform || 'twitch') === c.platform;
    const drop = (m) => (c.all ? ofPlatform(m) : c.userId ? m.kind === 'msg' && m.user.id === c.userId : m.id === c.msgId);
    for (let i = chatBuf.length - 1; i >= 0; i--) if (drop(chatBuf[i])) chatBuf.splice(i, 1);
    if (c.all && c.platform) {
      chatList.querySelectorAll(`.msg[data-plat="${CSS.escape(c.platform)}"]`).forEach((n) => n.remove());
      return;
    }
    if (c.all) {
      chatList.replaceChildren();
      return;
    }
    const sel = c.userId ? `.msg:not(.event)[data-uid="${CSS.escape(c.userId)}"]` : `.msg[data-id="${CSS.escape(c.msgId)}"]`;
    chatList.querySelectorAll(sel).forEach((n) => n.remove());
  }

  function toast(m) {
    while (toasts.childElementCount >= 3) toasts.firstElementChild.remove();
    const box = el('div', `toast ev-${m.event.type}`);
    box.append(el('span', 'ev-icon', m.event.icon), el('span', null, evText(m.event)));
    toasts.append(box);
    setTimeout(() => box.classList.add('out'), 6500);
    setTimeout(() => box.remove(), 7000);
  }

  // ---------------------------------------------------------------- Scroll-Skript

  const sv = {
    id: undefined,
    body: undefined,
    title: '',
    pos: 0,
    max: 0,
    tween: 0,
    targetPos: 0,
    playing: false,
    countdownUntil: 0,
    headings: [],
    lastT: 0,
    reportedAt: 0,
    reportedPos: -1,
    reportedMax: -1,
    livePlaying: null,
    padTop: 0,
    wordEls: [], // <span class="w"> je Skriptwort (Sprachsteuerung)
    wordsKey: '',
    readUpTo: 0,
    voiceManualUntil: 0,
    voiceResync: false,
    holdDir: 0, // gehaltene Clicker-/Hotkey-Taste: −1, 0, 1
    holdUntil: 0,
    restoreToken: 0,
    sectionIdx: -2,
  };

  // Nach einem Einschub an die vorherige Stelle zurückspringen
  function applyRestore() {
    const r = live && live.script && live.script.restoreTo;
    if (!IS_MAIN || !r || r.token === sv.restoreToken || r.id !== sv.id) return;
    sv.restoreToken = r.token;
    sv.pos = clamp(r.pos, 0, sv.max);
    sv.tween = 0;
    report(true);
    if (voiceOn()) S.api('/api/report', { kind: 'voice-seek', pos: wordIndexAt(sv.pos) }).catch(() => {});
  }

  // ---------------------------------------------------------------- Sprachsteuerung (Wörter, Mitscrollen)

  const VT = window.GlancelineVoiceText;
  const voiceOn = () => Boolean(settings && settings.voice.enabled);
  const voiceLang = () => (live && live.voice && live.voice.lang) || 'en';

  // Wortliste an den Server melden (nur das echte Prompter-Fenster)
  function sendWords(force) {
    if (!IS_MAIN) return;
    const lang = voiceLang();
    const words = sv.wordEls.map((el) => ({ w: VT.norm(el.textContent, lang), h: Boolean(el.closest('h1, h2, h3')) }));
    const key = `${sv.id}|${lang}|${words.map((x) => x.w).join(' ')}`;
    if (!force && key === sv.wordsKey) return;
    sv.wordsKey = key;
    S.api('/api/voice/script', { words }).catch(() => { sv.wordsKey = ''; });
  }

  // Zeile des nächsten zu sprechenden Worts auf die Lesezeile
  function voiceTarget() {
    const p = (live && live.voice && live.voice.pos) || 0;
    const els = sv.wordEls;
    if (!els.length) return null;
    const el = els[Math.min(p, els.length - 1)];
    return clamp(el.offsetTop - sv.padTop, 0, sv.max);
  }

  // Welches Wort steht gerade auf der Lesezeile? (nach manuellem Springen)
  function wordIndexAt(pos) {
    const els = sv.wordEls;
    for (let i = 0; i < els.length; i++) if (els[i].offsetTop - sv.padTop >= pos - 2) return i;
    return els.length;
  }

  // Bereits Gesprochenes abdunkeln
  function updateRead() {
    const upto = voiceOn() && settings.voice.dimRead && live && live.voice ? Math.min(live.voice.pos || 0, sv.wordEls.length) : 0;
    if (upto === sv.readUpTo) return;
    const [a, b] = upto > sv.readUpTo ? [sv.readUpTo, upto] : [upto, sv.readUpTo];
    for (let i = a; i < b; i++) if (sv.wordEls[i]) sv.wordEls[i].classList.toggle('read', upto > sv.readUpTo);
    sv.readUpTo = upto;
  }

  function activeScript() {
    return (scripts && scripts.items.find((x) => x.id === scripts.activeId)) || null;
  }

  function renderScript() {
    const sc = activeScript();
    const id = sc ? sc.id : null;
    const body = sc ? sc.body : null;
    if (id === sv.id && body === sv.body) return;
    const frac = sv.max > 0 ? sv.pos / sv.max : 0;
    const same = id === sv.id;
    sv.id = id;
    sv.body = body;
    sv.title = sc ? sc.title : '';
    const rendered = sc ? S.renderScript(sc.body) : { html: '', sections: [] };
    const html = rendered.html;
    sv.sections = rendered.sections;
    scriptText.innerHTML = html || `<p class="empty">${S.esc(t(sc ? 'p.emptyScript' : 'p.noScript'))}</p>`;
    sv.wordEls = [];
    if (html) {
      VT.wrapWords(scriptText, voiceLang());
      sv.wordEls = [...scriptText.querySelectorAll('.w')];
    }
    sv.readUpTo = 0;
    sv.sectionIdx = -2;
    layoutScript();
    sendWords();
    updateRead();
    applyRestore();
    sv.pos = same ? frac * sv.max : 0;
    sv.tween = 0;
    report(true);
  }

  function layoutScript() {
    if (!settings) return;
    const h = scriptViewport.clientHeight;
    if (!h) return;
    const frac = sv.max > 0 ? sv.pos / sv.max : 0;
    const g = settings.script.guide;
    const padTop = Math.round(h * g);
    sv.padTop = padTop;
    const lineH = settings.script.fontSize * settings.script.lineHeight;
    scriptText.style.paddingTop = `${padTop}px`;
    scriptText.style.paddingBottom = `${Math.round(h * (1 - g))}px`;
    // Ende = letzte Zeile steht in der Lesehilfe
    sv.max = Math.max(0, scriptText.offsetHeight - h - lineH);
    sv.headings = [...scriptText.querySelectorAll('[data-sec]')].map((n) => Math.max(0, n.offsetTop - padTop));
    sv.pos = frac * sv.max;
    sv.targetPos = Math.min(sv.targetPos, sv.max);
  }

  function setPlaying(v) {
    if (v === sv.playing) return;
    sv.playing = v;
    // Ohne Countdown: bei Sprachsteuerung (wartet ohnehin) und bei Einschüben
    const cd = voiceOn() || (live && live.script.instant) ? 0 : settings.script.countdown;
    const atStart = (IS_MAIN ? sv.pos : sv.targetPos) < 2;
    sv.countdownUntil = v && atStart && cd > 0 ? Date.now() + cd * 1000 : 0;
  }

  function gotoSection(dir) {
    const hs = sv.headings;
    if (!hs.length) return;
    const cur = sv.pos + sv.tween;
    let target;
    if (dir > 0) {
      target = hs.find((y) => y > cur + 4);
    } else {
      const before = hs.filter((y) => y < cur - 4);
      target = before.length ? before[before.length - 1] : 0;
      // Knapp hinter einer Überschrift? Dann eine weiter zurück
      const lineH = settings.script.fontSize * settings.script.lineHeight;
      if (before.length > 1 && cur - before[before.length - 1] < lineH) target = before[before.length - 2];
    }
    if (target != null) sv.tween = target - sv.pos;
  }

  function report(force, ended) {
    if (!IS_MAIN) return;
    const now = performance.now();
    const changed = Math.abs(sv.pos - sv.reportedPos) >= 1 || Math.round(sv.max) !== sv.reportedMax;
    if (!force && (!changed || now - sv.reportedAt < 150)) return;
    sv.reportedAt = now;
    sv.reportedPos = sv.pos;
    sv.reportedMax = Math.round(sv.max);
    S.api('/api/report', { kind: 'script', pos: Math.round(sv.pos), max: Math.round(sv.max), ended: Boolean(ended) }).catch(() => {});
  }

  function onCmd(c) {
    if (!IS_MAIN) return;
    if (voiceOn() && ['seek', 'seekFrac', 'nudge', 'section', 'sectionIndex'].includes(c.cmd)) {
      sv.voiceManualUntil = Date.now() + 1500;
      sv.voiceResync = true;
    }
    switch (c.cmd) {
      case 'seek':
        sv.pos = clamp(Number(c.pos) || 0, 0, sv.max);
        sv.tween = 0;
        report(true);
        break;
      case 'seekFrac':
        sv.pos = clamp(Number(c.frac) || 0, 0, 1) * sv.max;
        sv.tween = 0;
        report(true);
        break;
      case 'nudge':
        // Clicker/Pedal: eine Zeile; Hotkeys: ein Drittel des Bildschirms
        sv.tween += c.dir * (c.amount === 'line' ? settings.script.fontSize * settings.script.lineHeight : scriptViewport.clientHeight * 0.3);
        break;
      case 'section':
        gotoSection(c.dir);
        break;
      case 'sectionIndex':
        if (sv.headings[c.index] != null) sv.tween = sv.headings[c.index] - sv.pos;
        break;
      case 'hold':
        if (c.dir) {
          sv.holdDir = c.dir;
          sv.holdUntil = Date.now() + 450; // ohne Nachricht vom Server hört das Scrollen von selbst auf
          if (voiceOn()) sv.voiceManualUntil = Date.now() + 1500;
        } else {
          sv.holdDir = 0;
          if (voiceOn()) {
            sv.voiceManualUntil = Date.now() + 1500;
            sv.voiceResync = true;
          }
        }
        break;
      case 'pptScroll':
        pptBox.scrollBy({ top: c.dir * pptBox.clientHeight * 0.45, behavior: 'smooth' });
        break;
      default:
        break;
    }
  }

  function frame(t) {
    const dt = sv.lastT ? Math.min(0.1, (t - sv.lastT) / 1000) : 0;
    sv.lastT = t;
    const now = Date.now();
    const counting = sv.countdownUntil > now;
    const speed = settings ? settings.script.speed : 0;

    if (IS_MAIN) {
      const follow = voiceOn() && sv.playing;
      const dir = (live && live.script.dir) || 1;
      if (sv.playing && !counting && !follow) sv.pos += speed * dt * dir;
      if (sv.holdDir && now < sv.holdUntil) sv.pos += Math.max(320, speed * 4) * dt * sv.holdDir;
      else if (sv.holdDir) sv.holdDir = 0;
      if (follow && !sv.tween && now > sv.voiceManualUntil) {
        const target = voiceTarget();
        if (target != null) {
          const diff = target - sv.pos;
          sv.pos += Math.abs(diff) < 0.5 ? diff : diff * Math.min(1, dt * 4);
        }
      }
      if (sv.voiceResync && !sv.tween) {
        sv.voiceResync = false;
        S.api('/api/report', { kind: 'voice-seek', pos: wordIndexAt(sv.pos) }).catch(() => {});
      }
      if (sv.tween) {
        const step = Math.abs(sv.tween) < 0.5 ? sv.tween : sv.tween * Math.min(1, dt * 10);
        sv.pos += step;
        sv.tween -= step;
      }
      if (sv.pos <= 0) {
        sv.pos = 0;
        if (sv.tween < 0) sv.tween = 0;
      }
      if (sv.pos >= sv.max) {
        sv.pos = sv.max;
        if (sv.tween > 0) sv.tween = 0;
      }
      // Kapitelmarken: Abschnitt melden, sobald seine Überschrift die Lesezeile erreicht
      if (sv.playing && sv.headings.length) {
        let idx = -1;
        for (let i = 0; i < sv.headings.length; i++) if (sv.headings[i] <= sv.pos + 2) idx = i;
        if (idx !== sv.sectionIdx) {
          sv.sectionIdx = idx;
          const h = idx >= 0 ? scriptText.querySelector(`[data-sec="${idx}"]`) : null;
          const sec = sv.sections && sv.sections[idx];
          const title = sec ? sec.title.replace(/\*\*|==|[*[\]]/g, '').trim() : '';
          if (h) S.api('/api/report', { kind: 'section', index: idx, title }).catch(() => {});
        }
      }
      if (sv.playing && !counting && dir < 0 && sv.pos <= 0) {
        sv.playing = false; // rückwärts oben angekommen
        report(true, true);
      } else if (sv.playing && !counting && sv.max > 0 && sv.pos >= sv.max) {
        sv.playing = false;
        report(true, true);
      } else {
        report(false);
      }
    } else {
      // Vorschau: zwischen den Positionsmeldungen weiterlaufen, dann sanft angleichen
      if (sv.playing && !counting && !voiceOn()) sv.targetPos = clamp(sv.targetPos + speed * dt * ((live && live.script.dir) || 1), 0, sv.max);
      const diff = sv.targetPos - sv.pos;
      sv.pos += Math.abs(diff) < 0.5 ? diff : diff * Math.min(1, dt * 8);
    }

    scriptText.style.transform = `translate3d(0, ${(-sv.pos).toFixed(1)}px, 0)`;
    progressBar.style.height = `${sv.max > 0 ? (sv.pos / sv.max) * 100 : 0}%`;
    if (counting) {
      const n = String(Math.ceil((sv.countdownUntil - now) / 1000));
      if (countdownEl.textContent !== n) countdownEl.textContent = n;
      countdownEl.classList.add('show');
    } else if (countdownEl.classList.contains('show')) {
      countdownEl.classList.remove('show');
    }
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- PowerPoint

  let pptKey = '';

  function pptElapsed() {
    const t = live.ppt.timer;
    return t.acc + (t.running ? serverNow() - t.startedAt : 0);
  }

  function renderPpt(force) {
    if (!live || !settings) return;
    const p = live.ppt;
    const s = settings.ppt;
    const key = JSON.stringify([p.running, p.mode, p.slide, p.title, p.notes, p.nextTitle, s.maxFontSize, s.minFontSize, s.showNext, settings.display.fontFamily, settings.general.language]);
    if (key === pptKey && !force) return;
    pptKey = key;
    pptBox.scrollTop = 0;
    pptBadge.classList.toggle('show', p.mode === 'edit');

    if (!p.running) {
      pptNotes.innerHTML = `<div class="ppt-empty">${S.esc(t('p.pptNotOpen'))}</div>`;
    } else if (p.mode === 'none') {
      pptNotes.innerHTML = `<div class="ppt-empty">${S.esc(t('p.pptNoPresentation'))}</div>`;
    } else if (p.mode === 'end') {
      pptNotes.innerHTML = `<div class="ppt-empty"><b>${S.esc(t('p.pptEnd'))}</b><br>${S.esc(t('p.pptThanks'))}</div>`;
    } else if (!p.notes) {
      pptNotes.innerHTML = `<div class="ppt-empty">${S.esc(t('p.pptNoNotes', { n: p.slide }))}${p.title ? ` – <b>${S.esc(p.title)}</b>` : ''}</div>`;
    } else {
      pptNotes.innerHTML = S.renderNotes(p.notes);
    }

    if (s.showNext && p.running && (p.mode === 'show' || p.mode === 'edit') && p.slide) {
      pptNext.innerHTML = p.nextTitle ? `${S.esc(t('p.pptNext'))} <b>${S.esc(p.nextTitle)}</b>` : S.esc(t('p.pptLast'));
    } else {
      pptNext.textContent = '';
    }
    fitPpt();
  }

  // Größte Schrift suchen, bei der die Notizen ohne Scrollen passen
  function fitPpt() {
    const s = settings.ppt;
    const box = pptBox.clientHeight;
    if (!box) return;
    if (pptNotes.querySelector('.ppt-empty')) {
      pptNotes.style.fontSize = '';
      updatePptMore();
      return;
    }
    let lo = s.minFontSize;
    let hi = s.maxFontSize;
    let best = lo;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      pptNotes.style.fontSize = `${mid}px`;
      if (pptNotes.offsetHeight <= box) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    pptNotes.style.fontSize = `${best}px`;
    updatePptMore();
  }

  // „weiter ▼“, solange unterhalb noch Notiztext versteckt ist
  function updatePptMore() {
    const hidden = pptBox.scrollHeight - pptBox.clientHeight - pptBox.scrollTop > 4;
    pptBox.classList.toggle('more', hidden);
  }
  pptBox.addEventListener('scroll', updatePptMore);

  // ---------------------------------------------------------------- OBS + Statusleiste

  function setPill(node, cls, text) {
    const c = `pill ${cls}`;
    if (node.className !== c) node.className = c;
    const span = node.lastElementChild;
    if (span.textContent !== text) span.textContent = text;
  }

  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }

  function obsSince() {
    const o = live.obs || {};
    return o.at ? Math.max(0, serverNow() - o.at) : 0;
  }

  function centerText() {
    const m = viewMode();
    if (m === 'chat') return chatCenter();
    if (m === 'script' && live.insert) return `↪ ${t('p.insert')}: ${sv.title}`;
    const ros = m === 'script' ? scheduleNow() : null;
    if (ros) return ros.target ? `§ ${ros.title} · ${S.fmtDur(ros.inSec)} / ${S.fmtDur(ros.target)}` : `§ ${ros.title} · ${S.fmtDur(ros.inSec)}`;
    if (m === 'script') {
      const title = sv.title || t('mode.script');
      if (voiceOn()) {
        const v = live.voice || {};
        if (v.state === 'missing') return `${title} · ${t('p.voiceMissing')}`;
        if (v.state === 'downloading' || v.state === 'loading') return `${title} · ${t('p.voiceLoading')}`;
        if (v.state === 'error') return `${title} · ${t('p.voiceError')}`;
        return `🎙 ${title} · ${sv.playing ? t('p.listening') : t('p.paused')}`;
      }
      return `${title} · ${sv.playing ? `${settings.script.speed} px/s` : t('p.paused')}`;
    }
    if (m === 'obs') return live.obs && live.obs.scene ? t('p.scene', { scene: live.obs.scene }) : 'OBS';
    if (m === 'ppt') {
      const p = live.ppt;
      if (!p.running || p.mode === 'none') return 'PowerPoint';
      const parts = [];
      if (p.slide) parts.push(t('p.slide', { n: p.slide, total: p.total }));
      const timer = p.timer; // nicht „t“ nennen – das ist die Übersetzungsfunktion
      if (settings.ppt.showTimer && (timer.running || timer.acc > 0)) parts.push(`⏱ ${S.fmtDur(pptElapsed())}`);
      return parts.join('   ·   ') || p.file;
    }
    if (m === 'camera') return t('mode.camera');
    return '';
  }

  // Statuszeile im Chat-Modus: Kanäle und Zuschauerzahlen aller Plattformen
  function chatCenter() {
    const tw = live.twitch || {};
    const yt = live.youtube || {};
    const kk = live.kick || {};
    const num = (n) => Number(n).toLocaleString(locale);
    const items = [];
    if (tw.channel) items.push({ name: `#${tw.channel}`, short: 'Twitch', viewers: tw.joined ? tw.viewers : null, wait: !tw.joined });
    if (yt.state && yt.state !== 'off') {
      items.push({ name: yt.channel, short: 'YouTube', viewers: yt.state === 'live' ? yt.viewers : null, off: yt.state === 'offline', bad: yt.state === 'error', wait: yt.state === 'searching' });
    }
    if (kk.state && kk.state !== 'off') {
      items.push({ name: `kick/${kk.channel}`, short: 'Kick', viewers: kk.live ? kk.viewers : null, off: kk.connected && !kk.live, bad: kk.state === 'error', wait: !kk.connected && kk.state !== 'error' });
    }
    if (!items.length) return t('mode.chat');
    const one = items.length === 1;
    const parts = items.map((i) => {
      const label = one ? i.name : i.short;
      if (i.viewers != null) return one ? `${label} · 👁 ${num(i.viewers)}` : `${label} ${num(i.viewers)}`;
      if (i.bad) return `${label} ⚠`;
      if (i.wait) return one ? `${label} · ${t('p.connecting')}` : `${label} …`;
      if (i.off) return `${label} · ${t('p.offline')}`;
      return label;
    });
    const counted = items.filter((i) => i.viewers != null);
    if (counted.length > 1) parts.unshift(`👁 ${num(counted.reduce((n, i) => n + i.viewers, 0))}`);
    return parts.join('  ·  ');
  }

  // Zeitplan des aktiven Skripts (null, wenn keine Zielzeiten gesetzt sind)
  function scheduleNow() {
    const sec = live.section;
    if (!sec || !live.show || sec.id !== sv.id || !sv.sections) return null;
    return S.runOfShow(sv.sections, sec, S.showClock(live.show, settings.timers, serverNow()).elapsed);
  }

  function tickTimers() {
    const clock = S.showClock(live.show || { running: false, acc: 0, startedAt: 0 }, settings.timers, serverNow());
    if (!settings.timers.show || !clock.started) setPill(st.show, 'hidden', '');
    else if (clock.left == null) setPill(st.show, 'off', `⏱ ${S.fmtDur(clock.elapsed)}`);
    else if (clock.left < 0) setPill(st.show, 'over', `⏱ ${S.fmtSigned(-clock.left)}`);
    else setPill(st.show, clock.left <= settings.timers.warn * 60000 ? 'warn' : 'off', `⏱ ${S.fmtDur(clock.left)}`);

    const ros = viewMode() === 'script' && !live.insert ? scheduleNow() : null;
    if (!ros || Math.abs(ros.delta) < 1000) setPill(st.delta, ros ? 'ahead' : 'hidden', ros ? '±0:00' : '');
    else setPill(st.delta, ros.delta > 0 ? 'behind' : 'ahead', S.fmtSigned(ros.delta));
  }

  function tickStatus() {
    if (!live || !settings) return;
    tickTimers();
    const o = live.obs || {};
    const since = obsSince();
    if (!o.connected) setPill(st.live, 'na', 'OBS –');
    else if (o.streaming) setPill(st.live, o.reconnecting ? 'warn' : 'live', `LIVE ${S.fmtDur(o.streamMs + since)}`);
    else setPill(st.live, 'off', 'OFFLINE');

    if (o.connected && o.recording) {
      setPill(st.rec, o.recordPaused ? 'paused' : 'rec', `REC ${S.fmtDur(o.recordMs + (o.recordPaused ? 0 : since))}`);
    } else {
      setPill(st.rec, 'hidden', '');
    }
    setText(st.center, centerText());
    renderDirector();
    setText(st.clock, new Date().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }));

    if (viewMode() === 'obs') {
      setText(obsEl.time, o.connected && o.streaming ? S.fmtDur(o.streamMs + since) : '');
      setText(obsEl.rec, o.connected && o.recording ? `● REC ${S.fmtDur(o.recordMs + (o.recordPaused ? 0 : since))}${o.recordPaused ? ` (${t('p.paused')})` : ''}` : '');
    }
  }

  function renderObs() {
    const o = live.obs || {};
    obsEl.state.className = `obs-state ${!o.connected ? 'na' : o.streaming ? 'live' : 'off'}`;
    setText(obsEl.state, !o.connected ? t(o.error || 'err.obs.notConnected') : o.streaming ? (o.reconnecting ? t('p.reconnecting') : '● LIVE') : 'OFFLINE');
    setText(obsEl.scene, o.scene ? t('p.scene', { scene: o.scene }) : '');
    const stats = [];
    if (o.connected) {
      if (o.fps) stats.push(`${Math.round(o.fps)} FPS`);
      if (typeof o.cpu === 'number') stats.push(`CPU ${Math.round(o.cpu)} %`);
      if (o.streaming) {
        stats.push(`${(o.kbps / 1000).toFixed(1)} Mbit/s`);
        const pct = o.totalFrames ? (o.dropped / o.totalFrames) * 100 : 0;
        stats.push(`Drops ${o.dropped} (${pct.toFixed(1)} %)`);
      }
    }
    setText(obsEl.stats, stats.join('   ·   '));
  }

  // ---------------------------------------------------------------- Kamera

  const cam = { seq: 0, obsSeq: 0, stream: null, key: '', pending: false, failedKey: '', obsRunning: false };

  const camWanted = () => Boolean(settings && live) && !live.blackout && (settings.camera.enabled || viewMode() === 'camera');

  function reportCam(o) {
    S.api('/api/report', { kind: 'camera', ...o }).catch(() => {});
  }

  async function reportDevices() {
    if (!IS_MAIN || !navigator.mediaDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const list = all.filter((d) => d.kind === 'videoinput' && d.label).map((d) => ({ label: d.label }));
      const mics = all.filter((d) => d.kind === 'audioinput' && d.label && d.deviceId !== 'default' && d.deviceId !== 'communications').map((d) => ({ label: d.label }));
      S.api('/api/report', { kind: 'devices', devices: list, mics }).catch(() => {});
    } catch {
      /* egal */
    }
  }

  function syncCamera() {
    const want = camWanted();
    const src = settings.camera.source;
    root.classList.toggle('cam-on', want);
    root.classList.toggle('cam-device', src !== 'obs');
    root.classList.toggle('cam-obs', src === 'obs');
    if (!IS_MAIN) return;

    if (!want) {
      stopDevice();
      stopObs();
      setText(camMsg, '');
      return;
    }
    if (src === 'obs') {
      stopDevice();
      if (!cam.obsRunning) obsLoop();
      return;
    }
    stopObs();
    const key = `${settings.camera.deviceLabel}|${settings.camera.fps}`;
    if (cam.key === key && (cam.stream || cam.pending)) return;
    if (cam.failedKey === key) return; // nicht im Sekundentakt neu versuchen
    startDevice(key);
  }

  // „Automatisch“: echte Webcam vor Capture-Karten und virtuellen Kameras
  function pickWebcam(devices) {
    const score = (d) => {
      const l = d.label || '';
      if (/virtual|obs|ndi|snap camera/i.test(l)) return 0;
      if (/shadowcast|capture|cam link|hdmi|game|usb video|av\.io/i.test(l)) return 1;
      if (/webcam|facecam|brio|c9\d\d|kiyo|streamcam|logitech|camera/i.test(l)) return 3;
      return 2;
    };
    return [...devices].sort((a, b) => score(b) - score(a))[0];
  }

  async function startDevice(key) {
    stopDevice();
    const seq = ++cam.seq;
    cam.key = key;
    cam.pending = true;
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      const dev = devices.find((d) => d.label && d.label === settings.camera.deviceLabel) || pickWebcam(devices);
      if (!dev) throw Object.assign(new Error('err.cam.none'), { name: 'NotFoundError' });
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          deviceId: dev.deviceId ? { exact: dev.deviceId } : undefined,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: settings.camera.fps },
        },
      });
      if (seq !== cam.seq) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      cam.stream = stream;
      cam.pending = false;
      cam.failedKey = '';
      video.srcObject = stream;
      video.play().catch(() => {});
      setText(camMsg, '');
      const label = (stream.getVideoTracks()[0] || {}).label || dev.label;
      reportCam({ active: true, error: '', label });
      reportDevices();
    } catch (e) {
      if (seq !== cam.seq) return;
      cam.pending = false;
      cam.failedKey = key;
      const msg =
        e.name === 'NotReadableError'
          ? 'err.cam.busy'
          : e.name === 'NotAllowedError'
            ? 'err.cam.denied'
            : e.message || String(e);
      setText(camMsg, t(msg));
      reportCam({ active: false, error: msg });
    }
  }

  function stopDevice() {
    cam.seq++;
    cam.pending = false;
    cam.key = '';
    if (cam.stream) {
      cam.stream.getTracks().forEach((t) => t.stop());
      cam.stream = null;
      video.srcObject = null;
      reportCam({ active: false, error: '' });
    }
  }

  function stopObs() {
    if (!cam.obsRunning) return;
    cam.obsRunning = false;
    cam.obsSeq++;
    reportCam({ active: false, error: '' });
  }

  // OBS-Quelle als Bildfolge (max. 15 fps, damit OBS selbst nicht ausgebremst wird)
  async function obsLoop() {
    cam.obsRunning = true;
    const seq = ++cam.obsSeq;
    const ctx = canvas.getContext('2d');
    let shown = '';
    while (cam.obsRunning && seq === cam.obsSeq) {
      const t0 = performance.now();
      try {
        const res = await fetch('/api/obs-frame?w=1280', { cache: 'no-store' });
        if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
        const bmp = await createImageBitmap(await res.blob());
        if (seq !== cam.obsSeq) {
          bmp.close();
          break;
        }
        if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
          canvas.width = bmp.width;
          canvas.height = bmp.height;
        }
        ctx.drawImage(bmp, 0, 0);
        bmp.close();
        if (shown !== 'ok') {
          shown = 'ok';
          setText(camMsg, '');
          reportCam({ active: true, error: '', label: `OBS: ${settings.camera.obsSource}` });
        }
      } catch (e) {
        const msg = `err.cam.obs|${e.message}`;
        if (shown !== msg) {
          shown = msg;
          setText(camMsg, t(msg));
          reportCam({ active: false, error: msg });
        }
        await S.sleep(1500);
      }
      const fps = Math.min(15, settings.camera.fps);
      await S.sleep(Math.max(0, 1000 / fps - (performance.now() - t0)));
    }
  }

  // ---------------------------------------------------------------- Live-Zustand

  function onLive(l) {
    live = l;
    clockOffset = l.now - Date.now();
    document.body.dataset.mode = viewMode();
    root.classList.toggle('blackout', Boolean(l.blackout));

    // Weitere Ausgaben haben oft eine andere Größe → Position anteilig übernehmen
    if (!IS_MAIN) sv.targetPos = OUTPUT_ID ? (l.script.max > 0 ? (l.script.pos / l.script.max) * sv.max : 0) : l.script.pos;
    if (l.script.playing !== sv.livePlaying) {
      sv.livePlaying = l.script.playing;
      setPlaying(l.script.playing);
    }
    renderPpt();
    renderObs();
    syncCamera();
    if (IS_MAIN && l.voice && sv.wordEls.length && l.voice.words !== sv.wordEls.length) sendWords(true); // z. B. nach Server-Neustart
    else sendWords();
    updateRead();
    syncMic();
    syncChatState();
    applyRestore();
    renderDirector();
    tickStatus();
  }

  // Regie-Nachricht groß einblenden, bis die Zeit abgelaufen ist
  let directorId = '';
  function renderDirector() {
    const box = $('director');
    const d = live && live.director;
    const on = Boolean(d && serverNow() < d.until);
    if (on && d.id !== directorId) {
      directorId = d.id;
      box.classList.remove('show');
      void box.offsetWidth; // Einblend-Animation neu starten
    }
    setText(box.firstElementChild, on ? (d.countdown ? `${d.text} · ${S.fmtDur(d.until - serverNow())}` : d.text) : '');
    box.classList.toggle('show', on);
  }

  // ---------------------------------------------------------------- Mikrofon (nur Prompter-Fenster)

  // AudioWorklet sammelt 100-ms-Pakete und misst den Pegel
  const WORKLET_URL = URL.createObjectURL(new Blob([`
    class GlancelineMic extends AudioWorkletProcessor {
      constructor(o) { super(); this.n = o.processorOptions.chunk; this.buf = new Float32Array(this.n); this.i = 0; this.sum = 0; }
      process(inputs) {
        const ch = inputs[0] && inputs[0][0];
        if (ch) for (let k = 0; k < ch.length; k++) {
          const v = ch[k]; this.buf[this.i++] = v; this.sum += v * v;
          if (this.i === this.n) {
            this.port.postMessage({ samples: this.buf, level: Math.sqrt(this.sum / this.n) }, [this.buf.buffer]);
            this.buf = new Float32Array(this.n); this.i = 0; this.sum = 0;
          }
        }
        return true;
      }
    }
    registerProcessor('glanceline-mic', GlancelineMic);
  `], { type: 'application/javascript' }));

  const mic = { seq: 0, stream: null, ctx: null, key: '', pending: false, failedKey: '', levelAt: 0 };

  const micWanted = () =>
    voiceOn() && live && live.mode === 'script' && sv.playing && !live.blackout && live.voice && live.voice.state === 'ready';

  function syncMic() {
    if (!IS_MAIN || NO_MIC) return;
    if (!micWanted()) {
      stopMic();
      return;
    }
    const key = settings.voice.micLabel;
    if ((mic.stream || mic.pending) && mic.key === key) return;
    if (mic.failedKey === key) return;
    startMic(key);
  }

  async function startMic(key) {
    stopMic();
    const seq = ++mic.seq;
    mic.key = key;
    mic.pending = true;
    try {
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
      const dev = devs.find((d) => d.label && d.label === key);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: { deviceId: dev ? { exact: dev.deviceId } : undefined, channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true },
      });
      if (seq !== mic.seq) {
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }
      const ctx = new AudioContext();
      await ctx.audioWorklet.addModule(WORKLET_URL);
      const node = new AudioWorkletNode(ctx, 'glanceline-mic', { processorOptions: { chunk: Math.round(ctx.sampleRate / 10) } });
      const mute = ctx.createGain();
      mute.gain.value = 0;
      ctx.createMediaStreamSource(stream).connect(node);
      node.connect(mute).connect(ctx.destination); // nötig, damit der Worklet läuft – stumm
      node.port.onmessage = (e) => {
        fetch(`/api/voice/audio?sr=${ctx.sampleRate}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: e.data.samples.buffer }).catch(() => {});
        const now = performance.now();
        if (now - mic.levelAt > 250) {
          mic.levelAt = now;
          S.api('/api/report', { kind: 'voice-level', level: Math.min(1, e.data.level * 5) }).catch(() => {});
        }
      };
      await ctx.resume();
      if (seq !== mic.seq) {
        stream.getTracks().forEach((tr) => tr.stop());
        ctx.close().catch(() => {});
        return;
      }
      mic.stream = stream;
      mic.ctx = ctx;
      mic.pending = false;
      mic.failedKey = '';
      setText(camMsg, '');
    } catch (e) {
      if (seq !== mic.seq) return;
      mic.pending = false;
      mic.failedKey = key;
      setText(camMsg, t(e.name === 'NotAllowedError' ? 'err.mic.denied' : e.name === 'NotReadableError' ? 'err.mic.busy' : 'err.mic.failed'));
    }
  }

  function stopMic() {
    mic.seq++;
    mic.pending = false;
    mic.key = '';
    if (mic.stream) mic.stream.getTracks().forEach((tr) => tr.stop());
    if (mic.ctx) mic.ctx.close().catch(() => {});
    if (mic.stream) S.api('/api/report', { kind: 'voice-level', level: 0 }).catch(() => {});
    mic.stream = null;
    mic.ctx = null;
  }

  S.connect(ROLE, {
    init(d) {
      settings = d.settings;
      scripts = d.scripts;
      live = d.live;
      applySettings();
      renderScript();
      renderHistory(d.history);
      onLive(d.live);
    },
    settings(s) {
      if (JSON.stringify(s.camera) !== JSON.stringify(settings.camera)) cam.failedKey = '';
      if (JSON.stringify(s.voice) !== JSON.stringify(settings.voice)) mic.failedKey = '';
      settings = s;
      applySettings();
      if (live) onLive(live);
    },
    scripts(sc) {
      scripts = sc;
      renderScript();
    },
    live: onLive,
    chat: onChat,
    chatclear: clearChat,
    cmd: onCmd,
    _online(on) {
      root.classList.toggle('offline', !on);
    },
  });

  window.addEventListener('resize', () => {
    layoutScript();
    renderPpt(true);
    trimChat();
  });
  document.fonts.ready.then(() => {
    layoutScript();
    renderPpt(true);
  });
  if (IS_MAIN && navigator.mediaDevices) {
    navigator.mediaDevices.addEventListener('devicechange', reportDevices);
    reportDevices();
  }
  setInterval(tickStatus, 250);
  requestAnimationFrame(frame);
})();
