'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Glanceline } = require('../server/index'); // nur der Prototyp – kein Server, keine Dienste

const TOKEN = 'Abc_dEf-12345678';
const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

// Spread statt Default-Parametern, damit { host: undefined } wirklich „kein Host“ bedeutet
function fakeReq(opts = {}) {
  const { method, url, host, origin, type, cookie, ip } = { method: 'GET', url: '/', host: '127.0.0.1:4890', ip: '127.0.0.1', ...opts };
  const headers = {};
  if (host !== undefined) headers.host = host;
  if (origin !== undefined) headers.origin = origin;
  if (type !== undefined) headers['content-type'] = type;
  if (cookie !== undefined) headers.cookie = cookie;
  return { method, url, headers, socket: { remoteAddress: ip } };
}

function fakeRes() {
  let done;
  return {
    status: 0,
    headers: {},
    body: undefined,
    ended: new Promise((r) => { done = r; }),
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    writeHead(status, headers = {}) {
      this.status = status;
      for (const [k, v] of Object.entries(headers)) this.headers[k.toLowerCase()] = v;
      return this;
    },
    end(body) {
      this.body = body;
      done(this);
    },
  };
}

const trusted = (opts) => {
  const res = fakeRes();
  const ok = Glanceline.prototype._trusted.call({}, fakeReq(opts), res);
  return { ok, res };
};
const authorized = (opts, token = TOKEN) => {
  const req = fakeReq(opts);
  const res = fakeRes();
  const ok = Glanceline.prototype._authorized.call({ settings: { general: { token } } }, req, new URL(req.url, 'http://localhost'), res);
  return { ok, res };
};

// Glanceline-Objekt ohne Konstruktor: nur Token, keine Dienste
const core = () => Object.create(Glanceline.prototype, { store: { value: { settings: { general: { token: TOKEN } } } } });
async function handle(opts) {
  const res = fakeRes();
  await core()._handle(fakeReq(opts), res);
  return res.ended;
}

test('DNS rebinding: only loopback, IP and *.localhost hosts are accepted', () => {
  for (const host of ['127.0.0.1:4890', '127.0.0.1', 'localhost:4890', 'localhost', '[::1]:4890', '[::1]', 'out-abc.localhost:4890', 'out-1.localhost', '192.168.1.20:4890', '10.0.0.5']) {
    assert.equal(trusted({ host }).ok, true, host);
  }
  for (const host of ['evil.com', 'evil.com:4890', 'localhost.evil.com', '127.0.0.1.nip.io:4890', 'a.b.localhost', 'evil.com.localhost', 'mypc.local:4890', '', undefined, '127.0.0.1:4890@evil.com', '1.2.3.4.5']) {
    const { ok, res } = trusted({ host });
    assert.equal(ok, false, String(host));
    assert.equal(res.status, 403);
    assert.equal(res.body, 'Verboten');
  }
});

test('CSRF: a foreign Origin is rejected, the own origin is accepted', () => {
  assert.equal(trusted({ host: 'localhost:4890', origin: 'http://localhost:4890' }).ok, true);
  assert.equal(trusted({ host: '127.0.0.1:4890', origin: 'http://127.0.0.1:4890', method: 'POST', type: 'application/json' }).ok, true);
  for (const origin of ['http://evil.com', 'http://localhost:4891', 'http://127.0.0.1:4890', 'null', 'not a url', 'file://']) {
    assert.equal(trusted({ host: 'localhost:4890', origin }).ok, false, origin);
    assert.equal(trusted({ host: 'localhost:4890', origin, method: 'POST', url: '/api/action', type: 'application/json' }).ok, false, origin);
  }
});

test('CSRF: POST requires application/json (no simple form or text posts)', () => {
  const post = (url, type) => trusted({ method: 'POST', url, type }).ok;
  assert.equal(post('/api/action', 'application/json'), true);
  assert.equal(post('/api/action', 'application/json; charset=utf-8'), true);
  for (const type of [undefined, '', 'text/plain', 'text/plain; charset=utf-8', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/octet-stream']) {
    assert.equal(post('/api/action', type), false, String(type));
  }
  assert.equal(post('/api/voice/audio?sr=48000', 'application/octet-stream'), true); // Mikrofon-Audio
  assert.equal(post('/api/voice/audio', 'text/plain'), false);
  // Ausnahme gilt nur für den normalisierten Pfad, nicht für Umwege über ../
  assert.equal(post('/api/voice/audio/../../api/action', 'application/octet-stream'), false);
  assert.equal(post('/api/voice/audio/../action', 'application/octet-stream'), false);
  assert.equal(trusted({ method: 'GET', url: '/api/state' }).ok, true); // GET ohne Content-Type
});

test('CSRF: the Google Slides extension may only POST JSON to /api/slides', () => {
  const ext = (opts) => trusted({ host: '127.0.0.1:4890', origin: EXT, method: 'POST', url: '/api/slides', type: 'application/json', ...opts }).ok;
  assert.equal(ext(), true);
  assert.equal(ext({ url: '/api/slides?x=1' }), true);
  assert.equal(ext({ url: '/api/action' }), false);
  assert.equal(ext({ url: '/api/settings' }), false);
  assert.equal(ext({ url: '/api/slides/../action' }), false);
  assert.equal(ext({ url: '/api/slidesx' }), false);
  assert.equal(ext({ method: 'GET' }), false);
  assert.equal(ext({ type: 'text/plain' }), false);
  assert.equal(ext({ origin: 'chrome-extension://ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP' }), false);
  assert.equal(ext({ origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnoz' }), false);
  assert.equal(ext({ origin: `${EXT}x` }), false);
  assert.equal(ext({ origin: 'moz-extension://abcdefghijklmnopabcdefghijklmnop' }), false);
  assert.equal(ext({ host: 'evil.com' }), false); // Host-Prüfung gilt trotzdem
});

test('auth: local clients need no token', () => {
  for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    const { ok, res } = authorized({ ip });
    assert.equal(ok, true, ip);
    assert.equal(res.status, 0);
    assert.equal(res.headers['set-cookie'], undefined);
  }
});

test('auth: LAN clients without a valid token get 401', () => {
  for (const opts of [{}, { url: '/?t=wrong' }, { url: '/?t=' }, { url: `/?t=${TOKEN}x` }, { url: `/?t=${TOKEN.slice(0, -1)}` }, { url: `/?t=${TOKEN.toLowerCase()}` }, { url: `/?t=wrong&t=${TOKEN}` }, { cookie: 'sfl=wrong' }, { cookie: `xsfl=${TOKEN}` }, { cookie: `sfl=${TOKEN}x` }, { cookie: 'sfl=' }]) {
    const { ok, res } = authorized({ ip: '192.168.1.50', ...opts });
    assert.equal(ok, false, JSON.stringify(opts));
    assert.equal(res.status, 401);
    assert.match(res.body, /No access/);
    assert.equal(res.headers['set-cookie'], undefined);
  }
  assert.equal(authorized({ ip: '127.0.0.2' }).ok, false); // nur exakte Loopback-Adressen
  assert.equal(authorized({ ip: undefined }).ok, false);
});

test('auth: ?t=<token> is accepted and sets an HttpOnly session cookie', () => {
  const { ok, res } = authorized({ ip: '192.168.1.50', url: `/?t=${TOKEN}` });
  assert.equal(ok, true);
  assert.equal(res.status, 0);
  const cookie = res.headers['set-cookie'];
  assert.ok(cookie.startsWith(`sfl=${TOKEN};`), cookie);
  assert.match(cookie, /;\s*HttpOnly/i);
  assert.match(cookie, /;\s*SameSite=(Lax|Strict)/i);
  assert.match(cookie, /;\s*Path=\//);
});

test('auth: the session cookie is accepted on its own and among others', () => {
  assert.equal(authorized({ ip: '192.168.1.50', cookie: `sfl=${TOKEN}` }).ok, true);
  assert.equal(authorized({ ip: '192.168.1.50', cookie: `a=1; sfl=${TOKEN}; b=2` }).ok, true);
  assert.equal(authorized({ ip: '192.168.1.50', url: '/prompter', cookie: `theme=dark;sfl=${TOKEN}` }).ok, true);
});

test('auth: an empty configured token never matches', () => {
  assert.equal(authorized({ ip: '192.168.1.50', url: '/?t=' }, '').ok, false);
  assert.equal(authorized({ ip: '192.168.1.50', cookie: 'sfl=' }, '').ok, false);
});

test('request pipeline: foreign hosts and LAN clients without token are stopped before routing', async () => {
  const rebind = await handle({ host: 'evil.com:4890', url: '/api/state' });
  assert.equal(rebind.status, 403);
  const lan = await handle({ host: '192.168.1.20:4890', ip: '192.168.1.50', url: '/api/state' });
  assert.equal(lan.status, 401);
  const post = await handle({ method: 'POST', url: '/api/action', type: 'application/json', origin: 'http://evil.com' });
  assert.equal(post.status, 403);
  for (const res of [rebind, lan, post]) assert.equal(res.headers['x-content-type-options'], 'nosniff');
});

test('static files: served with type, CSP for HTML; no path traversal', async () => {
  const js = await handle({ url: '/qr.js', host: '192.168.1.20:4890', ip: '192.168.1.50', cookie: `sfl=${TOKEN}` });
  assert.equal(js.status, 200);
  assert.match(js.headers['content-type'], /^text\/javascript/);
  assert.match(String(js.body), /GlancelineQR/);

  const html = await handle({ url: '/' });
  assert.equal(html.status, 200);
  const csp = html.headers['content-security-policy'];
  assert.ok(csp, 'CSP header on HTML');
  assert.match(csp, /default-src 'self'/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-(inline|eval)'/);

  for (const url of ['/../server/store.js', '/..%2fserver%2fstore.js', '/..%5cserver%5cstore.js', '/%2e%2e/package.json', '/%2e%2e%2fpackage.json', '/..%2f..%2f..%2f..%2fWindows%2fwin.ini', '/C:%5cWindows%5cwin.ini', '/%2fetc%2fpasswd']) {
    const res = await handle({ url });
    assert.ok(res.status === 403 || res.status === 404, `${url} → ${res.status}`);
  }
  const direct = fakeRes();
  Glanceline.prototype._file.call({}, direct, '../server/store.js');
  assert.equal(direct.status, 403);
});
