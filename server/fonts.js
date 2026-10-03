'use strict';
// Installierte Systemschriften (Windows) – für die Schriftauswahl des Prompters.
const { execFile } = require('child_process');

let cache = null;

function systemFonts() {
  if (cache) return cache;
  if (process.platform !== 'win32') {
    cache = Promise.resolve([]);
    return cache;
  }
  const ps = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }";
  cache = new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 20000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
      if (err) {
        cache = null; // beim nächsten Mal erneut versuchen
        resolve([]);
        return;
      }
      const names = [...new Set(String(out).split(/\r?\n/).map((s) => s.trim()).filter(Boolean))];
      resolve(names.sort((a, b) => a.localeCompare(b)));
    });
  });
  return cache;
}

module.exports = { systemFonts };
