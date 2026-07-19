#!/usr/bin/env node
/**
 * The `lutrin` command.
 *
 * This package exists so that `npx lutrin` and `npm i -g lutrin` work without
 * anyone having to know the scope. It carries no logic of its own: the
 * compiler, the CLI and the design assets all live in `@lutrin/core`, which is
 * its single dependency, pinned to the exact matching version.
 *
 * `@lutrin/core/cli` dispatches at import time — it reads `process.argv` and
 * exits the process itself — so importing it for its side effect IS the call.
 * There is deliberately nothing after this line.
 */
import '@lutrin/core/cli';
