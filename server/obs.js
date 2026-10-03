'use strict';
const { EventEmitter } = require('events');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// obs-websocket v5 – Events: General (1) | Scenes (4) | Outputs (64)
const EVENT_SUBSCRIPTIONS = 1 | 4 | 64;
const AUTH_FAILED = 4009;

function readObsConfig() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  try {
    return JSON.parse(fs.readFileSync(path.join(appData, 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json'), 'utf8'));
  } catch {
    return null;
  }
}

const sha256b64 = (s) => crypto.createHash('sha256').update(s).digest('base64');

function blankStatus() {
  return {
    connected: false,
    error: '',
    at: 0,
    scene: '',
    streaming: false,
    reconnecting: false,
    streamMs: 0,
    kbps: 0,
    dropped: 0,
    totalFrames: 0,
    recording: false,
    recordPaused: false,
    recordMs: 0,
    fps: 0,
    cpu: null,
  };
}

class ObsClient extends EventEmitter {
  constructor(getSettings) {
    super();
    this.getSettings = getSettings;
    this.ws = null;
    this.pending = new Map();
    this.nextId = 1;
    this.stopped = false;
    this.status = blankStatus();
  }

  start() {
    this.stopped = false;
    this._connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this._teardown();
  }

  restart() {
    clearTimeout(this.reconnectTimer);
    this._teardown();
    this._set({ ...blankStatus(), error: 'err.obs.connecting' });
    this._connect();
  }

  _teardown() {
    clearInterval(this.pollTimer);
    this.pollTimer = null;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('err.obs.disconnected'));
    }
    this.pending.clear();
    const ws = this.ws;
    this.ws = null;
    try { ws && ws.close(); } catch { /* egal */ }
  }

  _set(patch) {
    Object.assign(this.status, patch);
    this.emit('status', { ...this.status });
  }

  _endpoint() {
    const s = this.getSettings().obs;
    const cfg = readObsConfig();
    return {
      host: s.host || '127.0.0.1',
      port: s.port || (cfg && cfg.server_port) || 4455,
      // Leeres Passwort-Feld → direkt aus der OBS-Konfiguration übernehmen
      password: s.password || (cfg && cfg.server_password) || '',
    };
  }

  _connect() {
    if (this.stopped) return;
    const { host, port, password } = this._endpoint();
    let ws;
    try {
      ws = new WebSocket(`ws://${host}:${port}`);
    } catch (e) {
      this._set({ connected: false, error: e.message });
      this.reconnectTimer = setTimeout(() => this._connect(), 5000);
      return;
    }
    this.ws = ws;
    this.lastBytes = null;

    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this._onMessage(ws, msg, password);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this._teardown();
      const authFailed = ev.code === AUTH_FAILED;
      this._set({
        ...blankStatus(),
        error: authFailed ? 'err.obs.auth' : 'err.obs.unreachable',
      });
      if (!this.stopped) this.reconnectTimer = setTimeout(() => this._connect(), authFailed ? 15000 : 4000);
    };
    ws.onerror = () => { /* onclose folgt */ };
  }

  _onMessage(ws, msg, password) {
    const d = msg.d || {};
    switch (msg.op) {
      case 0: { // Hello
        const identify = { rpcVersion: 1, eventSubscriptions: EVENT_SUBSCRIPTIONS };
        if (d.authentication) {
          if (!password) {
            this._set({ error: 'err.obs.needPassword' });
            ws.close();
            return;
          }
          identify.authentication = sha256b64(sha256b64(password + d.authentication.salt) + d.authentication.challenge);
        }
        ws.send(JSON.stringify({ op: 1, d: identify }));
        break;
      }
      case 2: // Identified
        this._set({ connected: true, error: '' });
        this.request('GetCurrentProgramScene')
          .then((r) => this._set({ scene: r.sceneName || r.currentProgramSceneName || '' }))
          .catch(() => {});
        this._poll();
        this.pollTimer = setInterval(() => this._poll(), 1000);
        break;
      case 5: // Event
        this._onEvent(d);
        break;
      case 7: { // RequestResponse
        const p = this.pending.get(d.requestId);
        if (!p) return;
        this.pending.delete(d.requestId);
        clearTimeout(p.timer);
        if (d.requestStatus && d.requestStatus.result) p.resolve(d.responseData || {});
        else p.reject(new Error((d.requestStatus && d.requestStatus.comment) || `OBS ${d.requestStatus && d.requestStatus.code}`));
        break;
      }
      default:
        break;
    }
  }

  _onEvent(d) {
    switch (d.eventType) {
      case 'CurrentProgramSceneChanged':
        this._set({ scene: d.eventData.sceneName || '' });
        break;
      case 'StreamStateChanged':
      case 'RecordStateChanged':
        this._poll();
        break;
      case 'ExitStarted':
        this._set({ error: 'err.obs.exiting' });
        break;
      default:
        break;
    }
  }

  request(requestType, requestData) {
    return new Promise((resolve, reject) => {
      const ws = this.ws;
      if (!ws || ws.readyState !== 1 || !this.status.connected) {
        reject(new Error('err.obs.notConnected'));
        return;
      }
      const requestId = String(this.nextId++);
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('err.obs.timeout'));
      }, 5000);
      this.pending.set(requestId, { resolve, reject, timer });
      ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
    });
  }

  async _poll() {
    if (!this.status.connected || this.polling) return;
    this.polling = true;
    try {
      const [st, rec, stats] = await Promise.all([
        this.request('GetStreamStatus'),
        this.request('GetRecordStatus'),
        this.request('GetStats'),
      ]);
      const now = Date.now();
      let kbps = 0;
      if (st.outputActive && this.lastBytes != null && now > this.lastAt) {
        kbps = Math.max(0, Math.round(((st.outputBytes - this.lastBytes) * 8) / (now - this.lastAt))); // Byte/ms → kbit/s
      }
      this.lastBytes = st.outputActive ? st.outputBytes : null;
      this.lastAt = now;
      this._set({
        at: now,
        streaming: Boolean(st.outputActive),
        reconnecting: Boolean(st.outputReconnecting),
        streamMs: st.outputDuration || 0,
        kbps,
        dropped: st.outputSkippedFrames || 0,
        totalFrames: st.outputTotalFrames || 0,
        recording: Boolean(rec.outputActive),
        recordPaused: Boolean(rec.outputPaused),
        recordMs: rec.outputDuration || 0,
        fps: stats.activeFps || 0,
        cpu: typeof stats.cpuUsage === 'number' ? stats.cpuUsage : null,
      });
    } catch {
      /* Verbindungsabbruch wird über onclose behandelt */
    } finally {
      this.polling = false;
    }
  }

  async sources() {
    const [inputs, scenes] = await Promise.all([this.request('GetInputList'), this.request('GetSceneList')]);
    return {
      inputs: (inputs.inputs || []).map((i) => i.inputName).filter(Boolean),
      scenes: (scenes.scenes || []).map((s) => s.sceneName).filter(Boolean).reverse(),
    };
  }

  async screenshot(sourceName, width) {
    if (!this.shot) {
      // Parallele Anfragen teilen sich einen Screenshot, damit OBS nicht überlastet wird
      this.shot = this.request('GetSourceScreenshot', {
        sourceName,
        imageFormat: 'jpg',
        imageWidth: width,
        imageCompressionQuality: 72,
      }).finally(() => { this.shot = null; });
    }
    const r = await this.shot;
    const data = String(r.imageData || '');
    return Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
  }
}

module.exports = { ObsClient };
