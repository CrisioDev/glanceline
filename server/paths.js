'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

// Benutzerdaten (Einstellungen, Skripte) liegen im üblichen App-Datenordner –
// nie im Programmordner, der bei einer Installation schreibgeschützt ist.
// Überschreibbar mit der Umgebungsvariable GLANCELINE_DATA.
function dataDir() {
  if (process.env.GLANCELINE_DATA) return path.resolve(process.env.GLANCELINE_DATA);
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Glanceline');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Glanceline');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Glanceline');
}

// Daten früherer Versionen einmalig übernehmen:
// – „Souffleur“ (alter Projektname) in %APPDATA%Souffleur bzw. dem jeweiligen Plattform-Ordner
// – ganz frühe Entwicklerversionen in ./data im Projektordner
function legacyDirs() {
  const appData = path.dirname(dataDir());
  return [path.join(appData, 'Souffleur'), path.join(__dirname, '..', 'data')];
}

function migrateLegacyData(dir) {
  if (fs.existsSync(path.join(dir, 'settings.json'))) return false;
  const legacy = legacyDirs().find((d) => path.resolve(d) !== path.resolve(dir) && fs.existsSync(path.join(d, 'settings.json')));
  if (!legacy) return false;
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['settings.json', 'scripts.json']) {
    const src = path.join(legacy, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, f));
  }
  // Sprachmodelle (~70 MB je Sprache) verschieben statt neu laden
  const models = path.join(legacy, 'models');
  if (fs.existsSync(models) && !fs.existsSync(path.join(dir, 'models'))) {
    try {
      fs.renameSync(models, path.join(dir, 'models'));
    } catch {
      fs.cpSync(models, path.join(dir, 'models'), { recursive: true });
    }
  }
  // Projektordner-Variante als Sicherung umbenennen, damit sie nicht erneut übernommen wird
  if (path.basename(legacy) === 'data') {
    try { fs.renameSync(legacy, `${legacy}.migrated`); } catch { /* z. B. schreibgeschützt */ }
  }
  return true;
}

module.exports = { dataDir, migrateLegacyData };
