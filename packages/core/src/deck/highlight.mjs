/**
 * Minimal syntax highlighting (keywords / strings / comments), shared by the
 * PPTX and HTML renderers. Returns neutral segments
 * `{ text, kind?, color?, bold?, italic? }` — `kind` ('keyword' | 'string' |
 * 'comment') is the semantic contract: the HTML renderer relies on it for its
 * classes, never on the color value (a theme can change the colors without
 * breaking the highlighting). The colors stay brand design tokens, consumed
 * as is by the PPTX renderer.
 *
 * The block's language (```js, ```python…) picks a profile: comment markers
 * AND keywords specific to its family — `#097d6c` is not a comment in CSS,
 * "and" is not a keyword outside Python. Strings are tokenized BEFORE
 * comments: the `//` of a URL inside a string stays part of the string.
 */

import { COLORS } from './tokens.mjs';

const kw = (words, flags = '') => new RegExp(`\\b(?:${words})\\b`, flags);

// Keywords by language family. Deliberately without the words that are also
// ordinary words of the everyday language outside their family (and, or, is,
// in, not, from…): better a missed keyword than prose set in bold.
const KEYWORDS = {
  c: kw(
    'function|return|const|let|var|if|else|for|while|do|switch|case|break|continue|import|from|export|default|' +
      'class|extends|implements|new|await|async|try|catch|finally|throw|typeof|instanceof|static|void|this|super|' +
      'yield|delete|null|true|false|undefined|public|private|protected|interface|type|enum|namespace|readonly|' +
      'struct|fn|impl|use|mut|pub|match|func|defer|chan|package|int|string|bool|float|double|char|long',
  ),
  python: kw(
    'def|return|if|elif|else|for|while|import|from|as|class|with|lambda|pass|try|except|finally|raise|in|not|' +
      'and|or|is|global|nonlocal|yield|assert|del|async|await|None|True|False',
  ),
  shell: kw(
    'if|then|else|elif|fi|for|while|until|do|done|case|esac|function|return|exit|export|local|readonly|echo|source',
  ),
  ruby: kw(
    'def|end|class|module|if|elsif|else|unless|while|until|do|return|begin|rescue|ensure|yield|self|nil|true|false|require',
  ),
  sql: kw(
    'SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|CROSS|ON|GROUP|ORDER|BY|HAVING|LIMIT|OFFSET|INSERT|INTO|' +
      'VALUES|UPDATE|SET|DELETE|CREATE|ALTER|DROP|TABLE|INDEX|VIEW|AS|AND|OR|NOT|NULL|IN|IS|LIKE|BETWEEN|EXISTS|' +
      'UNION|DISTINCT|CASE|WHEN|THEN|ELSE|END',
    'i', // SQL keywords are also written in lowercase
  ),
  lua: kw(
    'function|end|if|then|else|elseif|for|while|repeat|until|do|return|local|nil|true|false|break',
  ),
  // unknown language: only words that are unambiguous against prose
  generic: kw(
    'function|return|const|let|var|if|else|for|while|import|export|class|def|async|await|new|try|catch|null|true|false|None|True|False',
  ),
};

// `#(?!\{)`: #{…} interpolation (Ruby) does not open a comment.
const HASH = /#.*$/;
const HASH_NO_INTERP = /#(?!\{).*$/;
// POSIX: `#` only opens a comment at the start of a word — `$#` (argument
// count) and `${#var}` (length) are not comments.
const HASH_SHELL = /(?<=^|\s)#(?!\{).*$/;

/** Profiles: line-comment markers + keyword set. */
const PROFILES = {
  c: { comments: [/\/\/.*$/], keywords: KEYWORDS.c },
  python: { comments: [HASH], keywords: KEYWORDS.python },
  shell: { comments: [HASH_SHELL], keywords: KEYWORDS.shell },
  ruby: { comments: [HASH_NO_INTERP], keywords: KEYWORDS.ruby },
  hash: { comments: [HASH], keywords: null }, // yaml, toml, dockerfile…
  sql: { comments: [/--.*$/], keywords: KEYWORDS.sql },
  lua: { comments: [/--.*$/], keywords: KEYWORDS.lua },
  haskell: { comments: [/--.*$/], keywords: null },
  tex: { comments: [/(?<!\\)%.*$/], keywords: null }, // \% is the literal percent sign
  mermaid: { comments: [/%%.*$/], keywords: null },
  css: { comments: [], keywords: null }, // no line comment: #097d6c stays a color
  scssline: { comments: [/\/\/.*$/], keywords: null }, // scss/less accept //
  markup: { comments: [], keywords: null }, // html/xml: <!-- --> is multi-line, out of scope
  // unknown language: cautious markers — `#` neither interpolation nor
  // hexadecimal color; `--` only when followed by a space (never a decrement)
  generic: {
    comments: [/\/\/.*$/, /#(?!\{)(?![0-9a-fA-F]{3,8}\b).*$/, /--\s.*$/],
    keywords: KEYWORDS.generic,
  },
};

const PROFILE_BY_LANG = {
  js: 'c',
  jsx: 'c',
  mjs: 'c',
  cjs: 'c',
  ts: 'c',
  tsx: 'c',
  javascript: 'c',
  typescript: 'c',
  java: 'c',
  c: 'c',
  h: 'c',
  cpp: 'c',
  'c++': 'c',
  cc: 'c',
  cs: 'c',
  csharp: 'c',
  go: 'c',
  rust: 'c',
  rs: 'c',
  swift: 'c',
  kotlin: 'c',
  kt: 'c',
  scala: 'c',
  php: 'c',
  dart: 'c',
  json: 'c',
  jsonc: 'c',
  python: 'python',
  py: 'python',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  shell: 'shell',
  console: 'shell',
  ruby: 'ruby',
  rb: 'ruby',
  yaml: 'hash',
  yml: 'hash',
  toml: 'hash',
  ini: 'hash',
  dockerfile: 'hash',
  makefile: 'hash',
  r: 'hash',
  sql: 'sql',
  lua: 'lua',
  haskell: 'haskell',
  hs: 'haskell',
  tex: 'tex',
  latex: 'tex',
  mermaid: 'mermaid',
  css: 'css',
  scss: 'scssline',
  less: 'scssline',
  html: 'markup',
  xml: 'markup',
  svg: 'markup',
};

// Unambiguous alternation (escape OR non-backslash), lazy quantifier bounded
// by the quote: the form `(?:\\.|(?!\1).)*` blew up into exponential
// backtracking on an unterminated string full of backslashes (measured:
// 40 backslashes ≈ 1.3 s, 50 ≈ minutes — the compilation freezes).
// `[^]` (empty negated class) = "any character, line breaks included": it is
// the intended idiom, not an oversight — the linter flags it wrongly.
// biome-ignore lint/correctness/noEmptyCharacterClassInRegex: [^] is deliberate, see above
const STRING = /(["'`])(?:\\[^]|[^\\])*?\1/;

export function highlightLine(line, lang = '') {
  // Object.hasOwn: PROFILE_BY_LANG is an object literal — without the guard, a
  // ```constructor (or ```__proto__) block would pull up a property inherited
  // from Object.prototype and crash the whole compilation
  const key = String(lang ?? '').toLowerCase();
  const prof = PROFILES[Object.hasOwn(PROFILE_BY_LANG, key) ? PROFILE_BY_LANG[key] : 'generic'];
  const runs = [];

  // text outside strings and comments: look only for keywords in it
  const plain = (text) => {
    while (text.length) {
      const m = prof.keywords ? text.match(prof.keywords) : null;
      if (!m) {
        runs.push({ text });
        return;
      }
      if (m.index > 0) runs.push({ text: text.slice(0, m.index) });
      runs.push({ text: m[0], kind: 'keyword', color: COLORS.primaryDarker, bold: true });
      text = text.slice(m.index + m[0].length);
    }
  };

  let rest = line;
  while (rest.length) {
    const str = rest.match(STRING);
    let com = null;
    for (const re of prof.comments) {
      const m = rest.match(re);
      if (m && (com === null || m.index < com.index)) com = m;
    }
    // a string opened before the marker wins: the `//` of a URL inside
    // "https://…" does not open a comment
    if (str && (!com || str.index <= com.index)) {
      if (str.index > 0) plain(rest.slice(0, str.index));
      runs.push({ text: str[0], kind: 'string', color: COLORS.positiveDark });
      rest = rest.slice(str.index + str[0].length);
      continue;
    }
    if (com) {
      if (com.index > 0) plain(rest.slice(0, com.index));
      runs.push({
        text: rest.slice(com.index),
        kind: 'comment',
        color: COLORS.neutralSecondary,
        italic: true,
      });
      break;
    }
    plain(rest);
    break;
  }
  if (!runs.length) runs.push({ text: '' });
  return runs;
}
