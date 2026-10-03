'use strict';
// Prüft, ob alle verwendeten Übersetzungsschlüssel in jeder Sprache vorhanden sind.
// Aufruf: node tools/check-i18n.js
const fs = require('fs');
const path = require('path');
const { STRINGS } = require('../public/i18n');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const used = new Map(); // Schlüssel → Fundstelle
const add = (key, where) => { if (!used.has(key)) used.set(key, where); };

for (const f of ['public/panel.html', 'public/prompter.html']) {
  const s = read(f);
  for (const m of s.matchAll(/data-i18n(?:-title|-placeholder|-aria)?="([^"]+)"/g)) add(m[1], f);
  for (const m of s.matchAll(/data-i18n-attr="([^"]+)"/g)) for (const p of m[1].split(';')) add(p.split(':')[1], f);
}
const KEY = /^[a-z][a-zA-Z]*\.[\w.:-]+$/;
for (const f of ['public/panel.js', 'public/prompter.js', 'main.js', ...fs.readdirSync(path.join(ROOT, 'server')).filter((x) => x.endsWith('.js')).map((x) => `server/${x}`)]) {
  const s = read(f);
  for (const m of s.matchAll(/\bt\(\s*'([^']+)'/g)) add(m[1], f);
  for (const m of s.matchAll(/\b(?:l|h|lead|key|title|error):\s*'([^']+)'/g)) if (KEY.test(m[1])) add(m[1], f);
  for (const m of s.matchAll(/'((?:err|ev)\.[\w.]+)'/g)) add(m[1], f);
}
// Dynamisch zusammengesetzte Schlüssel
const panel = read('public/panel.js');
const actions = /const ACTIONS = \[([\s\S]*?)\];/.exec(panel)[1].match(/'([^']+)'/g).map((x) => x.slice(1, -1));
actions.forEach((a) => add(`action.${a}`, 'panel.js ACTIONS'));
['taken', 'invalid', 'duplicate'].forEach((e) => add(`hk.err.${e}`, 'main.js hotkeys'));
['ffzGlobal', 'bttvGlobal', 'stvGlobal', 'ffzChannel', 'bttvChannel', 'stvChannel'].forEach((s) => add(`src.${s}`, 'emotes.js'));
['de', 'en', 'fr', 'es'].forEach((l) => add(`lang.${l}`, 'panel.js VOICE_LANGS'));
add('voice.err.download', 'voice.js');
['forward', 'back', 'toggle'].forEach((c) => add(`clicker.${c}`, 'panel.js clicker'));
['p.noScript', 'p.emptyScript', 'p.chatNew'].forEach((k) => add(k, 'prompter.js'));
add('err.cam.obs', 'prompter.js');
['show.autoScript', 'show.autoStream', 'show.manual'].forEach((k) => add(k, 'panel.js renderShow'));

let problems = 0;
for (const [lang, dict] of Object.entries(STRINGS)) {
  for (const [key, where] of used) {
    if (!KEY.test(key)) continue; // z. B. 'PowerPoint' als fester Titel
    if (dict[key] == null) { console.log(`[${lang}] fehlt: ${key}  (${where})`); problems++; }
  }
}
const langs = Object.keys(STRINGS);
for (const a of langs) for (const b of langs) {
  if (a === b) continue;
  for (const key of Object.keys(STRINGS[a])) if (STRINGS[b][key] == null) { console.log(`[${b}] fehlt (gegenüber ${a}): ${key}`); problems++; }
}
const unused = Object.keys(STRINGS.en).filter((k) => !used.has(k) && !k.endsWith('.one'));
console.log(`${used.size} verwendete Schlüssel, ${Object.keys(STRINGS.en).length} im Wörterbuch, ${problems} Probleme${unused.length ? `, unbenutzt: ${unused.join(', ')}` : ''}`);
process.exitCode = problems ? 1 : 0;
