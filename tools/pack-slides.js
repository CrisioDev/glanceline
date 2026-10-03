'use strict';
// Packt die Google-Slides-Erweiterung als ZIP für den Chrome Web Store (dist/glanceline-google-slides.zip).
// Aufruf: npm run pack:slides
const fs = require('fs');
const path = require('path');
const { zip } = require('../server/zip');

const ROOT = path.join(__dirname, '..');
const src = path.join(ROOT, 'integrations', 'chrome-slides');
const entries = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name !== 'README.md') entries.push({ name: path.relative(src, p).split(path.sep).join('/'), data: fs.readFileSync(p) });
  }
};
walk(src);
const out = path.join(ROOT, 'dist', 'glanceline-google-slides.zip');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, zip(entries));
console.log(`${path.relative(ROOT, out)} (${entries.length} Dateien, ${fs.statSync(out).size} Bytes)`);
