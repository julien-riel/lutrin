/**
 * CLI `lutrin` — the one module the suite did not load: it runs at load time
 * (dispatch at the top of the module), so it can only be tested in a
 * SUBPROCESS. These tests lock down the tool's observable contract, the one a
 * script or a CI relies on: what goes to stdout, what goes to stderr, the EXIT
 * CODE, and what is WRITTEN to disk.
 *
 * The thread running through the cases below: a command that fails must leave
 * nothing behind, and a command that succeeds must not keep quiet about what
 * it missed. The two historical faults — an orphan output from a `-o` without
 * an extension, a deck delivered without the brand it explicitly asked for —
 * are variants of the same one: write first, check afterwards.
 *
 * Every run is hermetic (LUTRIN_CONFIG pointed at a directory that does not
 * exist, as in setup.mjs); the tests that exercise the user default set it up
 * themselves.
 */

import './setup.mjs'; // hermetic even under direct invocation (see setup.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, '..', 'src', 'cli.mjs');
const PKG = path.resolve(here, '..', 'package.json');

/** Runs the CLI and returns { code, stdout, stderr }. `env` overrides the
 *  hermetic environment (user default of the config tests). */
function lutrin(args, { cwd, env } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: cwd ?? here,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  if (r.error) throw r.error;
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Disposable working directory + a minimal valid deck. */
function tmpDeck(t, source = '---\ntitle: Test\n---\n\n# A slide\n\nSome text.\n') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const deck = path.join(dir, 'deck.md');
  fs.writeFileSync(deck, source);
  return { dir, deck };
}

// ---------------------------------------------------------------------------
// help, version, dispatch
// ---------------------------------------------------------------------------

test('CLI: --version prints the package.json version on stdout, exit code 0', () => {
  const version = JSON.parse(fs.readFileSync(PKG, 'utf8')).version;
  const r = lutrin(['--version']);
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), version);
  assert.equal(r.stderr, '');
});

test('CLI: --help goes to STDOUT with exit code 0 (help that was asked for is an answer, not an error)', () => {
  const r = lutrin(['--help']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^Usage:/);
  assert.match(r.stdout, /lutrin build/);
  assert.equal(r.stderr, '', 'help that was asked for must write nothing to stderr');
});

test('CLI: with no argument, usage is an ERROR — stderr and a non-zero exit code', () => {
  const r = lutrin([]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /^Usage:/);
});

test('CLI: a misspelled subcommand — detected and suggested, never taken for a file', (t) => {
  const { deck } = tmpDeck(t);
  const r = lutrin(['buidl', deck]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /unknown subcommand: buidl/);
  assert.match(r.stderr, /did you mean "build"/);
  // the old message blamed the input file, which did exist
  assert.doesNotMatch(r.stderr, /not found/);
});

test('CLI: a path that does not exist stays a file-not-found (not a subcommand typo)', () => {
  const r = lutrin(['missing-somewhere.md']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /file not found/i);
});

// ---------------------------------------------------------------------------
// argument parser: strict
// ---------------------------------------------------------------------------

test('CLI: unknown flag — an error with "did you mean", instead of being swallowed', (t) => {
  const { deck } = tmpDeck(t);
  const r = lutrin(['build', deck, '--kti', 'brand']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /unknown flag: --kti/);
  assert.match(r.stderr, /did you mean "--kit"/);
});

test('CLI: a value-taking flag with no value — an error (the next positional is no longer absorbed)', (t) => {
  const { dir, deck } = tmpDeck(t);
  const atEnd = lutrin(['build', deck, '-o']);
  assert.equal(atEnd.code, 1);
  assert.match(atEnd.stderr, /-o expects a value/);

  // `-o --html`: the value was forgotten, not named "--html"
  const swallowed = lutrin(['build', deck, '-o', '--html']);
  assert.equal(swallowed.code, 1);
  assert.match(swallowed.stderr, /-o expects a value/);
  assert.deepEqual(fs.readdirSync(dir), ['deck.md'], 'no output must have been written');
});

test('CLI: the GNU "--kit=value" form — understood, not rejected as an unknown flag', (t) => {
  const { dir, deck } = tmpDeck(t);
  const out = path.join(dir, 'output.html');
  // the strict parser did not split on "=": "--kit=…", the most common form,
  // came out as "unknown flag: --kit=brand" — and without so much as a
  // suggestion, "kit=brand" being too far from "kit"
  const r = lutrin(['build', deck, '--kit=kit-missing', '-o', out]);
  assert.equal(r.code, 1);
  assert.doesNotMatch(
    r.stderr,
    /unknown flag/,
    'the --kit flag must be recognized in its attached form',
  );
  assert.match(r.stderr, /KIT_NOT_FOUND/, 'the attached value must be passed to the kit resolver');

  // and the attached value really is carried through to the command
  const attached = lutrin(['build', deck, `-o=${out}`]);
  assert.equal(attached.code, 0, attached.stderr);
  assert.ok(fs.existsSync(out));
});

test('CLI: "--kti=brand" — the suggestion is computed on the NAME, not on "name=value"', (t) => {
  const { deck } = tmpDeck(t);
  const r = lutrin(['build', deck, '--kti=brand']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /unknown flag: --kti/);
  assert.doesNotMatch(r.stderr, /--kti=brand/, 'the value is not part of the flag name');
  assert.match(r.stderr, /did you mean "--kit"/);
});

test('CLI: "--kit=" (empty value) and "--html=true" (a valued boolean) — clear errors', (t) => {
  const { deck } = tmpDeck(t);
  const empty = lutrin(['build', deck, '--kit=']);
  assert.equal(empty.code, 1);
  assert.match(empty.stderr, /--kit expects a value/);
  assert.match(empty.stderr, /empty/);

  // `--html=false` disables nothing: accepting a value here would be a lie
  const boolValued = lutrin(['build', deck, '--html=true']);
  assert.equal(boolValued.code, 1);
  assert.match(boolValued.stderr, /--html takes no value/);
});

test('CLI: "--" ends the options (POSIX convention), instead of an absurd unknown flag', (t) => {
  const { dir, deck } = tmpDeck(t);
  // the old parser saw "--" as a flag and suggested "-o"
  const out = path.join(dir, 'output.html');
  const r = lutrin(['build', '-o', out, '--', deck]);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(fs.existsSync(out));

  // a deck whose name starts with a dash could not be compiled at all
  const dash = path.join(dir, '-deck.md');
  fs.copyFileSync(deck, dash);
  const out2 = path.join(dir, 'dash.html');
  const rt = lutrin(['build', '-o', out2, '--', dash]);
  assert.equal(rt.code, 0, rt.stderr);
  assert.ok(fs.existsSync(out2));
});

test('CLI: two input files — an explicit error rather than a silently ignored second argument', (t) => {
  const { dir, deck } = tmpDeck(t);
  const other = path.join(dir, 'other.md');
  fs.writeFileSync(other, '---\ntitle: Other\n---\n\n# B\n\nText.\n');
  const r = lutrin(['build', deck, other]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /a single input file/);
});

// ---------------------------------------------------------------------------
// build: output
// ---------------------------------------------------------------------------

test('CLI: -o without a .pptx extension — refused BEFORE writing, no orphan output', (t) => {
  const { dir, deck } = tmpDeck(t);
  const r = lutrin(['build', deck, '-o', path.join(dir, 'report')]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /\.pptx extension/);
  // the heart of the finding: the file was written, then post-processing
  // failed — leaving behind a "report" that nothing knows how to open
  assert.equal(fs.existsSync(path.join(dir, 'report')), false);
  assert.deepEqual(fs.readdirSync(dir), ['deck.md']);
});

test('CLI: -o .html without --html — accepted, the format is inferred from the extension', (t) => {
  const { dir, deck } = tmpDeck(t);
  const out = path.join(dir, 'output.html');
  const r = lutrin(['build', deck, '-o', out]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(fs.readFileSync(out, 'utf8'), /<!doctype html>/i);
});

test('CLI: --html with a .pptx -o — refused (the content would not match the name)', (t) => {
  const { dir, deck } = tmpDeck(t);
  const r = lutrin(['build', deck, '--html', '-o', path.join(dir, 'output.pptx')]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /\.html extension/);
  assert.equal(fs.existsSync(path.join(dir, 'output.pptx')), false);
});

test('CLI: -o under a tree that does not exist — the parent directories are created', (t) => {
  const { dir, deck } = tmpDeck(t);
  const out = path.join(dir, 'dist', 'v2', 'output.html');
  const r = lutrin(['build', deck, '-o', out]);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(fs.existsSync(out), 'the file must exist under the tree that was created for it');
});

test('CLI: -o on an existing directory — refused instead of a bare EISDIR', (t) => {
  const { dir, deck } = tmpDeck(t);
  const out = path.join(dir, 'output.html');
  fs.mkdirSync(out);
  const r = lutrin(['build', deck, '-o', out]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /is not a file/);
});

// ---------------------------------------------------------------------------
// build: explicit kit vs implicit default
// ---------------------------------------------------------------------------

test('CLI: an explicit --kit that cannot be resolved — ERROR, and the deck is not delivered without its brand', (t) => {
  const { dir, deck } = tmpDeck(t);
  const r = lutrin(['build', deck, '--kit', 'kit-missing', '-o', path.join(dir, 'output.html')]);
  assert.equal(r.code, 1, 'a kit requested explicitly and not found must fail');
  assert.match(r.stderr, /KIT_NOT_FOUND/);
  assert.equal(fs.existsSync(path.join(dir, 'output.html')), false);
});

// The diagnostic promised "the default theme will be used" — contradicted two
// lines below by "nothing was produced". One went looking for a file that did
// not exist.
//
// The rule holds for ALL failures to resolve the explicit path, not for the
// not-found kit alone: a first fix had handled only KIT_NOT_FOUND, and
// malformed JSON — the most frequent case — kept promising a fallback that
// never happens. The sweep below exercises every branch of resolveTheme that
// pushes an error diagnostic.
const INVALID_EXPLICIT_KITS = [
  {
    name: 'kit not found',
    code: 'KIT_NOT_FOUND',
    remedy: /fix the reference/,
    // nothing to write to disk: the reference designates no file at all
    setup: () => 'kit-missing',
  },
  {
    name: 'malformed theme JSON',
    code: 'THEME_INVALID',
    setup: (dir) => {
      const f = path.join(dir, 'bad.json');
      fs.writeFileSync(f, '{ not json');
      return f;
    },
  },
  {
    name: 'theme JSON that is not an object',
    code: 'THEME_INVALID',
    setup: (dir) => {
      const f = path.join(dir, 'list.json');
      fs.writeFileSync(f, '[1, 2, 3]');
      return f;
    },
  },
];

for (const testCase of INVALID_EXPLICIT_KITS) {
  test(`CLI: EXPLICIT path, ${testCase.name} — the diagnostic does not promise a fallback that will not happen`, (t) => {
    const { dir, deck } = tmpDeck(t);
    const out = path.join(dir, 'output.html');
    const r = lutrin(['build', deck, '--kit', testCase.setup(dir), '-o', out]);
    assert.equal(r.code, 1, `an invalid explicit kit must fail: ${r.stdout}`);
    assert.match(r.stderr, new RegExp(testCase.code));
    assert.doesNotMatch(
      r.stderr,
      /default theme will be used/i,
      'the promise of a fallback is contradicted by "nothing was produced" two lines below',
    );
    if (testCase.remedy)
      assert.match(r.stderr, testCase.remedy, 'the finding and the remediation both stay');
    assert.match(r.stderr, /nothing was produced/);
    assert.equal(fs.existsSync(out), false, 'nothing must have been written');
  });
}

test('CLI: a frontmatter "kit:" that cannot be resolved — an ERROR too (the author designated THIS kit)', (t) => {
  const { dir, deck } = tmpDeck(
    t,
    '---\ntitle: Test\nkit: kit-missing\n---\n\n# A slide\n\nSome text.\n',
  );
  const r = lutrin(['build', deck, '-o', path.join(dir, 'output.html')]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /KIT_NOT_FOUND/);
  assert.equal(fs.existsSync(path.join(dir, 'output.html')), false);
});

test('CLI: a USER default that cannot be resolved — silent fallback, deck delivered with exit code 0 (a warning only)', (t) => {
  const { dir, deck } = tmpDeck(t);
  // this deck asked for nothing: the kit comes from a global config, stale
  // perhaps since another project — the generic theme is a legitimate fallback
  const conf = path.join(dir, 'user-config');
  fs.mkdirSync(conf, { recursive: true });
  fs.writeFileSync(path.join(conf, 'config.json'), JSON.stringify({ kit: 'kit-missing' }));

  const out = path.join(dir, 'output.html');
  const r = lutrin(['build', deck, '-o', out], { env: { LUTRIN_CONFIG: conf } });
  assert.equal(r.code, 0, `a user default must not make a build fail: ${r.stderr}`);
  assert.ok(fs.existsSync(out));
  assert.match(r.stdout, /⚠ Kit not found/, 'the fallback must stay visible');
  // the promise of a fallback lives HERE, in the one case where it is true
  assert.match(r.stdout, /default theme will be used/);
});

// The rule "an EXPLICIT kit that cannot be resolved is an error" held for
// `build` only: the other subcommands produced a result WITHOUT the brand that
// was asked for, with exit code 0. The costliest case is `vendor` — it
// announced "the directory is self-contained" for a directory devoid of the
// intended kit.
for (const command of ['vendor', 'inspect', 'preview']) {
  test(`CLI ${command}: an explicit --kit that cannot be resolved — ERROR, as for build`, (t) => {
    const { dir, deck } = tmpDeck(t);
    const r = lutrin([command, deck, '--kit', 'kit-missing']);
    assert.equal(
      r.code,
      1,
      `${command} must not carry on without the brand asked for: ${r.stdout}`,
    );
    assert.match(r.stderr, /KIT_NOT_FOUND/);
    assert.doesNotMatch(r.stdout, /self-contained/, 'no result must be announced');
    // nothing was produced: the deck's directory is intact
    assert.deepEqual(fs.readdirSync(dir), ['deck.md']);
  });

  // `preview` does not hand control back: its generic fallback is covered
  // further down, by the tests that actually start it on a deck with no kit
  if (command === 'preview') continue;
  test(`CLI ${command}: a deck that asked for no kit keeps its generic fallback (exit code 0)`, (t) => {
    const { deck } = tmpDeck(t);
    // the net must trip ONLY on an EXPLICIT request, otherwise it would make
    // these commands unusable on a machine with no kit installed
    const r = lutrin([command, deck]);
    assert.equal(r.code, 0, r.stderr);
  });
}

// ---------------------------------------------------------------------------
// vendor: a REFUSED kit must be seen
// ---------------------------------------------------------------------------

// `vendor` already knows how to refuse (rightly) to vendor a kit — but it then
// set `report.kit` to null, and the early return "Nothing to vendor" swallowed
// the warning that explained it. The author walked away with a doubled lie:
// there WAS a kit, it was skipped, and the directory is not self-contained.

/** Minimal kit, enough for resolveTheme to recognize it as a kit. */
function makeKit(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'kit.json'), JSON.stringify({ name: 'test', version: '1.0.0' }));
  fs.writeFileSync(path.join(dir, 'theme.json'), JSON.stringify({ colors: { primary: 'B45309' } }));
  return dir;
}

test('CLI vendor: a refused kit (assets/kit occupied) — the warning comes out, and nothing calls itself self-contained', (t) => {
  const { dir, deck } = tmpDeck(t);
  const kit = makeKit(path.join(dir, 'brand'));
  // the place is taken by something other than a copy of a kit: vendor refuses
  fs.mkdirSync(path.join(dir, 'assets', 'kit'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'assets', 'kit', 'other.txt'), 'not a kit');

  const r = lutrin(['vendor', deck, '--kit', kit]);
  assert.match(r.stdout, /not vendored/, `the warning must reach the author: ${r.stdout}`);
  assert.doesNotMatch(
    r.stdout,
    /and no kit\./,
    'a kit was requested AND refused: "this deck has no kit" is false',
  );
  assert.doesNotMatch(r.stdout, /is self-contained/, 'the directory did NOT receive the brand');
});

test('CLI vendor: a bare theme file outside the directory — same rule (nothing self-contained is promised)', (t) => {
  const { dir, deck } = tmpDeck(t);
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-theme-'));
  t.after(() => fs.rmSync(elsewhere, { recursive: true, force: true }));
  const themeFile = path.join(elsewhere, 'theme.json');
  fs.writeFileSync(themeFile, JSON.stringify({ colors: { primary: 'B45309' } }));

  const r = lutrin(['vendor', deck, '--kit', themeFile]);
  assert.match(r.stdout, /will NOT travel/, `the warning must come out: ${r.stdout}`);
  assert.doesNotMatch(r.stdout, /is self-contained/);
});

test('CLI vendor: with nothing to freeze AND no warning, the plain "nothing to vendor" finding stays', (t) => {
  const { deck } = tmpDeck(t);
  const r = lutrin(['vendor', deck]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Nothing to vendor/, 'the legitimate case must not turn alarming');
});

test('CLI kit create: -o without a .deckkit extension — refused BEFORE packaging', (t) => {
  const { dir } = tmpDeck(t);
  const src = path.join(dir, 'brand');
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'kit.json'), JSON.stringify({ name: 'brand', version: '1.0.0' }));
  const out = path.join(dir, 'brand.zip');
  const r = lutrin(['kit', 'create', src, '-o', out]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /\.deckkit extension/);
  assert.equal(fs.existsSync(out), false, 'no archive must have been written');

  // the right extension does go through
  const good = path.join(dir, 'brand.deckkit');
  const ok = lutrin(['kit', 'create', src, '-o', good]);
  assert.equal(ok.code, 0, ok.stderr);
  assert.ok(fs.existsSync(good));
});

// ---------------------------------------------------------------------------
// build: diagnostics
// ---------------------------------------------------------------------------

const FAULTY_DECK = '---\ntitle: Test\n---\n\n# A slide\n\n:::column\nx\n:::\n';

test('CLI: a deck carrying ERRORS no longer compiles in silence — diagnostics shown, exit code 1, nothing written', (t) => {
  const { dir, deck } = tmpDeck(t, FAULTY_DECK);
  const out = path.join(dir, 'output.html');
  const r = lutrin(['build', deck, '-o', out]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /UNKNOWN_DIRECTIVE/);
  assert.match(r.stderr, /nothing was written/);
  assert.equal(fs.existsSync(out), false);
});

test('CLI: --force compiles despite the errors, leaving them on screen (a showable draft)', (t) => {
  const { dir, deck } = tmpDeck(t, FAULTY_DECK);
  const out = path.join(dir, 'output.html');
  const r = lutrin(['build', deck, '-o', out, '--force']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /UNKNOWN_DIRECTIVE/);
  assert.match(r.stderr, /compilation forced/);
  assert.ok(fs.existsSync(out));
});

test('CLI: a sound deck compiles with exit code 0 and announces its slides', (t) => {
  const { dir, deck } = tmpDeck(t);
  const out = path.join(dir, 'output.html');
  const r = lutrin(['build', deck, '-o', out]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /✓ .*output\.html — \d+ slides/);
});

// An EMPTY deck (a truncated file, the wrong file) produced a 47 KB .pptx
// without a single slide, announced by a green ✓ and exit code 0: everywhere
// else the compiler degrades AND SAYS SO, here alone it lied.
test('CLI: an EMPTY deck is not delivered under a ✓ — EMPTY_DECK, exit code 1, nothing written', (t) => {
  const { dir, deck } = tmpDeck(t, '\n');
  const out = path.join(dir, 'output.pptx');
  const r = lutrin(['build', deck, '-o', out]);
  assert.equal(r.code, 1, `a deck without a slide must not exit with 0: ${r.stdout}`);
  assert.match(r.stderr, /EMPTY_DECK/);
  assert.match(r.stderr, /No slide/i);
  assert.doesNotMatch(r.stdout, /✓/, 'no success must be announced');
  assert.equal(fs.existsSync(out), false, 'nothing must have been written');
});

test('CLI: --force on an empty deck writes the file, but the final line is a ⚠ (never a ✓)', (t) => {
  const { dir, deck } = tmpDeck(t, '\n');
  const out = path.join(dir, 'output.html');
  const r = lutrin(['build', deck, '-o', out, '--force']);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(fs.existsSync(out));
  assert.match(r.stdout, /⚠ .*output\.html — 0 slide/);
  assert.match(r.stdout, /No slide/i, 'the diagnostic must surface in the build output');
  assert.doesNotMatch(r.stdout, /✓/);
});

// A RENDER diagnostic at severity `error`: produced during writing, it was
// read by nobody. RASTER_UNAVAILABLE came back out blended into the warnings —
// a ⚠ under a green ✓, exit code 0 — while the delivered .pptx had lost its
// charts. This is the empty-deck rule, applied at the same place and in the
// other direction.
const DECK_CHART =
  '---\ntitle: Quarter\n---\n\n# Sales\n\n```chart\ntype: bar\ncategories: Q1, Q2\nSales: 3, 5\n```\n';

test('CLI: no rasterizer — the truncated .pptx does not come out under a ✓ with exit code 0', (t) => {
  const { dir, deck } = tmpDeck(t, DECK_CHART);
  const out = path.join(dir, 'output.pptx');
  const r = lutrin(['build', deck, '-o', out], { env: { LUTRIN_NO_RASTER: '1' } });
  assert.equal(r.code, 1, `a truncated deliverable does not exit with 0: ${r.stdout}`);
  assert.match(r.stderr, /✖ error RASTER_UNAVAILABLE/, 'the diagnostic keeps its severity');
  assert.match(r.stderr, /npm install/, 'the message must say WHAT TO DO');
  assert.doesNotMatch(r.stdout, /✓/, 'no full success must be announced');
  assert.match(r.stdout, /⚠ .*output\.pptx/);
  // the file STAYS: the text fallback is deliberate and the cause is the
  // installation, not the deck — destroying it would deprive the author whose
  // platform has no @resvg/resvg-js of any export at all
  assert.ok(fs.existsSync(out), 'the truncated output stays on disk, announced as such');
  // and the message must not be said twice, once per channel
  assert.equal(
    r.stdout.match(/Rasterizer/g),
    null,
    'the diagnostic does not double as a ⚠ on stdout',
  );
});

test('CLI: --force accepts the truncated rendering (exit code 0), without the ⚠ turning back into a ✓', (t) => {
  const { dir, deck } = tmpDeck(t, DECK_CHART);
  const out = path.join(dir, 'output.pptx');
  const r = lutrin(['build', deck, '-o', out, '--force'], { env: { LUTRIN_NO_RASTER: '1' } });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(fs.existsSync(out));
  assert.doesNotMatch(r.stdout, /✓/);
  assert.match(r.stderr, /RASTER_UNAVAILABLE/, 'the escape hatch stays noisy');
});

// ---------------------------------------------------------------------------
// inspect: -o
// ---------------------------------------------------------------------------

test('CLI inspect: -o WRITES the JSON to the file instead of dumping it on stdout', (t) => {
  const { dir, deck } = tmpDeck(t);
  const out = path.join(dir, 'sub', 'ir.json'); // subdirectory absent: created
  const r = lutrin(['inspect', deck, '-o', out]);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(fs.existsSync(out), 'the flag was accepted, then silently ignored');
  const ir = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.ok(Array.isArray(ir.scenes) && ir.scenes.length, 'the file does carry the IR');
  assert.doesNotMatch(r.stdout, /"scenes"/, 'stdout must no longer carry the dump');
  assert.match(r.stdout, /✓/);

  // without -o, the dump stays on stdout (the historical contract for scripts)
  const bare = lutrin(['inspect', deck]);
  assert.equal(bare.code, 0, bare.stderr);
  assert.ok(Array.isArray(JSON.parse(bare.stdout).scenes));
});

test('CLI inspect: -o without a .json extension is refused BEFORE writing, and --ir is no longer accepted with no effect', (t) => {
  const { dir, deck } = tmpDeck(t);
  const out = path.join(dir, 'ir.txt');
  const r = lutrin(['inspect', deck, '-o', out]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /\.json extension/);
  assert.equal(fs.existsSync(out), false);

  const ir = lutrin(['inspect', deck, '--ir']);
  assert.equal(ir.code, 1, 'what is not understood is said — not swallowed in silence');
  assert.match(ir.stderr, /unknown flag: --ir/);
});

// ---------------------------------------------------------------------------
// validate, capabilities, the global error message
// ---------------------------------------------------------------------------

test('CLI: validate --json stays usable JSON, exit code 1 on an error', (t) => {
  const { deck } = tmpDeck(t, FAULTY_DECK);
  const r = lutrin(['validate', deck, '--json']);
  assert.equal(r.code, 1);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, false);
  assert.ok(parsed.diagnostics.some((d) => d.code === 'UNKNOWN_DIRECTIVE'));
});

test('CLI: capabilities — JSON on stdout, with or without --json (the flag is the explicit form of the default)', () => {
  const bare = lutrin(['capabilities']);
  const explicit = lutrin(['capabilities', '--json']);
  assert.equal(bare.code, 0);
  assert.equal(explicit.code, 0);
  assert.deepEqual(JSON.parse(bare.stdout), JSON.parse(explicit.stdout));
  assert.ok(Array.isArray(JSON.parse(bare.stdout).layouts));
  // and every OTHER flag is now refused here
  assert.equal(lutrin(['capabilities', '--jsno']).code, 1);
  // with no argument, the catalog stays that of the BARE ENGINE: no custom layout
  assert.deepEqual(JSON.parse(bare.stdout).userLayouts, []);
});

test('CLI: capabilities <deck> publishes the deck custom layouts — the ones validation already knows', (t) => {
  const { dir, deck } = tmpDeck(
    t,
    '---\ntitle: Test\n---\n\n# Slide\n\n<!-- layout: my-four -->\n',
  );
  fs.mkdirSync(path.join(dir, 'layouts'));
  fs.writeFileSync(
    path.join(dir, 'layouts', 'my-four.json'),
    JSON.stringify({ name: 'my-four', base: 'swot' }),
  );

  // the deck compiles: validation, for its part, has ALWAYS known "my-four"
  assert.equal(lutrin(['validate', deck]).code, 0);

  for (const args of [
    ['capabilities', deck],
    ['capabilities', deck, '--json'],
  ]) {
    const r = lutrin(args);
    assert.equal(r.code, 0, args.join(' '));
    const caps = JSON.parse(r.stdout);
    assert.ok(caps.layouts.includes('my-four'), `${args.join(' ')} — layouts`);
    assert.deepEqual(
      caps.userLayouts.map((l) => l.name),
      ['my-four'],
      'the command that IS AUTHORITATIVE must show the layout validation accepts',
    );
    assert.deepEqual(caps.layoutSections['my-four'], { min: 4, max: 4 });
  }

  // the bare catalog, for its part, does not invent it
  assert.ok(!JSON.parse(lutrin(['capabilities']).stdout).layouts.includes('my-four'));
});

test('CLI: capabilities --kit <directory> publishes the BRAND layouts, with no deck', (t) => {
  const { dir } = tmpDeck(t);
  const kit = path.join(dir, 'brand');
  fs.mkdirSync(path.join(kit, 'layouts'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'kit.json'), JSON.stringify({ name: 'brand' }));
  fs.writeFileSync(
    path.join(kit, 'layouts', 'duo.json'),
    JSON.stringify({ name: 'duo', base: 'two-columns' }),
  );

  const r = lutrin(['capabilities', '--kit', kit, '--json']);
  assert.equal(r.code, 0, r.stderr);
  const caps = JSON.parse(r.stdout);
  assert.ok(caps.layouts.includes('duo'));
  assert.deepEqual(
    caps.userLayouts.map((l) => l.name),
    ['duo'],
  );
});

test('CLI: capabilities <deck> honors the FRONTMATTER "kit:" — the catalog is the one this deck compiles under', (t) => {
  const { dir, deck } = tmpDeck(
    t,
    '---\ntitle: Test\nkit: ./brand\n---\n\n# Slide\n\nSome text.\n',
  );
  const kit = path.join(dir, 'brand');
  fs.mkdirSync(path.join(kit, 'layouts'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'kit.json'), JSON.stringify({ name: 'brand' }));
  fs.writeFileSync(
    path.join(kit, 'layouts', 'duo.json'),
    JSON.stringify({ name: 'duo', base: 'two-columns' }),
  );

  const r = lutrin(['capabilities', deck]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(
    JSON.parse(r.stdout).userLayouts.map((l) => l.name),
    ['duo'],
  );
});

test('CLI: capabilities — a custom layout that could not be read is SAID on stderr, stdout stays usable JSON', (t) => {
  const { dir, deck } = tmpDeck(t);
  fs.mkdirSync(path.join(dir, 'layouts'));
  fs.writeFileSync(path.join(dir, 'layouts', 'broken.json'), '{ not json');

  const r = lutrin(['capabilities', deck]);
  assert.equal(r.code, 0);
  assert.match(
    r.stderr,
    /LAYOUT_DEF_INVALID/,
    'a truncated catalog must not have to explain itself',
  );
  assert.match(r.stderr, /broken\.json/);
  // the diagnostic does NOT pollute stdout: `capabilities | jq` stays possible
  assert.deepEqual(JSON.parse(r.stdout).userLayouts, []);
});

test('CLI: capabilities — a kit requested and not found is an ERROR, not a generic catalog', (t) => {
  const { dir } = tmpDeck(t);
  const r = lutrin(['capabilities', '--kit', path.join(dir, 'missing')]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '', 'no false catalog must go out on stdout');
  assert.match(r.stderr, /THEME_NOT_FOUND/);
  assert.match(r.stderr, /requested explicitly/);
});

test('CLI: capabilities — deck not found, one deck too many: named errors', (t) => {
  const { deck } = tmpDeck(t);
  const missing = lutrin(['capabilities', 'does-not-exist.md']);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /file not found: does-not-exist\.md/);
  const two = lutrin(['capabilities', deck, deck]);
  assert.equal(two.code, 1);
  assert.match(two.stderr, /a single input file is expected/);
});

test('CLI: the global error message names the COMMAND, not the first argument', (t) => {
  const { dir } = tmpDeck(t);
  // `kit create` on a directory that does not exist: the error rises to the global net
  const missing = path.join(dir, 'kit-missing');
  const r = lutrin(['kit', 'create', missing]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^✖ kit —/m, 'the old net prefixed the message with argv[0]');
  assert.doesNotMatch(r.stderr, new RegExp(`^✖ ${path.basename(missing)} —`, 'm'));
});

// ---------------------------------------------------------------------------
// preview: Host header (DNS rebinding) and an occupied port
// ---------------------------------------------------------------------------

/** Starts `preview` and waits for the announcement line to extract the port
 *  ACTUALLY listened on (it may differ from the one asked for: it switches
 *  when the port is busy). */
function startPreview(t, args) {
  const child = spawn(process.execPath, [CLI, 'preview', ...args], {
    encoding: 'utf8',
    env: process.env,
  });
  t.after(() => child.kill());
  const lines = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`preview did not start: ${lines.join(' / ')}`)),
      20000,
    );
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      lines.push(chunk);
      const m = chunk.match(/http:\/\/localhost:(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve({ child, port: Number(m[1]), output: () => lines.join('') });
      }
    });
    child.on('error', reject);
  });
}

/** A raw request: `fetch` REFUSES to set a Host header (a name forbidden by
 *  the specification) and would silently replace it with the authority of the
 *  URL — a test written with fetch would pass while checking nothing. */
function requestWithHost(port, host) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/', headers: { Host: host } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('CLI preview: a foreign Host header is refused (403) — a guard against DNS rebinding', async (t) => {
  const { deck } = tmpDeck(t);
  const { port } = await startPreview(t, [deck, '--port', '4901']);

  const legitimate = await requestWithHost(port, `localhost:${port}`);
  assert.equal(legitimate.status, 200);
  assert.equal((await requestWithHost(port, `127.0.0.1:${port}`)).status, 200);

  // listening on 127.0.0.1 is no protection: a victim's browser can be led to
  // resolve a third-party domain onto the local loopback
  const attacker = await requestWithHost(port, 'evil.example.com');
  assert.equal(attacker.status, 403);
  assert.match(attacker.body, /localhost/);
  assert.equal(attacker.headers['cache-control'], 'no-store');
});

test('CLI preview: the page is served with Cache-Control no-store (the deck is recompiled on every keystroke)', async (t) => {
  const { deck } = tmpDeck(t);
  const { port } = await startPreview(t, [deck, '--port', '4911']);
  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('CLI preview: an occupied port — the switch to the next one is announced, never a stack trace', async (t) => {
  const { deck } = tmpDeck(t);
  const first = await startPreview(t, [deck, '--port', '4921']);
  const second = await startPreview(t, [deck, '--port', String(first.port)]);

  assert.notEqual(second.port, first.port);
  assert.match(second.output(), /busy — switching to/);
  assert.doesNotMatch(second.output(), /EADDRINUSE/);
  // the fallback server really does serve the deck
  assert.equal((await fetch(`http://127.0.0.1:${second.port}/`)).status, 200);
});

test('CLI preview: a non-numeric --port — refused before anything starts', (t) => {
  const { deck } = tmpDeck(t);
  const r = lutrin(['preview', deck, '--port', 'abc']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /--port expects an integer/);
});

// ---------------------------------------------------------------------------
// worker: robustness of the IPC channel
// ---------------------------------------------------------------------------
// (the worker has no resilience test anywhere else; its queue is the fragile
//  point — an exception outside the try rejected it FOR GOOD, and every
//  subsequent request stayed unanswered in a worker that looked alive)

test('worker: a malformed IPC message stops neither the worker nor its queue', async (t) => {
  const { fork } = await import('node:child_process');
  const worker = fork(path.resolve(here, '..', 'src', 'worker', 'worker.mjs'), [], {
    silent: true,
    execArgv: [],
  });
  t.after(() => worker.kill());

  const waitFor = (id) =>
    new Promise((resolve) => {
      const onMessage = (msg) => {
        if (msg.id === id && 'ok' in msg) {
          worker.off('message', onMessage);
          resolve(msg);
        }
      };
      worker.on('message', onMessage);
    });

  // messages that the unconditional destructuring made throw OUTSIDE the try
  worker.send(null);
  worker.send('hello');
  worker.send({ id: 1 }); // neither cmd nor payload
  worker.send([1, 2, 3]);

  // the worker must still answer afterwards: the queue was not rejected
  const p = waitFor(2);
  worker.send({
    id: 2,
    cmd: 'validate',
    payload: { source: '---\ntitle: T\n---\n\n# D\n\nx.\n', baseDir: here },
  });
  const response = await p;
  assert.equal(response.ok, true);
  assert.ok(Array.isArray(response.result.diagnostics));
});

test('worker: an unknown command is a RENDERED error, not a frozen queue', async (t) => {
  const { fork } = await import('node:child_process');
  const worker = fork(path.resolve(here, '..', 'src', 'worker', 'worker.mjs'), [], {
    silent: true,
    execArgv: [],
  });
  t.after(() => worker.kill());

  const waitFor = (id) =>
    new Promise((resolve) => {
      const onMessage = (msg) => {
        if (msg.id === id && 'ok' in msg) {
          worker.off('message', onMessage);
          resolve(msg);
        }
      };
      worker.on('message', onMessage);
    });

  const p1 = waitFor(1);
  worker.send({ id: 1, cmd: 'compileEverything', payload: {} });
  const error = await p1;
  assert.equal(error.ok, false);
  assert.match(error.error.message, /unknown command/);

  const p2 = waitFor(2);
  worker.send({
    id: 2,
    cmd: 'validate',
    payload: { source: '---\ntitle: T\n---\n\n# D\n\nx.\n', baseDir: here },
  });
  assert.equal((await p2).ok, true, 'the next request must still go through');
});

// ---------------------------------------------------------------------------
// `lutrin config` — reading, writing and removing the user default.
// The body of cmdConfig had no dedicated test (the CLI wiring of the config);
// it is exercised here through LUTRIN_CONFIG pointed at a disposable directory.
// ---------------------------------------------------------------------------

test('config: reading on a pristine directory — announces the directory, no kit', (t) => {
  const conf = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-conf-'));
  t.after(() => fs.rmSync(conf, { recursive: true, force: true }));
  const r = lutrin(['config'], { env: { LUTRIN_CONFIG: conf } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Lutrin configuration/i);
  assert.match(r.stdout, /\[LUTRIN_CONFIG\]/, 'the source of the directory is indicated');
  assert.match(r.stdout, /none/, 'no default kit and none installed');
});

test('config --kit none: writes the default, read back on the next run', (t) => {
  const conf = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-conf-'));
  t.after(() => fs.rmSync(conf, { recursive: true, force: true }));
  const w = lutrin(['config', '--kit', 'none'], { env: { LUTRIN_CONFIG: conf } });
  assert.equal(w.code, 0, w.stderr);
  assert.match(w.stdout, /none/);
  assert.ok(fs.existsSync(path.join(conf, 'config.json')), 'config.json is written');
  const r = lutrin(['config'], { env: { LUTRIN_CONFIG: conf } });
  assert.match(r.stdout, /none/, 'the default that was set is read back');
});

test('config --unset: removes the user default', (t) => {
  const conf = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-conf-'));
  t.after(() => fs.rmSync(conf, { recursive: true, force: true }));
  lutrin(['config', '--kit', 'none'], { env: { LUTRIN_CONFIG: conf } });
  const u = lutrin(['config', '--unset'], { env: { LUTRIN_CONFIG: conf } });
  assert.equal(u.code, 0, u.stderr);
  assert.match(u.stdout, /removed/);
});
