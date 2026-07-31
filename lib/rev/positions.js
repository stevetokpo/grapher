// rev — la prise de position.
//
// Le motif détecte ; la gestion est celle, commune, de lib/patternPositions.js —
// la même que celle du liq, au réglage près. C'est voulu : deux motifs de la même
// famille doivent être mesurés par le même code, sinon un écart de résultat ne
// dit plus si la détection ou la sortie en est responsable.

import { calcRev } from './detect';
import { DETECT_DEFAULTS, POSITION_DEFAULTS } from './params';
import { simulatePatternPositions } from '../patternPositions';

export function calcRevPositions(candles, opts = {}) {
  const p = { ...DETECT_DEFAULTS, ...POSITION_DEFAULTS, ...opts };
  return simulatePatternPositions(candles, calcRev(candles, p), p, 'rev');
}
