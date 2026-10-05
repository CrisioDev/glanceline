'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { VoiceTracker, similar } = require('../server/voice-tracker');
const { norm, VoiceFollow, lineY, LANGUAGES, SINGLE_LANGUAGES, MULTI_LANGUAGES } = require('../public/voice-text');

// Skript → Wortliste wie im Prompter: [Regie] zählt nicht, Überschriften sind markiert
function scriptWords(md, lang = 'en') {
  const out = [];
  for (const line of md.split('\n')) {
    const h = /^#{1,3}\s+/.test(line);
    for (const w of line.replace(/^#{1,3}\s+/, '').replace(/\[[^\]\n]{1,48}\]/g, ' ').split(/\s+/)) {
      const n = norm(w, lang);
      if (n) out.push({ w: n, h });
    }
  }
  return out;
}

const SCRIPT = scriptWords(`# Intro
Hello and welcome to the stream everybody [smile]
Today we are building a small teleprompter together
# Part two
After the break we will look at voice tracking in detail
Finally we answer questions from the chat`);
const at = (w) => SCRIPT.findIndex((x) => x.w === w);

// Spricht Wort für Wort, wie der Erkenner es meldet (alle bisher gehörten Wörter)
function speak(tracker, text, heard = []) {
  for (const w of text.split(/\s+/).filter(Boolean)) {
    heard.push(norm(w, 'en'));
    tracker.update(heard);
  }
  return heard;
}

test('similar: exact for short words, tolerant for longer ones', () => {
  assert.equal(similar('ab', 'ab'), true);
  assert.equal(similar('ab', 'ac'), false);
  assert.equal(similar('the', 'tha'), false);
  assert.equal(similar('cat', 'car'), false);
  assert.equal(similar('building', 'bilding'), true);
  assert.equal(similar('small', 'smal'), true);
  assert.equal(similar('house', 'houses'), true); // Präfix ab 5 Zeichen
  assert.equal(similar('teleprompter', 'teleprompters'), true);
  assert.equal(similar('stream', 'scream'), true);
  assert.equal(similar('stream', 'dream'), false);
  assert.equal(similar('welcome', 'tracking'), false);
});

test('VoiceTracker follows a script read word by word, skipping headings and cues', () => {
  const t = new VoiceTracker(SCRIPT);
  assert.equal(SCRIPT.some((x) => x.w === 'smile'), false);
  speak(t, 'hello and welcome to the stream everybody');
  assert.equal(t.pos, at('everybody') + 1);
  const heard = speak(t, 'today we are building a small teleprompter together');
  assert.equal(t.pos, at('together') + 1);
  speak(t, 'after the', heard); // Überschrift „Part two“ wird nicht vorgelesen
  assert.equal(t.pos, at('after') + 2);
  speak(t, 'break we will look at voice tracking in detail finally we answer questions from the chat', heard);
  assert.equal(t.pos, SCRIPT.length);
});

test('VoiceTracker tolerates misrecognised words', () => {
  const t = new VoiceTracker(SCRIPT);
  speak(t, 'hello and welcome to the stream everybody today we are bilding a smal teleprompter');
  assert.equal(t.pos, at('teleprompter') + 1);
});

test('VoiceTracker stays put during ad-libs and resumes afterwards', () => {
  const t = new VoiceTracker(SCRIPT);
  const heard = speak(t, 'hello and welcome to the');
  const pos = t.pos;
  speak(t, 'um so like whatever i was thinking about pizza', heard);
  assert.equal(t.pos, pos);
  speak(t, 'stream everybody today', heard);
  assert.equal(t.pos, at('today') + 1);
});

test('VoiceTracker jumps forward over a skipped part only with enough evidence', () => {
  const t = new VoiceTracker(SCRIPT);
  const heard = speak(t, 'hello and welcome to the stream everybody');
  const pos = t.pos;
  speak(t, 'answer questions', heard); // zwei Wörter weit voraus reichen nicht
  assert.equal(t.pos, pos);
  speak(t, 'from the chat', heard);
  assert.equal(t.pos, SCRIPT.length);
});

test('VoiceTracker jumps back on a clear restart, not on a single repeated word', () => {
  const t = new VoiceTracker(SCRIPT);
  const heard = speak(t, 'hello and welcome to the stream everybody today we are building a small teleprompter together');
  const pos = t.pos;
  speak(t, 'hello', heard);
  assert.equal(t.pos, pos);
  speak(t, 'oops let me start over hello and welcome to the', heard);
  assert.equal(t.pos, at('the') + 1);
});

test('VoiceTracker: empty input, repeated updates, seek and setWords', () => {
  assert.equal(new VoiceTracker([]).update(['hello']), 0);
  const t = new VoiceTracker(SCRIPT);
  assert.equal(t.update([]), 0);
  assert.equal(t.update(['hello']), 2);
  t.pos = 0; // gleiche Eingabe wird nicht erneut ausgewertet
  assert.equal(t.update(['hello']), 0);
  t.seek(30);
  assert.equal(t.pos, 30);
  t.seek(-5);
  assert.equal(t.pos, 0);
  t.seek(999);
  assert.equal(t.pos, SCRIPT.length);
  t.setWords(SCRIPT.slice(0, 5));
  assert.equal(t.pos, 5);
  assert.equal(t.lastKey, '');
});

test('norm: case, punctuation, accents and ß', () => {
  assert.equal(norm('Hello,', 'en'), 'hello');
  assert.equal(norm('„Schön“!', 'de'), 'schon');
  assert.equal(norm('Straße', 'de'), 'strasse');
  assert.equal(norm('Café', 'fr'), 'cafe');
  assert.equal(norm('...', 'en'), '');
  assert.equal(norm('–', 'en'), '');
  assert.equal(norm('Привет!', 'ru'), 'привет');
  assert.equal(norm('Γειά', 'el'), 'γεια');
  assert.equal(norm("don't", 'en'), 'dont');
});

test('norm: small numbers become words in languages with a number list', () => {
  assert.equal(norm('10', 'de'), 'zehn');
  assert.equal(norm('5', 'de'), norm('fünf', 'de'));
  assert.equal(norm('3', 'en'), 'three');
  assert.equal(norm('0', 'fr'), 'zero');
  assert.equal(norm('12', 'es'), 'doce');
  assert.equal(norm('13', 'en'), '13');
  assert.equal(norm('3', 'it'), '3');
  assert.equal(norm('3.', 'en'), 'three');
});

test('language lists', () => {
  assert.deepEqual(SINGLE_LANGUAGES, ['de', 'en', 'fr', 'es']);
  assert.deepEqual(LANGUAGES, [...SINGLE_LANGUAGES, ...MULTI_LANGUAGES]);
  assert.equal(new Set(LANGUAGES).size, LANGUAGES.length);
});

test('VoiceFollow: estimates speaking rate and extrapolates, capped', () => {
  const f = new VoiceFollow({ maxLead: 2.5, horizon: 1.2 });
  f.update(2, 1000); // erste Meldung = Sprung
  assert.equal(f.rate, 0);
  assert.equal(f.predict(1500), 2);
  f.update(4, 2000); // 2 Wörter in 1 s
  assert.equal(f.rate, 2);
  assert.equal(f.predict(2500), 5);
  assert.equal(f.predict(3500), 4 + 1.2 * 2); // nur bis zum Horizont
  f.update(5, 3600); // Erkenner meldet weniger als vorhergesagt
  assert.ok(f.rate > 0);
  assert.equal(f.predict(3600), 4 + 1.2 * 2); // läuft nicht spürbar zurück
});

test('VoiceFollow: large jumps reset the rate and the shown position', () => {
  const f = new VoiceFollow();
  f.update(2, 1000);
  f.update(4, 2000);
  f.update(40, 2500);
  assert.equal(f.rate, 0);
  assert.equal(f.predict(4000), 40);
  f.update(10, 3000); // zurückgespult
  assert.equal(f.predict(3500), 10);
});

test('lineY: interpolates within a line and clamps at the ends', () => {
  const lines = [{ top: 0, first: 0, count: 5 }, { top: 50, first: 5, count: 5 }, { top: 100, first: 10, count: 3 }];
  assert.equal(lineY([], 3), 0);
  assert.equal(lineY(lines, 0), 0);
  assert.equal(lineY(lines, 2.5), 25);
  assert.equal(lineY(lines, 7), 70);
  assert.equal(lineY(lines, 12), 100);
  assert.equal(lineY(lines, -3), 0);
});
