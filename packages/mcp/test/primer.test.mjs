/**
 * The DSL primer is the server's `instructions`: it lands in every session's
 * context, so it must stay small, and it names layouts, directives, fences,
 * comments and chart types, so it must not drift from what the engine actually
 * accepts. Both are checked here against `capabilities()` — the same source the
 * CLI's `lutrin capabilities` prints.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { capabilities } from '@lutrin/core/validate';
import { DSL_PRIMER, PRIMER_MAX_CHARS } from '../src/primer.mjs';
import { createServer } from '../src/server.mjs';

const caps = capabilities();

/** The comma-separated names on the line that follows a label in the primer
 *  ("Types: bar, barh, …" → ["bar", "barh", …]). */
function namesAfter(label) {
  const m = DSL_PRIMER.match(new RegExp(`${label}\\s*([^.\\n]+)`));
  assert.ok(m, `primer no longer carries "${label}"`);
  return m[1]
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
}

test('the primer stays within its context budget', () => {
  assert.ok(
    DSL_PRIMER.length <= PRIMER_MAX_CHARS,
    `primer is ${DSL_PRIMER.length} chars, budget is ${PRIMER_MAX_CHARS} — trim, do not raise the cap`,
  );
});

test('every layout the primer names is one the engine registers', () => {
  const known = new Set(caps.layouts);
  const cited = [...namesAfter('not paginated\\):'), ...namesAfter('Official named ones:')];
  assert.ok(cited.length >= 30, `expected the two layout lists, got ${cited.length} names`);
  for (const name of cited) assert.ok(known.has(name), `primer cites unknown layout "${name}"`);
  // and the official catalog is cited in full — an agent should not have to
  // guess that `kanban` exists
  const official = new Set(caps.officialLayouts.map((l) => l.name));
  for (const name of official)
    assert.ok(cited.includes(name), `official layout "${name}" is missing from the primer`);
});

test('every directive, fence, comment and chart type the primer names exists', () => {
  for (const d of DSL_PRIMER.match(/:::([a-z]+)/g).map((m) => m.slice(3)))
    assert.ok(caps.directives.includes(d), `primer cites unknown directive ":::${d}"`);
  for (const d of caps.directives)
    assert.ok(DSL_PRIMER.includes(`:::${d}`), `directive ":::${d}" is missing from the primer`);

  for (const f of DSL_PRIMER.match(/```([a-z]+)/g).map((m) => m.slice(3)))
    assert.ok(caps.codeFences.includes(f), `primer cites unknown fence "\`\`\`${f}"`);

  for (const c of DSL_PRIMER.match(/<!-- ([a-z]+)/g).map((m) => m.slice(5)))
    assert.ok(caps.comments.includes(c), `primer cites unknown slide comment "<!-- ${c}"`);

  const charts = namesAfter('Types:');
  assert.deepEqual(charts.sort(), [...caps.chartTypes].sort(), 'chart types drifted');
});

test('a client receives the primer as the server instructions', async () => {
  const server = createServer();
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientT);
  assert.equal(client.getInstructions(), DSL_PRIMER);

  // and the same text through the tool, for clients that ignore instructions
  const res = await client.callTool({ name: 'dsl_reference', arguments: {} });
  assert.equal(res.content[0].text, DSL_PRIMER);
  await client.close();
});
