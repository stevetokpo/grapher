// Détection rFVG côté serveur + branchement sur le moteur de sorties commun.
//
// LE MOTEUR EST DANS lib/signals/engine.js — il est partagé avec les autres
// motifs à stop structurel (KO…), et c'est lui qui documente la règle complète :
// entrée AU MARCHÉ à l'ouverture de la bougie qui suit le motif, stop STRUCTUREL
// posé à sa clôture sous/sur l'extrême des deux dernières bougies, TP en points,
// break-even à quatre déclencheurs. Ne pas la redocumenter ici, elle divergerait.
//
// Ce fichier ne garde que ce qui est propre au rFVG : ses défauts de détection et
// l'appel à `calcRFVG`. Les zones sont détectées UNE fois puis réinjectées dans
// chaque simulation — c'est ce qui rend une grille de 500 configurations tenable.
//
// PARITÉ AVEC LE GRAPHE — `simulatePositions(fills: 'bar')` reproduit
// `calcRFVGPositions` (lib/patterns.js) à l'identique, vérifié par
// scripts/rfvg-parity.mjs. Cette duplication est historique : les motifs plus
// récents (KO) appellent le même moteur des deux côtés et n'ont donc rien à
// vérifier.

import { calcRFVG } from '../patterns';

export { EXIT_DEFAULTS, aggregateWithRanges, simulatePositions } from '../signals/engine';

// Défauts alignés sur PATTERN_TYPES.RFVG (components/PatternPanel.js) — les
// changer ici ferait mentir la page par rapport au graphe.
export const DETECT_DEFAULTS = {
  mode:         'rfvg',
  direction:    'both',
  minPts:       0,
  maPeriodFast: 15,
  maPeriodSlow: 200,
  slowOpenOnly: false,
  atrPeriod:    14,
  atrMult:      1.5,
  atrMult3:     0,
  wick3:        false,
  sizeMode:     'range',
};

// Détection seule — à appeler UNE fois, puis à réinjecter dans chaque simulation.
export function detectZones(candles, detect = {}) {
  return calcRFVG(candles, { ...DETECT_DEFAULTS, ...detect });
}

// Descripteur de motif, tel que l'attend lib/signals/data.js.
export const RFVG_PATTERN = {
  name:     'rfvg',
  detect:   calcRFVG,
  defaults: DETECT_DEFAULTS,
};
