'use strict';
// Folgt der Sprechposition im Skript anhand erkannter Wörter.
// pos = Index des nächsten noch nicht gesprochenen Skriptworts.
// Robust gegen Ausschweifungen (bleibt stehen), übersprungene Sätze (springt nach ~2 s)
// und Erkennungsfehler (unscharfer Wortvergleich).

function levenshtein(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// Kurze Wörter exakt, längere mit Toleranz (Beugung, Erkennungsfehler)
function similar(a, b) {
  if (a === b) return true;
  const min = Math.min(a.length, b.length);
  if (min < 3) return false;
  if (min >= 5 && (a.startsWith(b) || b.startsWith(a))) return true;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length) >= 0.72;
}

class VoiceTracker {
  // words: [{ w: normalisiertes Wort, h: Überschrift? }]
  constructor(words = [], { ahead = 60, back = 30, k = 6 } = {}) {
    this.s = words;
    this.pos = 0;
    this.ahead = ahead;
    this.back = back;
    this.k = k;
    this.lastKey = '';
  }

  setWords(words) {
    this.s = words;
    this.pos = Math.min(this.pos, words.length);
    this.lastKey = '';
  }

  // Manuelles Springen (Hotkey, Abschnitt, Klick) – ab hier weiter zuhören
  seek(pos) {
    this.pos = Math.max(0, Math.min(this.s.length, pos));
    this.lastKey = '';
  }

  // Zählt, wie viele der zuletzt gehörten Wörter rückwärts ab Skriptstelle j passen
  _score(h, hi, j) {
    let i = hi;
    let k = j;
    let m = 0;
    let gaps = 0;
    while (i >= 0 && k >= 0 && gaps <= 3) {
      if (similar(h[i], this.s[k].w)) {
        m++;
        i--;
        k--;
      } else if (k > 0 && (this.s[k].h || similar(h[i], this.s[k - 1].w))) {
        if (!this.s[k].h) gaps++; // Skriptwort nicht erkannt; Überschriften werden nicht vorgelesen
        k--;
      } else if (i > 0 && similar(h[i - 1], this.s[k].w)) {
        i--; // zusätzliches oder falsch erkanntes Wort
        gaps++;
      } else {
        i--;
        k--;
        gaps++;
      }
    }
    return m;
  }

  // heard = alle bisher erkannten Wörter (normalisiert); liefert die neue Position
  update(heard) {
    const h = heard.slice(-this.k);
    const key = h.join(' ');
    if (!h.length || !this.s.length || key === this.lastKey) return this.pos;
    this.lastKey = key;

    let best = null;
    const from = Math.max(0, this.pos - this.back);
    const to = Math.min(this.s.length - 1, this.pos + this.ahead);
    // Anker: letztes oder vorletztes erkanntes Wort (das letzte ist oft noch unfertig)
    for (let a = h.length - 1; a >= Math.max(0, h.length - 2); a--) {
      for (let j = from; j <= to; j++) {
        if (!similar(h[a], this.s[j].w)) continue;
        const m = this._score(h, a, j);
        const d = j + 1 - this.pos; // Sprungweite in Wörtern
        let need;
        if (d >= 1 && d <= 2 && a === h.length - 1 && h[a] === this.s[j].w && h[a].length >= 3) need = 1; // direkt das nächste Wort
        else if (d >= 0 && d <= 3) need = m >= 2 || (m >= 1 && h[a].length >= 5) ? 0 : Infinity;
        else if (d > 3) need = d > 20 ? 4 : 3; // vorwärts springen braucht mehr Belege
        else need = d < -2 ? 4 : 2; // zurück nur bei deutlichem Neuanfang
        if (m < need) continue;
        const val = m - Math.abs(d) * 0.02 - (d < 0 ? 0.5 : 0) - (h.length - 1 - a) * 0.3;
        if (!best || val > best.val) best = { val, j };
      }
    }
    if (best) this.pos = best.j + 1;
    return this.pos;
  }
}

module.exports = { VoiceTracker, similar };
