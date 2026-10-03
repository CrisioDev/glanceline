// Glanceline-Brücke für macOS (JavaScript for Automation, läuft mit „osascript -l JavaScript“).
// Liest aus Keynote oder PowerPoint die aktuelle Folie samt Notizen und schreibt bei jeder Änderung
// eine JSON-Zeile auf stdout – dasselbe Format wie die Windows-Brücke (ppt-bridge.ps1).
// Hinweis: Der erste Zugriff auf Keynote/PowerPoint löst die macOS-Abfrage „Automation“ aus.
ObjC.import('Foundation');

function out(obj) {
  const data = $(JSON.stringify(obj) + '\n').dataUsingEncoding($.NSUTF8StringEncoding);
  $.NSFileHandle.fileHandleWithStandardOutput.writeData(data);
}

function safe(fn, fallback) {
  try {
    const v = fn();
    return v === undefined || v === null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function isRunning(name) {
  return safe(() => Application(name).running(), false);
}

// Keynote: Dokument, Wiedergabe-Status, aktuelle Folie, Referentennotizen
function keynote() {
  if (!isRunning('Keynote')) return null;
  const kn = Application('Keynote');
  if (!safe(() => kn.documents.length, 0)) return { running: true, mode: 'none', file: '' };
  const doc = kn.documents[0];
  const slide = doc.currentSlide();
  const n = safe(() => slide.slideNumber(), 0);
  const total = safe(() => doc.slides.length, 0);
  const titleOf = (s) => safe(() => s.defaultTitleItem().objectText(), '');
  return {
    running: true,
    mode: safe(() => kn.playing(), false) ? 'show' : 'edit',
    slide: n,
    total,
    title: titleOf(slide),
    notes: safe(() => slide.presenterNotes(), ''),
    nextTitle: n > 0 && n < total ? titleOf(doc.slides[n]) : '',
    file: safe(() => doc.name(), ''),
  };
}

// PowerPoint für Mac: Bildschirmpräsentation hat Vorrang, sonst das aktive Dokument
function notesOf(slide) {
  // Notizen stehen im Textplatzhalter der Notizenseite (meist Platzhalter 2)
  const shapes = safe(() => slide.notesPage().placeholders(), []);
  for (let i = 0; i < shapes.length; i++) {
    const text = safe(() => shapes[i].textFrame().textRange().content(), '');
    if (text && i > 0) return text;
  }
  return '';
}

function powerpoint() {
  if (!isRunning('Microsoft PowerPoint')) return null;
  const pp = Application('Microsoft PowerPoint');
  const pres = safe(() => pp.activePresentation(), null);
  if (!pres) return { running: true, mode: 'none', file: '' };
  const total = safe(() => pres.slides.length, 0);
  const showing = safe(() => pp.slideShowWindows.length, 0) > 0;
  let slide = null;
  if (showing) slide = safe(() => pp.slideShowWindows[0].slideshowView().slide(), null);
  if (!slide) slide = safe(() => pp.activeWindow().view().slide(), null);
  const n = slide ? safe(() => slide.slideIndex(), 0) : 0;
  const titleOf = (s) => safe(() => s.shapes[0].textFrame().textRange().content(), '');
  return {
    running: true,
    mode: showing ? 'show' : 'edit',
    slide: n,
    total,
    title: slide ? titleOf(slide) : '',
    notes: slide ? notesOf(slide) : '',
    nextTitle: n > 0 && n < total ? titleOf(pres.slides[n]) : '',
    file: safe(() => pres.name(), ''),
  };
}

function run() {
  let last = '';
  for (;;) {
    let state = null;
    try {
      // Eine laufende Präsentation gewinnt, sonst das zuerst gefundene Programm
      const k = keynote();
      const p = powerpoint();
      state = (k && k.mode === 'show' && k) || (p && p.mode === 'show' && p) || k || p || { running: false, mode: 'none' };
    } catch (e) {
      state = { running: false, mode: 'none', error: String(e) };
    }
    const s = JSON.stringify(state);
    if (s !== last) {
      out(state);
      last = s;
    }
    delay(0.7);
  }
}

run();
