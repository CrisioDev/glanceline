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
    let s = String(word).toLowerCase().replace(/ß/g, 'ss').normalize('NFKD').replace(/[̀-ͯ]/g, '');
    s = s.replace(/[^a-z0-9]/g, '');
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
      acceptNode: (n) => (n.parentElement && n.parentElement.closest('.cue') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
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

  const api = { norm, wrapWords, LANGUAGES: Object.keys(NUMBERS) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GlancelineVoiceText = api;
})(typeof window !== 'undefined' ? window : globalThis);
