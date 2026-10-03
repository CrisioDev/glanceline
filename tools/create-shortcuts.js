'use strict';
// Legt „Glanceline“ auf dem Desktop und im Startmenü an (Start: npm run shortcut).
// Läuft unter Electron, damit die Verknüpfung die AppUserModelID bekommt –
// so gruppiert Windows die Fenster korrekt und ein Taskleisten-Pin startet Glanceline.
const { app, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP_ID = require('../package.json').appUserModelId || 'glanceline';

app.whenReady().then(() => {
  const targets = [
    path.join(app.getPath('desktop'), 'Glanceline.lnk'),
    path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Glanceline.lnk'),
  ];
  let failed = false;
  for (const lnk of targets) {
    fs.mkdirSync(path.dirname(lnk), { recursive: true });
    const ok = shell.writeShortcutLink(lnk, 'create', {
      target: process.execPath,
      args: `"${ROOT}"`,
      cwd: ROOT,
      description: 'Glanceline – Prompter-Software für den Elgato Prompter',
      icon: path.join(ROOT, 'assets', 'icon.ico'),
      iconIndex: 0,
      appUserModelId: APP_ID,
    });
    console.log(`${ok ? 'Erstellt' : 'FEHLER'}: ${lnk}`);
    if (!ok) failed = true;
  }
  app.exit(failed ? 1 : 0);
});
