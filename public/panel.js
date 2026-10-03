// Glanceline – Steuer-Panel (PC, Handy, OBS-Dock)
(() => {
  'use strict';
  const S = window.Glanceline;
  const I18N = window.GlancelineI18n;
  const esc = S.esc;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const IS_LOCAL = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(location.hostname);

  let settings = null;
  let scripts = null;
  let live = null;
  let defaults = { hotkeys: {} };
  let clockOffset = 0;
  let obsSources = { inputs: [], scenes: [] };
  let lang = I18N.resolveLang('auto');
  let t = I18N.translator(lang);
  let locale = lang === 'de' ? 'de-DE' : 'en-US';

  // ---------------------------------------------------------------- Icons (Lucide-Stil)

  const ICONS = {
    play: '<polygon points="6 4 20 12 6 20 6 4"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    'skip-back': '<polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/>',
    'skip-fwd': '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>',
    'chev-up': '<polyline points="18 15 12 9 6 15"/>',
    'chev-down': '<polyline points="6 9 12 15 18 9"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
    restart: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><polyline points="3 3 3 8 8 8"/>',
    refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><polyline points="21 3 21 8 16 8"/><polyline points="3 21 3 16 8 16"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    'eye-off': '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    script: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="14" y2="17"/>',
    broadcast: '<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14"/>',
    slides: '<path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/>',
    camera: '<path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    gear: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
    plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a6 6 0 0 1-12 0V8z"/>',
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
    send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
    insert: '<polyline points="15 10 20 15 15 20"/><path d="M4 4v7a4 4 0 0 0 4 4h12"/>',
    phone: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><line x1="11" y1="18" x2="13" y2="18"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
  };
  const svg = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

  function hydrateIcons(root = document) {
    $$('i[data-icon]', root).forEach((i) => {
      if (i.dataset.drawn === i.dataset.icon) return;
      i.innerHTML = svg(i.dataset.icon);
      i.dataset.drawn = i.dataset.icon;
    });
  }
  function setIcon(i, name) {
    if (i.dataset.drawn === name) return;
    i.dataset.icon = name;
    i.innerHTML = svg(name);
    i.dataset.drawn = name;
  }

  // ---------------------------------------------------------------- Helfer

  const getPath = (obj, p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  function setPath(obj, p, v) {
    const keys = p.split('.');
    const last = keys.pop();
    keys.reduce((o, k) => o[k], obj)[last] = v;
  }
  function patchFor(p, v) {
    const keys = p.split('.');
    const out = {};
    let cur = out;
    keys.slice(0, -1).forEach((k) => { cur = cur[k] = {}; });
    cur[keys[keys.length - 1]] = v;
    return out;
  }
  function setText(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
  }
  function setHtml(node, html) {
    if (node && node._html !== html) {
      node._html = html;
      node.innerHTML = html;
    }
  }
  function setState(node, [cls, text]) {
    const c = `state ${cls}`;
    if (node.className !== c) node.className = c;
    setText(node, text);
  }
  function setFacts(dl, pairs) {
    setHtml(dl, pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join(''));
  }
  let noteTimer;
  function note(msg) {
    let n = $('.toast-note');
    if (!n) {
      n = document.createElement('div');
      n.className = 'toast-note';
      document.body.append(n);
    }
    n.textContent = msg;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => n.remove(), 2200);
  }
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      note(t('note.copied'));
    } catch {
      note(t('note.copyFailed'));
    }
  }
  const serverNow = () => Date.now() + clockOffset;
  const obsSince = () => (live.obs && live.obs.at ? Math.max(0, serverNow() - live.obs.at) : 0);
  const countWords = (text) => (String(text).replace(/\[[^\]]*\]|[#*=]/g, ' ').match(/[\p{L}\p{N}'’-]+/gu) || []).length;
  const fmtDate = (ts) => (ts ? new Date(ts).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

  // ---------------------------------------------------------------- Sprache

  // Wechselt alle Texte; dynamische Bereiche werden danach neu aufgebaut
  function applyLanguage() {
    const next = I18N.resolveLang(settings ? settings.general.language : 'auto');
    const changed = next !== lang || !document.body.dataset.i18nReady;
    lang = next;
    t = I18N.translator(lang);
    locale = lang === 'de' ? 'de-DE' : 'en-US';
    if (!changed) return;
    document.documentElement.lang = lang;
    document.body.dataset.i18nReady = '1';
    I18N.apply(document, t);
    renderSettingsPage();
    $$('[data-dyn]').forEach((s) => { s._sig = null; });
    $$('[data-html-cache]').forEach((n) => { n._html = null; });
    for (const n of [$('#chips'), $('#connList'), $('#chatFacts'), $('#obsFacts'), $('#pptFacts'), $('#sectionList'), $('#scriptList'), $('#phoneBody'), $('#setupChecks')]) n._html = null;
    $('#sectionList')._body = null;
    $('#scriptSelect')._sig = null;
    if (settings) {
      refreshSettings();
      renderHotkeys();
    }
    if (scripts) {
      renderScriptList();
      updateEditorMeta();
    }
    scheduleRender();
  }

  // ---------------------------------------------------------------- Tabs

  function showTab(name) {
    $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $$('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${name}`));
    try { localStorage.setItem('glanceline.tab', name); } catch { /* egal */ }
    if (name === 'live') requestAnimationFrame(scalePreview);
    if (name === 'settings') {
      loadObsSources();
      loadFonts();
    }
  }

  // ---------------------------------------------------------------- Einstellungen (generische Bindung)

  const sendTimers = {};
  function sendSetting(path, value, delay) {
    setPath(settings, path, value);
    clearTimeout(sendTimers[path]);
    const go = () => S.api('/api/settings', patchFor(path, value)).catch(() => note(t('note.saveFailed')));
    if (delay) sendTimers[path] = setTimeout(go, delay);
    else go();
    refreshOutputs();
    refreshVisibility();
    if (path === 'general.language') applyLanguage();
  }

  function readInput(el) {
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'range' || el.type === 'number') return Number(el.value);
    if (el.hasAttribute('data-list')) return el.value.split(',').map((s) => s.trim()).filter(Boolean);
    return el.value;
  }

  function bindSettings(root = document) {
    $$('[data-setting]', root).forEach((el) => {
      if (el._bound) return;
      el._bound = true;
      const path = el.dataset.setting;
      const instant = el.type === 'range' || el.type === 'color';
      el.addEventListener(instant ? 'input' : 'change', () => {
        const v = readInput(el);
        if (el.type === 'number' && (!Number.isFinite(v) || el.value === '')) return;
        sendSetting(path, v, instant ? 120 : 0);
      });
      if (el.type === 'range') {
        el.addEventListener('pointerdown', () => { el._drag = true; });
        const end = () => { el._drag = false; };
        el.addEventListener('pointerup', end);
        el.addEventListener('pointercancel', end);
        el.addEventListener('blur', end);
      }
    });
  }

  const FMT = {
    px: (v) => `${v} px`,
    pxs: (v) => `${v} px/s`,
    pct: (v) => `${Math.round(v * 100)} %`,
    x: (v) => `${Number(v).toFixed(1)}×`,
    lh: (v) => Number(v).toFixed(2),
    raw: (v) => String(v),
  };
  function refreshOutputs() {
    $$('output[data-for]').forEach((o) => setText(o, (FMT[o.dataset.fmt] || FMT.raw)(getPath(settings, o.dataset.for))));
  }
  function refreshVisibility() {
    $$('[data-show]').forEach((n) => {
      const [p, v] = n.dataset.show.split('=');
      n.classList.toggle('hidden-field', String(getPath(settings, p)) !== v);
    });
  }

  function refreshSettings() {
    if (!settings) return;
    fillDyn();
    $$('[data-setting]').forEach((el) => {
      const v = getPath(settings, el.dataset.setting);
      if (el.type === 'checkbox') {
        el.checked = Boolean(v);
        return;
      }
      if (el._drag) return;
      if (document.activeElement === el && el.type !== 'range' && el.tagName !== 'SELECT') return;
      const str = el.hasAttribute('data-list') ? (v || []).join(', ') : v == null ? '' : String(v);
      if (el.value !== str) el.value = str;
    });
    refreshOutputs();
    refreshVisibility();
  }

  // Auswahllisten, deren Einträge vom Live-Zustand oder der Sprache abhängen
  const DYN = {
    languages: () => I18N.LANGUAGE_OPTIONS.map(([v, label]) => [v, v === 'auto' ? t('settings.languageAuto') : label]),
    displays: () => [
      ['auto', t('settings.displayAuto')],
      ['virtual', t('settings.displayVirtual')],
      ...((live && live.displays) || []).map((d) => [
        d.id,
        `${d.label || t('settings.displayGeneric')} · ${d.width}×${d.height}${d.isPrompter ? ' · Prompter' : ''}${d.primary ? ` · ${t('settings.displayPrimary')}` : ''}`,
      ]),
    ],
    mics: () => [['', t('voice.micDefault')], ...((live && live.mics) || []).map((d) => [d.label, d.label])],
    fonts: () => {
      const bundled = FONT_OPTIONS();
      const names = new Set(bundled.map(([v]) => v));
      return [...bundled, ...systemFontList.filter((f) => !names.has(f)).map((f) => [f, f])];
    },
    scriptsOpt: () => [['', t('inserts.none')], ...((scripts && scripts.items) || []).map((i) => [i.id, i.title || t('scripts.untitled')])],
    voiceLangs: () => [['auto', t('voice.langAuto')], ...VOICE_LANGS.map((l) => [l, t(`lang.${l}`)])],
    cameras: () => [['', t('settings.cameraAuto')], ...((live && live.camera.devices) || []).map((d) => [d.label, d.label])],
    obsSources: () => [
      ['', t('settings.obsSourcePick')],
      ...obsSources.inputs.map((n) => [n, n]),
      ...obsSources.scenes.map((n) => [n, t('settings.obsScene', { scene: n })]),
    ],
  };
  function fillDyn() {
    if (!settings) return;
    $$('select[data-dyn]').forEach((sel) => {
      const opts = DYN[sel.dataset.dyn]();
      const cur = getPath(settings, sel.dataset.setting);
      if (cur && !opts.some(([v]) => v === cur)) opts.push([cur, t('settings.unavailable', { name: cur })]);
      const sig = JSON.stringify(opts);
      if (sel._sig === sig) return;
      sel._sig = sig;
      sel.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
      sel.value = cur == null ? '' : cur;
    });
  }

  async function loadObsSources(manual) {
    try {
      const r = await S.api('/api/obs-sources');
      obsSources = { inputs: r.inputs || [], scenes: r.scenes || [] };
      if (!r.ok && manual) note(`OBS: ${t(r.error)}`);
      fillDyn();
    } catch {
      if (manual) note(t('note.sourcesFailed'));
    }
  }

  // ---------------------------------------------------------------- Einstellungs-Seite

  const MODE_OPTIONS = () => [['chat', t('mode.chat')], ['script', t('mode.script')], ['obs', t('mode.obsLong')], ['ppt', t('mode.ppt')], ['camera', t('mode.cameraLong')]];
  let systemFontList = [];
  async function loadFonts() {
    if (systemFontList.length) return;
    try {
      systemFontList = (await S.api('/api/fonts')).fonts || [];
      fillDyn();
    } catch { /* egal */ }
  }
  const FONT_OPTIONS = () => [
    ['Atkinson Hyperlegible', t('settings.fontAtkinson')],
    ['OpenDyslexic', t('settings.fontDyslexic')],
    ['Segoe UI', 'Segoe UI'],
    ['Inter', 'Inter'],
    ['Verdana', 'Verdana'],
    ['Arial', 'Arial'],
    ['Georgia', 'Georgia'],
    ['Cormorant Garamond', 'Cormorant Garamond'],
  ];

  // Labels werden erst beim Rendern übersetzt (l = Schlüssel)
  const SECTIONS = () => [
    {
      id: 'sec-start',
      title: 'settings.sec.start',
      fields: [
        { k: 'general.language', l: 'settings.language', type: 'select', dyn: 'languages' },
        { k: 'general.autostart', l: 'settings.autostart', type: 'toggle', h: 'settings.autostartHint' },
        { k: 'general.startMode', l: 'settings.startMode', type: 'select', options: MODE_OPTIONS() },
      ],
      extra: '<p class="hint" id="autostartState"></p>',
    },
    {
      id: 'sec-display',
      title: 'settings.sec.display',
      lead: 'settings.sec.displayLead',
      fields: [
        { k: 'display.target', l: 'settings.display', type: 'select', dyn: 'displays' },
        { k: 'display.virtualOpacity', l: 'settings.virtualOpacity', type: 'range', min: 0.3, max: 1, step: 0.05, fmt: 'pct', h: 'settings.virtualHint', show: 'display.target=virtual' },
        { k: 'display.mirror', l: 'settings.mirror', type: 'toggle', h: 'settings.mirrorHint' },
        { k: 'display.testWindow', l: 'settings.testWindow', type: 'toggle' },
        { k: 'display.statusBar', l: 'settings.statusBar', type: 'toggle' },
        { k: 'display.fontFamily', l: 'settings.font', type: 'select', dyn: 'fonts', h: 'settings.fontHint' },
        { k: 'display.highContrast', l: 'settings.highContrast', type: 'toggle', h: 'settings.highContrastHint' },
        { k: 'display.brightness', l: 'settings.brightness', type: 'range', min: 0.2, max: 1, step: 0.05, fmt: 'pct', h: 'settings.brightnessHint' },
        { k: 'display.crosshair', l: 'settings.crosshair', type: 'toggle', h: 'settings.crosshairHint' },
        { k: 'display.crossX', l: 'settings.crossX', type: 'range', min: 0, max: 1, step: 0.01, fmt: 'pct', show: 'display.crosshair=true' },
        { k: 'display.crossY', l: 'settings.crossY', type: 'range', min: 0, max: 1, step: 0.01, fmt: 'pct', show: 'display.crosshair=true' },
        { k: 'display.crossSize', l: 'settings.crossSize', type: 'range', min: 16, max: 300, step: 2, fmt: 'px', show: 'display.crosshair=true' },
        { k: 'display.crossOpacity', l: 'settings.crossOpacity', type: 'range', min: 0.1, max: 1, step: 0.05, fmt: 'pct', show: 'display.crosshair=true' },
        { k: 'display.textColor', l: 'settings.textColor', type: 'color' },
        { k: 'display.accentColor', l: 'settings.accentColor', type: 'color' },
      ],
      extra: `<div class="btn-row"><button class="btn sm" data-action="prompter:place"><i data-icon="monitor"></i>${esc(t('settings.replacePrompter'))}</button></div>`,
    },
    {
      id: 'sec-camera',
      title: 'settings.sec.camera',
      lead: 'settings.sec.cameraLead',
      fields: [
        { k: 'camera.enabled', l: 'settings.cameraEnabled', type: 'toggle' },
        { k: 'camera.source', l: 'settings.cameraSource', type: 'select', options: [['device', t('settings.cameraSourceDevice')], ['obs', t('settings.cameraSourceObs')]] },
        { k: 'camera.deviceLabel', l: 'settings.cameraDevice', type: 'select', dyn: 'cameras', show: 'camera.source=device', h: 'settings.cameraDeviceHint' },
        { k: 'camera.fps', l: 'settings.cameraFps', type: 'number', min: 5, max: 60, show: 'camera.source=device' },
        {
          k: 'camera.obsSource',
          l: 'settings.cameraObsSource',
          type: 'select',
          dyn: 'obsSources',
          show: 'camera.source=obs',
          h: 'settings.cameraObsSourceHint',
          after: `<button class="link" id="reloadSources"><i data-icon="refresh"></i>${esc(t('settings.reloadSources'))}</button>`,
        },
        { k: 'camera.selfie', l: 'settings.cameraSelfie', type: 'toggle' },
        { k: 'camera.dim', l: 'camera.dim', type: 'range', min: 0, max: 0.9, step: 0.05, fmt: 'pct' },
        { k: 'camera.plate', l: 'camera.plate', type: 'range', min: 0, max: 1, step: 0.05, fmt: 'pct' },
        { k: 'camera.textOpacity', l: 'camera.textOpacity', type: 'range', min: 0.3, max: 1, step: 0.05, fmt: 'pct' },
      ],
    },
    {
      id: 'sec-chat',
      title: 'chat.title',
      lead: 'settings.sec.chatLead',
      fields: [
        { k: 'chat.channel', l: 'settings.channel', type: 'text', placeholder: t('setup.channelPlaceholder') },
        { k: 'chat.youtube', l: 'settings.youtube', type: 'text', placeholder: '@handle', h: 'settings.youtubeHint' },
        { k: 'chat.kick', l: 'settings.kick', type: 'text', placeholder: t('setup.channelPlaceholder'), h: 'settings.kickHint' },
        { k: 'chat.fontSize', l: 'settings.fontSize', type: 'range', min: 16, max: 72, step: 1, fmt: 'px' },
        { k: 'chat.emoteScale', l: 'settings.emoteScale', type: 'range', min: 1, max: 3, step: 0.1, fmt: 'x' },
        { k: 'chat.maxMessages', l: 'settings.maxMessages', type: 'number', min: 5, max: 200 },
        { k: 'chat.providers.seventv', l: 'settings.seventv', type: 'toggle', h: 'settings.seventvHint' },
        { k: 'chat.emoteNotices', l: 'settings.emoteNotices', type: 'toggle', h: 'settings.emoteNoticesHint' },
        { k: 'chat.providers.bttv', l: 'settings.bttv', type: 'toggle' },
        { k: 'chat.providers.ffz', l: 'settings.ffz', type: 'toggle' },
        { k: 'chat.showBadges', l: 'settings.showBadges', type: 'toggle' },
        { k: 'chat.showEvents', l: 'settings.showEvents', type: 'toggle' },
        { k: 'chat.eventToasts', l: 'settings.eventToasts', type: 'toggle', h: 'settings.eventToastsHint' },
        { k: 'chat.hideCommands', l: 'settings.hideCommands', type: 'toggle' },
        { k: 'chat.hideBots', l: 'settings.hideBots', type: 'list', h: 'settings.hideBotsHint' },
        { k: 'chat.highlightWords', l: 'settings.highlightWords', type: 'list', h: 'settings.highlightWordsHint' },
        { k: 'chat.fadeAfter', l: 'settings.fadeAfter', type: 'number', min: 0, max: 3600, unit: t('settings.fadeAfterUnit') },
      ],
    },
    {
      id: 'sec-timers',
      title: 'show.title',
      lead: 'settings.sec.timersLead',
      fields: [
        { k: 'timers.show', l: 'timers.show', type: 'toggle', h: 'timers.showHint' },
        { k: 'timers.minutes', l: 'timers.minutes', type: 'number', min: 0, max: 600, unit: t('timers.minutesUnit'), h: 'timers.minutesHint' },
        { k: 'timers.warn', l: 'timers.warn', type: 'number', min: 0, max: 60, unit: t('timers.minutesUnit') },
        { k: 'timers.start', l: 'timers.start', type: 'select', options: [['script', t('timers.startScript')], ['stream', t('timers.startStream')], ['manual', t('timers.startManual')]] },
      ],
    },
    {
      id: 'sec-script',
      title: 'script.title',
      fields: [
        { k: 'script.fontSize', l: 'settings.fontSize', type: 'range', min: 24, max: 120, step: 2, fmt: 'px' },
        { k: 'script.lineHeight', l: 'settings.lineHeight', type: 'range', min: 1, max: 2, step: 0.05, fmt: 'lh' },
        { k: 'script.speed', l: 'script.speed', type: 'range', min: 5, max: 300, step: 1, fmt: 'pxs' },
        { k: 'script.guide', l: 'settings.guide', type: 'range', min: 0.1, max: 0.6, step: 0.02, fmt: 'pct', h: 'settings.guideHint' },
        { k: 'script.showGuide', l: 'settings.showGuide', type: 'toggle' },
        { k: 'script.countdown', l: 'settings.countdown', type: 'number', min: 0, max: 10, unit: t('settings.seconds') },
        { k: 'script.margin', l: 'settings.margin', type: 'range', min: 0, max: 0.45, step: 0.01, fmt: 'pct', h: 'settings.marginHint' },
        { k: 'script.align', l: 'settings.align', type: 'select', options: [['left', t('settings.alignStart')], ['center', t('settings.alignCenter')]] },
      ],
    },
    {
      id: 'sec-clicker',
      title: 'settings.sec.clicker',
      lead: 'settings.sec.clickerLead',
      fields: [
        { k: 'clicker.enabled', l: 'clicker.enabled', type: 'toggle', h: 'clicker.enabledHint' },
        { k: 'clicker.step', l: 'clicker.step', type: 'select', options: [['line', t('clicker.stepLine')], ['page', t('clicker.stepPage')]] },
      ],
      extra: `<table class="hk-table"><tbody>${['forward', 'back', 'toggle'].map((slot) => `<tr><td>${esc(t(`clicker.${slot}`))}</td><td><button class="hk" data-clk="${slot}"></button><span class="hk-err" data-hk-err="clicker:${slot}"></span></td></tr>`).join('')}</tbody></table>`,
    },
    {
      id: 'sec-inserts',
      title: 'settings.sec.inserts',
      lead: 'settings.sec.insertsLead',
      fields: [1, 2, 3, 4].map((n) => ({ k: `inserts.${n}`, l: 'inserts.slot', vars: { n }, type: 'select', dyn: 'scriptsOpt' })),
    },
    {
      id: 'sec-director',
      title: 'director.title',
      lead: 'settings.sec.directorLead',
      fields: [
        { k: 'director.seconds', l: 'director.seconds', type: 'number', min: 3, max: 300, unit: t('settings.seconds') },
        { k: 'director.presets', l: 'director.presets', type: 'list', h: 'director.presetsHint' },
      ],
    },
    {
      id: 'sec-voice',
      title: 'settings.sec.voice',
      lead: 'settings.sec.voiceLead',
      fields: [
        { k: 'voice.enabled', l: 'voice.toggle', type: 'toggle', h: 'voice.toggleHint' },
        { k: 'voice.lang', l: 'voice.lang', type: 'select', dyn: 'voiceLangs' },
        { k: 'voice.micLabel', l: 'voice.mic', type: 'select', dyn: 'mics' },
        { k: 'voice.dimRead', l: 'voice.dimRead', type: 'toggle' },
      ],
      extra: `<h3 class="sub">${esc(t('voice.models'))}</h3><ul class="model-list" id="voiceModels"></ul><p class="hint">${esc(t('voice.attribution'))}</p>`,
    },
    {
      id: 'sec-ppt',
      title: 'PowerPoint',
      lead: 'settings.sec.pptLead',
      fields: [
        { k: 'ppt.autoSwitch', l: 'ppt.autoSwitch', type: 'toggle', h: 'settings.autoSwitchHint' },
        { k: 'ppt.maxFontSize', l: 'settings.maxFontSize', type: 'range', min: 20, max: 120, step: 2, fmt: 'px' },
        { k: 'ppt.minFontSize', l: 'settings.minFontSize', type: 'range', min: 12, max: 60, step: 1, fmt: 'px', h: 'settings.minFontSizeHint' },
        { k: 'ppt.showNext', l: 'settings.showNext', type: 'toggle' },
        { k: 'ppt.showTimer', l: 'settings.showTimer', type: 'toggle' },
      ],
    },
    {
      id: 'sec-obs',
      title: 'settings.sec.obs',
      lead: 'settings.sec.obsLead',
      fields: [
        { k: 'obs.host', l: 'settings.obsHost', type: 'text' },
        { k: 'obs.port', l: 'settings.port', type: 'number', min: 1, max: 65535 },
        { k: 'obs.password', l: 'settings.obsPassword', type: 'password', placeholder: t('settings.obsPasswordPlaceholder') },
        { k: 'obsAuto.recordWithScript', l: 'obsAuto.record', type: 'toggle', h: 'obsAuto.recordHint' },
        { k: 'obsAuto.chapters', l: 'obsAuto.chapters', type: 'toggle', h: 'obsAuto.chaptersHint' },
      ],
      extra: `<p class="hint" id="obsSettingsState"></p><h3 class="sub">${esc(t('obsAuto.scenes'))}</h3><p class="hint">${esc(t('obsAuto.scenesHint'))}</p><div id="sceneModes"></div>`,
    },
    { id: 'sec-network', title: 'settings.sec.network', custom: 'network' },
    { id: 'sec-integrations', title: 'settings.sec.integrations', custom: 'integrations' },
    { id: 'sec-hotkeys', title: 'settings.sec.hotkeys', custom: 'hotkeys' },
  ];

  const ACTIONS = [
    'mode:chat', 'mode:script', 'mode:obs', 'mode:ppt', 'mode:camera', 'blackout', 'camera:toggle',
    'script:toggle', 'script:slower', 'script:faster', 'view:back', 'view:forward',
    'script:prevSection', 'script:nextSection', 'script:restart', 'script:reverse', 'font:bigger', 'font:smaller', 'ppt:timerReset', 'voice:toggle',
    'passthrough', 'chat:pause', 'insert:1', 'insert:2', 'insert:3', 'insert:4', 'director:clear', 'show:toggle', 'show:reset',
  ];
  const VOICE_LANGS = ['de', 'en', 'fr', 'es'];

  function fieldHtml(f) {
    const id = `f_${f.k.replace(/\./g, '_')}`;
    const show = f.show ? ` data-show="${f.show}"` : '';
    const hint = f.h ? `<small class="hint">${esc(t(f.h))}</small>` : '';
    const label = esc(t(f.l, f.vars));
    const after = f.after || '';
    switch (f.type) {
      case 'toggle':
        return `<label class="switch-row"${show}><span class="lbl">${label}${hint}</span><span class="switch"><input type="checkbox" id="${id}" data-setting="${f.k}"><span class="knob"></span></span></label>`;
      case 'range':
        return `<div class="field"${show}><label for="${id}">${label}<output data-for="${f.k}" data-fmt="${f.fmt || 'raw'}"></output></label><input type="range" id="${id}" data-setting="${f.k}" min="${f.min}" max="${f.max}" step="${f.step}">${hint}${after}</div>`;
      case 'number':
        return `<div class="field"${show}><label for="${id}">${label}</label><div class="with-unit"><input type="number" id="${id}" data-setting="${f.k}" min="${f.min}" max="${f.max}" step="${f.step || 1}">${f.unit ? `<span>${esc(f.unit)}</span>` : ''}</div>${hint}${after}</div>`;
      case 'select': {
        const opts = (f.options || []).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
        return `<div class="field"${show}><label for="${id}">${label}</label><select id="${id}" data-setting="${f.k}"${f.dyn ? ` data-dyn="${f.dyn}"` : ''}>${opts}</select>${hint}${after}</div>`;
      }
      case 'color':
        return `<div class="field"${show}><label for="${id}">${label}</label><input type="color" id="${id}" data-setting="${f.k}">${hint}</div>`;
      case 'list':
        return `<div class="field"${show}><label for="${id}">${label}</label><input type="text" id="${id}" data-setting="${f.k}" data-list spellcheck="false" autocomplete="off">${hint}${after}</div>`;
      default:
        return `<div class="field"${show}><label for="${id}">${label}</label><input type="${f.type}" id="${id}" data-setting="${f.k}" placeholder="${esc(f.placeholder || '')}" spellcheck="false" autocomplete="off">${hint}${after}</div>`;
    }
  }

  function networkHtml() {
    return `<p class="lead">${esc(t('net.lead'))}</p>
      <label class="switch-row"><span class="lbl">${esc(t('net.lan'))}<small class="hint">${esc(t('net.firewallHint'))}</small></span><span class="switch"><input type="checkbox" data-setting="general.lan"><span class="knob"></span></span></label>
      <div class="field"><label for="f_general_port">${esc(t('settings.port'))}</label><div class="with-unit"><input type="number" id="f_general_port" data-setting="general.port" min="1024" max="65535"></div></div>
      <div id="lanUrls"></div>
      <h3 class="sub">${esc(t('net.dock'))}</h3>
      <p class="hint">${esc(t('net.dockHint'))}</p>
      <div class="url-row"><code id="dockUrl"></code><button class="btn icon sm" data-copy-from="dockUrl" title="${esc(t('common.copy'))}"><i data-icon="copy"></i></button></div>`;
  }

  function integrationsHtml() {
    return `<p class="lead">${esc(t('integ.lead'))}</p>
      <h3 class="sub">Stream Deck</h3>
      <p class="hint" id="sdState"></p>
      <div class="btn-row"><button class="btn sm" data-action="streamdeck:install" id="sdInstall"><i data-icon="download"></i><span></span></button><a class="btn sm" href="/api/streamdeck-plugin" download><span>${esc(t('integ.sdDownload'))}</span></a></div>
      <h3 class="sub">${esc(t('integ.api'))}</h3>
      <p class="hint">${esc(t('integ.apiHint'))}</p>
      <div class="url-row"><code id="apiUrl"></code><button class="btn icon sm" data-copy-from="apiUrl" title="${esc(t('common.copy'))}"><i data-icon="copy"></i></button></div>
      <p class="hint">${esc(t('integ.companion'))}</p>`;
  }

  function renderIntegrations() {
    const st = $('#sdState');
    if (!st) return;
    const sd = (live.app && live.app.streamDeck) || {};
    setText(st, sd.installed ? t('integ.sdInstalled') : sd.found ? t('integ.sdFound') : t('integ.sdMissing'));
    const btn = $('#sdInstall');
    btn.hidden = !IS_LOCAL || !sd.found;
    setText(btn.querySelector('span'), sd.installed ? t('integ.sdUpdate') : t('integ.sdInstall'));
    setText($('#apiUrl'), `${location.origin}/api/action`);
  }

  function hotkeysHtml() {
    const rows = ACTIONS.map(
      (id) =>
        `<tr><td>${esc(t(`action.${id}`))}</td><td><button class="hk" data-hk="${id}"></button><span class="hk-err" data-hk-err="${id}"></span></td><td><button class="btn icon sm" data-hk-reset="${id}" title="${esc(t('hk.reset'))}"><i data-icon="restart"></i></button> <button class="btn icon sm" data-hk-clear="${id}" title="${esc(t('hk.clear'))}"><i data-icon="x"></i></button></td></tr>`,
    ).join('');
    return `<p class="lead">${esc(t('hk.lead'))}</p>
      <table class="hk-table"><tbody>${rows}</tbody></table>
      <p class="hint warn" id="hkSuspended"></p>`;
  }

  function renderSettingsPage() {
    const form = $('#settingsForm');
    const scrollY = window.scrollY;
    form.innerHTML = SECTIONS().map((sec) => {
      let body;
      if (sec.custom === 'network') body = networkHtml();
      else if (sec.custom === 'hotkeys') body = hotkeysHtml();
      else if (sec.custom === 'integrations') body = integrationsHtml();
      else body = (sec.lead ? `<p class="lead">${esc(t(sec.lead))}</p>` : '') + sec.fields.map(fieldHtml).join('');
      return `<div class="card" id="${sec.id}"><div class="card-head"><h2>${esc(t(sec.title))}</h2></div>${body}${sec.extra || ''}</div>`;
    }).join('');
    hydrateIcons(form);
    bindSettings(form);
    window.scrollTo(0, scrollY);
  }

  function renderNetwork() {
    const box = $('#lanUrls');
    if (!box) return;
    const lan = live.lan || {};
    let html;
    if (!lan.enabled) {
      html = `<p class="hint">${esc(t('net.off'))}</p>`;
    } else if (!lan.urls.length) {
      html = `<p class="hint warn">${esc(t('net.noAddress'))}</p>`;
    } else {
      html =
        `<div class="btn-row"><button class="btn sm" data-open-phone><i data-icon="qr"></i>${esc(t('net.showQr'))}</button><button class="btn sm" data-action="token:regen"><i data-icon="refresh"></i>${esc(t('net.regen'))}</button></div>` +
        lan.urls
          .map((u) => `<div class="url-row"><code>${esc(u.url)}</code><button class="btn icon sm" data-copy="${esc(u.url)}" title="${esc(t('common.copy'))}"><i data-icon="copy"></i></button></div><small class="hint">${esc(u.name)}</small>`)
          .join('');
    }
    if (box._html !== html) {
      setHtml(box, html);
      hydrateIcons(box);
    }
    setText($('#dockUrl'), `http://127.0.0.1:${lan.port || location.port || 4890}/`);
  }

  // ---------------------------------------------------------------- Handy-Dialog mit QR-Code

  const phoneDialog = $('#phoneDialog');
  let phoneUrl = null; // gewählte Adresse, falls mehrere Netzwerke
  const qrCache = new Map();
  const qrSvg = (text) => {
    if (!qrCache.has(text)) qrCache.set(text, window.GlancelineQR.toSvg(text));
    return qrCache.get(text);
  };

  function openPhone() {
    if (!phoneDialog.open) phoneDialog.showModal();
    renderPhone();
  }

  function renderPhone() {
    if (!phoneDialog.open || !live) return;
    const lan = live.lan || {};
    const urls = lan.urls || [];
    let html;
    if (!lan.enabled) {
      html = `<p class="lead">${esc(t('phone.lanOff'))}</p>
        <button class="btn primary wide" data-enable-lan><i data-icon="phone"></i>${esc(t('phone.enable'))}</button>
        <p class="hint">${esc(t('net.firewallHint'))}</p>`;
    } else if (!urls.length) {
      html = `<p class="hint warn">${esc(t('phone.noAddress'))}</p>`;
    } else {
      const cur = urls.find((u) => u.url === phoneUrl) || urls[0];
      const choose =
        urls.length > 1
          ? `<div class="field"><label for="phoneNet">${esc(t('phone.network'))}</label><select id="phoneNet">${urls.map((u) => `<option value="${esc(u.url)}"${u === cur ? ' selected' : ''}>${esc(u.name)} – ${esc(new URL(u.url).hostname)}</option>`).join('')}</select></div>`
          : '';
      html = `<div class="qr-wrap"><div class="qr">${qrSvg(cur.url)}</div></div>
        <ol class="steps">
          <li>${esc(t('phone.step1'))}</li>
          <li>${esc(t('phone.step2'))}</li>
          <li>${esc(t('phone.step3'))}</li>
        </ol>
        <div class="url-row"><code>${esc(cur.url)}</code><button class="btn icon sm" data-copy="${esc(cur.url)}" title="${esc(t('common.copy'))}"><i data-icon="copy"></i></button></div>
        ${choose}
        <div class="btn-row"><button class="btn sm" data-action="token:regen"><i data-icon="refresh"></i>${esc(t('phone.newLink'))}</button></div>
        <p class="hint">${esc(t('phone.newLinkHint'))}</p>`;
    }
    const body = $('#phoneBody');
    if (body._html !== html) {
      setHtml(body, html);
      hydrateIcons(body);
    }
  }

  $('#phoneBtn').addEventListener('click', openPhone);
  for (const dlg of [phoneDialog]) {
    dlg.addEventListener('click', (e) => {
      // Klick auf den abgedunkelten Hintergrund schließt den Dialog
      const r = dlg.getBoundingClientRect();
      if (e.target === dlg && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) dlg.close();
    });
  }
  phoneDialog.addEventListener('change', (e) => {
    if (e.target.id === 'phoneNet') {
      phoneUrl = e.target.value;
      renderPhone();
    }
  });
  // Auf dem Handy selbst braucht es den Knopf nicht
  if (!IS_LOCAL) $('#phoneBtn').hidden = true;

  // ---------------------------------------------------------------- Einrichtung beim ersten Start

  const setupDialog = $('#setupDialog');

  function maybeShowSetup() {
    if (!settings || settings.general.setupDone || !IS_LOCAL || setupDialog.open) return;
    $('#setupChannel').value = settings.chat.channel || '';
    $('#setupYoutube').value = settings.chat.youtube || '';
    $('#setupKick').value = settings.chat.kick || '';
    setupDialog.showModal();
    renderSetup();
  }

  function renderSetup() {
    if (!setupDialog.open || !live) return;
    const pr = live.prompter || {};
    const o = live.obs || {};
    const rows = [
      ['Prompter', pr.kind === 'prompter' ? 'ok' : 'warn', pr.kind === 'prompter' ? t('setup.prompterFound', { name: (pr.display && pr.display.label) || 'Prompter' }) : t('setup.prompterMissing')],
      ['OBS', o.connected ? 'ok' : '', o.connected ? t('setup.obsFound') : t('setup.obsMissing')],
      ['PowerPoint', live.ppt && live.ppt.running ? 'ok' : '', t('setup.pptInfo')],
    ];
    setHtml($('#setupChecks'), rows.map(([k, cls, v]) => `<li><span class="dot ${cls}"></span><b>${esc(k)}</b><span>${esc(v)}</span></li>`).join(''));
    $('#setupAutostartRow').hidden = !(live.app && live.app.desktop);
  }

  $('#setupDone').addEventListener('click', () => {
    const channel = $('#setupChannel').value.trim().replace(/^#/, '').toLowerCase();
    const youtube = $('#setupYoutube').value.trim();
    const kick = $('#setupKick').value.trim();
    S.api('/api/settings', { chat: { channel, youtube, kick }, general: { setupDone: true } }).catch(() => note(t('note.saveFailed')));
    settings.general.setupDone = true;
    setupDialog.close();
    if (channel || youtube || kick) setTimeout(() => S.action('chat:demo').catch(() => {}), 2500);
  });
  setupDialog.addEventListener('cancel', (e) => e.preventDefault()); // nur über „Los geht's“ schließen

  // ---------------------------------------------------------------- Tastenkürzel

  const KEY_NAMES = {
    de: { Ctrl: 'Strg', CommandOrControl: 'Strg', Shift: 'Umschalt', Super: 'Win', Space: 'Leertaste', PageUp: 'Bild ↑', PageDown: 'Bild ↓' },
    en: { CommandOrControl: 'Ctrl', Super: 'Win', PageUp: 'PgUp', PageDown: 'PgDn' },
  };
  const COMMON_KEYS = { Up: '↑', Down: '↓', Left: '←', Right: '→', numadd: 'Num +', numsub: 'Num −', nummult: 'Num ×', numdiv: 'Num ÷', numdec: 'Num ,' };
  const fmtAccel = (a) =>
    a ? a.split('+').map((k) => KEY_NAMES[lang][k] || COMMON_KEYS[k] || k.replace(/^num(\d)$/, 'Num $1')).join(' + ') : '';

  const CODE_KEYS = {
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Space: 'Space', Enter: 'Enter', Tab: 'Tab',
    Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
    Pause: 'Pause', ScrollLock: 'Scrolllock',
  };
  function codeToKey(code) {
    let m;
    if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
    if ((m = /^Digit(\d)$/.exec(code))) return m[1];
    if ((m = /^Numpad(\d)$/.exec(code))) return `num${m[1]}`;
    if ((m = /^F(\d{1,2})$/.exec(code))) return `F${m[1]}`;
    return CODE_KEYS[code] || null;
  }

  const recording = { btn: null };

  function renderHotkeys() {
    if (!settings) return;
    $$('[data-hk]').forEach((b) => {
      if (b === recording.btn) return;
      const acc = settings.hotkeys[b.dataset.hk] || '';
      setText(b, acc ? fmtAccel(acc) : t('hk.none'));
      b.classList.toggle('empty', !acc);
    });
    $$('[data-clk]').forEach((b) => {
      if (b === recording.btn) return;
      const acc = settings.clicker[b.dataset.clk] || '';
      setText(b, acc ? fmtAccel(acc) : t('hk.none'));
      b.classList.toggle('empty', !acc);
    });
    renderHotkeyErrors();
  }

  function renderHotkeyErrors() {
    const errs = new Map((((live && live.hotkeys) || {}).errors || []).map((e) => [e.action, e.error]));
    $$('[data-hk-err]').forEach((n) => {
      const e = errs.get(n.dataset.hkErr);
      setText(n, e ? t(`hk.err.${e}`) : '');
    });
    $$('[data-hk]').forEach((b) => b.classList.toggle('err', errs.has(b.dataset.hk)));
    $$('[data-clk]').forEach((b) => b.classList.toggle('err', errs.has(`clicker:${b.dataset.clk}`)));
  }

  function setHotkey(id, acc) {
    const patch = { [id]: acc };
    // Doppelt vergebene Kombination beim anderen Eintrag entfernen
    if (acc) {
      for (const [other, a] of Object.entries(settings.hotkeys)) {
        if (other !== id && a && a.toLowerCase() === acc.toLowerCase()) patch[other] = '';
      }
    }
    Object.assign(settings.hotkeys, patch);
    S.api('/api/settings', { hotkeys: patch }).catch(() => note(t('note.saveFailed')));
    renderHotkeys();
  }

  function startRecording(btn) {
    stopRecording();
    recording.btn = btn;
    btn.classList.add('rec');
    btn.textContent = t('hk.press');
    S.action('hotkeys:suspend').catch(() => {});
    document.addEventListener('keydown', onRecordKey, true);
  }

  function stopRecording() {
    if (!recording.btn) return;
    recording.btn.classList.remove('rec');
    recording.btn = null;
    document.removeEventListener('keydown', onRecordKey, true);
    S.action('hotkeys:resume').catch(() => {});
    renderHotkeys();
  }

  function onRecordKey(e) {
    e.preventDefault();
    e.stopPropagation();
    const btn = recording.btn;
    if (e.key === 'Escape') {
      stopRecording();
      return;
    }
    const mods = [];
    if (e.ctrlKey) mods.push('Ctrl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Super');
    const key = codeToKey(e.code);
    if (!key) {
      btn.textContent = mods.length ? `${fmtAccel(mods.join('+'))} + …` : t('hk.pressShort');
      return;
    }
    if (btn.dataset.clk) {
      const slot = btn.dataset.clk;
      stopRecording();
      sendSetting(`clicker.${slot}`, [...mods, key].join('+'));
      renderHotkeys();
      return;
    }
    if (!mods.length && !/^F\d+$/.test(key)) {
      btn.textContent = t('hk.needModifier');
      return;
    }
    const id = btn.dataset.hk;
    stopRecording();
    setHotkey(id, [...mods, key].join('+'));
  }

  // ---------------------------------------------------------------- Live-Seite

  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      renderLive();
    });
  }

  function renderLive() {
    if (!live || !settings || !scripts) return;
    $$('#modes button').forEach((b) => b.classList.toggle('active', b.dataset.mode === live.mode));
    $('#blackoutBtn').classList.toggle('active', Boolean(live.blackout));
    $$('.mode-card').forEach((c) => c.classList.toggle('active', c.dataset.card === live.mode));
    renderChips();
    renderScriptCard();
    renderChatCard();
    renderObsCard();
    renderPptCard();
    renderCamCard();
    renderVoice();
    renderPhase1();
    renderShow();
    renderFolder();
    renderIntegrations();
    renderConn();
    renderNetwork();
    renderPhone();
    renderSetup();
    renderHotkeyErrors();
    fillDyn();
    setText($('#hkSuspended'), live.hotkeys.suspended ? t('hk.suspended') : '');
    const os = $('#obsSettingsState');
    if (os) {
      setText(os, live.obs.connected ? t('settings.obsConnected') : t(live.obs.error || ''));
      os.className = `hint ${live.obs.connected ? '' : 'bad'}`;
    }
    const as = $('#autostartState');
    if (as) {
      const app = live.app || {};
      const want = settings.general.autostart;
      setText(as, !app.desktop ? t('autostart.desktopOnly') : app.autostart ? t('autostart.active') : want ? t('autostart.failed') : t('autostart.off'));
      as.className = `hint ${app.desktop && want && !app.autostart ? 'bad' : ''}`;
    }
  }

  const chip = (cls, text) => `<span class="chip ${cls}">${esc(text)}</span>`;

  // Kurzbeschreibung des Zustands von YouTube- und Kick-Chat
  const viewersText = (n) => (n == null ? '' : ` · ${t('chat.viewers', { n: n.toLocaleString(locale) })}`);
  const used = (x) => Boolean(x && x.state && x.state !== 'off');
  function ytText(yt) {
    if (yt.state === 'error') return t(yt.error, yt.errorVars);
    if (yt.state === 'live') return `${yt.channel} · ${t('state.live')}${viewersText(yt.viewers)}`;
    if (yt.state === 'offline') return `${yt.channel} · ${yt.error ? t(yt.error, yt.errorVars) : t('state.notLive')}`;
    return `${yt.channel} · ${t('state.searching')}`;
  }
  function kickText(kk) {
    if (kk.state === 'error') return t(kk.error, kk.errorVars);
    if (kk.connected) return `kick.com/${kk.channel} · ${kk.live ? `${t('state.live')}${viewersText(kk.viewers)}` : t('state.notLive')}`;
    return `${kk.channel} · ${t('state.connecting')}`;
  }
  const ytCls = (yt) => (yt.state === 'live' ? 'ok' : yt.state === 'error' ? 'bad' : yt.state === 'offline' ? '' : 'warn');
  const kickCls = (kk) => (kk.state === 'error' ? 'bad' : kk.connected ? (kk.live ? 'ok' : '') : 'warn');

  function renderChips() {
    const out = [];
    const p = live.prompter || {};
    if (p.kind === 'prompter') out.push(chip('ok', 'Prompter'));
    else if (p.kind === 'test') out.push(chip('warn', t('chip.testWindow')));
    else if (p.kind === 'virtual') out.push(chip('ok', t('chip.virtual')));
    else if (live.clients.main) out.push(chip('ok', t('chip.prompterView')));
    else out.push(chip('bad', t('chip.noPrompter')));
    const tw = live.twitch || {};
    if (tw.channel) out.push(tw.joined ? chip('ok', `#${tw.channel}`) : tw.connected ? chip('warn', 'Twitch …') : chip('bad', 'Twitch'));
    if (used(live.youtube)) out.push(chip(ytCls(live.youtube), 'YouTube'));
    if (used(live.kick)) out.push(chip(kickCls(live.kick), 'Kick'));
    const o = live.obs || {};
    out.push(!o.connected ? chip('bad', 'OBS') : o.streaming ? chip('live', `LIVE ${S.fmtDur(o.streamMs + obsSince())}`) : chip('ok', 'OBS'));
    const pp = live.ppt || {};
    if (pp.running) out.push(pp.mode === 'show' ? chip('ok', t('chip.slide', { n: pp.slide, total: pp.total })) : chip('', 'PowerPoint'));
    setHtml($('#chips'), out.join(''));
  }

  function renderScriptCard() {
    const items = scripts.items;
    const sel = $('#scriptSelect');
    const sig = JSON.stringify([items.map((i) => [i.id, i.title]), scripts.activeId, lang]);
    if (sel._sig !== sig) {
      sel._sig = sig;
      sel.innerHTML = items.length
        ? items.map((i) => `<option value="${esc(i.id)}">${esc(i.title || t('scripts.untitled'))}</option>`).join('')
        : `<option value="">${esc(t('scripts.none'))}</option>`;
      sel.value = scripts.activeId || '';
    }

    const sc = live.script;
    const btn = $('#playBtn');
    const label = sc.playing ? t('script.pause') : sc.pos > 2 && sc.pos < sc.max - 2 ? t('script.resume') : t('script.start');
    setText(btn.querySelector('span'), label);
    setIcon(btn.querySelector('i'), sc.playing ? 'pause' : 'play');

    const frac = sc.max > 0 ? Math.min(1, sc.pos / sc.max) : 0;
    $('#scriptProgress i').style.width = `${(frac * 100).toFixed(1)}%`;
    setText($('#scriptPct'), `${Math.round(frac * 100)} %`);
    const remain = sc.max > 0 && settings.script.speed > 0 ? (sc.max - sc.pos) / settings.script.speed : 0;
    setText($('#scriptRemain'), sc.max > 0 ? t('script.remaining', { time: S.fmtDur(remain * 1000) }) : '');

    const active = items.find((i) => i.id === scripts.activeId);
    const body = active ? active.body : '';
    const list = $('#sectionList');
    if (list._body !== body) {
      list._body = body;
      list.innerHTML = S.renderScript(body)
        .sections.map((s, i) => `<li class="l${s.level}"><button data-section="${i}"><span>${i + 1}</span>${esc(s.title.replace(/\*\*|==|[*[\]]/g, ''))}${s.target ? `<em class="tgt">${S.fmtDur(s.target * 1000)}</em>` : ''}</button></li>`)
        .join('');
    }
  }

  function renderChatCard() {
    const tw = live.twitch || {};
    const yt = live.youtube || {};
    const kk = live.kick || {};
    const anyChat = tw.channel || used(yt) || used(kk);
    const anyOk = tw.joined || yt.state === 'live' || kk.connected;
    setState($('#chatState'), !anyChat ? ['', t('chat.noChannel')] : anyOk ? ['ok', t('state.connected')] : tw.connected || yt.state === 'searching' || kk.state === 'searching' ? ['warn', t('state.connecting')] : ['bad', t('state.disconnected')]);
    const e = tw.emotes;
    const prov = settings.chat.providers;
    const fmtE = (on, x) => (!on ? t('state.off') : !x ? t('state.loading') : t('chat.emoteCount', { channel: x.channel, global: x.global }));
    const stv = tw.seventvLive || {};
    const stvLive = !prov.seventv
      ? t('state.off')
      : !tw.joined || !e
        ? '–'
        : !stv.setId
          ? t('chat.stvNoSet')
          : stv.connected
            ? t('chat.stvLive')
            : `${t('state.connecting')}${stv.error ? ` (${stv.error})` : ''}`;
    const facts = [
      ['Twitch', tw.channel ? `#${tw.channel}${tw.joined ? viewersText(tw.viewers) : ` · ${t('state.connecting')}`}` : anyChat ? t('state.off') : t('chat.noChannelHint')],
      ['7TV', fmtE(prov.seventv, e && e.seventv)],
      [t('chat.stvLiveLabel'), stvLive],
      ['BTTV', fmtE(prov.bttv, e && e.bttv)],
      ['FFZ', fmtE(prov.ffz, e && e.ffz)],
    ];
    if (used(yt)) facts.splice(1, 0, ['YouTube', ytText(yt)]);
    if (used(kk)) facts.splice(used(yt) ? 2 : 1, 0, ['Kick', kickText(kk)]);
    if (tw.error && tw.channel) facts.push([t('chat.notice'), t(tw.error, tw.errorVars)]);
    setFacts($('#chatFacts'), facts);
    setText($('#emoteErrors'), (tw.emoteErrors || []).map((x) => (typeof x === 'string' ? x : `${t(`src.${x.src}`)}: ${x.msg}`)).join(' · '));
  }

  function renderObsCard() {
    const o = live.obs || {};
    const since = obsSince();
    setState($('#obsCardState'), !o.connected ? ['bad', t('state.disconnected')] : o.streaming ? ['live', 'LIVE'] : ['ok', t('state.connected')]);
    setText($('#obsBig'), o.connected && o.streaming ? S.fmtDur(o.streamMs + since) : 'Offline');
    const facts = [];
    if (!o.connected) {
      facts.push([t('obs.status'), t(o.error || 'err.obs.notConnected')]);
    } else {
      facts.push([t('obs.scene'), o.scene || '–']);
      facts.push([t('obs.recording'), o.recording ? `${o.recordPaused ? t('obs.recPaused') : t('obs.recRunning')} · ${S.fmtDur(o.recordMs + (o.recordPaused ? 0 : since))}` : t('state.off')]);
      if (o.streaming) {
        const pct = o.totalFrames ? (o.dropped / o.totalFrames) * 100 : 0;
        facts.push(['Bitrate', `${(o.kbps / 1000).toFixed(1)} Mbit/s`]);
        facts.push(['Drops', `${o.dropped} (${pct.toFixed(1)} %)`]);
      }
      facts.push([t('obs.performance'), `${Math.round(o.fps || 0)} FPS · CPU ${typeof o.cpu === 'number' ? Math.round(o.cpu) : '–'} %`]);
    }
    setFacts($('#obsFacts'), facts);
  }

  function pptElapsed() {
    const tm = live.ppt.timer;
    return tm.acc + (tm.running ? serverNow() - tm.startedAt : 0);
  }

  function renderPptCard() {
    const p = live.ppt;
    const state = !p.running
      ? ['', t('ppt.notOpen')]
      : p.mode === 'show'
        ? ['ok', t('ppt.running')]
        : p.mode === 'end'
          ? ['warn', t('ppt.end')]
          : p.mode === 'edit'
            ? ['warn', t('ppt.editing')]
            : ['', t('ppt.open')];
    setState($('#pptState'), state);
    setText($('#pptTimer'), S.fmtDur(pptElapsed()));
    const tg = $('#pptTimerToggle');
    setText(tg.querySelector('span'), p.timer.running ? t('script.pause') : t('script.start'));
    setIcon(tg.querySelector('i'), p.timer.running ? 'pause' : 'play');
    const facts = [];
    if (p.running && p.mode !== 'none') {
      facts.push([t('ppt.file'), p.file || '–']);
      if (p.slide) facts.push([t('ppt.slide'), `${p.slide} / ${p.total}${p.title ? ` – ${p.title}` : ''}`]);
      if (p.nextTitle) facts.push([t('ppt.next'), p.nextTitle]);
    } else {
      facts.push([t('chat.notice'), t('ppt.hint')]);
    }
    setFacts($('#pptFacts'), facts);
    setText($('#pptNotesPreview'), p.notes || '');
  }

  // Show-Timer & Zeitplan
  function renderShow() {
    const sh = live.show || { running: false, acc: 0, startedAt: 0 };
    const tm = settings.timers;
    const clock = S.showClock(sh, tm, serverNow());
    const timeEl = $('#showTime');
    setText(timeEl, clock.left == null ? S.fmtDur(clock.elapsed) : clock.left < 0 ? S.fmtSigned(-clock.left) : S.fmtDur(clock.left));
    timeEl.classList.toggle('over', clock.left != null && clock.left < 0);
    const tg = $('#showToggle');
    setText(tg.querySelector('span'), sh.running ? t('script.pause') : t('script.start'));
    setIcon(tg.querySelector('i'), sh.running ? 'pause' : 'play');

    const parts = [];
    if (clock.total) {
      const cls = clock.left < 0 ? 'over' : clock.left <= tm.warn * 60000 ? 'warn' : '';
      parts.push(`<span>${esc(t('show.of', { total: S.fmtDur(clock.total) }))}</span>`);
      parts.push(`<span class="${cls}">${esc(clock.left < 0 ? t('show.over', { time: S.fmtDur(-clock.left) }) : t('show.left', { time: S.fmtDur(clock.left) }))}</span>`);
    } else if (!clock.started) {
      parts.push(`<span>${esc(t(tm.start === 'script' ? 'show.autoScript' : tm.start === 'stream' ? 'show.autoStream' : 'show.manual'))}</span>`);
    }
    const active = scripts.items.find((i) => i.id === scripts.activeId);
    const sec = live.section;
    if (active && sec && sec.id === active.id) {
      const ros = S.runOfShow(S.renderScript(active.body).sections, sec, clock.elapsed);
      if (ros) {
        const title = ros.title.replace(/\*\*|==|[*[\]]/g, '');
        parts.push(`<span>§ ${esc(title)} · ${S.fmtDur(ros.inSec)}${ros.target ? ` / ${S.fmtDur(ros.target)}` : ''}</span>`);
        const d = Math.abs(ros.delta) < 1000 ? 0 : ros.delta;
        parts.push(`<span class="${d > 0 ? 'behind' : 'ahead'}">${esc(d > 0 ? t('show.behind', { time: S.fmtDur(d) }) : d < 0 ? t('show.ahead', { time: S.fmtDur(-d) }) : t('show.onTime'))}</span>`);
      }
    }
    setHtml($('#showDetail'), parts.join(''));
  }

  function renderPhase1() {
    if (!live || !settings || !scripts) return;
    // Durchreich-Modus
    $('#passthroughBtn').classList.toggle('active', Boolean(live.passthrough));
    // Chat-Pause
    const c = live.chat || {};
    const held = c.paused || c.offset > 0;
    setText($('#chatPauseBtn span'), held ? t('chat.resume') : t('chat.pause'));
    setIcon($('#chatPauseBtn i'), held ? 'play' : 'pause');
    setText($('#chatPauseState'), c.offset > 0 ? t('p.chatRewind', { n: c.offset }) : c.paused ? t('p.chatPaused') : '');
    // Einschübe
    const insertHtml = [1, 2, 3, 4]
      .map((n) => {
        const it = scripts.items.find((x) => x.id === settings.inserts[n]);
        if (!it) return '';
        const running = live.insert && String(live.insert.slot) === String(n);
        const label = running ? t('inserts.back') : it.title || t('scripts.untitled');
        return `<button class="btn sm${running ? ' running' : ''}" data-action="insert:${n}" title="${esc(t('inserts.slot', { n }))}"><i data-icon="insert"></i>${esc(label)}</button>`;
      })
      .join('');
    const row = $('#insertRow');
    if (row._html !== insertHtml) {
      setHtml(row, insertHtml);
      hydrateIcons(row);
    }
    // Regie
    const presets = (settings.director.presets || []).map((p, i) => `<button class="btn sm" data-preset="${i}">${esc(p)}</button>`).join('');
    setHtml($('#directorPresets'), presets);
    const d = live.director;
    const left = d ? Math.ceil((d.until - serverNow()) / 1000) : 0;
    setHtml($('#directorState'), d && left > 0 ? `<span>${esc(t('director.showing'))} <b>${esc(d.text)}</b> · ${left} s</span><button class="link" data-action="director:clear">${esc(t('director.clear'))}</button>` : '');
    // Szenen → Modus
    const box = $('#sceneModes');
    if (box) {
      const scenes = obsSources.scenes || [];
      const map = settings.obsAuto.sceneModes || {};
      const html = scenes.length
        ? `<table class="scene-table"><tbody>${scenes
            .map((sc) => `<tr><td>${esc(sc)}</td><td><select data-scene="${esc(sc)}">${[['', t('obsAuto.noChange')], ...MODE_OPTIONS()]
              .map(([v, l]) => `<option value="${v}"${(map[sc] || '') === v ? ' selected' : ''}>${esc(l)}</option>`)
              .join('')}</select></td></tr>`)
            .join('')}</tbody></table>`
        : `<p class="hint">${esc(t('obsAuto.noScenes'))}</p>`;
      if (document.activeElement && document.activeElement.dataset && document.activeElement.dataset.scene != null) return;
      setHtml(box, html);
    }
  }

  function renderVoice() {
    const v = live.voice || {};
    const on = settings.voice.enabled;
    const langName = t(`lang.${v.lang || 'en'}`);
    let html = '';
    if (v.state === 'downloading') {
      const pct = Math.round((v.progress || 0) * 100);
      html = `${esc(t('voice.downloading', { pct }))}<div class="progress"><i style="width:${pct}%"></i></div>`;
    } else if (on) {
      if (v.state === 'missing') html = `${esc(t('voice.missing', { lang: langName }))}<br><button class="btn sm primary" data-action="voice:download"><i data-icon="download"></i>${esc(t('voice.download'))}</button>`;
      else if (v.state === 'loading') html = esc(t('voice.loading'));
      else if (v.state === 'error') html = `<span class="bad">${esc(t(v.error))}</span>`;
      else if (v.state === 'ready') {
        html = esc(live.script.playing && live.mode === 'script' ? t('voice.listening') : t('voice.ready'));
        if (v.heard) html += `<span class="heard">${esc(t('voice.heard', { text: v.heard }))}</span>`;
      }
    }
    const box = $('#voiceDetail');
    if (box._html !== html) {
      setHtml(box, html);
      hydrateIcons(box);
    }
    $('#voiceLevel i').style.width = `${Math.round((live.voiceLevel || 0) * 100)}%`;
    $('#voiceLevel').style.visibility = on ? 'visible' : 'hidden';

    const list = $('#voiceModels');
    if (list) {
      const inst = v.installed || [];
      setHtml(list, VOICE_LANGS.map((l) => {
        const has = inst.includes(l);
        const btn = has
          ? `<button class="btn sm" data-action="voice:delete" data-lang="${l}"><i data-icon="trash"></i>${esc(t('voice.remove'))}</button>`
          : `<button class="btn sm" data-action="voice:download" data-lang="${l}"${v.state === 'downloading' ? ' disabled' : ''}><i data-icon="download"></i>${esc(t('voice.get'))}</button>`;
        return `<li><b>${esc(t(`lang.${l}`))}</b><span class="${has ? '' : 'hint'}">${esc(has ? t('voice.installed') : '~70 MB')}</span><span class="push"></span>${btn}</li>`;
      }).join(''));
      hydrateIcons(list);
    }
  }

  function renderCamCard() {
    const c = live.camera || {};
    const s = settings.camera;
    const want = (s.enabled || live.mode === 'camera') && !live.blackout;
    setState($('#camState'), c.active ? ['ok', t('camera.active')] : c.error ? ['bad', t('camera.error')] : want ? ['warn', t('camera.starting')] : ['', t('state.off')]);
    const info = c.error
      ? t(c.error)
      : c.active
        ? t('camera.source', { name: c.label || 'Webcam' })
        : s.source === 'obs'
          ? t('camera.obsSource', { name: s.obsSource || t('camera.noneChosen') })
          : t('camera.webcam', { name: s.deviceLabel || t('camera.automatic') });
    const node = $('#camInfo');
    setText(node, info);
    node.classList.toggle('bad', Boolean(c.error));
  }

  function renderConn() {
    const tw = live.twitch || {};
    const o = live.obs || {};
    const p = live.ppt || {};
    const pr = live.prompter || {};
    const emoteTotal = tw.emotes ? Object.values(tw.emotes).reduce((n, x) => n + x.channel + x.global, 0) : 0;
    const rows = [
      [
        'Twitch',
        !tw.channel ? '' : tw.joined ? 'ok' : tw.connected ? 'warn' : 'bad',
        !tw.channel ? t('chat.noChannelHint') : tw.joined ? t('conn.twitchOk', { channel: tw.channel, n: emoteTotal }) : t(tw.error || 'state.connecting', tw.errorVars),
      ],
      ...(used(live.youtube) ? [['YouTube', ytCls(live.youtube), ytText(live.youtube)]] : []),
      ...(used(live.kick) ? [['Kick', kickCls(live.kick), kickText(live.kick)]] : []),
      ['OBS', o.connected ? 'ok' : 'bad', o.connected ? `${o.streaming ? 'LIVE' : t('conn.obsReady')}${o.scene ? ` · ${o.scene}` : ''}` : t(o.error || 'err.obs.notConnected')],
      ['PowerPoint', p.running ? 'ok' : '', p.running ? (p.mode === 'show' ? t('conn.pptShow', { n: p.slide, total: p.total }) : p.file || t('ppt.open')) : t('ppt.notOpen')],
      [
        'Prompter',
        pr.kind === 'prompter' || pr.kind === 'virtual' ? 'ok' : pr.kind === 'test' ? 'warn' : live.clients.main ? 'ok' : 'bad',
        pr.kind === 'prompter'
          ? `${(pr.display && pr.display.label) || 'Display'} · ${t('camera.active')}`
          : pr.kind === 'virtual'
            ? t('conn.virtual')
          : pr.kind === 'test'
            ? t('conn.testWindow')
            : live.clients.main
              ? t('conn.browserView')
              : t('conn.notFound'),
      ],
    ];
    setHtml($('#connList'), rows.map(([k, cls, v]) => `<li><span class="dot ${cls}"></span><b>${k}</b><span>${esc(v)}</span></li>`).join(''));
  }

  function scalePreview() {
    const box = $('#preview');
    const w = box.clientWidth;
    if (w) $('#previewFrame').style.transform = `scale(${w / 1024})`;
  }

  // ---------------------------------------------------------------- Skript-Editor

  const ed = { id: null, dirty: false, timer: null, deleteArmed: null };
  const titleInput = $('#scriptTitle');
  const bodyInput = $('#scriptBody');
  const currentScript = () => (scripts ? scripts.items.find((x) => x.id === ed.id) : null);

  function renderScriptList() {
    const list = $('#scriptList');
    const html = scripts.items.length
      ? scripts.items
          .map(
            (it) =>
              `<li><button data-script-id="${esc(it.id)}" class="${it.id === ed.id ? 'sel' : ''}"><strong>${esc(it.title || t('scripts.untitled'))}${it.file ? `<span class="linked">${esc(fileExt(it.file))}</span>` : ''}${it.id === scripts.activeId ? `<span class="on-air">${esc(t('scripts.onAir'))}</span>` : ''}</strong><small>${esc(t('scripts.listMeta', { words: countWords(it.body), date: fmtDate(it.updatedAt) }))}</small></button></li>`,
          )
          .join('')
      : `<li class="hint">${esc(t('scripts.empty'))}</li>`;
    setHtml(list, html);
  }

  function updateEditorMeta() {
    const it = currentScript();
    const words = countWords(bodyInput.value);
    setText($('#scriptStats'), it ? t('scripts.stats', { words, time: S.fmtDur((words / 140) * 60000) }) : '');
    const isActive = Boolean(it) && it.id === scripts.activeId;
    const act = $('#activateScript');
    act.disabled = !it || isActive;
    setText(act.querySelector('span'), isActive ? t('scripts.isActive') : t('scripts.activate'));
    const del = $('#deleteScript');
    del.disabled = !it || Boolean(it.file);
    $('#exportScript').disabled = !it;
    const ln = $('#linkedNote');
    ln.hidden = !(it && it.file);
    if (it && it.file) setText(ln.querySelector('span'), t('library.linked', { file: it.file }));
    if (!ed.deleteArmed) setText(del.querySelector('span'), t('scripts.delete'));
    const ss = $('#saveState');
    setText(ss, !it ? '' : it.file ? t('library.liveSync') : ed.dirty ? t('scripts.unsaved') : t('scripts.saved'));
    ss.classList.toggle('dirty', ed.dirty);
  }

  function disarmDelete() {
    clearTimeout(ed.deleteArmed);
    ed.deleteArmed = null;
    const b = $('#deleteScript');
    b.classList.remove('danger', 'armed');
    setText(b.querySelector('span'), t('scripts.delete'));
  }

  function openScript(id) {
    if (ed.dirty) saveScript();
    const it = scripts.items.find((x) => x.id === id) || null;
    ed.id = it ? it.id : null;
    ed.dirty = false;
    disarmDelete();
    titleInput.value = it ? it.title : '';
    bodyInput.value = it ? it.body : '';
    titleInput.disabled = !it || Boolean(it.file);
    bodyInput.disabled = !it;
    bodyInput.readOnly = Boolean(it && it.file); // Datei-Skripte nur ansehen – bearbeitet wird in der Datei
    renderScriptList();
    updateEditorMeta();
  }

  function onEdit() {
    if (!ed.id) return;
    const cur = currentScript();
    if (cur && cur.file) return;
    ed.dirty = true;
    updateEditorMeta();
    clearTimeout(ed.timer);
    ed.timer = setTimeout(saveScript, 500);
  }

  async function saveScript() {
    clearTimeout(ed.timer);
    if (!ed.dirty || !ed.id) return;
    ed.dirty = false;
    const id = ed.id;
    const title = titleInput.value;
    const body = bodyInput.value;
    const it = scripts.items.find((x) => x.id === id);
    if (it) Object.assign(it, { title, body });
    try {
      await S.api('/api/scripts', { op: 'save', id, title, body });
    } catch {
      ed.dirty = true;
      note(t('note.saveFailed'));
    }
    updateEditorMeta();
  }

  function onScripts(sc) {
    scripts = sc;
    if (!ed.id || !sc.items.some((x) => x.id === ed.id)) {
      openScript(sc.activeId || (sc.items[0] && sc.items[0].id));
    } else if ((!ed.dirty && document.activeElement !== bodyInput && document.activeElement !== titleInput) || (currentScript() && currentScript().file)) {
      const it = currentScript();
      if (titleInput.value !== it.title) titleInput.value = it.title;
      if (bodyInput.value !== it.body) bodyInput.value = it.body;
    }
    renderScriptList();
    updateEditorMeta();
    scheduleRender();
  }

  titleInput.addEventListener('input', onEdit);
  bodyInput.addEventListener('input', onEdit);
  [titleInput, bodyInput].forEach((n) =>
    n.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveScript();
      }
    }),
  );
  window.addEventListener('beforeunload', () => saveScript());

  $('#newScript').addEventListener('click', async () => {
    await saveScript();
    try {
      const r = await S.api('/api/scripts', { op: 'create', title: t('scripts.newTitle'), body: '' });
      if (!r.ok) throw new Error(r.error);
      if (!scripts.items.some((x) => x.id === r.id)) scripts.items.push(r.item);
      openScript(r.id);
      titleInput.focus();
      titleInput.select();
    } catch {
      note(t('note.createFailed'));
    }
  });

  // ---------- Import, Export, Einfügen mit Formatierung

  const D = window.GlancelineDocx;
  function fileExt(f) {
    return (String(f).match(/\.(\w+)$/) || ['', ''])[1].toUpperCase();
  }

  async function fileToScript(file) {
    const name = file.name.replace(/\.[^.]+$/, '');
    if (/\.docx$/i.test(file.name)) return { title: name, body: await D.docxToScript(new Uint8Array(await file.arrayBuffer()), D.browserInflate) };
    if (/\.(md|markdown|txt)$/i.test(file.name)) return { title: name, body: (await file.text()).replace(/^\uFEFF/, '') };
    throw new Error('type');
  }

  async function importFiles(files) {
    await saveScript();
    let last = null;
    let failed = 0;
    for (const f of files) {
      try {
        const { title, body } = await fileToScript(f);
        const r = await S.api('/api/scripts', { op: 'create', title, body });
        if (!r.ok) throw new Error(r.error);
        if (!scripts.items.some((x) => x.id === r.id)) scripts.items.push(r.item);
        last = r.id;
      } catch {
        failed++;
      }
    }
    if (last) openScript(last);
    if (failed) note(t('scripts.importFailed', { n: failed }));
    else if (last) note(t('scripts.imported', { n: files.length }));
  }

  $('#importScript').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) importFiles(files);
  });

  // Dateien auf die Skripte-Seite ziehen
  const scriptsPage = $('#page-scripts');
  scriptsPage.addEventListener('dragover', (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    scriptsPage.classList.add('dropping');
  });
  scriptsPage.addEventListener('dragleave', (e) => {
    if (!scriptsPage.contains(e.relatedTarget)) scriptsPage.classList.remove('dropping');
  });
  scriptsPage.addEventListener('drop', (e) => {
    scriptsPage.classList.remove('dropping');
    const files = [...e.dataTransfer.files].filter((f) => /\.(md|markdown|txt|docx)$/i.test(f.name));
    if (!files.length) return;
    e.preventDefault();
    importFiles(files);
  });

  $('#exportScript').addEventListener('click', async () => {
    await saveScript();
    const it = currentScript();
    if (!it) return;
    const blob = new Blob([it.body], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(it.title || 'script').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'script'}.md`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });

  $('#editLinked').addEventListener('click', () => {
    if (ed.id) S.action('library:edit', { id: ed.id }).catch(() => {});
  });

  // Aus Word, Google Docs oder Webseiten einfügen: fett, kursiv, Markierungen und Überschriften bleiben erhalten
  bodyInput.addEventListener('paste', (e) => {
    if (bodyInput.readOnly) return;
    const html = e.clipboardData && e.clipboardData.getData('text/html');
    if (!html || !/<(b|strong|i|em|mark|h[1-6])[\s>]|font-weight|font-style|mso-highlight|background/i.test(html)) return;
    let text;
    try {
      text = D.htmlToScript(html);
    } catch {
      return;
    }
    if (!text) return;
    e.preventDefault();
    bodyInput.setRangeText(text, bodyInput.selectionStart, bodyInput.selectionEnd, 'end');
    onEdit();
  });

  function renderFolder() {
    const f = live.folder || {};
    const info = $('#folderInfo');
    setText(info, f.error ? t(f.error) : f.folder ? t('library.info', { folder: f.folder, n: f.files }) : t('library.hint'));
    info.classList.toggle('bad', Boolean(f.error));
    $('#folderOpen').hidden = !f.folder;
    $('#folderClear').hidden = !f.folder;
  }

  $('#deleteScript').addEventListener('click', async () => {
    const b = $('#deleteScript');
    if (!ed.deleteArmed) {
      b.classList.add('danger', 'armed');
      setText(b.querySelector('span'), t('scripts.confirmDelete'));
      ed.deleteArmed = setTimeout(disarmDelete, 3500);
      return;
    }
    const id = ed.id;
    disarmDelete();
    ed.dirty = false;
    ed.id = null;
    await S.api('/api/scripts', { op: 'delete', id }).catch(() => note(t('note.deleteFailed')));
  });

  $('#activateScript').addEventListener('click', async () => {
    await saveScript();
    await S.api('/api/scripts', { op: 'activate', id: ed.id }).catch(() => {});
    S.action('mode:script').catch(() => {});
  });

  // ---------------------------------------------------------------- Ereignisse

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const d = btn.dataset;
    if (d.action) {
      const extra = {};
      if (d.target) extra.target = d.target;
      if (d.lang) extra.lang = d.lang;
      S.action(d.action, extra).catch(() => note(t('note.actionFailed')));
    } else if (d.mode) {
      S.action(`mode:${d.mode}`).catch(() => note(t('note.actionFailed')));
    } else if (d.tab) {
      showTab(d.tab);
    } else if (d.goto) {
      showTab(d.goto);
      if (d.anchor) {
        const target = document.getElementById(d.anchor);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } else if (d.section != null) {
      S.action('script:section', { index: Number(d.section) });
    } else if (d.scriptId) {
      openScript(d.scriptId);
    } else if (d.clk) {
      startRecording(btn);
    } else if (d.preset != null) {
      S.action('director:send', { text: settings.director.presets[Number(d.preset)] }).catch(() => note(t('note.actionFailed')));
    } else if (d.hk) {
      startRecording(btn);
    } else if (d.hkReset) {
      setHotkey(d.hkReset, defaults.hotkeys[d.hkReset] || '');
    } else if (d.hkClear) {
      setHotkey(d.hkClear, '');
    } else if (d.copy) {
      copy(d.copy);
    } else if (d.copyFrom) {
      copy($(`#${d.copyFrom}`).textContent);
    } else if (btn.id === 'reloadSources') {
      loadObsSources(true);
    } else if (btn.hasAttribute('data-open-phone')) {
      openPhone();
    } else if (btn.hasAttribute('data-enable-lan')) {
      sendSetting('general.lan', true);
    } else if (btn.hasAttribute('data-close-dialog')) {
      btn.closest('dialog').close();
    }
  });

  $('#scriptSelect').addEventListener('change', (e) => S.action('script:select', { id: e.target.value }));
  $('#scriptProgress').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    S.action('script:seek', { frac: (e.clientX - r.left) / r.width });
  });

  new ResizeObserver(scalePreview).observe($('#preview'));

  // Regie-Nachricht senden (Knopf oder Enter)
  function sendDirector() {
    const input = $('#directorText');
    const text = input.value.trim();
    if (!text) return;
    S.action('director:send', { text })
      .then(() => { input.value = ''; })
      .catch(() => note(t('note.actionFailed')));
  }
  $('#directorSend').addEventListener('click', sendDirector);
  $('#directorText').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendDirector();
  });

  // OBS-Szene → Modus
  document.addEventListener('change', (e) => {
    if (!e.target.dataset || e.target.dataset.scene == null) return;
    const map = {};
    $$('select[data-scene]').forEach((sel) => { if (sel.value) map[sel.dataset.scene] = sel.value; });
    sendSetting('obsAuto.sceneModes', map);
  });

  // Laufende Uhren (Timer, Stream-Dauer) auch ohne neue Daten weiterzählen
  setInterval(() => {
    if (!live || !settings) return;
    renderChips();
    renderObsCard();
    renderPptCard();
    renderPhase1(); // Restzeit der Regie-Nachricht
    renderShow();
  }, 1000);

  // ---------------------------------------------------------------- Start

  hydrateIcons();
  bindSettings(setupDialog);
  applyLanguage();
  let startTab = 'live';
  try { startTab = localStorage.getItem('glanceline.tab') || 'live'; } catch { /* egal */ }
  showTab(['live', 'scripts', 'settings'].includes(startTab) ? startTab : 'live');

  S.connect('panel', {
    init(d) {
      settings = d.settings;
      live = d.live;
      defaults = d.defaults || defaults;
      clockOffset = live.now - Date.now();
      applyLanguage();
      refreshSettings();
      renderHotkeys();
      onScripts(d.scripts);
      scheduleRender();
      maybeShowSetup();
    },
    settings(s) {
      settings = s;
      applyLanguage();
      refreshSettings();
      renderHotkeys();
      scheduleRender();
    },
    scripts: onScripts,
    live(l) {
      live = l;
      clockOffset = l.now - Date.now();
      scheduleRender();
    },
    _online(on) {
      document.body.classList.toggle('offline', !on);
    },
  });
})();
