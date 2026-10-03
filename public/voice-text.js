// Glanceline – gemeinsame Wort-Normalisierung für die Sprachsteuerung (Prompter + Server).
// Erkannte Wörter und Skriptwörter werden gleich normalisiert, damit „Schön“ = „schon“, „10“ = „zehn“ usw.
(function (root) {
  'use strict';

  const NUMBERS = {
    de: ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf'],
    en: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'],
    fr: ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze'],
    es: ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce'],
  };

  function norm(word, lang) {
    // Akzente weg, Buchstaben aller Schriften behalten (Kyrillisch, Griechisch, Arabisch, Hangul …)
    let s = String(word).toLowerCase().replace(/ß/g, 'ss').normalize('NFKD').replace(/\p{M}/gu, '');
    s = s.replace(/[^\p{L}\p{N}]/gu, '');
    const list = NUMBERS[lang];
    if (/^\d+$/.test(s) && list && list[Number(s)]) s = norm(list[Number(s)], lang);
    return s;
  }

  // Wickelt jedes Wort eines gerenderten Skripts in <span class="w" data-w="i"> und liefert die Wortliste.
  // Regie-Schilder (.cue) zählen nicht mit, Überschriften werden markiert (dürfen übersprungen werden).
  function wrapWords(rootEl, lang) {
    const words = [];
    const doc = rootEl.ownerDocument;
    const walker = doc.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement && n.parentElement.closest('.cue, .tgt') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const parts = node.nodeValue.split(/(\s+)/);
      if (!parts.some((p) => norm(p, lang))) continue;
      const heading = Boolean(node.parentElement.closest('h1, h2, h3'));
      const frag = doc.createDocumentFragment();
      for (const part of parts) {
        const w = norm(part, lang);
        if (!w) {
          if (part) frag.append(part);
          continue;
        }
        const span = doc.createElement('span');
        span.className = 'w';
        span.dataset.w = String(words.length);
        span.textContent = part;
        frag.append(span);
        words.push({ w, h: heading });
      }
      node.replaceWith(frag);
    }
    return words;
  }

  // Flüssiges Mitlaufen: Der Erkenner meldet Wörter mit rund einer Sekunde Verzögerung und in Schüben.
  // Aus den Meldungen wird das Sprechtempo geschätzt und die Position bis zur nächsten Meldung
  // weitergeführt – gedeckelt, damit das Skript bei einer Pause oder beim Abschweifen stehen bleibt.
  class VoiceFollow {
    constructor({ maxLead = 2.5, horizon = 1.2 } = {}) {
      this.maxLead = maxLead; // höchstens so viele Wörter über die letzte Meldung hinaus
      this.horizon = horizon; // so lange (s) nach der letzten Meldung wird weitergeführt
      this.reset(0, 0);
    }

    reset(pos, now) {
      this.pos = pos;
      this.at = now;
      this.rate = 0; // Wörter pro Sekunde
      this.shown = pos;
    }

    update(pos, now) {
      if (pos === this.pos) return;
      const d = pos - this.pos;
      if (this.at && d > 0 && d <= 8) {
        const dt = (now - this.at) / 1000;
        if (dt > 0.12) {
          const r = Math.min(6, d / dt);
          this.rate = this.rate ? this.rate * 0.65 + r * 0.35 : r;
        }
      } else {
        this.rate = 0; // Sprung (Abschnitt, Zurückspulen, übersprungener Satz)
        this.shown = pos;
      }
      this.pos = pos;
      this.at = now;
    }

    // Geschätzte Sprechposition (Wörter, mit Nachkommastellen); läuft nie spürbar rückwärts
    predict(now) {
      const dt = Math.max(0, (now - this.at) / 1000);
      const p = this.pos + Math.min(Math.min(dt, this.horizon) * this.rate, this.maxLead);
      if (p >= this.shown || this.shown - p > this.maxLead + 1) this.shown = p;
      return this.shown;
    }
  }

  // Senkrechte Position für eine Wortposition mit Nachkommastellen: innerhalb einer Zeile gleitend.
  // lines: [{ top, first, count }] aufsteigend, aus den Wort-Spans ermittelt
  function lineY(lines, p) {
    if (!lines.length) return 0;
    let lo = 0;
    let hi = lines.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lines[mid].first <= p) lo = mid;
      else hi = mid - 1;
    }
    const L = lines[lo];
    const next = lines[lo + 1];
    const frac = Math.max(0, Math.min(1, (p - L.first) / L.count));
    return next ? L.top + (next.top - L.top) * frac : L.top;
  }

  // Eigene, kleine Modelle (Kroko) und ein großes Mehrsprachenmodell (Nemotron) für weitere Sprachen.
  // Nur Sprachen mit Leerzeichen zwischen den Wörtern – die Nachführung arbeitet wortweise.
  const SINGLE_LANGUAGES = Object.keys(NUMBERS);
  const MULTI_LANGUAGES = ['it', 'pt', 'nl', 'pl', 'sv', 'da', 'no', 'fi', 'cs', 'sk', 'sl', 'hr', 'hu', 'ro', 'bg', 'el', 'et', 'lv', 'lt', 'uk', 'ru', 'tr', 'ar', 'he', 'hi', 'vi'];

  const api = { norm, wrapWords, VoiceFollow, lineY, LANGUAGES: [...SINGLE_LANGUAGES, ...MULTI_LANGUAGES], SINGLE_LANGUAGES, MULTI_LANGUAGES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GlancelineVoiceText = api;
})(typeof window !== 'undefined' ? window : globalThis);
