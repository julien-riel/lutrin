/**
 * Syntax highlighting: strings are tokenized before comments
 * (the `//` in a URL is not a comment), per-language profiles
 * (markers and keywords), and the `kind` contract consumed by the HTML renderer
 * (never the color value).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highlightLine } from '../src/deck/highlight.mjs';
import { BLOCK_RENDERERS } from '../src/html/render.mjs';

const ofKind = (line, lang, kind) => highlightLine(line, lang).filter((s) => s.kind === kind);

test('the // in a URL inside a string stays a string (weakness no. 11 reproduced)', () => {
  const runs = highlightLine('const u = "https://example.org/portal"; // portal', 'js');
  assert.equal(runs.find((s) => s.kind === 'string')?.text, '"https://example.org/portal"');
  assert.equal(runs.find((s) => s.kind === 'comment')?.text, '// portal');
});

test('#097d6c is not a comment (css and unknown language)', () => {
  assert.equal(ofKind('color: #097d6c;', 'css', 'comment').length, 0);
  assert.equal(ofKind('color = #097d6c', '', 'comment').length, 0);
});

test('# stays a comment in python, even in front of digits', () => {
  const runs = highlightLine('total = 0  # 097d6c counter', 'python');
  assert.equal(runs.find((s) => s.kind === 'comment')?.text, '# 097d6c counter');
});

test('keywords per language: pass/and in python, select in sql, nothing in prose', () => {
  assert.equal(ofKind('pass', 'python', 'keyword').length, 1);
  assert.equal(ofKind('a and b', 'python', 'keyword').length, 1);
  assert.equal(ofKind('pass the salt and pepper', 'js', 'keyword').length, 0);
  assert.equal(ofKind('select id from t', 'sql', 'keyword').length, 2); // case-insensitive
  assert.equal(ofKind('select something', '', 'keyword').length, 0);
});

test('sql: -- opens a comment; js: the decrement i-- does not', () => {
  assert.equal(
    highlightLine('select 1 -- note', 'sql').find((s) => s.kind === 'comment')?.text,
    '-- note',
  );
  assert.equal(ofKind('i--;', 'js', 'comment').length, 0);
});

test('interpolation #{…} (ruby, shell) does not open a comment', () => {
  assert.equal(ofKind('puts "x" #{y}', 'ruby', 'comment').length, 0);
  assert.equal(
    highlightLine('echo hi # end', 'bash').find((s) => s.kind === 'comment')?.text,
    '# end',
  );
});

test('mermaid: %% is a comment', () => {
  assert.equal(
    highlightLine('graph TD %% layout', 'mermaid').find((s) => s.kind === 'comment')?.text,
    '%% layout',
  );
});

// ------ findings from the adversarial review of the fixes -------------------

test('```constructor and ```__proto__ do not crash (inherited properties)', () => {
  for (const lang of ['constructor', '__proto__', 'CONSTRUCTOR', 'hasOwnProperty']) {
    const runs = highlightLine('class A {}', lang);
    assert.equal(runs.map((s) => s.text).join(''), 'class A {}');
  }
});

test('scss/less keep // comments; css still has none', () => {
  assert.equal(
    highlightLine('// brand variables', 'scss').find((s) => s.kind === 'comment')?.text,
    '// brand variables',
  );
  assert.equal(ofKind('@border: 1px solid; // rule', 'less', 'comment').length, 1);
  assert.equal(ofKind('a { color: red } // not in plain css', 'css', 'comment').length, 0);
});

test('shell: $# and ${#var} do not open a comment, # starting a word does', () => {
  assert.equal(ofKind('if [ $# -eq 0 ]; then', 'bash', 'comment').length, 0);
  assert.equal(ofKind('echo ${#name}', 'bash', 'comment').length, 0);
  assert.equal(
    highlightLine('#!/bin/bash', 'bash').find((s) => s.kind === 'comment')?.text,
    '#!/bin/bash',
  );
});

test('latex: \\% is a literal percent, a bare % is a comment', () => {
  assert.equal(ofKind('50\\% of the remaining cases', 'latex', 'comment').length, 0);
  assert.equal(
    highlightLine('x^2 % squared', 'latex').find((s) => s.kind === 'comment')?.text,
    '% squared',
  );
});

test('unterminated string full of backslashes: linear time (anti-ReDoS)', () => {
  const start = process.hrtime.bigint();
  const line = `x = "${'\\'.repeat(80)}`;
  const runs = highlightLine(line, 'js');
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.equal(runs.map((s) => s.text).join(''), line);
  assert.ok(ms < 250, `highlightLine took ${ms} ms — exponential backtracking likely`);
});

test('the segments recompose the line exactly; empty line → empty segment', () => {
  for (const [line, lang] of [
    ['const s = "a//b" // c', 'js'],
    ['x = 1 # y', 'python'],
    ['', ''],
    ['text without a single token', ''],
  ]) {
    assert.equal(
      highlightLine(line, lang)
        .map((s) => s.text)
        .join(''),
      line,
    );
  }
});

test('the HTML renderer classes by kind: hl-str, hl-kw, hl-com', () => {
  const html = BLOCK_RENDERERS.code(
    { type: 'code', lang: 'js', source: 'const u = "https://a.b" // note' },
    { x: 0, y: 0, w: 400, h: 200 },
  );
  assert.match(html, /<span class="hl-str">&quot;https:\/\/a\.b&quot;<\/span>/);
  assert.match(html, /<span class="hl-kw">const<\/span>/);
  assert.match(html, /<span class="hl-com">\/\/ note<\/span>/);
});
