'use strict';
// Erzeugt assets/icon.png, assets/icon.ico und public/icon.png – ohne Abhängigkeiten.
// Motiv: weinrotes Pergament-Siegel mit drei Textzeilen und goldenem Lesezeilen-Pfeil.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');

function png(size, rgba) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // Bit-Tiefe
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Abstandsfunktionen auf einer 256er-Einheitsfläche
const sdRoundRect = (x, y, cx, cy, hw, hh, r) => {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const sdTriangle = (x, y) => {
  // Pfeil nach rechts: Spitze (74,128), Basis x=46 von y=110..146
  const edges = [
    [46, 110, 74, 128],
    [74, 128, 46, 146],
    [46, 146, 46, 110],
  ];
  let inside = true;
  let d = Infinity;
  for (const [x1, y1, x2, y2] of edges) {
    const ex = x2 - x1;
    const ey = y2 - y1;
    const t = Math.max(0, Math.min(1, ((x - x1) * ex + (y - y1) * ey) / (ex * ex + ey * ey)));
    d = Math.min(d, Math.hypot(x - (x1 + ex * t), y - (y1 + ey * t)));
    if (ex * (y - y1) - ey * (x - x1) < 0) inside = false;
  }
  return inside ? -d : d;
};

let square = false; // vollflächig für Handy-Startbildschirm (iOS/Android maskieren selbst)
const LAYERS = [
  { color: [139, 58, 58], sd: (x, y) => (square ? -1 : sdRoundRect(x, y, 128, 128, 120, 120, 54)) },
  { color: [244, 237, 228], sd: (x, y) => sdRoundRect(x, y, 140, 92, 58, 10, 10) },
  { color: [244, 237, 228], sd: (x, y) => sdRoundRect(x, y, 152, 128, 70, 12, 12) },
  { color: [244, 237, 228], sd: (x, y) => sdRoundRect(x, y, 128, 164, 46, 10, 10) },
  { color: [232, 163, 61], sd: (x, y) => sdTriangle(x, y) - 2 },
];

function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  const ss = 4; // Supersampling für saubere Kanten
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = ((px + (sx + 0.5) / ss) / size) * 256;
          const y = ((py + (sy + 0.5) / ss) / size) * 256;
          let cr = 0;
          let cg = 0;
          let cb = 0;
          let ca = 0;
          for (const layer of LAYERS) {
            if (layer.sd(x, y) <= 0) {
              [cr, cg, cb] = layer.color;
              ca = 1;
            }
          }
          r += cr * ca;
          g += cg * ca;
          b += cb * ca;
          a += ca;
        }
      }
      const i = (py * size + px) * 4;
      const n = ss * ss;
      buf[i] = a ? Math.round(r / a) : 0;
      buf[i + 1] = a ? Math.round(g / a) : 0;
      buf[i + 2] = a ? Math.round(b / a) : 0;
      buf[i + 3] = Math.round((a / n) * 255);
    }
  }
  return png(size, buf);
}

function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir[o] = size >= 256 ? 0 : size;
    dir[o + 1] = size >= 256 ? 0 : size;
    dir.writeUInt16LE(1, o + 4); // Farbebenen
    dir.writeUInt16LE(32, o + 6); // Bit pro Pixel
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.data)]);
}

const big = render(256);
fs.mkdirSync(path.join(ROOT, 'assets'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'assets', 'icon.png'), big);
fs.writeFileSync(path.join(ROOT, 'public', 'icon.png'), render(128));
fs.writeFileSync(path.join(ROOT, 'assets', 'icon.ico'), ico([16, 24, 32, 48, 64, 256].map((size) => ({ size, data: size === 256 ? big : render(size) }))));
square = true;
fs.writeFileSync(path.join(ROOT, 'public', 'icon-180.png'), render(180));
fs.writeFileSync(path.join(ROOT, 'public', 'icon-192.png'), render(192));
fs.writeFileSync(path.join(ROOT, 'public', 'icon-512.png'), render(512));
// macOS-App-Symbol (electron-builder braucht mindestens 512 px)
fs.writeFileSync(path.join(ROOT, 'assets', 'icon-1024.png'), render(1024));
console.log('Icons erzeugt: assets/icon.png, assets/icon.ico, public/icon*.png');
