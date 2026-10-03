// Word-Dokumente (.docx) und eingefügtes HTML in Glanceline-Skripte umwandeln – ohne Abhängigkeiten.
// Läuft im Browser (Panel: Import, Einfügen) und in Node (Ordner-Sync). Ergebnis nutzt die Skript-Syntax:
// # Überschrift, **fett**, *kursiv*, ==markiert==.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GlancelineDocx = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- ZIP: einen Eintrag über das zentrale Verzeichnis finden und entpacken
  // inflateRaw(bytes) → Promise<Uint8Array> bzw. Uint8Array (Browser: DecompressionStream, Node: zlib)
  async function unzipEntry(bytes, name, inflateRaw) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('not a zip file');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const size = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const entry = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
      if (entry === name) {
        const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
        const data = u8.subarray(start, start + size);
        if (method === 0) return data;
        if (method === 8) return inflateRaw(data);
        throw new Error(`unsupported zip method ${method}`);
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
    throw new Error(`${name} missing`);
  }

  // ---------- Formatierte Textstücke → Skript-Syntax
  // seg = { text, b, i, h }; benachbarte Stücke gleicher Art werden zusammengefasst,
  // Leerzeichen wandern aus den Markierungen heraus („**Wort **“ wäre keine gültige Markierung).
  function formatRuns(segs, plain) {
    const merged = [];
    for (const s of segs) {
      if (!s.text) continue;
      const last = merged[merged.length - 1];
      if (last && last.b === s.b && last.i === s.i && last.h === s.h) last.text += s.text;
      else merged.push({ ...s });
    }
    return merged
      .map((s) => {
        if (plain || !(s.b || s.i || s.h) || !s.text.trim()) return s.text;
        const lead = s.text.match(/^\s*/)[0];
        const trail = s.text.match(/\s*$/)[0];
        let core = s.text.trim();
        if (s.i) core = `*${core}*`;
        if (s.b) core = `**${core}**`;
        if (s.h) core = `==${core}==`;
        return lead + core + trail;
      })
      .join('');
  }

  // Absätze mit Überschriften-Ebene → Skripttext
  function blocksToScript(blocks) {
    const out = [];
    for (const b of blocks) {
      const text = formatRuns(b.segs, b.level > 0)
        .replace(/[ \t ]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .trim();
      if (!text) continue;
      out.push(b.level > 0 ? `${'#'.repeat(b.level)} ${text.replace(/\n/g, ' ')}` : `${b.bullet ? '– ' : ''}${text}`);
    }
    return out.join('\n\n');
  }

  // ---------- Word-XML
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const decodeXml = (s) =>
    s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
      return ENT[e] ?? m;
    });

  // <w:b/> bzw. <w:b w:val="true"/> = an, w:val="0"/"false" = aus
  const flag = (rPr, tag) => {
    const m = new RegExp(`<w:${tag}(?:\\s+w:val="([^"]*)")?\\s*/>`).exec(rPr);
    return Boolean(m) && !/^(0|false|off|none)$/i.test(m[1] || '');
  };

  function headingLevel(pPr) {
    const style = (/<w:pStyle w:val="([^"]+)"/.exec(pPr) || [])[1] || '';
    if (/^(title|titel|titre|t[ií]tulo|titolo)$/i.test(style)) return 1;
    const m = /^(?:heading|berschrift|titre|t[ií]tulo|titolo|kop|rubrik|nag[lł]?[oó]wek)\s*([1-9])$/i.exec(style);
    if (m) return Math.min(3, Number(m[1]));
    const o = /<w:outlineLvl w:val="(\d)"/.exec(pPr);
    return o && Number(o[1]) < 9 ? Math.min(3, Number(o[1]) + 1) : 0;
  }

  function docxXmlToScript(xml) {
    const body = (/<w:body>([\s\S]*)<\/w:body>/.exec(xml) || [])[1] || xml;
    const blocks = [];
    for (const pm of body.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)) {
      const p = pm[1];
      const pPr = (/<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(p) || [])[1] || '';
      const segs = [];
      for (const rm of p.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)) {
        const r = rm[1];
        const rPr = (/<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(r) || [])[1] || '';
        const hl = /<w:highlight w:val="(?!none)[^"]+"/.test(rPr) || /<w:shd [^>]*w:fill="(?!auto|FFFFFF|ffffff)[0-9A-Fa-f]{6}"/.test(rPr);
        let text = '';
        for (const part of r.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(tab|br|cr)(?:\s[^>]*)?\/>/g)) {
          if (part[2] === 'tab') text += ' ';
          else if (part[2]) text += '\n';
          else text += decodeXml(part[1]);
        }
        segs.push({ text, b: flag(rPr, 'b'), i: flag(rPr, 'i'), h: hl });
      }
      blocks.push({ level: headingLevel(pPr), bullet: /<w:numPr>/.test(pPr), segs });
    }
    return blocksToScript(blocks);
  }

  async function docxToScript(bytes, inflateRaw) {
    const xml = await unzipEntry(bytes, 'word/document.xml', inflateRaw);
    return docxXmlToScript(new TextDecoder().decode(xml));
  }

  // Browser: entpacken mit DecompressionStream
  async function browserInflate(data) {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // ---------- Eingefügtes HTML (Word, Google Docs, Webseiten) → Skripttext (nur im Browser)
  const BLOCK = /^(P|DIV|LI|TR|BLOCKQUOTE|SECTION|ARTICLE|H[1-6]|UL|OL|TABLE|PRE)$/;
  function htmlToScript(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const blocks = [];
    let cur = { level: 0, segs: [] };
    const flush = (level = 0, bullet = false) => {
      if (cur.segs.length) blocks.push(cur);
      cur = { level, segs: [], bullet };
    };
    const walk = (node, fmt) => {
      if (node.nodeType === 3) {
        const text = node.nodeValue.replace(/\s+/g, ' ');
        if (text) cur.segs.push({ text, ...fmt });
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.tagName;
      if (/^(STYLE|SCRIPT|HEAD|TITLE|META)$/.test(tag)) return;
      if (tag === 'BR') {
        cur.segs.push({ text: '\n', ...fmt });
        return;
      }
      const st = node.getAttribute('style') || '';
      const weight = /font-weight\s*:\s*(bold|[6-9]00)/i.test(st);
      const normalWeight = /font-weight\s*:\s*(normal|[1-4]00)/i.test(st);
      const next = {
        b: (fmt.b || tag === 'B' || tag === 'STRONG' || weight) && !normalWeight,
        i: fmt.i || tag === 'I' || tag === 'EM' || /font-style\s*:\s*italic/i.test(st),
        li: fmt.li || tag === 'LI', // Absätze innerhalb von Listenpunkten bleiben Aufzählungen
        h: fmt.h || tag === 'MARK' || /mso-highlight\s*:\s*(?!none)/i.test(st) || /background(-color)?\s*:\s*(yellow|#ff0|#ffff00|lime|aqua|#0ff)/i.test(st),
      };
      const h = /^H([1-6])$/.exec(tag);
      const block = BLOCK.test(tag);
      if (block) flush(h ? Math.min(3, Number(h[1])) : 0, next.li && !h);
      for (const c of node.childNodes) walk(c, next);
      if (block) flush(0, fmt.li);
    };
    walk(doc.body, { b: false, i: false, h: false, li: false });
    flush();
    return blocksToScript(blocks);
  }

  return { unzipEntry, formatRuns, docxXmlToScript, docxToScript, browserInflate, htmlToScript };
});
