'use strict';
// Rauchtest: Glanceline starten, Panel und Prompter durchklicken, Screenshots speichern, Konsole auf Fehler prüfen.
// Aufrufe:
//   node tools/smoke.js                       aus dem Quellcode (npx electron .)
//   node tools/smoke.js <Pfad zur App>        gebaute App, z. B. dist/win-unpacked/Glanceline.exe
//                                             oder dist/mac-arm64/Glanceline.app
// Ergebnisse landen in SMOKE_DIR (Standard: <tmp>/glanceline-smoke).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.resolve(process.env.SMOKE_DIR || path.join(os.tmpdir(), 'glanceline-smoke'));
const DATA = path.join(OUT, 'data');
const SNAP = path.join(OUT, 'snap');
const STEPS = 'wait3000,chat:demo,wait3000,mode:chat,mode:script,script:play,wait1500,mode:obs,mode:ppt,tab:live,tab:scripts,tab:settings,live:end';
const TIMEOUT_MS = 120000;

function command() {
  const target = process.argv[2];
  if (!target) return { cmd: require('electron'), args: [ROOT] };
  const p = path.resolve(target);
  if (p.endsWith('.app')) return { cmd: path.join(p, 'Contents', 'MacOS', path.basename(p, '.app')), args: [] };
  return { cmd: p, args: [] };
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify({ general: { setupDone: true, language: 'en' } }));

const { cmd, args } = command();
console.log(`> ${cmd} ${args.join(' ')}`);
const child = spawn(cmd, [...args, '--snapshot', SNAP, '--snapshot-steps', STEPS], {
  env: { ...process.env, GLANCELINE_DATA: DATA, GLANCELINE_NO_MIC: '1', GLANCELINE_TEST: '1' },
  stdio: 'inherit',
});
const timer = setTimeout(() => {
  console.error(`✗ no exit after ${TIMEOUT_MS / 1000} s`);
  child.kill();
  process.exit(1);
}, TIMEOUT_MS);

child.on('exit', (code) => {
  clearTimeout(timer);
  const fail = (msg) => {
    console.error(`✗ ${msg}`);
    process.exit(1);
  };
  if (code !== 0) fail(`app exited with code ${code}`);
  const file = (f) => path.join(SNAP, f);
  for (const f of ['panel-live.png', 'panel-settings.png', 'prompter-mode-chat.png', 'prompter-mode-script.png', 'live-end.json', 'console.log']) {
    if (!fs.existsSync(file(f))) fail(`missing ${f}`);
  }
  // Fehler in Panel oder Prompter (auch CSP-Verstöße) lassen den Test scheitern
  const errors = fs.readFileSync(file('console.log'), 'utf8').split('\n').filter((l) => /error|refused|violat/i.test(l));
  if (errors.length) fail(`console errors:\n${errors.join('\n')}`);
  const live = JSON.parse(fs.readFileSync(file('live-end.json'), 'utf8')).live;
  if (!live.prompter || live.prompter.kind === 'none') fail('no prompter window');
  const log = path.join(DATA, 'logs', 'glanceline.log');
  if (!fs.existsSync(log)) fail('no log file written');
  console.log(`✓ smoke test passed (prompter: ${live.prompter.kind}, screenshots in ${SNAP})`);
});
