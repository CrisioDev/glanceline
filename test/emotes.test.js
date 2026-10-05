'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMap, countsOf, fromSevenTv } = require('../server/emotes');

test('fromSevenTv: URLs, aspect ratio and zero-width flags', () => {
  const host = (url) => ({ url, files: [{ name: '1x.webp', width: 56, height: 32 }, { name: '2x.webp', width: 112, height: 64 }] });
  const out = fromSevenTv([
    { id: 'a1', name: 'catJAM', flags: 0, data: { flags: 0, host: host('//cdn.7tv.app/emote/a1') } },
    { id: 'b2', name: 'RainTime', flags: 1, data: { host: { url: 'https://cdn.7tv.app/emote/b2', files: [] } } },
    { id: 'c3', name: 'Overlay', flags: 0, data: { flags: 256, host: { url: 'https://cdn.7tv.app/emote/c3' } } },
  ]);
  assert.deepEqual(out[0], {
    id: 'a1',
    n: 'catJAM',
    p: '7tv',
    u: ['https://cdn.7tv.app/emote/a1/1x.webp', 'https://cdn.7tv.app/emote/a1/2x.webp', 'https://cdn.7tv.app/emote/a1/4x.webp'],
    r: 1.75,
    zw: false,
  });
  assert.equal(out[1].r, undefined);
  assert.equal(out[1].zw, true); // Aktiv-Flag 1
  assert.equal(out[2].zw, true); // Emote-Flag 256
});

test('fromSevenTv: skips entries without image host and tolerates empty input', () => {
  assert.deepEqual(fromSevenTv(null), []);
  assert.deepEqual(fromSevenTv(undefined), []);
  assert.deepEqual(fromSevenTv([{ id: 'x', name: 'NoData' }, { id: 'y', name: 'NoUrl', data: { host: {} } }]), []);
  const [e] = fromSevenTv([{ id: 'z', name: 'Zero', data: { host: { url: 'https://h/z', files: [{ name: '1x.webp', width: 10, height: 0 }] } } }]);
  assert.equal(e.r, undefined); // keine Division durch null
});

test('buildMap: channel emotes beat global ones, 7TV beats BTTV beats FFZ', () => {
  const e = (n, p) => ({ n, p, u: [] });
  const map = buildMap({
    ffzGlobal: [e('A', 'ffz-g'), e('B', 'ffz-g'), e('OnlyFfz', 'ffz-g')],
    bttvGlobal: [e('A', 'bttv-g')],
    stvGlobal: [e('A', '7tv-g'), e('B', '7tv-g')],
    ffzChannel: [e('B', 'ffz-c'), e('C', 'ffz-c')],
    bttvChannel: [e('C', 'bttv-c')],
    stvChannel: [e('C', '7tv-c')],
  });
  assert.equal(map.get('A').p, '7tv-g');
  assert.equal(map.get('B').p, 'ffz-c');
  assert.equal(map.get('C').p, '7tv-c');
  assert.equal(map.get('OnlyFfz').p, 'ffz-g');
  assert.equal(map.size, 4);
  assert.equal(buildMap({}).size, 0);
  assert.equal(buildMap({ stvChannel: [e('X', '7tv')] }).get('X').p, '7tv'); // fehlende Listen sind ok
});

test('countsOf: per provider and scope', () => {
  const list = (n) => Array.from({ length: n }, (_, i) => ({ n: `e${i}` }));
  assert.deepEqual(countsOf({ stvChannel: list(3), stvGlobal: list(50), bttvGlobal: list(2), ffzChannel: list(1) }), {
    seventv: { channel: 3, global: 50 },
    bttv: { channel: 0, global: 2 },
    ffz: { channel: 1, global: 0 },
  });
});
