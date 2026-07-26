// Simulateur de positions rFVG — version serveur, pilotable par balayage.
//
// C'est le MÊME jeu de règles que `calcRFVGPositions` (lib/patterns.js), celui
// que le panneau du graphe affiche et que `mql5/superFVG-EA.mq5` exécute en
// live : entrée AU MARCHÉ à l'ouverture de B4, stop STRUCTUREL posé à la
// clôture de B4 sous/sur l'extrême B3-B4, TP en points, break-even à trois
// déclencheurs. Le rappel complet de la règle est dans lib/patterns.js — ne pas
// la redocumenter ici, elle divergerait.
//
// Ce module existe pour trois raisons que la fonction du graphe ne peut pas
// couvrir :
//
//   1. ZONES INJECTÉES — la détection (`calcRFVG`) est refaite à chaque appel
//      dans lib/patterns.js. Optimiser SL/TP/BE ne touche PAS la détection : on
//      détecte une fois, puis on rejoue N configurations de sortie sur les mêmes
//      zones. C'est ce qui rend une grille de 500 configurations tenable.
//
//   2. RÉSOLUTION INTRA-BOUGIE (`fills`) — la simulation du graphe travaille sur
//      les bougies du TF choisi : quand le stop ET le TP sont touchés dans la
//      même bougie, elle tranche pour le stop (pessimiste, honnête, mais c'est
//      une CONVENTION, pas une mesure). En `fills: 'm1'` la même bougie est
//      re-parcourue minute par minute : l'ordre réel est alors connu à la minute
//      près, et l'arbitraire ne subsiste que dans la minute de collision.
//      L'EA, lui, arbitre au tick — le mode bougie SOUS-ESTIME donc le résultat
//      réel, et de combien est justement ce qu'on veut mesurer (`ambiguous`).
//      `fills: 'bar'` reproduit `calcRFVGPositions` À L'IDENTIQUE (vérifié par
//      scripts/rfvg-parity.mjs) : c'est le défaut, pour que la plateforme et
//      l'optimiseur ne racontent jamais deux histoires différentes.
//
//   3. SORTIE EN TEMPS (`maxBars`) — plafond de durée de vie, absent de la
//      règle actuelle. Une position qui n'atteint ni son stop ni son TP reste
//      ouverte jusqu'au bord des données ('open') et ne compte nulle part ;
//      `maxBars > 0` la solde à la clôture de la Nième bougie ('timeout').
//      C'EST UNE ÉVOLUTION PROPOSÉE, pas la règle en production : si un réglage
//      retenu l'utilise, l'EA doit être modifié avant de le trader.
//
// Différences assumées du mode 'm1', toutes documentées ici parce qu'elles
// changent le sens d'un paramètre :
//   • le stop et le TP sont arbitrés à la MINUTE ; dans une même minute, le
//     stop l'emporte toujours (même convention que lib/backtest/engine.js) ;
//   • le break-even sur PROFIT s'arme à la minute (l'EA s'arme au tick) ; celui
//     sur DURÉE et celui sur RETOURS restent évalués à la clôture de la bougie
//     TF, parce qu'ils COMPTENT DES BOUGIES — les convertir en minutes ferait
//     dire autre chose au réglage de l'utilisateur ;
//   • les excursions (MFE/MAE) restent mesurées sur les bougies TF dans les deux
//     modes : elles alimentent les études BE / SL plafonné, qui sont des bornes
//     à la granularité bougie.

import { calcRFVG } from '../patterns';

// Défauts alignés sur PATTERN_TYPES.RFVG (components/PatternPanel.js) — les
// changer ici ferait mentir la page par rapport au graphe.
export const EXIT_DEFAULTS = {
  slMarginPts:    2,
  tpPts:          10,
  beTriggerPts:   0,
  beLevelPts:     0,
  beTouchTrigger: 0,
  beBarsTrigger:  0,
  uniqueTrade:    false,
  skipAfterTp:    0,
  maxBars:        0,
};

export const DETECT_DEFAULTS = {
  mode:         'rfvg',
  direction:    'both',
  minPts:       0,
  maPeriodFast: 15,
  maPeriodSlow: 200,
  atrPeriod:    14,
  atrMult:      1.5,
  atrMult3:     0,
  wick3:        false,
  sizeMode:     'range',
};

// Agrégation M1 → TF en conservant, pour chaque bougie TF, la plage d'indices M1
// qui la compose. Identique à lib/backtest/engine.js (mêmes seaux que le
// time_bucket de /api/bars : ancrés sur l'epoch).
export function aggregateWithRanges(m1Bars, tfSeconds) {
  const candles = [];
  const ranges  = [];

  for (let i = 0; i < m1Bars.length; i++) {
    const bar    = m1Bars[i];
    const bucket = Math.floor(bar.time / tfSeconds) * tfSeconds;
    const last   = candles[candles.length - 1];

    if (!last || last.time !== bucket) {
      candles.push({
        time:   bucket,
        open:   bar.open,
        high:   bar.high,
        low:    bar.low,
        close:  bar.close,
        volume: bar.volume ?? 0,
      });
      ranges.push([i, i]);
    } else {
      if (bar.high > last.high) last.high = bar.high;
      if (bar.low  < last.low)  last.low  = bar.low;
      last.close   = bar.close;
      last.volume += bar.volume ?? 0;
      ranges[ranges.length - 1][1] = i;
    }
  }

  return { candles, ranges };
}

// Détection seule — à appeler UNE fois, puis à réinjecter dans chaque simulation.
export function detectZones(candles, detect = {}) {
  return calcRFVG(candles, { ...DETECT_DEFAULTS, ...detect });
}

// zones : sortie de detectZones (ou de calcRFVG). candles : bougies du TF.
// m1 : { bars, ranges } — requis seulement en fills: 'm1'.
export function simulatePositions(candles, zones, opts = {}) {
  const p = { ...EXIT_DEFAULTS, ...opts };
  const { slMarginPts, tpPts, beTriggerPts, beLevelPts,
          beTouchTrigger, beBarsTrigger, uniqueTrade, skipAfterTp, maxBars } = p;

  const trades = [];
  trades.skippedByCooldown = 0;
  trades.skippedWon        = 0;
  trades.ambiguous         = 0;   // sorties où stop ET TP étaient dans la bougie
  if (!(tpPts > 0)) return trades;

  const useM1  = opts.fills === 'm1' && opts.m1?.bars?.length && opts.m1?.ranges?.length;
  const m1Bars = useM1 ? opts.m1.bars   : null;
  const m1Rng  = useM1 ? opts.m1.ranges : null;

  const n = candles.length;
  let lastExitIdx = -1;
  let cooldown = 0, armExit = -1, skipped = 0, skippedWon = 0, ambiguous = 0;
  let id = 1;

  for (const z of zones) {
    if (z.entryIdx == null) continue;
    if (uniqueTrade && z.entryIdx <= lastExitIdx) continue;

    const isBuy = z.side === 'bull';
    const b4Idx = z.entryIdx;
    const b3    = candles[b4Idx - 1];
    const b4    = candles[b4Idx];
    const entry = z.entryPrice;

    const tp = isBuy ? entry + tpPts : entry - tpPts;
    const sl = isBuy ? Math.min(b3.low,  b4.low)  - slMarginPts
                     : Math.max(b3.high, b4.high) + slMarginPts;
    const risk0 = Math.abs(entry - sl);
    if (!(risk0 > 0)) continue;

    const beProfit = beTriggerPts   > 0;
    const beTouch  = beTouchTrigger > 0;
    const beBars   = beBarsTrigger  > 0;
    const beOn     = beProfit || beTouch || beBars;
    const beStop   = isBuy ? Math.max(entry + beLevelPts, sl) : Math.min(entry - beLevelPts, sl);
    const tpTouch  = isBuy ? entry + risk0 : entry - risk0;

    let slMoved = false, tpMoved = false, beTime = null, beReason = null;
    let touchCount = 0;

    // Un stop traversé en gap est rempli au pire du niveau et de l'ouverture —
    // jamais mieux que le marché.
    const stopFill = (stop, k) => isBuy ? Math.min(stop, k.open) : Math.max(stop, k.open);
    const hitStop  = (k, stop) => isBuy ? k.low  <= stop : k.high >= stop;
    const hitTp    = (k, lvl)  => isBuy ? k.high >= lvl  : k.low  <= lvl;
    const favOf    = k         => isBuy ? k.high - entry : entry - k.low;

    let exitIdx = null, exitPrice = null, exitReason = null, ambiguousExit = false;

    // — B4 : position non protégée, seul le TP peut la résoudre.
    if (hitTp(b4, tp)) {
      exitIdx = b4Idx; exitPrice = tp; exitReason = 'tp';
    } else if (beProfit && favOf(b4) >= beTriggerPts) {
      slMoved = true; beTime = b4.time; beReason = 'profit';
    }

    // — B5 et au-delà.
    if (exitIdx == null) {
      for (let j = b4Idx + 1; j < n && exitIdx == null; j++) {
        const bar = candles[j];

        // Sous-bougies : les M1 de la bougie TF, ou la bougie TF elle-même.
        const [s, e] = useM1 ? m1Rng[j] : [0, 0];
        const subN   = useM1 ? e - s + 1 : 1;

        for (let q = 0; q < subN; q++) {
          const k    = useM1 ? m1Bars[s + q] : bar;
          const stop = slMoved ? beStop  : sl;
          const tpT  = tpMoved ? tpTouch : tp;

          // Stop d'abord (pessimiste, dans la minute comme dans la bougie).
          if (hitStop(k, stop)) {
            if (hitTp(k, tpT)) { ambiguousExit = true; }
            exitIdx = j; exitPrice = stopFill(stop, k);
            exitReason = slMoved ? 'be' : 'sl';
            break;
          }
          if (hitTp(k, tpT)) { exitIdx = j; exitPrice = tpT; exitReason = 'tp'; break; }

          // BE sur PROFIT — armé à la granularité de la sous-bougie.
          if (beProfit && !slMoved && favOf(k) >= beTriggerPts) {
            slMoved = true; beTime ??= k.time; beReason ??= 'profit';
            if (hitStop(k, beStop)) {
              exitIdx = j; exitPrice = stopFill(beStop, k); exitReason = 'be'; break;
            }
          }
        }
        if (exitIdx != null) break;

        // — Fin de bougie TF : les déclencheurs qui COMPTENT DES BOUGIES.
        if (beOn) {
          if (bar.low <= entry && bar.high >= entry) touchCount++;

          if (!slMoved && beBars && j - b4Idx >= beBarsTrigger) {
            slMoved = true; beTime ??= bar.time; beReason ??= 'bars';
            if (hitStop(bar, beStop)) {
              exitIdx = j; exitPrice = stopFill(beStop, bar); exitReason = 'be'; break;
            }
          }

          if (!tpMoved && beTouch && touchCount >= beTouchTrigger) {
            tpMoved = true; beTime ??= bar.time; beReason ??= 'touch';
            if (hitTp(bar, tpTouch)) {
              exitIdx = j; exitPrice = tpTouch; exitReason = 'tp'; break;
            }
          }
        }

        // — Plafond de durée (évolution, hors règle EA).
        if (maxBars > 0 && j - b4Idx >= maxBars) {
          exitIdx = j; exitPrice = bar.close; exitReason = 'timeout'; break;
        }
      }

      if (exitIdx == null) {
        exitIdx    = n - 1;
        exitPrice  = candles[n - 1].close;
        exitReason = 'open';
      }
    }

    const isWin = exitReason === 'tp';

    // Cooldown après un gain — le signal sauté est simulé à blanc, jamais listé.
    if (cooldown > 0 && z.entryIdx > armExit) {
      cooldown -= 1;
      if (isWin) { cooldown = skipAfterTp; armExit = exitIdx; skippedWon++; }
      lastExitIdx = exitIdx;
      skipped++;
      continue;
    }

    if (ambiguousExit) ambiguous++;

    // Excursions — bougies TF dans les deux modes (cf. bloc de tête).
    let maxPullupPts = 0, maxDrawdownPts = 0, maeArmed = 0, entryTouches = 0;
    const mfeLast = exitReason === 'sl' || exitReason === 'be' ? exitIdx - 1 : exitIdx;
    for (let j = b4Idx; j <= exitIdx; j++) {
      const k   = candles[j];
      const fav = isBuy ? k.high - entry : entry - k.low;
      const adv = isBuy ? entry - k.low  : k.high - entry;
      if (j <= mfeLast && fav > maxPullupPts) maxPullupPts = fav;
      if (adv > maxDrawdownPts) maxDrawdownPts = adv;
      if (j > b4Idx) {
        if (adv > maeArmed) maeArmed = adv;
        if (k.low <= entry && k.high >= entry) entryTouches++;
      }
    }
    maxPullupPts   = Math.min(Math.max(0, maxPullupPts),   tpPts);
    maxDrawdownPts = Math.min(Math.max(0, maxDrawdownPts), risk0);
    const maeArmedPts = exitIdx > b4Idx ? Math.min(Math.max(0, maeArmed), risk0) : null;

    trades.push({
      id:           id++,
      direction:    isBuy ? 'BUY' : 'SELL',
      label:        z.label,
      entryTime:    z.entryTime,
      entryPrice:   entry,
      exitTime:     candles[exitIdx].time,
      exitPrice,
      sl:           slMoved ? beStop : sl,
      sl0:          sl,
      tp:           tpMoved ? tpTouch : tp,
      tp0:          tp,
      beActivated:  slMoved || tpMoved,
      beReason,
      beTime,
      tpReduced:    tpMoved,
      risk0,
      profitPoints: isBuy ? exitPrice - entry : entry - exitPrice,
      exitReason,
      status:       exitReason,
      barsHeld:     exitIdx - b4Idx,
      entryTouches,
      maxPullupPts,
      maxDrawdownPts,
      maeArmedPts,
    });
    lastExitIdx = exitIdx;

    if (skipAfterTp > 0 && isWin) { cooldown = skipAfterTp; armExit = exitIdx; }
  }

  trades.skippedByCooldown = skipped;
  trades.skippedWon        = skippedWon;
  trades.ambiguous         = ambiguous;
  return trades;
}
