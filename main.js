'use strict';
// Glanceline – Electron-Hauptprozess
// Startet den internen Server, legt die Prompter-Ansicht randlos auf den Elgato Prompter,
// registriert die globalen Hotkeys und hängt sich in den Infobereich (Tray).
const { app, BrowserWindow, Menu, Tray, dialog, globalShortcut, nativeImage, screen, session, shell } = require('electron');
const fs = require('fs');
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
const SNAPSHOT_DIR = argValue('--snapshot'); // nur zum Testen: Screenshots speichern und beenden

let core = null;
let prompterWin = null;
let prompterKind = null; // 'prompter' | 'test' | null
let prompterScale = 1; // Windows-Skalierung des Ziel-Bildschirms
let panelWin = null;
let tray = null;
let quitting = false;
let hotkeysSuspended = false;

app.setAppUserModelId(APP_ID);

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
app.on('before-quit', () => {
  quitting = true;
});
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (core) core.stop();
});

async function boot() {
  Menu.setApplicationMenu(null);
  const dir = process.env.GLANCELINE_DATA ? path.resolve(process.env.GLANCELINE_DATA) : app.getPath('userData');
  if (migrateLegacyData(dir)) console.log(`[glanceline] settings migrated to ${dir}`);
  core = new Glanceline({ dataDir: dir });
  await core.start();

  // Kamera nur für die eigene, lokale Oberfläche freigeben
  const isOwn = (url) => /^http:\/\/(127\.0\.0\.1|localhost):\d+/.test(url || '');
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(permission === 'media' && isOwn(details.requestingUrl || wc.getURL()));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin) => permission === 'media' && isOwn(origin));

  core.on('autostart', () => {
    applyAutostart();
    updateTrayMenu();
  });
  core.on('hotkeys', registerHotkeys);
  // Skript-Ordner wählen und Dateien/Ordner im Explorer bzw. Standard-Editor öffnen
  core.on('pickFolder', async () => {
    const parent = panelWin && !panelWin.isDestroyed() ? panelWin : undefined;
    const r = await dialog.showOpenDialog(parent, { title: t('library.pickTitle'), properties: ['openDirectory'], defaultPath: core.settings.library.folder || app.getPath('documents') });
    if (!r.canceled && r.filePaths[0]) core.patchSettings({ library: { folder: r.filePaths[0] } });
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
    if (tray) tray.setToolTip(t('tray.tooltip'));
    if (prompterWin && prompterKind === 'test') prompterWin.setTitle(t('tray.testWindowTitle'));
  });
  core.on('hotkeys:suspend', (on) => {
    hotkeysSuspended = on;
    registerHotkeys();
  });
  core.on('display', placePrompter);
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
  placePrompter();
  if (!process.argv.includes('--hidden')) showPanel();
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

function placePrompter() {
  if (!core) return;
  const displays = screen.getAllDisplays();
  core.setDisplays(displays.map(describeDisplay));

  const virtual = core.settings.display.target === 'virtual';
  let target = virtual ? null : findTarget();
  // Nie den Hauptbildschirm randlos zukleistern
  if (target && target.id === screen.getPrimaryDisplay().id) target = null;
  const kind = virtual ? 'virtual' : target ? 'prompter' : core.settings.display.testWindow ? 'test' : null;
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
    shell.openExternal(url);
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
      const ok = globalShortcut.register(accel, () => core.action({ type: action, source: 'hotkey' }));
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
        const ok = globalShortcut.register(accel, () => core.action({ ...act, source: 'clicker' }));
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
  // Eintrag des alten Projektnamens entfernen (harmlos, falls nicht vorhanden)
  try { app.setLoginItemSettings({ openAtLogin: false, name: 'Souffleur' }); } catch { /* egal */ }
  const wanted = core.settings.general.autostart;
  try {
    app.setLoginItemSettings({ ...loginItem(), openAtLogin: wanted, enabled: wanted });
  } catch (e) {
    console.error('[autostart]', e.message);
  }
  core.setAppInfo({ desktop: true, autostart: readAutostart() });
}

// ---------------------------------------------------------------- Tray

function createTray() {
  const img = nativeImage.createFromPath(ICON_PNG).resize({ width: 16, height: 16, quality: 'best' });
  tray = new Tray(img);
  tray.setToolTip(t('tray.tooltip'));
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
