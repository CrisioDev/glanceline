'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { resolveLang, LANGUAGES } = require('../public/i18n');

// Strg+Alt+Buchstabe/Ziffer ist auf deutschen Tastaturen AltGr (@, €, {, [ …) –
// deshalb F-Tasten und Nummernblock als Standard.
const DEFAULT_HOTKEYS = Object.freeze({
  'mode:chat': 'Ctrl+Alt+F1',
  'mode:script': 'Ctrl+Alt+F2',
  'mode:obs': 'Ctrl+Alt+F3',
  'mode:ppt': 'Ctrl+Alt+F4',
  'mode:camera': 'Ctrl+Alt+F5',
  'blackout': 'Ctrl+Alt+F6',
  'camera:toggle': 'Ctrl+Alt+F7',
  'ppt:timerReset': 'Ctrl+Alt+F8',
  'script:toggle': 'Ctrl+Alt+num5',
  'view:back': 'Ctrl+Alt+num8',
  'view:forward': 'Ctrl+Alt+num2',
  'script:slower': 'Ctrl+Alt+num4',
  'script:faster': 'Ctrl+Alt+num6',
  'script:prevSection': 'Ctrl+Alt+num7',
  'script:nextSection': 'Ctrl+Alt+num9',
  'script:restart': 'Ctrl+Alt+num1',
  'font:bigger': 'Ctrl+Alt+numadd',
  'font:smaller': 'Ctrl+Alt+numsub',
  'voice:toggle': 'Ctrl+Alt+num3',
  'passthrough': 'Ctrl+Alt+F9',
  'chat:pause': 'Ctrl+Alt+F10',
  'insert:1': 'Ctrl+Alt+F11',
  'insert:2': 'Ctrl+Alt+F12',
  'insert:3': '',
  'insert:4': '',
  'director:clear': '',
  'script:reverse': '',
  'show:toggle': 'Ctrl+Alt+num0',
  'show:reset': '',
  'profile:next': '',
  'profile:1': '',
  'profile:2': '',
  'profile:3': '',
  'profile:4': '',
});

const MODES = ['chat', 'script', 'obs', 'ppt', 'camera'];

const newToken = () => crypto.randomBytes(12).toString('base64url');
const newId = () => crypto.randomBytes(6).toString('hex');

function defaultSettings() {
  const de = resolveLang('auto') === 'de';
  return {
    general: { language: 'auto', setupDone: false, startMode: 'chat', autostart: false, lan: false, port: 4890, token: newToken() },
    display: {
      target: 'auto', // 'auto', Bildschirm-ID oder 'virtual' (schwebendes Fenster)
      virtualOpacity: 0.9,
      mirror: false,
      testWindow: true,
      statusBar: true,
      fontFamily: 'Atkinson Hyperlegible',
      textColor: '#f4ede4',
      accentColor: '#e8a33d',
      brightness: 1, // Software-Dimmer gegen Spiegelungen im Glas
      highContrast: false,
      crosshair: false, // Markierung auf Höhe der Kameralinse
      crossX: 0.5,
      crossY: 0.5,
      crossSize: 56,
      crossOpacity: 0.55,
    },
    camera: {
      enabled: false,
      source: 'device',
      deviceLabel: '',
      obsSource: '',
      selfie: true,
      fps: 30,
      dim: 0.45,
      plate: 0.35,
      textOpacity: 1,
    },
    chat: {
      channel: '',
      youtube: '', // @Handle, Kanal- oder Video-Link
      kick: '', // Kanalname
      fontSize: 34,
      emoteScale: 1.5,
      maxMessages: 40,
      providers: { seventv: true, bttv: true, ffz: true },
      showBadges: true,
      showEvents: true,
      eventToasts: true,
      emoteNotices: true,
      hideCommands: true,
      hideBots: ['nightbot', 'streamelements', 'streamlabs', 'moobot', 'fossabot', 'wizebot', 'sery_bot', 'soundalerts', 'kofistreambot'],
      highlightWords: [],
      fadeAfter: 0,
    },
    script: { fontSize: 56, lineHeight: 1.4, speed: 70, guide: 0.3, showGuide: true, countdown: 3, margin: 0.07, align: 'left' },
    // Clicker & Fußpedal: einfache Tasten steuern den Prompter, solange der Skript-Modus aktiv ist
    clicker: { enabled: false, forward: 'PageDown', back: 'PageUp', toggle: 'B', step: 'line' },
    director: { seconds: 10, presets: de ? ['Noch 2 Minuten', 'Langsamer', 'Lauter bitte', 'Werbepause!'] : ['2 minutes left', 'Slow down', 'Speak up', 'Ad break!'] },
    inserts: { 1: '', 2: '', 3: '', 4: '' }, // Skript-IDs für Einschübe per Hotkey
    // Show-Timer: Laufzeit oder Countdown in der Statusleiste; startet von Hand, mit dem Skript oder mit dem Stream
    timers: { show: false, minutes: 0, start: 'script', warn: 2 },
    library: { folder: '' }, // Skript-Ordner, der live synchron gehalten wird
    windowState: { virtual: null }, // Position des virtuellen Prompters
    // Profile: benannte Sätze von Darstellungs-Einstellungen, optional automatisch je Modus
    profiles: { list: [], active: '', byMode: {} },
    voice: { enabled: false, lang: 'auto', micLabel: '', dimRead: true },
    ppt: { autoSwitch: true, maxFontSize: 54, minFontSize: 24, showNext: true, showTimer: true },
    obs: { host: '127.0.0.1', port: 4455, password: '' },
    obsAuto: { sceneModes: {}, recordWithScript: false, chapters: false },
    hotkeys: { ...DEFAULT_HOTKEYS },
  };
}

const RANGES = {
  'general.port': [1024, 65535, true],
  'camera.fps': [5, 60, true],
  'camera.dim': [0, 0.95],
  'camera.plate': [0, 1],
  'camera.textOpacity': [0.2, 1],
  'chat.fontSize': [12, 96, true],
  'chat.emoteScale': [0.8, 3],
  'chat.maxMessages': [5, 200, true],
  'chat.fadeAfter': [0, 3600, true],
  'script.fontSize': [16, 160, true],
  'script.lineHeight': [1, 2.2],
  'script.speed': [5, 600, true],
  'script.guide': [0.1, 0.7],
  'script.countdown': [0, 10, true],
  'ppt.maxFontSize': [16, 140, true],
  'ppt.minFontSize': [10, 100, true],
  'obs.port': [1, 65535, true],
  'display.brightness': [0.2, 1],
  'display.crossX': [0, 1],
  'display.crossY': [0, 1],
  'display.crossSize': [16, 300, true],
  'display.crossOpacity': [0.1, 1],
  'script.margin': [0, 0.45],
  'timers.minutes': [0, 600, true],
  'display.virtualOpacity': [0.3, 1],
  'timers.warn': [0, 60, true],
  'director.seconds': [3, 300, true],
};

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Bringt gespeicherte Werte in Form: fehlende Schlüssel ergänzen, falsche Typen zurücksetzen.
// Listen aus Objekten statt Texten (werden gesondert geprüft, z. B. von sanitizeProfiles)
const OBJECT_LISTS = new Set(['profiles.list']);

function conform(target, defaults, prefix = '') {
  for (const [k, def] of Object.entries(defaults)) {
    const cur = target[k];
    const p = prefix ? `${prefix}.${k}` : k;
    if (isObj(def)) {
      if (!isObj(cur)) target[k] = {};
      conform(target[k], def, p);
    } else if (Array.isArray(def) && OBJECT_LISTS.has(p)) {
      target[k] = Array.isArray(cur) ? cur.filter(isObj) : def;
    } else if (Array.isArray(def)) {
      target[k] = Array.isArray(cur) ? cur.map((v) => String(v).trim()).filter(Boolean) : def;
    } else if (typeof cur !== typeof def || (typeof def === 'number' && !Number.isFinite(cur))) {
      target[k] = def;
    }
  }
  return target;
}

// Was ein Profil speichert: alles zur Darstellung, nichts zu Verbindungen, Kanälen oder Hotkeys
const PROFILE_KEYS = [
  'display.fontFamily', 'display.textColor', 'display.accentColor', 'display.brightness', 'display.highContrast', 'display.statusBar',
  'display.crosshair', 'display.crossX', 'display.crossY', 'display.crossSize', 'display.crossOpacity',
  'camera.enabled', 'camera.dim', 'camera.plate', 'camera.textOpacity',
  'chat.fontSize', 'chat.emoteScale', 'chat.maxMessages', 'chat.showBadges', 'chat.showEvents', 'chat.fadeAfter',
  'script.fontSize', 'script.lineHeight', 'script.speed', 'script.guide', 'script.showGuide', 'script.countdown', 'script.margin', 'script.align',
  'ppt.maxFontSize', 'ppt.minFontSize', 'ppt.showNext', 'ppt.showTimer',
  'voice.enabled', 'voice.dimRead',
  'timers.show', 'timers.minutes', 'timers.warn',
];
const getPath = (o, p) => p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
function setPath(o, p, v) {
  const keys = p.split('.');
  const last = keys.pop();
  const obj = keys.reduce((x, k) => (isObj(x[k]) ? x[k] : (x[k] = {})), o);
  obj[last] = v;
}

function sanitizeProfiles(s) {
  const defaults = defaultSettings();
  const p = s.profiles;
  const ids = new Set();
  p.list = (Array.isArray(p.list) ? p.list : [])
    .filter((x) => isObj(x) && typeof x.id === 'string' && x.id && !ids.has(x.id) && ids.add(x.id))
    .slice(0, 30)
    .map((x) => {
      const values = {};
      for (const k of PROFILE_KEYS) {
        const v = getPath(x.values || {}, k);
        if (v !== undefined && typeof v === typeof getPath(defaults, k)) setPath(values, k, v);
      }
      return { id: x.id, name: String(x.name || '').trim().slice(0, 40) || 'Profil', values };
    });
  if (!p.list.some((x) => x.id === p.active)) p.active = '';
  for (const [mode, id] of Object.entries(p.byMode)) if (!MODES.includes(mode) || !p.list.some((x) => x.id === id)) delete p.byMode[mode];
}

function clampRanges(s) {
  for (const [p, [min, max, int]] of Object.entries(RANGES)) {
    const keys = p.split('.');
    const last = keys.pop();
    const obj = keys.reduce((o, k) => o[k], s);
    let v = Math.min(max, Math.max(min, obj[last]));
    if (int) v = Math.round(v);
    obj[last] = v;
  }
  if (s.ppt.minFontSize > s.ppt.maxFontSize) s.ppt.minFontSize = s.ppt.maxFontSize;
  s.chat.channel = s.chat.channel.trim().toLowerCase().replace(/^#/, '');
  s.chat.hideBots = s.chat.hideBots.map((b) => b.toLowerCase());
  s.chat.youtube = String(s.chat.youtube || '').trim();
  s.chat.kick = String(s.chat.kick || '').trim();
  s.library.folder = String(s.library.folder || '').trim().replace(/^"(.*)"$/, '$1');
  if (!s.general.token) s.general.token = newToken();
  if (s.general.language !== 'auto' && !LANGUAGES.includes(s.general.language)) s.general.language = 'auto';
  if (!['auto', 'de', 'en', 'fr', 'es'].includes(s.voice.lang)) s.voice.lang = 'auto';
  if (!['left', 'center'].includes(s.script.align)) s.script.align = 'left';
  if (!['line', 'page'].includes(s.clicker.step)) s.clicker.step = 'line';
  if (!['manual', 'script', 'stream'].includes(s.timers.start)) s.timers.start = 'script';
  for (const [scene, mode] of Object.entries(s.obsAuto.sceneModes)) if (!MODES.includes(mode)) delete s.obsAuto.sceneModes[scene];
  sanitizeProfiles(s);
}

const SAMPLE_SCRIPTS = {
  de: {
    title: 'Stream-Intro (Beispiel)',
    body: [
      '# Stream-Intro',
      '',
      'Hey und herzlich willkommen im Stream! [Lächeln]',
      '',
      'Schön, dass ihr heute dabei seid. Heute steht **etwas Besonderes** an – und so viel sei verraten: Es wird *spannend*.',
      '',
      '[Pause]',
      '',
      '## Organisatorisches',
      '',
      'Wenn euch der Stream gefällt, lasst gern ein Follow da – das hilft wirklich enorm.',
      '',
      '==Neu:== Im Kanal gibt es frische Emotes. Probiert sie im Chat aus!',
      '',
      "## Los geht's",
      '',
      'Also: Snacks bereit, Getränk in der Hand – wir starten in drei, zwei, eins …',
      '',
      '---',
      '',
      'So funktioniert das Skript: Eine Zeile mit # am Anfang wird zur Abschnitts-Überschrift, zu der du per Hotkey springen kannst. **fett**, *kursiv*, ==markiert== und [Regieanweisungen] werden hervorgehoben.',
    ],
  },
  en: {
    title: 'Stream intro (sample)',
    body: [
      '# Stream intro',
      '',
      'Hey, and welcome to the stream! [Smile]',
      '',
      "Great to have you here. We've got **something special** planned today – and I'll tell you this much: it's going to be *exciting*.",
      '',
      '[Pause]',
      '',
      '## Housekeeping',
      '',
      "If you're enjoying the stream, consider hitting follow – it really helps a lot.",
      '',
      '==New:== There are fresh emotes in the channel. Try them out in chat!',
      '',
      "## Let's go",
      '',
      'Alright: snacks ready, drink in hand – we start in three, two, one …',
      '',
      '---',
      '',
      'How scripts work: a line starting with # becomes a section heading you can jump to with a hotkey. **bold**, *italic*, ==highlight== and [stage directions] are highlighted.',
    ],
  },
};

function defaultScripts(lang) {
  const id = newId();
  const sample = SAMPLE_SCRIPTS[lang] || SAMPLE_SCRIPTS.en;
  return { activeId: id, items: [{ id, title: sample.title, body: sample.body.join('\n'), updatedAt: Date.now() }] };
}

function readJson(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    // Kaputte Datei nicht stillschweigend überschreiben
    try { fs.renameSync(file, `${file}.broken-${Date.now()}`); } catch { /* egal */ }
    return null;
  }
}

function writeAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

class Store {
  constructor(dir) {
    fs.mkdirSync(dir, { recursive: true });
    this.files = { settings: path.join(dir, 'settings.json'), scripts: path.join(dir, 'scripts.json') };
    this.timers = {};

    const loaded = readJson(this.files.settings);
    // Bestehende Installationen (vor dem Einrichtungs-Assistenten) gelten als eingerichtet
    const legacy = isObj(loaded) && !(isObj(loaded.general) && 'setupDone' in loaded.general);
    this.settings = conform(isObj(loaded) ? loaded : {}, defaultSettings());
    if (legacy) this.settings.general.setupDone = true;
    clampRanges(this.settings);

    const sc = readJson(this.files.scripts);
    this.scripts = isObj(sc) && Array.isArray(sc.items) ? sc : defaultScripts(resolveLang(this.settings.general.language));

    this.flush('settings');
    this.flush('scripts');
  }

  sanitize() {
    conform(this.settings, defaultSettings());
    clampRanges(this.settings);
  }

  save(kind) {
    clearTimeout(this.timers[kind]);
    this.timers[kind] = setTimeout(() => this.flush(kind), 250);
  }

  flush(kind) {
    clearTimeout(this.timers[kind]);
    try {
      writeAtomic(this.files[kind], this[kind]);
    } catch (e) {
      console.error(`[store] could not save ${kind}:`, e.message);
    }
  }

  flushAll() {
    this.flush('settings');
    this.flush('scripts');
  }
}

module.exports = { Store, DEFAULT_HOTKEYS, MODES, PROFILE_KEYS, newId, newToken };
