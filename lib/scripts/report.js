// Le rapport d'un script — ce qu'on répond à « alors, j'ai fait combien ? ».
//
// Tout est en USD (les points × lots × pointValue du compte), sauf les colonnes
// explicitement nommées en points ou en R. Deux chiffres méritent d'être lus
// ensemble et sont donc calculés ici plutôt que dans la vue :
//   • le drawdown est celui de l'ÉQUITÉ relevée à chaque bougie, pas celui de la
//     courbe des trades fermés — le second ignore les creux traversés en position,
//     c'est-à-dire précisément ceux qui déclenchent les appels de marge ;
//   • le profit net est net de TOUT : spread, commissions, positions soldées en
//     fin de données. Il n'y a pas de « brut » réconfortant à côté.

const div = (a, b) => (b !== 0 && b != null ? a / b : null);

function streaks(trades) {
  let maxWins = 0, maxLosses = 0, curWins = 0, curLosses = 0;
  for (const t of trades) {
    if (t.profitUsd > 0)      { curWins++;   curLosses = 0; }
    else if (t.profitUsd < 0) { curLosses++; curWins   = 0; }
    else                      { curWins = 0; curLosses = 0; }
    if (curWins   > maxWins)   maxWins   = curWins;
    if (curLosses > maxLosses) maxLosses = curLosses;
  }
  return { maxConsecWins: maxWins, maxConsecLosses: maxLosses };
}

// Part des bougies passées avec au moins une position ouverte.
function exposure(trades, range) {
  if (!range.bars) return null;
  const busy = new Uint8Array(range.bars);
  for (const t of trades) {
    const from = Math.max(range.startIndex, t.entryIndex);
    const to   = Math.min(range.endIndex,   t.exitIndex);
    for (let i = from; i <= to; i++) busy[i - range.startIndex] = 1;
  }
  let held = 0;
  for (let i = 0; i < busy.length; i++) held += busy[i];
  return (held / range.bars) * 100;
}

export function summarizeRun(run) {
  const { account: acc, trades, equityCurve, range, events } = run;

  const wins   = trades.filter(t => t.profitUsd > 0);
  const losses = trades.filter(t => t.profitUsd < 0);
  const flat   = trades.filter(t => t.profitUsd === 0);

  const grossWin  = wins.reduce((s, t) => s + t.profitUsd, 0);
  const grossLoss = -losses.reduce((s, t) => s + t.profitUsd, 0);
  const netProfit = acc.balance - acc.capital;

  const rTrades = trades.filter(t => t.profitR != null);
  const totalR  = rTrades.reduce((s, t) => s + t.profitR, 0);

  // Comptage par cause de sortie — c'est là qu'on voit si les positions meurent
  // au stop, au TP, ou fauchées par le broker.
  const byReason = {};
  for (const t of trades) byReason[t.reason] = (byReason[t.reason] ?? 0) + 1;

  const longs  = trades.filter(t => t.side === 'BUY');
  const shorts = trades.filter(t => t.side === 'SELL');

  return {
    // ── Compte ──────────────────────────────────────────────────────────────
    capital:        acc.capital,
    finalBalance:   acc.balance,
    finalEquity:    acc.equity,
    netProfit,
    netProfitPct:   acc.capital > 0 ? (netProfit / acc.capital) * 100 : null,
    peakEquity:     acc.peakEquity,
    maxDrawdown:    acc.maxDrawdown,
    maxDrawdownPct: acc.maxDrawdownPct,
    recoveryFactor: div(netProfit, acc.maxDrawdown),

    // ── Marge ───────────────────────────────────────────────────────────────
    marginCalls:    acc.marginCalls,
    marginCallBars: acc.marginCallBars,
    stopOuts:       acc.stopOuts,
    rejected:       acc.rejected,
    maxUsedMargin:  acc.maxUsedMargin,
    minMarginLevel: acc.minMarginLevel,
    ruined:         acc.ruined,
    ruinTime:       acc.ruinTime,

    // ── Trades ──────────────────────────────────────────────────────────────
    total:        trades.length,
    wins:         wins.length,
    losses:       losses.length,
    flat:         flat.length,
    winrate:      trades.length > 0 ? (wins.length / trades.length) * 100 : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : null),
    grossWin,
    grossLoss,
    avgWin:       div(grossWin,   wins.length),
    avgLoss:      div(-grossLoss, losses.length),
    expectancy:   div(trades.reduce((s, t) => s + t.profitUsd, 0), trades.length),
    bestTrade:    trades.length ? Math.max(...trades.map(t => t.profitUsd)) : null,
    worstTrade:   trades.length ? Math.min(...trades.map(t => t.profitUsd)) : null,
    ...streaks(trades),
    byReason,
    longs:        longs.length,
    shorts:       shorts.length,
    longsWon:     longs.filter(t => t.profitUsd > 0).length,
    shortsWon:    shorts.filter(t => t.profitUsd > 0).length,

    // ── Unités brutes ───────────────────────────────────────────────────────
    totalPoints:  trades.reduce((s, t) => s + t.profitPoints, 0),
    totalR:       rTrades.length ? totalR : null,
    avgR:         div(totalR, rTrades.length),
    totalLots:    acc.totalLots,
    totalCosts:   acc.totalCosts,
    avgBars:      div(trades.reduce((s, t) => s + t.bars, 0), trades.length),
    exposurePct:  exposure(trades, range),

    // ── Contexte ────────────────────────────────────────────────────────────
    range,
    equityPoints: equityCurve.length,
    events:       events.length,
  };
}

// Document JSON déposable tel quel — même esprit que lib/patternReport.js : ce
// qu'il faut pour relire un run dans six mois sans avoir à deviner ses règles.
export function buildScriptReport({ script, params, accountConfig, run, symbol, tf, notes }) {
  const s   = summarizeRun(run);
  const iso = t => (t != null ? new Date(t * 1000).toISOString() : null);
  const num = (v, d = 4) => (v == null || !Number.isFinite(v) ? null : +v.toFixed(d));

  return {
    script:      script?.label ?? run.scriptId,
    scriptId:    run.scriptId,
    generatedAt: new Date().toISOString(),
    symbol,
    tf,
    periode: {
      debut: iso(run.range.startTime),
      fin:   iso(run.range.endTime),
      bougies: run.range.bars,
    },
    compte: accountConfig,
    params,
    // Ce que le script empruntait au GRAPHE au moment du run (réglages d'un
    // motif, par exemple). Figé ici : le panneau Patterns peut changer après,
    // le rapport ne doit pas raconter autre chose que ce qui a été joué.
    detection: notes ?? null,
    conventions: {
      unites: "Tout est en POINTS de prix ; l'affichage et ce rapport disent USD. gain = points × lots × pointValue, avec pointValue = 1 par défaut (un point, un lot, un dollar)",
      bougies: "le script tourne sur les bougies CHARGÉES SUR LE GRAPHE, au timeframe affiché — aucune sous-résolution M1, donc l'ordre des prix DANS une bougie est inconnu",
      entree: "un ordre au marché décidé à la clôture de la bougie i est rempli à l'OUVERTURE de i+1 — jamais au prix qui l'a décidé",
      attente: "les ordres stop/limite sont remplis au niveau demandé, ou à l'ouverture si la bougie a ouvert au-delà : jamais à un prix meilleur que le marché",
      ambiguite: "SL et TP dans la même bougie → le SL gagne. Une position remplie pendant une bougie est exposée au SL/TP de cette bougie-là, sur toute son amplitude",
      marge: "surveillée au PIRE prix de chaque bougie (équité évaluée au plus bas et au plus haut, le minimum compte). Sous le niveau d'appel de marge : compté, rien n'est fermé. Sous le stop out : la position la plus perdante est liquidée, et on recommence tant qu'on reste sous le seuil",
      appelsDeMarge: "un ÉPISODE par appel, pas une bougie : dix bougies passées sous le seuil sans remonter comptent pour UN appel. bougiesEnAppel dit combien de temps le compte est resté en danger",
      couts: "spread (aller-retour, en points) et commission (USD par lot) sont portés par la position DÈS son ouverture et comptés dans le flottant — une position vaut son coût en moins à la seconde où elle s'ouvre, sinon l'équité repousserait les stop outs",
      drawdown: "calculé sur l'équité relevée à chaque bougie, creux traversés en position compris — pas sur la courbe des trades fermés",
      fin: "les positions encore ouvertes à la dernière bougie sont soldées à sa clôture, cause 'end'. Elles comptent dans le solde final et dans les statistiques",
    },
    stats: {
      capital:        s.capital,
      soldeFinal:     num(s.finalBalance, 2),
      profitNet:      num(s.netProfit, 2),
      profitNetPct:   num(s.netProfitPct, 2),
      picEquity:      num(s.peakEquity, 2),
      drawdownMax:    num(s.maxDrawdown, 2),
      drawdownMaxPct: num(s.maxDrawdownPct, 2),
      facteurRecup:   num(s.recoveryFactor),
      appelsDeMarge:  s.marginCalls,
      bougiesEnAppel: s.marginCallBars,
      stopOuts:       s.stopOuts,
      ordresRefuses:  s.rejected,
      margeMaxUtilisee: num(s.maxUsedMargin, 2),
      niveauMargeMin: num(s.minMarginLevel, 1),
      ruine:          s.ruined,
      dateRuine:      iso(s.ruinTime),
      trades:         s.total,
      gagnants:       s.wins,
      perdants:       s.losses,
      winrate:        num(s.winrate, 2),
      facteurProfit:  Number.isFinite(s.profitFactor) ? num(s.profitFactor) : null,
      gainMoyen:      num(s.avgWin, 2),
      perteMoyenne:   num(s.avgLoss, 2),
      esperance:      num(s.expectancy, 2),
      meilleur:       num(s.bestTrade, 2),
      pire:           num(s.worstTrade, 2),
      seriesGains:    s.maxConsecWins,
      seriesPertes:   s.maxConsecLosses,
      sorties:        s.byReason,
      totalPoints:    num(s.totalPoints, 2),
      totalR:         num(s.totalR),
      lotsCumules:    num(s.totalLots, 2),
      coutsPayes:     num(s.totalCosts, 2),
      bougiesMoyennes: num(s.avgBars, 1),
      expositionPct:  num(s.exposurePct, 1),
    },
    trades: run.trades.map(t => ({
      id:         t.id,
      sens:       t.side,
      tag:        t.tag,
      lots:       t.lots,
      entree:     iso(t.entryTime),
      sortie:     iso(t.exitTime),
      prixEntree: num(t.entryPrice, 6),
      prixSortie: num(t.exitPrice, 6),
      sl:         num(t.sl, 6),
      sl0:        num(t.sl0, 6),
      tp:         num(t.tp, 6),
      cause:      t.reason,
      points:     num(t.profitPoints, 4),
      usd:        num(t.profitUsd, 2),
      couts:      num(t.costUsd, 2),
      r:          num(t.profitR),
      mfePts:     num(t.maxFavorPts, 4),
      maePts:     num(t.maxAdversePts, 4),
      soldeApres: num(t.balanceAfter, 2),
    })),
  };
}
