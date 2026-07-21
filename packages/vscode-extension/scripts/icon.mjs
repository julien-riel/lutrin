/**
 * Renders media/icon.png (256×256, the Marketplace icon) from the site's
 * favicon — one single source for the visual identity, never two drawings to
 * keep in sync. The Marketplace refuses SVG icons, hence the PNG; 256px is
 * Microsoft's recommended size (128px minimum, shown scaled down).
 *
 * @resvg/resvg-js is already a runtime dependency of the core, resolved here
 * through the node_modules hoisted at the monorepo root. The PNG is COMMITTED:
 * regenerating it is only needed when the favicon changes.
 *
 *   node scripts/icon.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const here = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.resolve(here, '..');
const svgPath = path.resolve(extRoot, '..', '..', 'site', 'assets', 'favicon.svg');
const pngPath = path.join(extRoot, 'media', 'icon.png');

const svg = fs.readFileSync(svgPath, 'utf8');
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 256 } }).render().asPng();
fs.mkdirSync(path.dirname(pngPath), { recursive: true });
fs.writeFileSync(pngPath, png);
console.log(`✓ ${path.relative(extRoot, pngPath)} (256×256) rendered from ${svgPath}`);
