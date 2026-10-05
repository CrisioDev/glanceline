'use strict';
const { EventEmitter } = require('events');
const crypto = require('crypto');
const { loadEmotes, buildMap, countsOf, fromSevenTv, fetchSevenTvEmote } = require('./emotes');
const { SevenTvEvents } = require('./seventv-events');
const { TokenBuilder } = require('./chat-tokens');

// Anonymer Lesezugriff auf den Twitch-Chat (justinfan) – kein Login, kein Token nötig.
const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';
const TAG_ESCAPES = { s: ' ', ':': ';', '\\': '\\', r: '\r', n: '\n' };
const BADGES = ['broadcaster', 'moderator', 'vip', 'subscriber', 'founder'];
const TIERS = { Prime: 'Prime', 1000: 'Tier 1', 2000: 'Tier 2', 3000: 'Tier 3' };
const EMOTE_REFRESH_MS = 10 * 60 * 1000;
const VIEWERS_MS = 60 * 1000;
// Öffentliche Client-ID des Twitch-Webplayers – nur für die Zuschauerzahl, ohne Login
const GQL_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

const unescapeTag = (v) => v.replace(/\\(.?)/g, (_, c) => TAG_ESCAPES[c] ?? c);

function parseIrc(line) {
  const msg = { tags: {}, prefix: '', command: '', params: [] };
  let rest = line;
  if (rest[0] === '@') {
    const sp = rest.indexOf(' ');
    for (const pair of rest.slice(1, sp).split(';')) {
      const eq = pair.indexOf('=');
      if (eq < 0) msg.tags[pair] = '';
      else msg.tags[pair.slice(0, eq)] = unescapeTag(pair.slice(eq + 1));
    }
    rest = rest.slice(sp + 1);
  }
  if (rest[0] === ':') {
    const sp = rest.indexOf(' ');
    msg.prefix = rest.slice(1, sp);
    rest = rest.slice(sp + 1);
  }
  const ti = rest.indexOf(' :');
  const trailing = ti >= 0 ? rest.slice(ti + 2) : null;
  if (ti >= 0) rest = rest.slice(0, ti);
  const parts = rest.split(' ').filter(Boolean);
  msg.command = parts.shift() || '';
  msg.params = trailing === null ? parts : [...parts, trailing];
  return msg;
}

const twitchEmote = (id, name) => ({
  t: 'emote',
  n: name,
  p: 'twitch',
  u: [1, 2, 3].map((s) => `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/${s}.0`),
});

class TwitchChat extends EventEmitter {
  constructor(getSettings) {
    super();
    this.getSettings = getSettings;
    this.ws = null;
    this.channel = '';
    this.roomId = '';
    this.emotes = new Map();
    this.lists = null; // Emotes je Quelle (für Live-Updates)
    this.stv = { setId: '', userId: '' };
    this.giftBatches = new Map();
    this.retry = 0;
    this.lastRx = Date.now();
    this.stopped = false;
    this.status = {
      connected: false,
      joined: false,
      channel: '',
      roomId: '',
      error: '',
      emotes: null,
      emoteErrors: [],
      emotesLoadedAt: 0,
      seventvLive: { connected: false, error: '', setId: '' },
      viewers: null, // null = offline oder unbekannt
    };

    this.stvEvents = new SevenTvEvents();
    this.stvEvents.on('status', (st) => this._set({ seventvLive: { ...st, setId: this.stv.setId } }));
    this.stvEvents.on('dispatch', (d) => this._onSevenTv(d).catch((e) => console.warn('[7tv]', e.message)));
    // Nach einem Verbindungsabbruch könnten Änderungen fehlen → einmal komplett nachladen
    let readyCount = 0;
    this.stvEvents.on('ready', () => {
      if (++readyCount > 1) this.reloadEmotes();
    });
  }

  start() {
    this.stopped = false;
    this._connect();
    this.emoteTimer = setInterval(() => this.reloadEmotes(), EMOTE_REFRESH_MS);
    this.watchdog = setInterval(() => {
      if (!this.ws || this.ws.readyState !== 1) return;
      const idle = Date.now() - this.lastRx;
      if (idle > 6 * 60 * 1000) this.restart();
      else if (idle > 4 * 60 * 1000) this.ws.send('PING :glanceline');
    }, 30 * 1000);
    this.viewerTimer = setInterval(() => this._viewers(), VIEWERS_MS);
  }

  // Zuschauerzahl über die öffentliche GraphQL-Schnittstelle (inoffiziell – fällt sie aus, bleibt die Zahl leer)
  async _viewers() {
    if (!this.channel || !this.status.joined) return;
    try {
      const res = await fetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: { 'Client-Id': GQL_CLIENT_ID, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'query($l:String!){user(login:$l){stream{viewersCount}}}', variables: { l: this.channel } }),
        signal: AbortSignal.timeout(10000),
      });
      const j = await res.json();
      const st = j && j.data && j.data.user && j.data.user.stream;
      const viewers = st ? Number(st.viewersCount) || 0 : null;
      if (viewers !== this.status.viewers) this._set({ viewers });
    } catch { /* egal – nächster Versuch in einer Minute */ }
  }

  stop() {
    this.stopped = true;
    this.stvEvents.stop();
    clearTimeout(this.stvResyncTimer);
    clearInterval(this.emoteTimer);
    clearInterval(this.watchdog);
    clearInterval(this.viewerTimer);
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.joinTimer);
    const ws = this.ws;
    this.ws = null;
    try { ws && ws.close(); } catch { /* egal */ }
  }

  restart() {
    const ws = this.ws;
    this.ws = null;
    try { ws && ws.close(); } catch { /* egal */ }
    this.retry = 0;
    this._connect();
  }

  _set(patch) {
    Object.assign(this.status, patch);
    this.emit('status', { ...this.status });
  }

  _connect() {
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.joinTimer);
    const channel = this.getSettings().chat.channel;
    if (channel !== this.channel) {
      this.emotes = new Map();
      this.lists = null;
      this.roomId = '';
      this.stv = { setId: '', userId: '' };
      this.stvEvents.watch([]);
    }
    this.channel = channel;
    this._set({ connected: false, joined: false, channel, roomId: this.roomId, viewers: null, error: channel ? '' : 'err.twitch.noChannel', errorVars: null });
    if (!channel || this.stopped) return;

    let ws;
    try {
      ws = new WebSocket(IRC_URL);
    } catch (e) {
      this._scheduleReconnect(e.message);
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.retry = 0;
      this.lastRx = Date.now();
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      ws.send('PASS SCHMOOPIIE');
      ws.send(`NICK justinfan${10000 + Math.floor(Math.random() * 80000)}`);
      ws.send(`JOIN #${channel}`);
      this._set({ connected: true, error: '', errorVars: null });
      this.joinTimer = setTimeout(() => {
        if (this.ws === ws && !this.status.joined) this._set({ error: 'err.twitch.noAnswer', errorVars: { channel } });
      }, 10000);
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.lastRx = Date.now();
      for (const line of String(ev.data).split('\r\n')) if (line) this._onLine(line);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this._set({ connected: false, joined: false });
      if (!this.stopped) this._scheduleReconnect();
    };
    ws.onerror = () => { /* onclose folgt */ };
  }

  _scheduleReconnect(err) {
    const delay = Math.min(30000, 1000 * 2 ** this.retry++);
    if (err) this._set({ error: err, errorVars: null });
    this.reconnectTimer = setTimeout(() => this._connect(), delay);
  }

  async reloadEmotes() {
    if (!this.roomId) return;
    const roomId = this.roomId;
    const providers = this.getSettings().chat.providers;
    const { lists, errors, seventv } = await loadEmotes(roomId, providers);
    if (roomId !== this.roomId) return; // Kanal wurde inzwischen gewechselt
    this.lists = lists;
    this.stv = seventv;
    this._rebuildEmotes();
    this._set({ emoteErrors: errors, emotesLoadedAt: Date.now() });

    // 7TV-Live-Updates für genau dieses Set und dieses Konto abonnieren
    if (providers.seventv) {
      this.stvEvents.start();
      this.stvEvents.watch([
        { type: 'emote_set.update', id: seventv.setId },
        { type: 'user.update', id: seventv.userId },
      ]);
    } else {
      this.stvEvents.watch([]);
      this.stvEvents.stop();
    }
    this._set({ seventvLive: { ...this.stvEvents.status, setId: seventv.setId } });
  }

  _rebuildEmotes() {
    this.emotes = buildMap(this.lists);
    this._set({ emotes: countsOf(this.lists) });
  }

  // ---------- 7TV-Live-Updates ----------

  async _onSevenTv(d) {
    const body = d.body || {};
    const actor = (body.actor && (body.actor.display_name || body.actor.username)) || '?';

    if (d.type === 'user.update') {
      if (body.id !== this.stv.userId) return;
      // Anderes Emote-Set aktiviert → komplett neu laden
      const switched = (body.updated || []).some(
        (u) => u.key === 'connections' && (Array.isArray(u.value) ? u.value : []).some((v) => v && v.key === 'emote_set'),
      );
      if (switched) {
        await this.reloadEmotes();
        this._emoteNotice('ev.emoteSet', { actor });
      }
      return;
    }

    if (d.type !== 'emote_set.update' || body.id !== this.stv.setId || !this.lists) return;
    const list = this.lists.stvChannel;
    const indexOf = (id, name) => list.findIndex((e) => (id && e.id === id) || (!id && e.n === name));
    const notices = [];

    for (const p of body.pulled || []) {
      if (p.key !== 'emotes' || !p.old_value) continue;
      const i = indexOf(p.old_value.id, p.old_value.name);
      const old = i >= 0 ? list.splice(i, 1)[0] : null;
      notices.push({ key: 'ev.emoteRemoved', vars: { actor, emote: p.old_value.name }, emote: old });
    }
    for (const p of body.pushed || []) {
      if (p.key !== 'emotes' || !p.value) continue;
      const em = await this._sevenTvEmote(p.value);
      if (!em) continue;
      const i = indexOf(em.id, em.n);
      if (i >= 0) list.splice(i, 1, em);
      else list.push(em);
      notices.push({ key: 'ev.emoteAdded', vars: { actor, emote: em.n }, emote: em });
    }
    for (const u of body.updated || []) {
      if (u.key !== 'emotes' || !u.value) continue;
      const em = await this._sevenTvEmote(u.value);
      if (!em) continue;
      const oldId = (u.old_value && u.old_value.id) || em.id;
      const oldName = (u.old_value && u.old_value.name) || em.n;
      const i = indexOf(oldId, oldName);
      if (i >= 0) list.splice(i, 1, em);
      else list.push(em);
      if (oldName !== em.n) notices.push({ key: 'ev.emoteRenamed', vars: { actor, from: oldName, to: em.n }, emote: em });
    }

    const understood = [...(body.pushed || []), ...(body.pulled || []), ...(body.updated || [])].some((x) => x && x.key === 'emotes');
    if (!understood) {
      // Unbekanntes Format → sicherheitshalber gleich komplett nachladen
      clearTimeout(this.stvResyncTimer);
      this.stvResyncTimer = setTimeout(() => this.reloadEmotes(), 30000);
      return;
    }
    this._rebuildEmotes();
    for (const n of notices) this._emoteNotice(n.key, n.vars, n.emote);
  }

  // Normalfall: Bilddaten stecken im Update – sonst das Emote einzeln nachladen
  async _sevenTvEmote(active) {
    let [em] = fromSevenTv([active]);
    if (!em && active.id) {
      const data = await fetchSevenTvEmote(active.id);
      if (data) [em] = fromSevenTv([{ ...active, data }]);
    }
    return em || null;
  }

  _emoteNotice(key, vars, emote) {
    if (!this.getSettings().chat.emoteNotices) return;
    this.emit('message', {
      id: crypto.randomUUID(),
      platform: 'twitch',
      kind: 'event',
      ts: Date.now(),
      user: { id: '', login: '', name: '7TV', color: '', badges: [] },
      action: false,
      event: { type: 'emote', icon: '✦', key, vars },
      tokens: emote ? [{ t: 'emote', n: emote.n, p: emote.p, u: emote.u, r: emote.r }] : [],
    });
  }

  _onLine(line) {
    const m = parseIrc(line);
    switch (m.command) {
      case 'PING':
        if (this.ws) this.ws.send(`PONG :${m.params[0] || 'tmi.twitch.tv'}`);
        break;
      case 'RECONNECT':
        this.restart();
        break;
      case 'ROOMSTATE': {
        const id = m.tags['room-id'];
        if (!id) break;
        clearTimeout(this.joinTimer);
        const changed = id !== this.roomId;
        this.roomId = id;
        this._set({ joined: true, roomId: id, error: '', errorVars: null });
        if (changed || !this.emotes.size) this.reloadEmotes();
        this._viewers();
        break;
      }
      case 'PRIVMSG':
        this._onPrivmsg(m);
        break;
      case 'USERNOTICE':
        this._onUsernotice(m);
        break;
      case 'CLEARCHAT':
        this.emit('clear', m.tags['target-user-id'] ? { userId: m.tags['target-user-id'] } : { all: true, platform: 'twitch' });
        break;
      case 'CLEARMSG':
        if (m.tags['target-msg-id']) this.emit('clear', { msgId: m.tags['target-msg-id'] });
        break;
      case 'NOTICE':
        if (/suspended|does not exist|banned/i.test(m.tags['msg-id'] || '') || /suspended|does not exist/i.test(m.params[1] || '')) {
          this._set({ error: `Twitch: ${m.params[1] || m.tags['msg-id']}`, errorVars: null });
        }
        break;
      default:
        break;
    }
  }

  _user(tags, login) {
    const badges = (tags.badges || '')
      .split(',')
      .map((b) => b.split('/')[0])
      .filter((b) => BADGES.includes(b));
    return {
      id: tags['user-id'] || '',
      login: login || tags.login || '',
      name: tags['display-name'] || login || tags.login || '',
      color: tags.color || '',
      badges,
    };
  }

  _isHighlight(text) {
    const lower = text.toLowerCase();
    // @kanal als ganzes Wort – „@kanalfan“ ist jemand anderes
    if (this.channel && lower.split(`@${this.channel.toLowerCase()}`).slice(1).some((rest) => !/^[a-z0-9_]/.test(rest))) return true;
    return this.getSettings().chat.highlightWords.some((w) => w && lower.includes(w.toLowerCase()));
  }

  _onPrivmsg(m) {
    const s = this.getSettings().chat;
    const t = m.tags;
    let text = m.params[1] || '';
    let action = false;
    if (text.startsWith('\u0001ACTION ') && text.endsWith('\u0001')) {
      action = true;
      text = text.slice(8, -1);
    }
    const login = (m.prefix.split('!')[0] || '').toLowerCase();
    if (s.hideBots.includes(login)) return;
    if (s.hideCommands && text.startsWith('!')) return;

    const user = this._user(t, login);
    const bits = Number(t.bits) || 0;
    const msg = {
      id: t.id || crypto.randomUUID(),
      platform: 'twitch',
      kind: bits ? 'event' : 'msg',
      ts: Number(t['tmi-sent-ts']) || Date.now(),
      user,
      action,
      first: t['first-msg'] === '1',
      returning: t['returning-chatter'] === '1',
      reward: Boolean(t['custom-reward-id']), // Kanalpunkte-Einlösung mit Text
      shared: Boolean(t['source-room-id'] && t['room-id'] && t['source-room-id'] !== t['room-id']), // aus einem Shared Chat
      highlight: this._isHighlight(text) || t['msg-id'] === 'highlighted-message',
      tokens: this.tokenize(text, t.emotes),
    };
    if (bits) msg.event = { type: 'bits', icon: '💎', key: 'ev.bits', vars: { name: user.name, n: bits } };
    this.emit('message', msg);
  }

  _onUsernotice(m) {
    const t = m.tags;
    const name = t['display-name'] || t.login || '?';
    const plan = TIERS[t['msg-param-sub-plan']] ? ` (${TIERS[t['msg-param-sub-plan']]})` : '';
    const months = Number(t['msg-param-cumulative-months']) || 0;
    let ev;
    switch (t['msg-id']) {
      case 'sub':
        ev = { type: 'sub', icon: '★', key: 'ev.sub', vars: { name, plan } };
        break;
      case 'resub':
        ev = { type: 'sub', icon: '★', key: 'ev.resub', vars: { name, n: months, plan } };
        break;
      case 'subgift':
      case 'anonsubgift': {
        // Einzelne Geschenke einer Gift-Bombe zusammenfassen
        const gid = t['msg-param-community-gift-id'];
        if (gid && this.giftBatches.has(gid)) {
          const left = this.giftBatches.get(gid) - 1;
          if (left > 0) this.giftBatches.set(gid, left);
          else this.giftBatches.delete(gid);
          return;
        }
        ev = { type: 'gift', icon: '🎁', key: 'ev.subgift', vars: { name, to: t['msg-param-recipient-display-name'] || '?' } };
        break;
      }
      case 'submysterygift':
      case 'anonsubmysterygift': {
        const n = Number(t['msg-param-mass-gift-count']) || 1;
        const gid = t['msg-param-community-gift-id'];
        if (gid) {
          this.giftBatches.set(gid, n);
          setTimeout(() => this.giftBatches.delete(gid), 60000);
        }
        ev = { type: 'gift', icon: '🎁', key: 'ev.giftbomb', vars: { name, n } };
        break;
      }
      case 'raid': {
        const v = Number(t['msg-param-viewerCount']) || 0;
        ev = { type: 'raid', icon: '⚔', key: 'ev.raid', vars: { name: t['msg-param-displayName'] || name, n: v } };
        break;
      }
      case 'announcement':
        ev = { type: 'announcement', icon: '📣', key: 'ev.announcement', vars: { name } };
        break;
      case 'giftpaidupgrade':
      case 'anongiftpaidupgrade':
      case 'primepaidupgrade':
        ev = { type: 'sub', icon: '★', key: 'ev.upgrade', vars: { name } };
        break;
      case 'bitsbadgetier':
        ev = { type: 'bits', icon: '💎', key: 'ev.bitsBadge', vars: { name } };
        break;
      case 'viewermilestone':
        ev = { type: 'sub', icon: '🔥', key: 'ev.streak', vars: { name, n: t['msg-param-value'] || '?' } };
        break;
      default:
        if (!t['system-msg']) return;
        ev = { type: 'info', icon: '✦', key: 'ev.system', vars: { text: t['system-msg'] } };
    }
    const text = m.params[1] || '';
    this.emit('message', {
      id: t.id || crypto.randomUUID(),
      platform: 'twitch',
      kind: 'event',
      ts: Number(t['tmi-sent-ts']) || Date.now(),
      user: this._user(t, t.login),
      action: false,
      event: ev,
      tokens: text ? this.tokenize(text, t.emotes) : [],
    });
  }

  // Zerlegt eine Nachricht in Text-, Erwähnungs- und Emote-Tokens.
  tokenize(text, emotesTag) {
    const cps = Array.from(text); // Twitch zählt Positionen in Codepoints
    const ranges = [];
    if (emotesTag) {
      for (const part of emotesTag.split('/')) {
        const [id, pos] = part.split(':');
        if (!id || !pos) continue;
        for (const r of pos.split(',')) {
          const [a, b] = r.split('-').map(Number);
          if (Number.isInteger(a) && Number.isInteger(b)) ranges.push({ a, b, id });
        }
      }
      ranges.sort((x, y) => x.a - y.a);
    }

    const tb = new TokenBuilder(this.emotes, this.channel);
    let i = 0;
    for (const r of ranges) {
      if (r.a < i) continue;
      if (r.a > i) tb.words(cps.slice(i, r.a).join(''));
      tb.push(twitchEmote(r.id, cps.slice(r.a, r.b + 1).join('')));
      i = r.b + 1;
    }
    if (i < cps.length) tb.words(cps.slice(i).join(''));
    return tb.tokens;
  }
}

module.exports = { TwitchChat, parseIrc };
