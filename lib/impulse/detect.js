// impulse — une VAGUE encadrée : N bougies du même sens à la file.
//
// LA FIGURE. Rien d'autre qu'une succession : au moins `count` bougies toutes
// haussières (ou toutes baissières) collées les unes aux autres. Une seule
// bougie de sens contraire y met fin. C'est le motif le plus nu de la
// plateforme — pas de moyenne, pas de gap, pas de swing.
//
// LA BOÎTE, et c'est là que tout se joue. Elle ne colle pas à la vague :
//
//        ┌───────────────────────────────┐
//        │            ▁ ▂ █ █ █          │   ← la vague : 5 bougies haussières
//        │  ← back →                     │
//        └───────────────────────────────┘
//        ↑                             ↑
//    1re bougie − `back`          dernière bougie de la vague
//
//   • à DROITE elle s'arrête à la dernière bougie de la vague (+ `fwd` si on
//     veut la faire durer) ;
//   • à GAUCHE elle remonte `back` périodes AVANT la première bougie — c'est ce
//     prolongement en arrière qui fait la zone : la boîte couvre le prix que
//     l'impulsion vient de quitter, pas seulement celui qu'elle a traversé ;
//   • en HAUTEUR, la 1re et la dernière bougie de la vague (cf. `heightMode`).
//     Les mèches des bougies du MILIEU peuvent donc sortir de la boîte : c'est
//     la définition du motif, pas un défaut du dessin.
//
// LA VAGUE RETENUE EST LA PLUS LONGUE. Une suite de 7 bougies avec `count` à 4
// donne UNE boîte de 7, pas quatre boîtes qui se chevauchent : on ne coupe pas
// un mouvement en tranches pour en tirer plusieurs figures.
//
// CE QUI N'Y EST PAS : aucune position. Le motif encadre, il ne dit pas quel
// prix jouer — tant que ça n'a pas été posé, l'inventer ici serait inventer le
// motif à la place de celui qui l'écrit.
//
// Chaque figure porte la forme de zone de la famille FVG ({ side, state, top,
// bottom, startTime, endTime }), plus ce qui lui est propre :
//   side       — le sens de la vague ('bull' | 'bear')
//   fromIdx    — la 1re bougie de la VAGUE (pas le bord gauche de la boîte)
//   toIdx      — la dernière bougie de la vague, et le bord droit de la boîte
//   idx        — le même : la figure n'est connue qu'à la fin de la vague
//   leftIdx    — le bord gauche réel, soit fromIdx − back, borné aux données
//   count      — le nombre de bougies de la vague (≥ le réglage)
//   height     — la hauteur de la boîte, celle qu'ont jugée les filtres

import { atrArr } from '../patterns';
import { DETECT_DEFAULTS } from './params';

const dirOf = c => (c.close > c.open ? 'bull' : c.close < c.open ? 'bear' : null);

export function calcImpulse(candles, opts = {}) {
  const p = { ...DETECT_DEFAULTS, ...opts };
  const out = [];
  const n = candles?.length ?? 0;

  // Sans deux bougies, il n'y a pas de suite.
  const minCount = Math.max(2, Math.round(p.count ?? DETECT_DEFAULTS.count));
  const maxCount = Math.max(0, Math.round(p.maxCount ?? 0));
  const back     = Math.max(0, Math.round(p.back ?? 0));
  const fwd      = Math.max(0, Math.round(p.fwd  ?? 0));

  const useAtr = p.atrMult > 0 && p.atrPeriod >= 1;
  const atr    = useAtr ? atrArr(candles, p.atrPeriod) : null;

  // Corps plein : chaque bougie de la vague doit tenir le ratio. Une bougie
  // d'amplitude nulle n'a pas de corps à mesurer — elle échoue dès que le
  // réglage est allumé.
  const bodyOk = c => {
    if (!(p.bodyRatio > 0)) return true;
    const range = c.high - c.low;
    if (!(range > 0)) return false;
    return Math.abs(c.close - c.open) >= p.bodyRatio * range;
  };

  // Une vague est close : on la juge, et si elle passe on la dessine.
  const flush = (side, startIdx, endIdx, cnt) => {
    if (cnt < minCount) return;
    if (maxCount > 0 && cnt > maxCount) return;
    if (p.direction !== 'both' && p.direction !== side) return;

    const first = candles[startIdx];
    const last  = candles[endIdx];

    // ── La hauteur ─────────────────────────────────────────────────────────
    let top, bottom;
    if (p.heightMode === 'bodies') {
      // Le corps du mouvement : de l'ouverture de la 1re à la clôture de la
      // dernière. Les mèches des deux bouts restent dehors.
      top    = Math.max(first.open, last.close);
      bottom = Math.min(first.open, last.close);
    } else if (p.heightMode === 'wave') {
      // Tout ce que la vague a touché — plus rien ne dépasse de la boîte.
      top = -Infinity; bottom = Infinity;
      for (let k = startIdx; k <= endIdx; k++) {
        if (candles[k].high > top)    top    = candles[k].high;
        if (candles[k].low  < bottom) bottom = candles[k].low;
      }
    } else {
      // 'ends' — la 1re et la dernière bougie, mèches comprises. C'est la
      // définition du motif : les bougies du milieu ne sont pas consultées.
      top    = Math.max(first.high, last.high);
      bottom = Math.min(first.low,  last.low);
    }

    const height = top - bottom;
    if (!(height > 0)) return;

    // ── La force ───────────────────────────────────────────────────────────
    if (p.minPts > 0 && height < p.minPts) return;
    if (useAtr) {
      // L'ATR est lu AVANT la vague : le lire dedans reviendrait à mesurer
      // l'impulsion avec elle-même. Tant qu'il n'est pas calculable, la vague
      // est écartée — on ne devine pas la volatilité d'avant.
      const a = startIdx > 0 ? atr[startIdx - 1] : null;
      if (a == null || height < p.atrMult * a) return;
    }

    // ── La boîte ───────────────────────────────────────────────────────────
    const leftIdx  = Math.max(0, startIdx - back);
    const rightIdx = Math.min(n - 1, endIdx + fwd);

    out.push({
      side,
      state:     'active',
      label:     'impulse',
      top,
      bottom,
      startTime: candles[leftIdx].time,
      endTime:   candles[rightIdx].time,
      idx:       endIdx,
      fromIdx:   startIdx,
      toIdx:     endIdx,
      leftIdx,
      count:     cnt,
      height,
    });
  };

  // ── Le balayage ────────────────────────────────────────────────────────────
  // Une seule passe. On tient la vague en cours (son sens, sa première et sa
  // dernière bougie, son compte) et on la ferme dès qu'elle est rompue — c'est
  // ce qui garantit qu'on ne sort que des vagues MAXIMALES.
  let side = null, startIdx = -1, endIdx = -1, cnt = 0;

  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const d = dirOf(c);

    if (d === null) {
      // Un doji. Il rompt la vague, ou la laisse passer sans y entrer — mais il
      // ne compte jamais comme bougie de la vague, et `endIdx` reste donc sur la
      // dernière vraie bougie.
      if (p.dojiBreaks !== false) {
        flush(side, startIdx, endIdx, cnt);
        side = null; cnt = 0;
      }
      continue;
    }

    if (!bodyOk(c)) {
      // Une bougie trop creuse ne pousse rien : elle ferme la vague et n'en
      // ouvre pas d'autre.
      flush(side, startIdx, endIdx, cnt);
      side = null; cnt = 0;
      continue;
    }

    if (d === side) {
      endIdx = i; cnt++;
    } else {
      flush(side, startIdx, endIdx, cnt);
      side = d; startIdx = i; endIdx = i; cnt = 1;
    }
  }

  flush(side, startIdx, endIdx, cnt);   // la vague encore ouverte sur la dernière bougie

  return out;
}
