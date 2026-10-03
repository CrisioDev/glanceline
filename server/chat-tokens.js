'use strict';

// Baut Chat-Nachrichten als Token-Liste: Text, @Erwähnungen und Emotes (inkl. Zero-Width-Overlays).
// Gemeinsam für Twitch, YouTube und Kick – nur die Emote-Quellen unterscheiden sich.
class TokenBuilder {
  constructor(emotes, me) {
    this.tokens = [];
    this.emotes = emotes || new Map(); // Name → Emote (7TV/BTTV/FFZ)
    this.me = (me || '').toLowerCase(); // eigener Kanalname für Erwähnungen
  }

  text(v) {
    const last = this.tokens[this.tokens.length - 1];
    if (last && last.t === 'text') last.v += v;
    else this.tokens.push({ t: 'text', v });
  }

  push(token) {
    this.tokens.push(token);
  }

  // Freien Text in Wörter zerlegen und bekannte Emote-Namen ersetzen
  words(segment) {
    const tokens = this.tokens;
    for (const part of segment.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        this.text(' ');
        continue;
      }
      const em = this.emotes.get(part);
      if (em) {
        if (em.zw) {
          const last = tokens[tokens.length - 1];
          const base = last && last.t === 'text' && last.v === ' ' ? tokens[tokens.length - 2] : last;
          if (base && base.t === 'emote') {
            if (base !== last) tokens.pop();
            (base.zw || (base.zw = [])).push({ n: em.n, u: em.u });
            continue;
          }
        }
        tokens.push({ t: 'emote', n: em.n, p: em.p, u: em.u, r: em.r });
        continue;
      }
      if (/^@\w/.test(part)) {
        const target = part.slice(1).toLowerCase().replace(/\W+$/, '');
        tokens.push({ t: 'mention', v: part, me: Boolean(this.me) && target === this.me });
        continue;
      }
      this.text(part);
    }
  }
}

const plainText = (tokens) => tokens.map((t) => (t.t === 'emote' ? t.n : t.v || '')).join('');

module.exports = { TokenBuilder, plainText };
