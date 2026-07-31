// Schéma de DÉTECTION du motif KO — génère le formulaire de la page /ko ET
// valide les entrées des API. Les bornes ne sont pas décoratives : une valeur
// hors bornes est ramenée dans la plage et SIGNALÉE (`clamped`), jamais
// remplacée en silence — sinon on optimise autre chose que ce qu'on croit tester.
//
// Les SORTIES (marge du stop, TP, break-even, durée) ne sont pas ici : elles sont
// communes à tous les motifs et vivent dans lib/signals/params.js. Le KO est donc
// mesuré avec exactement la même règle de gestion que le rFVG, et un écart entre
// les deux ne peut pas venir de la sortie.
//
// CE QUI CHANGE PAR RAPPORT AU rFVG — ici la détection PEUT être balayée. Les
// seuils du KO (1,3 × ATR, 90 %, 0,3 × ATR, 30 %) sont neufs : personne ne sait
// encore s'ils sont au bon endroit, et figer un motif qu'on n'a jamais mesuré,
// c'est optimiser autour d'une supposition. Le prix à payer est explicite :
// chaque paramètre balayé consomme du BUDGET DE LIBERTÉ (~30 positions par
// paramètre réglé, compté et affiché par /api/ko/optimize), et un réglage de
// détection retenu doit passer le contrôle par décalage circulaire
// (/api/ko/null) avant d'avoir le droit de compter pour quelque chose.

export { EXIT_SCHEMA, defaultsOf, sanitize, expandValues, buildGrid, cartesian } from '../signals/params';

export const DETECT_SCHEMA = [
  { key: 'direction',    label: 'Direction',        type: 'select', def: 'both', options: ['both', 'bull', 'bear'],
    hint: 'KO haussier = impulsion haussière SOUS les deux MM ; baissier = impulsion baissière AU-DESSUS' },
  { key: 'maPeriodFast', label: 'MM rapide',        type: 'int', def: 15,  min: 2, max: 400 },
  { key: 'maPeriodSlow', label: 'MM lente',         type: 'int', def: 200, min: 2, max: 400,
    hint: 'B1 doit être entièrement du bon côté des DEUX MM à la fois, mèches comprises' },
  { key: 'atrPeriod',    label: 'ATR — période',    type: 'int', def: 14, min: 1, max: 100,
    hint: 'ATR de Wilder, lu AVANT B1 — une seule référence pour les deux bougies' },
  { key: 'atrMult1',     label: 'Corps B1 ≥ ATR ×', type: 'float', def: 1.3, min: 0, max: 10, step: 0.1,
    hint: "la bougie d'impulsion est grosse dans l'absolu. 0 = filtre désactivé" },
  { key: 'bodyRatio1',   label: 'Corps/amplitude B1 ≥', type: 'float', def: 0.9, min: 0, max: 1, step: 0.05,
    hint: 'elle est PLEINE : 0,9 = au plus 10 % de mèche. 0 = filtre désactivé' },
  { key: 'atrMult2',     label: 'Corps B2 ≤ ATR ×', type: 'float', def: 0.3, min: 0, max: 10, step: 0.05,
    hint: 'la respiration est petite dans l’absolu, quel que soit son sens. 0 = filtre désactivé' },
  { key: 'bodyRatio2',   label: 'Corps/amplitude B2 ≤', type: 'float', def: 0.3, min: 0, max: 1, step: 0.05,
    hint: 'elle est INDÉCISE : surtout de la mèche. 1 = filtre désactivé' },
];

// Paramètres de détection que l'optimiseur accepte de balayer. La direction en
// est exclue à dessein : ce n'est pas un réglage, c'est une question séparée
// (« le motif marche-t-il des deux côtés ? »), et la balayer reviendrait à
// choisir son camp sur le bruit de l'in-sample.
export const SWEEPABLE_DETECT = DETECT_SCHEMA.filter(s => s.key !== 'direction');
