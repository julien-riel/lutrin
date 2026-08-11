/**
 * Conformance of the plugin manifests to the Agent Plugins Specification
 * v1.0.0 (agent-plugins.org). This encodes the spec's own checklist
 * (Appendix A) as executable assertions, so a hand edit that steps outside the
 * closed schemas fails here rather than in some other client's loader.
 *
 * The facts that bind us (see docs/plans/agent-plugin.md §1):
 *   - plugin.json has a CLOSED schema (§5.2): only the ten listed top-level keys.
 *   - $schema is EXACT, and the spec version in plugin.json and mcp.json must
 *     match (§7.2).
 *   - `name` obeys §5.5.
 *   - mcp.json is the closed object { $schema, mcpServers } (§7.2); each server
 *     is a closed union keyed by `type`.
 *   - stdio `command` is a single token — a bare name or a ./-relative path,
 *     never a shell string (§7.2).
 *   - Path containment (§4.1): plugin-relative paths start with ./ and never
 *     escape with ../; the only variable expansions are ${PLUGIN_ROOT} /
 *     ${PLUGIN_DATA}, and `env` must define neither of them (§7.2).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PLUGIN_DIR = path.join(ROOT, 'plugin');
const read = (...seg) => JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, ...seg), 'utf8'));

const SPEC_VERSION = '1.0.0';
const PLUGIN_SCHEMA = `https://agent-plugins.org/schemas/${SPEC_VERSION}/plugin.schema.json`;
const MCP_SCHEMA = `https://agent-plugins.org/schemas/${SPEC_VERSION}/mcp.schema.json`;

/** The ten keys §5.2 allows at the top level of plugin.json, and no others. */
const PLUGIN_KEYS = new Set([
  '$schema',
  'name',
  'version',
  'description',
  'author',
  'homepage',
  'repository',
  'license',
  'keywords',
  'extensions',
]);

/** The spec version embedded in a schema URL (`…/1.0.0/plugin.schema.json`). */
const schemaVersion = (url) => url.match(/\/schemas\/([^/]+)\//)?.[1] ?? null;

// ---------------------------------------------------------------------------
// plugin.json
// ---------------------------------------------------------------------------

const PLUGIN = read('plugin.json');

test('plugin.json — only the keys §5.2 allows (closed schema)', () => {
  const extra = Object.keys(PLUGIN).filter((k) => !PLUGIN_KEYS.has(k));
  assert.deepEqual(extra, [], `plugin.json carries keys outside the closed schema: ${extra}`);
});

test('plugin.json — the two required fields are present', () => {
  // §5.2: $schema and name are required; everything else is optional.
  assert.ok('$schema' in PLUGIN, 'plugin.json is missing the required $schema');
  assert.ok('name' in PLUGIN, 'plugin.json is missing the required name');
});

test('plugin.json — $schema is exactly the v1.0.0 plugin schema URL', () => {
  assert.equal(PLUGIN.$schema, PLUGIN_SCHEMA);
});

test('plugin.json — name obeys §5.5', () => {
  const name = PLUGIN.name;
  assert.equal(typeof name, 'string', 'name must be a string');
  // 1–64 chars
  assert.ok(name.length >= 1 && name.length <= 64, `name length ${name.length} outside 1–64`);
  // [a-z0-9.-] only
  assert.match(name, /^[a-z0-9.-]+$/, 'name may contain only [a-z0-9.-]');
  // first and last char alphanumeric
  assert.match(name[0], /[a-z0-9]/, 'name must start with an alphanumeric');
  assert.match(name[name.length - 1], /[a-z0-9]/, 'name must end with an alphanumeric');
  // no `--`, no `..`
  assert.ok(!name.includes('--'), 'name must not contain "--"');
  assert.ok(!name.includes('..'), 'name must not contain ".."');
});

test('plugin.json — the version is a plain semver when present', () => {
  if (!('version' in PLUGIN)) return;
  assert.match(PLUGIN.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
});

// ---------------------------------------------------------------------------
// mcp.json
// ---------------------------------------------------------------------------

const MCP = read('mcp.json');

test('mcp.json — closed to { $schema, mcpServers } (§7.2)', () => {
  const extra = Object.keys(MCP).filter((k) => k !== '$schema' && k !== 'mcpServers');
  assert.deepEqual(extra, [], `mcp.json carries keys outside { $schema, mcpServers }: ${extra}`);
  assert.ok('mcpServers' in MCP, 'mcp.json is missing mcpServers');
});

test('mcp.json — $schema is exactly the v1.0.0 mcp schema URL', () => {
  assert.equal(MCP.$schema, MCP_SCHEMA);
});

test('mcp.json and plugin.json declare the SAME spec version (§7.2)', () => {
  assert.equal(
    schemaVersion(MCP.$schema),
    schemaVersion(PLUGIN.$schema),
    'the $schema spec version must match between plugin.json and mcp.json',
  );
});

/** No plugin-relative path may escape the root: no `../` anywhere, and the only
 *  variable expansions are ${PLUGIN_ROOT} / ${PLUGIN_DATA} (§4.1, §7.2). */
function assertContained(value, where) {
  if (typeof value !== 'string') return;
  assert.ok(!value.includes('../'), `${where}: "${value}" escapes the plugin root with "../"`);
  for (const m of value.matchAll(/\$\{([^}]*)\}/g)) {
    assert.ok(
      m[1] === 'PLUGIN_ROOT' || m[1] === 'PLUGIN_DATA',
      `${where}: unknown variable \${${m[1]}} — only \${PLUGIN_ROOT}/\${PLUGIN_DATA} expand`,
    );
  }
}

test('mcp.json — every server matches one closed variant, paths contained', () => {
  const servers = MCP.mcpServers;
  assert.equal(typeof servers, 'object', 'mcpServers must be an object');
  assert.ok(Object.keys(servers).length > 0, 'mcpServers is empty');

  const ALLOWED = {
    stdio: new Set(['type', 'command', 'args', 'env', 'cwd']),
    'streamable-http': new Set(['type', 'url', 'headers']),
    sse: new Set(['type', 'url', 'headers']),
  };

  for (const [name, server] of Object.entries(servers)) {
    const type = server.type;
    assert.ok(type in ALLOWED, `server "${name}": unknown type "${type}"`);
    const extra = Object.keys(server).filter((k) => !ALLOWED[type].has(k));
    assert.deepEqual(
      extra,
      [],
      `server "${name}" (${type}) carries keys outside its variant: ${extra}`,
    );

    if (type === 'stdio') {
      // command: a SINGLE token — a bare name (PATH-resolved) or a ./-relative
      // path — never a shell string.
      const cmd = server.command;
      assert.equal(typeof cmd, 'string', `server "${name}": command must be a string`);
      assert.ok(cmd.length > 0, `server "${name}": command is empty`);
      assert.ok(
        !/\s/.test(cmd),
        `server "${name}": command "${cmd}" is a shell string, not a token`,
      );
      if (cmd.includes('/'))
        assert.ok(
          cmd.startsWith('./'),
          `server "${name}": a path command must be ./-relative, got "${cmd}"`,
        );
      assertContained(cmd, `server "${name}" command`);

      for (const [i, a] of (server.args ?? []).entries())
        assertContained(a, `server "${name}" args[${i}]`);

      // env MUST NOT define PLUGIN_ROOT / PLUGIN_DATA (the client provides them)
      // and MUST NOT carry secrets — the values are still expansion-contained.
      for (const [k, v] of Object.entries(server.env ?? {})) {
        assert.ok(
          k !== 'PLUGIN_ROOT' && k !== 'PLUGIN_DATA',
          `server "${name}": env must not define ${k} — the client provides it`,
        );
        assertContained(v, `server "${name}" env.${k}`);
      }
      if ('cwd' in server) assertContained(server.cwd, `server "${name}" cwd`);
    }
  }
});

test('mcp.json — the lutrin server launches via npx, no cwd', () => {
  const server = MCP.mcpServers.lutrin;
  assert.ok(server, 'no "lutrin" server declared');
  assert.equal(server.type, 'stdio');
  assert.equal(server.command, 'npx', 'the canonical MCP launch form is a bare "npx" token');
  // cwd is omitted on purpose: the client defaults it to the plugin root
  // (§7.2.1), which npx does not need (plan §4).
  assert.ok(!('cwd' in server), 'the lutrin server must not set cwd');
});

// ---------------------------------------------------------------------------
// filesystem layout (§6.1 fixed discovery locations)
// ---------------------------------------------------------------------------

test('every skill lives at the spec discovery path skills/<name>/SKILL.md (§6.1)', () => {
  for (const name of ['deck', 'kit-from-site']) {
    const skill = path.join(PLUGIN_DIR, 'skills', name, 'SKILL.md');
    assert.ok(
      fs.existsSync(skill),
      `plugin/skills/${name}/SKILL.md missing — the client discovers it there`,
    );
  }
});

test('the manifests sit at the plugin root (§4, §6.1)', () => {
  assert.ok(fs.existsSync(path.join(PLUGIN_DIR, 'plugin.json')), 'plugin.json must be at the root');
  assert.ok(fs.existsSync(path.join(PLUGIN_DIR, 'mcp.json')), 'mcp.json must be at the root');
});
