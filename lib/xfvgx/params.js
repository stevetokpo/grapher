// xFVG+ — réglages : valeurs par défaut d'un côté, description du formulaire de
// l'autre. Même contrat que lib/xfvg/params.js, lib/liq/params.js et les autres :
// ajouter un réglage se fait ICI, pas dans le panneau ni dans le graphe.
//
// CE QUE CE MOTIF EST, ET CE QU'IL N'EST PAS. C'est le xFVG EXTRA, et rien
// d'autre : un xFVG dont la boîte contient le dernier swing d'en face — swing
// HAUT pour un motif haussier, swing BAS pour un baissier. L'impulsion est allée
// casser cette structure, et le déséquilibre qu'elle laisse retombe pile dessus :
// le prix qu'on attend est le même des deux points de vue, bord de zone et ancien
// sommet (ou creux). C'est ce prix — le TRAIT BLANC tracé dans la boîte — qui
// fait tout l'intérêt du motif, et c'est lui qui sert d'entrée.
//
// LA DÉTECTION N'EST PAS RÉÉCRITE. C'est calcXFVG (lib/xfvg/detect.js) avec
// `swing` forcé sur 'extra' — un seul détecteur, deux patterns. Les réglages de
// figure sont donc les MÊMES clés que le xFVG (mode, direction, tailles, gap…) et
// le formulaire réutilise ses blocs : un motif réglé pareil des deux côtés doit
// donner exactement la même boîte, sinon « extra » ne voudrait plus dire la même
// chose d'un panneau à l'autre.
//
// CE QUE CE PATTERN AJOUTE, et qui n'existait nulle part pour le xFVG : la prise
// de position, sa gestion et son rapport.
//   • ENTRÉE — un ORDRE EN ATTENTE sur le trait, plus ou moins une marge en
//     POINTS. On n'achète pas le motif : on attend que le prix REVIENNE sur la
//     structure cassée.
//   • SL et TP — deux DISTANCES FIXES en points depuis l'entrée, indépendantes
//     l'une de l'autre. Le risque est donc constant d'une position à l'autre, et
//     le seuil de rentabilité redevient le 1/(1+RR) des manuels.
// Le reste (break-even, spread, trade unique, repos après gain, le dû) est celui
// de toute la famille — lib/patternPositions.js, le même code que liq, rev, Twins
// Bars, RSIER et TRENDER : deux motifs mesurés par le même simulateur, sinon un
// écart de résultat ne dit plus si la détection ou la sortie en est responsable.

import {
  DETECT_DEFAULTS as XFVG_DETECT_DEFAULTS,
  FIGURE_FIELDS, SWING_CONFIRM_FIELDS,
} from '../xfvg/params';

// ── Détection ────────────────────────────────────────────────────────────────
// Celles du xFVG, à un réglage près : `swing` est sur 'extra' et n'a pas de
// champ. Ce n'est pas un défaut qu'on pourrait changer — c'est la DÉFINITION du
// motif, et ./detect.js le réimpose de toute façon.
export const DETECT_DEFAULTS = {
  ...XFVG_DETECT_DEFAULTS,
  swing: 'extra',
};

// ── Prise de position ────────────────────────────────────────────────────────
// Ce que lit lib/patternPositions.js, via ./positions.js. Ces réglages ne peuvent
// ni créer ni supprimer un motif : seulement décider ce qu'on en fait.
//
// TROIS MODES SONT FIGÉS ici et réimposés par ./positions.js — ce sont les règles
// du motif, pas des préférences :
//   entryMode 'zone'   — l'ordre attend sur le trait. Le motif désigne un PRIX ;
//                        entrer au marché à la clôture de la figure jetterait
//                        justement ce qui fait le motif.
//   slMode    'points' — le motif n'a pas de stop structurel qui lui soit propre :
//                        la boîte est déjà l'objet qu'on joue, s'en servir de stop
//                        collerait celui-ci au hasard de la taille de l'impulsion.
//   tpMode    'points' — objectif fixe, indépendant du stop.
export const POSITION_DEFAULTS = {
  // 'zone' = les boîtes seules | 'position' = les trades | 'both'.
  // Défaut sur 'both' : un défaut qui cacherait les positions rendrait invisibles
  // le moniteur ET le bouton de rapport, sans rien dire.
  display: 'both',

  // LA MARGE SUR LE TRAIT, en points de prix et SIGNÉE — même convention que
  // partout ici (minPts, liqMaxSepAtr…). Elle déplace l'ordre PAR RAPPORT AU
  // SENS D'OÙ LE PRIX REVIENT, pas vers le haut ou vers le bas :
  //   > 0 — l'ordre est posé EN DEÇÀ du trait, du côté d'où le prix arrive :
  //         au-DESSUS pour un motif haussier, en DESSOUS pour un baissier. On est
  //         servi plus tôt et plus souvent, à un prix moins bon.
  //   0   — sur le trait, pile.
  //   < 0 — AU-DELÀ : le prix doit dépasser le trait pour nous servir. Moins de
  //         remplissages, meilleur prix quand il y en a.
  // À régler par instrument : 2 points ne veulent pas dire la même chose sur
  // XAUUSD et sur BTCUSD.
  entryMarginPts: 0,
  // Combien de bougies l'ordre a pour être servi, à partir de celle qui suit la
  // figure. 0 = sans limite (jusqu'au bord des données). Passé ce délai l'ordre
  // est annulé et le signal est compté 'missed' : listé, sans prix ni résultat,
  // hors statistiques.
  entryWaitBars: 20,

  slPts:     10,   // SL : distance fixe depuis l'entrée — c'est le R
  tpPts:     10,   // TP : distance fixe depuis l'entrée, indépendante du SL
  spreadPts: 0,    // coût de l'aller-retour, déduit de chaque position clôturée

  // Break-even, en R. Le risque étant constant ici (SL en points), un R vaut
  // exactement slPts — les deux façons de compter se rejoignent, contrairement
  // aux motifs à stop structurel.
  beTriggerR: 0,   // SEUIL : le stop bouge quand le gain atteint x × risque. 0 = pas de BE
  beLevelR:   0,   // BLOCAGE : où va le stop, en R depuis l'entrée. 0 = à l'entrée

  uniqueTrade: false, // une seule position à la fois
  skipAfterTp: 0,     // repos : combien de signaux sauter après un gain
  // LE DÛ (lib/dueLedger.js) — 0 = éteint. Au-delà de ce nombre de pertes non
  // remboursées, la position suivante vise le remboursement au lieu de son vrai TP.
  dueAfterSl:  0,
  dueMode:     'full',
};

// ── Habillage ────────────────────────────────────────────────────────────────
// Une BOÎTE, comme le xFVG — et le trait blanc du swing dedans, que la primitive
// dessine dès qu'une zone porte swingPrice/swingTime. Ce trait ne se règle pas :
// c'est un prix à attendre, pas un bord de zone, et il doit se détacher quelle
// que soit la couleur du motif.
export const STYLE_DEFAULTS = {
  bullColor: '#26A69A',
  bearColor: '#EF5350',
  opacity:   0.18,
  showLabel: true,
};

export const XFVGX_DEFAULTS = { ...DETECT_DEFAULTS, ...POSITION_DEFAULTS, ...STYLE_DEFAULTS };

const pick = (pat, defaults) => {
  const out = {};
  for (const k of Object.keys(defaults)) out[k] = pat[k] ?? defaults[k];
  return out;
};

// Les seules options de DÉTECTION, extraites d'un objet de réglages du panneau —
// qui trimballe aussi le type, les couleurs, `enabled`… Passer l'objet entier au
// détecteur marcherait, mais on perdrait la garantie qu'un changement de style ne
// peut pas déplacer une zone.
export const detectOptions = (pat = {}) => ({ ...pick(pat, DETECT_DEFAULTS), swing: 'extra' });

// Détection + position : le simulateur redétecte les motifs avant de les jouer,
// il lui faut les deux.
//
// Les quatre modes figés sont écrits ICI, et pas seulement réimposés dans
// ./positions.js : c'est cet objet qui part dans le bloc `params` du rapport, et
// un rapport qui ne dit pas comment on entre ni d'où vient le stop ne se relit
// pas. lib/patternReport.js s'en sert d'ailleurs pour savoir que le TP est en
// POINTS et qu'aucun RR n'a été visé. Ils ne sont pas dans POSITION_DEFAULTS
// exprès : ce ne sont pas des réglages, et `pick` y laisserait une valeur
// enregistrée les écraser.
export const positionOptions = (pat = {}) => ({
  ...pick(pat, DETECT_DEFAULTS),
  ...pick(pat, POSITION_DEFAULTS),
  swing:     'extra',
  entryMode: 'zone',
  slMode:    'points',
  tpMode:    'points',
});

export function styleOptions(pat = {}) {
  return {
    bullColor: pat.bullColor ?? STYLE_DEFAULTS.bullColor,
    bearColor: pat.bearColor ?? STYLE_DEFAULTS.bearColor,
    opacity:   pat.opacity   ?? STYLE_DEFAULTS.opacity,
    showLabel: pat.showLabel !== false,
    labelText: 'xFVG+',
  };
}

// ── Formulaire ───────────────────────────────────────────────────────────────
// Rendu par <SchemaForm> (components/PatternPanel.js).
// Types : 'segmented' | 'number' | 'toggle' | 'color' | 'row' | 'divider' | 'hint'.
//
// La FIGURE et la définition du SWING viennent de lib/xfvg/params.js, telles
// quelles : c'est le même motif, réglé aux mêmes clés. Seul ce qui suit est
// propre à ce pattern-ci.
const enPos = v => (v.display ?? 'both') !== 'zone';

export const FIELDS = [
  { kind: 'hint', text:
    "Le xFVG EXTRA, et lui seul : un xFVG dont la boîte contient le dernier swing d'EN FACE — swing "
    + "HAUT pour un motif haussier, swing BAS pour un baissier. L'impulsion est allée casser cette "
    + "structure, et le déséquilibre qu'elle laisse retombe pile dessus. Le trait BLANC dans la "
    + "boîte est ce prix-là : à la fois l'ancien sommet (ou creux) et le bord du déséquilibre. "
    + "C'est sur lui que l'ordre attend." },
  { kind: 'hint', text:
    "La figure se règle exactement comme dans le pattern « xFVG » — c'est le même détecteur. Pour "
    + "ne pas dessiner deux fois la même boîte, mets ce pattern-là sur « Sans les extras »." },

  ...FIGURE_FIELDS,

  { kind: 'divider', label: 'Le swing — ce qui fait un extra' },

  ...SWING_CONFIRM_FIELDS,

  { kind: 'divider', label: 'Prise de position' },

  { kind: 'segmented', key: 'display', label: 'Représentation', options: [
    { value: 'zone',     label: 'Zone' },
    { value: 'position', label: 'Position' },
    { value: 'both',     label: 'Les deux' },
  ] },
  { kind: 'hint', when: v => (v.display ?? 'both') === 'zone', text:
    "⚠ En « Zone », aucune position n'est simulée : ni le moniteur en haut à gauche du graphe, ni "
    + "le bouton de téléchargement du rapport n'apparaissent. Passe sur « Position » ou « Les deux » "
    + "pour les retrouver." },

  { kind: 'hint', when: enPos, text:
    "ORDRE EN ATTENTE SUR LE TRAIT. Le motif est connu à la clôture de sa dernière bougie ; l'ordre "
    + "est posé là et attend que le prix REVIENNE sur le swing — achat sur motif haussier, vente sur "
    + "baissier. On est rempli au niveau, ou à l'ouverture de la bougie si elle a ouvert au-delà "
    + "(un ordre réel aurait été servi mieux). S'il n'est jamais servi, le signal est compté "
    + "« Raté » : il reste dans le rapport, hors statistiques — les cacher donnerait un taux de "
    + "réussite calculé sur les seuls trades que le marché a bien voulu servir." },

  { kind: 'row', when: enPos, fields: [
    { kind: 'number', key: 'entryMarginPts', label: 'Marge sur le trait (points, signée)',
      min: -100000, max: 100000, step: 0.1 },
    { kind: 'number', key: 'entryWaitBars', label: 'Attente max (barres, 0 = sans limite)',
      min: 0, max: 500, step: 1 },
  ] },
  { kind: 'hint', when: enPos, text:
    "La marge est SIGNÉE et se compte par rapport au côté d'où le prix REVIENT, pas vers le haut ou "
    + "vers le bas. POSITIVE = l'ordre est posé EN DEÇÀ du trait (au-dessus pour un motif haussier, "
    + "en dessous pour un baissier) : on est servi plus tôt et plus souvent, à un prix moins bon. "
    + "0 = pile sur le trait. NÉGATIVE = AU-DELÀ, le prix doit dépasser le trait pour nous servir : "
    + "moins de remplissages, meilleur prix quand il y en a. En points de prix, donc à régler par "
    + "instrument." },
  { kind: 'hint', when: enPos, text:
    "L'attente se compte à partir de la bougie qui suit la figure. Elle est INDÉPENDANTE de "
    + "l'extension de la boîte (« Extension », plus haut), qui ne fait que dessiner : une boîte "
    + "tirée sur 20 barres n'annule aucun ordre." },

  { kind: 'divider', when: enPos, label: 'Stop et objectif' },

  { kind: 'row', when: enPos, fields: [
    { kind: 'number', key: 'slPts', label: 'SL (points)', min: 0.1, max: 100000, step: 0.1 },
    { kind: 'number', key: 'tpPts', label: 'TP (points)', min: 0.1, max: 100000, step: 0.1 },
  ] },
  { kind: 'hint', when: enPos, text:
    "Deux DISTANCES FIXES depuis l'entrée, indépendantes l'une de l'autre : le stop ne s'appuie sur "
    + "aucune structure du motif, l'objectif ne dépend pas du stop. Le risque est donc CONSTANT "
    + "d'une position à l'autre — points et R disent alors la même chose, et le seuil de rentabilité "
    + "redevient le 1/(1+RR) des manuels : 33 % pour un TP double du SL. Le stop est connu avant "
    + "l'entrée, donc posé avec l'ordre et actif dès la bougie de remplissage." },

  { kind: 'number', key: 'spreadPts', label: 'Spread (points)', min: 0, max: 10000, step: 0.1,
    when: enPos },
  { kind: 'hint', when: enPos, text:
    "Coût de l'aller-retour, déduit de chaque position CLÔTURÉE : profitPoints reste le brut (celui "
    + "qu'on relit sur le graphe), netPoints le réel, et c'est le net qui alimente les statistiques." },

  { kind: 'row', when: enPos, fields: [
    { kind: 'number', key: 'beTriggerR', label: 'BE — seuil (R, 0 = off)', min: 0,    max: 20, step: 0.1 },
    { kind: 'number', key: 'beLevelR',   label: 'BE — blocage (R)',        min: -0.9, max: 20, step: 0.1 },
  ] },
  { kind: 'hint', when: v => enPos(v) && v.beTriggerR > 0, text:
    "Dès qu'une bougie avance de SEUIL × risque dans le sens de la position, le stop se déplace à "
    + "entrée ± BLOCAGE × risque, et n'y bouge plus jamais : c'est un déplacement unique, pas un "
    + "stop suiveur. Blocage à 0 = stop à l'entrée (le vrai break-even) ; 0,5 = un demi-R sécurisé ; "
    + "négatif = on réduit la perte sans l'annuler. Le stop déplacé ne peut jamais ÉLARGIR le risque. "
    + "Anti-anticipation : il ne prend effet qu'à la CLÔTURE de la bougie qui l'a armé. Sortie sur ce "
    + "stop = statut « be ». Le risque étant constant ici, 1 R vaut exactement le SL en points." },
  { kind: 'hint', when: v => enPos(v) && v.beTriggerR > 0 && v.tpPts > 0 && v.slPts > 0
      && v.beTriggerR >= v.tpPts / v.slPts, text:
    "⚠ Le seuil est au-dessus du RR du TP (TP ÷ SL) : le TP sera toujours touché avant, et le BE ne "
    + "s'armera jamais. Descends le seuil sous ce rapport pour qu'il serve." },

  { kind: 'number', key: 'dueAfterSl', label: 'Dû — seuil (pertes non remboursées, 0 = off)',
    min: 0, max: 100, step: 1, when: enPos },
  { kind: 'hint', when: v => enPos(v) && v.dueAfterSl > 0, text:
    "REMBOURSER AVANT DE GAGNER. Chaque position clôturée dans le rouge laisse sa perte sur une "
    + "ardoise ; chaque gain la rembourse en commençant par la plus ANCIENNE. Dès que l'ardoise "
    + "compte ce nombre de pertes, la position suivante vise le remboursement au lieu de son vrai "
    + "TP — même si c'est plus PRÈS que son objectif normal. Le break-even, lui, ne bouge pas : le "
    + "dû déplace la cible, pas la protection. Même règle et même file que le rFVG et les autres "
    + "motifs de la famille." },
  { kind: 'segmented', key: 'dueMode', label: 'Remboursement',
    when: v => enPos(v) && v.dueAfterSl > 0, options: [
      { value: 'full', label: "Tout d'un coup" },
      { value: 'step', label: 'Par bonds' },
    ] },
  { kind: 'hint', when: v => enPos(v) && v.dueAfterSl > 0 && v.dueMode === 'step', text:
    "Par BONDS de « seuil × perte moyenne encore due » — la taille exacte de ce qui a armé le dû. "
    + "L'objectif garde la même taille au lieu de fuir avec l'ardoise, quitte à rembourser en "
    + "plusieurs fois." },
  { kind: 'hint', when: v => enPos(v) && v.dueAfterSl > 0 && v.dueMode !== 'step', text:
    "Tout d'un coup : l'objectif vaut l'ardoise ENTIÈRE. Plus elle grossit, plus il s'éloigne — au "
    + "bout d'une longue série il peut devenir hors d'atteinte, et un objectif qu'on n'atteint pas "
    + "ne rembourse rien. « Par bonds » existe pour ça." },

  { kind: 'number', key: 'skipAfterTp', label: 'Signaux ignorés après un TP (0 = aucun)',
    min: 0, max: 100, step: 1, when: enPos },
  { kind: 'hint', when: v => enPos(v) && v.skipAfterTp > 0, text:
    "Après un TP touché, les N signaux suivants sont ignorés, puis on reprend — exactement N. Ils ne "
    + "sont listés nulle part, mais le moniteur et le rapport disent combien ont été sautés ET "
    + "combien auraient gagné : c'est ce second chiffre qui dit ce que le repos a coûté." },

  { kind: 'toggle', key: 'uniqueTrade', label: 'Trade unique', when: enPos },
  { kind: 'hint', when: v => enPos(v) && v.uniqueTrade === true, text:
    "Une seule position à la fois : tout motif survenant avant la clôture de la position en cours "
    + "est ignoré, dans son sens comme à contre-sens, et n'apparaît nulle part. Un ordre en attente "
    + "ne bloque rien — c'est le REMPLISSAGE qui compte. ⚠ Ce n'est pas un filtre neutre : il écarte "
    + "des signaux selon ce que le marché a fait ENTRE-TEMPS. Compare toujours les deux modes avant "
    + "d'y croire." },

  { kind: 'divider', label: 'Affichage' },

  { kind: 'color',  key: 'bullColor', label: 'Couleur haussière', tint: '#26A69A' },
  { kind: 'color',  key: 'bearColor', label: 'Couleur baissière', tint: '#EF5350' },
  { kind: 'number', key: 'opacity',   label: 'Opacité', min: 0.02, max: 1, step: 0.02 },
  { kind: 'toggle', key: 'showLabel', label: 'Étiquette « xFVG+ »' },
  { kind: 'hint', text:
    "Le trait du swing est toujours tracé, en BLANC : c'est le prix à attendre, pas un bord de "
    + "boîte, et il garde donc sa couleur à lui quelle que soit celle du motif. Avec une marge non "
    + "nulle, l'entrée réelle n'est pas dessus — c'est la ligne d'entrée de la position qui la "
    + "montre, en représentation « Position »." },
];
