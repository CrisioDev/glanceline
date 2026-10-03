'use strict';
// Erzeugt die PNG-Bilder des Stream-Deck-Plugins aus den SVG-Symbolen des Plugins.
// Aufruf: npx electron tools/make-streamdeck-assets.js
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PLUGIN = path.join(ROOT, 'integrations', 'streamdeck', 'io.github.crisiodev.glanceline.sdPlugin');
const IMGS = path.join(PLUGIN, 'imgs');
const { ICONS, keyImage } = require(path.join(PLUGIN, 'bin', 'plugin.js'));

// Symbol in Hellgrau auf transparentem Grund (Aktionsliste, Kategorie)
const glyph = (icon, color = '#ffffff') =>
  `data:image/svg+xml;base64,${Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 26 26"><g fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon]}</g></svg>`,
  ).toString('base64')}`;

async function renderPng(win, src, size) {
  await win.loadURL(`data:text/html,${encodeURIComponent(`<html><body style="margin:0;background:transparent"><img src="${src}" style="width:${size}px;height:${size}px;display:block"></body></html>`)}`);
  await new Promise((r) => setTimeout(r, 120));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  return img.resize({ width: size, height: size }).toPNG();
}

app.whenReady().then(async () => {
  fs.mkdirSync(IMGS, { recursive: true });
  const win = new BrowserWindow({ width: 160, height: 160, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  win.webContents.setFrameRate(10);
  const out = (name, buf) => {
    fs.writeFileSync(path.join(IMGS, name), buf);
    console.log('  ', name);
  };

  const actions = { mode: 'script', play: 'play', scroll: 'down', timer: 'timer', blackout: 'blackout', any: 'any', speed: 'speed' };
  for (const [name, icon] of Object.entries(actions)) {
    out(`action-${name}.png`, await renderPng(win, glyph(icon), 20));
    out(`action-${name}@2x.png`, await renderPng(win, glyph(icon), 40));
  }
  out('category.png', await renderPng(win, glyph('script'), 28));
  out('category@2x.png', await renderPng(win, glyph('script'), 56));
  // Standardbild einer Taste, bevor das Plugin den Live-Zustand zeichnet
  out('key.png', await renderPng(win, keyImage({ icon: 'script', label: 'Glanceline' }), 72));
  out('key@2x.png', await renderPng(win, keyImage({ icon: 'script', label: 'Glanceline' }), 144));
  // Plugin-Symbol = App-Symbol
  const appIcon = nativeImage.createFromPath(path.join(ROOT, 'assets', 'icon.png'));
  out('plugin.png', appIcon.resize({ width: 144, height: 144, quality: 'best' }).toPNG());
  out('plugin@2x.png', appIcon.resize({ width: 256, height: 256, quality: 'best' }).toPNG());
  // Symbole der Google-Slides-Erweiterung
  const ext = path.join(ROOT, 'integrations', 'chrome-slides', 'icons');
  fs.mkdirSync(ext, { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    fs.writeFileSync(path.join(ext, `${size}.png`), appIcon.resize({ width: size, height: size, quality: 'best' }).toPNG());
    console.log(`   chrome-slides/icons/${size}.png`);
  }
  app.quit();
});
