'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { Store, DEFAULT_HOTKEYS, PROFILE_KEYS, newId, newToken } = require('./store');
const { systemFonts } = require('./fonts');
const { TwitchChat } = require('./twitch');
const { YouTubeChat } = require('./youtube');
const { KickChat } = require('./kick');
const { TwitchEventSub, DEFAULT_CLIENT_ID } = require('./eventsub');
const { ScriptFolder } = require('./library');
const { zipFolder } = require('./zip');
const { ObsClient } = require('./obs');
const { PowerPointWatcher } = require('./powerpoint');
const { VoiceEngine, VOICE_LANGUAGES } = require('./voice');
const { resolveLang, translator } = require('../public/i18n');

const t = (lang, key, vars) => translator(lang)(key, vars);

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};
const MODES = ['chat', 'script', 'obs', 'ppt', 'camera'];
const STREAMDECK_PLUGIN = path.join(__dirname, '..', 'integrations', 'streamdeck', 'io.github.crisiodev.glanceline.sdPlugin');

// Ist die Stream-Deck-Software da, ist unser Plugin schon installiert?
function streamDeckInfo() {
  const base = process.platform === 'win32' ? path.join(process.env.APPDATA || '', 'Elgato', 'StreamDeck') : path.join(os.homedir(), 'Library', 'Application Support', 'com.elgato.StreamDeck');
  return { found: fs.existsSync(base), installed: fs.existsSync(path.join(base, 'Plugins', path.basename(STREAMDECK_PLUGIN))) };
}
const ROLES = ['main', 'preview', 'panel', 'api']; // api = Stream Deck, Companion & Co.
const HISTORY_SIZE = 120;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const getPath = (obj, p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const cleanText = (s) => String(s || '').replace(/\r\n?|\u000b/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// Übernimmt nur Schlüssel, die es in den Einstellungen bereits gibt.
function deepAssign(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in target)) continue;
    if (isObj(v) && isObj(target[k])) deepAssign(target[k], v);
    else target[k] = v;
  }
}

// Heimnetz-Adressen, wahrscheinlichste zuerst (der QR-Code nutzt die erste)
function lanUrls(port, token) {
  const score = (name, ip) => {
    let s = 0;
    if (ip.startsWith('192.168.')) s += 30;
    else if (ip.startsWith('10.')) s += 20;
    else if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) s += 10;
    if (/vethernet|virtualbox|vmware|wsl|hyper-v|loopback|docker|zerotier|tailscale|vpn/i.test(name)) s -= 50;
    if (/wi-?fi|wlan|ethernet/i.test(name)) s += 5;
    return s;
  };
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) {
        out.push({ name, url: `http://${a.address}:${port}/?t=${token}`, score: score(name, a.address) });
      }
    }
  }
  return out.sort((a, b) => b.score - a.score).map(({ name, url }) => ({ name, url }));
}

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('request too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('request too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

class Glanceline extends EventEmitter {
  constructor({ dataDir }) {
    super();
    this.store = new Store(dataDir);
    this.clients = new Set();
    this.history = [];
    this.port = this.settings.general.port;
    const startMode = this.settings.general.startMode;
    this.live = {
      now: Date.now(),
      mode: MODES.includes(startMode) ? startMode : 'chat',
      prevMode: null,
      blackout: false,
      passthrough: false, // Prompter-Fenster ausgeblendet, Display frei für andere Programme
      script: { playing: false, pos: 0, max: 0, dir: 1, instant: false, restoreTo: null },
      chat: { paused: false, offset: 0 },
      director: null, // { id, text, until } – Regie-Nachricht auf dem Prompter
      show: { running: false, startedAt: 0, acc: 0 }, // Show-Timer (ms)
      section: null, // aktueller Skript-Abschnitt für den Zeitplan: { id, index, title, at, base, baseIndex }
      insert: null, // laufender Einschub: { slot, title, prev }
      ppt: { running: false, mode: 'none', slide: 0, total: 0, title: '', notes: '', nextTitle: '', file: '', paused: false, timer: { running: false, startedAt: 0, acc: 0 } },
      obs: {},
      twitch: {},
      youtube: {},
      kick: {},
      eventsub: {},
      folder: { folder: '', files: 0, error: '' },
      midi: { devices: [], error: '', learn: null, last: null },
      camera: { active: false, error: '', label: '', devices: [] },
      displays: [],
      prompter: { kind: 'none', display: null },
      power: { supported: process.platform === 'win32', standby: false, busy: false, error: '' },
      hotkeys: { errors: [], suspended: false },
      clients: { main: 0, preview: 0, panel: 0 },
      lan: { enabled: false, port: this.port, urls: [] },
      app: { desktop: false, autostart: false, streamDeck: streamDeckInfo() },
      voice: {},
      mics: [],
    };
    this.twitch = new TwitchChat(() => this.settings);
    this.youtube = new YouTubeChat(() => this.settings);
    this.kick = new KickChat(() => this.settings);
    this.eventsub = new TwitchEventSub({ getSettings: () => this.settings, store: { load: () => this.store.loadAuth(), save: (a) => this.store.saveAuth(a) } });
    this.folder = new ScriptFolder();
    this.obs = new ObsClient(() => this.settings);
    this.ppt = new PowerPointWatcher();
    this.voice = new VoiceEngine({ dataDir });
  }

  get settings() {
    return this.store.settings;
  }

  // Sprache der Spracherkennung: eingestellt oder passend zur Oberfläche (sofern ein Modell existiert)
  voiceLang() {
    const v = this.settings.voice.lang;
    if (v !== 'auto') return v;
    const ui = this.lang();
    return VOICE_LANGUAGES.includes(ui) ? ui : 'en';
  }

  _syncVoice() {
    if (this.settings.voice.enabled) this.voice.prepare(this.voiceLang());
    else if (this.voice.status.state !== 'off' && this.voice.status.state !== 'downloading') this.voice.stop();
  }

  // Sprache für Texte, die der Server selbst erzeugt (Tray, Beispielinhalte)
  lang() {
    return resolveLang(this.settings.general.language);
  }

  baseUrl() {
    return `http://127.0.0.1:${this.port}`;
  }

  // Ereignisse der Dienste mit dem Live-Zustand verbinden (eigene Methode, damit Tests sie ohne Netzwerk nutzen können)
  _wire() {
    this.twitch.on('status', (st) => { this.live.twitch = st; this.touch(); });
    this.twitch.on('message', (m) => this._chat(m));
    this.twitch.on('clear', (c) => this._chatClear(c));
    for (const name of ['youtube', 'kick']) {
      this[name].on('status', (st) => { this.live[name] = st; this.touch(); });
      this[name].on('message', (m) => this._chat(m));
      this[name].on('clear', (c) => this._chatClear(c));
    }
    this.obs.on('status', (st) => {
      const prevScene = this.live.obs.scene;
      const wasStreaming = Boolean(this.live.obs.streaming);
      this.live.obs = st;
      // Show-Timer an den Stream koppeln
      if (this.settings.timers.start === 'stream' && st.connected && Boolean(st.streaming) !== wasStreaming) {
        if (st.streaming) {
          Object.assign(this.live.show, { running: true, startedAt: Date.now(), acc: 0 });
          this.live.section = null;
        } else {
          this._showPause();
        }
      }
      // Szenenwechsel in OBS schaltet den passenden Modus
      if (st.connected && st.scene && st.scene !== prevScene) {
        const mode = this.settings.obsAuto.sceneModes[st.scene];
        if (mode && mode !== this.live.mode) this._setMode(mode);
      }
      this.touch();
    });
    this.folder.on('status', (st) => { this.live.folder = st; this.touch(); });
    const esStatus = (st) => {
      this.live.eventsub = { ...st, hasClientId: Boolean(this.settings.twitch.clientId.trim() || DEFAULT_CLIENT_ID) };
      this.touch();
    };
    this.eventsub.on('status', esStatus);
    esStatus(this.eventsub.status);
    this.eventsub.on('message', (m) => this._chat(m));
    this.eventsub.on('openExternal', (url) => this.emit('openExternal', url));
    // Werbepause: Countdown als Regie-Banner auf dem Prompter
    this.eventsub.on('adBreak', ({ seconds }) => {
      if (!seconds) return;
      this.live.director = { id: newId(), text: t(this.lang(), 'p.adBreak'), until: Date.now() + seconds * 1000, countdown: true };
      this.touch();
    });
    this.folder.on('files', (files) => this._syncFolder(files));
    this.ppt.on('update', (p) => this._ppt(p));
    this.ppt.on('log', (l) => l && console.warn('[ppt]', l));
    this.voice.on('status', (st) => { this.live.voice = { ...st, lang: this.voiceLang() }; this.touch(); });
    this.voice.on('downloaded', () => this._syncVoice());
    this.live.voice = { ...this.voice.status, lang: this.voiceLang() };
  }

  async start() {
    this._wire();
    this.server = http.createServer((req, res) => {
      this._handle(req, res).catch((err) => {
        if (!res.headersSent) sendJson(res, { ok: false, error: err.message }, 500);
        else res.end();
      });
    });
    await this._listen();

    this.twitch.start();
    this.youtube.start();
    this.kick.start();
    this.eventsub.start();
    this.folder.watch(this.settings.library.folder);
    this.obs.start();
    this.ppt.start();
    this._syncVoice();
    this.heartbeat = setInterval(() => {
      for (const c of this.clients) c.res.write(': ping\n\n');
    }, 20000);
  }

  stop() {
    clearInterval(this.heartbeat);
    this.twitch.stop();
    this.youtube.stop();
    this.kick.stop();
    this.eventsub.stop();
    this.folder.stop();
    this.obs.stop();
    this.ppt.stop();
    this.voice.stop();
    this.store.flushAll();
    for (const c of this.clients) {
      try { c.res.end(); } catch { /* egal */ }
    }
    this.clients.clear();
    if (this.server) {
      this.server.close();
      this.server.closeAllConnections();
    }
  }

  // ---------- HTTP ----------

  async _listen() {
    const g = this.settings.general;
    const host = g.lan ? '0.0.0.0' : '127.0.0.1';
    let lastErr;
    for (let port = g.port; port < g.port + 10; port++) {
      try {
        await this._listenOn(port, host);
        this.port = port;
        this._updateLan();
        return;
      } catch (e) {
        lastErr = e;
        if (e.code !== 'EADDRINUSE') break;
      }
    }
    throw lastErr;
  }

  _listenOn(port, host) {
    return new Promise((resolve, reject) => {
      const onError = (e) => { this.server.off('listening', onListening); reject(e); };
      const onListening = () => { this.server.off('error', onError); resolve(); };
      this.server.once('error', onError);
      this.server.once('listening', onListening);
      this.server.listen(port, host);
    });
  }

  async _relisten() {
    for (const c of this.clients) {
      try { c.res.end(); } catch { /* egal */ }
    }
    this.clients.clear();
    await new Promise((resolve) => {
      this.server.close(() => resolve());
      this.server.closeAllConnections();
    });
    try {
      await this._listen();
    } catch (e) {
      console.error('[server] Neustart fehlgeschlagen:', e.message);
    }
    this.emit('relisten', this.baseUrl());
  }

  _updateLan() {
    const g = this.settings.general;
    this.live.lan = { enabled: g.lan, port: this.port, urls: g.lan ? lanUrls(this.port, g.token) : [] };
  }

  _authorized(req, url, res) {
    const ip = req.socket.remoteAddress || '';
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;
    const token = this.settings.general.token;
    const cookie = /(?:^|;\s*)sfl=([^;]+)/.exec(req.headers.cookie || '');
    if (url.searchParams.get('t') === token) {
      res.setHeader('Set-Cookie', `sfl=${token}; Path=/; Max-Age=31536000; SameSite=Lax`);
      return true;
    }
    if (cookie && cookie[1] === token) return true;
    res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8"><title>Glanceline</title><h1>No access · Kein Zugriff</h1><p>Please open the link (or scan the QR code) from the Glanceline panel.<br>Bitte den Link bzw. QR-Code aus dem Glanceline-Panel verwenden.</p>');
    return false;
  }

  // Schutz vor fremden Webseiten im eigenen Browser (CSRF, DNS-Rebinding)
  _trusted(req, res) {
    const host = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    const hostOk = host === 'localhost' || host === '::1' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
    let originOk = true;
    if (req.headers.origin) {
      try {
        originOk = new URL(req.headers.origin).host === req.headers.host;
      } catch {
        originOk = false;
      }
    }
    const type = String(req.headers['content-type'] || '');
    const jsonOk = req.method !== 'POST' || type.startsWith('application/json') || (req.url.startsWith('/api/voice/audio') && type === 'application/octet-stream');
    if (hostOk && originOk && jsonOk) return true;
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Verboten');
    return false;
  }

  async _handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (!this._trusted(req, res) || !this._authorized(req, url, res)) return;
    const p = url.pathname;

    if (req.method === 'GET') {
      if (p === '/') return this._file(res, 'panel.html');
      if (p === '/prompter') return this._file(res, 'prompter.html');
      if (p === '/events') return this._sse(req, res, url);
      if (p === '/api/state') return sendJson(res, this._snapshot());
      if (p === '/api/actions') return sendJson(res, this._actionList(url.searchParams.get('lang')));
      if (p === '/api/streamdeck-plugin') {
        const data = zipFolder(STREAMDECK_PLUGIN);
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="Glanceline.streamDeckPlugin"', 'Content-Length': data.length });
        return res.end(data);
      }
      if (p === '/api/obs-frame') return this._obsFrame(res, url);
      if (p === '/api/fonts') return sendJson(res, { fonts: await systemFonts() });
      if (p === '/api/obs-sources') {
        try {
          return sendJson(res, { ok: true, ...(await this.obs.sources()) });
        } catch (e) {
          return sendJson(res, { ok: false, error: e.message, inputs: [], scenes: [] });
        }
      }
      return this._file(res, decodeURIComponent(p.slice(1)));
    }

    if (req.method === 'POST' && p === '/api/voice/audio') {
      const raw = await readRaw(req, 1024 * 1024);
      const samples = new Float32Array(new Uint8Array(raw).buffer, 0, Math.floor(raw.length / 4));
      this.voice.audio(samples, clamp(Number(url.searchParams.get('sr')) || 48000, 8000, 192000));
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      if (p === '/api/action') return sendJson(res, this.action(body) || { ok: true });
      if (p === '/api/settings') {
        this.patchSettings(body);
        return sendJson(res, { ok: true });
      }
      if (p === '/api/scripts') return sendJson(res, this.scriptOp(body));
      if (p === '/api/voice/script') {
        const words = (Array.isArray(body.words) ? body.words : []).map((x) => ({ w: String(x.w || ''), h: Boolean(x.h) })).filter((x) => x.w);
        this.voice.setScript(words);
        return sendJson(res, { ok: true });
      }
      if (p === '/api/report') {
        this.report(body);
        return sendJson(res, { ok: true });
      }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Nicht gefunden');
  }

  _file(res, rel) {
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Nicht gefunden');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  }

  _sse(req, res, url) {
    const roleParam = url.searchParams.get('role');
    const role = ROLES.includes(roleParam) ? roleParam : 'panel';
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
    res.write('retry: 1500\n\n');
    const client = { res, role };
    this.clients.add(client);
    this._write(client, 'init', this._snapshot());
    this._countClients();
    req.on('close', () => {
      this.clients.delete(client);
      this._countClients();
    });
  }

  async _obsFrame(res, url) {
    const source = this.settings.camera.obsSource;
    if (!source) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('err.obs.noSource');
      return;
    }
    const width = clamp(Number(url.searchParams.get('w')) || 1280, 160, 1920);
    try {
      const jpg = await this.obs.screenshot(source, width);
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
      res.end(jpg);
    } catch (e) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(e.message);
    }
  }

  // ---------- Push an alle Clients ----------

  _snapshot() {
    return {
      settings: this.settings,
      scripts: this.store.scripts,
      live: this._liveOut(),
      history: this.history,
      defaults: { hotkeys: DEFAULT_HOTKEYS, profileKeys: PROFILE_KEYS },
    };
  }

  // Für Integrationen (Stream Deck, Companion): alle Aktionen und Modi mit Namen in der gewünschten Sprache
  _actionList(lang) {
    const l = ['de', 'en'].includes(lang) ? lang : this.lang();
    return {
      ok: true,
      lang: l,
      actions: Object.keys(DEFAULT_HOTKEYS).map((type) => ({ type, label: t(l, `action.${type}`) })),
      modes: MODES.map((id) => ({ id, label: t(l, `mode.${id}`) })),
    };
  }

  _liveOut() {
    this.live.now = Date.now();
    return this.live;
  }

  _write(client, event, data) {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  broadcast(event, data, filter) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of this.clients) if (!filter || filter(c)) c.res.write(payload);
  }

  // Live-Zustand gebündelt (max. ~25×/s) verteilen
  touch() {
    if (this.touchTimer) return;
    this.touchTimer = setTimeout(() => {
      this.touchTimer = null;
      this.broadcast('live', this._liveOut());
    }, 40);
  }

  _countClients() {
    const counts = { main: 0, preview: 0, panel: 0, api: 0 };
    for (const c of this.clients) counts[c.role]++;
    this.live.clients = counts;
    this.touch();
  }

  _cmd(cmd) {
    this.broadcast('cmd', cmd, (c) => c.role === 'main');
  }

  // ---------- Show-Timer ----------

  _showElapsed() {
    const sh = this.live.show;
    return sh.acc + (sh.running ? Date.now() - sh.startedAt : 0);
  }

  _showStart() {
    const sh = this.live.show;
    if (!sh.running) Object.assign(sh, { running: true, startedAt: Date.now() });
  }

  _showPause() {
    const sh = this.live.show;
    if (sh.running) Object.assign(sh, { running: false, acc: sh.acc + Date.now() - sh.startedAt });
  }

  // ---------- Chat ----------

  _chat(m) {
    // Mit EventSub kommt jede Kanalpunkte-Einlösung samt Text als Ereignis – die Chat-Kopie wäre doppelt
    if (m.reward && (m.platform || 'twitch') === 'twitch' && this.live.eventsub.state === 'connected') return;
    this.history.push(m);
    if (this.history.length > HISTORY_SIZE) this.history.splice(0, this.history.length - HISTORY_SIZE);
    this.broadcast('chat', m, (c) => c.role === 'main' || c.role === 'preview');
  }

  _chatClear(c) {
    if (c.all && c.platform) this.history = this.history.filter((m) => (m.platform || 'twitch') !== c.platform);
    else if (c.all) this.history = [];
    else if (c.userId) this.history = this.history.filter((m) => !(m.kind === 'msg' && m.user.id === c.userId));
    else if (c.msgId) this.history = this.history.filter((m) => m.id !== c.msgId);
    this.broadcast('chatclear', c, (cl) => cl.role === 'main' || cl.role === 'preview');
  }

  // Beispielnachrichten mit den echten Kanal-Emotes – zum Einstellen von Schrift & Emote-Größe
  _demoChat() {
    const de = this.lang() === 'de';
    const ch = this.settings.chat.channel || 'streamer';
    const user = (name, color, badges) => ({ id: `demo-${name}`, login: name.toLowerCase(), name, color, badges });
    const msg = (u, text, extra = {}) => ({ kind: 'msg', user: u, action: false, first: false, highlight: false, tokens: this.twitch.tokenize(text, ''), ...extra });
    const ev = (name, type, icon, key, vars, text) => ({ kind: 'event', user: user(name, '', []), action: false, tokens: text ? this.twitch.tokenize(text, '') : [], event: { type, icon, key, vars } });
    const samples = [
      msg(user('Brannoc', '#1E90FF', ['subscriber']), de ? 'Gute Session heute catKISS' : 'Great session today catKISS'),
      msg(user('NightOwl', '#00FF7F', ['moderator', 'subscriber']), de ? 'Wann kommt endlich der Drache? GIGACHAD' : 'When does the dragon show up? GIGACHAD'),
      msg(user('DiceGoblin', '#FF69B4', ['vip']), `@${ch} NAT 20!!! LETSGO LETSGO`, { highlight: true }),
      ev('RaidSquad', 'raid', '⚔', 'ev.raid', { name: 'RaidSquad', n: 42 }),
      msg(user('Lyra', '#8A2BE2', []), de ? 'Der Barde schon wieder OMEGALUL' : 'The bard again OMEGALUL', { first: true }),
      ev('Goldcoin', 'sub', '★', 'ev.resub', { name: 'Goldcoin', n: 12, plan: ' (Tier 1)' }, de ? 'Danke für alles! peepoDJ' : 'Thanks for everything! peepoDJ'),
      ev('7TV', 'emote', '✦', 'ev.emoteAdded', { actor: 'NightOwl', emote: 'catKISS' }, 'catKISS'),
    ];
    const c = this.settings.chat;
    const platforms = [c.channel && 'twitch', c.youtube && 'youtube', c.kick && 'kick'].filter(Boolean);
    if (platforms.length > 1) {
      samples.splice(2, 0, { ...msg(user('MapleSyrup', '', ['subscriber']), de ? 'Hallo von YouTube 👋' : 'Hello from YouTube 👋'), platform: 'youtube' });
      samples.splice(5, 0, { ...msg(user('GreenLantern', '#53FC18', []), de ? 'Kick ist auch da LETSGO' : 'Kick is here too LETSGO'), platform: 'kick' });
      samples.push({ ...ev('Patron', 'bits', '💲', 'ev.superchat', { name: 'Patron', amount: '€5.00' }, de ? 'Für den Drachen!' : 'For the dragon!'), platform: 'youtube' });
      samples.forEach((m) => { if (!m.platform) m.platform = 'twitch'; });
      for (const m of samples) if (!platforms.includes(m.platform)) m.platform = platforms[0];
    }
    samples.forEach((m, i) => {
      setTimeout(() => this._chat({ ...m, id: `demo-${Date.now()}-${i}`, ts: Date.now() }), i * 450);
    });
  }

  // ---------- PowerPoint ----------

  _ppt(p) {
    const prev = this.live.ppt;
    const timer = prev.timer;
    const inShow = (m) => m === 'show' || m === 'end';
    const wasShow = inShow(prev.mode);
    const isShow = inShow(p.mode);
    this.live.ppt = {
      running: Boolean(p.running),
      mode: p.mode || 'none',
      slide: Number(p.slide) || 0,
      total: Number(p.total) || 0,
      title: cleanText(p.title),
      notes: cleanText(p.notes),
      nextTitle: cleanText(p.nextTitle),
      file: String(p.file || ''),
      paused: Boolean(p.paused),
      timer,
    };
    if (p.mode === 'show' && p.slide && p.slide !== prev.slide) this._chapter(`${p.slide}: ${cleanText(p.title) || 'Slide'}`);
    if (isShow && !wasShow) {
      Object.assign(timer, { running: true, startedAt: Date.now(), acc: 0 });
      if (this.settings.ppt.autoSwitch && this.live.mode !== 'ppt') {
        const before = this.live.mode;
        this._setMode('ppt');
        this.live.prevMode = before;
      }
    }
    if (!isShow && wasShow) {
      if (timer.running) Object.assign(timer, { running: false, acc: timer.acc + Date.now() - timer.startedAt });
      if (this.settings.ppt.autoSwitch && this.live.mode === 'ppt' && this.live.prevMode) this._setMode(this.live.prevMode);
      this.live.prevMode = null;
    }
    this.touch();
  }

  // ---------- Aktionen (Panel, Hotkeys, Tray) ----------

  _setMode(mode) {
    if (!MODES.includes(mode)) return;
    if (this.live.mode === 'script' && mode !== 'script') this.live.script.playing = false;
    const changed = this.live.mode !== mode;
    this.live.mode = mode;
    this.live.prevMode = null;
    this.live.blackout = false;
    this._setPassthrough(false); // Moduswechsel holt den Prompter zurück
    if (changed) {
      const pid = this._profileFor(mode);
      if (pid && pid !== this.settings.profiles.active) this._applyProfile(pid);
      this.emit('mode', mode);
    }
  }

  // ---------- MIDI ----------

  // Ereignis vom Controller (gemeldet vom Prompter-Fenster, das Web MIDI liest).
  // down: true = gedrückt, false = losgelassen, null = Regler bewegt
  _midi(key, down, value) {
    if (!/^(note|cc|pc):\d{1,2}:\d{1,3}$/.test(key)) return;
    const L = this.live;
    L.midi.last = { key, at: Date.now() };
    if (L.midi.learn) {
      // Tempo lernt mit jedem Regler, alles andere mit einem Tastendruck
      if (down === true || (L.midi.learn === 'script:speed' && key.startsWith('cc:'))) {
        const target = L.midi.learn;
        L.midi.learn = null;
        clearTimeout(this.midiLearnTimer);
        this.patchSettings({ midi: { map: { ...this.settings.midi.map, [key]: target } } });
      }
      this.touch();
      return;
    }
    this.touch();
    const act = this.settings.midi.map[key];
    if (!act || !this.settings.midi.enabled) return;
    if (act === 'script:speed') {
      if (Number.isFinite(value)) this.patchSettings({ script: { speed: Math.round(10 + (clamp(value, 0, 127) / 127) * 290) } });
      return;
    }
    this.midiHolds = this.midiHolds || {};
    const scroll = act === 'view:back' || act === 'view:forward';
    if (down === true) {
      if (scroll && L.mode === 'script') {
        // wie Clicker & Stream Deck: antippen = eine Zeile, halten = flüssig scrollen
        const dir = act === 'view:forward' ? 1 : -1;
        this._midiRelease(key);
        this.action({ type: act, target: 'script', amount: 'line', source: 'midi' });
        const hold = {};
        hold.delay = setTimeout(() => {
          hold.timer = setInterval(() => this.action({ type: 'script:hold', dir }), 150);
          this.action({ type: 'script:hold', dir });
        }, 350);
        this.midiHolds[key] = hold;
      } else {
        this.action({ type: act, source: 'midi' });
      }
    } else if (down === false) {
      this._midiRelease(key);
    }
  }

  _midiRelease(key) {
    const h = this.midiHolds && this.midiHolds[key];
    if (!h) return;
    clearTimeout(h.delay);
    if (h.timer) {
      clearInterval(h.timer);
      this.action({ type: 'script:hold', dir: 0 });
    }
    delete this.midiHolds[key];
  }

  // ---------- Profile ----------

  // Profil für einen Modus: im Skript-Modus zuerst das Profil des Skripts, sonst die Zuordnung je Modus
  _profileFor(mode) {
    if (this.live.insert) return '';
    const p = this.settings.profiles;
    if (mode === 'script') {
      const it = this.store.scripts.items.find((x) => x.id === this.store.scripts.activeId);
      if (it && it.profile && p.list.some((x) => x.id === it.profile)) return it.profile;
    }
    return p.byMode[mode] || '';
  }

  _profileValues() {
    const values = {};
    for (const k of PROFILE_KEYS) {
      const keys = k.split('.');
      const last = keys.pop();
      const obj = keys.reduce((o, key) => (o[key] = o[key] || {}), values);
      obj[last] = getPath(this.settings, k);
    }
    return values;
  }

  _applyProfile(id) {
    const p = this.settings.profiles.list.find((x) => x.id === id);
    if (!p) return { ok: false, error: 'profile not found' };
    this.patchSettings({ ...JSON.parse(JSON.stringify(p.values)), profiles: { active: id } });
    return { ok: true };
  }

  _setPassthrough(on) {
    if (this.live.passthrough === on) return;
    this.live.passthrough = on;
    this.emit('passthrough', on);
  }

  // Kapitelmarke in der laufenden OBS-Aufnahme (OBS 30.2+, Hybrid-MP4)
  _chapter(name) {
    if (!this.settings.obsAuto.chapters || !this.live.obs.recording) return;
    this.obs.request('CreateRecordChapter', { chapterName: String(name).slice(0, 100) }).catch(() => {});
  }

  // Einschub: kurzes Skript dazwischenschieben, danach zurück an die alte Stelle
  _startInsert(slot) {
    const L = this.live;
    const sc = this.store.scripts;
    const id = this.settings.inserts[slot];
    const item = sc.items.find((x) => x.id === id);
    if (!item) return { ok: false, error: 'no insert script for this slot' };
    if (L.insert && L.insert.slot === slot) return this._endInsert();
    const prev = L.insert ? L.insert.prev : { mode: L.mode, scriptId: sc.activeId, pos: L.script.pos, playing: L.script.playing };
    L.insert = { slot, title: item.title, prev };
    sc.activeId = id;
    this._scriptsChanged();
    this._setMode('script');
    Object.assign(L.script, { playing: true, pos: 0, instant: true, dir: 1 });
    this.voice.seek(0);
    this.touch();
    return { ok: true };
  }

  _endInsert() {
    const L = this.live;
    if (!L.insert) return { ok: true };
    const { prev } = L.insert;
    L.insert = null;
    const sc = this.store.scripts;
    if (prev.scriptId && sc.items.some((x) => x.id === prev.scriptId)) sc.activeId = prev.scriptId;
    this._scriptsChanged();
    Object.assign(L.script, { playing: false, instant: false, restoreTo: { id: sc.activeId, pos: prev.pos, token: Date.now() } });
    this._setMode(prev.mode);
    this.touch();
    return { ok: true };
  }

  action(a = {}) {
    const L = this.live;
    const s = this.settings;
    const type = String(a.type || '');

    if (type.startsWith('mode:')) {
      this._setMode(type.slice(5));
      this.touch();
      return { ok: true };
    }

    switch (type) {
      case 'blackout':
        L.blackout = typeof a.value === 'boolean' ? a.value : !L.blackout;
        break;
      case 'camera:toggle':
        this.patchSettings({ camera: { enabled: !s.camera.enabled } });
        break;
      case 'mirror:toggle':
        this.patchSettings({ display: { mirror: !s.display.mirror } });
        break;

      case 'script:toggle':
        return this.action({ type: L.script.playing ? 'script:pause' : 'script:play' });
      case 'script:reverse':
        L.script.dir = L.script.dir === -1 ? 1 : -1;
        break;
      case 'script:play':
        if (L.script.max > 0 && L.script.pos >= L.script.max - 2) {
          L.script.pos = 0;
          this._cmd({ cmd: 'seek', pos: 0 });
        }
        if (L.mode !== 'script') this._setMode('script');
        L.script.playing = true;
        if (s.timers.start === 'script') this._showStart();
        if (s.obsAuto.recordWithScript && L.obs.connected && !L.obs.recording) this.obs.request('StartRecord').catch(() => {});
        break;
      case 'script:pause':
        L.script.playing = false;
        break;
      case 'script:restart':
        L.script.playing = false;
        L.script.pos = 0;
        L.section = null;
        this.voice.seek(0);
        this._cmd({ cmd: 'seek', pos: 0 });
        break;
      case 'script:faster':
      case 'script:slower': {
        const sp = s.script.speed;
        const step = Math.max(4, Math.round(sp * 0.12));
        this.patchSettings({ script: { speed: sp + (type === 'script:faster' ? step : -step) } });
        break;
      }
      case 'script:hold': {
        // Taste gehalten: flüssig scrollen (dir 0 = loslassen)
        const dir = Math.sign(Number(a.dir) || 0);
        this._cmd({ cmd: 'hold', dir });
        break;
      }
      case 'script:prevSection':
      case 'script:nextSection':
        this._cmd({ cmd: 'section', dir: type === 'script:nextSection' ? 1 : -1 });
        break;
      case 'script:section':
        this._cmd({ cmd: 'sectionIndex', index: Number(a.index) || 0 });
        break;
      case 'script:seek':
        this._cmd({ cmd: 'seekFrac', frac: clamp(Number(a.frac) || 0, 0, 1) });
        break;
      case 'script:select':
        return this.scriptOp({ op: 'activate', id: a.id });

      case 'view:back':
      case 'view:forward': {
        const dir = type === 'view:back' ? -1 : 1;
        const target = a.target || L.mode;
        if (target === 'script') this._cmd({ cmd: 'nudge', dir, amount: a.amount === 'line' ? 'line' : 'page' });
        else if (target === 'ppt') this._cmd({ cmd: 'pptScroll', dir });
        else if (target === 'chat') {
          // Im Chat zurückspulen (pausiert automatisch); ganz vorne angekommen läuft er live weiter
          L.chat.offset = clamp(L.chat.offset - dir * 3, 0, 150);
          L.chat.paused = L.chat.offset > 0;
        }
        break;
      }
      case 'font:bigger':
      case 'font:smaller': {
        const d = type === 'font:bigger' ? 1 : -1;
        const target = a.target || L.mode;
        if (target === 'chat') this.patchSettings({ chat: { fontSize: s.chat.fontSize + 2 * d } });
        else if (target === 'script') this.patchSettings({ script: { fontSize: s.script.fontSize + 4 * d } });
        else if (target === 'ppt') this.patchSettings({ ppt: { maxFontSize: s.ppt.maxFontSize + 4 * d, minFontSize: s.ppt.minFontSize + 2 * d } });
        break;
      }

      case 'streamdeck:install': {
        // Plugin-Datei öffnen – die Stream-Deck-Software installiert bzw. aktualisiert es dann selbst
        const file = path.join(os.tmpdir(), 'Glanceline.streamDeckPlugin');
        fs.writeFileSync(file, zipFolder(STREAMDECK_PLUGIN));
        this.emit('openPath', file);
        for (const ms of [5000, 15000, 40000]) {
          setTimeout(() => {
            this.live.app.streamDeck = streamDeckInfo();
            this.touch();
          }, ms);
        }
        break;
      }
      case 'prompter:power':
        // Prompter-Display in Windows ab- bzw. anmelden (true = an, false = aus, ohne = umschalten)
        if (!L.power.busy) this.emit('prompterPower', typeof a.on === 'boolean' ? a.on : undefined);
        break;
      case 'library:pick':
        this.emit('pickFolder');
        break;
      case 'library:open':
        if (s.library.folder) this.emit('openPath', s.library.folder);
        break;
      case 'library:clear':
        this.patchSettings({ library: { folder: '' } });
        break;
      case 'library:edit': {
        // nur Dateien, die wirklich aus dem verknüpften Ordner stammen
        const it = this.store.scripts.items.find((x) => x.id === a.id);
        if (it && it.file) this.emit('openPath', it.file);
        break;
      }

      case 'twitch:login':
        this.eventsub.login();
        break;
      case 'twitch:loginCancel':
        this.eventsub.cancelLogin();
        break;
      case 'twitch:logout':
        this.eventsub.logout();
        break;
      case 'midi:learn':
        // Nächste Taste am Controller wird dieser Aktion zugeordnet (ohne Ziel = abbrechen)
        L.midi.learn = a.target ? String(a.target) : null;
        clearTimeout(this.midiLearnTimer);
        if (L.midi.learn) {
          this.midiLearnTimer = setTimeout(() => {
            L.midi.learn = null;
            this.touch();
          }, 20000);
        }
        break;
      case 'midi:unmap': {
        const map = { ...s.midi.map };
        delete map[a.key];
        this.patchSettings({ midi: { map } });
        break;
      }
      case 'profile:save': {
        const list = s.profiles.list;
        const name = String(a.name || '').trim().slice(0, 40) || t(this.lang(), 'profiles.defaultName', { n: list.length + 1 });
        const id = newId();
        this.patchSettings({ profiles: { list: [...list, { id, name, values: this._profileValues() }], active: id } });
        return { ok: true, id };
      }
      case 'profile:update': {
        const id = a.id || s.profiles.active;
        if (!s.profiles.list.some((x) => x.id === id)) return { ok: false, error: 'profile not found' };
        this.patchSettings({ profiles: { list: s.profiles.list.map((x) => (x.id === id ? { ...x, values: this._profileValues() } : x)), active: id } });
        break;
      }
      case 'profile:rename':
        this.patchSettings({ profiles: { list: s.profiles.list.map((x) => (x.id === a.id ? { ...x, name: String(a.name || '') } : x)) } });
        break;
      case 'profile:delete':
        this.patchSettings({ profiles: { list: s.profiles.list.filter((x) => x.id !== a.id) } });
        for (const it of this.store.scripts.items) if (it.profile === a.id) delete it.profile;
        break;
      case 'profile:apply':
        if (!a.id) {
          this.patchSettings({ profiles: { active: '' } });
          break;
        }
        return this._applyProfile(String(a.id));
      case 'profile:1':
      case 'profile:2':
      case 'profile:3':
      case 'profile:4': {
        const p = s.profiles.list[Number(type.slice(8)) - 1];
        return p ? this._applyProfile(p.id) : { ok: false, error: 'no profile in this slot' };
      }
      case 'profile:next': {
        const list = s.profiles.list;
        if (!list.length) return { ok: false, error: 'no profiles' };
        const i = list.findIndex((x) => x.id === s.profiles.active);
        return this._applyProfile(list[(i + 1) % list.length].id);
      }

      case 'show:toggle':
        if (L.show.running) this._showPause();
        else this._showStart();
        break;
      case 'show:reset':
        Object.assign(L.show, { acc: 0, startedAt: Date.now() });
        L.section = null;
        break;

      case 'ppt:timerReset':
        Object.assign(L.ppt.timer, { acc: 0, startedAt: Date.now() });
        break;
      case 'ppt:timerToggle': {
        const t = L.ppt.timer;
        if (t.running) Object.assign(t, { running: false, acc: t.acc + Date.now() - t.startedAt });
        else Object.assign(t, { running: true, startedAt: Date.now() });
        break;
      }

      case 'chat:pause':
        L.chat.paused = !L.chat.paused;
        if (!L.chat.paused) L.chat.offset = 0;
        break;
      case 'passthrough':
        this._setPassthrough(typeof a.value === 'boolean' ? a.value : !L.passthrough);
        break;
      case 'director:send': {
        const text = String(a.text || '').trim().slice(0, 200);
        if (!text) return { ok: false, error: 'empty message' };
        const secs = clamp(Number(a.seconds) || s.director.seconds, 3, 300);
        L.director = { id: newId(), text, until: Date.now() + secs * 1000 };
        break;
      }
      case 'director:clear':
        L.director = null;
        break;
      case 'insert:1':
      case 'insert:2':
      case 'insert:3':
      case 'insert:4':
        return this._startInsert(type.slice(7));
      case 'insert:return':
        return this._endInsert();
      case 'chat:clear':
        this._chatClear({ all: true });
        break;
      case 'voice:toggle':
        this.patchSettings({ voice: { enabled: !s.voice.enabled } });
        break;
      case 'voice:download':
        this.voice.download(VOICE_LANGUAGES.includes(a.lang) ? a.lang : this.voiceLang());
        break;
      case 'voice:delete':
        if (VOICE_LANGUAGES.includes(a.lang)) this.voice.deleteModel(a.lang);
        break;
      case 'chat:demo':
        this._demoChat();
        break;
      case 'emotes:reload':
        this.twitch.reloadEmotes();
        this.youtube.reloadEmotes();
        this.kick.reloadEmotes();
        break;
      case 'twitch:reconnect':
      case 'chat:reconnect':
        this.twitch.restart();
        this.youtube.restart();
        this.kick.restart();
        break;
      case 'obs:reconnect':
        this.obs.restart();
        break;

      case 'hotkeys:suspend':
        // Während im Panel ein Kürzel aufgenommen wird, dürfen die globalen Hotkeys nicht greifen
        L.hotkeys.suspended = true;
        this.emit('hotkeys:suspend', true);
        clearTimeout(this.hotkeyResumeTimer);
        this.hotkeyResumeTimer = setTimeout(() => this.action({ type: 'hotkeys:resume' }), 30000);
        break;
      case 'hotkeys:resume':
        clearTimeout(this.hotkeyResumeTimer);
        if (L.hotkeys.suspended) {
          L.hotkeys.suspended = false;
          this.emit('hotkeys:suspend', false);
        }
        break;

      case 'token:regen':
        this.patchSettings({ general: { token: newToken() } });
        break;
      case 'prompter:place':
        this.emit('display');
        break;

      default:
        return { ok: false, error: `unknown action: ${type}` };
    }
    this.touch();
    return { ok: true };
  }

  patchSettings(patch) {
    if (!isObj(patch)) return;
    const watched = ['clicker', 'twitch.clientId', 'library.folder', 'chat.channel', 'chat.youtube', 'chat.kick', 'chat.providers', 'chat.hideBots', 'obs', 'general.lan', 'general.port', 'general.token', 'general.autostart', 'general.language', 'hotkeys', 'display', 'voice.enabled', 'voice.lang'];
    const snap = (k) => JSON.stringify(getPath(this.settings, k));
    const before = Object.fromEntries(watched.map((k) => [k, snap(k)]));

    // Szenen-Zuordnung ersetzen statt mischen (Szenennamen sind frei wählbar)
    if (isObj(patch.obsAuto) && isObj(patch.obsAuto.sceneModes)) {
      this.settings.obsAuto.sceneModes = { ...patch.obsAuto.sceneModes };
      delete patch.obsAuto.sceneModes;
    }
    if (isObj(patch.midi) && isObj(patch.midi.map)) {
      this.settings.midi.map = { ...patch.midi.map };
      delete patch.midi.map;
    }
    // Profil-Zuordnung je Modus ebenfalls ersetzen
    if (isObj(patch.profiles) && isObj(patch.profiles.byMode)) {
      this.settings.profiles.byMode = { ...patch.profiles.byMode };
      delete patch.profiles.byMode;
    }
    deepAssign(this.settings, patch);
    this.store.sanitize();
    this.store.save('settings');

    const changed = (k) => before[k] !== snap(k);
    if (changed('chat.channel')) {
      this._chatClear({ all: true, platform: 'twitch' });
      this.twitch.restart();
    } else if (changed('chat.providers')) {
      this.twitch.reloadEmotes();
    }
    if (changed('chat.youtube')) {
      this._chatClear({ all: true, platform: 'youtube' });
      this.youtube.restart();
    } else if (changed('chat.providers')) {
      this.youtube.reloadEmotes();
    }
    if (changed('chat.kick')) {
      this._chatClear({ all: true, platform: 'kick' });
      this.kick.restart();
    } else if (changed('chat.providers')) {
      this.kick.reloadEmotes();
    }
    if (changed('obs')) this.obs.restart();
    if (changed('twitch.clientId')) this.eventsub._set({}); // „Verbinden“-Knopf freigeben
    if (changed('library.folder')) this.folder.watch(this.settings.library.folder);
    if (changed('hotkeys') || changed('clicker')) this.emit('hotkeys');
    if (changed('display')) this.emit('display');
    if (changed('general.autostart')) this.emit('autostart');
    if (changed('general.language')) this.emit('language');
    if (changed('voice.enabled') || changed('voice.lang') || (changed('general.language') && this.settings.voice.lang === 'auto')) this._syncVoice();
    if (changed('general.lan') || changed('general.port')) {
      setTimeout(() => this._relisten(), 150); // erst die laufende Antwort zustellen
    } else if (changed('general.token')) {
      this._updateLan();
      this.touch();
    }
    this.broadcast('settings', this.settings);
  }

  scriptOp(b = {}) {
    const sc = this.store.scripts;
    const find = (id) => sc.items.find((x) => x.id === id);
    switch (b.op) {
      case 'create': {
        const item = { id: newId(), title: String(b.title || t(this.lang(), 'scripts.newTitle')), body: String(b.body || ''), updatedAt: Date.now() };
        sc.items.push(item);
        if (!sc.activeId) sc.activeId = item.id;
        this._scriptsChanged();
        return { ok: true, id: item.id, item };
      }
      case 'save': {
        const it = find(b.id);
        if (!it) return { ok: false, error: 'script not found' };
        if (it.file) return { ok: false, error: 'linked to a file' };
        if (typeof b.title === 'string') it.title = b.title;
        if (typeof b.body === 'string') it.body = b.body;
        it.updatedAt = Date.now();
        this._scriptsChanged();
        return { ok: true };
      }
      case 'profile': {
        // Profil eines Skripts festlegen (geht auch bei Skripten aus dem verknüpften Ordner)
        const it = find(b.id);
        if (!it) return { ok: false, error: 'script not found' };
        if (b.profile && this.settings.profiles.list.some((x) => x.id === b.profile)) it.profile = String(b.profile);
        else delete it.profile;
        this._scriptsChanged();
        return { ok: true };
      }
      case 'delete': {
        if (find(b.id) && find(b.id).file) return { ok: false, error: 'linked to a file' };
        sc.items = sc.items.filter((x) => x.id !== b.id);
        if (sc.activeId === b.id) {
          sc.activeId = sc.items.length ? sc.items[0].id : null;
          this._resetScript();
        }
        this._scriptsChanged();
        return { ok: true };
      }
      case 'activate': {
        this.live.section = null;
        if (!find(b.id)) return { ok: false, error: 'script not found' };
        if (sc.activeId !== b.id) {
          sc.activeId = b.id;
          this._resetScript();
          // Skript mit eigenem Profil: im Skript-Modus gleich anwenden
          const pid = this.live.mode === 'script' ? this._profileFor('script') : '';
          if (pid && pid !== this.settings.profiles.active) this._applyProfile(pid);
        }
        this._scriptsChanged();
        return { ok: true };
      }
      default:
        return { ok: false, error: 'unknown operation' };
    }
  }

  // Skripte aus dem verknüpften Ordner übernehmen (neu, geändert, gelöscht)
  _syncFolder(files) {
    const sc = this.store.scripts;
    const byFile = new Map(files.map((f) => [f.file, f]));
    let changed = false;
    const kept = sc.items.filter((it) => !it.file || byFile.has(it.file));
    if (kept.length !== sc.items.length) {
      sc.items = kept;
      changed = true;
      if (!sc.items.some((x) => x.id === sc.activeId)) {
        sc.activeId = sc.items.length ? sc.items[0].id : null;
        this._resetScript();
      }
    }
    for (const f of files) {
      const it = sc.items.find((x) => x.file === f.file);
      if (!it) {
        sc.items.push({ id: newId(), title: f.title, body: f.body, file: f.file, updatedAt: f.mtime });
        if (!sc.activeId) sc.activeId = sc.items[sc.items.length - 1].id;
        changed = true;
      } else if (it.body !== f.body || it.title !== f.title) {
        Object.assign(it, { title: f.title, body: f.body, updatedAt: f.mtime });
        changed = true;
      }
    }
    if (changed) this._scriptsChanged();
  }

  _resetScript() {
    Object.assign(this.live.script, { playing: false, pos: 0 });
    this.voice.seek(0);
    this.touch();
  }

  _scriptsChanged() {
    this.store.save('scripts');
    this.broadcast('scripts', this.store.scripts);
  }

  // Rückmeldungen vom Prompter-Fenster
  report(b = {}) {
    const L = this.live;
    if (b.kind === 'script') {
      if (Number.isFinite(b.pos)) L.script.pos = b.pos;
      if (Number.isFinite(b.max)) L.script.max = b.max;
      if (b.ended) {
        L.script.playing = false;
        if (L.insert) this._endInsert(); // Einschub fertig → zurück an die alte Stelle
      }
    } else if (b.kind === 'section') {
      if (L.script.playing && b.title) this._chapter(String(b.title));
      if (L.insert || !Number.isInteger(b.index)) return;
      // Zeitplan: Startpunkt merken, sobald das Skript (erneut) zu laufen beginnt
      const id = this.store.scripts.activeId;
      const at = this._showElapsed();
      const prev = L.section && L.section.id === id ? L.section : null;
      const startOver = !prev || b.index < prev.baseIndex;
      L.section = {
        id,
        index: b.index,
        title: String(b.title || ''),
        at,
        base: startOver ? at : prev.base,
        baseIndex: startOver ? b.index : prev.baseIndex,
      };
    } else if (b.kind === 'midi-devices') {
      L.midi.devices = (Array.isArray(b.devices) ? b.devices : []).map((d) => String(d).slice(0, 80)).slice(0, 20);
      L.midi.error = String(b.error || '').slice(0, 200);
    } else if (b.kind === 'midi') {
      this._midi(String(b.key || ''), b.down, Number(b.value));
      return;
    } else if (b.kind === 'voice-seek') {
      if (Number.isFinite(b.pos)) this.voice.seek(b.pos);
      return;
    } else if (b.kind === 'voice-level') {
      L.voiceLevel = Math.max(0, Math.min(1, Number(b.level) || 0));
    } else if (b.kind === 'devices') {
      L.camera.devices = (Array.isArray(b.devices) ? b.devices : [])
        .map((d) => ({ label: String((d && d.label) || '') }))
        .filter((d) => d.label);
      L.mics = (Array.isArray(b.mics) ? b.mics : []).map((d) => ({ label: String((d && d.label) || '') })).filter((d) => d.label);
    } else if (b.kind === 'camera') {
      Object.assign(L.camera, { active: Boolean(b.active), error: String(b.error || ''), label: String(b.label || '') });
    } else {
      return;
    }
    this.touch();
  }

  // ---------- Infos aus Electron ----------

  setDisplays(list) {
    this.live.displays = list;
    this.touch();
  }

  setPrompterInfo(info) {
    this.live.prompter = info;
    this.touch();
  }

  setHotkeyErrors(errors) {
    this.live.hotkeys.errors = errors;
    this.touch();
  }

  setPower(patch) {
    Object.assign(this.live.power, patch);
    this.touch();
  }

  setAppInfo(info) {
    Object.assign(this.live.app, info);
    this.touch();
  }
}

module.exports = { Glanceline, MODES };

// Ohne Electron starten: `npm run server` → Panel im Browser, Prompter unter /prompter
if (require.main === module) {
  const { dataDir, migrateLegacyData } = require('./paths');
  migrateLegacyData(dataDir());
  const core = new Glanceline({ dataDir: dataDir() });
  core
    .start()
    .then(() => console.log(`Glanceline läuft: ${core.baseUrl()}  ·  Prompter-Ansicht: ${core.baseUrl()}/prompter`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
  const bye = () => {
    core.stop();
    process.exit(0);
  };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}
