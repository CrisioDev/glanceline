'use strict';
const { EventEmitter } = require('events');

// 7TV EventAPI v3 – meldet Änderungen am Emote-Set (hinzugefügt, entfernt, umbenannt)
// und am 7TV-Konto (anderes Emote-Set aktiviert) in Echtzeit.
const EVENTS_URL = 'wss://events.7tv.io/v3';
const OP = { DISPATCH: 0, HELLO: 1, RECONNECT: 4, ERROR: 6, END_OF_STREAM: 7, SUBSCRIBE: 35, UNSUBSCRIBE: 36 };

class SevenTvEvents extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.subs = new Map(); // "typ:objektId" → { type, id }
    this.stopped = true;
    this.ready = false;
    this.retry = 0;
    this.heartbeatMs = 45000;
    this.status = { connected: false, error: '' };
  }

  start() {
    this.stopped = false;
    if (!this.ws && this.subs.size) this._connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.watchdog);
    const ws = this.ws;
    this.ws = null;
    this.ready = false;
    try { ws && ws.close(); } catch { /* egal */ }
    this._set({ connected: false });
  }

  // Gewünschte Abos setzen – neue werden bestellt, überflüssige abbestellt
  watch(list) {
    const next = new Map(list.filter((s) => s.id).map((s) => [`${s.type}:${s.id}`, s]));
    if (this.ready) {
      for (const [key, s] of this.subs) if (!next.has(key)) this._send(OP.UNSUBSCRIBE, { type: s.type, condition: { object_id: s.id } });
      for (const [key, s] of next) if (!this.subs.has(key)) this._send(OP.SUBSCRIBE, { type: s.type, condition: { object_id: s.id } });
    }
    this.subs = next;
    if (next.size && !this.stopped && !this.ws) this._connect();
  }

  _connect() {
    clearTimeout(this.reconnectTimer);
    if (this.stopped) return;
    let ws;
    try {
      ws = new WebSocket(EVENTS_URL);
    } catch (e) {
      this._scheduleReconnect(e.message);
      return;
    }
    this.ws = ws;
    this.ready = false;
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this._onMessage(msg);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.ready = false;
      clearTimeout(this.watchdog);
      this._set({ connected: false });
      if (!this.stopped) this._scheduleReconnect(ev.reason);
    };
    ws.onerror = () => { /* onclose folgt */ };
  }

  _onMessage(msg) {
    this._kickWatchdog();
    const d = msg.d || {};
    switch (msg.op) {
      case OP.HELLO:
        this.heartbeatMs = d.heartbeat_interval || 45000;
        this.ready = true;
        this.retry = 0;
        for (const s of this.subs.values()) this._send(OP.SUBSCRIBE, { type: s.type, condition: { object_id: s.id } });
        this._set({ connected: true, error: '' });
        this.emit('ready');
        break;
      case OP.DISPATCH:
        this.emit('dispatch', d);
        break;
      case OP.RECONNECT:
        this._reconnectNow();
        break;
      case OP.ERROR:
      case OP.END_OF_STREAM:
        this._set({ error: d.message || `7TV-Code ${d.code}` });
        break;
      default:
        break; // Heartbeat, Ack
    }
  }

  // 7TV schickt regelmäßig Heartbeats – bleiben sie aus, ist die Verbindung tot
  _kickWatchdog() {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => this._reconnectNow(), this.heartbeatMs * 2.5);
  }

  _reconnectNow() {
    const ws = this.ws;
    this.ws = null;
    this.ready = false;
    try { ws && ws.close(); } catch { /* egal */ }
    this._set({ connected: false });
    this._connect();
  }

  _scheduleReconnect(reason) {
    const delay = Math.min(60000, 2000 * 2 ** this.retry++);
    if (reason) this._set({ error: reason });
    this.reconnectTimer = setTimeout(() => this._connect(), delay);
  }

  _send(op, d) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ op, d }));
  }

  _set(patch) {
    Object.assign(this.status, patch);
    this.emit('status', { ...this.status });
  }
}

module.exports = { SevenTvEvents };
