/**
 * Serves site/ the way GitHub Pages will, so the playground can be opened
 * locally — `npm run site:serve`.
 *
 * It COPIES NOTHING. The three trees the playground needs are mapped as
 * virtual routes onto the working copy:
 *
 *     /core/src/…             → packages/core/src/…
 *     /core/design/layouts/…  → packages/core/design/layouts/…
 *     /core/design/layouts.json → generated per request
 *     /core/vendor/…          → packages/core/vendor/… (the Mermaid bundle)
 *     /vendor/<pkg>/…         → node_modules/<pkg>/…
 *
 * So editing the compiler and reloading the page shows the change, with no
 * build step here either. `.github/workflows/pages.yml` does the same mapping
 * with `cp`, because a deploy has no working copy to point at.
 *
 * The vendored packages are read out of the import map in playground.html
 * rather than listed here. There are already two copies of that list — the
 * map and the workflow — and packages/core/test/playground.test.mjs exists to
 * keep them equal; a third copy in a dev script would be the one nobody
 * remembers to update.
 *
 * The playground needs a real origin: `file://` gives modules an opaque origin
 * and refuses `fetch`, so opening site/playground.html by double-clicking it
 * cannot work and never will.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(REPO, 'site');
const CORE = path.join(REPO, 'packages', 'core');
const LAYOUTS = path.join(CORE, 'design', 'layouts');
const port = Number(process.argv[2] ?? process.env.PORT ?? 4400);

/** The packages playground.html's import map expects under /vendor/. */
function vendored() {
  const html = fs.readFileSync(path.join(SITE, 'playground.html'), 'utf8');
  const m = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('site/playground.html carries no import map');
  return new Set(
    Object.values(JSON.parse(m[1]).imports)
      .filter((t) => t.startsWith('./vendor/'))
      .map((t) => t.slice('./vendor/'.length).split('/')[0]),
  );
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/** Resolves a URL path to a file, or null. `root` is the boundary: a request
 *  is answered only from inside it, whatever ../ the path contains. */
function within(root, rest) {
  const file = path.resolve(root, `.${rest}`);
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
}

const VENDOR = vendored();

/** What CI writes to _site/core/design/layouts.json — computed per request so a
 *  layout added to the catalogue appears on the next reload. */
const layoutManifest = () =>
  JSON.stringify(
    fs
      .readdirSync(LAYOUTS)
      .filter((f) => f.endsWith('.json'))
      .sort(),
  );

/** The Lucide icon names, for the editor's `lucide:` completion — generated
 *  like the layout manifest, and BESIDE the icons directory for the same
 *  reason layouts.json sits beside layouts/. pages.yml writes the same file;
 *  playground.test.mjs pins the two generators to each other. */
const iconManifest = () =>
  JSON.stringify(
    fs
      .readdirSync(path.join(REPO, 'node_modules', 'lucide-static', 'icons'))
      .filter((f) => f.endsWith('.svg'))
      .map((f) => f.slice(0, -4))
      .sort(),
  );

function resolve(urlPath) {
  if (urlPath === '/core/design/layouts.json') return { generated: layoutManifest() };
  if (urlPath === '/vendor/lucide-static/icons.json') return { generated: iconManifest() };

  if (urlPath.startsWith('/core/src/'))
    return { file: within(path.join(CORE, 'src'), urlPath.slice('/core/src'.length)) };
  if (urlPath.startsWith('/core/design/layouts/'))
    return { file: within(LAYOUTS, urlPath.slice('/core/design/layouts'.length)) };
  // the package's own vendored files — the Mermaid bundle the playground loads
  // as a classic script; under /core/ because it ships inside @lutrin/core
  if (urlPath.startsWith('/core/vendor/'))
    return { file: within(path.join(CORE, 'vendor'), urlPath.slice('/core/vendor'.length)) };

  if (urlPath.startsWith('/vendor/')) {
    const [pkg, ...rest] = urlPath.slice('/vendor/'.length).split('/');
    // Only the packages the import map names: this server is a convenience,
    // not a way to publish node_modules.
    if (!VENDOR.has(pkg)) return { file: null };
    return { file: within(path.join(REPO, 'node_modules', pkg), `/${rest.join('/')}`) };
  }

  return { file: within(SITE, urlPath === '/' ? '/index.html' : urlPath) };
}

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('bad request');
    return;
  }
  if (urlPath.endsWith('/')) urlPath += 'index.html';

  const hit = resolve(urlPath);
  if (hit.generated !== undefined) {
    res.writeHead(200, { 'content-type': MIME['.json'] });
    res.end(hit.generated);
    return;
  }
  if (!hit.file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`404 ${urlPath}`);
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(hit.file)] ?? 'application/octet-stream',
    // The point of this server is to see an edit; a cached module defeats it.
    'cache-control': 'no-store',
  });
  fs.createReadStream(hit.file).pipe(res);
});

server.listen(port, () => {
  const layouts = fs.readdirSync(LAYOUTS).filter((f) => f.endsWith('.json')).length;
  console.log(
    [
      `site       http://127.0.0.1:${port}/`,
      `playground http://127.0.0.1:${port}/playground.html`,
      '',
      'compiler   packages/core/src  (live — edit and reload, nothing is copied)',
      `layouts    ${layouts} definitions`,
      `vendor     ${[...VENDOR].join(', ')}`,
    ].join('\n'),
  );
  // Without it the landing page's embedded slides are empty frames, which
  // looks like the page is broken rather than like a missing artifact.
  if (!fs.existsSync(path.join(SITE, 'demo.html')))
    console.log(
      [
        '',
        '⚠ site/demo.html is missing, so the landing page shows empty slide frames.',
        '  Run `npm run site` once to compile it.',
      ].join('\n'),
    );
});
