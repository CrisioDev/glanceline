'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { docxXmlToScript } = require('../public/docx');

// common.js ist reiner Browser-Code (setzt window.Glanceline) – mit einem leeren window-Objekt laden
const FILE = path.join(__dirname, '..', 'public', 'common.js');
const win = {};
vm.runInThisContext(`(function (window) {${fs.readFileSync(FILE, 'utf8')}\n})`, { filename: FILE })(win);
const { esc, inline, renderScript, renderNotes, fmtDur, fmtSigned, runOfShow, showClock } = win.Glanceline;

// Erlaubte Ausgabe: nur diese Tags und Attribute, sonst kein Markup
const ALLOWED = { p: ['dir'], br: [], hr: [], h1: ['dir', 'data-sec'], h2: ['dir', 'data-sec'], h3: ['dir', 'data-sec'], strong: [], em: [], mark: [], span: ['class'], div: ['class', 'dir'] };
function assertSafeHtml(html) {
  const rest = html.replace(/<(\/?)([a-z0-9]+)((?:\s+[a-z-]+="[^"<>]*")*)>/g, (m, close, tag, attrs) => {
    assert.ok(ALLOWED[tag], `unexpected <${tag}> in ${html}`);
    for (const [, name, value] of attrs.matchAll(/\s+([a-z-]+)="([^"]*)"/g)) {
      assert.ok(ALLOWED[tag].includes(name), `unexpected attribute ${name} on <${tag}> in ${html}`);
      if (name === 'class') assert.match(value, /^(cue|tgt|nl|nl gap)$/);
      if (name === 'dir') assert.equal(value, 'auto');
      if (name === 'data-sec') assert.match(value, /^\d+$/);
    }
    return '';
  });
  assert.doesNotMatch(rest, /[<>"]/, `raw markup left in ${html}`);
  assert.doesNotMatch(rest, /&(?!(amp|lt|gt|quot|#39);)/, `unescaped & in ${html}`);
}
const textOf = (html) => html.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

const PAYLOADS = [
  '<img src=x onerror=alert(1)>',
  '"><script>alert(1)</script>',
  "'><svg/onload=alert(1)>",
  '<a href="javascript:alert(1)">click</a>',
  '[click](javascript:alert(1))',
  'javascript:alert(document.cookie)',
  '<iframe srcdoc="<script>alert(1)</script>">',
  '&lt;script&gt;alert(1)&lt;/script&gt;',
  '<!--<script>alert(1)//-->',
  '<style>body{display:none}</style>',
  '" onmouseover="alert(1)',
  '<scr<script>ipt>alert(1)</script>',
];

test('esc: escapes all HTML-significant characters', () => {
  assert.equal(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(esc(`"'&<>`), '&quot;&#39;&amp;&lt;&gt;');
  assert.equal(esc('&lt;'), '&amp;lt;'); // bereits Escaptes bleibt sichtbar Text
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(0), '0');
});

test('XSS: script text never produces markup beyond the formatting allowlist', () => {
  for (const p of PAYLOADS) {
    for (const md of [p, `**${p}**`, `*${p}*`, `==${p}==`, `[${p.slice(0, 40)}]`, `# ${p}`, `## ${p} {2:00}`, `### **${p}**`, `line one\n${p}\n\n${p}`]) {
      const { html } = renderScript(md);
      assertSafeHtml(html);
      assert.doesNotMatch(html, /<(img|script|svg|a|iframe|style|!--)/i, md);
    }
    assertSafeHtml(renderNotes(`${p}\n\n**${p}**`));
    assertSafeHtml(inline(p));
    assert.equal(textOf(inline(p)).includes(p.replace(/\[([^\]\n]{1,48})\]/g, '$1')), true, `text kept: ${p}`);
  }
});

test('XSS: the allowlist check itself catches injected markup', () => {
  assert.throws(() => assertSafeHtml('<p dir="auto"><img src=x onerror=alert(1)></p>'));
  assert.throws(() => assertSafeHtml('<span class="cue" onmouseover="alert(1)">x</span>'));
  assert.throws(() => assertSafeHtml('<span class="cue x">x</span>'));
  assert.throws(() => assertSafeHtml('<p dir="auto">a " b</p>'));
  assert.throws(() => assertSafeHtml('<p dir="auto">&</p>'));
});

test('XSS: exact output for the classic payloads', () => {
  assert.equal(renderScript('<img src=x onerror=alert(1)>').html, '<p dir="auto">&lt;img src=x onerror=alert(1)&gt;</p>');
  assert.equal(renderScript('"><script>alert(1)</script>').html, '<p dir="auto">&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.equal(inline('[" onmouseover="alert(1)]'), '<span class="cue">&quot; onmouseover=&quot;alert(1)</span>');
  assert.equal(inline('**<b>x</b>**'), '<strong>&lt;b&gt;x&lt;/b&gt;</strong>');
  assert.equal(renderNotes('<img src=x onerror=alert(1)>'), '<div class="nl" dir="auto">&lt;img src=x onerror=alert(1)&gt;</div>');
});

test('XSS: section titles are returned as raw text (callers escape them)', () => {
  const { html, sections } = renderScript('# <img src=x onerror=alert(1)> {1:00}');
  assert.equal(sections[0].title, '<img src=x onerror=alert(1)>');
  assert.equal(html, '<h1 dir="auto" data-sec="0">&lt;img src=x onerror=alert(1)&gt;<span class="tgt">1:00</span></h1>');
});

test('XSS: text imported from a Word document stays text', () => {
  const xml = '<w:body><w:p><w:r><w:t>&lt;img src=x onerror=alert(1)&gt;</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>&lt;script&gt;alert(1)&lt;/script&gt;</w:t></w:r></w:p></w:body>';
  const script = docxXmlToScript(xml);
  assert.equal(script, '<img src=x onerror=alert(1)>\n\n**<script>alert(1)</script>**');
  const { html } = renderScript(script);
  assertSafeHtml(html);
  assert.equal(textOf(html), '<img src=x onerror=alert(1)>\n<script>alert(1)</script>');
});

test('inline: bold, italic, highlight and stage directions', () => {
  assert.equal(inline('**bold** *it* ==mark== [Smile]'), '<strong>bold</strong> <em>it</em> <mark>mark</mark> <span class="cue">Smile</span>');
  assert.equal(inline('a * b * c'), 'a <em> b </em> c');
  assert.equal(inline(`[${'x'.repeat(48)}]`), `<span class="cue">${'x'.repeat(48)}</span>`);
  assert.equal(inline(`[${'x'.repeat(49)}]`), `[${'x'.repeat(49)}]`); // zu lang für eine Regieanweisung
  assert.equal(inline('[]'), '[]');
  assert.equal(inline('no markup'), 'no markup');
});

test('renderScript: headings, sections and target times', () => {
  const { html, sections } = renderScript('# Intro {2:00}\n## Part {90s}\n### Deep {1:30:00}\n# A {2m}\n# B { 1,5h }\n# C {45}\n# Plain\n#### Not a heading\n#nospace');
  assert.deepEqual(sections, [
    { title: 'Intro', level: 1, target: 120 },
    { title: 'Part', level: 2, target: 90 },
    { title: 'Deep', level: 3, target: 5400 },
    { title: 'A', level: 1, target: 120 },
    { title: 'B', level: 1, target: 5400 },
    { title: 'C', level: 1, target: 45 },
    { title: 'Plain', level: 1, target: 0 },
  ]);
  assert.ok(html.startsWith('<h1 dir="auto" data-sec="0">Intro<span class="tgt">2:00</span></h1>\n<h2 dir="auto" data-sec="1">Part<span class="tgt">1:30</span></h2>'));
  assert.ok(html.includes('<h3 dir="auto" data-sec="2">Deep<span class="tgt">1:30:00</span></h3>'));
  assert.ok(html.includes('<h1 dir="auto" data-sec="6">Plain</h1>'));
  assert.ok(html.endsWith('<p dir="auto">#### Not a heading<br>#nospace</p>'));
});

test('renderScript: paragraphs, line breaks, rules and CRLF', () => {
  assert.deepEqual(renderScript('one\r\ntwo\r\n\r\nthree  \n---\n  ***  \nfour'), {
    html: '<p dir="auto">one<br>two</p>\n<p dir="auto">three</p>\n<hr>\n<hr>\n<p dir="auto">four</p>',
    sections: [],
  });
  assert.deepEqual(renderScript(''), { html: '', sections: [] });
  assert.deepEqual(renderScript(null), { html: '', sections: [] });
});

test('renderNotes: one line per row, blank lines become gaps', () => {
  assert.equal(renderNotes('first\n\n**second**'), '<div class="nl" dir="auto">first</div><div class="nl gap"></div><div class="nl" dir="auto"><strong>second</strong></div>');
  assert.equal(renderNotes(''), '<div class="nl gap"></div>');
});

test('fmtDur and fmtSigned', () => {
  assert.equal(fmtDur(0), '0:00');
  assert.equal(fmtDur(999), '0:00');
  assert.equal(fmtDur(61000), '1:01');
  assert.equal(fmtDur(3600000), '1:00:00');
  assert.equal(fmtDur(3725000), '1:02:05');
  assert.equal(fmtDur(-5000), '0:00');
  assert.equal(fmtSigned(61000), '+1:01');
  assert.equal(fmtSigned(-61000), '−1:01');
  assert.equal(fmtSigned(0), '+0:00');
});

test('runOfShow: ahead/behind schedule per section', () => {
  const sections = [{ title: 'A', target: 60 }, { title: 'B', target: 120 }, { title: 'C', target: 0 }];
  const sec = { index: 1, baseIndex: 0, at: 90000, base: 0 };
  assert.deepEqual(runOfShow(sections, sec, 100000), { title: 'B', inSec: 10000, target: 120000, delta: 30000 });
  assert.deepEqual(runOfShow(sections, sec, 90000 + 130000), { title: 'B', inSec: 130000, target: 120000, delta: 40000 }); // überzogen
  assert.equal(runOfShow(sections, { index: 2, baseIndex: 0, at: 150000, base: 0 }, 160000).delta, -30000); // Vorsprung
  assert.equal(runOfShow(sections, null, 0), null);
  assert.equal(runOfShow([{ title: 'x', target: 0 }], sec, 0), null);
  assert.equal(runOfShow(sections, { ...sec, index: 9 }, 0), null);
});

test('showClock: elapsed time and countdown', () => {
  assert.deepEqual(showClock({ acc: 1000, running: true, startedAt: 5000 }, { minutes: 1 }, 7000), { elapsed: 3000, total: 60000, left: 57000, started: true });
  assert.deepEqual(showClock({ acc: 0, running: false, startedAt: 0 }, { minutes: 0 }, 7000), { elapsed: 0, total: 0, left: null, started: false });
  assert.equal(showClock({ acc: 70000, running: false, startedAt: 0 }, { minutes: 1 }, 0).left, -10000);
});
