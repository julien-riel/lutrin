/**
 * Shared setup for the @lutrin/mcp suite — loaded via
 * `node --import ./test/setup.mjs`. Same purpose as the core suite's setup:
 * make every test hermetic with respect to the developer's own Lutrin config.
 *
 * The server builds decks that declare no kit; a real
 * `~/.config/lutrin/config.json` would then apply as the default theme and make
 * a "generic theme" assertion fail on the maintainer's machine while passing in
 * CI. Pointing LUTRIN_CONFIG at a directory that does not exist means "no
 * config": every read fails cleanly and the generic theme always applies.
 *
 * `??=`: a value already set (a developer debugging against a real config) is
 * respected; CI starts from nothing and stays isolated.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.LUTRIN_CONFIG ??= path.join(here, 'fixtures', '__no-user-config__');
