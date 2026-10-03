'use strict';
const { EventEmitter } = require('events');
const { webFetch } = require('./net');
const { TokenBuilder, plainText } = require('./chat-tokens');
const { loadSevenTvPlatform, buildMap } = require('./emotes');

// YouTube-Livechat ohne API-Key und ohne Kontingent: dieselbe Schnittstelle, die das Chat-Popout im Browser nutzt.
const API = 'https://www.youtube.com/youtubei/v1/';
const COOKIE = 'SOCS=CAI; CONSENT=YES+1'; // Einwilligungsseite (EU) überspringen
const FALLBACK_VERSION = '2.20261002.01.00';
const POLL_MS = 2000;
const POLL_MAX_MS = 4000;
const OFFLINE_RETRY_MS = 60 * 1000;
const VIEWERS_MS = 60 * 1000;
const EMOTE_REFRESH_MS = 10 * 60 * 1000;

// Eingabe des Nutzers → Video-ID oder /live-Seite eines Kanals
function parseTarget(input) {
  const v = String(input || '').trim();
  if (!v) return null;
  let m = v.match(/(?:[?&]v=|youtu\.be\/|\/live\/|\/embed\/)([\w-]{11})/);
  if (m) return { videoId: m[1], label: m[1] };
  m = v.match(/\/channel\/(UC[\w-]{22})/) || v.match(/^(UC[\w-]{22})$/);
  if (m) return { channelId: m[1], url: `https://www.youtube.com/channel/${m[1]}/live`, label: m[1] };
  m = v.match(/youtube\.com\/(@[^/?#\s]+)/) || v.match(/^(@?[\w.-]{3,30})$/);
  if (m) {
    const handle = m[1].startsWith('@') ? m[1] : `@${m[1]}`;
    return { handle, url: `https://www.youtube.com/${handle}/live`, label: handle };
  }
  m = v.match(/youtube\.com\/((?:c|user)\/[\w.-]+)/);
  if (m) return { url: `https://www.youtube.com/${m[1]}/live`, label: m[1] };
  return null;
}

const runsText = (x) => (!x ? '' : x.simpleText != null ? x.simpleText : (x.runs || []).map((r) => r.text || (r.emoji && r.emoji.emojiId) || '').join(''));

// Größe in YouTubes Bild-URLs anpassen (=w24-h24-… → gewünschte Kantenlänge)
const sized = (url, px) => url.replace(/=w\d+-h\d+/, `=w${px}-h${px}`);

function initialData(html) {
  const m = html.match(/(?:window\["ytInitialData"\]|var ytInitialData)\s*=\s*(\{.+?\});\s*<\/script>/s);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

const continuationOf = (c) => {
  if (!c) return null;
  const d = c.invalidationContinuationData || c.timedContinuationData || c.reloadContinuationData;
  return d ? { token: d.continuation, timeoutMs: Number(d.timeoutMs) || POLL_MS } : null;
};

class YouTubeChat extends EventEmitter {
  constructor(getSettings) {
    super();
    this.getSettings = getSettings;
    this.gen = 0; // jeder Neustart erhöht den Zähler – alte Schleifen beenden sich dann selbst
    this.emotes = new Map();
    this.seen = new Set();
    this.target = null;
    this.status = { state: 'off', channel: '', videoId: '', title: '', viewers: null, error: '', errorVars: null, emotes: null };
  }

  start() {
    this.restart();
    this.emoteTimer = setInterval(() => this.reloadEmotes(), EMOTE_REFRESH_MS);
  }

  stop() {
    this.gen++;
    clearTimeout(this.timer);
    clearInterval(this.emoteTimer);
    clearInterval(this.viewerTimer);
  }

  restart() {
    const gen = ++this.gen;
    clearTimeout(this.timer);
    clearInterval(this.viewerTimer);
    const input = this.getSettings().chat.youtube;
    this.target = parseTarget(input);
    this.videoId = '';
    this.channelId = (this.target && this.target.channelId) || '';
    this.handle = (this.target && this.target.handle) || '';
    this.emotes = new Map();
    const reset = { videoId: '', title: '', viewers: null, emotes: null, errorVars: null };
    if (!input) return this._set({ ...reset, state: 'off', channel: '', error: '' });
    if (!this.target) return this._set({ ...reset, state: 'error', channel: input, error: 'err.yt.badInput' });
    this._set({ ...reset, state: 'searching', channel: this.target.label, error: '' });
    this._find(gen);
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

  async _page(url) {
    const res = await webFetch(url, { headers: { Cookie: COOKIE } });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    return res.text();
  }

  async _post(endpoint, body) {
    const res = await webFetch(`${API}${endpoint}?prettyPrint=false`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: COOKIE },
      body: JSON.stringify({ context: this.ctx, ...body }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // Läuft gerade ein Stream? Die /live-Seite eines Kanals zeigt dann auf das Video.
  async _find(gen) {
    try {
      let videoId = this.target.videoId || '';
      let title = '';
      if (!videoId) {
        const html = await this._page(this.target.url);
        if (gen !== this.gen) return;
        this.channelId = (html.match(/"externalId":"(UC[\w-]{22})"/) || html.match(/"channelId":"(UC[\w-]{22})"/) || [])[1] || this.channelId;
        const handle = (html.match(/"canonicalBaseUrl":"\/(@[^"]+)"/) || [])[1];
        if (handle) this.handle = decodeURIComponent(handle);
        const canon = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/);
        if (canon && /"isLiveNow":true|"isUpcoming":true/.test(html)) videoId = canon[1];
        title = (html.match(/<meta name="title" content="([^"]*)"/) || [])[1] || '';
        if (!this.channelId && !canon && !/"channelMetadataRenderer"/.test(html)) {
          return this._fail(gen, 'err.yt.notFound', { channel: this.target.label });
        }
      }
      if (!videoId) {
        this._set({ state: 'offline', videoId: '', viewers: null, error: '' });
        if (!this.status.emotes) this.reloadEmotes();
        return this._later(gen, () => this._find(gen), OFFLINE_RETRY_MS);
      }
      await this._openChat(gen, videoId, decodeHtml(title));
    } catch (e) {
      if (e.status === 404) this._fail(gen, 'err.yt.notFound', { channel: this.target.label });
      else this._retry(gen, e);
    }
  }

  async _openChat(gen, videoId, title) {
    const html = await this._page(`https://www.youtube.com/live_chat?is_popout=1&v=${videoId}`);
    if (gen !== this.gen) return;
    const lcr = (initialData(html) || {}).contents;
    const chat = lcr && lcr.liveChatRenderer;
    if (!chat) {
      // Chat abgeschaltet oder Stream vorbei
      this._set({ state: 'offline', videoId, error: 'err.yt.noChat' });
      return this._later(gen, () => this._find(gen), OFFLINE_RETRY_MS);
    }
    const version = (html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) || [])[1] || FALLBACK_VERSION;
    this.ctx = { client: { clientName: 'WEB', clientVersion: version, hl: 'en', gl: 'US' } };
    // „Live chat“ (alle Nachrichten) statt „Top chat“ (gefiltert)
    let start = null;
    try {
      const items = chat.header.liveChatHeaderRenderer.viewSelector.sortFilterSubMenuRenderer.subMenuItems;
      start = continuationOf((items[1] || items[0]).continuation);
    } catch { /* kein Umschalter – dann eben die Standardansicht */ }
    start = start || continuationOf((chat.continuations || [])[0]);
    if (!start) return this._retry(gen, new Error('no continuation'));

    this.videoId = videoId;
    this.errors = 0;
    this.skipBacklog = true; // die ersten Antworten enthalten ältere Nachrichten – nicht erneut zeigen
    this._set({ state: 'live', videoId, title: title || this.status.title, error: '', errorVars: null });
    if (!this.status.emotes) this.reloadEmotes();
    clearInterval(this.viewerTimer);
    this._viewers(gen);
    this.viewerTimer = setInterval(() => this._viewers(gen), VIEWERS_MS);
    this._poll(gen, start.token);
  }

  async _poll(gen, token) {
    let next = token;
    let wait = POLL_MS;
    try {
      const j = await this._post('live_chat/get_live_chat', { continuation: token });
      if (gen !== this.gen) return;
      const lc = j.continuationContents && j.continuationContents.liveChatContinuation;
      const c = lc && continuationOf((lc.continuations || [])[0]);
      if (!c) return this._ended(gen);
      if (!this.skipBacklog) for (const a of lc.actions || []) this._action(a);
      else for (const a of lc.actions || []) this._remember(a);
      this.skipBacklog = false;
      next = c.token;
      wait = Math.max(POLL_MS, Math.min(POLL_MAX_MS, c.timeoutMs));
      this.errors = 0;
      if (this.status.error) this._set({ error: '', errorVars: null });
    } catch (e) {
      if (gen !== this.gen) return;
      this.errors = (this.errors || 0) + 1;
      if (this.errors >= 5) return this._retry(gen, e);
      wait = Math.min(30000, 2000 * this.errors);
    }
    this._later(gen, () => this._poll(gen, next), wait);
  }

  _ended(gen) {
    clearInterval(this.viewerTimer);
    this._set({ state: 'offline', videoId: '', viewers: null });
    this._later(gen, () => this._find(gen), 15000);
  }

  _retry(gen, e) {
    if (gen !== this.gen) return;
    console.warn('[youtube]', e.message);
    clearInterval(this.viewerTimer);
    this._set({ state: 'error', error: 'err.yt.failed', errorVars: { msg: e.message } });
    this._later(gen, () => this._find(gen), 30000);
  }

  _fail(gen, key, vars) {
    if (gen !== this.gen) return;
    this._set({ state: 'error', error: key, errorVars: vars || null });
    this._later(gen, () => this._find(gen), 5 * OFFLINE_RETRY_MS);
  }

  async _viewers(gen) {
    if (!this.videoId) return;
    try {
      const j = await this._post('updated_metadata', { videoId: this.videoId });
      if (gen !== this.gen) return;
      for (const a of j.actions || []) {
        const v = a.updateViewershipAction && a.updateViewershipAction.viewCount && a.updateViewershipAction.viewCount.videoViewCountRenderer;
        if (v && v.originalViewCount != null) this._set({ viewers: Number(v.originalViewCount) || 0 });
        if (a.updateTitleAction) this._set({ title: runsText(a.updateTitleAction.title) });
      }
    } catch { /* nächster Versuch in einer Minute */ }
  }

  async reloadEmotes() {
    const gen = this.gen;
    if (!this.getSettings().chat.providers.seventv) {
      this.emotes = new Map();
      return this._set({ emotes: null });
    }
    const { lists } = await loadSevenTvPlatform('youtube', this.channelId);
    if (gen !== this.gen) return;
    this.emotes = buildMap(lists);
    this._set({ emotes: { seventv: { channel: lists.stvChannel.length, global: lists.stvGlobal.length } } });
  }

  // ---------- Nachrichten ----------

  _remember(a) {
    const item = a.addChatItemAction && a.addChatItemAction.item;
    const r = item && item[Object.keys(item)[0]];
    if (r && r.id) this._seen(r.id);
  }

  _seen(id) {
    if (this.seen.has(id)) return true;
    this.seen.add(id);
    if (this.seen.size > 2000) this.seen = new Set([...this.seen].slice(-1000));
    return false;
  }

  _action(a) {
    if (a.addChatItemAction) return this._item(a.addChatItemAction.item || {});
    const del = a.markChatItemAsDeletedAction || a.removeChatItemAction;
    if (del && del.targetItemId) return this.emit('clear', { msgId: `yt:${del.targetItemId}` });
    const byAuthor = a.markChatItemsByAuthorAsDeletedAction || a.removeChatItemByAuthorAction;
    if (byAuthor && byAuthor.externalChannelId) return this.emit('clear', { userId: `yt:${byAuthor.externalChannelId}` });
    return undefined;
  }

  _user(r) {
    const name = runsText(r.authorName).replace(/^@/, '') || '?';
    const badges = [];
    for (const b of r.authorBadges || []) {
      const x = b.liveChatAuthorBadgeRenderer || {};
      const icon = x.icon && x.icon.iconType;
      if (icon === 'OWNER') badges.push('broadcaster');
      else if (icon === 'MODERATOR') badges.push('moderator');
      else if (x.customThumbnail) badges.push('subscriber'); // Kanalmitglied
    }
    return { id: r.authorExternalChannelId ? `yt:${r.authorExternalChannelId}` : '', login: name.toLowerCase(), name, color: '', badges };
  }

  _tokens(runs) {
    const tb = new TokenBuilder(this.emotes, this.handle.replace(/^@/, ''));
    for (const run of runs || []) {
      if (run.text != null) tb.words(run.text);
      else if (run.emoji) {
        const e = run.emoji;
        const th = (e.image && e.image.thumbnails) || [];
        if (e.isCustomEmoji && th.length) {
          const url = th[th.length - 1].url;
          tb.push({ t: 'emote', n: (e.shortcuts && e.shortcuts[0]) || '', p: 'youtube', u: [sized(url, 28), sized(url, 56), sized(url, 112)] });
        } else {
          tb.text(e.emojiId || (e.shortcuts && e.shortcuts[0]) || '');
        }
      }
    }
    return tb.tokens;
  }

  _item(item) {
    const type = Object.keys(item)[0];
    const r = item[type];
    if (!r || !r.id || this._seen(r.id)) return;
    const s = this.getSettings().chat;
    const base = { id: `yt:${r.id}`, platform: 'youtube', ts: Math.floor(Number(r.timestampUsec) / 1000) || Date.now(), action: false };
    const event = (user, ev, tokens) => this.emit('message', { ...base, kind: 'event', user, event: ev, tokens: tokens || [] });

    switch (type) {
      case 'liveChatTextMessageRenderer': {
        const user = this._user(r);
        if (s.hideBots.includes(user.login)) return;
        const tokens = this._tokens(r.message && r.message.runs);
        const text = plainText(tokens);
        if (s.hideCommands && text.startsWith('!')) return;
        const lower = text.toLowerCase();
        const me = this.handle.toLowerCase();
        const highlight = Boolean(me && lower.includes(me)) || s.highlightWords.some((w) => w && lower.includes(w.toLowerCase()));
        this.emit('message', { ...base, kind: 'msg', user, first: false, returning: false, reward: false, shared: false, highlight, tokens });
        return;
      }
      case 'liveChatPaidMessageRenderer': {
        const user = this._user(r);
        event(user, { type: 'bits', icon: '💲', key: 'ev.superchat', vars: { name: user.name, amount: runsText(r.purchaseAmountText) } }, this._tokens(r.message && r.message.runs));
        return;
      }
      case 'liveChatPaidStickerRenderer': {
        const user = this._user(r);
        event(user, { type: 'bits', icon: '💲', key: 'ev.supersticker', vars: { name: user.name, amount: runsText(r.purchaseAmountText) } });
        return;
      }
      case 'liveChatMembershipItemRenderer': {
        const user = this._user(r);
        const head = runsText(r.headerPrimaryText);
        const ev = head
          ? { type: 'sub', icon: '★', key: 'ev.ytMilestone', vars: { name: user.name, text: head } }
          : { type: 'sub', icon: '★', key: 'ev.ytMember', vars: { name: user.name } };
        event(user, ev, this._tokens(r.message && r.message.runs));
        return;
      }
      case 'liveChatSponsorshipsGiftPurchaseAnnouncementRenderer': {
        const h = (r.header && r.header.liveChatSponsorshipsHeaderRenderer) || {};
        const user = this._user({ ...h, authorExternalChannelId: r.authorExternalChannelId });
        const n = Number((runsText(h.primaryText).match(/\d+/) || [1])[0]);
        event(user, { type: 'gift', icon: '🎁', key: 'ev.ytGift', vars: { name: user.name, n } });
        return;
      }
      default:
    }
  }
}

function decodeHtml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

module.exports = { YouTubeChat, parseTarget };
