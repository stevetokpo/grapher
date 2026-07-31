// liq — la prise de position.
//
// Le motif détecte ; la gestion, elle, est commune à toute la famille des motifs
// à stop structurel connu d'avance et vit dans lib/patternPositions.js. Ce
// fichier n'est plus qu'un raccord : il détecte, puis délègue. C'est ce qui
// permet de comparer deux motifs sans se demander si l'écart vient de la sortie.
//
// Les RÈGLES (entrée en zone ou au marché, stop sur tout le motif, TP en RR,
// break-even en R, trade unique, repos après gain) sont documentées là-bas.

import { calcLiq } from './detect';
import { DETECT_DEFAULTS, POSITION_DEFAULTS } from './params';
import { simulatePatternPositions } from '../patternPositions';

export function calcLiqPositions(candles, opts = {}) {
  const p = { ...DETECT_DEFAULTS, ...POSITION_DEFAULTS, ...opts };
  return simulatePatternPositions(candles, calcLiq(candles, p), p, 'liq');
}
