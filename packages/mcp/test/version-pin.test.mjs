/**
 * The plugin ships no server code: `plugin/mcp.json` launches the MCP server
 * with `npx -y @lutrin/mcp@<version>`, a PINNED version. That pin must name a
 * build that actually exists — i.e. exactly the version this repository
 * publishes as `@lutrin/mcp` (`packages/mcp/package.json`).
 *
 * If the two drift, a plugin checkout points `npx` at a version never
 * published (or an older one than the skill it ships beside), and the failure
 * only surfaces on a user's first run, as an opaque npm resolution error. This
 * check is the release guard that replaces the bundled-artifact reproducibility
 * guard the esbuild route would have needed — same spirit as the extension's
 * `latest.json` / VSIX consistency check.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...seg) => JSON.parse(fs.readFileSync(path.join(ROOT, ...seg), 'utf8'));

const MCP_PKG = read('packages', 'mcp', 'package.json');
const MCP_JSON = read('plugin', 'mcp.json');

/** The single `@lutrin/mcp@<version>` spec carried in the mcp.json launch args. */
function pinnedSpec() {
  const server = MCP_JSON.mcpServers?.lutrin;
  assert.ok(server, 'plugin/mcp.json defines no "lutrin" server');
  const specs = (server.args ?? []).filter(
    (a) => typeof a === 'string' && a.startsWith('@lutrin/mcp@'),
  );
  assert.equal(specs.length, 1, `expected exactly one @lutrin/mcp@… arg, got ${specs.length}`);
  return specs[0];
}

test('mcp.json pins @lutrin/mcp at the version packages/mcp publishes', () => {
  const spec = pinnedSpec();
  const pinned = spec.slice('@lutrin/mcp@'.length);
  assert.equal(
    pinned,
    MCP_PKG.version,
    `plugin/mcp.json pins ${spec} but packages/mcp/package.json is ${MCP_PKG.version} — bump both together (and publish @lutrin/mcp before the plugin can resolve it)`,
  );
});

test('the pinned version is exact — never a range or a dist-tag', () => {
  // A range (`^1.2.0`) or `@latest` would make a given plugin checkout run an
  // unknown server build: reproducibility over auto-upgrade (plan §4).
  const pinned = pinnedSpec().slice('@lutrin/mcp@'.length);
  assert.match(
    pinned,
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
    `the pin must be an exact semver, got "${pinned}"`,
  );
});

test('the MCP package and the plugin manifest share the same version', () => {
  // The plugin version tracks the server it pins (plan §5): a plugin at 1.2.0
  // pinning @lutrin/mcp@1.2.0 is coherent; a mismatch is a release mistake.
  const PLUGIN = read('plugin', 'plugin.json');
  assert.equal(
    PLUGIN.version,
    MCP_PKG.version,
    `plugin/plugin.json is ${PLUGIN.version}, packages/mcp is ${MCP_PKG.version} — keep them aligned`,
  );
});
