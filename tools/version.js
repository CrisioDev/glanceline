'use strict';
// Eine Versionsnummer für alles: package.json ist die Quelle, Stream-Deck-Plugin und Chrome-Erweiterung folgen.
// Aufrufe:
//   node tools/version.js sync          Manifeste an package.json angleichen (läuft automatisch bei `npm version`)
//   node tools/version.js check [tag]   Abweichungen melden; mit Tag (v1.2.3) auch den prüfen
//   node tools/version.js notes [ver]   Abschnitt dieser Version aus CHANGELOG.md ausgeben (für die Release-Notizen)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// Frisch lesen: bei `npm version` hat npm package.json gerade erst geändert
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');
const MANIFESTS = {
  streamdeck: path.join(ROOT, 'integrations', 'streamdeck', 'io.github.crisiodev.glanceline.sdPlugin', 'manifest.json'),
  chrome: path.join(ROOT, 'integrations', 'chrome-slides', 'manifest.json'),
};

// Chrome und Stream Deck kennen nur Ziffern: 1.2.3-beta.1 → 1.2.3
const core = (v) => /^(\d+)\.(\d+)\.(\d+)/.exec(v).slice(1, 4).join('.');
const wanted = {
  streamdeck: { key: 'Version', value: `${core(PKG.version)}.0` },
  chrome: { key: 'version', value: core(PKG.version) },
};

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

function sync() {
  for (const [name, file] of Object.entries(MANIFESTS)) {
    const { key, value } = wanted[name];
    const text = fs.readFileSync(file, 'utf8');
    // Nur den Wert ersetzen, Formatierung der Datei bleibt
    const next = text.replace(new RegExp(`("${key}"\\s*:\\s*)"[^"]*"`), `$1"${value}"`);
    if (next !== text) fs.writeFileSync(file, next);
    console.log(`${path.relative(ROOT, file)}: ${value}`);
  }
  // „## [Unreleased]“ wird zum Abschnitt der neuen Version, darüber ein leerer für die nächste
  if (!notes(PKG.version)) {
    const text = fs.readFileSync(CHANGELOG, 'utf8');
    const date = new Date().toISOString().slice(0, 10);
    const next = text.replace(/^## \[Unreleased\][^\n]*\n/m, `## [Unreleased]\n\n## [${PKG.version}] – ${date}\n`);
    if (next === text || !notes(PKG.version, next)) {
      console.error('CHANGELOG.md: no “## [Unreleased]” section with entries to release');
      process.exit(1);
    }
    fs.writeFileSync(CHANGELOG, next);
    console.log(`CHANGELOG.md: ${PKG.version} – ${date}`);
  }
}

function check(tag) {
  const errors = [];
  for (const [name, file] of Object.entries(MANIFESTS)) {
    const { key, value } = wanted[name];
    const have = readJson(file)[key];
    if (have !== value) errors.push(`${path.relative(ROOT, file)}: ${key} is ${have}, expected ${value} (run: node tools/version.js sync)`);
  }
  if (tag && tag.replace(/^refs\/tags\//, '') !== `v${PKG.version}`) errors.push(`tag ${tag} does not match package.json version ${PKG.version}`);
  if (tag && !notes(PKG.version)) errors.push(`CHANGELOG.md has no section for ${PKG.version}`);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  console.log(`version ${PKG.version} consistent${tag ? `, tag ${tag} OK` : ''}`);
}

// „## [1.2.3] – 2026-10-05“ bis zur nächsten „## “-Überschrift
function notes(version, text = fs.readFileSync(CHANGELOG, 'utf8')) {
  const esc = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`^## \\[?${esc}\\]?[^\\n]*\\n([\\s\\S]*?)(?=^## |^\\[[^\\]]+\\]:|(?![\\s\\S]))`, 'm').exec(text);
  return m ? m[1].trim() : '';
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'sync') sync();
else if (cmd === 'check') check(arg);
else if (cmd === 'notes') {
  const n = notes(arg || PKG.version);
  if (!n) {
    console.error(`CHANGELOG.md has no section for ${arg || PKG.version}`);
    process.exit(1);
  }
  process.stdout.write(`${n}\n`);
} else {
  console.error('usage: node tools/version.js sync | check [tag] | notes [version]');
  process.exit(2);
}
