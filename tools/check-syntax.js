'use strict';
// Syntaxprüfung aller eigenen JavaScript-Dateien (node --check), läuft unter Windows und macOS.
// Aufruf: node tools/check-syntax.js
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', 'dist', '.git', 'data', 'data.migrated']);
const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) files.push(p);
  }
};
walk(ROOT);

let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed++;
    console.error(`✗ ${path.relative(ROOT, f)}\n${r.stderr}`);
  }
}
console.log(`${files.length - failed}/${files.length} files OK`);
if (failed) process.exit(1);
