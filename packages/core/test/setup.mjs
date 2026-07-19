/**
 * Shared setup for the core suite — loaded via `node --import ./…/setup.mjs`
 * (see the "test" scripts in the package.json files). Makes the WHOLE suite
 * hermetic with respect to the user configuration.
 *
 * Without this, a real `~/.config/lutrin/config.json` — the one belonging to
 * the developer trying the feature out — would apply as the default theme to
 * decks that declare none, and would fail the many tests that expect the
 * generic theme (the forked worker inherits this environment, so it is covered
 * too). LUTRIN_CONFIG pointed at a NON-EXISTENT directory = "no config": every
 * read fails cleanly. The tests that genuinely exercise the user config
 * override it and then restore it.
 *
 * `??=`: a value already set in the environment (a developer debugging with a
 * real config) is respected; CI, for its part, starts from nothing and stays
 * isolated.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.LUTRIN_CONFIG ??= path.join(here, 'fixtures', '__no-user-config__');
