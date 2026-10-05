'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { STRINGS, LANGUAGES, LANGUAGE_OPTIONS, resolveLang, translator } = require('../public/i18n');
const { DEFAULT_HOTKEYS } = require('../server/store');

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('resolveLang: explicit choice, system locale, fallback to English', () => {
  assert.equal(resolveLang('de', 'en-US'), 'de');
  assert.equal(resolveLang('en', 'de-DE'), 'en');
  assert.equal(resolveLang('auto', 'de-DE'), 'de');
  assert.equal(resolveLang('auto', 'de_AT'), 'de');
  assert.equal(resolveLang('auto', 'EN-us'), 'en');
  assert.equal(resolveLang('auto', 'fr-FR'), 'en');
  assert.equal(resolveLang('xx', 'de'), 'de');
  assert.equal(resolveLang(undefined, 'de-CH'), 'de');
  assert.ok(LANGUAGES.includes(resolveLang('auto'))); // Systemsprache dieses Rechners
});

test('translator: lookup, unknown keys and unknown languages', () => {
  const en = translator('en');
  const de = translator('de');
  assert.equal(en('tab.scripts'), STRINGS.en['tab.scripts']);
  assert.equal(de('tab.scripts'), STRINGS.de['tab.scripts']);
  assert.equal(translator('xx')('tab.scripts'), STRINGS.en['tab.scripts']);
  assert.equal(de('no.such.key'), 'no.such.key'); // z. B. Fehlertexte von OBS unverändert
  assert.equal(de('Connection refused'), 'Connection refused');
  assert.equal(de(''), '');
  assert.equal(de(null), '');
  assert.equal(de(undefined), '');
});

test('translator: falls back to English for keys missing in a language', () => {
  STRINGS.en['zz.testOnly'] = 'english only';
  try {
    assert.equal(translator('de')('zz.testOnly'), 'english only');
  } finally {
    delete STRINGS.en['zz.testOnly'];
  }
});

test('translator: variable interpolation, missing vars and plural .one', () => {
  const en = translator('en');
  assert.equal(en('ev.bits', { name: 'Ann', n: 100 }), 'Ann cheered 100 bits');
  assert.equal(en('ev.bits', { name: 'Ann' }), 'Ann cheered {n} bits'); // fehlende Variable bleibt stehen
  assert.equal(en('ev.bits'), STRINGS.en['ev.bits']);
  assert.equal(en('ev.raid', { name: 'R', n: 1 }), STRINGS.en['ev.raid.one'].replace('{name}', 'R'));
  assert.equal(en('ev.raid', { name: 'R', n: 2 }), 'R is raiding with 2 viewers!');
  assert.equal(en('ev.raid', { name: 'R', n: 0 }), 'R is raiding with 0 viewers!');
  assert.equal(en('ev.bits', { name: '<b>x</b>', n: '$&' }), '<b>x</b> cheered $& bits'); // keine Ersetzungsmuster
});

test('translator: variables that are translation keys get translated, plain text does not', () => {
  const en = translator('en');
  const key = Object.keys(STRINGS.en).find((k) => /^[a-z]+\.[\w.]+$/.test(k) && !STRINGS.en[k].includes('{'));
  assert.equal(en('ev.bits', { name: key, n: 1 }), `${STRINGS.en[key]} cheered 1 bits`);
  assert.equal(en('ev.bits', { name: 'some.unknown', n: 1 }), 'some.unknown cheered 1 bits');
});

test('translator: "key|detail" puts the translated detail into {msg}', () => {
  const key = Object.keys(STRINGS.en).find((k) => STRINGS.en[k].includes('{msg}'));
  assert.ok(key, 'a key with {msg} exists');
  const en = translator('en');
  assert.equal(en(`${key}|timeout`), STRINGS.en[key].replace('{msg}', 'timeout'));
  assert.equal(en(`${key}|tab.live`), STRINGS.en[key].replace('{msg}', STRINGS.en['tab.live']));
  assert.equal(en('no.such|x'), 'no.such|x');
});

test('every language has the same keys with the same placeholders', () => {
  assert.deepEqual(Object.keys(STRINGS), LANGUAGES);
  for (const lang of LANGUAGES) {
    const dict = STRINGS[lang];
    const missing = Object.keys(STRINGS.en).filter((k) => dict[k] == null);
    const extra = Object.keys(dict).filter((k) => STRINGS.en[k] == null);
    assert.deepEqual(missing, [], `${lang} misses keys`);
    assert.deepEqual(extra, [], `${lang} has keys not in en`);
    for (const [k, v] of Object.entries(dict)) {
      assert.equal(typeof v, 'string', `${lang}.${k}`);
      assert.ok(v.trim(), `${lang}.${k} is empty`);
      assert.deepEqual(placeholders(v), placeholders(STRINGS.en[k]), `${lang}.${k} placeholders`);
    }
  }
});

test('plural .one keys have a base key; language options match the dictionaries', () => {
  for (const k of Object.keys(STRINGS.en)) if (k.endsWith('.one')) assert.ok(STRINGS.en[k.slice(0, -4)], k);
  assert.deepEqual(LANGUAGE_OPTIONS.map(([v]) => v), ['auto', ...LANGUAGES]);
});

test('every hotkey action has a label (Stream Deck / Companion action list)', () => {
  for (const lang of LANGUAGES) for (const a of Object.keys(DEFAULT_HOTKEYS)) assert.ok(STRINGS[lang][`action.${a}`], `${lang}: action.${a}`);
});
