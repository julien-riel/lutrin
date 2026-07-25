/**
 * Reproduction de la capture « 74926 — AGIR+ » EN PARTANT DE L'IR :
 * les scènes sont écrites à la main (aucun Markdown, aucun layout engine),
 * puis passées telles quelles à renderDeckHtml().
 *
 * Contrainte volontaire : n'utiliser QUE les 16 types de blocs de l'IR
 * (para, heading, bullets, code, table, alert, metric, quote, image, mermaid,
 * icon, math, chart, panel, timeline-axis, timeline-dot).
 *
 * Chaque contournement est marqué « HACK: » — c'est la liste des manques.
 */
import fs from 'node:fs';
import { renderDeckHtml } from '/Users/julienriel/src/lutrin/packages/core/src/html/render.mjs';
import { COLORS } from '/Users/julienriel/src/lutrin/packages/core/src/deck/tokens.mjs';
import { applyTheme } from '/Users/julienriel/src/lutrin/packages/core/src/deck/theme.mjs';

// HACK #0 — le corps de texte est figé à TYPE.body (14 pt) : aucun bloc ne
// porte de taille, sauf `heading` via `size`. À 14 pt, une colonne de 260 px
// tient 26 caractères par ligne : la densité d'un tableau de bord est hors
// d'atteinte. Le SEUL levier est le thème, et il est GLOBAL (tout le deck).
applyTheme({
  type: {
    slideTitle: 19,
    sectionHeading: 11,
    body: 9,
    bullet: 9,
    tableBody: 8.5,
    tableHeader: 8.5,
    caption: 7,
  },
});

const runs = (text, extra = {}) => [{ text, ...extra }];
const el = (block, x, y, w, h) => ({ block, region: { x, y, w, h } });

/** `heading` est le seul bloc qui accepte `size` (pt) et `color` : il sert de
 *  couteau suisse typographique — micro-légendes, gros chiffres, pastilles
 *  « ● », valeurs alignées à la main. Il est toujours gras (font-weight:700). */
const txt = (text, x, y, w, h, { size, color, align } = {}) =>
  el(
    {
      type: 'heading',
      depth: 2,
      runs: runs(text),
      ...(size ? { size } : {}),
      ...(color ? { color } : {}),
      ...(align ? { align } : {}),
    },
    x,
    y,
    w,
    h,
  );

const para = (text, x, y, w, h, color) =>
  el({ type: 'para', runs: runs(text), ...(color ? { color } : {}) }, x, y, w, h);

const panel = (variant, x, y, w, h, extra = {}) =>
  el({ type: 'panel', variant, ...extra }, x, y, w, h);

/** HACK: pas de bloc « filet » — un axe de timeline sans flèche, haut de 2 px. */
const rule = (x, y, w, h = 2) => el({ type: 'timeline-axis', arrow: false }, x, y, w, h);

const els = [];
const push = (...items) => els.push(...items);

// ---------------------------------------------------------------------------
// Géométrie — la contentArea du thème est x=48 y=112 w=1184 h=560.
// Cette grille asymétrique est écrite à la main : le layout `grid` de l'IR ne
// produit que des cellules de taille uniforme, sans fusion de cases.
// ---------------------------------------------------------------------------
const X0 = 48;
const COL = [
  { x: 48, w: 300 },
  { x: 372, w: 434 },
  { x: 830, w: 402 },
];
const R1 = { y: 112, h: 214 };
const R2 = { y: 342, h: 262 };

/** En-tête de panneau : bandeau gris + icône + titre.
 *  HACK: aucun bloc « panneau à en-tête » — trois éléments empilés à la main
 *  (le `headed:true` du layout grid ne donne qu'un titre + un filet, sans
 *  bandeau ni icône). */
function head(x, y, w, title, icon) {
  push(
    panel('muted', x, y, w, 34),
    el({ type: 'icon', name: icon, color: 'primary' }, x + 12, y + 8, 18, 18),
    txt(title, x + 38, y + 8, w - 50, 20, { size: 11, color: COLORS.neutralPrimary }),
  );
}

// ---------------------------------------------------------------------------
// 1 — Santé du projet
// ---------------------------------------------------------------------------
{
  const { x, w } = COL[0];
  const { y, h } = R1;
  push(
    panel('muted', x, y, w, h),
    txt('SANTÉ DU PROJET', x + 16, y + 12, w - 32, 16, {
      size: 10,
      color: COLORS.neutralSecondary,
    }),
    txt('à ce jour – 14 juillet 2026', x + 16, y + 30, w - 32, 12, {
      size: 7,
      color: COLORS.neutralTertiary,
    }),
  );
  // HACK: aucun bloc « jauge » / « score ». Le grand chiffre est composé de
  // trois `heading` juxtaposés dont les abscisses sont devinées à la main.
  push(
    txt('5', x + 20, y + 48, 60, 58, { size: 40, color: COLORS.positive }),
    txt('/8', x + 60, y + 62, 40, 28, { size: 19, color: COLORS.neutralTertiary }),
    txt('conformes', x + 20, y + 102, 110, 16, { size: 10, color: COLORS.positive }),
  );
  push(rule(x + 140, y + 52, 2, 68)); // HACK: séparateur vertical → filet de 2 px
  push(
    txt('1 CRITIQUE', x + 156, y + 54, 140, 22, { size: 14, color: COLORS.negative }),
    txt('2 À SURVEILLER', x + 156, y + 82, 140, 40, { size: 14, color: COLORS.warning }),
  );
  // HACK: pas de bloc `badge`/`chip`. Un panel + un heading par pastille, et
  // le fond reste dans les variants disponibles : `pillar` (blanc + bordure)
  // ou `semantic` (teintes PÂLES). Les pastilles PLEINES rouge / jaune de la
  // maquette, avec texte blanc et coins « pilule », sont hors d'atteinte :
  // le rayon des panels est figé (8 / 4 / 2 px selon le variant).
  const chips = [
    ['Portée', null, COLORS.positiveDark],
    ['Échéancier', null, COLORS.positiveDark],
    ['Budget', 'warning', COLORS.warningDark],
    ['Qualité', null, COLORS.positiveDark],
    ['RH', null, COLORS.positiveDark],
    ['Risques', 'danger', COLORS.negativeDark],
    ['Approvisionnement', null, COLORS.positiveDark],
    ['Parties prenantes', 'warning', COLORS.warningDark],
  ];
  let cx = x + 16;
  let cy = y + 130;
  for (const [label, kind, ink] of chips) {
    const cw = 14 + label.length * 5.4;
    if (cx + cw > x + w - 12) {
      cx = x + 16;
      cy += 26;
    }
    push(
      panel(kind ? 'semantic' : 'pillar', cx, cy, cw, 20, kind ? { kind } : { accent: false }),
      // HACK: pas de centrage (ni vertical ni horizontal, hors `align:center`
      // sur un heading) → décalage calculé à la main.
      txt(label, cx + 7, cy + 3, cw - 10, 14, { size: 7, color: ink }),
    );
    cx += cw + 6;
  }
}

// ---------------------------------------------------------------------------
// 2 — Risques et points à surveiller
// ---------------------------------------------------------------------------
{
  const { x, w } = COL[1];
  const { y, h } = R1;
  push(panel('pillar', x, y, w, h, { accent: false }));
  head(x, y, w, 'Risques et points à surveiller', 'circle-alert');
  const rows = [
    [
      'Parties prenantes',
      COLORS.warning,
      "Manque d'engagement des parties prenantes clés pourrait entraîner des retards dans la prise de décision",
    ],
    [
      'Risques',
      COLORS.negative,
      'Une importante tempête de neige pourrait limiter la disponibilité des ressources clés lors de la prochaine mise en production',
    ],
    [
      'Budget',
      COLORS.warning,
      'Chevauchement de fiches mandat pourrait entraîner un dépassement de 200 k$',
    ],
  ];
  let ry = y + 48;
  for (const [label, dot, desc] of rows) {
    // HACK: pas de puce colorée — le caractère « ● » posé dans un heading
    // coloré tient lieu de pastille.
    push(
      txt('●', x + 14, ry + 1, 14, 14, { size: 9, color: dot }),
      txt(label, x + 32, ry, 110, 30, { size: 9, color: COLORS.neutralPrimary }),
      para(desc, x + 150, ry - 2, w - 166, 52),
    );
    ry += 56;
  }
}

// ---------------------------------------------------------------------------
// 3 — Décisions prioritaires — le seul panneau que l'IR sait rendre nativement
// ---------------------------------------------------------------------------
{
  const { x, w } = COL[2];
  const { y, h } = R1;
  push(panel('pillar', x, y, w, h, { accent: false }));
  head(x, y, w, 'Décisions prioritaires', 'circle-alert');
  push(
    el(
      {
        type: 'table',
        header: [runs('Date'), runs('Description'), runs('Type')],
        rows: [
          [runs('23 sept.'), runs('Devancement 400k en T3 pour INFRA360'), runs('DDC Budget')],
          [runs('23 sept.'), runs('Plan 2027'), runs('Validation')],
          [runs('23 sept.'), runs('Mandat MTQ'), runs('Ajout Portée')],
        ],
      },
      x + 12,
      y + 46,
      w - 24,
      h - 58,
    ),
  );
}

// ---------------------------------------------------------------------------
// 4 — Sommaire budget
// ---------------------------------------------------------------------------
{
  const { x, w } = COL[0];
  const { y, h } = R2;
  push(
    panel('muted', x, y, w, h),
    txt('SOMMAIRE BUDGET 2026', x + 16, y + 12, w - 32, 16, {
      size: 10,
      color: COLORS.neutralSecondary,
    }),
    txt('$2,8M', x + 16, y + 34, w - 32, 40, { size: 28, color: COLORS.neutralPrimary }),
    txt('PDI AUTORISÉ', x + 16, y + 78, w - 32, 16, { size: 10, color: COLORS.neutralSecondary }),
  );
  // HACK: aucun bloc `progress`. Deux panels superposés — et la couleur du
  // remplissage n'est pas libre : `accent` = la primaire du thème, point final.
  push(
    panel('semantic', x + 16, y + 100, w - 32, 10, { kind: 'info' }),
    panel('accent', x + 16, y + 100, Math.round((w - 32) * 0.35), 10),
    txt('35 % consommé · Sous contrôle', x + 16, y + 114, w - 32, 12, {
      size: 7,
      color: COLORS.neutralSecondary,
    }),
  );
  // HACK: pas d'alignement à droite (ni sur `para`, ni sur `heading` hors
  // `align:center`) → la valeur est un second heading posé à une abscisse
  // devinée. Un montant plus long déborderait ou flotterait.
  const lines = [
    ['RÉEL', '147'],
    ['REST À FAIRE', '1 517'],
    ['TOTAL PROJETÉ', '400'],
  ];
  let ly = y + 136;
  for (const [label, value] of lines) {
    push(
      txt(label, x + 16, ly + 2, 150, 16, { size: 10, color: COLORS.neutralSecondary }),
      txt(value, x + w - 92, ly, 52, 20, {
        size: 15,
        color: COLORS.neutralPrimary,
        align: 'center',
      }),
      txt('K$', x + w - 36, ly + 5, 24, 14, { size: 7, color: COLORS.neutralSecondary }),
      rule(x + 16, ly + 24, w - 32),
    );
    ly += 32;
  }
  push(
    panel('muted', x + 16, ly, w - 32, 26),
    txt('ÉCARTS', x + 26, ly + 5, 120, 16, { size: 10, color: COLORS.neutralSecondary }),
    txt('↓ - 67', x + w - 92, ly + 3, 52, 20, {
      size: 13,
      color: COLORS.negative,
      align: 'center',
    }),
    txt('K$', x + w - 36, ly + 8, 24, 14, { size: 7, color: COLORS.negative }),
  );
}

// ---------------------------------------------------------------------------
// 5 — Faits saillants en cours (barres de progression)
// ---------------------------------------------------------------------------
{
  const { x, w } = COL[1];
  const { y, h } = R2;
  push(panel('pillar', x, y, w, h, { accent: false }));
  head(x, y, w, 'FAITS SAILLANTS EN COURS', 'activity');
  const items = [
    ['Loisirs en ligne', '15 avril 2026 - COMPLÉTÉ', 'T1', 1.0, 0],
    ['Formulaire Cinéma', 'En analyse', 'T3', 0.75, 2],
    ['App Mobile déneigement', 'En développement', 'T3', 0.4, 1],
    ['Loisirs en ligne', 'MEP 12 juin', 'T2', 0.5, 1],
    ['Cité MTL', 'En analyse', 'T3', 0.25, 2],
  ];
  const barX = x + 210;
  const barW = w - 232;
  let iy = y + 46;
  for (const [name, status, quarter, pct, shade] of items) {
    push(
      rule(x + 14, iy + 2, 3, 30), // HACK: barre d'accent verticale → filet
      txt(name, x + 24, iy, 180, 16, { size: 10, color: COLORS.neutralPrimary }),
      txt(status, x + 24, iy + 16, 180, 12, { size: 7, color: COLORS.neutralSecondary }),
      txt(quarter, barX + barW - 20, iy - 3, 20, 12, { size: 6, color: COLORS.neutralSecondary }),
      panel('semantic', barX, iy + 10, barW, 18, { kind: 'info' }),
      // HACK: trois statuts (complété / en développement / en analyse) → trois
      // couleurs. L'IR n'offre que les nuances `layer`, toutes déclinaisons de
      // la primaire : le codage sémantique devient un dégradé monochrome.
      panel('layer', barX, iy + 10, Math.round(barW * pct), 18, { shade }),
      txt(
        `${Math.round(pct * 100)}%`,
        barX + Math.max(Math.round(barW * pct) - 42, 6),
        iy + 14,
        36,
        12,
        {
          size: 7,
          color: pct > 0.3 ? COLORS.ground : COLORS.neutralPrimary,
          align: 'center',
        },
      ),
    );
    iy += 38;
  }
  // HACK: aucun bloc `legend` en dehors du SVG interne des charts.
  let lx = x + 130;
  for (const [label, shade] of [
    ['Complété', 0],
    ['En développement', 1],
    ['En analyse', 2],
  ]) {
    push(
      panel('layer', lx, y + h - 22, 9, 9, { shade }),
      txt(label, lx + 14, y + h - 25, 110, 14, { size: 7, color: COLORS.neutralSecondary }),
    );
    lx += 26 + label.length * 4.6;
  }
}

// ---------------------------------------------------------------------------
// 6 — Points de suivi
// ---------------------------------------------------------------------------
{
  const { x, w } = COL[2];
  const { y, h } = R2;
  push(panel('pillar', x, y, w, h, { accent: false }));
  head(x, y, w, 'POINTS DE SUIVI', 'list-checks');
  // HACK: rien ne s'ajuste tout seul. Un `para` dépasse simplement de sa
  // région et se superpose au suivant : ces descriptions ont dû être
  // RACCOURCIES à la main jusqu'à ce que le compte de lignes tombe juste.
  const items = [
    [
      'Volet Inspection',
      'Échéance T3',
      'Début de la vigie. Résultats et recommandations attendus pour le CODIR de septembre.',
    ],
    [
      'Consentement Municipal',
      'Échéance T4',
      'Analyse du besoin en cours. Portée à confirmer : volet traitement, volet finance, intégration montreal.ca.',
    ],
    [
      'Intégration CT',
      'Échéance T4',
      'En attente de confirmation pour Côte-des-Neiges et Ville-Marie (permis de cafés-terrasses).',
    ],
    [
      'Demande du Projet 911PG',
      'Échéance T3',
      'Connexion dynamique du système de répartition des Pompiers (RAO) aux données d’Agir. Date à déterminer.',
    ],
  ];
  let py = y + 44;
  for (const [title, due, desc] of items) {
    push(
      txt(title, x + 14, py, 230, 16, { size: 9, color: COLORS.neutralPrimary }),
      // HACK: « à droite » = une abscisse devinée, pas un alignement.
      txt(due, x + w - 90, py, 80, 16, { size: 9, color: COLORS.neutralPrimary }),
      para(desc, x + 14, py + 15, w - 28, 36),
    );
    py += 52;
  }
}

// ---------------------------------------------------------------------------
// 7 — Bandeau « Sujets divers »
// ---------------------------------------------------------------------------
{
  const y = 620;
  const w = COL[1].x + COL[1].w - X0;
  push(
    // HACK: pour un bandeau plein saturé, seul `layer` (nuances de la
    // primaire) convient — `semantic success` ne donne qu'un vert pâle. La
    // couleur du bandeau n'est donc pas choisie : c'est celle du thème.
    panel('layer', X0, y, w, 48, { shade: 0 }),
    txt('SUJETS DIVERS', X0 + 16, y + 8, 300, 16, { size: 10, color: COLORS.ground }),
    para(
      'Nouvelle demande du MTQ à venir. Lié à la DDC complété en 2025.',
      X0 + 16,
      y + 24,
      w - 32,
      20,
      COLORS.ground,
    ),
  );
}

// ---------------------------------------------------------------------------
// La scène : c'est ça, l'IR. Un master, un titre, une liste plate d'éléments
// { block, region }. Aucun renderer n'a plus de décision à prendre.
// ---------------------------------------------------------------------------
const scenes = [
  {
    master: 'content',
    layout: 'content',
    // HACK: le master `content` porte un titre, un filet, un pied et un
    // numéro — mais ni logo ni date en haut à droite (le logo n'existe que
    // sur les masters cover/section).
    title: '74926 - Assistant à la gestion des interventions dans la rue (AGIR+)',
    titleRuns: null,
    notes: [],
    elements: els,
    sourceLine: 1,
  },
];

const meta = { title: 'Tableau de bord AGIR+', footer: '14 juillet 2026' };
const { html } = await renderDeckHtml(scenes, meta, process.cwd(), {});
const out = process.argv[2] ?? 'dashboard-ir.html';
fs.writeFileSync(out, html);
console.log(`écrit : ${out} — ${els.length} éléments, ${(html.length / 1024).toFixed(0)} kB`);
