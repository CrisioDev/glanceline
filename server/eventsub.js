'use strict';
const { EventEmitter } = require('events');
const crypto = require('crypto');

// Optionale Twitch-Anmeldung (Device-Code-Flow, öffentlicher Client – kein Secret) und EventSub per WebSocket.
// Liefert, was der anonyme Chat nicht sieht: Follows, alle Kanalpunkte-Einlösungen, Hype Trains,
// Umfragen, Vorhersagen und Werbepausen. Gilt für den Kanal des angemeldeten Kontos.

// Öffentliche Client-ID der Glanceline-App (dev.twitch.tv → Anwendung, Typ „Öffentlich“). Leer = eigene ID in den Einstellungen nötig.
const DEFAULT_CLIENT_ID = '39b564a7yj5tjx61edt4auwdqwgtuj';
const SCOPES = ['moderator:read:followers', 'channel:read:redemptions', 'channel:read:hype_train', 'channel:read:polls', 'channel:read:predictions', 'channel:read:ads'];
const WS_URL = 'wss://eventsub.wss.twitch.tv/ws';
const ID = 'https://id.twitch.tv/oauth2';
const HELIX = 'https://api.twitch.tv/helix';

// Abos: Typ, Version(en) – die erste, die Twitch annimmt, gilt
const SUBSCRIPTIONS = [
  { type: 'channel.follow', versions: ['2'], moderator: true },
  { type: 'channel.channel_points_custom_reward_redemption.add', versions: ['1'] },
  { type: 'channel.hype_train.begin', versions: ['2', '1'] },
  { type: 'channel.hype_train.end', versions: ['2', '1'] },
  { type: 'channel.poll.begin', versions: ['1'] },
  { type: 'channel.poll.end', versions: ['1'] },
  { type: 'channel.prediction.begin', versions: ['1'] },
  { type: 'channel.prediction.lock', versions: ['1'] },
  { type: 'channel.prediction.end', versions: ['1'] },
  { type: 'channel.ad_break.begin', versions: ['1'] },
];

const form = (obj) => new URLSearchParams(obj).toString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class TwitchEventSub extends EventEmitter {
  // store: { load() → auth|null, save(auth|null) }
  constructor({ getSettings, store }) {
    super();
    this.getSettings = getSettings;
    this.store = store;
    this.auth = store.load(); // { accessToken, refreshToken, expiresAt, login, userId, scopes, clientId }
    this.ws = null;
    this.gen = 0;
    this.retry = 0;
    this.status = { state: this.auth ? 'connecting' : 'off', login: (this.auth && this.auth.login) || '', userCode: '', verificationUri: '', error: '', errorVars: null, subscribed: 0 };
  }

  clientId() {
    return (this.getSettings().twitch.clientId || '').trim() || DEFAULT_CLIENT_ID;
  }

  _set(patch) {
    Object.assign(this.status, patch);
    this.emit('status', { ...this.status });
  }

  start() {
    if (this.auth) this._connect();
  }

  stop() {
    this.gen++;
    this.loginAbort = true;
    clearTimeout(this.keepaliveTimer);
    clearTimeout(this.reconnectTimer);
    const ws = this.ws;
    this.ws = null;
    try { ws && ws.close(); } catch { /* egal */ }
  }

  // ---------- Anmeldung (Device-Code-Flow)

  async login() {
    const clientId = this.clientId();
    if (!clientId) return this._set({ state: 'error', error: 'err.eventsub.noClientId', errorVars: null });
    this.loginAbort = false;
    try {
      const res = await fetch(`${ID}/device`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ client_id: clientId, scopes: SCOPES.join(' ') }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || `HTTP ${res.status}`);
      this._set({ state: 'pending', userCode: d.user_code, verificationUri: d.verification_uri, error: '', errorVars: null });
      this.emit('openExternal', d.verification_uri);
      const until = Date.now() + (Number(d.expires_in) || 1800) * 1000;
      let interval = (Number(d.interval) || 5) * 1000;
      while (Date.now() < until && !this.loginAbort) {
        await sleep(interval);
        if (this.loginAbort) return;
        const r = await fetch(`${ID}/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form({ client_id: clientId, scopes: SCOPES.join(' '), device_code: d.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
        });
        const tok = await r.json();
        if (r.ok && tok.access_token) {
          await this._accept(tok, clientId);
          return;
        }
        const msg = String(tok.message || '');
        if (msg === 'authorization_pending') continue;
        if (msg === 'slow_down') {
          interval += 5000;
          continue;
        }
        throw new Error(msg || `HTTP ${r.status}`);
      }
      if (!this.loginAbort) this._set({ state: 'off', userCode: '', verificationUri: '', error: 'err.eventsub.expired', errorVars: null });
    } catch (e) {
      this._set({ state: 'error', userCode: '', verificationUri: '', error: 'err.eventsub.failed', errorVars: { msg: e.message } });
    }
  }

  cancelLogin() {
    this.loginAbort = true;
    if (this.status.state === 'pending') this._set({ state: this.auth ? 'connecting' : 'off', userCode: '', verificationUri: '' });
  }

  async _accept(tok, clientId) {
    const v = await this._validate(tok.access_token);
    this.auth = {
      clientId,
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      expiresAt: Date.now() + (Number(tok.expires_in) || 3600) * 1000,
      scopes: tok.scope || SCOPES,
      login: v.login,
      userId: v.user_id,
    };
    this.store.save(this.auth);
    this._set({ state: 'connecting', login: v.login, userCode: '', verificationUri: '', error: '', errorVars: null });
    this._connect();
  }

  async _validate(token) {
    const r = await fetch(`${ID}/validate`, { headers: { Authorization: `OAuth ${token}` } });
    if (!r.ok) throw Object.assign(new Error(`validate HTTP ${r.status}`), { status: r.status });
    return r.json();
  }

  async logout() {
    this.stop();
    const a = this.auth;
    this.auth = null;
    this.store.save(null);
    this._set({ state: 'off', login: '', userCode: '', verificationUri: '', error: '', errorVars: null, subscribed: 0 });
    if (a) {
      fetch(`${ID}/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ client_id: a.clientId, token: a.accessToken }) }).catch(() => {});
    }
  }

  async _refresh() {
    const a = this.auth;
    const r = await fetch(`${ID}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ client_id: a.clientId, grant_type: 'refresh_token', refresh_token: a.refreshToken }),
    });
    const tok = await r.json();
    if (!r.ok || !tok.access_token) {
      // Anmeldung abgelaufen oder widerrufen → neu anmelden
      this.auth = null;
      this.store.save(null);
      this._set({ state: 'error', error: 'err.eventsub.expiredLogin', errorVars: null, subscribed: 0 });
      throw new Error('refresh failed');
    }
    Object.assign(a, { accessToken: tok.access_token, refreshToken: tok.refresh_token || a.refreshToken, expiresAt: Date.now() + (Number(tok.expires_in) || 3600) * 1000 });
    this.store.save(a);
  }

  async _helix(method, path, body, retried) {
    if (Date.now() > this.auth.expiresAt - 60000) await this._refresh();
    const r = await fetch(`${HELIX}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.auth.accessToken}`, 'Client-Id': this.auth.clientId, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401 && !retried) {
      await this._refresh();
      return this._helix(method, path, body, true);
    }
    return r;
  }

  // ---------- EventSub-WebSocket

  _connect(url = WS_URL) {
    if (!this.auth) return;
    const gen = ++this.gen;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch {
      return this._reconnect(gen);
    }
    const old = this.ws;
    this.ws = ws;
    this._set({ state: 'connecting' });
    ws.onmessage = (ev) => {
      if (gen !== this.gen) return;
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      this._keepalive(gen, (m.payload && m.payload.session && m.payload.session.keepalive_timeout_seconds) || this.keepaliveSecs || 10);
      const type = m.metadata && m.metadata.message_type;
      if (type === 'session_welcome') {
        this.keepaliveSecs = m.payload.session.keepalive_timeout_seconds || 10;
        // Bei „session_reconnect“ bleiben die Abos bestehen – sonst neu anlegen
        if (old && url !== WS_URL) {
          try { old.close(); } catch { /* egal */ }
          this._set({ state: 'connected' });
        } else {
          this._subscribe(gen, m.payload.session.id);
        }
      } else if (type === 'session_reconnect') {
        this._connect(m.payload.session.reconnect_url);
      } else if (type === 'notification') {
        this._notify(m.metadata.subscription_type, m.payload.event || {}, m.metadata.message_id);
      } else if (type === 'revocation') {
        this._set({ error: 'err.eventsub.revoked', errorVars: { type: m.payload.subscription && m.payload.subscription.type } });
      }
    };
    ws.onclose = () => {
      if (gen !== this.gen) return;
      this.ws = null;
      if (this.auth) this._reconnect(gen);
    };
    ws.onerror = () => { /* onclose folgt */ };
  }

  _keepalive(gen, secs) {
    clearTimeout(this.keepaliveTimer);
    this.keepaliveTimer = setTimeout(() => {
      if (gen !== this.gen) return;
      // Kein Lebenszeichen → neu verbinden
      try { this.ws && this.ws.close(); } catch { /* egal */ }
      this._reconnect(gen);
    }, (secs + 5) * 1000);
  }

  _reconnect(gen) {
    if (gen !== this.gen || !this.auth) return;
    clearTimeout(this.reconnectTimer);
    const delay = Math.min(60000, 1000 * 2 ** this.retry++);
    this._set({ state: 'connecting' });
    this.reconnectTimer = setTimeout(() => {
      if (gen === this.gen) this._connect();
    }, delay);
  }

  async _subscribe(gen, sessionId) {
    let ok = 0;
    const failed = [];
    for (const sub of SUBSCRIPTIONS) {
      const condition = sub.moderator ? { broadcaster_user_id: this.auth.userId, moderator_user_id: this.auth.userId } : { broadcaster_user_id: this.auth.userId };
      let done = false;
      for (const version of sub.versions) {
        try {
          const r = await this._helix('POST', '/eventsub/subscriptions', { type: sub.type, version, condition, transport: { method: 'websocket', session_id: sessionId } });
          if (gen !== this.gen) return;
          if (r.ok || r.status === 409) {
            done = true;
            break;
          }
          if (r.status === 401 || r.status === 403) break; // fehlende Berechtigung – andere Version hilft nicht
        } catch {
          if (gen !== this.gen || !this.auth) return;
          break;
        }
      }
      if (done) ok++;
      else failed.push(sub.type);
    }
    if (gen !== this.gen) return;
    this.retry = 0;
    this._set({ state: 'connected', subscribed: ok, error: failed.length ? 'err.eventsub.partial' : '', errorVars: failed.length ? { list: failed.join(', ') } : null });
  }

  // ---------- Ereignisse → Chat-Events

  _notify(type, e, messageId) {
    const user = (name, login, id) => ({ id: id || '', login: (login || '').toLowerCase(), name: name || login || '?', color: '', badges: [] });
    const emit = (ev, u, text) => this.emit('message', { id: `es:${messageId || crypto.randomUUID()}`, platform: 'twitch', kind: 'event', ts: Date.now(), user: u, action: false, event: ev, tokens: text ? [{ t: 'text', v: text }] : [] });
    switch (type) {
      case 'channel.follow':
        if (!this.getSettings().chat.showFollows) return;
        emit({ type: 'follow', icon: '♥', key: 'ev.follow', vars: { name: e.user_name } }, user(e.user_name, e.user_login, e.user_id));
        return;
      case 'channel.channel_points_custom_reward_redemption.add':
        emit({ type: 'reward', icon: '◎', key: 'ev.redeem', vars: { name: e.user_name, reward: (e.reward && e.reward.title) || '?' } }, user(e.user_name, e.user_login, e.user_id), e.user_input || '');
        this.emit('redemption', { userId: e.user_id, text: e.user_input || '' });
        return;
      case 'channel.hype_train.begin':
        emit({ type: 'hype', icon: '🚂', key: 'ev.hypeBegin', vars: { level: e.level || 1 } }, user('Hype Train'));
        return;
      case 'channel.hype_train.end':
        emit({ type: 'hype', icon: '🚂', key: 'ev.hypeEnd', vars: { level: e.level || 1 } }, user('Hype Train'));
        return;
      case 'channel.poll.begin':
        emit({ type: 'info', icon: '📊', key: 'ev.pollBegin', vars: { title: e.title } }, user('Poll'), (e.choices || []).map((c) => c.title).join(' · '));
        return;
      case 'channel.poll.end': {
        if (e.status === 'archived') return;
        const top = [...(e.choices || [])].sort((a, b) => (b.votes || 0) - (a.votes || 0))[0];
        emit({ type: 'info', icon: '📊', key: 'ev.pollEnd', vars: { title: e.title, winner: top ? top.title : '–' } }, user('Poll'));
        return;
      }
      case 'channel.prediction.begin':
        emit({ type: 'info', icon: '🔮', key: 'ev.predictionBegin', vars: { title: e.title } }, user('Prediction'), (e.outcomes || []).map((o) => o.title).join(' · '));
        return;
      case 'channel.prediction.lock':
        emit({ type: 'info', icon: '🔮', key: 'ev.predictionLock', vars: { title: e.title } }, user('Prediction'));
        return;
      case 'channel.prediction.end': {
        const win = (e.outcomes || []).find((o) => o.id === e.winning_outcome_id);
        emit({ type: 'info', icon: '🔮', key: e.status === 'canceled' ? 'ev.predictionCanceled' : 'ev.predictionEnd', vars: { title: e.title, winner: win ? win.title : '–' } }, user('Prediction'));
        return;
      }
      case 'channel.ad_break.begin': {
        const secs = Number(e.duration_seconds) || 0;
        emit({ type: 'info', icon: '📺', key: 'ev.adBreak', vars: { n: secs } }, user('Twitch'));
        this.emit('adBreak', { seconds: secs, automatic: Boolean(e.is_automatic) });
        return;
      }
      default:
    }
  }
}

module.exports = { TwitchEventSub, SCOPES, DEFAULT_CLIENT_ID };
