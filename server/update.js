'use strict';
// Hinweis auf neue Versionen: fragt höchstens 1× am Tag die neueste veröffentlichte Version auf GitHub ab.
// Abschaltbar (Einstellungen → Start). Gesendet wird nur die Anfrage selbst – keine Daten über Nutzer oder Setup.
const { EventEmitter } = require('events');
const { getJson } = require('./net');

const REPO = 'CrisioDev/glanceline';
const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const FIRST_DELAY_MS = 30 * 1000; // nicht beim Start bremsen
const INTERVAL_MS = 24 * 60 * 60 * 1000;

// 1.2.3 bzw. 1.2.3-beta.1; Vorabversionen sind älter als die fertige Version
function parse(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(v || '').trim());
  return m ? { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] || '' } : null;
}

function isNewer(candidate, current) {
  const a = parse(candidate);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a.nums[i] !== b.nums[i]) return a.nums[i] > b.nums[i];
  if (a.pre === b.pre) return false;
  if (!a.pre) return true;
  if (!b.pre) return false;
  return a.pre.localeCompare(b.pre, 'en', { numeric: true }) > 0;
}

class UpdateCheck extends EventEmitter {
  constructor({ current, fetchLatest } = {}) {
    super();
    this.current = current;
    this.fetchLatest = fetchLatest || (() => getJson(LATEST_URL, { headers: { Accept: 'application/vnd.github+json' } }));
    this.active = false;
    this.timer = null;
    this.status = { available: null }; // { version, url }, sobald es eine neuere Version gibt
  }

  start() {
    if (this.active) return;
    this.active = true;
    this._schedule(FIRST_DELAY_MS);
  }

  stop() {
    this.active = false;
    clearTimeout(this.timer);
    this.timer = null;
    this._set(null);
  }

  _schedule(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      await this.check();
      if (this.active) this._schedule(INTERVAL_MS);
    }, ms);
    if (this.timer.unref) this.timer.unref();
  }

  async check() {
    try {
      const r = await this.fetchLatest();
      if (!r || r.draft || r.prerelease) return;
      const version = String(r.tag_name || '').replace(/^v/, '');
      if (!isNewer(version, this.current)) return this._set(null);
      const url = /^https:\/\/github\.com\//.test(String(r.html_url)) ? String(r.html_url) : RELEASES_PAGE;
      this._set({ version, url });
    } catch (e) {
      console.warn('[update]', e.message);
    }
  }

  _set(available) {
    if (JSON.stringify(available) === JSON.stringify(this.status.available)) return;
    this.status = { available };
    this.emit('status', this.status);
  }
}

module.exports = { UpdateCheck, isNewer };
