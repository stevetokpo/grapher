// rev — la pause, puis le retournement en deux impulsions.
//
// LA FIGURE, en trois bougies CONSÉCUTIVES :
//
//     pause · impulsion A · impulsion B          (A et B de sens OPPOSÉS)
//
//   • la PAUSE — une bougie qui ne va nulle part : corps <= `atrMult3` × ATR ;
//   • les deux IMPULSIONS — corps >= `atrMult` × ATR chacune, et de sens
//     contraires l'une de l'autre. C'est le CORPS qui est mesuré, pas
//     l'amplitude (`sizeMode` reste réglable, mais le motif a été défini au
//     corps).
//
// LE SENS est celui de la SECONDE impulsion, celle qui retourne le marché :
//     haussière puis baissière → VENTE
//     baissière puis haussière → ACHAT
//
// PARENTÉ AVEC liq, et différence. Les deux cherchent un retournement en deux
// impulsions opposées, et partagent la gestion des positions
// (lib/patternPositions.js) ainsi que les prédicats de bougie
// (lib/candleRules.js). Mais liq place sa respiration ENTRE les deux impulsions,
// et en autorise plusieurs ; ici elle est AVANT, et il y en a exactement une. Les
// deux impulsions y sont donc collées, dos à dos.
//
// LE MARQUAGE. Le niveau est pris sur la ou les bougies de PAUSE, du côté que le
// retournement va chercher :
//     ACHAT  (2e impulsion haussière) → le PLUS BAS de la pause
//     VENTE  (2e impulsion baissière) → le PLUS HAUT de la pause
// C'est l'inverse de liq, où le niveau se prend du côté vers lequel on part. Ici
// on marque le prix d'où le mouvement est venu — celui que l'entrée « retour dans
// la zone » attend de revoir.
//
// Chaque figure : { side, state: 'active', label: 'rev', idx, level, top, bottom,
//                   startTime, endTime, fromIdx, toIdx, breathCount }
//   top/bottom — la bande, haute de `zonePts` POINTS de prix, CENTRÉE sur le
//                niveau. C'est elle qu'on dessine, et dans elle que le prix doit
//                revenir en mode d'entrée « zone ».
//   fromIdx/toIdx — la pause et la seconde impulsion : les bornes du motif, sur
//                lesquelles s'appuie le stop structurel.

import { atrArr } from '../patterns';
import {
  impulseIsLarge, breathIsSmall,
  usesImpulseSize, usesBreathSize,
} from '../candleRules';
import { DETECT_DEFAULTS } from './params';

export function calcRev(candles, opts = {}) {
  const p = { ...DETECT_DEFAULTS, ...opts };
  const out = [];
  const n = candles?.length ?? 0;
  if (n < 4) return out;

  const useSize  = usesImpulseSize(p);
  const usePause = usesBreathSize(p);
  const atr = (useSize || usePause) ? atrArr(candles, p.atrPeriod) : null;

  // Une impulsion ? Rend son sens, ou null. L'ATR est lu sur la bougie qui la
  // précède — la juger avec un ATR qui la contient reviendrait à la comparer à
  // elle-même.
  const impulse = k => {
    const m = candles[k];
    const dir = m.close > m.open ? 'bull' : m.close < m.open ? 'bear' : null;
    if (!dir) return null;
    if (useSize && !impulseIsLarge({ atr, i: k, m }, p)) return null;
    return dir;
  };

  // Une pause ? Le corps seul compte : ce qu'on veut, c'est une bougie qui
  // n'avance pas. `isBull` n'est pas utilisé ici (aucune mèche de rejet exigée),
  // mais le prédicat partagé garde la même signature partout.
  const pause = k => !usePause || breathIsSmall({ atr, i: k - 1, c: candles[k] }, p);

  for (let i = 1; i < n - 2; i++) {
    if (!pause(i)) continue;

    const dirA = impulse(i + 1);
    if (!dirA) continue;
    const dirB = impulse(i + 2);
    if (!dirB || dirB === dirA) continue;      // il FAUT deux sens opposés

    if (p.direction !== 'both' && p.direction !== dirB) continue;

    // Le niveau, sur la pause, du côté d'où le mouvement est venu.
    const isBuy = dirB === 'bull';
    let level = isBuy ? Infinity : -Infinity;
    for (let j = i; j <= i; j++) {
      level = isBuy ? Math.min(level, candles[j].low)
                    : Math.max(level, candles[j].high);
    }

    // La bande, centrée sur le niveau : `zonePts` points au total, moitié de
    // chaque côté. Une seule définition, partagée par le dessin et par l'entrée.
    const half = p.zonePts / 2;

    // La bande couvre la figure puis se prolonge de `extBars` barres : un niveau
    // se regarde dans ce qui vient APRÈS.
    const endIdx = Math.min(i + 3 + p.extBars, n - 1);

    out.push({
      side:        dirB,
      state:       'active',
      label:       'rev',
      idx:         i + 2,
      level,
      top:         level + half,
      bottom:      level - half,
      startTime:   candles[i].time,
      endTime:     candles[endIdx].time,
      fromIdx:     i,
      toIdx:       i + 2,
      breathCount: 1,
    });
  }

  return out;
}
