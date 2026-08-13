# Kit Desjardins

Kit de marque Lutrin dérivé de <https://www.desjardins.com> le **13 août 2026**
par le skill `kit-from-site`.

> **Marque déposée.** Le logo et l'identité Desjardins appartiennent au
> Mouvement Desjardins. Ce kit est destiné aux présentations produites **pour
> Desjardins** (ou en son nom) ; il ne doit pas être publié ni redistribué avec
> Lutrin.

## Provenance des jetons

Le site expose son design system (« DSD ») en propriétés CSS custom
(`--dsd-*`) dans les bundles `clientlib-base` / `clientlib-dsd` 4.1.0 — tout ce
qui suit est **lu dans le CSS**, pas échantillonné sur des pixels. Chaque
jeton existe en paire thème clair / thème sombre ; le kit retient les valeurs
du thème clair.

**Lu directement :**

- Couleur d'action (`--dsd-color-background-brand`, boutons, icônes) :
  `#00874E` → `colors.primary`, `brand`, `accent.bar`, `surface.sectionBg`.
- Rampe verte publiée : `#00AC62` (brand du thème sombre) → `primaryLighter` ;
  `#006B3D` (decorative-brand-200) → `primaryDarker` ; `#053E26` / `#055B37`
  (brand-500/600) → encres et couches sombres.
- Teintes pâles : `#ECF5F0` / `#CCE7D7` (decorative-brand-100/200) →
  `highlightLight` / `highlightStrong`.
- Encres : `#2F2F2F` (`font-default`), `#6C6C6C` (`font-secondary`),
  `#B3B5B7`, `#C7C9CC` (graphite) → neutres.
- Sémantique : info `#025ABA` / `#DBEAF6` / `#1C3A52` (liens, information) ;
  succès `#D9F0E3` / `#053E26` (confirmation) ; erreur `#CA241A` / `#960E02` /
  `#FDD8D8` ; avertissement encre `#443507`.
- Rayons : échelle DSD 4 / 8 / 16 px (radius-150/200/300 ; 8 px est le plus
  employé) → `rounded.sm/md/lg`.
- Logo : `/content/dam/images/logos/commun/logo-desjardins-fr.svg` — lockup
  monochrome **blanc** (le header du site est vert) → utilisé tel quel en
  `logo-section` (sur fond vert de marque).

**Inféré :**

- `logo-cover.svg` : recoloration du lockup monochrome en `#00874E` pour fond
  blanc (traitement standard vert-sur-blanc de la marque). Les PNG sont des
  rendus resvg à 1200 px de large.
- `chartColors` : six couleurs tirées du CSS du site (vert `00874E`, bleu
  `025ABA`, rouge `CA241A`, ambre `6E5405`, violet `663E7B` — lien visité —,
  sarcelle `00727E`), toutes ≥ 3:1 sur blanc ; le site ne publie pas de
  palette de visualisation de données.
- `warningLight` : `FFF3CA`, tinte adoucie du jaune d'avertissement du site
  (`#FFE387`, trop saturé pour un fond d'encart).

**Police.** Le site emploie « Desjardins Sans », webfont propriétaire
(`static.desjardins.com/fw/dsd/assets/fonts/…`) dont la licence ne permet pas
la redistribution — le kit n'embarque donc **aucun fichier de police** et
nomme **Arial**, la famille largement installée la plus proche. Sur un poste
où Desjardins Sans est installée, remplacer `fonts.body` par
`"Desjardins Sans"`.

## Contrastes (WCAG)

Vérifiés au moment de la dérivation : `00874E` sur blanc = 4,59:1 (texte et
graphiques OK) ; blanc sur `00874E` = 4,59:1 (intercalaires OK) ; les six
`chartColors` vont de 4,59:1 à 8,27:1 sur blanc. Aucun ajustement n'a été
nécessaire — toutes les valeurs sont celles du site.

## Regénérer

Après une refonte du site, re-dériver avec le skill `kit-from-site`
(`.claude/skills/kit-from-site/`) et comparer au présent README.

## Utiliser

```yaml
---
title: Ma présentation
kit: ./kits/desjardins   # chemin relatif au deck, ou installer :
---
```

```bash
npx lutrin kit create kits/desjardins    # → desjardins.deckkit
npx lutrin kit install desjardins.deckkit
```
