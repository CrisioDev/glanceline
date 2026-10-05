'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { zip, zipFolder } = require('../server/zip');
const { unzipEntry, formatRuns, docxXmlToScript, docxToScript } = require('../public/docx');

const inflate = (d) => zlib.inflateRawSync(d);

// Eigener, kleiner ZIP-Leser: geht lokale Header und zentrales Verzeichnis getrennt durch
function readZip(buf) {
  const eocd = buf.length - 22;
  assert.equal(buf.readUInt32LE(eocd), 0x06054b50, 'end of central directory');
  const count = buf.readUInt16LE(eocd + 10);
  assert.equal(buf.readUInt16LE(eocd + 8), count);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  assert.equal(cdOffset + cdSize, eocd, 'central directory ends at EOCD');
  const entries = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, 'central header');
    const nameLen = buf.readUInt16LE(p + 28);
    const e = {
      flags: buf.readUInt16LE(p + 8),
      method: buf.readUInt16LE(p + 10),
      time: buf.readUInt16LE(p + 12),
      date: buf.readUInt16LE(p + 14),
      crc: buf.readUInt32LE(p + 16),
      csize: buf.readUInt32LE(p + 20),
      usize: buf.readUInt32LE(p + 24),
      offset: buf.readUInt32LE(p + 42),
      name: buf.toString('utf8', p + 46, p + 46 + nameLen),
    };
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    const l = e.offset;
    assert.equal(buf.readUInt32LE(l), 0x04034b50, 'local header');
    assert.equal(buf.readUInt16LE(l + 6), e.flags);
    assert.equal(buf.readUInt16LE(l + 8), e.method);
    assert.equal(buf.readUInt32LE(l + 14), e.crc);
    assert.equal(buf.readUInt32LE(l + 18), e.csize);
    assert.equal(buf.readUInt32LE(l + 22), e.usize);
    const lNameLen = buf.readUInt16LE(l + 26);
    assert.equal(buf.toString('utf8', l + 30, l + 30 + lNameLen), e.name);
    const start = l + 30 + lNameLen + buf.readUInt16LE(l + 28);
    e.data = e.method === 8 ? inflate(buf.subarray(start, start + e.csize)) : buf.subarray(start, start + e.csize);
    entries.push(e);
  }
  assert.equal(p, eocd);
  return entries;
}

// Handgebautes ZIP mit unkomprimiertem Eintrag (Methode 0) und Extra-Feld im lokalen Header
function storedZip(name, data, method = 0) {
  const n = Buffer.from(name);
  const extra = Buffer.from([0xfe, 0xca, 0, 0]);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(zlib.crc32(data) >>> 0, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(n.length, 26);
  local.writeUInt16LE(extra.length, 28);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(zlib.crc32(data) >>> 0, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(n.length, 28);
  const body = Buffer.concat([local, n, extra, data]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + n.length, 12);
  end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, central, n, end]);
}

test('zip: valid archive with deflated entries, CRCs and UTF-8 names', () => {
  const random = crypto.randomBytes(5000);
  const input = [
    { name: 'hello.txt', data: Buffer.from('hello world') },
    { name: 'dir\\nested\\big.txt', data: Buffer.alloc(20000, 'abc') },
    { name: 'Grüße/ü.bin', data: random },
    { name: 'empty.txt', data: Buffer.alloc(0) },
  ];
  const buf = zip(input);
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  const entries = readZip(buf);
  assert.deepEqual(entries.map((e) => e.name), ['hello.txt', 'dir/nested/big.txt', 'Grüße/ü.bin', 'empty.txt']);
  entries.forEach((e, i) => {
    assert.equal(e.method, 8);
    assert.equal(e.flags, 0x0800);
    assert.equal(e.crc, zlib.crc32(input[i].data) >>> 0);
    assert.equal(e.usize, input[i].data.length);
    assert.deepEqual(e.data, input[i].data);
  });
  assert.ok(entries[1].csize < 1000, 'compressed');
  const year = 1980 + (entries[0].date >> 9);
  assert.ok(Math.abs(year - new Date().getFullYear()) <= 1);
  assert.ok(((entries[0].date >> 5) & 15) >= 1 && (entries[0].date & 31) >= 1);
});

test('zip: empty archive is just the end record', () => {
  const buf = zip([]);
  assert.equal(buf.length, 22);
  assert.deepEqual(readZip(buf), []);
});

test('zip + unzipEntry: docx.js reads back what zip.js writes', async () => {
  const buf = zip([{ name: 'a.txt', data: Buffer.from('first') }, { name: 'word/document.xml', data: Buffer.from('<x>ü</x>') }]);
  assert.equal(Buffer.from(await unzipEntry(buf, 'word/document.xml', inflate)).toString(), '<x>ü</x>');
  assert.equal(Buffer.from(await unzipEntry(buf, 'a.txt', inflate)).toString(), 'first');
  // ArrayBuffer (Browser) und Puffer mit Versatz im zugrunde liegenden Speicher
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
  assert.equal(Buffer.from(await unzipEntry(ab, 'a.txt', inflate)).toString(), 'first');
  const shifted = Buffer.concat([Buffer.alloc(7), buf]).subarray(7);
  assert.equal(Buffer.from(await unzipEntry(shifted, 'a.txt', inflate)).toString(), 'first');
});

test('unzipEntry: stored entries, missing entries, bad input', async () => {
  const stored = storedZip('word/document.xml', Buffer.from('<stored/>'));
  assert.equal(Buffer.from(await unzipEntry(stored, 'word/document.xml', inflate)).toString(), '<stored/>');
  await assert.rejects(unzipEntry(stored, 'nope.xml', inflate), /nope\.xml missing/);
  await assert.rejects(unzipEntry(storedZip('word/document.xml', Buffer.from('x'), 12), 'word/document.xml', inflate), /unsupported zip method 12/);
  await assert.rejects(unzipEntry(Buffer.from('this is definitely not a zip archive'), 'x', inflate), /not a zip file/);
  await assert.rejects(unzipEntry(Buffer.alloc(5), 'x', inflate), /not a zip file/);
});

test('zipFolder: packs nested files under the folder name', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'glanceline-zip-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'plugin.sdPlugin');
  fs.mkdirSync(path.join(dir, 'imgs', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), '{"a":1}');
  fs.writeFileSync(path.join(dir, 'imgs', 'sub', 'icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const entries = readZip(zipFolder(dir));
  const byName = Object.fromEntries(entries.map((e) => [e.name, e.data]));
  assert.deepEqual(Object.keys(byName).sort(), ['plugin.sdPlugin/imgs/sub/icon.png', 'plugin.sdPlugin/manifest.json']);
  assert.equal(byName['plugin.sdPlugin/manifest.json'].toString(), '{"a":1}');
  assert.deepEqual([...byName['plugin.sdPlugin/imgs/sub/icon.png']], [0x89, 0x50, 0x4e, 0x47]);
});

test('formatRuns: merges equal runs and keeps spaces outside markers', () => {
  assert.equal(formatRuns([{ text: 'Hello ', b: true }, { text: 'world', b: true }]), '**Hello world**');
  assert.equal(formatRuns([{ text: 'a' }, { text: ' bold ', b: true }, { text: 'c' }]), 'a **bold** c');
  assert.equal(formatRuns([{ text: 'x', b: true, i: true, h: true }]), '==***x***==');
  assert.equal(formatRuns([{ text: '   ', b: true }, { text: '', i: true }, { text: 'end' }]), '   end');
  assert.equal(formatRuns([{ text: 'Title', b: true }], true), 'Title');
});

const W = (body) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`;
const p = (runs, pPr = '') => `<w:p w:rsidR="00A1">${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${runs}</w:p>`;
const r = (text, rPr = '') => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const style = (s) => `<w:pStyle w:val="${s}"/>`;

const DOC = W([
  p(r('My Show'), style('Title')),
  p(r('Part ', '<w:b/>') + r('one'), style('Heading2')),
  p(r('Hello ') + r('bold ', '<w:b/>') + r('text', '<w:b w:val="true"/>') + r(' and ') + r('italic', '<w:i/>') + r(', ') + r('marked', '<w:highlight w:val="yellow"/>') + r(' plain', '<w:b w:val="0"/>')),
  '<w:p/>',
  p(r('   ')),
  p('<w:r><w:t>Line one</w:t><w:br/><w:t>line two</w:t><w:tab/><w:t>&amp; &lt;tag&gt; &quot;q&quot; &#x263A; &#65; &unknown;</w:t></w:r>'),
  p(r('Bullet point'), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'),
  p(r('Deutsch'), style('berschrift1')),
  p(r('Outline'), '<w:outlineLvl w:val="2"/>'),
  p(r('Deep'), style('Heading5')),
  p(r('shaded', '<w:shd w:val="clear" w:color="auto" w:fill="FFFF00"/>') + r(' white', '<w:shd w:val="clear" w:color="auto" w:fill="FFFFFF"/>') + r(' none', '<w:highlight w:val="none"/>')),
].join(''));

const EXPECTED = [
  '# My Show',
  '## Part one',
  'Hello **bold text** and *italic*, ==marked== plain',
  'Line one\nline two & <tag> "q" ☺ A &unknown;', // Tab → Leerzeichen, unbekannte Entität bleibt
  '– Bullet point',
  '# Deutsch',
  '### Outline',
  '### Deep',
  '==shaded== white none',
].join('\n\n');

test('docxXmlToScript: headings, formatting, breaks, entities and bullets', () => {
  assert.equal(docxXmlToScript(DOC), EXPECTED);
  assert.equal(docxXmlToScript(W('')), '');
});

test('docxToScript: a .docx built with zip.js converts end to end', async () => {
  const docx = zip([
    { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>') },
    { name: 'word/document.xml', data: Buffer.from(DOC) },
  ]);
  assert.equal(await docxToScript(docx, inflate), EXPECTED);
});

test('zip: string data is sized in bytes, not characters', () => {
  const e = readZip(zip([{ name: 'a.txt', data: 'Grüße ✓' }]))[0];
  const bytes = Buffer.from('Grüße ✓');
  assert.equal(e.usize, bytes.length);
  assert.equal(e.crc, zlib.crc32(bytes) >>> 0);
});
