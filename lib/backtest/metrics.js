// Calcule toutes les statistiques d'un backtest à partir de la liste des trades
// fermés produite par le moteur. Deux unités partout :
//   • points — unités brutes de prix du symbole (seule mesure universelle,
//     cf. useTrades : pas de pips, l'échelle varie selon l'instrument)
//   • R      — profit rapporté au risque initial (distance entrée→SL) ;
//     null pour les trades sans SL, exclus des stats en R.

function safeDiv(a, b) {
  return b !== 0 ? a / b : null;
}

function summarize(trades) {
  const total  = trades.length;
  const wins   = trades.filter(t => t.result === 'win');
  const losses = trades.filter(t => t.result === 'loss');

  const totalPoints = trades.reduce((s, t) => s + t.profitPoints, 0);
  const grossWin    = wins.reduce((s, t) => s + t.profitPoints, 0);
  const grossLoss   = -losses.reduce((s, t) => s + t.profitPoints, 0);

  const rTrades = trades.filter(t => t.profitR != null);
  const totalR  = rTrades.reduce((s, t) => s + t.profitR, 0);
  const avgR    = rTrades.length > 0 ? totalR / rTrades.length : null;

  // Écart-type des R par trade → ratio de Sharpe simplifié (par trade, non annualisé)
  let stdR = null, sharpe = null;
  if (rTrades.length > 1 && avgR != null) {
    const variance = rTrades.reduce((s, t) => s + (t.profitR - avgR) ** 2, 0) / (rTrades.length - 1);
    stdR   = Math.sqrt(variance);
    sharpe = stdR > 0 ? avgR / stdR : null;
  }

  return {
    total,
    wins:        wins.length,
    losses:      losses.length,
    winrate:     total > 0 ? (wins.length / total) * 100 : null,
    totalPoints,
    grossWin,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : null),
    avgWinPoints:  safeDiv(grossWin,   wins.length),
    avgLossPoints: safeDiv(-grossLoss, losses.length),
    totalR,
    avgR,          // = espérance en R par trade
    stdR,
    sharpe,
    bestR:  rTrades.length > 0 ? Math.max(...rTrades.map(t => t.profitR)) : null,
    worstR: rTrades.length > 0 ? Math.min(...rTrades.map(t => t.profitR)) : null,
    avgBars:        safeDiv(trades.reduce((s, t) => s + t.bars, 0), total),
    avgDurationMin: safeDiv(trades.reduce((s, t) => s + t.durationMin, 0), total),
  };
}

// Séries de gains/pertes consécutifs
function streaks(trades) {
  let maxWins = 0, maxLosses = 0, curWins = 0, curLosses = 0;
  for (const t of trades) {
    if (t.result === 'win') { curWins++;  curLosses = 0; }
    else                    { curLosses++; curWins   = 0; }
    if (curWins   > maxWins)   maxWins   = curWins;
    if (curLosses > maxLosses) maxLosses = curLosses;
  }
  return { maxConsecWins: maxWins, maxConsecLosses: maxLosses };
}

// Courbe d'équité cumulée (points et R) + drawdown max sur chaque unité.
// Un point par trade fermé, dans l'ordre chronologique de sortie.
function equityCurve(trades) {
  const points = [];
  let cumPoints = 0, cumR = 0;
  let peakPoints = 0, peakR = 0;
  let maxDDPoints = 0, maxDDR = 0;

  for (const t of trades) {
    cumPoints += t.profitPoints;
    if (t.profitR != null) cumR += t.profitR;

    if (cumPoints > peakPoints) peakPoints = cumPoints;
    if (cumR      > peakR)      peakR      = cumR;
    if (peakPoints - cumPoints > maxDDPoints) maxDDPoints = peakPoints - cumPoints;
    if (peakR - cumR           > maxDDR)      maxDDR      = peakR - cumR;

    points.push({ time: t.exitTime, points: cumPoints, r: cumR });
  }

  return { points, maxDDPoints, maxDDR };
}

// Ventilation par clé arbitraire → tableau trié de sous-résumés compacts
function breakdown(trades, keyFn) {
  const groups = new Map();
  for (const t of trades) {
    const key = keyFn(t);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, list]) => {
      const s = summarize(list);
      return {
        key,
        trades:      s.total,
        wins:        s.wins,
        winrate:     s.winrate,
        totalPoints: s.totalPoints,
        totalR:      s.totalR,
      };
    });
}

const monthKey = t => new Date(t.exitTime * 1000).toISOString().slice(0, 7);   // 'YYYY-MM'
const hourKey  = t => new Date(t.entryTime * 1000).getUTCHours();              // heure d'entrée (UTC broker)
const dowKey   = t => new Date(t.entryTime * 1000).getUTCDay();                // 0 = dimanche

export function computeMetrics(trades) {
  const ordered = [...trades].sort((a, b) => a.exitTime - b.exitTime);
  const equity  = equityCurve(ordered);

  const exitReasons = {};
  for (const t of ordered) exitReasons[t.exitReason] = (exitReasons[t.exitReason] ?? 0) + 1;

  return {
    summary: {
      ...summarize(ordered),
      ...streaks(ordered),
      maxDrawdownPoints: equity.maxDDPoints,
      maxDrawdownR:      equity.maxDDR,
      exitReasons,
    },
    equity:      equity.points,
    byDirection: breakdown(ordered, t => t.direction),
    monthly:     breakdown(ordered, monthKey),
    byHour:      breakdown(ordered, hourKey),
    byDayOfWeek: breakdown(ordered, dowKey),
  };
}
