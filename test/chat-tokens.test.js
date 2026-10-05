'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TokenBuilder, plainText } = require('../server/chat-tokens');

const em = (n, extra = {}) => ({ n, p: '7tv', u: [`${n}1`, `${n}2`, `${n}3`], r: 1, ...extra });
const map = (...list) => new Map(list.map((e) => [e.n, e]));
const build = (text, emotes, me) => {
  const tb = new TokenBuilder(emotes, me);
  tb.words(text);
  return tb.tokens;
};

test('plain text: whitespace runs collapse and adjacent text merges', () => {
  assert.deepEqual(build('hello   world\t\n!'), [{ t: 'text', v: 'hello world !' }]);
  assert.deepEqual(build(' lead'), [{ t: 'text', v: ' lead' }]);
  assert.deepEqual(build(''), []);
});

test('known emote names become emote tokens (case-sensitive)', () => {
  const emotes = map(em('catJAM'));
  assert.deepEqual(build('so catJAM catjam', emotes), [
    { t: 'text', v: 'so ' },
    { t: 'emote', n: 'catJAM', p: '7tv', u: ['catJAM1', 'catJAM2', 'catJAM3'], r: 1 },
    { t: 'text', v: ' catjam' },
  ]);
});

test('zero-width emotes stack onto the previous emote', () => {
  const emotes = map(em('catJAM'), em('SoSnowy', { zw: true }), em('TopHat', { zw: true }));
  assert.deepEqual(build('catJAM SoSnowy TopHat hi', emotes), [
    { t: 'emote', n: 'catJAM', p: '7tv', u: ['catJAM1', 'catJAM2', 'catJAM3'], r: 1, zw: [{ n: 'SoSnowy', u: ['SoSnowy1', 'SoSnowy2', 'SoSnowy3'] }, { n: 'TopHat', u: ['TopHat1', 'TopHat2', 'TopHat3'] }] },
    { t: 'text', v: ' hi' },
  ]);
  // Ohne vorheriges Emote erscheint es als normales Emote
  assert.deepEqual(build('hey SoSnowy', emotes), [
    { t: 'text', v: 'hey ' },
    { t: 'emote', n: 'SoSnowy', p: '7tv', u: ['SoSnowy1', 'SoSnowy2', 'SoSnowy3'], r: 1 },
  ]);
});

test('mentions: flagged when they target the own channel', () => {
  assert.deepEqual(build('@Streamer, hi @other @ x@y', null, 'STREAMER'), [
    { t: 'mention', v: '@Streamer,', me: true },
    { t: 'text', v: ' hi ' },
    { t: 'mention', v: '@other', me: false },
    { t: 'text', v: ' @ x@y' },
  ]);
  assert.deepEqual(build('@streamer', null, ''), [{ t: 'mention', v: '@streamer', me: false }]);
});

test('emote map lookups are not fooled by prototype keys', () => {
  assert.deepEqual(build('__proto__ constructor toString'), [{ t: 'text', v: '__proto__ constructor toString' }]);
});

test('text() and push() append tokens; plainText flattens them', () => {
  const tb = new TokenBuilder();
  tb.text('a');
  tb.text('b');
  tb.push({ t: 'emote', n: 'Kappa', p: 'twitch', u: [] });
  tb.words(' @you  ok');
  assert.deepEqual(tb.tokens, [
    { t: 'text', v: 'ab' },
    { t: 'emote', n: 'Kappa', p: 'twitch', u: [] },
    { t: 'text', v: ' ' },
    { t: 'mention', v: '@you', me: false },
    { t: 'text', v: ' ok' },
  ]);
  assert.equal(plainText(tb.tokens), 'abKappa @you ok');
  assert.equal(plainText([]), '');
  assert.equal(plainText([{ t: 'text' }]), '');
});
