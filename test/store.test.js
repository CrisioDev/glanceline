'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store, DEFAULT_HOTKEYS, MODES, PROFILE_KEYS, newId, newToken } = require('../server/store');
const { Glanceline } = require('../server/index'); // nur der Prototyp – kein Server, keine Dienste

const TOKEN_RE = /^[A-Za-z0-9_-]{16}$/;
const ID_RE = /^[0-9a-f]{12}$/;

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glanceline-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Store mit vorgegebener settings.json (Objekt wird als JSON geschrieben, Text roh)
function storeWith(t, settings, scripts) {
  const dir = tmpDir(t);
  const write = (f, v) => v !== undefined && fs.writeFileSync(path.join(dir, f), typeof v === 'string' ? v : JSON.stringify(v));
  write('settings.json', settings);
  write('scripts.json', scripts);
  return { dir, store: new Store(dir) };
}

const readJson = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));

test('fresh data dir: defaults are created and written', (t) => {
  const dir = path.join(tmpDir(t), 'nested', 'data');
  const store = new Store(dir);
  const s = store.settings;
  assert.equal(s.general.port, 4890);
  assert.equal(s.general.language, 'auto');
  assert.equal(s.general.setupDone, false);
  assert.equal(s.general.lan, false);
  assert.match(s.general.token, TOKEN_RE);
  assert.deepEqual(s.hotkeys, DEFAULT_HOTKEYS);
  assert.notEqual(s.hotkeys, DEFAULT_HOTKEYS);
  assert.deepEqual(s.chat.providers, { seventv: true, bttv: true, ffz: true });
  assert.deepEqual(readJson(dir, 'settings.json'), JSON.parse(JSON.stringify(s)));

  const sc = store.scripts;
  assert.equal(sc.items.length, 1);
  assert.equal(sc.activeId, sc.items[0].id);
  assert.match(sc.items[0].id, ID_RE);
  assert.ok(sc.items[0].title && sc.items[0].body.startsWith('# '));
  assert.deepEqual(readJson(dir, 'scripts.json'), sc);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['scripts.json', 'settings.json']);
});

test('partial settings are deep-merged with the defaults', (t) => {
  const { store } = storeWith(t, { general: { setupDone: false, language: 'de' }, script: { speed: 120 }, chat: { providers: { bttv: false } } });
  const s = store.settings;
  assert.equal(s.script.speed, 120);
  assert.equal(s.script.fontSize, 56);
  assert.deepEqual(s.chat.providers, { seventv: true, bttv: false, ffz: true });
  assert.equal(s.general.port, 4890);
  assert.equal(s.general.setupDone, false);
  assert.equal(s.general.language, 'de');
  assert.equal(store.scripts.items[0].title, 'Stream-Intro (Beispiel)'); // Beispielskript in der eingestellten Sprache
});

test('settings from before the setup wizard count as set up', (t) => {
  assert.equal(storeWith(t, { chat: { channel: 'x' } }).store.settings.general.setupDone, true);
  assert.equal(storeWith(t, { general: { port: 5000 } }).store.settings.general.setupDone, true);
  assert.equal(storeWith(t, { general: { setupDone: true } }).store.settings.general.setupDone, true);
});

test('wrong types fall back to defaults, numbers are clamped', (t) => {
  const { store } = storeWith(t, `{
    "general": { "setupDone": true, "port": 80, "token": "" },
    "script": { "speed": 1e999, "fontSize": "huge", "lineHeight": 9, "countdown": 2.6 },
    "camera": { "fps": 30.6, "dim": -1 },
    "chat": { "hideBots": "nightbot", "highlightWords": [" Pizza ", "", 5], "maxMessages": null, "providers": [] },
    "ppt": { "maxFontSize": 30, "minFontSize": 90 },
    "hotkeys": "none",
    "display": null
  }`);
  const s = store.settings;
  assert.equal(s.general.port, 1024);
  assert.match(s.general.token, TOKEN_RE);
  assert.equal(s.script.speed, 70); // Infinity → Standard
  assert.equal(s.script.fontSize, 56);
  assert.equal(s.script.lineHeight, 2.2);
  assert.equal(s.script.countdown, 3);
  assert.equal(s.camera.fps, 31);
  assert.equal(s.camera.dim, 0);
  assert.deepEqual(s.chat.hideBots.slice(0, 2), ['nightbot', 'streamelements']);
  assert.deepEqual(s.chat.highlightWords, ['Pizza', '5']);
  assert.equal(s.chat.maxMessages, 40);
  assert.deepEqual(s.chat.providers, { seventv: true, bttv: true, ffz: true });
  assert.equal(s.ppt.minFontSize, s.ppt.maxFontSize);
  assert.deepEqual(s.hotkeys, DEFAULT_HOTKEYS);
  assert.equal(s.display.fontFamily, 'Atkinson Hyperlegible');
});

test('strings and enums are normalised', (t) => {
  const { store } = storeWith(t, {
    general: { setupDone: true, language: 'xx' },
    chat: { channel: ' #SomeChannel ', hideBots: ['NightBot'], youtube: ' @handle ', kick: ' xqc ' },
    library: { folder: ' "C:\\Scripts" ' },
    voice: { lang: 'klingon' },
    script: { align: 'right' },
    clicker: { step: 'book' },
    timers: { start: 'never' },
    obsAuto: { sceneModes: { Game: 'chat', Talk: 'script', Bad: 'nope' } },
  });
  const s = store.settings;
  assert.equal(s.general.language, 'auto');
  assert.equal(s.chat.channel, 'somechannel');
  assert.deepEqual(s.chat.hideBots, ['nightbot']);
  assert.equal(s.chat.youtube, '@handle');
  assert.equal(s.chat.kick, 'xqc');
  assert.equal(s.library.folder, 'C:\\Scripts');
  assert.equal(s.voice.lang, 'auto');
  assert.equal(s.script.align, 'left');
  assert.equal(s.clicker.step, 'line');
  assert.equal(s.timers.start, 'script');
  assert.deepEqual(s.obsAuto.sceneModes, { Game: 'chat', Talk: 'script' });
  assert.equal(storeWith(t, { voice: { lang: 'it' } }).store.settings.voice.lang, 'it');
});

test('profiles, outputs and MIDI mappings are sanitised', (t) => {
  const { store } = storeWith(t, {
    profiles: {
      list: [
        { id: 'p1', name: '  Stage  ', values: { script: { fontSize: 80, speed: 'fast' }, chat: { channel: 'evil' }, display: { mirror: true } } },
        { id: 'p1', name: 'duplicate' },
        { id: 'p2', name: '' },
        { name: 'no id' },
        'junk',
      ],
      active: 'gone',
      byMode: { chat: 'p1', script: 'gone', bogus: 'p1' },
    },
    outputs: [
      { id: 'out1', name: 'Co-Host', display: '123', mode: 'chat', mirror: 1 },
      { id: 'out1', name: 'dup' },
      { id: 'BAD ID', name: 'x' },
      { id: 'o2', mode: 'nope', enabled: false },
      { id: 'o3' }, { id: 'o4' }, { id: 'o5' },
    ],
    midi: { enabled: true, map: { 'note:1:60': 'blackout', 'cc:1:7': 'script:speed', 'note:1:61': 'rm -rf', 'sysex:1:1': 'blackout' } },
  });
  const s = store.settings;
  assert.deepEqual(s.profiles.list, [
    { id: 'p1', name: 'Stage', values: { script: { fontSize: 80 } } },
    { id: 'p2', name: 'Profil', values: {} },
  ]);
  assert.equal(s.profiles.active, '');
  assert.deepEqual(s.profiles.byMode, { chat: 'p1' });
  assert.deepEqual(s.outputs.map((o) => o.id), ['out1', 'o2', 'o3', 'o4']);
  assert.deepEqual(s.outputs[0], { id: 'out1', name: 'Co-Host', display: '123', mode: 'chat', mirror: true, enabled: true });
  assert.deepEqual(s.outputs[1], { id: 'o2', name: 'Output', display: 'window', mode: 'follow', mirror: false, enabled: false });
  assert.deepEqual(s.midi.map, { 'note:1:60': 'blackout', 'cc:1:7': 'script:speed' });
});

test('corrupt settings.json is kept as .broken-* and replaced by defaults', (t) => {
  const { dir, store } = storeWith(t, '{"general": {"port": 5000');
  assert.equal(store.settings.general.port, 4890);
  assert.equal(store.settings.general.setupDone, false);
  const broken = fs.readdirSync(dir).filter((f) => /^settings\.json\.broken-\d+$/.test(f));
  assert.equal(broken.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, broken[0]), 'utf8'), '{"general": {"port": 5000');
  assert.equal(readJson(dir, 'settings.json').general.port, 4890);
});

test('valid JSON that is not an object yields defaults without a backup', (t) => {
  for (const raw of ['[]', 'null', '"text"', '42']) {
    const { dir, store } = storeWith(t, raw);
    assert.equal(store.settings.general.setupDone, false, raw);
    assert.equal(store.settings.general.port, 4890, raw);
    assert.ok(!fs.readdirSync(dir).some((f) => f.includes('broken')), raw);
  }
});

test('scripts.json: kept when valid, sample when broken or malformed', (t) => {
  const mine = { activeId: 'a', items: [{ id: 'a', title: 'Mine', body: 'Hi', updatedAt: 1 }] };
  assert.deepEqual(storeWith(t, undefined, mine).store.scripts, mine);
  const broken = storeWith(t, undefined, '{oops');
  assert.equal(broken.store.scripts.items.length, 1);
  assert.ok(fs.readdirSync(broken.dir).some((f) => f.startsWith('scripts.json.broken-')));
  assert.equal(storeWith(t, undefined, { items: 'nope' }).store.scripts.items.length, 1);
});

test('save() is debounced, flush writes atomically, data survives a reload', (t) => {
  const dir = tmpDir(t);
  const store = new Store(dir);
  store.settings.script.speed = 99;
  store.save('settings');
  assert.notEqual(readJson(dir, 'settings.json').script.speed, 99);
  store.flushAll(); // löscht auch den Timer
  assert.equal(readJson(dir, 'settings.json').script.speed, 99);
  assert.ok(!fs.existsSync(path.join(dir, 'settings.json.tmp')));
  assert.equal(new Store(dir).settings.script.speed, 99);
});

test('Twitch login is stored separately and only when complete', (t) => {
  const dir = tmpDir(t);
  const store = new Store(dir);
  assert.equal(store.loadAuth(), null);
  const auth = { accessToken: 'a', refreshToken: 'r', userId: '1', login: 'me' };
  store.saveAuth(auth);
  assert.deepEqual(store.loadAuth(), auth);
  assert.equal(JSON.stringify(store.settings).includes('accessToken'), false);
  store.saveAuth({ accessToken: 'a' });
  assert.equal(store.loadAuth(), null);
  store.saveAuth(null);
  assert.ok(!fs.existsSync(path.join(dir, 'twitch-auth.json')));
  store.saveAuth(null); // zweimal löschen ist ok
});

test('newToken and newId shapes', () => {
  const tokens = new Set(Array.from({ length: 200 }, newToken));
  assert.equal(tokens.size, 200);
  for (const tk of tokens) assert.match(tk, TOKEN_RE);
  for (let i = 0; i < 50; i++) assert.match(newId(), ID_RE);
});

test('DEFAULT_HOTKEYS: frozen, valid, no duplicate accelerators', () => {
  assert.ok(Object.isFrozen(DEFAULT_HOTKEYS));
  const used = new Map();
  for (const [action, acc] of Object.entries(DEFAULT_HOTKEYS)) {
    assert.equal(typeof acc, 'string', action);
    if (!acc) continue;
    assert.match(acc, /^(Ctrl\+)?(Alt\+)?(Shift\+)?(F([1-9]|1[0-2])|num[0-9]|numadd|numsub|[A-Z0-9])$/, action);
    assert.match(acc, /\+/, `${action} needs a modifier`);
    const key = acc.toLowerCase();
    assert.ok(!used.has(key), `${action} and ${used.get(key)} both use ${acc}`);
    used.set(key, action);
  }
  assert.ok(MODES.every((m) => `mode:${m}` in DEFAULT_HOTKEYS));
  assert.ok(PROFILE_KEYS.every((k) => !/^(general|obs|hotkeys|chat\.channel)/.test(k)), 'profiles never carry connection settings');
});

// ---------- Glanceline.patchSettings auf einem Attrappen-this (ohne Server und Dienste)
function fakeCore(t) {
  const store = new Store(tmpDir(t));
  const calls = [];
  const rec = (name) => () => calls.push(name);
  store.save = (kind) => calls.push(`save:${kind}`); // kein Timer
  const core = {
    calls,
    store,
    get settings() { return store.settings; },
    emit: (e) => calls.push(`emit:${e}`),
    broadcast: (e) => calls.push(`broadcast:${e}`),
    touch: rec('touch'),
    _chatClear: (c) => calls.push(`clear:${c.platform}`),
    _updateLan: rec('updateLan'),
    _syncVoice: rec('syncVoice'),
    _relisten: rec('relisten'),
    twitch: { restart: rec('twitch.restart'), reloadEmotes: rec('twitch.reloadEmotes') },
    youtube: { restart: rec('youtube.restart'), reloadEmotes: rec('youtube.reloadEmotes') },
    kick: { restart: rec('kick.restart'), reloadEmotes: rec('kick.reloadEmotes') },
    obs: { restart: rec('obs.restart') },
    eventsub: { _set: rec('eventsub.set') },
    folder: { watch: rec('folder.watch') },
  };
  core.patch = (p) => Glanceline.prototype.patchSettings.call(core, p);
  return core;
}

test('patchSettings: deep-merges known keys, ignores unknown ones, re-sanitises', (t) => {
  const core = fakeCore(t);
  const s = core.settings;
  core.patch({ script: { speed: 120 }, chat: { providers: { ffz: false } }, nope: { x: 1 }, display: { bogus: true } });
  assert.equal(s.script.speed, 120);
  assert.equal(s.script.fontSize, 56);
  assert.deepEqual(s.chat.providers, { seventv: true, bttv: true, ffz: false });
  assert.equal('nope' in s, false);
  assert.equal('bogus' in s.display, false);
  assert.ok(core.calls.includes('save:settings') && core.calls.includes('broadcast:settings'));

  core.patch({ script: { speed: 99999, fontSize: 'big' }, chat: { channel: ' #NewChan ' } });
  assert.equal(s.script.speed, 600);
  assert.equal(s.script.fontSize, 56);
  assert.equal(s.chat.channel, 'newchan');
});

test('patchSettings: cannot pollute Object.prototype', (t) => {
  const core = fakeCore(t);
  const before = core.settings;
  core.patch(JSON.parse('{"__proto__": {"polluted": "yes"}, "script": {"__proto__": {"polluted": "yes"}, "speed": 90}, "constructor": {"prototype": {"polluted": "yes"}}}'));
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(Object.getPrototypeOf(core.settings), Object.prototype);
  assert.equal(Object.getPrototypeOf(core.settings.script), Object.prototype);
  assert.equal(core.settings.script.speed, 90);
  assert.equal(core.settings, before);
});

test('patchSettings: maps are replaced, not merged; non-objects are ignored', (t) => {
  const core = fakeCore(t);
  const s = core.settings;
  core.patch({ obsAuto: { sceneModes: { A: 'chat', B: 'script' } }, midi: { map: { 'note:1:60': 'blackout' } } });
  core.patch({ obsAuto: { sceneModes: { C: 'obs' } }, midi: { map: { 'cc:1:7': 'script:speed', 'bad': 'blackout' } } });
  assert.deepEqual(s.obsAuto.sceneModes, { C: 'obs' });
  assert.deepEqual(s.midi.map, { 'cc:1:7': 'script:speed' });
  const n = core.calls.length;
  for (const p of [null, undefined, [], 'x', 42]) core.patch(p);
  assert.equal(core.calls.length, n);
});

test('patchSettings: restarts exactly the services whose settings changed', (t) => {
  const core = fakeCore(t);
  const run = (p) => {
    core.calls.length = 0;
    core.patch(p);
    return core.calls.filter((c) => !/^(save|broadcast):/.test(c));
  };
  assert.deepEqual(run({ script: { speed: 80 } }), []);
  assert.deepEqual(run({ chat: { channel: 'somebody' } }), ['clear:twitch', 'twitch.restart']);
  assert.deepEqual(run({ chat: { channel: 'somebody' } }), []); // unverändert
  assert.deepEqual(run({ chat: { providers: { bttv: false } } }), ['twitch.reloadEmotes', 'youtube.reloadEmotes', 'kick.reloadEmotes']);
  assert.deepEqual(run({ chat: { youtube: '@x', kick: 'y' } }), ['clear:youtube', 'youtube.restart', 'clear:kick', 'kick.restart']);
  assert.deepEqual(run({ obs: { port: 4456 } }), ['obs.restart']);
  assert.deepEqual(run({ display: { mirror: true } }), ['emit:display']);
  assert.deepEqual(run({ hotkeys: { blackout: 'Ctrl+Alt+B' } }), ['emit:hotkeys']);
  assert.deepEqual(run({ general: { token: 'abcdefghijklmnop' } }), ['updateLan', 'touch']);
  assert.deepEqual(run({ voice: { enabled: true } }), ['syncVoice']);
});
