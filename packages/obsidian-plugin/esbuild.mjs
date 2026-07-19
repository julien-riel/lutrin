/** Plugin bundle (TypeScript → dist/main.js, CJS — the format Obsidian
 *  imposes). The worker and the core are NOT bundled — see
 *  scripts/package.mjs. */

import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'es2022',
  // `obsidian` and `electron` are provided by the host application
  external: ['obsidian', 'electron'],
  sourcemap: true,
  logLevel: 'info',
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
