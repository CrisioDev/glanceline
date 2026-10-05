'use strict';
// Glanceline – Electron-Hauptprozess
// Startet den internen Server, legt die Prompter-Ansicht randlos auf den Elgato Prompter,
// registriert die globalen Hotkeys und hängt sich in den Infobereich (Tray).
const { app, BrowserWindow, Menu, Tray, dialog, globalShortcut, nativeImage, screen, session, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const util = require('util');
const { execFile } = require('child_process');
const path = require('path');
const { Glanceline } = require('./server');
const { migrateLegacyData } = require('./server/paths');
const { resolveLang, translator } = require('./public/i18n');

// Eine Stelle für die App-ID (Taskleiste, Verknüpfungen, Installer): package.json → build.appId
const APP_ID = require('./package.json').appUserModelId || 'glanceline'; // muss build.appId entsprechen
const t = (key, vars) => translator(resolveLang(core ? core.settings.general.language : 'auto'))(key, vars);

const ICON_PNG = path.join(__dirname, 'assets', 'icon.png');
const ICON_ICO = path.join(__dirname, 'assets', 'icon.ico');
const WINDOW_ICON = process.platform === 'win32' && fs.existsSync(ICON_ICO) ? ICON_ICO : ICON_PNG;

const argValue = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};
// Nur zum Testen: Screenshots speichern und beenden. In der installierten App nur mit GLANCELINE_TEST=1 (Rauchtest in CI)
const SNAPSHOT_DIR = !app.isPackaged || process.env.GLANCELINE_TEST === '1' ? argValue('--snapshot') : null;

let core = null;
let prompterWin = null;
let prompterKind = null; // 'prompter' | 'test' | null
let prompterScale = 1; // Windows-Skalierung des Ziel-Bildschirms
let panelWin = null;
let tray = null;
let quitting = false;
let hotkeysSuspended = false;
const ALLOWED_PERMISSIONS = new Set(['media', 'midi', 'midiSysex']);

app.setAppUserModelId(APP_ID);
// Testläufe mit eigenem Profil, damit sie eine laufende Glanceline nicht über die Einzelinstanz-Sperre wecken
if (SNAPSHOT_DIR && process.env.GLANCELINE_DATA) app.setPath('userData', path.join(path.resolve(process.env.GLANCELINE_DATA), 'chromium'));

// Ein Fehler im Hauptprozess soll keinen Fehlerdialog mitten in den Stream legen – protokollieren reicht
process.on('uncaughtException', (err) => console.error('[uncaught]', err));
process.on('unhandledRejection', (err) => console.error('[unhandled]', err));

// Eigene Seiten: der interne Server (127.0.0.1, localhost, out-<id>.localhost) auf seinem aktuellen Port
function isOwn(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && /^(127\.0\.0\.1|([a-z0-9-]+\.)?localhost)$/.test(u.hostname) && Boolean(core) && Number(u.port) === core.port;
  } catch {
    return false;
  }
}

// Nur Webseiten im Standardbrowser öffnen – nie Dateien oder fremde Protokolle
function openExternalSafe(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:') shell.openExternal(u.href);
  } catch { /* ungültig */ }
}

app.on('web-contents-created', (_e, wc) => {
  // Fenster zeigen nur Glanceline; fremde Links gehen in den Browser
  wc.on('will-navigate', (e, url) => {
    if (isOwn(url) || url.startsWith('blob:')) return;
    e.preventDefault();
    openExternalSafe(url);
  });
  // Abgestürzte Seite (z. B. Prompter mitten im Stream) neu laden – höchstens 3× pro Minute
  const crashes = [];
  wc.on('render-process-gone', (_ev, d) => {
    console.error('[renderer]', d.reason, d.exitCode, wc.isDestroyed() ? '' : wc.getURL());
    if (d.reason === 'clean-exit' || quitting) return;
    const now = Date.now();
    crashes.push(now);
    while (crashes.length && now - crashes[0] > 60000) crashes.shift();
    if (crashes.length <= 3) setTimeout(() => !wc.isDestroyed() && wc.reload(), 1000);
  });
  wc.on('unresponsive', () => console.warn('[renderer] unresponsive', wc.getURL()));
});
app.on('child-process-gone', (_e, d) => console.error('[child]', d.type, d.reason, d.exitCode));

// ---------------------------------------------------------------- Protokoll
// <Daten>/logs/glanceline.log – bleibt lokal, hilft bei Fehlerberichten. Ab 1 MB beim Start rotiert.
const LOG_LIMIT = 5 * 1024 * 1024; // pro Sitzung höchstens so viel schreiben
function setupLog(dir) {
  try {
    const logDir = path.join(dir, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const file = path.join(logDir, 'glanceline.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, path.join(logDir, 'glanceline.old.log'));
    const out = fs.createWriteStream(file, { flags: 'a' });
    out.on('error', () => {});
    let written = 0;
    for (const level of ['log', 'warn', 'error']) {
      const orig = console[level].bind(console);
      console[level] = (...args) => {
        orig(...args);
        if (written > LOG_LIMIT) return;
        const line = `${new Date().toISOString()} ${level.toUpperCase()} ${util.format(...args)}\n`;
        written += line.length;
        out.write(line);
      };
    }
    console.log(`[glanceline] ${app.getVersion()} · Electron ${process.versions.electron} · ${process.platform} ${os.release()} ${process.arch}`);
  } catch (e) {
    console.error('[log]', e.message);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showPanel());
  app.whenReady().then(boot).catch((err) => {
    console.error(err);
    app.exit(1);
  });
}

// Fenster schließen ≠ beenden: Glanceline läuft im Tray weiter
app.on('window-all-closed', () => {});
let powerQuitDone = false;
app.on('before-quit', (e) => {
  quitting = true;
  // „Nur solange Glanceline läuft“: Prompter beim Beenden abmelden, dann wirklich beenden
  if (core && core.settings.display.powerWithApp && prompterKind === 'prompter' && !powerQuitDone && !SNAPSHOT_DIR) {
    e.preventDefault();
    powerQuitDone = true;
    prompterPower(false).finally(() => app.quit());
  }
});
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (core) core.stop();
});

async function boot() {
  // macOS braucht ein App-Menü, sonst gehen Kopieren/Einfügen (Cmd+C/V) und Beenden (Cmd+Q) nicht
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
  if (process.platform === 'darwin') app.on('activate', () => showPanel());
  const dir = process.env.GLANCELINE_DATA ? path.resolve(process.env.GLANCELINE_DATA) : app.getPath('userData');
  setupLog(dir);
  if (migrateLegacyData(dir)) console.log(`[glanceline] settings migrated to ${dir}`);
  core = new Glanceline({ dataDir: dir });
  await core.start();

  // Kamera nur für die eigene, lokale Oberfläche freigeben
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    // Kamera/Mikrofon und MIDI-Controller nur für die eigenen Seiten. Chromium fragt auch für MIDI ohne
    // SysEx inzwischen „midiSysex“ an; die Seite selbst fordert kein SysEx an.
    callback(ALLOWED_PERMISSIONS.has(permission) && isOwn(details.requestingUrl || wc.getURL()));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin) => ALLOWED_PERMISSIONS.has(permission) && isOwn(origin));

  core.on('autostart', () => {
    applyAutostart();
    updateTrayMenu();
  });
  core.on('hotkeys', registerHotkeys);
  core.on('prompterPower', (on) => prompterPower(on));
  // Skript-Ordner wählen und Dateien/Ordner im Explorer bzw. Standard-Editor öffnen
  core.on('pickFolder', async () => {
    const parent = panelWin && !panelWin.isDestroyed() ? panelWin : undefined;
    const r = await dialog.showOpenDialog(parent, { title: t('library.pickTitle'), properties: ['openDirectory'], defaultPath: core.settings.library.folder || app.getPath('documents') });
    if (!r.canceled && r.filePaths[0]) core.patchSettings({ library: { folder: r.filePaths[0] } });
  });
  // Twitch-Anmeldung: nur die Bestätigungsseite von Twitch öffnen
  core.on('openExternal', (url) => {
    if (/^https:\/\/(www\.)?twitch\.tv\/activate/.test(url)) shell.openExternal(url);
  });
  core.on('openPath', (p) => {
    shell.openPath(p).then((err) => err && console.warn('[open]', err));
  });
  // Clicker-Tasten gelten nur im Skript-Modus – bei jedem Moduswechsel neu belegen
  core.on('mode', () => {
    if (core.settings.clicker.enabled) registerHotkeys();
    updateTrayMenu();
  });
  core.on('passthrough', (on) => {
    if (prompterWin && !prompterWin.isDestroyed()) {
      if (on) prompterWin.hide();
      else if (prompterKind === 'prompter') prompterWin.showInactive();
      else prompterWin.show();
    }
    if (core.settings.clicker.enabled) registerHotkeys(); // Clicker-Tasten freigeben bzw. wieder belegen
    updateTrayMenu();
  });
  core.on('language', () => {
    updateTrayMenu();
    if (tray) tray.setToolTip(`${t('tray.tooltip')} ${app.getVersion()}`);
    if (prompterWin && prompterKind === 'test') prompterWin.setTitle(t('tray.testWindowTitle'));
  });
  core.on('hotkeys:suspend', (on) => {
    hotkeysSuspended = on;
    registerHotkeys();
  });
  core.on('display', placePrompter);
  core.on('outputs', syncOutputs);
  let lastBase = core.baseUrl();
  core.on('relisten', () => {
    // Nur bei geändertem Port neu laden – sonst verbinden sich die Seiten von selbst wieder
    if (core.baseUrl() === lastBase) return;
    lastBase = core.baseUrl();
    if (prompterWin) prompterWin.loadURL(prompterUrl());
    if (panelWin) panelWin.loadURL(core.baseUrl());
  });
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) {
    screen.on(ev, () => setTimeout(placePrompter, 400)); // Windows braucht kurz, bis die Geometrie stimmt
  }

  if (!SNAPSHOT_DIR) applyAutostart(); // frischt den Pfad auf, falls der Ordner verschoben wurde
  else core.setAppInfo({ desktop: true, autostart: readAutostart() });
  createTray();
  registerHotkeys();
  core.setPower({ standby: Boolean(core.settings.windowState.standby) });
  placePrompter();
  // Prompter wurde mit Glanceline abgemeldet → beim Start wieder anmelden
  if (core.settings.display.powerWithApp && core.settings.windowState.standby && !SNAPSHOT_DIR) prompterPower(true);
  const openedHidden = process.argv.includes('--hidden') || (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAsHidden);
  if (!openedHidden) showPanel();
  if (SNAPSHOT_DIR) runSnapshot(SNAPSHOT_DIR);
}

// ---------------------------------------------------------------- Prompter-Fenster

// Echte Pixelgröße (DIP × Skalierung ergibt durch Rundung sonst z. B. 1025×601)
function physicalSize(d) {
  if (process.platform === 'win32') {
    const r = screen.dipToScreenRect(null, d.bounds);
    return { width: r.width, height: r.height };
  }
  return { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
}

function isPrompterDisplay(d) {
  if (/prom/i.test(d.label || '')) return true; // Windows meldet ihn als „Elgato Prom.“
  const { width, height } = physicalSize(d);
  return Math.abs(width - 1024) <= 2 && Math.abs(height - 600) <= 2;
}

function describeDisplay(d) {
  const primaryId = screen.getPrimaryDisplay().id;
  return {
    id: String(d.id),
    label: d.label || '',
    ...physicalSize(d),
    scale: d.scaleFactor,
    primary: d.id === primaryId,
    isPrompter: isPrompterDisplay(d),
  };
}

function findTarget() {
  const target = core.settings.display.target;
  const displays = screen.getAllDisplays();
  if (target && target !== 'auto') {
    const chosen = displays.find((d) => String(d.id) === String(target));
    if (chosen) return chosen;
  }
  return displays.find(isPrompterDisplay) || null;
}

// Eigener Host („localhost“ statt 127.0.0.1), weil Chromium den Zoom pro Host teilt –
// so bleibt das Panel samt Vorschau vom Prompter-Zoom unberührt.
// GLANCELINE_NO_MIC=1: nur für automatische Tests – der Prompter nimmt dann kein Mikrofon auf
const prompterUrl = (kind) => `${core.baseUrl().replace('127.0.0.1', 'localhost')}/prompter?role=main${kind === 'virtual' ? '&virtual=1' : ''}${process.env.GLANCELINE_NO_MIC ? '&nomic=1' : ''}`;

// Virtueller Prompter: gespeicherte Position, sofern noch auf einem Bildschirm sichtbar – sonst oben mittig unter der Webcam
function virtualBounds(reset) {
  const saved = core.settings.windowState.virtual;
  if (!reset && saved && Number.isFinite(saved.x) && Number.isFinite(saved.width)) {
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return saved.x < a.x + a.width - 40 && saved.x + saved.width > a.x + 40 && saved.y >= a.y - 10 && saved.y < a.y + a.height - 40;
    });
    if (visible) return { x: saved.x, y: saved.y, width: saved.width, height: saved.height };
  }
  const a = screen.getPrimaryDisplay().workArea;
  const width = Math.min(720, Math.round(a.width * 0.45));
  const height = Math.round(width * 0.42);
  return { x: Math.round(a.x + (a.width - width) / 2), y: a.y + 8, width, height };
}

// Bei 125 % Windows-Skalierung hätte die Seite nur 820×480 CSS-Pixel. Mit Zoom 1/Skalierung
// rendert sie immer in echten 1024×600 – identisch zur Vorschau im Panel.
function applyZoom() {
  if (prompterWin && !prompterWin.isDestroyed()) prompterWin.webContents.setZoomFactor(1 / prompterScale);
}

function createPrompterWindow(kind) {
  const common = {
    backgroundColor: '#000000',
    icon: WINDOW_ICON,
    show: false,
    // Mikrofon für die Sprachsteuerung ohne vorherigen Klick (das Fenster ist nicht fokussierbar)
    webPreferences: { backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
  };
  const win =
    kind === 'virtual'
      ? new BrowserWindow({
          ...common,
          ...virtualBounds(),
          frame: false,
          resizable: true,
          minWidth: 220,
          minHeight: 110,
          maximizable: false,
          minimizable: false,
          fullscreenable: false,
          skipTaskbar: true,
          alwaysOnTop: true,
          hasShadow: false,
          title: 'Glanceline',
        })
      : kind === 'prompter'
      ? new BrowserWindow({
          ...common,
          frame: false,
          resizable: false,
          movable: false,
          minimizable: false,
          maximizable: false,
          fullscreenable: false,
          skipTaskbar: true,
          focusable: false,
          alwaysOnTop: true,
          hasShadow: false,
        })
      : new BrowserWindow({
          ...common,
          width: Math.round(1024 / prompterScale),
          height: Math.round(600 / prompterScale),
          useContentSize: true,
          resizable: false,
          maximizable: false,
          title: t('tray.testWindowTitle'),
          autoHideMenuBar: true,
        });
  if (kind === 'test') setTaskbarDetails(win);
  if (kind === 'virtual') {
    // Für OBS, Zoom, Teams & Co. unsichtbar (Windows 10 2004+), schwebt über Videocalls
    win.setContentProtection(true);
    win.setAlwaysOnTop(true, 'floating');
    win.setOpacity(core.settings.display.virtualOpacity);
    let saveTimer = null;
    const save = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        if (!win.isDestroyed()) core.patchSettings({ windowState: { virtual: win.getBounds() } });
      }, 600);
    };
    win.on('moved', save);
    win.on('resized', save);
  }
  win.loadURL(prompterUrl(kind));
  win.webContents.on('did-finish-load', applyZoom);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.once('ready-to-show', () => {
    if (core.live.passthrough) return; // Durchreich-Modus: Fenster bleibt verborgen
    if (kind === 'prompter' || kind === 'virtual') win.showInactive();
    else win.show();
  });
  win.on('closed', () => {
    if (prompterWin === win) {
      prompterWin = null;
      prompterKind = null;
    }
  });
  return win;
}

// ---------------------------------------------------------------- Weitere Ausgaben
// Jede Ausgabe ist ein eigenes Fenster: randlos auf einem gewählten Bildschirm oder als normales Fenster.
// Eigener Host je Ausgabe (out-<id>.localhost), damit der Zoom nicht mit dem Prompter geteilt wird.
const outputWins = new Map();

function syncOutputs() {
  if (!core) return;
  const list = core.settings.outputs.filter((o) => o.enabled);
  for (const [id, win] of outputWins) {
    if (!list.some((o) => o.id === id)) {
      outputWins.delete(id);
      if (!win.isDestroyed()) win.destroy();
    }
  }
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay().id;
  const prompterBounds = prompterKind === 'prompter' && prompterWin && !prompterWin.isDestroyed() ? prompterWin.getBounds() : null;
  for (const o of list) {
    const d = displays.find((x) => String(x.id) === o.display);
    // Nie den Hauptbildschirm und nicht den Bildschirm des Haupt-Prompters zukleistern
    const usable = d && d.id !== primary && !(prompterBounds && prompterBounds.x === d.bounds.x && prompterBounds.y === d.bounds.y);
    const kind = usable ? 'screen' : 'window';
    let win = outputWins.get(o.id);
    if (win && (win.isDestroyed() || win.glKind !== kind)) {
      if (!win.isDestroyed()) win.destroy();
      win = null;
    }
    if (!win) {
      win = createOutputWindow(o, kind, usable ? d.scaleFactor : screen.getPrimaryDisplay().scaleFactor);
      outputWins.set(o.id, win);
    }
    if (kind === 'screen') {
      win.setBounds(d.bounds);
      win.setAlwaysOnTop(true, 'screen-saver');
    }
    win.setTitle(`Glanceline – ${o.name}`);
  }
}

function createOutputWindow(o, kind, scale) {
  const common = { backgroundColor: '#000000', icon: WINDOW_ICON, show: false, title: `Glanceline – ${o.name}`, webPreferences: { backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } };
  const win =
    kind === 'screen'
      ? new BrowserWindow({ ...common, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, focusable: false, alwaysOnTop: true, hasShadow: false })
      : new BrowserWindow({ ...common, width: Math.round(1024 / scale), height: Math.round(600 / scale), useContentSize: true, autoHideMenuBar: true });
  win.glKind = kind;
  if (kind === 'window') setTaskbarDetails(win);
  const url = core.baseUrl().replace('127.0.0.1', `out-${o.id}.localhost`);
  win.loadURL(`${url}/prompter?role=preview&output=${encodeURIComponent(o.id)}`);
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(1 / scale));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.once('ready-to-show', () => (kind === 'screen' ? win.showInactive() : win.show()));
  win.on('closed', () => {
    if (outputWins.get(o.id) !== win) return;
    outputWins.delete(o.id);
    // Fenster von Hand geschlossen → Ausgabe ausschalten statt sofort wieder öffnen
    if (!quitting && core) core.action({ type: 'output:update', id: o.id, patch: { enabled: false } });
  });
  return win;
}

// ---------------------------------------------------------------- Prompter aus/an (Standby)
// Das Prompter-Display wird in Windows abgemeldet („Diese Anzeige trennen“): Er geht aus und
// wacht auch nach dem Ruhezustand nicht von selbst auf. Der letzte Modus wird gespeichert.
const DISPLAY_POWER = path.join(__dirname, 'server', 'display-power.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

function displayPower(args) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ ok: false, error: 'Windows only' });
      return;
    }
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', DISPLAY_POWER, ...args.map(String)], { windowsHide: true, timeout: 20000 }, (err, stdout) => {
      try {
        resolve(JSON.parse(String(stdout).trim().split(/\r?\n/).pop()));
      } catch {
        resolve({ ok: false, error: err ? err.message : 'no answer' });
      }
    });
  });
}

async function prompterPower(want) {
  const saved = core.settings.windowState.standby;
  const isOff = Boolean(saved && saved.device);
  const turnOn = want === undefined ? isOff : want;
  if (turnOn === !isOff) return; // schon so
  core.setPower({ busy: true, error: '' });
  try {
    if (turnOn) {
      const r = await displayPower(['-cmd', 'on', '-device', saved.device, '-width', saved.width, '-height', saved.height, '-x', saved.x, '-y', saved.y, '-hz', saved.hz || 0]);
      if (!r.ok) throw new Error(r.error || `code ${r.code}`);
      core.patchSettings({ windowState: { standby: null } });
      core.setPower({ standby: false });
      setTimeout(placePrompter, 1500); // Windows braucht einen Moment, bis die Anzeige da ist
    } else {
      // Welches Windows-Display ist der Prompter? Über die echte Position zuordnen – nie den Hauptbildschirm.
      const target = core.settings.display.target === 'virtual' ? null : findTarget();
      if (!target || target.id === screen.getPrimaryDisplay().id) throw new Error('err.power.noPrompter');
      const rect = screen.dipToScreenRect(null, target.bounds);
      const list = await displayPower(['-cmd', 'list']);
      const d = list.ok && list.displays.find((x) => x.attached && !x.primary && Math.abs(x.x - rect.x) <= 2 && Math.abs(x.y - rect.y) <= 2);
      if (!d) throw new Error('err.power.notFound');
      core.patchSettings({ windowState: { standby: { device: d.device, width: d.width, height: d.height, x: d.x, y: d.y, hz: d.hz } } });
      core.setPower({ standby: true });
      const r = await displayPower(['-cmd', 'off', '-device', d.device, '-x', d.x, '-y', d.y]);
      if (!r.ok) {
        core.patchSettings({ windowState: { standby: null } });
        core.setPower({ standby: false });
        throw new Error(r.error || `code ${r.code}`);
      }
    }
  } catch (e) {
    core.setPower({ error: e.message.startsWith('err.') ? e.message : `err.power.failed|${e.message}` });
  } finally {
    core.setPower({ busy: false });
    updateTrayMenu();
  }
}

function placePrompter() {
  if (!core) return;
  const displays = screen.getAllDisplays();
  core.setDisplays(displays.map(describeDisplay));

  const virtual = core.settings.display.target === 'virtual';
  let target = virtual ? null : findTarget();
  // Nie den Hauptbildschirm randlos zukleistern
  if (target && target.id === screen.getPrimaryDisplay().id) target = null;
  // Abgemeldeter Prompter: kein Testfenster als Ersatz öffnen
  const standby = Boolean(core.settings.windowState.standby);
  const kind = virtual ? 'virtual' : target ? 'prompter' : core.settings.display.testWindow && !standby ? 'test' : null;
  const scale = (target || screen.getPrimaryDisplay()).scaleFactor || 1;

  if (kind !== prompterKind || (kind === 'test' && scale !== prompterScale)) {
    if (prompterWin) prompterWin.destroy();
    prompterWin = null;
    prompterKind = kind;
    prompterScale = scale;
    if (kind) prompterWin = createPrompterWindow(kind);
  }
  prompterScale = scale;
  if (kind === 'prompter') {
    prompterWin.setBounds(target.bounds);
    prompterWin.setAlwaysOnTop(true, 'screen-saver');
    if (prompterWin.isVisible() && !core.live.passthrough) prompterWin.showInactive();
  }
  if (kind === 'virtual') prompterWin.setOpacity(core.settings.display.virtualOpacity);
  applyZoom();
  core.setPrompterInfo({ kind: kind || 'none', display: target ? describeDisplay(target) : null });
  updateTrayMenu();
  syncOutputs();
}

// Taskleisten-Pin eines laufenden Fensters soll Glanceline starten, nicht das nackte electron.exe
function setTaskbarDetails(win) {
  if (process.platform !== 'win32') return;
  const relaunch = app.isPackaged ? `"${process.execPath}"` : `"${process.execPath}" "${app.getAppPath()}"`;
  win.setAppDetails({ appId: APP_ID, appIconPath: WINDOW_ICON, relaunchCommand: relaunch, relaunchDisplayName: 'Glanceline' });
}

// ---------------------------------------------------------------- Panel-Fenster

function showPanel() {
  if (!core) return;
  if (panelWin && !panelWin.isDestroyed()) {
    if (panelWin.isMinimized()) panelWin.restore();
    panelWin.show();
    panelWin.focus();
    return;
  }
  panelWin = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 380,
    minHeight: 500,
    title: 'Glanceline',
    icon: WINDOW_ICON,
    backgroundColor: '#f4ede4',
    autoHideMenuBar: true,
    show: false,
    webPreferences: { backgroundThrottling: false },
  });
  setTaskbarDetails(panelWin);
  panelWin.loadURL(core.baseUrl());
  panelWin.once('ready-to-show', () => panelWin.show());
  panelWin.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });
  panelWin.on('close', (e) => {
    if (quitting || SNAPSHOT_DIR) return;
    e.preventDefault();
    panelWin.hide();
    if (tray && !tray.notifiedHide) {
      tray.notifiedHide = true;
      tray.displayBalloon({
        iconType: 'info',
        title: t('tray.stillRunningTitle'),
        content: t('tray.stillRunningText'),
      });
    }
  });
  panelWin.on('closed', () => {
    panelWin = null;
  });
}

// ---------------------------------------------------------------- Hotkeys

// ---------------------------------------------------------------- Tasten gedrückt halten
// Windows wiederholt gehaltene Tasten (nach ~0,5 s rund 30×/s) – auch bei globalen Hotkeys.
// Daraus wird: Scrollen im Skript läuft flüssig weiter, solange die Taste gehalten wird;
// Stufen (Schrift, Tempo) höchstens 5×/s; Umschalter wie Start/Pause nur einmal pro Druck.
const REPEAT_GAP_MS = 100; // so schnell tippt niemand – das ist Autorepeat
const TOGGLE_GUARD_MS = 650;
const STEP_ACTIONS = new Set(['font:bigger', 'font:smaller', 'script:faster', 'script:slower', 'view:back', 'view:forward']);
const presses = new Map();

function onPress(id, act) {
  const now = Date.now();
  const st = presses.get(id) || { last: 0, fired: 0, holding: false, sent: 0, timer: null };
  presses.set(id, st);
  const gap = now - st.last;
  st.last = now;

  const scroll = (act.type === 'view:back' || act.type === 'view:forward') && (act.target || core.live.mode) === 'script';
  if (scroll && gap < REPEAT_GAP_MS) {
    const dir = act.type === 'view:forward' ? 1 : -1;
    if (!st.holding || now - st.sent > 150) {
      st.holding = true;
      st.sent = now;
      core.action({ type: 'script:hold', dir });
    }
    clearTimeout(st.timer);
    st.timer = setTimeout(() => {
      st.holding = false;
      core.action({ type: 'script:hold', dir: 0 });
    }, 200);
    return;
  }
  if (STEP_ACTIONS.has(act.type)) {
    if (now - st.fired < 200) return;
    st.fired = now;
    core.action(act);
    return;
  }
  if (gap < TOGGLE_GUARD_MS) return; // gehaltener Umschalter
  core.action(act);
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  if (!core) return;
  if (hotkeysSuspended) {
    core.setHotkeyErrors([]);
    return;
  }
  const errors = [];
  const used = new Set();
  for (const [action, accel] of Object.entries(core.settings.hotkeys)) {
    if (!accel) continue;
    const key = accel.toLowerCase();
    if (used.has(key)) {
      errors.push({ action, accel, error: 'duplicate' });
      continue;
    }
    used.add(key);
    try {
      const ok = globalShortcut.register(accel, () => onPress(action, { type: action, source: 'hotkey' }));
      if (!ok) errors.push({ action, accel, error: 'taken' });
    } catch {
      errors.push({ action, accel, error: 'invalid' });
    }
  }

  // Clicker & Fußpedal: einfache Tasten, aber nur im Skript-Modus (PowerPoint & Co. behalten sie sonst)
  const c = core.settings.clicker;
  if (c.enabled && core.live.mode === 'script' && !core.live.passthrough) {
    const bind = {
      forward: { type: 'view:forward', target: 'script', amount: c.step },
      back: { type: 'view:back', target: 'script', amount: c.step },
      toggle: { type: 'script:toggle' },
    };
    for (const [slot, act] of Object.entries(bind)) {
      const accel = c[slot];
      if (!accel || used.has(accel.toLowerCase())) continue;
      used.add(accel.toLowerCase());
      try {
        const ok = globalShortcut.register(accel, () => onPress(`clicker:${slot}`, { ...act, source: 'clicker' }));
        if (!ok) errors.push({ action: `clicker:${slot}`, accel, error: 'taken' });
      } catch {
        errors.push({ action: `clicker:${slot}`, accel, error: 'invalid' });
      }
    }
  }
  core.setHotkeyErrors(errors);
}

// ---------------------------------------------------------------- Autostart

// Ohne Installer startet electron.exe mit dem Projektordner als Argument
function loginItem() {
  const args = app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden'];
  return { path: process.execPath, args, name: 'Glanceline' };
}

// openAtLogin prüft nur den Eintrag namens AppUserModelId – unser Eintrag heißt „Glanceline“
function readAutostart() {
  try {
    const s = app.getLoginItemSettings(loginItem());
    if (Array.isArray(s.launchItems)) return s.launchItems.some((i) => i.name === loginItem().name && i.enabled !== false);
    return s.openAtLogin;
  } catch {
    return false;
  }
}

function applyAutostart() {
  if (!core) return;
  const wanted = core.settings.general.autostart;
  // Eintrag des alten Projektnamens entfernen (harmlos, falls nicht vorhanden)
  if (process.platform === 'win32') {
    try { app.setLoginItemSettings({ openAtLogin: false, name: 'Souffleur' }); } catch { /* egal */ }
  }
  try {
    if (process.platform === 'darwin') app.setLoginItemSettings({ openAtLogin: wanted, openAsHidden: true });
    else app.setLoginItemSettings({ ...loginItem(), openAtLogin: wanted, enabled: wanted });
  } catch (e) {
    console.error('[autostart]', e.message);
  }
  core.setAppInfo({ desktop: true, autostart: readAutostart() });
}

// ---------------------------------------------------------------- Tray

function createTray() {
  const img = nativeImage.createFromPath(ICON_PNG).resize({ width: 16, height: 16, quality: 'best' });
  tray = new Tray(img);
  tray.setToolTip(`${t('tray.tooltip')} ${app.getVersion()}`);
  tray.on('click', showPanel);
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  const mode = (m, label) => ({ label, click: () => core.action({ type: `mode:${m}` }) });
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: t('tray.open'), click: showPanel },
      { label: t('tray.openBrowser'), click: () => shell.openExternal(core.baseUrl()) },
      { type: 'separator' },
      mode('chat', t('mode.chat')),
      mode('script', t('mode.script')),
      mode('obs', t('mode.obsLong')),
      mode('ppt', t('mode.ppt')),
      mode('camera', t('mode.cameraLong')),
      { label: t('tray.blackout'), click: () => core.action({ type: 'blackout' }) },
      ...(process.platform === 'win32' && (prompterKind === 'prompter' || core.settings.windowState.standby)
        ? [{ label: core.settings.windowState.standby ? t('tray.powerOn') : t('tray.powerOff'), click: () => core.action({ type: 'prompter:power' }) }]
        : []),
      {
        label: t('tray.passthrough'),
        type: 'checkbox',
        checked: Boolean(core.live.passthrough),
        click: () => core.action({ type: 'passthrough' }),
      },
      { type: 'separator' },
      {
        label: prompterKind === 'virtual' ? t('tray.virtualReset') : prompterKind === 'prompter' ? t('tray.replace') : t('tray.search'),
        click: () => {
          if (prompterKind === 'virtual' && prompterWin) prompterWin.setBounds(virtualBounds(true));
          else placePrompter();
        },
      },
      {
        label: t('tray.autostart'),
        type: 'checkbox',
        checked: core.settings.general.autostart,
        click: (item) => core.patchSettings({ general: { autostart: item.checked } }),
      },
      { type: 'separator' },
      {
        label: t('tray.quit'),
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

// ---------------------------------------------------------------- Test-Screenshots

async function runSnapshot(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const save = async (win, name) => {
    if (!win || win.isDestroyed()) return;
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
  };
  const exec = (win, js) => win.webContents.executeJavaScript(js, true).catch((e) => console.error(e.message));
  // Konsolenmeldungen beider Fenster mitschreiben (Fehlersuche)
  const consoleLog = [];
  for (const [name, win] of [['panel', panelWin], ['prompter', prompterWin]]) {
    if (win) win.webContents.on('console-message', (e) => consoleLog.push(`[${name}] ${e.level}: ${e.message} (${e.sourceId}:${e.lineNumber})`));
  }
  try {
    await wait(5000);
    const steps = (argValue('--snapshot-steps') || 'chat').split(',');
    for (const step of steps) {
      if (step.startsWith('tab:')) {
        await exec(panelWin, `document.querySelector('[data-tab="${step.slice(4)}"]').click()`);
        await wait(1200);
        await save(panelWin, `panel-${step.slice(4)}`);
      } else if (step === 'panel') {
        await save(panelWin, 'panel');
      } else if (step.startsWith('eval:')) {
        // eval:<URL-kodiertes JS> → im Panel ausführen, Ergebnis speichern (Fehlersuche)
        const result = await exec(panelWin, decodeURIComponent(step.slice(5)));
        fs.writeFileSync(path.join(dir, `eval-${Date.now()}.json`), JSON.stringify(result, null, 1));
      } else if (step.startsWith('act:')) {
        // act:<URL-kodiertes JSON> → Aktion mit Parametern, z. B. Regie-Nachricht
        core.action(JSON.parse(decodeURIComponent(step.slice(4))));
        await wait(1500);
      } else if (step.startsWith('live:')) {
        // Zustand festhalten: Live-Daten, Fenster sichtbar?, Clicker-Tasten belegt?
        const c = core.settings.clicker;
        const dump = {
          live: core.live,
          prompterVisible: Boolean(prompterWin && !prompterWin.isDestroyed() && prompterWin.isVisible()),
          clickerRegistered: [c.forward, c.back, c.toggle].map((k) => [k, globalShortcut.isRegistered(k)]),
          prompterWindow: prompterWin && !prompterWin.isDestroyed()
            ? { kind: prompterKind, bounds: prompterWin.getBounds(), opacity: prompterWin.getOpacity(), hwnd: String(prompterWin.getNativeWindowHandle().readBigUInt64LE(0)) }
            : null,
        };
        fs.writeFileSync(path.join(dir, `live-${step.slice(5)}.json`), JSON.stringify(dump, null, 1));
      } else if (step.startsWith('sendkeys:')) {
        // Tastendruck simulieren (für Clicker-Tests), z. B. sendkeys:{PGDN}
        require('child_process').spawnSync('powershell.exe', ['-NoProfile', '-Command', `(New-Object -ComObject WScript.Shell).SendKeys('${step.slice(9)}')`], { windowsHide: true });
        await wait(1200);
      } else if (step.startsWith('outshot:')) {
        // Screenshot einer weiteren Ausgabe (Nummer in der Reihenfolge der Einstellungen)
        const win = [...outputWins.values()][Number(step.slice(8)) || 0];
        if (win && !win.isDestroyed()) await save(win, `output-${step.slice(8)}`);
      } else if (step.startsWith('scroll:')) {
        // scroll:sec-voice → Einstellungsabschnitt ins Bild holen und fotografieren
        await exec(panelWin, `document.getElementById('${step.slice(7)}').scrollIntoView({ block: 'start' })`);
        await wait(800);
        await save(panelWin, `panel-${step.slice(7)}`);
      } else if (step === 'phone') {
        await exec(panelWin, `document.getElementById('phoneBtn').click()`);
        await wait(1200);
        await save(panelWin, 'panel-phone');
      } else if (step.startsWith('set:')) {
        // set:general.autostart=true → Einstellung ändern (wie aus dem Panel)
        const [p, raw] = step.slice(4).split('=');
        const patch = {};
        p.split('.').reduce((o, k, i, arr) => (o[k] = i === arr.length - 1 ? JSON.parse(raw) : {}), patch);
        core.patchSettings(patch);
        await wait(2500);
      } else if (step.startsWith('wait')) {
        await wait(Number(step.slice(4)) || 1000);
      } else if (step.includes(':') || step === 'blackout') {
        core.action({ type: step });
        await wait(1800);
        await save(prompterWin, `prompter-${step.replace(/[:]/g, '-')}`);
      } else {
        await save(prompterWin, `prompter-${step}`);
      }
    }
  } finally {
    fs.writeFileSync(path.join(dir, 'live.json'), JSON.stringify(core.live, null, 1));
    fs.writeFileSync(path.join(dir, 'console.log'), consoleLog.join('\n'));
    quitting = true;
    app.quit();
  }
}
