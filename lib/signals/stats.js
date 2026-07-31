// Statistiques d'un lot de positions — source unique, partagée par tous les
// motifs (rFVG, KO…), la visionneuse de rapports (pages/rapports.js), les
// optimiseurs et les API.
//
// TOUT SE COMPTE EN POINTS, et c'est un choix, pas une commodité : le stop de ces
// stratégies est STRUCTUREL (posé à la clôture de la bougie d'entrée, sous/sur
// l'extrême des deux dernières bougies), donc le risque varie fortement d'une
// position à l'autre, alors que le lot est FIXE. C'est le gain en points qui est
// proportionnel au résultat réel. Compter en R supposerait qu'on redimensionne la
// position à chaque trade pour risquer le même montant — ce que la stratégie ne
// fait pas. Conséquence directe : le seuil de rentabilité affiché est celui
// RÉALISÉ (perte moyenne / (gain + perte moyennes)) et non un 1/(1+RR), qui n'a
// de sens qu'à risque constant.
//
// Les deux études (break-even, SL plafonné) sont des BORNES, pas des vérités :
// elles s'appuient sur les excursions globales de chaque position, dont l'ordre
// intra-vie est inconnu à la granularité bougie.
//   • Break-even — borne OPTIMISTE : une perdante dont le pullup a atteint le
//     déclencheur est comptée sauvée (certain : le pullup des perdantes exclut
//     la bougie du stop) ; les gagnantes sont supposées intactes, ce qui, lui,
//     est optimiste.
//   • SL plafonné — borne PESSIMISTE : une gagnante dont la chaleur a atteint le
//     plafond est comptée tuée (chaleur supposée venir avant le TP) ; une
//     perdante ne coûte plus que le plafond.

// Statuts qui comptent comme « résolus » : la position a rendu son verdict.
// 'open' = encore en vie au bord des données, 'missed' = ordre jamais rempli
// (mode niveaux, plus utilisé en mode position).
const RESOLVED = ['tp', 'sl', 'be', 'timeout'];

const median = a => a.length === 0 ? null
  : a.length % 2 ? a[a.length >> 1]
  : (a[(a.length >> 1) - 1] + a[a.length >> 1]) / 2;

const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;

// Max par réduction, PAS par Math.max(...tableau) : au-delà de quelques dizaines
// de milliers d'éléments l'étalement des arguments fait sauter la pile d'appel.
// Un balayage 1m sur plusieurs mois y arrive sans peine.
const maxOf = a => a.length ? a.reduce((m, v) => v > m ? v : m, -Infinity) : null;

/**
 * @param positions  positions du simulateur ou du rapport JSON
 * @param opts.tpPts objectif en points (grille de l'étude break-even)
 * @param opts.spreadPoints REPLI seulement : coût déduit des positions qui ne
 *   portent pas `netPoints` (rapports enregistrés avant que le simulateur
 *   n'applique le spread lui-même). Une position qui porte son net est comptée
 *   telle quelle, sinon le spread serait déduit deux fois.
 * @param opts.riskFallback  risque à utiliser quand une position n'a pas de
 *   `risk0` — les rapports antérieurs au stop structurel portaient un `slPts`
 *   global. Sans ce repli, ils s'afficheraient avec un risque nul et toutes les
 *   études du bas de page deviendraient muettes.
 */
export function computeStats(positions, opts = {}) {
  // TP en points, pour la grille de l'étude break-even et le RR médian. Passé
  // explicitement quand le TP est réglé en points (constant) ; sinon dérivé de
  // la MÉDIANE des positions elles-mêmes — nécessaire quand le TP est réglé en
  // × ATR, où il varie d'une position à l'autre et n'a pas de valeur unique.
  const tpDistances = positions
    .map(p => Math.abs((p.tp ?? p.entryPrice) - p.entryPrice))
    .filter(v => v > 0);
  const tpPts  = opts.tpPts > 0 ? opts.tpPts : (median(tpDistances) ?? 0);
  const spread  = Number(opts.spreadPoints) || 0;
  const riskFallback = opts.riskFallback ?? 0;

  const byStatus = { tp: [], sl: [], be: [], timeout: [], missed: [], open: [] };
  for (const p of positions) (byStatus[p.status] ?? byStatus.open).push(p);

  const tp = byStatus.tp.length, sl = byStatus.sl.length;
  const beN = byStatus.be.length, timeoutN = byStatus.timeout.length;

  const riskOf = p => p.risk0 ?? riskFallback;
  // Le net vient de la POSITION quand elle le porte : c'est le simulateur qui
  // applique le spread, position par position, et lui seul sait laquelle a été
  // clôturée. `opts.spreadPoints` n'est plus qu'un REPLI pour les rapports
  // enregistrés avant ce champ — l'appliquer à une position déjà nette le
  // compterait deux fois.
  const gainOf = p => p.netPoints ?? ((p.profitPoints ?? 0) - spread);

  // Winrate : population TP/SL seule — le BE et le timeout ne sont ni l'un ni
  // l'autre, les compter des deux côtés brouillerait la lecture.
  const resolved = tp + sl;
  const winrate  = resolved ? tp / resolved : null;

  // Distribution du risque sur la population TP/SL SEULE — pas sur toutes les
  // résolues. C'est elle qui sert de grille de paliers à l'étude du SL plafonné,
  // dont l'espérance est calculée sur cette même population : y mêler les
  // sorties BE ferait des déciles qui ne correspondent à rien de ce qui est
  // compté juste à côté.
  const risks   = [...byStatus.tp, ...byStatus.sl].map(riskOf).filter(v => v > 0).sort((a, b) => a - b);
  const riskMed = median(risks);

  const resolvedPos = RESOLVED.flatMap(s => byStatus[s]).sort((a, b) => a.entryTime - b.entryTime);
  const gains  = resolvedPos.map(gainOf);
  const expPts = mean(gains);

  let cum = 0;
  const equity = resolvedPos.map(p => ({
    id: p.id, time: p.entryTime, pts: gainOf(p), cum: (cum += gainOf(p)),
  }));

  let grossWin = 0, grossLoss = 0, nWin = 0, nLoss = 0;
  for (const g of gains) {
    if (g > 0)      { grossWin  += g;  nWin++; }
    else if (g < 0) { grossLoss += -g; nLoss++; }
  }
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : null);
  const netPts  = grossWin - grossLoss;
  const avgWin  = nWin  ? grossWin  / nWin  : null;
  const avgLoss = nLoss ? grossLoss / nLoss : null;   // amplitude, positive

  const beThresh = avgWin != null && avgLoss != null && avgWin + avgLoss > 0
    ? avgLoss / (avgWin + avgLoss) : null;

  // Dispersion et t-statistique : c'est le score de CLASSEMENT des balayages.
  // avgPts / stdPts × √n rapporte l'espérance à sa volatilité ET à la taille
  // d'échantillon — une espérance flatteuse sur 12 positions ne remonte pas.
  // Jamais classer sur le winrate (un TP serré donne 80 % de réussite et une
  // espérance négative) ni sur le total en points (dominé par les coups de
  // chance et par la dérive de l'instrument).
  const nR   = gains.length;
  const varP = nR > 1 ? gains.reduce((s, g) => s + (g - expPts) ** 2, 0) / (nR - 1) : null;
  const stdPts = varP != null ? Math.sqrt(varP) : null;
  const tStat  = stdPts > 0 && nR > 1 ? (expPts / stdPts) * Math.sqrt(nR) : null;

  let peak = 0, maxDD = 0;
  for (const pt of equity) {
    if (pt.cum > peak) peak = pt.cum;
    const dd = peak - pt.cum;
    if (dd > maxDD) maxDD = dd;
  }

  let lossStreak = 0, maxLossStreak = 0;
  for (const g of gains) {
    if (g < 0) { lossStreak++; if (lossStreak > maxLossStreak) maxLossStreak = lossStreak; }
    else lossStreak = 0;
  }

  // COMBIEN DE SL ENTRE DEUX TP. Sur la suite chronologique des positions
  // résolues, chaque TP referme un intervalle : on compte les SL qu'il contient.
  //   • seuls les SL comptent — un BE n'est ni un gain ni une perte, il traverse
  //     l'intervalle sans l'allonger ni le refermer ;
  //   • seul un TP referme un intervalle. Les SL qui suivent le DERNIER TP n'en
  //     forment pas un : l'intervalle est censuré, on ne sait pas encore combien
  //     de pertes il contiendra. Les compter dans la moyenne la tirerait vers le
  //     bas d'un montant arbitraire, donc ils sont rendus à part (`slTrailing`).
  // Le premier intervalle, lui, est complet : il commence au premier trade et se
  // referme sur le premier TP.
  const slGaps = [];
  let gapSl = 0;
  for (const p of resolvedPos) {
    if (p.status === 'tp') { slGaps.push(gapSl); gapSl = 0; }
    else if (p.status === 'sl') gapSl++;
  }
  const slTrailing = gapSl;   // SL après le dernier TP : intervalle non refermé

  const durations = resolvedPos.map(p => p.barsHeld).filter(v => v != null).sort((a, b) => a - b);
  const touches   = resolvedPos.map(p => p.entryTouches).filter(v => v != null);

  const mfeLosers  = byStatus.sl.map(p => p.maxPullupPts).filter(v => v != null);
  const maeWinners = byStatus.tp.map(p => p.maxDrawdownPts).filter(v => v != null);

  // Référence « sans BE » de la population TP/SL, base des deux études.
  const sumWinPts  = byStatus.tp.reduce((s, p) => s + gainOf(p), 0);
  const sumLossPts = byStatus.sl.reduce((s, p) => s - gainOf(p), 0);
  const expWL = resolved ? (sumWinPts - sumLossPts) / resolved : null;

  // Étude break-even (borne optimiste), grille en POINTS reportable telle
  // quelle dans le panneau. En points, sauver une GROSSE perdante rapporte plus
  // que sauver une petite — ce que le comptage en R écrasait.
  const beStudy = [];
  if (resolved && tpPts > 0) {
    for (let i = 1; i <= 9; i++) {
      const t = +(tpPts * i / 10).toFixed(2);
      const savedPos = byStatus.sl.filter(p => (p.maxPullupPts ?? 0) >= t);
      const spared   = savedPos.reduce((s, p) => s - gainOf(p), 0);
      beStudy.push({ t, saved: savedPos.length, pct: sl ? savedPos.length / sl : 0,
                     exp: (sumWinPts - (sumLossPts - spared)) / resolved });
    }
  }

  // Étude SL plafonné (borne pessimiste). La chaleur lue est celle de la fenêtre
  // ARMÉE (bougie d'entrée exclue) : un stop plafonné reste posé à la clôture de
  // la bougie d'entrée, ce qui s'y passe ne peut déclencher aucun plafond.
  // Paliers sur les DÉCILES du risque observé — au dernier, plus rien n'est
  // plafonné et on retombe exactement sur l'espérance de base.
  const maeStudyOf = p => p.maeArmedPts ?? p.maxDrawdownPts ?? 0;
  const slStudy = [];
  if (resolved && risks.length) {
    const vus = new Set();
    for (let i = 1; i <= 10; i++) {
      const cap = +risks[Math.ceil(risks.length * i / 10) - 1].toFixed(1);
      if (vus.has(cap)) continue;
      vus.add(cap);
      let killed = 0, total = 0;
      for (const p of byStatus.tp) {
        if (maeStudyOf(p) >= cap) { killed++; total -= cap; }
        else total += gainOf(p);
      }
      for (const p of byStatus.sl) total -= Math.min(-gainOf(p), cap);
      slStudy.push({ d: cap, killed, capped: risks.filter(v => v > cap).length, exp: total / resolved });
    }
  }

  const bestBe = beStudy.reduce((m, r) => r.exp > (m?.exp ?? -Infinity) ? r : m, null);
  const bestSl = slStudy.reduce((m, r) => r.exp > (m?.exp ?? -Infinity) ? r : m, null);

  return {
    // — Population
    total: positions.length, tp, sl, be: beN, timeout: timeoutN,
    missed: byStatus.missed.length, open: byStatus.open.length,
    resolved, resolvedAll: resolvedPos.length,
    // — Cœur du classement
    winrate, beThresh, expPts, tStat, stdPts,
    netPts, profitFactor, avgWin, avgLoss, nWin, nLoss,
    maxDD, maxLossStreak,
    // — SL entre deux TP : la moyenne, le pire intervalle, et ce qui traîne
    // après le dernier TP sans former d'intervalle.
    slGaps, slPerTpMean: mean(slGaps), slPerTpMax: maxOf(slGaps), slTrailing,
    // — Risque (stop structurel : il varie, c'est le point)
    riskMed, riskMin: risks[0] ?? null, riskMax: risks[risks.length - 1] ?? null, risks,
    rrMed: riskMed > 0 && tpPts > 0 ? tpPts / riskMed : null,
    // — Vie des positions
    durations, barsHeldMedian: median(durations), barsHeldMean: mean(durations),
    barsHeldMax: durations[durations.length - 1] ?? null,
    onEntryBar: durations.filter(v => v === 0).length,
    touches, entryTouchesMean: mean(touches),
    entryTouchesMax: maxOf(touches),
    neverReturned: touches.filter(v => v === 0).length,
    // — Excursions et études
    mfeLosers, maeWinners, avgMfeLosers: mean(mfeLosers), avgMaeWinners: mean(maeWinners),
    expWL, beStudy, slStudy, bestBe, bestSl,
    equity, byStatus,
  };
}

// Résumé compact — c'est lui qu'on empile dans une grille de balayage, où
// garder les tableaux complets ferait exploser la réponse.
export function summarize(stats, extra = {}) {
  return {
    n:        stats.resolvedAll,
    tp:       stats.tp,
    sl:       stats.sl,
    be:       stats.be,
    timeout:  stats.timeout,
    open:     stats.open,
    winrate:  stats.winrate,
    beThresh: stats.beThresh,
    expPts:   stats.expPts,
    tStat:    stats.tStat,
    netPts:   stats.netPts,
    profitFactor: Number.isFinite(stats.profitFactor) ? stats.profitFactor : null,
    maxDD:    stats.maxDD,
    maxLossStreak: stats.maxLossStreak,
    avgWin:   stats.avgWin,
    avgLoss:  stats.avgLoss,
    riskMed:  stats.riskMed,
    rrMed:    stats.rrMed,
    barsHeldMedian: stats.barsHeldMedian,
    ...extra,
  };
}
