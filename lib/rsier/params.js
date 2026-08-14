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

  // ── LA DISTANCE DE L'ENTRÉE À LA MOYENNE MOBILE ────────────────────────────
  // De combien le prix d'entrée en surzone s'est écarté d'une moyenne mobile du
  // GRAPHE (le RSI, lui, reste celui du HTF — cf. ./detect.js). SIGNÉE DANS LE
  // SENS DE L'EXCÈS : positif = la survente est bien sous la moyenne, le
  // surachat bien au-dessus ; négatif = l'entrée est du mauvais côté, un RSI en
  // surzone alors que le prix n'a même pas franchi sa moyenne. 0 = pas de mesure.
  //
  // Elle est dans la DÉTECTION et non dans l'habillage, pour la même raison que
  // chez le $$$ : depuis qu'un seuil peut écarter une zone, c'est une condition
  // du motif, donc quelque chose que les positions voient aussi.
  maDistPeriod: 50,
  // LE SEUIL, ET UN SEUL. Un minimum et un maximum ne se règlent pas ensemble :
  // un choix unique rend l'état incohérent impossible à écrire. Les deux valeurs
  // sont gardées séparément — un plancher et un plafond n'ont pas le même ordre
  // de grandeur, et basculer de l'un à l'autre ne doit pas effacer l'autre
  // réglage. Le seuil porte sur la VALEUR ABSOLUE de l'écart.
  maDistMode: 'off',      // 'off' | 'min' | 'max'
  maDistMin:  0,
  maDistMax:  0,
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

  // DE QUEL CÔTÉ ON JOUE LA SURZONE. Les deux lectures existent — d'où un
  // réglage plutôt qu'un choix caché :
  //   'continuation' — on VEND la survente et on ACHÈTE le surachat. Le pari est
  //                    qu'un RSI en surzone signe une tendance qui continue.
  //   'reversion'    — l'inverse, exactement : on achète la survente et on vend
  //                    le surachat, en pariant que l'excès se corrige.
  // Le défaut est la CONTINUATION : c'est ainsi que le motif est lu ici, un RSI
  // HTF en surzone marquant une tendance en cours et non un excès à contrer.
  // Le SENS DE LA ZONE, lui, ne bouge pas : une bande verte reste une survente,
  // quelle que soit la position qu'on y prend — elle se vend, désormais.
  tradeSide: 'continuation',

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

  // ── LA TAILLE DE POSITION ──────────────────────────────────────────────────
  // L'escalier des lots de lib/patternPositions.js, que ce motif se contentait
  // de ne pas proposer : le simulateur le porte depuis toujours pour toute la
  // famille, il suffit que les réglages existent ici pour qu'il s'allume.
  //   'fixe'        — 1 lot, toujours.
  //   'exponentiel' — ×`lotFactor` tous les `lotStepTrades` trades PRIS : 1, 2, 4, 8…
  //   'pas'         — +`lotPlus` tous les `lotStepTrades` trades : 1, 2, 3, 4…
  // Les deux escaliers partagent le compteur de marches et le plafond ; seule la
  // façon de monter d'une marche les sépare. Le compte se fait sur les positions
  // RETENUES, dans l'ordre d'ENTRÉE.
  //
  // LE LOT NE TOUCHE À RIEN DE LA SIMULATION : entrée, stop, cible et excursions
  // sont des PRIX, ils ne bougent pas d'un lot à l'autre. Il multiplie le
  // RÉSULTAT à la toute fin — brut, spread et net ensemble, pour que
  // net = brut − spread reste vrai (deux lots paient deux spreads).
  lotMode:       'fixe',
  lotStepTrades: 10,
  lotFactor:     2,
  lotPlus:       1,
  // 0 = aucun plafond. En exponentiel il n'est pas là par prudence mais par
  // nécessité arithmétique : F^k déborde, et un lot infini rendrait tous les
  // résultats NaN sans qu'une ligne ne le signale.
  lotMax:        0,

  // À QUEL PRIX ON SORT quand un niveau est touché. 'level' = au niveau, le
  // comportement de toujours ; 'close' = à la CLÔTURE de la bougie qui a touché.
  // La mécanique complète et ses conséquences sont dans lib/patternPositions.js.
  exitFill:    'level',

  spreadPts:   0,
  beTriggerR:  0,
  beLevelR:    0,
  uniqueTrade: false,
  skipAfterTp: 0,
  dueAfterSl:  0,
  dueMode:     'full',
};

// LE SENS QU'ON VOIT À L'ÉCRAN, c'est celui qu'on JOUE — pas celui de la
// surzone. Une bande de survente jouée en continuation est une VENTE : elle se
// dessine en rouge, sa flèche pointe vers le bas et se pose au-dessus de la
// bougie. Le contraire (colorer la surzone) revenait à montrer une flèche verte
// vers le haut là où le motif vend, ce qu'aucune lecture de graphe ne rattrape.
//
// La DÉTECTION, elle, garde le sens de la surzone : `zone.side` reste 'bull'
// pour une survente. La bascule se fait ici, au bord de l'affichage et de la
// prise de position, et nulle part ailleurs.
export const playedSide = (zoneSide, pat = {}) =>
  (pat.tradeSide ?? POSITION_DEFAULTS.tradeSide) === 'continuation'
    ? (zoneSide === 'bull' ? 'bear' : 'bull')
    : zoneSide;

// ── Habillage ────────────────────────────────────────────────────────────────
export const STYLE_DEFAULTS = {
  // DEUX FAÇONS DE DESSINER LA MÊME SURZONE, et le choix ne touche QUE le
  // dessin — la détection, le filtre de distance et les positions ne s'en
  // aperçoivent pas.
  //   'bande' — la bande verticale pleine hauteur, celle d'origine : elle dit
  //             QUAND le RSI est en surzone, et rien sur les prix.
  //   'boite' — un rectangle ancré sur le PRIX D'ENTRÉE, ouvert à la bougie qui
  //             ouvre la zone. Sa hauteur se règle en points de part et d'autre
  //             de ce prix, sa longueur en bougies. Il ne dit plus la durée de
  //             la surzone (qui peut être bien plus longue ou plus courte) mais
  //             une FENÊTRE autour de l'entrée — de quoi juger à l'œil ce que
  //             le prix a fait des N bougies suivantes.
  zoneStyle:   'bande',
  boxUpPts:    10,   // hauteur AU-DESSUS du prix d'entrée, en points
  boxDownPts:  10,   // hauteur EN DESSOUS, réglée à part : la boîte n'a aucune
                     // raison d'être symétrique quand le motif, lui, ne l'est pas
  boxLenBars:  20,   // longueur, en bougies du graphe
  bullColor: '#26A69A',   // position d'ACHAT  (surachat en continuation, survente en réversion)
  bearColor: '#EF5350',   // position de VENTE (survente en continuation, surachat en réversion)
  bgTransp:  85,          // convention Pine : 0 = opaque, 100 = invisible
  showBg:    true,
  showMark:   true,       // triangle sur la bougie qui ouvre la zone
  showLabel:  true,       // texte du repère : « 4h · 24 »
  showMaDist: true,       // la cote entre l'entrée et la moyenne mobile
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

// `tradeSide` en fait partie : c'est lui qui décide du sens DESSINÉ (cf.
// playedSide), pas seulement du sens joué.
export function styleOptions(pat = {}) {
  return {
    tradeSide: pat.tradeSide ?? POSITION_DEFAULTS.tradeSide,
    zoneStyle:  pat.zoneStyle  ?? STYLE_DEFAULTS.zoneStyle,
    boxUpPts:   pat.boxUpPts   ?? STYLE_DEFAULTS.boxUpPts,
    boxDownPts: pat.boxDownPts ?? STYLE_DEFAULTS.boxDownPts,
    boxLenBars: pat.boxLenBars ?? STYLE_DEFAULTS.boxLenBars,
    bullColor: pat.bullColor ?? STYLE_DEFAULTS.bullColor,
    bearColor: pat.bearColor ?? STYLE_DEFAULTS.bearColor,
    bgTransp:  pat.bgTransp  ?? STYLE_DEFAULTS.bgTransp,
    showBg:     pat.showBg     !== false,
    showMark:   pat.showMark   !== false,
    showLabel:  pat.showLabel  !== false,
    showMaDist: pat.showMaDist !== false,
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

  { kind: 'divider', label: 'Distance à la moyenne mobile' },

  { kind: 'number', key: 'maDistPeriod', label: 'MM — période (0 = off)', min: 0, max: 1000, step: 1 },
  { kind: 'hint', when: v => v.maDistPeriod > 0, text:
    "De combien le PRIX D'ENTRÉE s'est écarté de cette moyenne, mesuré à l'ouverture de la bougie "
    + "qui ouvre la zone. La moyenne est celle du GRAPHE, pas du HTF : ce qu'on mesure est un prix "
    + "d'entrée, le comparer à une moyenne H4 comparerait deux échelles. Elle est lue sur la bougie "
    + "PRÉCÉDENTE — à l'ouverture, la clôture de la bougie d'entrée n'existe pas encore." },
  { kind: 'hint', when: v => v.maDistPeriod > 0, text:
    "SIGNE : positif = l'excès est du bon côté (survente SOUS la moyenne, surachat AU-DESSUS). "
    + "Négatif = l'entrée est du mauvais côté — un RSI en surzone alors que le prix n'a même pas "
    + "franchi sa moyenne. Le signe suit l'EXCÈS et non la position : il ne bascule pas avec "
    + "« Sens joué »." },

  { kind: 'segmented', when: v => v.maDistPeriod > 0, key: 'maDistMode', label: 'Filtre', options: [
    { value: 'off', label: 'Aucun' },
    { value: 'min', label: 'Minimum' },
    { value: 'max', label: 'Maximum' },
  ] },
  { kind: 'number', when: v => v.maDistPeriod > 0 && v.maDistMode === 'min',
    key: 'maDistMin', label: '|distance| ≥', min: 0, max: 1000000, step: 0.1 },
  { kind: 'number', when: v => v.maDistPeriod > 0 && v.maDistMode === 'max',
    key: 'maDistMax', label: '|distance| ≤', min: 0, max: 1000000, step: 0.1 },
  { kind: 'hint', when: v => v.maDistPeriod > 0 && v.maDistMode !== 'off', text:
    "Le seuil porte sur la VALEUR ABSOLUE de l'écart : il trie sur la distance, pas sur le côté. "
    + "Une zone dont la mesure manque — moyenne pas encore chaude — est ÉCARTÉE tant qu'un seuil "
    + "est actif : on ne conclut pas sur ce qu'on ne sait pas évaluer. Les positions voient le même "
    + "filtre que le dessin, elles rejouent cette détection." },

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
    { value: 'continuation', label: "Avec l'excès" },
    { value: 'reversion',    label: "Contre l'excès" },
  ] },
  { kind: 'hint', when: v => v.display !== 'zone' && v.tradeSide !== 'reversion', text:
    "AVEC L'EXCÈS — le défaut : on VEND la survente et on ACHÈTE le surachat, un RSI en surzone "
    + "étant lu comme une tendance qui continue. La bande et sa flèche suivent le sens JOUÉ : une "
    + "zone de survente est donc dessinée en rouge, flèche vers le bas au-dessus de la bougie." },
  { kind: 'hint', when: v => v.display !== 'zone' && v.tradeSide === 'reversion', text:
    "CONTRE L'EXCÈS, exactement l'inverse : on achète la survente et on vend le surachat. Le pari "
    + "est que l'excès se corrige. La survente redevient alors verte, flèche vers le haut." },

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

  { kind: 'segmented', key: 'exitFill', label: 'Clôture', when: v => v.display !== 'zone', options: [
    { value: 'level', label: 'Au niveau' },
    { value: 'close', label: 'À la clôture' },
  ] },
  { kind: 'hint', when: v => v.display !== 'zone' && v.exitFill !== 'close', text:
    "AU NIVEAU : le SL et le TP sont des ordres réels, laissés sur le marché et servis au prix "
    + "demandé — au pire de l'ouverture si la bougie l'a franchi en gap." },
  { kind: 'hint', when: v => v.display !== 'zone' && v.exitFill === 'close', text:
    "À LA CLÔTURE : le niveau touché ne déclenche plus une exécution mais une DÉCISION, appliquée à "
    + "la fin de la bougie qui l'a touché. C'est ce que fait une stratégie qui ne regarde le marché "
    + "qu'aux clôtures — un EA qui tourne à la bougie et non au tick." },
  { kind: 'hint', when: v => v.display !== 'zone' && v.exitFill === 'close', text:
    "⚠ Trois conséquences à connaître avant de lire un résultat. Une position sortie sur TP peut "
    + "finir PERDANTE, et une sortie sur SL gagnante : la bougie a le temps de revenir sur ses pas. "
    + "Le statut dit quelle RÈGLE a agi, pas si l'issue est gagnante — le winrate devient le taux de "
    + "trades qui ont ATTEINT leur cible, plus le taux de trades profitables ; les points, eux, "
    + "restent vrais. Et la perte n'est plus bornée par le risque initial, donc le R d'une position "
    + "peut dépasser −1." },

  { kind: 'divider', label: 'Lot', when: v => v.display !== 'zone' },
  // Un SELECT et non des boutons segmentés : la liste des types de lot est
  // appelée à s'allonger, et une rangée de boutons déborde au 4e.
  { kind: 'select', key: 'lotMode', label: 'Type de lot', when: v => v.display !== 'zone', options: [
    { value: 'fixe',        label: 'Classique — 1 lot' },
    { value: 'exponentiel', label: 'Exponentiel — ×F tous les N trades' },
    { value: 'pas',         label: 'Pas à pas — +P tous les N trades' },
  ] },
  { kind: 'row', when: v => v.display !== 'zone' && v.lotMode === 'exponentiel', fields: [
    { kind: 'number', key: 'lotStepTrades', label: 'Tous les N trades', min: 1, max: 10000, step: 1 },
    { kind: 'number', key: 'lotFactor',     label: 'Lot ×',             min: 1, max: 100,   step: 0.1 },
  ] },
  { kind: 'row', when: v => v.display !== 'zone' && v.lotMode === 'pas', fields: [
    { kind: 'number', key: 'lotStepTrades', label: 'Tous les N trades', min: 1, max: 10000, step: 1 },
    { kind: 'number', key: 'lotPlus',       label: 'Lot +',             min: 0, max: 1000,  step: 0.1 },
  ] },
  { kind: 'number', when: v => v.display !== 'zone' && v.lotMode && v.lotMode !== 'fixe',
    key: 'lotMax', label: 'Lot maximum (0 = aucun)', min: 0, max: 1000000, step: 1 },
  { kind: 'hint', when: v => v.display !== 'zone' && v.lotMode === 'exponentiel', text:
    "Les N premiers trades à 1 lot, les N suivants à F, les N d'après à F²… Le plafond n'est pas "
    + "de la prudence : F^k déborde, et un lot infini passerait TOUS les résultats à NaN en silence." },
  { kind: 'hint', when: v => v.display !== 'zone' && v.lotMode === 'pas', text:
    "1, 2, 3, 4 lots… le pendant LINÉAIRE de l'exponentiel — même compteur de marches, seule la "
    + "façon de monter change. Le poids du dernier bloc y croît comme n et non comme 2ⁿ : le total "
    + "reste une moyenne à peu près honnête. Des deux escaliers, c'est le seul dont un backtest "
    + "garde du sens." },
  { kind: 'hint', when: v => v.display !== 'zone' && v.lotMode && v.lotMode !== 'fixe', text:
    "⚠ Le lot ne touche à RIEN de la simulation — entrée, stop et cible sont des prix, ils ne "
    + "bougent pas d'un lot à l'autre. Il multiplie l'espérance de chaque trade, il n'en crée "
    + "aucune. Mais le TOTAL, lui, peut changer de signe : ce n'est plus une moyenne mais une somme "
    + "pondérée dont les poids grossissent avec le temps, donc dictée par les DERNIERS trades. À "
    + "lire à côté du résultat à lot fixe, jamais à sa place." },

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

  { kind: 'segmented', key: 'zoneStyle', label: 'Forme de la zone', options: [
    { value: 'bande', label: 'Bande' },
    { value: 'boite', label: 'Boîte' },
  ] },
  { kind: 'hint', when: v => v.zoneStyle !== 'boite', text:
    "BANDE : une verticale pleine hauteur qui couvre exactement la durée de la surzone — elle dit "
    + "QUAND le RSI y est, et rien sur les prix." },
  { kind: 'hint', when: v => v.zoneStyle === 'boite', text:
    "BOÎTE : un rectangle ancré sur le PRIX D'ENTRÉE, ouvert à la bougie qui ouvre la zone. Sa "
    + "longueur est un RÉGLAGE et non une mesure — elle ne dit plus la durée de la surzone, mais ce "
    + "que le prix a fait des N bougies qui ont suivi l'entrée. Le choix ne touche que le dessin : "
    + "détection, filtre de distance et positions sont identiques dans les deux formes." },
  { kind: 'row', when: v => v.zoneStyle === 'boite', fields: [
    { kind: 'number', key: 'boxUpPts',   label: 'Hauteur au-dessus (points)', min: 0, max: 1000000, step: 0.1 },
    { kind: 'number', key: 'boxDownPts', label: 'Hauteur en dessous (points)', min: 0, max: 1000000, step: 0.1 },
  ] },
  { kind: 'number', key: 'boxLenBars', label: 'Longueur (bougies)', min: 1, max: 5000, step: 1,
    when: v => v.zoneStyle === 'boite' },
  { kind: 'hint', when: v => v.zoneStyle === 'boite', text:
    "Les deux hauteurs se règlent SÉPARÉMENT, de part et d'autre du prix d'entrée : rien n'oblige "
    + "la fenêtre qu'on regarde à être symétrique. Une boîte dont le bord droit dépasse les bougies "
    + "chargées court jusqu'au bord du graphe plutôt que de s'arrêter sur une fin qui n'existe pas." },

  { kind: 'row', fields: [
    { kind: 'color', key: 'bullColor', label: 'Achat' },
    { kind: 'color', key: 'bearColor', label: 'Vente' },
  ] },
  { kind: 'hint', text:
    "Les deux couleurs sont celles du SENS JOUÉ, pas de la surzone : avec l'excès, une survente "
    + "est une vente et se dessine donc en rouge, flèche vers le bas. Ce que le repère annonce est "
    + "ainsi toujours ce que le motif fait." },
  { kind: 'toggle', key: 'showBg', label: 'Fond de la zone', on: 'Affiché', off: 'Masqué' },
  { kind: 'number', key: 'bgTransp', label: 'Transparence du fond', min: 0, max: 100, step: 5 },
  { kind: 'hint', text:
    "Convention Pine : 0 = fond opaque, 100 = fond invisible." },
  { kind: 'hint', when: v => v.zoneStyle === 'boite' && v.showBg === false, text:
    "En boîte, « fond masqué » enlève le REMPLISSAGE mais garde les bords : le rectangle reste "
    + "visible en contour. Une boîte sans fond ni bord ne se verrait pas du tout." },
  { kind: 'toggle', key: 'showMark',  label: 'Repère au début de zone', on: 'Affiché', off: 'Masqué' },
  { kind: 'toggle', key: 'showLabel', label: 'Étiquette « 4h · 24 »',   on: 'Affichée', off: 'Masquée' },
  { kind: 'toggle', key: 'showMaDist', label: 'Cote de distance à la MM',
    on: 'Affichée', off: 'Masquée', when: v => v.maDistPeriod > 0 },
  { kind: 'hint', when: v => v.maDistPeriod > 0 && v.showMaDist !== false, text:
    "Une verticale grise à l'ouverture de la zone, entre le prix d'entrée et la moyenne, avec "
    + "l'écart écrit au milieu — la même cote que celle du $$$. Elle ne dit que la distance : "
    + "masquer le trait ne change ni le filtre, ni les positions." },
];
