// TRENDER (motif) — réglages : valeurs par défaut d'un côté, description du
// formulaire de l'autre. Même contrat que lib/rsier/params.js et
// lib/twins/params.js.
//
// LA DÉTECTION N'EST PAS ICI, ET N'EST PAS NON PLUS UNE COPIE : le motif appelle
// `calcHarmony` (lib/harmony.js), la MÊME fonction que l'indicateur TRENDER du
// panneau des indicateurs et que la stratégie de backtest trenderHarmony. Une
// zone d'harmonie du motif et une zone d'harmonie de l'indicateur sont donc la
// même zone, au dernier chiffre près — c'est tout l'intérêt, et ça doit le
// rester. Les défauts de détection ci-dessous sont ceux de HARMONY_DEFAULTS,
// repris tels quels ; les changer ici ferait mentir le motif par rapport à
// l'indicateur.
//
// CE QUE LE MOTIF AJOUTE : un filtre de sens, et tout ce qui suit une détection —
// la position, sa gestion, son rapport.

import { HARMONY_DEFAULTS, activeHtfKeys } from '../harmony';
import { HTF_SECONDS, htfLabel, htfSeriesRequest, mergeHtfRequests } from '../htf';

export const HTF_KEYS = Object.keys(HTF_SECONDS);

// ── Détection ────────────────────────────────────────────────────────────────
// Passés tels quels à calcHarmony. `bbCurMult` n'y figure pas : la fonction ne
// lit que `bbCurLen`, dont elle tire la BASE des Bollinger du timeframe courant —
// le niveau « ≈ SL ». Les bandes elles-mêmes n'appartiennent qu'au dessin de
// l'indicateur, et le motif ne les trace pas.
export const DETECT_DEFAULTS = {
  useHtf1: HARMONY_DEFAULTS.useHtf1, htf1: HARMONY_DEFAULTS.htf1,
  useHtf2: HARMONY_DEFAULTS.useHtf2, htf2: HARMONY_DEFAULTS.htf2,
  useHtf3: HARMONY_DEFAULTS.useHtf3, htf3: HARMONY_DEFAULTS.htf3,
  bbLen:   HARMONY_DEFAULTS.bbLen,
  bbMult:  HARMONY_DEFAULTS.bbMult,
  confFlt: HARMONY_DEFAULTS.confFlt,
  bbCurLen: HARMONY_DEFAULTS.bbCurLen,

  // LE SEUL AJOUT À LA DÉTECTION, et il ne change aucune zone : il en RETIENT.
  // 'both' = les deux sens, comme l'indicateur ; 'bull' / 'bear' = un seul, et
  // les zones de l'autre sens ne sont ni dessinées ni jouées.
  direction: 'both',
};

// ── Prise de position ────────────────────────────────────────────────────────
// Ce que lit lib/patternPositions.js, via ./positions.js — le MÊME simulateur et
// la même gestion que Twins Bars, RSIER, liq et rev.
//
// ENTRÉE AU MARCHÉ, à l'OUVERTURE de la bougie qui ouvre la zone. L'harmonie y
// est déjà connue — elle ne lit que des bougies HTF CLÔTURÉES —, et l'ATR qui
// dimensionne le stop est lu sur la bougie PRÉCÉDENTE : rien de ce qui décide de
// la position ne vient de la bougie où l'on entre. Il n'y a donc aucune raison
// d'attendre une bougie de plus.
//
// SL ET TP SONT FIXES ET INDÉPENDANTS : chacun se règle en POINTS ou en ATR, et
// aucun des deux ne se déduit de l'autre. Le RR n'est pas un réglage ici, c'est
// un résultat — le rapport le donne position par position, le moniteur en donne
// la médiane. Le trait « ≈ SL » de l'indicateur ne sert PAS de stop : il reste un
// dessin.
export const POSITION_DEFAULTS = {
  // 'zone' = les bandes seules | 'position' = les trades seuls | 'both'.
  display:   'both',
  entryMode: 'market',

  // L'ATR qui dimensionne SL et/ou TP quand ils sont réglés en ATR. Lissage de
  // Wilder, comme ta.atr en Pine, et LU SUR LA BOUGIE QUI PRÉCÈDE L'ENTRÉE — la
  // dernière clôturée avant d'entrer.
  atrPeriod: 14,

  // Le stop : une distance depuis l'entrée, en points ou en ATR.
  //   'points' — `slPts` points. Le risque est CONSTANT.
  //   'atr'    — `slAtrMult` × ATR. Le risque suit la volatilité du moment.
  slMode:    'points',
  slPts:     10,
  slAtrMult: 1,

  // L'objectif : une distance depuis l'entrée, elle aussi, et réglée séparément.
  tpMode:    'points',
  tpPts:     20,
  tpAtrMult: 2,

  spreadPts:   0,
  beTriggerR:  0,
  beLevelR:    0,
  uniqueTrade: false,
  skipAfterTp: 0,
  dueAfterSl:  0,
  dueMode:     'full',
};

// ── Habillage ────────────────────────────────────────────────────────────────
// Mêmes valeurs que l'indicateur, pour que les deux se ressemblent à l'écran.
export const STYLE_DEFAULTS = {
  bullColor: '#26A69A',
  bearColor: '#EF5350',
  slColor:   '#EF5350',
  bgTransp:  80,        // convention Pine : 0 = opaque, 100 = invisible
  showBg:    true,
  // Le trait « ≈ SL » de l'indicateur. C'est un DESSIN, et rien d'autre : la
  // position ne s'en sert pas, son stop est une distance fixe.
  showSlLn:  true,
  showMark:  true,      // triangle au début de zone
  showConf:  true,      // texte du repère : le ou les HTF confirmateurs
};

export const TRENDER_DEFAULTS = { ...DETECT_DEFAULTS, ...POSITION_DEFAULTS, ...STYLE_DEFAULTS };

const pick = (pat, defaults) => {
  const out = {};
  for (const k of Object.keys(defaults)) out[k] = pat[k] ?? defaults[k];
  return out;
};

export const detectOptions = (pat = {}) => pick(pat, DETECT_DEFAULTS);

export const positionOptions = (pat = {}) => ({
  ...pick(pat, DETECT_DEFAULTS),
  ...pick(pat, POSITION_DEFAULTS),
  // Non négociable : les zones d'harmonie sont des bandes de TEMPS, il n'y a
  // aucun bord de prix où un ordre pourrait attendre.
  entryMode: 'market',
});

export function styleOptions(pat = {}) {
  return {
    bullColor: pat.bullColor ?? STYLE_DEFAULTS.bullColor,
    bearColor: pat.bearColor ?? STYLE_DEFAULTS.bearColor,
    slColor:   pat.slColor   ?? STYLE_DEFAULTS.slColor,
    bgTransp:  pat.bgTransp  ?? STYLE_DEFAULTS.bgTransp,
    showBg:    pat.showBg    !== false,
    showSlLn:  pat.showSlLn  !== false,
    showMark:  pat.showMark  !== false,
    showConf:  pat.showConf  !== false,
  };
}

// Ce que les motifs TRENDER doivent demander à /api/htf — la même chose que les
// indicateurs du même nom (cf. htfRequests dans lib/harmony.js), sur les motifs
// au lieu des indicateurs. Les deux listes sont fusionnées par hooks/useHtfBars :
// un motif et un indicateur réglés sur le même HTF ne font qu'une requête.
export function trenderHtfRequests(patterns, candles) {
  const reqs = [];
  for (const pat of patterns ?? []) {
    if (pat.type !== 'HARMONY' || !pat.enabled) continue;
    const bbLen = Math.max(1, Math.floor(pat.bbLen ?? DETECT_DEFAULTS.bbLen));
    for (const key of activeHtfKeys(pat)) reqs.push(htfSeriesRequest(key, candles, bbLen));
  }
  return mergeHtfRequests(reqs);
}

// ── Formulaire ───────────────────────────────────────────────────────────────
const htfField = (k, def) => ({
  kind: 'row', fields: [
    { kind: 'toggle', key: `useHtf${k}`, label: `HTF ${k}`, on: 'Actif', off: 'Inactif' },
    { kind: 'select', key: `htf${k}`, label: 'Unité',
      options: HTF_KEYS.map(h => ({ value: h, label: `${h}  ·  ${htfLabel(h)}` })) },
  ],
});

export const FIELDS = [
  { kind: 'hint', text:
    "La logique de l'indicateur TRENDER, à l'identique — c'est la MÊME fonction qui calcule les "
    + "deux. Une Bollinger sur chacune des 3 unités de temps supérieures donne un biais ; quand "
    + "TOUS les HTF actifs pointent dans le même sens, la zone d'harmonie s'ouvre, et elle court "
    + "tant qu'ils y restent. Non-repaint : chaque bougie lit la dernière bougie HTF CLÔTURÉE." },

  { kind: 'divider', label: 'Biais — unités de temps supérieures' },
  htfField(1), htfField(2), htfField(3),

  { kind: 'row', fields: [
    { kind: 'number', key: 'bbLen',  label: 'Bollinger — période',   min: 1,    max: 500, step: 1 },
    { kind: 'number', key: 'bbMult', label: 'Bollinger — écart-type', min: 0.01, max: 5,  step: 0.001 },
  ] },
  { kind: 'hint', text:
    "Sur chaque HTF : biais haussier si la clôture passe au-dessus de base + écart, baissier si "
    + "elle passe en dessous de base − écart, neutre entre les deux. L'écart-type est celui de la "
    + "POPULATION, comme ta.stdev en Pine." },

  { kind: 'select', key: 'confFlt', label: 'Filtre — zones confirmées par',
    options: ['toutes', 'HTF 1', 'HTF 2', 'HTF 3'].map(o => ({ value: o, label: o })) },
  { kind: 'hint', text:
    "Le CONFIRMATEUR est le HTF qui a basculé sur la bougie d'ouverture de la zone : les autres "
    + "étaient déjà alignés, c'est lui qui complète l'harmonie. Le filtre ne garde que les zones "
    + "déclenchées par le HTF choisi, et il est jugé une fois pour toutes à la détection." },

  { kind: 'segmented', key: 'direction', label: 'Sens retenus', options: [
    { value: 'bull', label: '↑ Haussier' },
    { value: 'both', label: '↕ Les deux' },
    { value: 'bear', label: '↓ Baissier' },
  ] },
  { kind: 'hint', when: v => v.direction !== 'both', text:
    "Les zones de l'autre sens ne sont ni dessinées ni jouées. C'est le seul écart du motif avec "
    + "l'indicateur — et il ne change aucune zone, il en retient." },

  { kind: 'number', key: 'bbCurLen', label: 'Base « ≈ SL » — période', min: 1, max: 500, step: 1 },
  { kind: 'hint', text:
    "La base des Bollinger du timeframe COURANT (une moyenne mobile simple des clôtures), gelée à "
    + "la bougie de détection et tracée à l'horizontale sur toute la zone — le niveau « ≈ SL » de "
    + "l'indicateur. C'est un DESSIN et rien de plus : la position ne s'en sert pas, son stop est "
    + "une distance fixe." },

  { kind: 'divider', label: 'Prise de position' },

  { kind: 'segmented', key: 'display', label: 'Représentation', options: [
    { value: 'zone',     label: 'Zone' },
    { value: 'position', label: 'Position' },
    { value: 'both',     label: 'Les deux' },
  ] },
  { kind: 'hint', when: v => v.display === 'zone', text:
    "⚠ En « Zone », aucune position n'est simulée : ni le moniteur en haut à gauche du graphe, ni "
    + "le bouton de téléchargement du rapport n'apparaissent." },
  { kind: 'hint', when: v => v.display !== 'zone', text:
    "Une position par OUVERTURE de zone — pas une par bougie. Achat sur zone haussière, vente sur "
    + "baissière. Entrée AU MARCHÉ à l'ouverture de la bougie qui ouvre la zone : l'harmonie y est "
    + "déjà connue (elle ne lit que des bougies HTF clôturées) et l'ATR est lu sur la bougie "
    + "PRÉCÉDENTE — rien de ce qui décide de la position ne vient de la bougie où l'on entre. Une "
    + "position est toujours prise, aucun signal n'est raté." },
  { kind: 'hint', when: v => v.display !== 'zone', text:
    "SL et TP sont FIXES et INDÉPENDANTS : chacun se règle de son côté, en points ou en ATR, et "
    + "aucun des deux ne se déduit de l'autre. Le RR n'est donc pas un réglage mais un RÉSULTAT — le "
    + "rapport le donne position par position, le moniteur en donne la médiane." },

  { kind: 'segmented', key: 'slMode', label: 'Stop — unité', when: v => v.display !== 'zone', options: [
    { value: 'points', label: 'Points' },
    { value: 'atr',    label: 'ATR' },
  ] },
  { kind: 'number', key: 'slPts', label: 'Distance du SL (points)', min: 0.1, max: 100000, step: 0.1,
    when: v => v.display !== 'zone' && (v.slMode ?? 'points') !== 'atr' },
  { kind: 'number', key: 'slAtrMult', label: 'Distance du SL (× ATR)', min: 0.05, max: 50, step: 0.05,
    when: v => v.display !== 'zone' && v.slMode === 'atr' },

  { kind: 'segmented', key: 'tpMode', label: 'Objectif — unité', when: v => v.display !== 'zone', options: [
    { value: 'points', label: 'Points' },
    { value: 'atr',    label: 'ATR' },
  ] },
  { kind: 'number', key: 'tpPts', label: 'Distance du TP (points)', min: 0.1, max: 100000, step: 0.1,
    when: v => v.display !== 'zone' && (v.tpMode ?? 'points') !== 'atr' },
  { kind: 'number', key: 'tpAtrMult', label: 'Distance du TP (× ATR)', min: 0.05, max: 50, step: 0.05,
    when: v => v.display !== 'zone' && v.tpMode === 'atr' },

  { kind: 'number', key: 'atrPeriod', label: 'Période de l’ATR', min: 1, max: 500, step: 1,
    when: v => v.display !== 'zone' && (v.slMode === 'atr' || v.tpMode === 'atr') },
  { kind: 'hint', when: v => v.display !== 'zone' && (v.slMode === 'atr' || v.tpMode === 'atr'), text:
    "ATR de Wilder, comme ta.atr en Pine, LU SUR LA BOUGIE QUI PRÉCÈDE L'ENTRÉE — la dernière "
    + "clôturée avant d'entrer, jamais celle où l'on entre. La distance change donc à chaque "
    + "position, et le risque suit la volatilité du moment. Une zone qui s'ouvre avant que l'ATR "
    + "n'existe (moins de période + 1 bougies chargées) est écartée et comptée." },
  { kind: 'hint', when: v => v.display !== 'zone' && v.slMode !== 'atr' && v.tpMode !== 'atr', text:
    "Les deux bouts sont fixes en points : le risque et l'objectif sont constants, et le seuil de "
    + "rentabilité est le 1/(1+RR) des manuels, avec RR = TP / SL." },

  { kind: 'number', key: 'spreadPts', label: 'Spread (points)', min: 0, max: 10000, step: 0.1,
    when: v => v.display !== 'zone' },
  { kind: 'hint', when: v => v.display !== 'zone', text:
    "Coût de l'aller-retour, déduit de chaque position clôturée : profitPoints reste le brut, "
    + "netPoints le réel." },

  { kind: 'row', when: v => v.display !== 'zone', fields: [
    { kind: 'number', key: 'beTriggerR', label: 'BE — seuil (R, 0 = off)', min: 0,    max: 20, step: 0.1 },
    { kind: 'number', key: 'beLevelR',   label: 'BE — blocage (R)',        min: -0.9, max: 20, step: 0.1 },
  ] },
  { kind: 'hint', when: v => v.display !== 'zone' && v.beTriggerR > 0, text:
    "Dès qu'une bougie avance de SEUIL × risque dans le sens de la position, le stop se déplace à "
    + "entrée ± BLOCAGE × risque, une fois pour toutes : ce n'est pas un stop suiveur. Il ne peut "
    + "jamais ÉLARGIR le risque, et ne prend effet qu'à la CLÔTURE de la bougie qui l'a armé. "
    + "Sortie sur ce stop = statut « be »." },
  { kind: 'hint', when: v => v.display !== 'zone' && v.beTriggerR > 0
      && (v.slMode ?? 'points') !== 'atr' && (v.tpMode ?? 'points') !== 'atr'
      && v.beTriggerR >= (v.tpPts ?? 20) / (v.slPts ?? 10), text:
    "⚠ Le seuil est au-dessus du RR que donnent les deux distances (TP / SL) : le TP sera toujours "
    + "touché avant, et le BE ne s'armera jamais." },

  { kind: 'number', key: 'dueAfterSl', label: 'Dû — seuil (pertes non remboursées, 0 = off)',
    min: 0, max: 100, step: 1, when: v => v.display !== 'zone' },
  { kind: 'hint', when: v => v.display !== 'zone' && v.dueAfterSl > 0, text:
    "REMBOURSER AVANT DE GAGNER. Chaque position clôturée dans le rouge laisse sa perte NETTE sur "
    + "une ardoise ; chaque gain la rembourse en commençant par la plus ANCIENNE. Au-delà du seuil, "
    + "la position suivante vise l'ardoise au lieu de son vrai TP — même si c'est plus près. Le dû "
    + "déplace la cible, jamais le break-even." },
  { kind: 'segmented', key: 'dueMode', label: 'Remboursement',
    when: v => v.display !== 'zone' && v.dueAfterSl > 0, options: [
      { value: 'full', label: "Tout d'un coup" },
      { value: 'step', label: 'Par bonds' },
    ] },
  { kind: 'hint', when: v => v.display !== 'zone' && v.dueAfterSl > 0 && v.dueMode === 'step', text:
    "Par BONDS de « seuil × perte moyenne encore due » : l'objectif garde la même taille au lieu de "
    + "fuir avec l'ardoise, et le remboursement se fait en plusieurs fois." },

  { kind: 'number', key: 'skipAfterTp', label: 'Signaux ignorés après un TP (0 = aucun)',
    min: 0, max: 100, step: 1, when: v => v.display !== 'zone' },
  { kind: 'toggle', key: 'uniqueTrade', label: 'Trade unique', when: v => v.display !== 'zone' },
  { kind: 'hint', when: v => v.display !== 'zone' && v.uniqueTrade === true, text:
    "Une seule position à la fois : toute zone qui s'ouvre avant la clôture de la position en cours "
    + "est ignorée. ⚠ Ce n'est pas un filtre neutre — il écarte des signaux selon ce que le marché a "
    + "fait ENTRE-TEMPS. Compare toujours les deux modes avant d'y croire." },
  { kind: 'hint', when: v => v.display !== 'zone' && v.uniqueTrade !== true, text:
    "Sans trade unique, les positions se CHEVAUCHENT dès que deux zones se suivent de près, et la "
    + "courbe de gains du rapport additionne des positions simultanées." },

  { kind: 'divider', label: 'Affichage' },

  { kind: 'row', fields: [
    { kind: 'color', key: 'bullColor', label: 'Zone haussière' },
    { kind: 'color', key: 'bearColor', label: 'Zone baissière' },
  ] },
  { kind: 'toggle', key: 'showBg',   label: 'Fond de la zone',   on: 'Affiché', off: 'Masqué' },
  { kind: 'number', key: 'bgTransp', label: 'Transparence du fond', min: 0, max: 100, step: 5 },
  { kind: 'row', fields: [
    { kind: 'toggle', key: 'showSlLn', label: 'Trait « ≈ SL »', on: 'Affiché', off: 'Masqué' },
    { kind: 'color',  key: 'slColor',  label: 'Sa couleur' },
  ] },
  { kind: 'toggle', key: 'showMark', label: 'Repère au début de zone', on: 'Affiché', off: 'Masqué' },
  { kind: 'toggle', key: 'showConf', label: 'Étiquette du confirmateur', on: 'Affichée', off: 'Masquée' },
];
