// Moteur de backtest.
//
// Principes d'exécution (voir docs/backtesting.md pour le détail) :
//   • La stratégie décide à la CLÔTURE de la bougie i (timeframe choisi) ;
//     l'ordre est exécuté à l'OUVERTURE de la bougie i+1 → aucun lookahead.
//   • Les SL/TP sont vérifiés bougie M1 par bougie M1 À L'INTÉRIEUR de chaque
//     bougie TF : l'ordre chronologique intra-bougie est donc résolu à la
//     minute près, pas deviné sur l'OHLC agrégé.
//   • Règle conservatrice (identique à useTrades du replay) : si SL et TP sont
//     tous deux touchés dans la MÊME bougie M1, le SL gagne.
//   • Une seule position à la fois. Un signal opposé pendant qu'une position
//     est ouverte ferme puis retourne la position (flip) à l'open suivant.
//   • Le spread est un coût fixe en points déduit une fois par trade.
//
// Contrat de stratégie (voir lib/backtest/strategies/) :
//   {
//     id, label, desc,
//     params: [{ key, label, type, def, ... }],       // schéma → formulaire UI
//     setup(candles, params)  → objet d'indicateurs précalculés (optionnel)
//     onBar({ candles, i, ind, position, params, lastTrade })  // à chaque clôture
//       → null                                          rien à faire
//       → { action: 'buy'|'sell', sl?, tp?, reason? }   entrée marché (ou flip)
//       → { action: 'close', reason? }                  sortie au prochain open
//       → { action: 'modify', sl?, tp? }                met à jour les stops de la
//                                                       position ouverte (break-even…)
//       → { action: 'buyStop'|'sellStop', price, sl?, tp?, reason? }
//             ordre stop d'entrée, actif pendant LA bougie suivante uniquement —
//             le ré-émettre à chaque clôture tant qu'il doit rester armé.
//
//   Les entrées acceptent des stops absolus (sl/tp) ou RELATIFS au prix d'entrée
//   réellement obtenu : slPoints/tpPoints (équivalent Pine strategy.exit
//   loss/profit — utile car l'entrée se fait à l'open suivant, pas au close du
//   signal). lastTrade = dernier trade fermé (détection de sortie SL, etc.).

import { TF_SECONDS } from '../replayUtils';

// Agrège les bougies M1 vers le TF cible en gardant, pour chaque bougie TF,
// la plage d'indices M1 [m1Start, m1End] qui la compose (pour les fills intra-bougie).
export function aggregateWithRanges(m1Bars, tf) {
  const sec = TF_SECONDS[tf] ?? 60;
  const candles = [];
  const ranges  = [];

  for (let i = 0; i < m1Bars.length; i++) {
    const bar    = m1Bars[i];
    const bucket = Math.floor(bar.time / sec) * sec;
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

// SL prioritaire si les deux niveaux sont touchés dans la même bougie M1.
function checkStops(m1, position) {
  const { direction, sl, tp } = position;
  if (direction === 'BUY') {
    if (sl != null && m1.low  <= sl) return 'sl';
    if (tp != null && m1.high >= tp) return 'tp';
  } else {
    if (sl != null && m1.high >= sl) return 'sl';
    if (tp != null && m1.low  <= tp) return 'tp';
  }
  return null;
}

export function runBacktest({ m1Bars, tf, strategy, params, execution = {} }) {
  const spreadPoints = Number(execution.spreadPoints) || 0;
  // Sortie forcée après N bougies TF en position (0 = désactivé)
  const maxBarsInTrade = Number(execution.maxBarsInTrade) || 0;

  const { candles, ranges } = aggregateWithRanges(m1Bars, tf);
  const ind = strategy.setup ? strategy.setup(candles, params) : {};

  const trades = [];
  let position      = null;
  let pendingMarket = null; // ordre au marché — exécuté à l'open de la bougie suivante
  let pendingStop   = null; // ordre stop d'entrée — actif pendant une bougie
  let nextId        = 1;

  const closePosition = (exitPriceRaw, exitTime, exitIndex, exitReason) => {
    const raw = position.direction === 'BUY'
      ? exitPriceRaw - position.entryPrice
      : position.entryPrice - exitPriceRaw;
    const profitPoints = raw - spreadPoints;
    // Risque INITIAL (distance entrée→SL à l'ouverture) — un SL déplacé ensuite
    // (break-even…) ne change pas la définition du R du trade.
    const risk = position.risk0;
    trades.push({
      id:          position.id,
      direction:   position.direction,
      entryTime:   position.entryTime,
      entryPrice:  position.entryPrice,
      exitTime,
      exitPrice:   exitPriceRaw,
      sl:          position.sl,
      tp:          position.tp,
      exitReason,                      // 'tp' | 'sl' | 'signal' | 'timeout' | 'end'
      result:      profitPoints > 0 ? 'win' : 'loss',
      profitPoints,
      profitR:     risk > 0 ? profitPoints / risk : null,
      bars:        exitIndex - position.entryIndex,
      durationMin: Math.round((exitTime - position.entryTime) / 60),
      reason:      position.reason,
    });
    position = null;
  };

  // sl/tp absolus, ou relatifs au prix d'entrée réel via slPoints/tpPoints
  // (équivalent Pine strategy.exit loss/profit)
  const resolveStops = (order, direction, entryPrice) => {
    const sign = direction === 'BUY' ? 1 : -1;
    return {
      sl: order.sl ?? (order.slPoints > 0 ? entryPrice - sign * order.slPoints : null),
      tp: order.tp ?? (order.tpPoints > 0 ? entryPrice + sign * order.tpPoints : null),
    };
  };

  const openPosition = (order, direction, entryPrice, entryTime, entryIndex) => {
    const { sl, tp } = resolveStops(order, direction, entryPrice);
    position = {
      id: nextId++,
      direction, entryPrice, entryTime, entryIndex,
      sl, tp,
      risk0: sl != null ? Math.abs(entryPrice - sl) : 0,
      reason: order.reason ?? null,
    };
  };

  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i];

    // 1) Exécuter l'ordre au marché décidé à la clôture précédente, à l'open
    if (pendingMarket) {
      const { action } = pendingMarket;
      if (action === 'close' && position) {
        closePosition(bar.open, bar.time, i, 'signal');
      } else if (action === 'buy' || action === 'sell') {
        const wanted = action === 'buy' ? 'BUY' : 'SELL';
        if (position && position.direction !== wanted) {
          closePosition(bar.open, bar.time, i, 'signal'); // flip : ferme puis rentre
        }
        if (!position) openPosition(pendingMarket, wanted, bar.open, bar.time, i);
        // signal dans le même sens qu'une position déjà ouverte → ignoré
      }
      pendingMarket = null;
    }

    // 2) Scan M1 : déclenchement d'ordre stop d'entrée + SL/TP, dans l'ordre
    //    chronologique réel à l'intérieur de la bougie TF
    if (pendingStop || (position && (position.sl != null || position.tp != null))) {
      const [s, e] = ranges[i];
      for (let k = s; k <= e; k++) {
        const m1 = m1Bars[k];

        if (!position && pendingStop) {
          const buy = pendingStop.action === 'buyStop';
          const hit = buy ? m1.high >= pendingStop.price : m1.low <= pendingStop.price;
          if (hit) {
            // fill au niveau du stop, ou à l'open M1 si gap au-delà
            const fill = buy
              ? Math.max(pendingStop.price, m1.open)
              : Math.min(pendingStop.price, m1.open);
            openPosition(pendingStop, buy ? 'BUY' : 'SELL', fill, m1.time, i);
            pendingStop = null;
          }
        }

        if (position && (position.sl != null || position.tp != null)) {
          const hit = checkStops(m1, position);
          if (hit) {
            closePosition(hit === 'sl' ? position.sl : position.tp, m1.time, i, hit);
            if (!pendingStop) break; // plus rien à surveiller dans cette bougie
          }
        }
      }
    }
    pendingStop = null; // non exécuté → expire (la stratégie le ré-arme si besoin)

    // 3) Sortie forcée après maxBarsInTrade bougies en position
    if (position && maxBarsInTrade > 0 && i - position.entryIndex >= maxBarsInTrade) {
      closePosition(bar.close, bar.time, i, 'timeout');
    }

    // 4) Décision de la stratégie à la clôture de la bougie i
    const order = strategy.onBar({
      candles, i, ind, position, params,
      lastTrade: trades[trades.length - 1] ?? null,
    });
    if (order && order.action) {
      if (order.action === 'modify') {
        if (position) {
          if ('sl' in order) position.sl = order.sl;
          if ('tp' in order) position.tp = order.tp;
        }
      } else if (order.action === 'buyStop' || order.action === 'sellStop') {
        if (Number.isFinite(order.price)) pendingStop = order;
      } else {
        pendingMarket = order;
      }
    }
  }

  // Position encore ouverte à la fin des données → clôture au dernier close
  if (position) {
    const last = candles[candles.length - 1];
    closePosition(last.close, last.time, candles.length - 1, 'end');
  }

  return { candles, trades };
}
