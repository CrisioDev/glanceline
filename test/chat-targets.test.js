'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSlug } = require('../server/kick');
const { parseTarget } = require('../server/youtube');

test('kick parseSlug: links, @names and plain names', () => {
  assert.equal(parseSlug('https://kick.com/Some_User'), 'some_user');
  assert.equal(parseSlug('https://www.kick.com/abc-def/videos?x=1'), 'abc-def');
  assert.equal(parseSlug('kick.com/xqc'), 'xqc');
  assert.equal(parseSlug('  @xQc  '), 'xqc');
  assert.equal(parseSlug('xqc'), 'xqc');
  assert.equal(parseSlug('ab'), 'ab');
  assert.equal(parseSlug('x'.repeat(40)), 'x'.repeat(40));
});

test('kick parseSlug: rejects empty and invalid input', () => {
  for (const v of ['', '   ', null, undefined, 'a', 'has space', 'x'.repeat(41), 'https://twitch.tv/foo', 'ümlaut', '<script>']) {
    assert.equal(parseSlug(v), '', String(v));
  }
});

test('youtube parseTarget: video links', () => {
  const id = 'dQw4w9WgXcQ';
  for (const url of [
    `https://www.youtube.com/watch?v=${id}`,
    `https://www.youtube.com/watch?feature=share&v=${id}`,
    `https://m.youtube.com/watch?v=${id}&t=42`,
    `https://youtu.be/${id}?si=abc`,
    `https://www.youtube.com/live/${id}?si=abc`,
    `https://www.youtube.com/embed/${id}`,
  ]) {
    assert.deepEqual(parseTarget(url), { videoId: id, label: id }, url);
  }
});

test('youtube parseTarget: channel IDs, handles and legacy URLs', () => {
  const uc = 'UCa1B2-c3_D4e5F6g7H8i9J0';
  assert.equal(uc.length, 24);
  const channel = { channelId: uc, url: `https://www.youtube.com/channel/${uc}/live`, label: uc };
  assert.deepEqual(parseTarget(`https://www.youtube.com/channel/${uc}`), channel);
  assert.deepEqual(parseTarget(uc), channel);

  const handle = { handle: '@SomeHandle', url: 'https://www.youtube.com/@SomeHandle/live', label: '@SomeHandle' };
  assert.deepEqual(parseTarget('https://www.youtube.com/@SomeHandle'), handle);
  assert.deepEqual(parseTarget('https://www.youtube.com/@SomeHandle/streams?x=1'), handle);
  assert.deepEqual(parseTarget(' @SomeHandle '), handle);
  assert.deepEqual(parseTarget('SomeHandle'), handle);

  assert.deepEqual(parseTarget('https://www.youtube.com/c/SomeName'), { url: 'https://www.youtube.com/c/SomeName/live', label: 'c/SomeName' });
  assert.deepEqual(parseTarget('https://www.youtube.com/user/Old.Name'), { url: 'https://www.youtube.com/user/Old.Name/live', label: 'user/Old.Name' });
});

test('youtube parseTarget: rejects empty and unknown input', () => {
  for (const v of ['', '  ', null, undefined, 'ab', 'https://example.com/foo bar', 'two words', `@${'x'.repeat(31)}`]) {
    assert.equal(parseTarget(v), null, String(v));
  }
});
