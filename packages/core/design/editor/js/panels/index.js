/**
 * panels/index.js — the panel registry. THE ONE SHELL FILE PANEL AGENTS MAY
 * EDIT: add your panel's import and list it here. Order is irrelevant (the
 * nav rail is fixed in index.html); ids must match the rail's data-panel
 * values: tokens, fonts, layouts, images, kit.
 */

import fonts from './fonts.js';
import images from './images.js';
import kit from './kit.js';
import layouts from './layouts.js';
import tokens from './tokens.js';

export const PANELS = [tokens, fonts, layouts, images, kit];
