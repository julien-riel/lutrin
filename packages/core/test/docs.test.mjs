/**
 * Consistency of the DOCUMENTATION with the code actually shipped.
 *
 * The documentation of a public repository is a surface like any other, and it
 * had no guard at all: three lies lived in it right up to the pre-publication
 * review, each costly in its own way.
 *
 *   1. "Node ≥ 18 is required" in CONTRIBUTING.md and both READMEs, while the
 *      four package.json files declare `engines.node: ">=22"` and
 *      manifests.test.mjs locks it down. A contributor on Node 18 followed the
 *      docs, `npm ci` raised a warning, then the suite failed on the glob of
 *      `node --test "<pattern>"` — with nothing to point at the cause.
 *   2. `lutrin build` stopped writing anything at all once the deck carries an
 *      error diagnostic (exit code 1, `--force` to override), and NONE of the
 *      three documents mentioned `--force` for `build`. The worst case is
 *      `.claude/skills/deck/SKILL.md`: it instructs AGENTS to run
 *      `lutrin build`, which from then on failed on them without explanation.
 *   3. References to a `plan-kits.md` plan deleted from the repository, in the
 *      headers of several modules — a reader looking for the kit format landed
 *      on a dead path. (The path is deliberately not written out in full here:
 *      the last check in this file reads the repository, and would flag
 *      itself.)
 *
 * These checks read the documentation files as text: they cannot prove the
 * docs are GOOD, only that they no longer assert what the code contradicts.
 * That is exactly what was missing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** The documents a human reads before contributing to or using the tool. */
const DOCS = [
  'README.md',
  'CONTRIBUTING.md',
  'docs/dsl.md',
  'packages/core/README.md',
  '.claude/skills/deck/SKILL.md',
];

// ---------------------------------------------------------------------------
// 1. Node baseline
// ---------------------------------------------------------------------------

test('no document announces a stale Node version', () => {
  const expected = JSON.parse(read('package.json')).engines.node; // ">=22"
  const major = expected.replace(/[^0-9]/g, ''); // "22"

  // "Node ≥ 18", "Node >= 18", "Node 18" — every form encountered
  const MENTION = /Node\s*(?:≥|>=|>|⩾)?\s*(\d+)/g;
  for (const doc of DOCS) {
    const text = read(doc);
    for (const [phrase, version] of text.matchAll(MENTION)) {
      assert.equal(
        version,
        major,
        `${doc}: "${phrase}" contradicts engines.node = "${expected}" in the package.json files`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 2. the output contract of `build`
// ---------------------------------------------------------------------------

/** The three documents that describe the `build` command to someone — a human
 *  (README) or an agent (SKILL.md). A fourth could join them; these three are
 *  the ones that lied. */
const CLI_DOCS = ['README.md', 'packages/core/README.md', '.claude/skills/deck/SKILL.md'];

test('every CLI doc mentions --force for build, not only for kit install', () => {
  for (const doc of CLI_DOCS) {
    const text = read(doc);
    // "--force" already appeared for `kit install`: require it to appear
    // SOMEWHERE OTHER than on a `kit install` line, or the guard is hollow
    const lines = text.split('\n').filter((l) => l.includes('--force') && !/kit\s+install/.test(l));
    assert.ok(
      lines.length > 0,
      `${doc}: "--force" only appears for "kit install" — so the flag that unblocks "build" is documented nowhere`,
    );
  }
});

test('every CLI doc says build exits with an error and writes nothing', () => {
  for (const doc of CLI_DOCS) {
    const text = read(doc);
    assert.match(text, /code 1|exit 1/, `${doc}: the exit code 1 of "build" is not documented`);
    assert.match(
      text,
      /writes no file|writes nothing|no file (?:is )?written/i,
      `${doc}: nothing states that "build" writes NO file when the deck is in error`,
    );
  }
});

test('the implicit-kit nuance is documented where it plays out', () => {
  // A KIT_NOT_FOUND is only fatal when the kit was asked for explicitly
  // (--kit or `kit:`). Documenting the refusal without that nuance would
  // suggest that a stale user default blocks every compilation.
  for (const doc of [
    'README.md',
    'packages/core/README.md',
    'docs/dsl.md',
    '.claude/skills/deck/SKILL.md',
  ]) {
    assert.match(
      read(doc),
      /implicit/i,
      `${doc}: the explicit kit / implicit kit distinction does not appear`,
    );
  }
});

// ---------------------------------------------------------------------------
// 3. dead references
// ---------------------------------------------------------------------------

/** A review report NAMES the files it had deleted: that is its very purpose,
 *  not a reference anyone would follow. The only document in the repository in
 *  that position. */
const EXCLUDED_FROM_CHECK = new Set(['REVUE-PRE-PUBLICATION.md']);

/** Walks the sources and the docs of the repository, excluding node_modules
 *  and golden. */
function* repoFiles(dir = ROOT) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'golden') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* repoFiles(p);
    else if (/\.(mjs|md|json|ts)$/.test(e.name) && !EXCLUDED_FROM_CHECK.has(path.relative(ROOT, p)))
      yield p;
  }
}

test('no reference points at a docs/ file that does not exist', () => {
  const dead = [];
  for (const file of repoFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    for (const [, target] of text.matchAll(/(?<![\w/.-])(docs\/[A-Za-z0-9._-]+\.md)/g)) {
      if (!fs.existsSync(path.join(ROOT, target)))
        dead.push(`${path.relative(ROOT, file)} → ${target}`);
    }
  }
  assert.deepEqual(
    dead,
    [],
    'references to deleted documentation files — fix the reference or remove it',
  );
});

/** Strips fenced code blocks — the DSL documentation is FULL of
 *  `![alt](image.png)` examples that designate no file in the repository: they
 *  are syntax samples, not references. The closing fence must be at least as
 *  long as the opening one (docs/dsl.md nests ``` inside ````). */
function stripCodeFences(text) {
  const lines = text.split('\n');
  let fence = null;
  return (
    lines
      .filter((l) => {
        const f = /^\s*(`{3,}|~{3,})/.exec(l);
        if (fence) {
          if (f?.[1].startsWith(fence[0]) && f[1].length >= fence.length) fence = null;
          return false;
        }
        if (f) {
          fence = f[1];
          return false;
        }
        return true;
      })
      .join('\n')
      // ... and inline code of the same kind ("write `![alt](image.png)`")
      .replace(/`[^`\n]*`/g, '')
  );
}

/**
 * Every internal Markdown link, not only the `docs/` references.
 *
 * The previous check saw a single form: a path under `docs/` written in the
 * clear, resolved from the root. It therefore let through a link to the DSL
 * reference whose RELATIVE path is wrong — the mistake one risks when citing it
 * from a package README, two levels deep — and every reference to a file
 * outside `docs/`.
 * Here, each link target is resolved from the directory of the file that cites
 * it, exactly as the reader or GitHub will.
 */
test('every internal Markdown link points at a file that exists', () => {
  // `[text](target)` — external targets (scheme, `//host`, `#anchor`) and badge
  // images are none of this check's business.
  const LINK = /\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  const dead = [];
  for (const file of repoFiles()) {
    if (!file.endsWith('.md')) continue;
    const text = stripCodeFences(fs.readFileSync(file, 'utf8'));
    for (const [, raw] of text.matchAll(LINK)) {
      if (/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(raw)) continue;
      const target = raw.split('#')[0];
      if (!target) continue;
      const resolved = path.resolve(path.dirname(file), target);
      if (!fs.existsSync(resolved)) dead.push(`${path.relative(ROOT, file)} → ${raw}`);
    }
  }
  assert.deepEqual(dead, [], 'broken internal Markdown links — fix the path or remove the link');
});

// ---------------------------------------------------------------------------
// 4. the command forms cited really do exist
// ---------------------------------------------------------------------------

/**
 * The two guards that follow were born of a defect of a new kind: the code had
 * changed, the docs had not become FALSE, they had become INSUFFICIENT.
 * `lutrin capabilities` now accepts a deck and/or `--kit` — without which it
 * publishes only the bare engine, `userLayouts` empty. Yet the five places that
 * send an agent to query it still showed the bare form: the agent ran it in a
 * project with a brand, saw none of the kit's layouts, and had its
 * `<!-- layout: … -->` refused by an `UNKNOWN_LAYOUT` naming a layout that
 * exists. No guard could see it: the documentation tests only read what the
 * documents ASSERT, never what they SHOW.
 */

/** The CLI USAGE block — the only list of forms that is executable. */
function cliUsage() {
  const src = read('packages/core/src/cli.mjs');
  const block = /^const USAGE = `([\s\S]*?)`;$/m.exec(src);
  assert.ok(block, 'packages/core/src/cli.mjs: "const USAGE = `…`" block not found');
  /** command ("build", "kit") → union of the flags of its usage lines */
  const flags = new Map();
  for (const line of block[1].split('\n')) {
    const m = /^\s*lutrin\s+([a-z][a-z-]*)/.exec(line);
    if (!m) continue;
    const cmd = m[1];
    if (!flags.has(cmd)) flags.set(cmd, new Set());
    for (const [, f] of line.matchAll(/(?<![\w-])(--?[a-z][a-z-]*)/g)) flags.get(cmd).add(f);
  }
  assert.ok(
    flags.has('capabilities'),
    'USAGE no longer describes "capabilities" — guard to revisit',
  );
  return flags;
}

/**
 * Every `lutrin <command> …` cited in the docs, with its flags.
 *
 * We read the RAW text, code blocks and `inline code` included: it is precisely
 * the form SHOWN that we want to check, not the prose around it. The subcommand
 * must follow `lutrin` after exactly ONE space — the only occurrence in the
 * repository that is not a command form is an ASCII diagram in the README, where
 * the columns are aligned with multiple spaces.
 */
function* citedUsageForms(text) {
  for (const line of text.split('\n')) {
    const withoutComment = line.split('#')[0];
    for (const m of withoutComment.matchAll(/(?<![\w-])(?:npx )?lutrin ([a-z][a-z-]*)([^`\n]*)/g)) {
      const flags = [...m[2].matchAll(/(?<![\w-])(--?[a-z][a-z-]*)/g)].map((d) => d[1]);
      yield { form: m[0].trim(), cmd: m[1], flags };
    }
  }
}

test('every "lutrin …" form cited in the docs exists in the CLI USAGE block', () => {
  const usage = cliUsage();
  const faults = [];
  for (const doc of [...DOCS, 'SECURITY.md']) {
    for (const { form, cmd, flags } of citedUsageForms(read(doc))) {
      if (!usage.has(cmd)) {
        faults.push(`${doc}: "${form}" — "lutrin ${cmd}" does not exist`);
        continue;
      }
      for (const f of flags)
        if (!usage.get(cmd).has(f))
          faults.push(`${doc}: "${form}" — "${f}" is not a flag of "${cmd}"`);
    }
  }
  assert.deepEqual(
    faults,
    [],
    'documented command forms the CLI does not know — fix the docs, or the USAGE block if it has fallen behind',
  );
});

/**
 * `capabilities` "is authoritative" — but the BARE form is authoritative only
 * on the bare engine. Any document that sends someone to query it must
 * therefore show at least once the form that keeps that promise in a project
 * with a brand: a deck as argument, or `--kit`.
 */
test('the docs show "capabilities" in the form that sees kits', () => {
  for (const doc of [...CLI_DOCS, 'docs/dsl.md']) {
    const forms = [...citedUsageForms(read(doc))].filter((f) => f.cmd === 'capabilities');
    if (!forms.length) continue; // this document sends nobody there
    const carriesPromise = forms.some(
      ({ form, flags }) =>
        flags.includes('--kit') || /^(?:npx )?lutrin capabilities\s+[^-\s]/.test(form),
    );
    assert.ok(
      carriesPromise,
      `${doc}: "lutrin capabilities" is only shown there in its bare form, which yields "userLayouts: []" — show "lutrin capabilities <deck.md>" (or "--kit"), the only form that publishes the layouts of the kit and of the neighbouring "layouts/" directory`,
    );
  }
});

// ---------------------------------------------------------------------------
// 5. a contributor's front door
// ---------------------------------------------------------------------------

/** The `format` job of the CI is BLOCKING and runs `npm run lint`. It lived
 *  without being named anywhere: a contributor following CONTRIBUTING to the
 *  letter (clone, install, test, typecheck) watched their first PR turn red on
 *  a job they had never heard of. The two documents that say how to check your
 *  work must name it. */
test('the getting-started documents name the blocking lint of the CI', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  assert.ok(
    scripts.lint,
    'the "lint" script has disappeared from the root package.json — update the docs',
  );

  for (const doc of ['CONTRIBUTING.md', 'README.md']) {
    const text = read(doc);
    assert.match(
      text,
      /npm run lint/,
      `${doc}: "npm run lint" is named nowhere, while the "format" job of the CI runs it and blocks the PR`,
    );
    assert.match(
      text,
      /blocking/i,
      `${doc}: nothing says the lint job is BLOCKING — a contributor will take it for a convenience`,
    );
  }
});

/** `npm test` at the root runs all THREE packages since it became
 *  `npm test --workspaces`; the docs still announced core alone. The short form
 *  for the engine alone is `npm run test:core`, and it must be cited where
 *  testing is explained. */
test('the docs no longer reduce "npm test" to the core package alone', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  if (!/--workspaces/.test(scripts.test)) return; // the contract changed: this test is moot
  for (const doc of ['CONTRIBUTING.md', 'README.md']) {
    assert.match(
      read(doc),
      /npm run test:core/,
      `${doc}: "npm test" now runs the three packages; "npm run test:core" is not cited`,
    );
  }
});
