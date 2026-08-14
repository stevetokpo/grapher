// $$$ — les réglages : les valeurs par défaut d'un côté, la description du
// formulaire de l'autre. Ce fichier est la seule source de vérité des deux ; le
// graphe et le panneau Patterns le lisent, personne ne recopie une valeur
// ailleurs.
//
// LE MOTIF EST DÉFINI, PAS RÉGLABLE. Ce qui fait un $$$ — deux imbalances de
// sens contraires, emboîtées par une bougie partagée — n'a pas d'interrupteur :
// c'est la figure elle-même, et une figure ne s'éteint pas. Il ne reste ici
// qu'un tri (quelles paires garder), UNE condition — la similitude des deux
// boîtes, éteinte par défaut — et de l'habillage. Les deux se lisent dans la
// seule géométrie des bougies : aucune moyenne, aucun ATR, aucun point.
//
// CE QUI N'EST PAS ICI, et ne doit pas y revenir. Le motif descend du rFVG, d'où
// il a été taillé le 06/08/2026. Sont partis, définitivement :
//   • les DEUX MOYENNES MOBILES et tout ce qui en vivait — le classement des
//     familles (rFVG / aFVG / cFVG / superFVG), « premier du côté de la MM
//     lente », « centrale à cheval sur la MM lente », « MM lente — ouverture
//     seule ». Plus une seule moyenne dans ce motif : ce qui est jugé tient
//     dans les cinq bougies de la figure.
//   • TOUTE la mesure de taille : le choix amplitude / corps, la période d'ATR
//     et le seuil « taille >= x × ATR », plus le plafond de corps sur la 3e
//     bougie (l'ancien atrMult3). Une imbalance est une imbalance, quelle que
//     soit sa taille — ce motif ne trie plus les impulsions par leur amplitude.
//   • les BORNES DU GAP (l'ancien couple minPts / maxPts). Le vide est exigé
//     franc, et c'est tout : ni plancher réglable, ni plafond, ni tolérance au
//     chevauchement (cf. ./detect.js).
//   • la MÈCHE DE REJET sur la 3e bougie (l'ancien wick3), dernier tamis à
//     tomber. Plus aucune condition de forme : la figure est géométrique de
//     bout en bout.
//   • tout le mode « position » (entrée, SL, TP, BE, dû, trade unique…). Ce
//     motif dessine des zones et s'arrête là ; la gestion viendra d'ailleurs et
//     n'a pas à se réinventer ici.
// Rajouter l'un d'eux, c'est refaire le rFVG — qui existe déjà, à côté.

import { HTF_SECONDS } from '../htf';

// Les unités proposées au mode fractal, dans l'ordre du temps. La liste vient de
// lib/htf.js — la recopier ici la ferait diverger le jour où une unité s'ajoute.
const HTF_KEYS = Object.keys(HTF_SECONDS);

// ── Détection ────────────────────────────────────────────────────────────────
// Ce que lit ./detect.js, et rien de plus.
export const DETECT_DEFAULTS = {
  // Quelles PAIRES on garde, par le sens de leur PREMIER motif. Attention au
  // sens du mot : une paire qui commence haussière est une POINTE HAUTE, donc
  // une structure de retournement BAISSIER (cf. le long commentaire de
  // ./detect.js). 'bull' ne veut pas dire « signal d'achat ».
  direction: 'both',
  // Combien les deux boîtes de la paire doivent se ressembler, en POURCENTAGE
  // de recouvrement (0–100) — cf. similarityOf dans ./detect.js. 100 = le même
  // rectangle au prix près, 0 = peu importe, et c'est le défaut : la figure nue
  // reste ce qu'elle était. Sans unité, donc transposable d'un symbole à l'autre.
  similarity: 0,

  // ── L'EXTRÊME DE RSI AVANT L'IMPULSION ─────────────────────────────────────
  // La dernière bougie de sens CONTRAIRE juste avant l'impulsion du SECOND motif
  // doit avoir clôturé en zone extrême : en SURACHAT si cette impulsion est
  // baissière, en SURVENTE si elle est haussière. Le dernier sursaut avant la
  // cassure était donc déjà à bout de souffle.
  // 0 = éteint. Mettre 7 pour le RSI court de la maison (celui de la corne).
  // C'est le seul filtre du motif qui regarde autre chose que la géométrie.
  rsiPeriod:     0,
  rsiOverbought: 80,
  rsiOversold:   20,

  // ── LA 3e BOUGIE DU SECOND MOTIF, INVERSÉE ─────────────────────────────────
  // La bougie qui referme le second gap doit clôturer à CONTRE-SENS de
  // l'impulsion qui vient de le creuser : impulsion baissière → bougie
  // haussière, et l'inverse. Le marché rend déjà du terrain au lieu de
  // simplement s'arrêter. C'est la même idée que l'ancien « superFVG » du rFVG,
  // appliquée au seul SECOND motif — celui qu'on joue.
  // Elle porte sur la 5e bougie de la figure, celle qui la rend connue : aucune
  // bougie d'attente en plus. Un doji est refusé, il ne rend rien.
  // false = éteint, comme tous les tamis de ce motif.
  reverseThird: false,

  // ── LA DISTANCE DE LA POINTE À UNE MOYENNE ─────────────────────────────────
  // De combien la POINTE s'est écartée d'une moyenne mobile, mesurée au départ
  // du trait extrême. SIGNÉE DANS LE SENS DE LA POINTE : positif = elle a
  // dépassé la moyenne, négatif = elle ne l'a même pas atteinte, et cela dans
  // les deux sens de figure. 0 = pas de mesure du tout.
  // Elle est ici, avec la détection, et non dans l'habillage : depuis qu'un
  // seuil peut écarter une figure, c'est une CONDITION du motif — donc quelque
  // chose que les positions voient aussi. Le dessin, lui, ne la montre que là où
  // le trait extrême existe (nuage et mode « Extrême »).
  // En fractal, c'est la moyenne des bougies HTF.
  maDistPeriod: 200,
  // LE SEUIL, ET UN SEUL. Un minimum et un maximum ne se règlent pas ensemble :
  // plutôt que deux cases qu'on peut cocher toutes les deux, un choix unique
  // rend l'état incohérent impossible à écrire. Les deux valeurs sont gardées
  // séparément — un plancher et un plafond n'ont pas le même ordre de grandeur,
  // et basculer de l'un à l'autre ne doit pas effacer le réglage précédent.
  // Le seuil porte sur la VALEUR ABSOLUE de l'écart.
  maDistMode: 'off',      // 'off' | 'min' | 'max'
  maDistMin:  0,
  maDistMax:  0,
  // Dessin seul : de combien de barres la boîte est tirée à droite. Ne retient
  // ni n'écarte aucun motif — à exclure de toute clé de cache de signaux.
  extLen:    20,
};

// ── Position ─────────────────────────────────────────────────────────────────
// LE SENS EST CELUI DU SECOND MOTIF — le dernier FVG de la paire —, et il n'y a
// rien à régler là : une paire baissière→haussière s'ACHÈTE, une paire
// haussière→baissière se VEND. C'est la pointe qu'on joue, pas l'impulsion qui
// l'a faite.
//
// UNE SEULE CONDITION D'ENTRÉE et une seule de sortie, pour l'instant : un ordre
// à cours limité sur le bord de la seconde boîte, un SL et un TP fixes. Les
// autres viendront s'ajouter à côté, jamais en remplaçant celle-ci en douce.
//
// TOUTES LES DISTANCES SE RÈGLENT EN POINTS OU EN ATR, d'un seul interrupteur
// (`distUnit`) : marge d'entrée, SL et TP changent d'unité ensemble. Les valeurs
// des deux unités vivent dans des CLÉS SÉPARÉES — 12 points et 12 × ATR n'ont
// rien à voir, partager la clé ferait qu'un simple changement d'unité poserait
// un stop absurde.
export const POSITION_DEFAULTS = {
  // 'zone' = les boîtes seules | 'position' = les trades seuls | 'both'.
  display: 'zone',

  // ── L'unité de toutes les distances ────────────────────────────────────────
  //   'points' — des points de prix, tels quels.
  //   'atr'    — des multiples de l'ATR, LU SUR LA DERNIÈRE BOUGIE DE LA FIGURE
  //              (celle qui la rend connue). Il est figé là et ne bouge plus de
  //              toute la vie de la position : un stop qui suivrait l'ATR se
  //              déplacerait tout seul, ce qui n'est plus un stop.
  distUnit:  'points',
  atrPeriod: 14,

  // ── L'entrée ───────────────────────────────────────────────────────────────
  // OÙ l'ordre est posé. Les deux niveaux existent déjà dans la figure ; ce
  // réglage choisit lequel on attend.
  //   'bord'    — le bord LIBRE de la seconde boîte, celui qui fait face au prix
  //               quand la figure se termine. L'entrée d'origine.
  //   'extreme' — la POINTE : l'autre bout de la bougie partagée, le plus loin
  //               où le marché est allé avant de se retourner. Bien plus loin du
  //               prix, donc servi plus rarement et beaucoup mieux placé.
  // LE NIVEAU DE SANTÉ SUIT L'ENTRÉE, et ce n'est pas un détail : la santé dit
  // « le niveau où j'ai acheté tient-il encore ». Entrer à l'extrême suppose
  // d'avoir traversé le bord du gap — le garder comme référence rendrait toute
  // position malsaine dès sa naissance, ce qui désarmerait le trade unique et
  // ferait s'armer le BE du malsain sur-le-champ.
  entryLevel: 'bord',
  // La marge appliquée au bord de la seconde boîte, SIGNÉE et comptée du côté
  // d'où le prix revient : POSITIVE = pré-entrée, l'ordre est posé AVANT le
  // bord (au-dessus pour un achat) et sera servi plus tôt, à un prix moins bon ;
  // NÉGATIVE = l'ordre est plus loin DANS la boîte et exige que le prix y
  // pénètre. 0 = pile sur le bord.
  entryMarginPts: 0,
  entryMarginAtr: 0,
  // Au bout de combien de bougies l'ordre non servi est annulé. 0 = jamais, il
  // attend aussi longtemps qu'il y a des données.
  entryWaitBars: 0,

  // ── La sortie ──────────────────────────────────────────────────────────────
  // SL et TP sont deux distances FIXES depuis l'entrée, INDÉPENDANTES l'une de
  // l'autre : le RR est un résultat, pas un réglage.
  slPts: 10,
  slAtr: 1,
  tpPts: 20,
  tpAtr: 2,

  spreadPts:   0,

  // ── LA TAILLE DE POSITION ──────────────────────────────────────────────────
  // Elle ne touche à rien de la simulation — entrée, stop et cible sont des PRIX
  // et ne bougent pas. Elle multiplie le RÉSULTAT, et rien d'autre : un gain de
  // 10 points à 2 lots en vaut 20.
  //   'fixe'        — 1 lot, toujours.
  //   'exponentiel' — ×`lotFactor` tous les `lotStepTrades` trades PRIS : 1, 2, 4, 8…
  //   'pas'         — +`lotPlus` tous les `lotStepTrades` trades : 1, 2, 3, 4…
  // Les deux escaliers partagent le compteur de marches (`lotStepTrades`) et le
  // plafond ; seule la façon de monter d'une marche les sépare.
  // `lotMax` plafonne (0 = aucun) ; en exponentiel il est là par nécessité
  // arithmétique, pas par prudence : 2^k déborde et rendrait tous les résultats NaN.
  lotMode:       'fixe',
  lotStepTrades: 10,
  lotFactor:     2,
  lotPlus:       1,
  lotMax:        0,

  // ── LE TP DYNAMIQUE ────────────────────────────────────────────────────────
  // Deux raisons de repousser la cible, jugées à l'instant où le TP de base est
  // touché. Éteintes toutes les deux par défaut ; la mécanique complète et ses
  // garde-fous sont dans lib/patternPositions.js.
  //
  //   1. LA POSITION VA VITE — le TP de base est atteint en `tpFastBars`
  //      bougies ou moins depuis l'entrée. 0 = éteint.
  tpFastBars: 0,
  tpFastMult: 2,
  //   2. LA POSITION EST SAINE — entrée du bon côté de la moyenne mobile (SOUS
  //      elle à l'achat, AU-DESSUS à la vente) et aucune bougie n'a CLÔTURÉ
  //      au-delà du bord du gap qui l'a fait entrer. 0 = éteint.
  //      C'est la SEULE moyenne mobile de ce motif, et elle ne touche pas à la
  //      détection : les zones restent exactement les mêmes qu'on l'active ou
  //      non. Elle ne décide que d'une extension de cible.
  tpSaneMaPeriod: 0,
  tpSaneMult:     2,

  // ── LE BE DU MALSAIN ───────────────────────────────────────────────────────
  // Quand une position cesse d'être SAINE (une bougie clôture au-delà du bord du
  // gap qui l'a fait entrer), on n'attend plus le TP : on attend que le prix
  // revienne à cette distance AU-DESSUS de l'entrée en achat, en dessous en
  // vente, et on solde là. Un petit gain, pas un break-even à zéro. Le stop
  // reste actif pendant l'attente. 0 = éteint.
  // Même unité que tout le reste (`distUnit`), d'où les deux clés séparées.
  beUnhealthyPts: 0,
  beUnhealthyAtr: 0,

  // ── LE BE EXISTENTIEL ──────────────────────────────────────────────────────
  // Armé par le TEMPS et non par une avarie : passé ce nombre de bougies, la
  // position a assez duré pour qu'on cesse de lui faire crédit. Il vise le MÊME
  // niveau que le BE du malsain — sans distance réglée au-dessus, il n'a pas de
  // niveau et reste éteint. Mais il agit des DEUX CÔTÉS : au-delà du niveau il
  // protège (on ne redescend plus dessous), en deçà il coupe dès qu'on y
  // arrive. 0 = éteint.
  beExistBars: 0,

  // TRADE UNIQUE — la règle du motif, et pas celle de la famille. Une position
  // ne réserve la place que tant qu'elle est SAINE : aucune bougie n'a clôturé
  // au-delà du bord du gap qui l'a fait entrer. Dès qu'elle cesse de l'être, le
  // motif suivant est jouable même si elle court toujours. Peu importe où elle a
  // été prise — aucune moyenne mobile n'entre ici, contrairement au TP
  // dynamique 2, qui partage le mot « saine » mais y ajoute sa condition de MM.
  // ./positions.js force `uniqueMode` sur 'healthy' : c'est la règle, pas une
  // préférence.
  uniqueTrade: false,

  // PAS DE BREAK-EVEN. La famille en a un (beTriggerR / beLevelR), ce motif non :
  // sa règle reste à écrire et ne sera pas celle-là. Les clés ne sont pas ici, et
  // ./positions.js les force à l'arrêt — un réglage enregistré du temps où elles
  // existaient ne peut donc pas les rallumer en silence.
  skipAfterTp: 0,
  dueAfterSl:  0,
  dueMode:     'full',
};

// ── Habillage ────────────────────────────────────────────────────────────────
// Ce que lit la primitive de rendu. Séparé de la détection pour que changer une
// couleur ne puisse jamais compter comme un changement de motif.
export const STYLE_DEFAULTS = {
  bullColor: '#26A69A',
  bearColor: '#EF5350',
  opacity:   0.18,
  showLabel: true,
  // COMMENT la figure est dessinée. Purement visuel : la détection ne change pas
  // d'un iota, et les positions ne s'en aperçoivent pas.
  //   'boites'  — les deux FVG, chacun sa couleur de sens.
  //   'seconde' — le SECOND FVG seul : celui qui donne le sens du trade et qui
  //               porte le bord d'entrée. Le premier ne sert qu'à faire la
  //               pointe, et sa boîte ne fait qu'ajouter une profondeur sous un
  //               niveau déjà tracé.
  //   'trait'   — un seul segment sur le PIVOT, l'arête que les deux boîtes
  //               partagent : elles ne diffèrent que par leur profondeur sous
  //               (ou sur) ce niveau, le dessiner deux fois n'apprend rien.
  //   'extreme' — le même segment, mais sur l'autre bout de la bougie partagée :
  //               la POINTE, le plus loin où le marché est allé avant de se
  //               retourner.
  //   'nuage'   — la BANDE entre les deux, rendue en carte de chaleur : dense
  //               contre l'extrême (la butée), dissoute vers le pivot, et qui
  //               s'évapore vers la droite en vieillissant. Cf.
  //               components/charts/CloudPrimitive.js.
  // Tous prennent le sens du TRADE, donc du second motif.
  zoneStyle:  'boites',
  pivotWidth: 3,
  // Montrer ou non le trait gris de mesure et son chiffre. PUREMENT VISUEL : la
  // mesure continue d'être calculée et de FILTRER (cf. maDistMode), on cesse
  // seulement de la dessiner. Masquer un filtre ne l'éteint pas — c'est
  // `maDistMode: 'off'` qui l'éteint.
  showMaDist: true,

  // ── LE MODE FRACTAL ────────────────────────────────────────────────────────
  // Détecter la figure sur une unité de temps SUPÉRIEURE et la dessiner sur le
  // graphe courant : on voit le motif tel qu'il est en M15 — mêmes prix, même
  // extension en bougies M15, donc quinze fois plus large — sans quitter le M1.
  // C'est un ZOOM sur une figure du HTF, pas une figure du LTF.
  // AFFICHAGE SEULEMENT : les positions restent calculées sur les bougies du
  // graphe. Cf. lib/dollars/fractal.js.
  fractal:    false,
  fractalHtf: 'M15',
};

export const DOLLARS_DEFAULTS = { ...DETECT_DEFAULTS, ...POSITION_DEFAULTS, ...STYLE_DEFAULTS };

const pick = (pat, defaults) => {
  const out = {};
  for (const k of Object.keys(defaults)) out[k] = pat[k] ?? defaults[k];
  return out;
};

// Extrait les seules options de DÉTECTION d'un objet de réglages du panneau —
// qui trimballe aussi le type, la couleur, `enabled`… Passer l'objet entier au
// détecteur marcherait, mais on perdrait la garantie qu'un changement de style
// ne peut pas déplacer une zone.
export const detectOptions = (pat = {}) => pick(pat, DETECT_DEFAULTS);

// L'affichage simplifié a besoin de la détection ET d'une seule clé de style :
// l'épaisseur du trait. Elle passe par ici plutôt que d'être recopiée dans le
// graphe — c'est encore ce fichier qui reste la seule source des réglages.
export const pivotOptions = (pat = {}) => ({
  ...pick(pat, DETECT_DEFAULTS),
  pivotWidth: pat.pivotWidth ?? STYLE_DEFAULTS.pivotWidth,
  zoneStyle:  pat.zoneStyle  ?? STYLE_DEFAULTS.zoneStyle,
});

export const positionOptions = (pat = {}) => ({
  ...pick(pat, DETECT_DEFAULTS),
  ...pick(pat, POSITION_DEFAULTS),
});

export function styleOptions(pat = {}) {
  return {
    bullColor: pat.bullColor ?? STYLE_DEFAULTS.bullColor,
    bearColor: pat.bearColor ?? STYLE_DEFAULTS.bearColor,
    opacity:   pat.opacity   ?? STYLE_DEFAULTS.opacity,
    showLabel:  pat.showLabel !== false,
    showMaDist: pat.showMaDist !== false,
    zoneStyle:  pat.zoneStyle ?? STYLE_DEFAULTS.zoneStyle,
    labelText:  '$$$',
  };
}

// ── Formulaire ───────────────────────────────────────────────────────────────
// Description déclarative, rendue par <SchemaForm> (components/PatternPanel.js).
// Types : 'segmented' | 'number' | 'toggle' | 'color' | 'row' | 'divider'.
//
// PAS DE TEXTE D'EXPLICATION dans le panneau : des titres et des champs, rien
// d'autre. Ce qu'une valeur veut dire se lit dans ce fichier et dans ./detect.js
// / ./positions.js — pas au-dessus du bouton.
export const FIELDS = [
  { kind: 'segmented', key: 'direction', label: 'Paires retenues', options: [
    { value: 'bull', label: '⌃ Pointe haute' },
    { value: 'both', label: '↕ Les deux' },
    { value: 'bear', label: '⌄ Pointe basse' },
  ] },
  { kind: 'number', key: 'similarity', label: 'Similitude des zones ≥ % (0 = off)', min: 0, max: 100, step: 1 },

  { kind: 'divider', label: 'RSI avant l’impulsion' },
  { kind: 'number', key: 'rsiPeriod', label: 'Période du RSI (0 = off)', min: 0, max: 200, step: 1 },
  { kind: 'row', when: v => v.rsiPeriod > 0, fields: [
    { kind: 'number', key: 'rsiOversold',   label: 'Survente ≤',  min: 0, max: 100, step: 1 },
    { kind: 'number', key: 'rsiOverbought', label: 'Surachat ≥',  min: 0, max: 100, step: 1 },
  ] },

  { kind: 'toggle', key: 'reverseThird', label: '3e bougie du 2e FVG inversée',
    on: 'Exigée', off: 'Indifférente' },

  { kind: 'divider', label: 'Distance de la pointe à la MM' },
  { kind: 'number', key: 'maDistPeriod', label: 'MM — période (0 = off)', min: 0, max: 1000, step: 1 },
  { kind: 'segmented', when: v => v.maDistPeriod > 0, key: 'maDistMode', label: 'Filtre', options: [
    { value: 'off', label: 'Aucun' },
    { value: 'min', label: 'Minimum' },
    { value: 'max', label: 'Maximum' },
  ] },
  { kind: 'number', when: v => v.maDistPeriod > 0 && v.maDistMode === 'min',
    key: 'maDistMin', label: '|distance| ≥', min: 0, max: 1000000, step: 0.1 },
  { kind: 'number', when: v => v.maDistPeriod > 0 && v.maDistMode === 'max',
    key: 'maDistMax', label: '|distance| ≤', min: 0, max: 1000000, step: 0.1 },

  { kind: 'divider', label: 'Affichage' },

  { kind: 'select', key: 'zoneStyle', label: 'Dessin de la figure', options: [
    { value: 'boites',  label: 'Les 2 FVG — deux boîtes' },
    { value: 'seconde', label: 'Le 2e FVG — la zone jouée' },
    { value: 'trait',   label: 'Pivot — un trait' },
    { value: 'extreme', label: 'Extrême — un trait' },
    { value: 'nuage',   label: 'Nuage de liquidité — pivot ↔ extrême' },
  ] },
  { kind: 'number', key: 'pivotWidth', label: 'Épaisseur du trait (px)', min: 1, max: 12, step: 1,
    when: v => v.zoneStyle === 'trait' || v.zoneStyle === 'extreme' },

  { kind: 'toggle', when: v => v.zoneStyle === 'nuage', key: 'fractal',
    label: 'Fractal — détecter sur un HTF', on: 'Activé', off: 'Désactivé' },
  { kind: 'select', when: v => v.zoneStyle === 'nuage' && v.fractal === true,
    key: 'fractalHtf', label: 'Unité de détection', options: HTF_KEYS.map(k => ({ value: k, label: k })) },
  { kind: 'color', key: 'bullColor', label: 'Couleur haussière', tint: '#26A69A' },
  { kind: 'color', key: 'bearColor', label: 'Couleur baissière', tint: '#EF5350' },
  { kind: 'row', fields: [
    { kind: 'number', key: 'opacity', label: 'Opacité',           min: 0.05, max: 0.6, step: 0.01 },
    { kind: 'number', key: 'extLen',  label: 'Extension (barres)', min: 1,    max: 500, step: 1 },
  ] },
  { kind: 'toggle', key: 'showLabel', label: 'Labels', on: 'Affichés', off: 'Masqués' },
  { kind: 'toggle', key: 'showMaDist', label: 'Trait de distance à la MM',
    on: 'Affiché', off: 'Masqué',
    when: v => v.maDistPeriod > 0 && (v.zoneStyle === 'extreme' || v.zoneStyle === 'nuage') },
  { kind: 'segmented', key: 'display', label: 'Représentation', options: [
    { value: 'zone',     label: 'Zone' },
    { value: 'position', label: 'Position' },
    { value: 'both',     label: 'Les deux' },
  ] },

  ...positionFields(),
];

// Les champs de la position, repliés derrière la représentation : les afficher
// quand seules les zones sont dessinées ferait croire à des réglages qui ne
// pilotent rien.
function positionFields() {
  const on    = v => (v.display ?? 'zone') !== 'zone';
  const inAtr = v => on(v) && v.distUnit === 'atr';
  const inPts = v => on(v) && v.distUnit !== 'atr';

  return [
    { kind: 'divider', when: on, label: 'Entrée' },
    { kind: 'segmented', when: on, key: 'entryLevel', label: 'Niveau d’entrée', options: [
      { value: 'bord',    label: 'Bord du FVG' },
      { value: 'extreme', label: 'Trait extrême' },
    ] },
    { kind: 'segmented', when: on, key: 'distUnit', label: 'Unité des distances', options: [
      { value: 'points', label: 'Points' },
      { value: 'atr',    label: 'ATR' },
    ] },
    { kind: 'number', when: inAtr, key: 'atrPeriod', label: 'Période de l’ATR', min: 1, max: 500, step: 1 },
    { kind: 'number', when: inPts, key: 'entryMarginPts', label: 'Marge d’entrée (points, signée)',
      min: -100000, max: 100000, step: 0.1 },
    { kind: 'number', when: inAtr, key: 'entryMarginAtr', label: 'Marge d’entrée (× ATR, signée)',
      min: -50, max: 50, step: 0.05 },
    { kind: 'number', when: on, key: 'entryWaitBars', label: 'Ordre annulé après N bougies (0 = jamais)',
      min: 0, max: 5000, step: 1 },

    { kind: 'divider', when: on, label: 'Sortie' },
    { kind: 'row', when: inPts, fields: [
      { kind: 'number', key: 'slPts', label: 'SL (points)', min: 0.1, max: 100000, step: 0.1 },
      { kind: 'number', key: 'tpPts', label: 'TP (points)', min: 0.1, max: 100000, step: 0.1 },
    ] },
    { kind: 'row', when: inAtr, fields: [
      { kind: 'number', key: 'slAtr', label: 'SL (× ATR)', min: 0.05, max: 50, step: 0.05 },
      { kind: 'number', key: 'tpAtr', label: 'TP (× ATR)', min: 0.05, max: 50, step: 0.05 },
    ] },
    { kind: 'number', when: on, key: 'spreadPts', label: 'Spread (points)', min: 0, max: 100000, step: 0.01 },

    { kind: 'divider', when: on, label: 'TP dynamique 1 — position rapide' },
    { kind: 'row', when: on, fields: [
      { kind: 'number', key: 'tpFastBars', label: 'TP atteint en ≤ N bougies (0 = off)', min: 0, max: 5000, step: 1 },
      { kind: 'number', key: 'tpFastMult', label: 'TP ×',                                min: 1, max: 20,   step: 0.1 },
    ] },

    { kind: 'divider', when: on, label: 'TP dynamique 2 — position saine' },
    { kind: 'row', when: on, fields: [
      { kind: 'number', key: 'tpSaneMaPeriod', label: 'MM — période (0 = off)', min: 0, max: 500, step: 1 },
      { kind: 'number', key: 'tpSaneMult',     label: 'TP ×',                   min: 1, max: 20,  step: 0.1 },
    ] },

    { kind: 'divider', when: on, label: 'Lot' },
    // Un SELECT et non des boutons : la liste des types de lot est appelée à
    // s'allonger, et une rangée de boutons segmentés déborde au 4e.
    { kind: 'select', when: on, key: 'lotMode', label: 'Type de lot', options: [
      { value: 'fixe',        label: 'Classique — 1 lot' },
      { value: 'exponentiel', label: 'Exponentiel — ×F tous les N trades' },
      { value: 'pas',         label: 'Pas à pas — +P tous les N trades' },
    ] },
    { kind: 'row', when: v => on(v) && v.lotMode === 'exponentiel', fields: [
      { kind: 'number', key: 'lotStepTrades', label: 'Tous les N trades', min: 1, max: 10000, step: 1 },
      { kind: 'number', key: 'lotFactor',     label: 'Lot ×',             min: 1, max: 100,   step: 0.1 },
    ] },
    { kind: 'row', when: v => on(v) && v.lotMode === 'pas', fields: [
      { kind: 'number', key: 'lotStepTrades', label: 'Tous les N trades', min: 1, max: 10000, step: 1 },
      { kind: 'number', key: 'lotPlus',       label: 'Lot +',             min: 0, max: 1000,  step: 0.1 },
    ] },
    { kind: 'number', when: v => on(v) && v.lotMode !== 'fixe', key: 'lotMax',
      label: 'Lot maximum (0 = aucun)', min: 0, max: 1000000, step: 1 },

    { kind: 'divider', when: on, label: 'BE — le niveau' },
    { kind: 'number', when: inPts, key: 'beUnhealthyPts', label: 'Sortie à + N points (0 = off)',
      min: 0, max: 100000, step: 0.1 },
    { kind: 'number', when: inAtr, key: 'beUnhealthyAtr', label: 'Sortie à + N × ATR (0 = off)',
      min: 0, max: 50, step: 0.05 },
    { kind: 'number', when: on, key: 'beExistBars', label: 'BE existentiel — après N bougies (0 = off)',
      min: 0, max: 5000, step: 1 },

    { kind: 'divider', when: on, label: 'Trade unique' },
    { kind: 'toggle', when: on, key: 'uniqueTrade', label: 'Bloquer tant qu’une position est saine',
      on: 'Activé', off: 'Désactivé' },
  ];
}
