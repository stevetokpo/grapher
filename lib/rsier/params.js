// RSIER — réglages : valeurs par défaut d'un côté, description du formulaire de
// l'autre. Même contrat que lib/superAval/params.js et lib/xfvg/params.js, et
// pour la même raison : ajouter un réglage se fait ICI, pas dans le panneau ni
// dans le graphe.
//
// AJOUTER UNE CONDITION, c'est trois lignes :
//   1. le test           → ./detect.js
//   2. sa valeur neutre  → DETECT_DEFAULTS ici (neutre = condition éteinte)
//   3. son champ         → FIELDS ici

import { HTF_SECONDS, htfLabel } from '../htf';

export const HTF_KEYS = Object.keys(HTF_SECONDS);

// ── Détection ────────────────────────────────────────────────────────────────
export const DETECT_DEFAULTS = {
  // L'unité de temps SUPÉRIEURE dont on lit le RSI. C'est le réglage central :
  // le motif n'existe que dans le rapport entre ce HTF et le TF du graphe.
  htf: 'H4',

  // Période du RSI, calculé sur les CLÔTURES des bougies HTF.
  rsiPeriod: 14,

  // Les deux seuils de surzone. Le RSI est en surachat au-dessus de `obLevel`,
  // en survente en dessous de `osLevel` — bornes COMPRISES.
  obLevel: 70,
  osLevel: 30,

  // Quelles surzones marquer : 'bull' = survente seule (contexte d'achat),
  // 'bear' = surachat seul, 'both' = les deux.
  direction: 'both',
};

// ── Prise de position ────────────────────────────────────────────────────────
// Ce que lit lib/patternPositions.js, via ./positions.js — le MÊME simulateur et
// la même gestion que Twins Bars, liq et rev. C'est voulu : quatre motifs mesurés
// par le même code, sinon un écart de résultat ne dit plus si la détection ou la
// sortie en est responsable.
//
// ENTRÉE AU MARCHÉ, ET RIEN D'AUTRE, à l'OUVERTURE de la bougie qui ouvre la
// zone. Le RSI HTF y est déjà connu — sa bougie s'est clôturée avant que celle-ci
// ne s'ouvre —, donc c'est le premier prix disponible une fois la surzone
// constatée, et il n'y a aucune anticipation à entrer là. Il n'existe pas de mode
// « retour dans la zone » : la bande est faite de TEMPS, pas de prix ; il n'y a
// aucun bord où poser un ordre en attente. Conséquence — aucun signal 'missed',
// une position par entrée en surzone.
export const POSITION_DEFAULTS = {
  // 'zone' = la bande seule | 'position' = les trades seuls | 'both'.
  // Défaut sur 'both' : le motif était un contexte, il gagne des positions — un
  // défaut qui les cacherait rendrait invisibles le moniteur ET le bouton de
  // rapport, sans rien dire.
  display:   'both',
  entryMode: 'market',

  // DE QUEL CÔTÉ ON JOUE LA SURZONE. Les deux lectures existent et rien ne
  // tranche a priori — d'où un réglage plutôt qu'un choix caché :
  //   'reversion'    — on achète la survente et on vend le surachat. Le pari est
  //                    que l'excès se corrige.
  //   'continuation' — l'inverse, exactement : on vend la survente et on achète
  //                    le surachat. Le pari est qu'un RSI en surzone signe une
  //                    tendance qui continue.
  // Le SENS DE LA ZONE, lui, ne bouge pas : une bande verte reste une survente,
  // quelle que soit la position qu'on y prend.
  tradeSide: 'reversion',

  // OÙ VA LE TP, et s'il dépend du stop — mêmes deux modes que Twins Bars.
  tpMode: 'rr',
  rr:     2,
  tpPts:  10,

  // D'où vient le stop. Le motif n'a AUCUNE structure à lui : il ne désigne pas
  // de bougie remarquable, seulement un instant. Le mode 'structure' s'appuie
  // donc sur les `slLookback` bougies qui PRÉCÈDENT l'entrée — le dernier
  // extrême que le marché a laissé avant qu'on entre —, et le mode 'points' sur
  // une distance fixe, qui est le seul stop vraiment natif du motif.
  slMode:      'structure',
  slLookback:  5,
  slMarginPts: 0,
  slPts:       10,

  spreadPts:   0,
  beTriggerR:  0,
  beLevelR:    0,
  uniqueTrade: false,
  skipAfterTp: 0,
  dueAfterSl:  0,
  dueMode:     'full',
};

// ── Habillage ────────────────────────────────────────────────────────────────
export const STYLE_DEFAULTS = {
  bullColor: '#26A69A',   // survente  — contexte d'achat
  bearColor: '#EF5350',   // surachat  — contexte de vente
  bgTransp:  85,          // convention Pine : 0 = opaque, 100 = invisible
  showBg:    true,
  showMark:  true,        // triangle sur la bougie qui ouvre la zone
  showLabel: true,        // texte du repère : « 4h · 24 »
};

export const RSIER_DEFAULTS = { ...DETECT_DEFAULTS, ...POSITION_DEFAULTS, ...STYLE_DEFAULTS };

const pick = (pat, defaults) => {
  const out = {};
  for (const k of Object.keys(defaults)) out[k] = pat[k] ?? defaults[k];
  return out;
};

export const detectOptions = (pat = {}) => pick(pat, DETECT_DEFAULTS);

// Détection + position : le simulateur a besoin des deux, puisqu'il redétecte
// les zones avant de les jouer.
export const positionOptions = (pat = {}) => ({
  ...pick(pat, DETECT_DEFAULTS),
  ...pick(pat, POSITION_DEFAULTS),
  // Non négociable, même si un réglage enregistré disait autre chose : la bande
  // est faite de temps, il n'y a nulle part où poser un ordre en attente.
  entryMode: 'market',
});

export function styleOptions(pat = {}) {
  return {
    bullColor: pat.bullColor ?? STYLE_DEFAULTS.bullColor,
    bearColor: pat.bearColor ?? STYLE_DEFAULTS.bearColor,
    bgTransp:  pat.bgTransp  ?? STYLE_DEFAULTS.bgTransp,
    showBg:    pat.showBg    !== false,
    showMark:  pat.showMark  !== false,
    showLabel: pat.showLabel !== false,
  };
}

// ── Formulaire ───────────────────────────────────────────────────────────────
export const FIELDS = [
  { kind: 'hint', text:
    "Le RSI d'une unité de temps SUPÉRIEURE, lu depuis le graphe. À chaque clôture "
    + "de bougie du graphe, on regarde le RSI de la dernière bougie HTF CLÔTURÉE : "
    + "s'il est en surzone, la zone s'ouvre et court tant qu'il y reste. La valeur "
    + "portée par une bougie ne changera plus jamais — pas de repaint." },

  { kind: 'select', key: 'htf', label: 'Unité de temps supérieure',
    options: HTF_KEYS.map(k => ({ value: k, label: `${k}  ·  ${htfLabel(k)}` })) },

  { kind: 'number', key: 'rsiPeriod', label: 'RSI — période', min: 2, max: 500, step: 1 },
  { kind: 'hint', text:
    "Le RSI est calculé sur les CLÔTURES des bougies HTF, en lissage de Wilder — le "
    + "même que l'indicateur RSI du graphe. Il lui faut période + 2 bougies HTF "
    + "d'historique avant de dire quoi que ce soit ; en dessous, aucune zone n'est "
    + "marquée et le graphe le signale." },

  { kind: 'row', fields: [
    { kind: 'number', key: 'osLevel', label: 'Seuil de survente',  min: 0, max: 100, step: 1 },
    { kind: 'number', key: 'obLevel', label: 'Seuil de surachat',  min: 0, max: 100, step: 1 },
  ] },
  { kind: 'hint', text:
    "Bornes comprises : à 30, un RSI qui vaut exactement 30 est en survente. Les deux "
    + "seuils sont libres l'un de l'autre — 50/50 marque le graphe en permanence, "
    + "d'un côté ou de l'autre." },

  { kind: 'segmented', key: 'direction', label: 'Surzones marquées', options: [
    { value: 'bull', label: '↑ Survente' },
    { value: 'both', label: '↕ Les deux' },
    { value: 'bear', label: '↓ Surachat' },
  ] },

  { kind: 'divider', label: 'Prise de position' },

  { kind: 'segmented', key: 'display', label: 'Représentation', options: [
    { value: 'zone',     label: 'Zone' },
    { value: 'position', label: 'Position' },
    { value: 'both',     label: 'Les deux' },
  ] },
  { kind: 'hint', when: v => v.display === 'zone', text:
    "⚠ En « Zone », aucune position n'est simulée : ni le moniteur en haut à gauche du graphe, "
    + "ni le bouton de téléchargement du rapport n'apparaissent. Passe sur « Position » ou "
    + "« Les deux » pour les retrouver." },
  { kind: 'hint', when: v => v.display !== 'zone', text:
    "Une position par ENTRÉE en surzone — pas une par bougie de la zone. Entrée AU MARCHÉ à "
    + "l'ouverture de la bougie qui ouvre la bande : la bougie HTF s'est clôturée avant, son RSI "
    + "est donc déjà connu à cet instant et rien n'est anticipé. Il n'y a pas de mode « retour "
    + "dans la zone » : la bande est faite de temps, pas de prix — aucun bord où attendre. Une "
    + "position est donc toujours prise, aucun signal n'est raté." },

  { kind: 'segmented', key: 'tradeSide', label: 'Sens joué', when: v => v.display !== 'zone', options: [
    { value: 'reversion',    label: "Contre l'excès" },
    { value: 'continuation', label: "Avec l'excès" },
  ] },
  { kind: 'hint', when: v => v.display !== 'zone' && v.tradeSide !== 'continuation', text:
    "CONTRE L'EXCÈS : on achète la survente, on vend le surachat. Le pari est que l'excès se "
    + "corrige." },
  { kind: 'hint', when: v => v.display !== 'zone' && v.tradeSide === 'continuation', text:
    "AVEC L'EXCÈS, exactement l'inverse : on VEND la survente et on ACHÈTE le surachat — un RSI "
    + "en surzone est alors lu comme une tendance qui continue. La couleur des bandes ne change "
    + "pas : le vert reste la survente, il n'indique plus le sens de la position." },

  { kind: 'segmented', key: 'slMode', label: 'Origine du stop', when: v => v.display !== 'zone', options: [
    { value: 'structure', label: 'Extrême précédent' },
    { value: 'points',    label: 'Distance fixe' },
  ] },
  { kind: 'number', key: 'slLookback', label: 'Bougies regardées avant l’entrée', min: 1, max: 500, step: 1,
    when: v => v.display !== 'zone' && v.slMode !== 'points' },
  { kind: 'number', key: 'slMarginPts', label: 'Marge du SL (points)', min: 0, max: 10000, step: 0.1,
    when: v => v.display !== 'zone' && v.slMode !== 'points' },
  { kind: 'hint', when: v => v.display !== 'zone' && v.slMode !== 'points', text:
    "Le motif n'a AUCUNE structure à lui : il ne désigne pas une bougie remarquable, seulement un "
    + "instant. Le stop s'appuie donc sur les N bougies qui PRÉCÈDENT l'entrée — sous leur plus bas "
    + "à l'achat, au-dessus de leur plus haut à la vente, plus la marge. Le risque varie donc d'une "
    + "position à l'autre, ce qui oblige à lire les gains en POINTS plutôt qu'en R. Une zone qui "
    + "s'ouvre avant d'avoir N bougies d'histoire est écartée : on ne devine pas ce qu'il y avait "
    + "avant." },
  { kind: 'number', key: 'slPts', label: 'Distance du SL (points)', min: 0.1, max: 100000, step: 0.1,
    when: v => v.display !== 'zone' && v.slMode === 'points' },
  { kind: 'hint', when: v => v.display !== 'zone' && v.slMode === 'points', text:
    "Le stop est à distance fixe de l'entrée : le risque devient CONSTANT. C'est le seul stop "
    + "vraiment natif du motif, qui ne désigne aucun prix par lui-même." },

  { kind: 'segmented', key: 'tpMode', label: 'Objectif du TP', when: v => v.display !== 'zone', options: [
    { value: 'rr',     label: 'RR du stop' },
    { value: 'points', label: 'Distance fixe' },
  ] },
  { kind: 'number', key: 'rr', label: 'RR du TP', min: 0.1, max: 50, step: 0.1,
    when: v => v.display !== 'zone' && (v.tpMode ?? 'rr') === 'rr' },
  { kind: 'number', key: 'tpPts', label: 'Distance du TP (points)', min: 0.1, max: 100000, step: 0.1,
    when: v => v.display !== 'zone' && v.tpMode === 'points' },
  { kind: 'hint', when: v => v.display !== 'zone' && (v.tpMode ?? 'rr') === 'rr', text:
    "TP = entrée ± RR × |entrée − stop| : l'objectif est ATTACHÉ au stop. Le RR est constant, le TP "
    + "en points ne l'est pas — sauf si le stop est lui aussi en distance fixe, auquel cas les deux "
    + "le deviennent et le seuil de rentabilité redevient le 1/(1+RR) des manuels." },
  { kind: 'hint', when: v => v.display !== 'zone' && v.tpMode === 'points', text:
    "TP à distance FIXE de l'entrée, indépendamment du stop. Avec un stop sur l'extrême précédent, "
    + "c'est le RR qui varie d'une position à l'autre et devient un résultat plutôt qu'un réglage ; "
    + "le rapport le dit position par position, et le moniteur donne le seuil de rentabilité "
    + "RÉALISÉ." },

  { kind: 'number', key: 'spreadPts', label: 'Spread (points)', min: 0, max: 10000, step: 0.1,
    when: v => v.display !== 'zone' },
  { kind: 'hint', when: v => v.display !== 'zone', text:
    "Le spread est le coût de l'aller-retour, déduit de chaque position clôturée : profitPoints "
    + "reste le brut, netPoints le réel." },

  { kind: 'row', when: v => v.display !== 'zone', fields: [
    { kind: 'number', key: 'beTriggerR', label: 'BE — seuil (R, 0 = off)', min: 0,    max: 20, step: 0.1 },
    { kind: 'number', key: 'beLevelR',   label: 'BE — blocage (R)',        min: -0.9, max: 20, step: 0.1 },
  ] },
  { kind: 'hint', when: v => v.display !== 'zone' && v.beTriggerR > 0, text:
    "Dès qu'une bougie avance de SEUIL × risque dans le sens de la position, le stop se déplace à "
    + "entrée ± BLOCAGE × risque, et n'y bouge plus jamais : c'est un déplacement unique, pas un "
    + "stop suiveur. Blocage à 0 = stop à l'entrée (le vrai break-even) ; négatif = on réduit la "
    + "perte sans l'annuler. Le stop déplacé ne peut jamais ÉLARGIR le risque, et il ne prend effet "
    + "qu'à la CLÔTURE de la bougie qui l'a armé. Sortie sur ce stop = statut « be »." },
  { kind: 'hint', when: v => v.display !== 'zone' && v.beTriggerR > 0
      && (v.tpMode ?? 'rr') === 'rr' && v.beTriggerR >= (v.rr ?? 2), text:
    "⚠ Le seuil est au-dessus du RR du TP : le TP sera toujours touché avant, et le BE ne s'armera "
    + "jamais. Descends le seuil sous le RR pour qu'il serve." },

  { kind: 'number', key: 'dueAfterSl', label: 'Dû — seuil (pertes non remboursées, 0 = off)',
    min: 0, max: 100, step: 1, when: v => v.display !== 'zone' },
  { kind: 'hint', when: v => v.display !== 'zone' && v.dueAfterSl > 0, text:
    "REMBOURSER AVANT DE GAGNER. Chaque position clôturée dans le rouge laisse sa perte sur une "
    + "ardoise ; chaque gain la rembourse en commençant par la plus ANCIENNE. Dès que l'ardoise "
    + "compte ce nombre de pertes, la position suivante vise la SOMME de l'ardoise au lieu de son "
    + "vrai TP — même si c'est plus PRÈS que son objectif normal. Le dû se compte en points NETS, "
    + "et il déplace la cible, jamais le break-even." },
  { kind: 'segmented', key: 'dueMode', label: 'Remboursement',
    when: v => v.display !== 'zone' && v.dueAfterSl > 0, options: [
      { value: 'full', label: "Tout d'un coup" },
      { value: 'step', label: 'Par bonds' },
    ] },
  { kind: 'hint', when: v => v.display !== 'zone' && v.dueAfterSl > 0 && v.dueMode === 'step', text:
    "Par BONDS de « seuil × perte moyenne encore due » — la taille exacte de ce qui a armé le dû. "
    + "L'objectif garde la même taille au lieu de fuir avec l'ardoise, et il faut alors plusieurs "
    + "remboursements." },
  { kind: 'hint', when: v => v.display !== 'zone' && v.dueAfterSl > 0 && v.dueMode !== 'step', text:
    "Tout d'un coup : l'objectif vaut l'ardoise ENTIÈRE. Plus elle grossit, plus il s'éloigne — au "
    + "bout d'une longue série il peut devenir hors d'atteinte, et un objectif qu'on n'atteint pas "
    + "ne rembourse rien. « Par bonds » existe pour ça." },
  { kind: 'hint', when: v => v.display !== 'zone' && v.dueAfterSl > 0 && v.uniqueTrade !== true, text:
    "⚠ Sans « Trade unique », les positions se chevauchent : une sortie ne pèse sur le dû d'une "
    + "entrée que si elle a eu lieu AVANT elle. Le dû lu par une position peut donc être plus petit "
    + "que l'ardoise réelle au même instant." },

  { kind: 'number', key: 'skipAfterTp', label: 'Signaux ignorés après un TP (0 = aucun)',
    min: 0, max: 100, step: 1, when: v => v.display !== 'zone' },
  { kind: 'hint', when: v => v.display !== 'zone' && v.skipAfterTp > 0, text:
    "Après un TP touché, les N signaux suivants sont ignorés, puis on reprend — exactement N. Ils "
    + "ne sont listés nulle part, mais le moniteur et le rapport disent combien ont été sautés ET "
    + "combien auraient gagné : c'est ce second chiffre qui dit ce que le repos a coûté." },

  { kind: 'toggle', key: 'uniqueTrade', label: 'Trade unique', when: v => v.display !== 'zone' },
  { kind: 'hint', when: v => v.display !== 'zone' && v.uniqueTrade === true, text:
    "Une seule position à la fois : toute zone qui s'ouvre avant la clôture de la position en cours "
    + "est ignorée, dans son sens comme à contre-sens, et n'apparaît nulle part. ⚠ Ce n'est pas un "
    + "filtre neutre — il écarte des signaux selon ce que le marché a fait ENTRE-TEMPS. Compare "
    + "toujours les deux modes avant d'y croire." },
  { kind: 'hint', when: v => v.display !== 'zone' && v.uniqueTrade !== true, text:
    "Sans trade unique, les positions se CHEVAUCHENT dès que deux surzones se suivent de près, et "
    + "la courbe de gains du rapport additionne des positions simultanées — à savoir avant de lire "
    + "un drawdown." },

  { kind: 'divider', label: 'Affichage' },

  { kind: 'row', fields: [
    { kind: 'color', key: 'bullColor', label: 'Survente (achat)' },
    { kind: 'color', key: 'bearColor', label: 'Surachat (vente)' },
  ] },
  { kind: 'toggle', key: 'showBg', label: 'Fond de la zone', on: 'Affiché', off: 'Masqué' },
  { kind: 'number', key: 'bgTransp', label: 'Transparence du fond', min: 0, max: 100, step: 5 },
  { kind: 'hint', text:
    "Convention Pine : 0 = fond opaque, 100 = fond invisible." },
  { kind: 'toggle', key: 'showMark',  label: 'Repère au début de zone', on: 'Affiché', off: 'Masqué' },
  { kind: 'toggle', key: 'showLabel', label: 'Étiquette « 4h · 24 »',   on: 'Affichée', off: 'Masquée' },
];
