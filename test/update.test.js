'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { UpdateCheck, isNewer } = require('../server/update');

test('isNewer: semantic version order incl. pre-releases', () => {
  assert.equal(isNewer('0.5.1', '0.5.0'), true);
  assert.equal(isNewer('v0.6.0', '0.5.9'), true);
  assert.equal(isNewer('1.0.0', '0.99.99'), true);
  assert.equal(isNewer('0.10.0', '0.9.0'), true); // numerisch, nicht als Text
  assert.equal(isNewer('0.5.0', '0.5.0'), false);
  assert.equal(isNewer('0.4.9', '0.5.0'), false);
  assert.equal(isNewer('1.0.0', '1.0.0-beta.2'), true);
  assert.equal(isNewer('1.0.0-beta.10', '1.0.0-beta.9'), true);
  assert.equal(isNewer('1.0.0-beta.1', '1.0.0'), false);
  for (const bad of ['', 'latest', '1.2', '1.2.3.4', null, undefined]) assert.equal(isNewer(bad, '0.1.0'), false, String(bad));
});

const check = async (release, current = '0.5.0') => {
  const u = new UpdateCheck({ current, fetchLatest: async () => release });
  const events = [];
  u.on('status', (s) => events.push(s));
  await u.check();
  return { u, events };
};

test('UpdateCheck: reports a newer published release once', async () => {
  const { u, events } = await check({ tag_name: 'v0.6.0', html_url: 'https://github.com/CrisioDev/glanceline/releases/tag/v0.6.0' });
  assert.deepEqual(u.status.available, { version: '0.6.0', url: 'https://github.com/CrisioDev/glanceline/releases/tag/v0.6.0' });
  await u.check();
  assert.equal(events.length, 1); // gleicher Stand → kein neues Ereignis
});

test('UpdateCheck: ignores same or older versions, drafts and pre-releases', async () => {
  for (const r of [{ tag_name: 'v0.5.0' }, { tag_name: 'v0.4.0' }, { tag_name: 'v0.9.0', draft: true }, { tag_name: 'v0.9.0-beta.1', prerelease: true }, null]) {
    const { u } = await check(r);
    assert.equal(u.status.available, null, JSON.stringify(r));
  }
});

test('UpdateCheck: only links to github.com', async () => {
  const { u } = await check({ tag_name: 'v0.6.0', html_url: 'javascript:alert(1)' });
  assert.equal(u.status.available.url, 'https://github.com/CrisioDev/glanceline/releases/latest');
});

test('UpdateCheck: network errors are swallowed, stop clears the notice', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const u = new UpdateCheck({ current: '0.5.0', fetchLatest: async () => { throw new Error('offline'); } });
  await u.check();
  assert.equal(u.status.available, null);
  u.status = { available: { version: '9.9.9', url: 'https://github.com/x' } };
  u.stop();
  assert.equal(u.status.available, null);
});

test('UpdateCheck: start waits before the first request, stop cancels it', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const u = new UpdateCheck({ current: '0.5.0', fetchLatest: async () => { calls++; return null; } });
  u.start();
  t.mock.timers.tick(10 * 1000);
  assert.equal(calls, 0);
  u.stop();
  t.mock.timers.tick(60 * 1000);
  assert.equal(calls, 0);
  u.start();
  t.mock.timers.tick(30 * 1000);
  assert.equal(calls, 1);
  u.stop();
});
