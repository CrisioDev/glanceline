'use strict';
const { EventEmitter } = require('events');
const { getJson, inBrowserStack } = require('./net');
const { TokenBuilder, plainText } = require('./chat-tokens');
const { loadSevenTvPlatform, buildMap } = require('./emotes');

// Kick-Chat ohne Login: Kanal-Infos über die Website-API, Nachrichten über Kicks öffentlichen Pusher-Websocket.
const PUSHER_URL = 'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0&flash=false';
const INFO_MS = 60 * 1000;
const EMOTE_REFRESH_MS = 10 * 60 * 1000;
const BADGES = { broadcaster: 'broadcaster', moderator: 'moderator', vip: 'vip', subscriber: 'subscriber', founder: 'founder', og: 'founder' };
const EMOTE_RE = /\[emote:(\d+):([^\]]*)\]/g;

function parseSlug(input) {
  const v = String(input || '').trim();
  const m = v.match(/kick\.com\/([\w-]+)/i) || v.match(/^@?([\w-]{2,40})$/);
  return m ? m[1].toLowerCase() : '';
}

const kickEmote = (id, name) => {
  const url = `https://files.kick.com/emotes/${id}/fullsize`;
  return { t: 'emote', n: name, p: 'kick', u: [url, url, url] };
};

class KickChat extends EventEmitter {
  constructor(getSettings) {
    super();
    this.getSettings = getSettings;
    this.gen = 0;
    this.ws = null;
    this.emotes = new Map();
    this.retry = 0;
    this.status = { state: 'off', channel: '', name: '', connected: false, live: false, viewers: null, error: '', errorVars: null, emotes: null };
  }

  start() {
    this.restart();
    this.emoteTimer = setInterval(() => this.reloadEmotes(), EMOTE_REFRESH_MS);
  }

  stop() {
    this.gen++;
    clearInterval(this.emoteTimer);
    this._close();
  }

  _close() {
    clearTimeout(this.timer);
    clearInterval(this.infoTimer);
    clearInterval(this.pingTimer);
    const ws = this.ws;
    this.ws = null;
    try { ws && ws.close(); } catch { /* egal */ }
  }

  restart() {
    const gen = ++this.gen;
    this._close();
    this.retry = 0;
    const input = this.getSettings().chat.kick;
    this.slug = parseSlug(input);
    this.info = null;
    this.emotes = new Map();
    const reset = { name: '', connected: false, live: false, viewers: null, emotes: null, errorVars: null };
    if (!input) return this._set({ ...reset, state: 'off', channel: '', error: '' });
    if (!this.slug) return this._set({ ...reset, state: 'error', channel: input, error: 'err.kick.badInput' });
    this._set({ ...reset, state: 'searching', channel: this.slug, error: '' });
    this._lookup(gen);
  }

  _set(patch) {
    Object.assign(this.status, patch);
    this.emit('status', { ...this.status });
  }

  _later(gen, fn, ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (gen === this.gen) fn();
    }, ms);
  }

  async _fetchInfo() {
    const j = await getJson(`https://kick.com/api/v2/channels/${this.slug}`, { browser: true });
    if (!j) return null;
    const ls = j.livestream;
    return {
      channelId: j.id,
      userId: j.user_id,
      chatroomId: j.chatroom && j.chatroom.id,
      name: (j.user && j.user.username) || j.slug,
      live: Boolean(ls && ls.is_live !== false),
      viewers: ls ? Number(ls.viewer_count) || 0 : null,
    };
  }

  async _lookup(gen) {
    try {
      const info = await this._fetchInfo();
      if (gen !== this.gen) return;
      if (!info || !info.chatroomId) {
        this._set({ state: 'error', error: 'err.kick.notFound', errorVars: { channel: this.slug } });
        return this._later(gen, () => this._lookup(gen), 5 * INFO_MS);
      }
      this.info = info;
      this._set({ name: info.name, live: info.live, viewers: info.live ? info.viewers : null });
      this.reloadEmotes();
      this._connect(gen);
      // Live-Status und Zuschauerzahl regelmäßig auffrischen
      clearInterval(this.infoTimer);
      this.infoTimer = setInterval(async () => {
        try {
          const i = await this._fetchInfo();
          if (gen === this.gen && i) this._set({ live: i.live, viewers: i.live ? i.viewers : null });
        } catch { /* nächster Versuch in einer Minute */ }
      }, INFO_MS);
    } catch (e) {
      if (gen !== this.gen) return;
      // Kick blockt Anfragen außerhalb eines Browsers – im reinen Server-Modus geht es daher nicht
      const blocked = e.status === 403;
      this._set({
        state: 'error',
        error: blocked ? (inBrowserStack() ? 'err.kick.blocked' : 'err.kick.needsApp') : 'err.kick.failed',
        errorVars: { msg: e.message },
      });
      this._later(gen, () => this._lookup(gen), Math.min(5 * INFO_MS, 15000 * 2 ** this.retry++));
    }
  }

  _connect(gen) {
    let ws;
    try {
      ws = new WebSocket(PUSHER_URL);
    } catch (e) {
      return this._reconnect(gen);
    }
    this.ws = ws;
    const send = (event, data) => ws.readyState === 1 && ws.send(JSON.stringify({ event, data }));
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.event === 'pusher:connection_established') {
        const { chatroomId, channelId } = this.info;
        for (const c of [`chatrooms.${chatroomId}.v2`, `chatroom_${chatroomId}`, `channel.${channelId}`]) send('pusher:subscribe', { auth: '', channel: c });
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => send('pusher:ping', {}), 60000);
        return;
      }
      if (m.event === 'pusher:ping') return send('pusher:pong', {});
      if (m.event === 'pusher_internal:subscription_succeeded') {
        if (!this.status.connected) {
          this.retry = 0;
          this._set({ state: 'connected', connected: true, error: '', errorVars: null });
        }
        return;
      }
      if (m.event === 'pusher:error') {
        console.warn('[kick]', JSON.stringify(m.data));
        return;
      }
      let data = m.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch { /* bleibt Text */ }
      }
      try {
        this._event(m.event, data || {});
      } catch (e) {
        console.warn('[kick]', m.event, e.message);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      clearInterval(this.pingTimer);
      this._set({ connected: false, state: 'searching' });
      this._reconnect(gen);
    };
    ws.onerror = () => { /* onclose folgt */ };
  }

  _reconnect(gen) {
    const delay = Math.min(30000, 1000 * 2 ** this.retry++);
    this._later(gen, () => this._connect(gen), delay);
  }

  async reloadEmotes() {
    const gen = this.gen;
    if (!this.info) return;
    if (!this.getSettings().chat.providers.seventv) {
      this.emotes = new Map();
      return this._set({ emotes: null });
    }
    const { lists } = await loadSevenTvPlatform('kick', this.info.userId);
    if (gen !== this.gen) return;
    this.emotes = buildMap(lists);
    this._set({ emotes: { seventv: { channel: lists.stvChannel.length, global: lists.stvGlobal.length } } });
  }

  // ---------- Nachrichten ----------

  _tokens(content) {
    const tb = new TokenBuilder(this.emotes, this.slug);
    let i = 0;
    for (const m of String(content || '').matchAll(EMOTE_RE)) {
      if (m.index > i) tb.words(content.slice(i, m.index));
      tb.push(kickEmote(m[1], m[2]));
      i = m.index + m[0].length;
    }
    if (i < String(content || '').length) tb.words(content.slice(i));
    return tb.tokens;
  }

  _user(sender) {
    const s = sender || {};
    const identity = s.identity || {};
    const badges = [...new Set((identity.badges || []).map((b) => BADGES[b.type]).filter(Boolean))];
    const name = s.username || s.slug || '?';
    return { id: s.id ? `kick:${s.id}` : '', login: (s.slug || name).toLowerCase(), name, color: identity.color || '', badges };
  }

  _emitEvent(id, user, ev, tokens) {
    this.emit('message', { id: `kick:${id || `${Date.now()}-${Math.random()}`}`, platform: 'kick', kind: 'event', ts: Date.now(), user, action: false, event: ev, tokens: tokens || [] });
  }

  _event(name, d) {
    const short = name.replace(/^App\\Events\\/, '');
    const anon = (n) => ({ id: '', login: (n || '').toLowerCase(), name: n || '?', color: '', badges: [] });
    switch (short) {
      case 'ChatMessageEvent': {
        const s = this.getSettings().chat;
        const user = this._user(d.sender);
        if (s.hideBots.includes(user.login)) return;
        const tokens = this._tokens(d.content);
        const text = plainText(tokens);
        if (s.hideCommands && text.startsWith('!')) return;
        const lower = text.toLowerCase();
        const highlight = lower.includes(`@${this.slug}`) || s.highlightWords.some((w) => w && lower.includes(w.toLowerCase()));
        this.emit('message', {
          id: `kick:${d.id}`,
          platform: 'kick',
          kind: 'msg',
          ts: Date.parse(d.created_at) || Date.now(),
          user,
          action: false,
          first: false,
          returning: false,
          reward: false,
          shared: false,
          highlight,
          tokens,
        });
        return;
      }
      case 'MessageDeletedEvent':
        if (d.message && d.message.id) this.emit('clear', { msgId: `kick:${d.message.id}` });
        return;
      case 'UserBannedEvent':
        if (d.user && d.user.id) this.emit('clear', { userId: `kick:${d.user.id}` });
        return;
      case 'ChatroomClearEvent':
        this.emit('clear', { all: true, platform: 'kick' });
        return;
      case 'SubscriptionEvent': {
        const n = Number(d.months) || 1;
        const ev = n > 1 ? { type: 'sub', icon: '★', key: 'ev.resub', vars: { name: d.username, n, plan: '' } } : { type: 'sub', icon: '★', key: 'ev.sub', vars: { name: d.username, plan: '' } };
        this._emitEvent(d.id, anon(d.username), ev);
        return;
      }
      case 'GiftedSubscriptionsEvent': {
        const to = d.gifted_usernames || [];
        const ev = to.length === 1
          ? { type: 'gift', icon: '🎁', key: 'ev.subgift', vars: { name: d.gifter_username, to: to[0] } }
          : { type: 'gift', icon: '🎁', key: 'ev.giftbomb', vars: { name: d.gifter_username, n: to.length } };
        this._emitEvent(d.id, anon(d.gifter_username), ev);
        return;
      }
      case 'StreamHostEvent':
        this._emitEvent(d.id, anon(d.host_username), { type: 'raid', icon: '⚔', key: 'ev.raid', vars: { name: d.host_username, n: Number(d.number_viewers) || 0 } }, d.optional_message ? this._tokens(d.optional_message) : []);
        return;
      case 'StreamerIsLive':
        this._set({ live: true });
        return;
      case 'StopStreamBroadcast':
        this._set({ live: false, viewers: null });
        return;
      default:
        // Kicks (Kicks eigene „Bits“) – Ereignisname und Aufbau haben sich mehrfach geändert
        if (/KicksGifted/i.test(short)) {
          const sender = d.sender || {};
          const gift = d.gift || {};
          const user = this._user(sender);
          this._emitEvent(d.gift_transaction_id || d.id, user, { type: 'bits', icon: '💚', key: 'ev.kicks', vars: { name: user.name, n: Number(gift.amount) || 0 } }, d.message ? this._tokens(d.message) : []);
        }
    }
  }
}

module.exports = { KickChat, parseSlug };
