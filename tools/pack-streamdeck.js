'use strict';
// Packt das Stream-Deck-Plugin als dist/Glanceline.streamDeckPlugin (Doppelklick installiert es).
// Aufruf: npm run pack:streamdeck
const fs = require('fs');
const path = require('path');
const { zipFolder } = require('../server/zip');

const ROOT = path.join(__dirname, '..');
const src = path.join(ROOT, 'integrations', 'streamdeck', 'io.github.crisiodev.glanceline.sdPlugin');
const out = path.join(ROOT, 'dist', 'Glanceline.streamDeckPlugin');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, zipFolder(src));
console.log(`${path.relative(ROOT, out)} (${fs.statSync(out).size} Bytes)`);
