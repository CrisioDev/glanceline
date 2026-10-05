'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { build, toSvg } = require('../public/qr');

// ---------- Unabhängiger Mini-Decoder nach ISO/IEC 18004 (nur Byte-Modus, Level M)
// Version → [Codewörter gesamt, EC-Codewörter je Block, Blöcke] (Tabelle 9 der Norm)
const SPEC = { 1: [26, 10, 1], 2: [44, 16, 1], 5: [134, 24, 2], 7: [196, 18, 4], 10: [346, 26, 5], 22: [1258, 28, 17], 32: [2465, 28, 33], 40: [3706, 28, 49] };
const ALIGN = { 1: [], 2: [6, 18], 5: [6, 30], 7: [6, 22, 38], 10: [6, 28, 50], 22: [6, 26, 50, 74, 98], 32: [6, 34, 60, 86, 112, 138], 40: [6, 30, 58, 86, 114, 142, 170] };
const MASKS = [
  (x, y) => (y + x) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (y + x) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((y * x) % 2) + ((y * x) % 3) === 0,
  (x, y) => (((y * x) % 2) + ((y * x) % 3)) % 2 === 0,
  (x, y) => (((y + x) % 2) + ((y * x) % 3)) % 2 === 0,
];

const EXP = new Array(512);
const LOG = new Array(256);
for (let i = 0, v = 1; i < 255; i++, v = (v << 1) ^ (v & 0x80 ? 0x11d : 0)) {
  EXP[i] = v;
  LOG[v] = i;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const gfMul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

const bch = (data, bits, poly) => {
  let r = data << bits;
  for (let i = 30; i >= bits; i--) if ((r >>> i) & 1) r ^= poly << (i - bits);
  return (data << bits) | r;
};

function decode(qr) {
  const { size, modules } = qr;
  const ver = (size - 17) / 4;
  assert.ok(Number.isInteger(ver) && SPEC[ver], `untested version ${ver}`);
  const dark = (x, y) => modules[y][x] === true;

  // Format-Information (zwei Kopien)
  let f1 = 0;
  let f2 = 0;
  const pos1 = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  pos1.forEach(([x, y], i) => { if (dark(x, y)) f1 |= 1 << i; });
  for (let i = 0; i < 8; i++) if (dark(size - 1 - i, 8)) f2 |= 1 << i;
  for (let i = 8; i < 15; i++) if (dark(8, size - 15 + i)) f2 |= 1 << i;
  assert.equal(f1, f2, 'both format copies agree');
  const format = f1 ^ 0x5412;
  assert.equal(bch(format >>> 10, 10, 0x537), format, 'format BCH valid');
  assert.equal(format >>> 13, 0, 'error correction level M');
  const mask = (format >>> 10) & 7;

  // Versions-Information ab Version 7
  if (ver >= 7) {
    let v1 = 0;
    let v2 = 0;
    for (let i = 0; i < 18; i++) {
      if (dark(size - 11 + (i % 3), Math.floor(i / 3))) v1 |= 1 << i;
      if (dark(Math.floor(i / 3), size - 11 + (i % 3))) v2 |= 1 << i;
    }
    assert.equal(v1, v2);
    assert.equal(v1, bch(ver, 12, 0x1f25), 'version info BCH valid');
  }

  // Funktionsmuster markieren
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const mark = (x0, y0, w, h) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) fn[y][x] = true; };
  mark(0, 0, 9, 9);
  mark(size - 8, 0, 8, 9);
  mark(0, size - 8, 9, 8);
  mark(6, 0, 1, size);
  mark(0, 6, size, 1);
  const al = ALIGN[ver];
  const last = al[al.length - 1];
  for (const cy of al) {
    for (const cx of al) if (!((cx === 6 && cy === 6) || (cx === 6 && cy === last) || (cx === last && cy === 6))) mark(cx - 2, cy - 2, 5, 5);
  }
  if (ver >= 7) {
    mark(size - 11, 0, 3, 6);
    mark(0, size - 11, 6, 3);
  }

  // Zickzack lesen, Maske entfernen
  const bits = [];
  let up = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) {
      const y = up ? size - 1 - v : v;
      for (const x of [right, right - 1]) if (!fn[y][x]) bits.push(dark(x, y) !== MASKS[mask](x, y) ? 1 : 0);
    }
    up = !up;
  }
  const [total, ecLen, numBlocks] = SPEC[ver];
  assert.equal(Math.floor(bits.length / 8), total, 'number of data modules');
  const cw = [];
  for (let i = 0; i < total; i++) cw.push(parseInt(bits.slice(i * 8, i * 8 + 8).join(''), 2));

  // Blöcke entschachteln und Reed-Solomon prüfen (Syndrome = 0)
  const shortLen = Math.floor(total / numBlocks);
  const numShort = numBlocks - (total % numBlocks);
  const dataLen = Array.from({ length: numBlocks }, (_, j) => shortLen - ecLen + (j < numShort ? 0 : 1));
  const blocks = dataLen.map(() => []);
  let k = 0;
  for (let i = 0; i < Math.max(...dataLen); i++) for (let j = 0; j < numBlocks; j++) if (i < dataLen[j]) blocks[j].push(cw[k++]);
  for (let i = 0; i < ecLen; i++) for (let j = 0; j < numBlocks; j++) blocks[j].push(cw[k++]);
  for (const block of blocks) {
    for (let i = 0; i < ecLen; i++) {
      let s = 0;
      for (const c of block) s = gfMul(s, EXP[i]) ^ c;
      assert.equal(s, 0, 'Reed-Solomon syndrome');
    }
  }

  // Byte-Modus auslesen
  const data = blocks.flatMap((b, j) => b.slice(0, dataLen[j]));
  const dbits = data.flatMap((b) => [7, 6, 5, 4, 3, 2, 1, 0].map((i) => (b >>> i) & 1));
  let p = 0;
  const read = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | dbits[p++];
    return v;
  };
  assert.equal(read(4), 0b0100, 'byte mode');
  const len = read(ver <= 9 ? 8 : 16);
  const bytes = Array.from({ length: len }, () => read(8));
  const used = Math.ceil((p + Math.min(4, dbits.length - p)) / 8);
  data.slice(used).forEach((b, i) => assert.equal(b, i % 2 ? 0x11 : 0xec, 'pad bytes'));
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
}

// Deterministischer, abwechslungsreicher ASCII-Text der Länge n
const filler = (n) => Array.from({ length: n }, (_, i) => String.fromCharCode(33 + ((i * 7919) % 94))).join('');

test('build: deterministic, square, size matches version', () => {
  const a = build('http://192.168.1.20:4890/?t=Abc_dEf-12345678');
  const b = build('http://192.168.1.20:4890/?t=Abc_dEf-12345678');
  assert.deepEqual(a, b);
  assert.equal(a.size, 17 + 4 * a.version);
  assert.equal(a.modules.length, a.size);
  for (const row of a.modules) {
    assert.equal(row.length, a.size);
    for (const m of row) assert.equal(typeof m, 'boolean');
  }
  assert.notDeepEqual(build('a').modules, build('b').modules);
});

test('build: smallest version that fits (byte mode, level M)', () => {
  assert.equal(build('').version, 1);
  assert.equal(build('x'.repeat(14)).version, 1);
  assert.equal(build('x'.repeat(15)).version, 2);
  assert.equal(build('ü'.repeat(7)).version, 1); // UTF-8: 14 Bytes
  assert.equal(build('ü'.repeat(8)).version, 2);
  assert.equal(build('x'.repeat(2331)).version, 40);
  assert.throws(() => build('x'.repeat(2332)), /zu lang/);
});

test('build: finder, separator, timing patterns and dark module', () => {
  const { size, modules } = build('glanceline');
  const corners = [[0, 0], [size - 7, 0], [0, size - 7]];
  for (const [ox, oy] of corners) {
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) assert.equal(modules[oy + y][ox + x], Math.max(Math.abs(x - 3), Math.abs(y - 3)) !== 2, `finder ${ox},${oy}`);
  }
  for (let i = 0; i < 8; i++) {
    assert.equal(modules[7][i], false);
    assert.equal(modules[i][7], false);
    assert.equal(modules[7][size - 1 - i], false);
    assert.equal(modules[size - 8][i], false);
  }
  for (let i = 8; i < size - 8; i++) {
    assert.equal(modules[6][i], i % 2 === 0);
    assert.equal(modules[i][6], i % 2 === 0);
  }
  assert.equal(modules[size - 8][8], true);
});

test('round trip: an independent decoder reads back the exact text', () => {
  const cases = [
    ['hello', 1],
    ['Grüße ✓ 😀', 2],
    [filler(70), 5],
    [filler(110), 7],
    [filler(200), 10],
    [filler(750), 22],
    [filler(1500), 32],
    [filler(2331), 40],
  ];
  for (const [text, version] of cases) {
    const qr = build(text);
    assert.equal(qr.version, version, `version for ${text.length} chars`);
    assert.equal(decode(qr), text);
  }
  // Gegenprobe: ein gekipptes Datenmodul fällt dem Decoder auf
  const qr = build('hello');
  const broken = { size: qr.size, modules: qr.modules.map((row) => row.slice()) };
  broken.modules[qr.size - 1][qr.size - 1] = !broken.modules[qr.size - 1][qr.size - 1];
  assert.throws(() => decode(broken), /syndrome/);
});

test('toSvg: quiet zone, colors and one square per dark module', () => {
  const { size, modules } = build('hi');
  const svg = toSvg('hi');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 (\d+) \1"/);
  assert.ok(svg.includes(`viewBox="0 0 ${size + 8} ${size + 8}"`));
  assert.ok(svg.includes('fill="#ffffff"') && svg.includes('fill="#2a2019"'));
  const darkCount = modules.flat().filter(Boolean).length;
  assert.equal((svg.match(/h1v1h-1z/g) || []).length, darkCount);
  assert.ok(svg.includes('M4,4h1v1h-1z')); // linke obere Ecke des Finders, 4 Module Rand
  const custom = toSvg('hi', { dark: '#000', light: 'transparent', border: 2 });
  assert.ok(custom.includes(`viewBox="0 0 ${size + 4} ${size + 4}"`) && custom.includes('fill="#000"') && custom.includes('M2,2h1v1h-1z'));
});
