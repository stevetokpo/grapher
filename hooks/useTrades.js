import { useReducer, useCallback, useMemo } from 'react';

let _nextId = 1;

// Conservative rule: if TP and SL are both touched in the same bar, SL wins.
function checkBar(bar, trade) {
  if (trade.direction === 'BUY') {
    if (bar.low  <= trade.sl) return 'sl';
    if (bar.high >= trade.tp) return 'tp';
  } else {
    if (bar.high >= trade.sl) return 'sl';
    if (bar.low  <= trade.tp) return 'tp';
  }
  return null;
}

// Profit en points de prix (unités brutes du symbole). Positif = gain.
// Pas de conversion en pips : l'échelle varie selon l'instrument (forex 5
// décimales vs indices synthétiques) — les points et le multiple de R sont
// les seules mesures valables partout.
function calcPoints(trade, exitPrice) {
  return trade.direction === 'BUY'
    ? exitPrice - trade.entryPrice
    : trade.entryPrice - exitPrice;
}

function reducer(state, action) {
  switch (action.type) {

    case 'PLACE': {
      const trade = {
        id:         _nextId++,
        direction:  action.direction,
        entryPrice: action.entryPrice,
        entryTime:  action.entryTime,
        tp:         action.tp,
        sl:         action.sl,
      };
      return { ...state, open: [...state.open, trade] };
    }

    case 'CHECK': {
      if (state.open.length === 0) return state;
      const stillOpen = [];
      const closed    = [];

      for (const trade of state.open) {
        let hit = null;
        let hitBar = null;
        for (const bar of action.bars) {
          const result = checkBar(bar, trade);
          if (result) { hit = result; hitBar = bar; break; }
        }
        if (hit && hitBar) {
          const exitPrice    = hit === 'tp' ? trade.tp : trade.sl;
          const profitPoints = calcPoints(trade, exitPrice);
          const risk         = Math.abs(trade.entryPrice - trade.sl);
          closed.push({
            ...trade,
            exitTime:     hitBar.time,
            exitPrice,
            result:       hit === 'tp' ? 'win' : 'loss',
            profitPoints,
            // Multiple de R : gain rapporté au risque initial (distance entrée→SL)
            profitR:      risk > 0 ? profitPoints / risk : 0,
          });
        } else {
          stillOpen.push(trade);
        }
      }

      if (closed.length === 0) return state;
      return { open: stillOpen, closed: [...state.closed, ...closed] };
    }

    case 'RESET':
      return { open: [], closed: [] };

    default:
      return state;
  }
}

const INIT = { open: [], closed: [] };

export function useTrades() {
  const [state, dispatch] = useReducer(reducer, INIT);

  const placeTrade = useCallback((direction, entryPrice, entryTime, tp, sl) => {
    dispatch({ type: 'PLACE', direction, entryPrice, entryTime, tp, sl });
  }, []);

  const checkTrades = useCallback((bars) => {
    if (bars.length > 0) dispatch({ type: 'CHECK', bars });
  }, []);

  const resetTrades = useCallback(() => dispatch({ type: 'RESET' }), []);

  const stats = useMemo(() => {
    const closed      = state.closed;
    const total       = closed.length;
    const wins        = closed.filter(t => t.result === 'win').length;
    const totalPoints = closed.reduce((s, t) => s + (t.profitPoints ?? 0), 0);
    const totalR      = closed.reduce((s, t) => s + (t.profitR      ?? 0), 0);
    return {
      total,
      wins,
      losses:  total - wins,
      winrate: total > 0 ? (wins / total) * 100 : null,
      totalPoints,
      totalR,
    };
  }, [state.closed]);

  return {
    openTrades:   state.open,
    closedTrades: state.closed,
    stats,
    placeTrade,
    checkTrades,
    resetTrades,
  };
}
