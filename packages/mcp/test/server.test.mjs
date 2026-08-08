/**
 * Behavioural tests: drive the server the way a real client does — over the MCP
 * protocol, through an in-memory transport pair — against the core's own
 * hermetic fixture (`all-blocks.deck.md`, one instance of every block type, no
 * remote resource). This proves the tools work end to end (list → call → parse
 * result), not merely that the adapter functions return.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, '..', '..', 'core', 'test', 'fixtures', 'all-blocks.deck.md');

let client;
let outDir;

/** The tool result the SDK returns carries JSON in a single text block — parse
 *  it back into the object the adapter produced. */
async function call(name, args) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content ?? []).map((c) => c.text ?? '').join('');
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* a usage/internal error message is plain text, not JSON */
  }
  return { isError: Boolean(res.isError), text, data };
}

before(async () => {
  const server = createServer();
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientT);
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-mcp-test-'));
});

after(() => {
  if (outDir) fs.rmSync(outDir, { recursive: true, force: true });
});

test('the server advertises validate_deck and build_deck', async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['build_deck', 'validate_deck']);
  // the input schema is exposed so a client can form calls
  const build = tools.find((t) => t.name === 'build_deck');
  assert.ok(build.inputSchema, 'build_deck must publish an input schema');
});

test('validate_deck reports the fixture as valid', async () => {
  const { isError, data } = await call('validate_deck', { path: FIXTURE });
  assert.equal(isError, false);
  assert.equal(data.valid, true, `unexpected errors: ${JSON.stringify(data.diagnostics)}`);
  assert.equal(data.errorCount, 0);
  assert.ok(Array.isArray(data.diagnostics));
  assert.equal(data.path, FIXTURE);
});

test('validate_deck accepts an inline deck and positions diagnostics', async () => {
  // An unknown directive is caught only by the source scan — a diagnostic, and
  // an error is a RESULT here, never a thrown call.
  const deck = ['# Title', '', ':::nonsense', 'body', ':::', ''].join('\n');
  const { isError, data } = await call('validate_deck', { deck });
  assert.equal(isError, false);
  assert.ok(data.diagnostics.length > 0, 'expected at least one diagnostic');
  assert.ok(
    data.diagnostics.some((d) => typeof d.line === 'number'),
    'diagnostics must be positioned (carry a line)',
  );
});

test('build_deck writes a .pptx and reports a slide count', async () => {
  const out = path.join(outDir, 'fixture.pptx');
  const { isError, data } = await call('build_deck', { path: FIXTURE, format: 'pptx', out });
  assert.equal(isError, false, data?.diagnostics ? JSON.stringify(data.diagnostics) : '');
  assert.equal(data.written, out);
  assert.ok(
    fs.existsSync(out) && fs.statSync(out).size > 0,
    'the .pptx must exist and be non-empty',
  );
  assert.ok(data.summary.slideCount > 0, 'a real deck has slides');
  // a .pptx is a zip: it starts with the local-file-header magic "PK"
  assert.equal(fs.readFileSync(out).subarray(0, 2).toString('latin1'), 'PK');
});

test('build_deck writes standalone HTML', async () => {
  const out = path.join(outDir, 'fixture.html');
  const { isError, data } = await call('build_deck', { path: FIXTURE, format: 'html', out });
  assert.equal(isError, false);
  assert.equal(data.written, out);
  const html = fs.readFileSync(out, 'utf8');
  assert.ok(
    html.includes('<!doctype html') || html.includes('<!DOCTYPE html'),
    'expected an HTML document',
  );
});

test('build_deck refuses a format it cannot guarantee (pdf), as a usage error', async () => {
  const { isError, text } = await call('build_deck', { path: FIXTURE, format: 'pdf' });
  assert.equal(isError, true);
  assert.match(text, /pptx|html/i);
});

test('build_deck does not write a deck carrying an error diagnostic', async () => {
  // A non-existent forced layout is an error; build must refuse to write it and
  // hand back the diagnostics instead (the CLI's "check before writing").
  const deck = ['# Slide', '', '<!-- layout: no-such-layout -->', '', 'Body text.', ''].join('\n');
  const out = path.join(outDir, 'should-not-exist.pptx');
  const { isError, data } = await call('build_deck', { deck, format: 'pptx', out });
  assert.equal(isError, false, 'a bad deck is a result, not a transport error');
  assert.equal(data.blocked, true);
  assert.equal(data.written, null);
  assert.ok(data.errorCount > 0);
  assert.ok(!fs.existsSync(out), 'nothing must be written when the deck is blocked');
});

test('build_deck with force writes despite errors', async () => {
  const deck = ['# Slide', '', '<!-- layout: no-such-layout -->', '', 'Body text.', ''].join('\n');
  const out = path.join(outDir, 'forced.pptx');
  const { isError, data } = await call('build_deck', { deck, format: 'pptx', out, force: true });
  assert.equal(isError, false);
  assert.equal(data.written, out);
  assert.equal(data.forced, true);
  assert.ok(fs.existsSync(out), 'force must write the file');
});

test('missing both deck and path is a usage error, not a crash', async () => {
  const { isError, text } = await call('validate_deck', {});
  assert.equal(isError, true);
  assert.match(text, /exactly one of/i);
});
