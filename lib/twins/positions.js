// Twins Bars — la prise de position.
//
// Le motif détecte ; la gestion est celle, commune, de lib/patternPositions.js —
// la même que celle du liq et du rev. C'est voulu : trois motifs de la même
// famille doivent être mesurés par le même code, sinon un écart de résultat ne
// dit plus si la détection ou la sortie en est responsable.
//
// LA SEULE DIFFÉRENCE : l'entrée est AU MARCHÉ, toujours. Le liq et le rev
// tracent une bande de prix et peuvent y poser un ordre en attente ; Twins Bars
// n'a pas de zone — il désigne une bougie, pas un prix où revenir. `entryMode`
// est donc réimposé ici, quoi qu'en dise un réglage enregistré : il n'existe
// aucune bande où un ordre pourrait attendre, et le laisser passer à 'zone'
// ferait chercher au simulateur un `top`/`bottom` que la détection ne fournit
// pas. Conséquence : aucun signal 'missed', une position par motif.

import { calcTwinsBars } from './detect';
import { DETECT_DEFAULTS, POSITION_DEFAULTS } from './params';
import { simulatePatternPositions } from '../patternPositions';

export function calcTwinsPositions(candles, opts = {}) {
  const p = { ...DETECT_DEFAULTS, ...POSITION_DEFAULTS, ...opts, entryMode: 'market' };
  return simulatePatternPositions(candles, calcTwinsBars(candles, p), p, 'TB');
}
