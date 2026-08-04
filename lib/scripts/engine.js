// Moteur des SCRIPTS.
//
// Un script n'est pas une stratégie de backtest et pas non plus un motif : il
// gère un COMPTE. Il choisit ses lots, empile ou non plusieurs positions, peut
// se faire liquider. Le moteur ne lui impose que trois choses — l'anti-lookahead,
// l'ordre des événements dans une bougie, et la comptabilité (lib/scripts/account.js).
// Tout le reste (entrées, stops, TP, taille, filtres) appartient au script.
//
// LES BOUGIES sont celles CHARGÉES SUR LE GRAPHE, au timeframe affiché. Il n'y a
// donc pas de sous-résolution M1 comme dans lib/backtest/engine.js : à l'intérieur
// d'une bougie, l'ordre réel des prix est inconnu. Trois règles tranchent, toutes
// pessimistes, et ce sont elles qu'il faut avoir en tête en lisant un résultat :
//   • SL et TP touchés dans la même bougie → le SL gagne.
//   • Une position remplie pendant une bougie est exposée au SL/TP de CETTE
//     bougie-là, sur toute son amplitude.
//   • La marge est surveillée au PIRE prix de la bougie (équité évaluée au plus
//     bas ET au plus haut, le minimum des deux compte).
//
// L'ORDRE DES ÉVÉNEMENTS dans la bougie i :
//   1. les ordres au marché posés à la clôture de i−1 sont remplis à l'OUVERTURE
//      de i — jamais à la clôture qui les a décidés, c'est là qu'est l'anti-lookahead ;
//   2. les ordres en attente (stop / limite) sont remplis s'ils sont touchés ;
//   3. SL / TP des positions ouvertes, SL prioritaire ;
//   4. MFE / MAE de chaque position ;
//   5. marge : appel puis stop out, au pire prix de la bougie ;
//   6. valorisation à la clôture, puis appel du script — qui décide pour i+1.
//
// CONTRAT D'UN SCRIPT — voir docs/scripts.md et lib/scripts/library/ :
//   {
//     id, label, desc, color,
//     defaults: { … },        // valeurs par défaut de ses réglages
//     fields:   [ … ],        // description du formulaire (même grammaire que
//                             // lib/xfvg/params.js — kind: number|toggle|…)
//     setup({ candles, params, account, startIdx, context }) → state  (optionnel)
//     onBar({ candles, bar, i, state, params, account, api, context })
//     summary({ params, context }) → string                            (optionnel)
//   }
//
// LE CONTEXTE, c'est ce que le GRAPHE sait et que le script n'a pas à redemander :
// `context.patterns` porte les motifs tels qu'ils sont réglés dans le panneau
// Patterns. Un script peut donc jouer un motif SANS recopier ses réglages — on
// règle la détection à un seul endroit, on la voit sur le graphe, et le script
// joue exactement ce qui est affiché. Les scripts qui n'en ont pas besoin
// l'ignorent.
// `onBar` ne retourne rien : il AGIT, via `api`. C'est ce qui permet à un script
// d'ouvrir trois positions et d'en fermer une autre dans la même bougie, ce
// qu'un `return { action }` ne saurait pas dire.

import { Account } from './account';

const isBuy = side => side === 'buy' || side === 'BUY';

// Prix de remplissage d'un ordre en attente. Jamais meilleur que le marché : si
// la bougie a ouvert au-delà du niveau, c'est l'ouverture qui sert.
function pendingFill(order, bar) {
  const { type, price } = order;
  if (isBuy(order.side)) {
    if (type === 'stop')  return bar.high >= price ? Math.max(price, bar.open) : null;
    if (type === 'limit') return bar.low  <= price ? Math.min(price, bar.open) : null;
  } else {
    if (type === 'stop')  return bar.low  <= price ? Math.min(price, bar.open) : null;
    if (type === 'limit') return bar.high >= price ? Math.max(price, bar.open) : null;
  }
  return null;
}

// SL prioritaire quand les deux niveaux sont dans la même bougie.
function hitLevel(pos, bar) {
  if (pos.side === 'BUY') {
    if (pos.sl != null && bar.low  <= pos.sl) return 'sl';
    if (pos.tp != null && bar.high >= pos.tp) return 'tp';
  } else {
    if (pos.sl != null && bar.high >= pos.sl) return 'sl';
    if (pos.tp != null && bar.low  <= pos.tp) return 'tp';
  }
  return null;
}

// Un SL est rempli à son niveau, ou à l'ouverture si le marché a ouvert au-delà
// (gap) — même borne que lib/backtest/engine.js, et pour la même raison : sans
// elle, un stop déplacé du mauvais côté du prix remplirait à un niveau où le
// marché n'a jamais traité. Le TP, lui, reste rempli à son niveau : on ne
// s'accorde pas le gap en notre faveur.
function exitFill(pos, bar, hit) {
  if (hit === 'tp') return pos.tp;
  return pos.side === 'BUY' ? Math.min(pos.sl, bar.open) : Math.max(pos.sl, bar.open);
}

// Résout sl / tp d'un ordre au moment du remplissage, prix réel connu.
// Absolus (sl, tp), relatifs en points (slPts, tpPts), ou RR (tp = risque × rr).
function resolveStops(order, fillPrice) {
  const dir = isBuy(order.side) ? 1 : -1;
  let sl = order.sl ?? null;
  let tp = order.tp ?? null;

  if (sl == null && order.slPts > 0) sl = fillPrice - dir * order.slPts;
  if (tp == null && order.tpPts > 0) tp = fillPrice + dir * order.tpPts;
  if (tp == null && order.rr > 0 && sl != null) {
    tp = fillPrice + dir * Math.abs(fillPrice - sl) * order.rr;
  }
  return { sl, tp };
}

export function runScript({
  candles,
  script,
  params = {},
  account: accountConfig = {},
  context = {},         // ce que le graphe sait — { patterns, symbol, tf, … }
  startIndex = 0,
  maxBars = 0,          // 0 = jusqu'au bout des bougies chargées
  closeAtEnd = true,    // solder les positions ouvertes à la dernière clôture
}) {
  const bars = candles ?? [];
  const n    = bars.length;
  const acc  = new Account(accountConfig);

  const startIdx = Math.max(0, Math.min(startIndex, Math.max(0, n - 1)));
  const endIdx   = maxBars > 0 ? Math.min(n - 1, startIdx + maxBars - 1) : n - 1;

  const logs = [];
  // Équité relevée à chaque bougie : c'est cette courbe-là qui montre les
  // creux VÉCUS, ceux que la courbe par trade fermé ne montre jamais.
  const equityCurve = [];

  if (n === 0 || !script) {
    return finish(acc, { bars, startIdx, endIdx: startIdx, equityCurve, logs, script, params, stoppedAt: null });
  }

  const state = script.setup
    ? (script.setup({ candles: bars, params, account: acc.snapshot(), startIdx, context }) ?? {})
    : {};

  let pending    = [];   // ordres non encore remplis
  let nextOrder  = 1;
  let stoppedAt  = null; // bougie où la ruine a arrêté le script

  for (let i = startIdx; i <= endIdx; i++) {
    const bar = bars[i];

    // ── 1 & 2. Remplissages ────────────────────────────────────────────────
    // Les ordres au marché passent d'abord, à l'ouverture. Les ordres en
    // attente ensuite : eux peuvent être touchés n'importe où dans la bougie.
    const stillPending = [];
    for (const order of pending) {
      const fill = order.type === 'market' ? bar.open : pendingFill(order, bar);

      if (fill == null) {
        // `expireBars` compte les bougies pendant lesquelles l'ordre a été
        // OFFERT au marché, celle-ci comprise : 1 = valable pour cette bougie
        // seulement, comme l'ordre stop d'une bougie du moteur de backtest.
        if (order.expireBars > 0 && i - order.placedAt + 1 >= order.expireBars) {
          logs.push({ i, time: bar.time, kind: 'expired', text: `Ordre #${order.id} expiré` });
          continue;
        }
        stillPending.push(order);
        continue;
      }

      const { sl, tp } = resolveStops(order, fill);
      let lots = order.lots;
      if (!(lots > 0) && order.riskPct > 0) {
        const stopPts = sl != null ? Math.abs(fill - sl) : order.slPts;
        lots = acc.lotsForRisk(order.riskPct, stopPts);
      }

      const pos = acc.open({
        side:  isBuy(order.side) ? 'BUY' : 'SELL',
        lots,
        price: fill,
        time:  bar.time,
        index: i,
        sl, tp,
        tag:   order.tag,
      });
      if (!pos) {
        logs.push({ i, time: bar.time, kind: 'rejected', text: `Ordre #${order.id} refusé — marge libre insuffisante` });
      }
    }
    pending = stillPending;

    // ── 3. SL / TP ─────────────────────────────────────────────────────────
    for (const pos of [...acc.positions]) {
      const hit = hitLevel(pos, bar);
      if (!hit) continue;
      // Un stop déplacé au-delà de l'entrée sort en 'be' : la distinction ne
      // change pas l'argent, mais elle change la lecture du rapport.
      const reason = hit === 'sl' && pos.beMoved ? 'be' : hit;
      acc.close(pos, exitFill(pos, bar, hit), bar.time, i, reason);
    }

    // ── 4. Excursions des positions encore ouvertes ────────────────────────
    for (const pos of acc.positions) {
      const favor   = pos.side === 'BUY' ? bar.high - pos.entryPrice : pos.entryPrice - bar.low;
      const adverse = pos.side === 'BUY' ? pos.entryPrice - bar.low  : bar.high - pos.entryPrice;
      if (favor   > pos.maxFavorPts)   pos.maxFavorPts   = favor;
      if (adverse > pos.maxAdversePts) pos.maxAdversePts = adverse;
    }

    // ── 5. Marge : au PIRE prix de la bougie ───────────────────────────────
    if (acc.positions.length === 0) {
      acc.inMarginCall = false;
    } else {
      const worstPrice = acc.equityAt(bar.low) <= acc.equityAt(bar.high) ? bar.low : bar.high;
      acc.mark(worstPrice);

      const level = acc.marginLevel;
      if (level != null && level < acc.cfg.marginCallLevel) {
        acc.marginCallBars++;
        // Un ÉPISODE : tant qu'on n'est pas remonté au-dessus du seuil, c'est
        // toujours le même appel de marge qui dure.
        if (!acc.inMarginCall) {
          acc.inMarginCall = true;
          acc.marginCalls++;
          acc.events.push({ type: 'marginCall', time: bar.time, index: i, level, equity: acc.equity });
          logs.push({ i, time: bar.time, kind: 'marginCall', text: `Appel de marge — niveau ${level.toFixed(1)} %` });
        }
      } else {
        acc.inMarginCall = false;
      }
      // Stop out : la plus perdante d'abord, et on recommence tant qu'on reste
      // sous le seuil. C'est ainsi qu'un stop out en emporte parfois plusieurs.
      let guard = acc.positions.length;
      while (
        acc.positions.length > 0 && guard-- > 0 &&
        acc.marginLevel != null && acc.marginLevel < acc.cfg.stopOutLevel
      ) {
        const worst = acc.positions.reduce(
          (a, b) => (acc.floatingOf(a, worstPrice) <= acc.floatingOf(b, worstPrice) ? a : b),
        );
        acc.close(worst, worstPrice, bar.time, i, 'stopout');
        acc.stopOuts++;
        acc.events.push({ type: 'stopOut', time: bar.time, index: i, positionId: worst.id, equity: acc.equity });
        logs.push({ i, time: bar.time, kind: 'stopOut', text: `Stop out — position #${worst.id} liquidée` });
        acc.mark(worstPrice);
      }
    }

    // ── 6. Clôture : valorisation, puis le script décide ───────────────────
    acc.mark(bar.close);
    equityCurve.push({ time: bar.time, equity: acc.equity, balance: acc.balance });

    if (acc.equity <= 0) {
      acc.ruined   = true;
      acc.ruinTime = bar.time;
      stoppedAt    = i;
      acc.events.push({ type: 'ruin', time: bar.time, index: i, equity: acc.equity });
      logs.push({ i, time: bar.time, kind: 'ruin', text: 'Compte ruiné — arrêt du script' });
      for (const pos of [...acc.positions]) acc.close(pos, bar.close, bar.time, i, 'stopout');
      pending = [];
      break;
    }

    const api = makeApi({ acc, bar, i, pending, logs, nextId: () => nextOrder++ });
    script.onBar({ candles: bars, bar, i, state, params, account: acc.snapshot(), api, context });
  }

  // ── Solde de fin ─────────────────────────────────────────────────────────
  const lastIdx = stoppedAt ?? endIdx;
  if (closeAtEnd && acc.positions.length > 0) {
    const last = bars[lastIdx];
    for (const pos of [...acc.positions]) acc.close(pos, last.close, last.time, lastIdx, 'end');
    acc.mark(last.close);
    if (equityCurve.length) {
      equityCurve[equityCurve.length - 1] = { time: last.time, equity: acc.equity, balance: acc.balance };
    }
  }

  return finish(acc, { bars, startIdx, endIdx: lastIdx, equityCurve, logs, script, params, stoppedAt });
}

// L'API remise au script à chaque clôture de bougie. Elle ne rend que des
// COPIES des positions : un script ne modifie jamais l'état du compte à la main,
// il passe par close / modify, qui savent tenir la marge à jour.
function makeApi({ acc, bar, i, pending, logs, nextId }) {
  const byId = ref => (typeof ref === 'object' && ref !== null ? acc.positions.find(p => p.id === ref.id) : acc.positions.find(p => p.id === ref));

  const place = (side, opts = {}) => {
    const order = {
      id:         nextId(),
      side,
      type:       opts.type ?? 'market',        // 'market' | 'stop' | 'limit'
      price:      opts.price ?? null,
      lots:       opts.lots ?? null,
      riskPct:    opts.riskPct ?? 0,
      sl:         opts.sl ?? null,
      tp:         opts.tp ?? null,
      slPts:      opts.slPts ?? 0,
      tpPts:      opts.tpPts ?? 0,
      rr:         opts.rr ?? 0,
      expireBars: opts.expireBars ?? 0,          // 0 = jamais
      tag:        opts.tag ?? null,
      placedAt:   i + 1,                         // actif à partir de la bougie suivante
    };
    if (order.type !== 'market' && !(order.price > 0)) return null;
    pending.push(order);
    return order.id;
  };

  return {
    // Instantanés — lecture seule
    get positions() { return acc.positions.map(p => ({ ...p })); },
    get pending()   { return pending.map(o => ({ ...o })); },
    get account()   { return acc.snapshot(); },

    buy:   opts => place('buy',  opts),
    sell:  opts => place('sell', opts),
    order: (opts = {}) => place(opts.side ?? 'buy', opts),

    // Fermeture à la CLÔTURE de la bougie courante. Le script décide à ce
    // prix-là ; le faire sortir à l'ouverture suivante serait plus prudent mais
    // décollerait la sortie de la condition qui l'a déclenchée.
    close(ref, reason = 'close') {
      const pos = byId(ref);
      if (!pos) return null;
      return acc.close(pos, bar.close, bar.time, i, reason);
    },
    closeAll(reason = 'close') {
      const out = [];
      for (const pos of [...acc.positions]) out.push(acc.close(pos, bar.close, bar.time, i, reason));
      return out;
    },
    // Déplacement de stop / TP. Un stop déplacé au-delà de l'entrée est marqué
    // `beMoved` : c'est ce qui distingue une sortie 'be' d'une sortie 'sl'.
    modify(ref, { sl, tp } = {}) {
      const pos = byId(ref);
      if (!pos) return false;
      if (sl !== undefined) {
        pos.sl = sl;
        const beyond = pos.side === 'BUY' ? sl >= pos.entryPrice : sl <= pos.entryPrice;
        if (sl != null && beyond) pos.beMoved = true;
      }
      if (tp !== undefined) pos.tp = tp;
      return true;
    },
    cancel(orderId) {
      const k = pending.findIndex(o => o.id === orderId);
      if (k === -1) return false;
      pending.splice(k, 1);
      return true;
    },
    cancelAll() { pending.length = 0; },

    // Dimensionnement
    lotsForRisk: (riskPct, stopPoints) => acc.lotsForRisk(riskPct, stopPoints),
    normalizeLots: lots => acc.normalizeLots(lots),
    canAfford:     lots => acc.canAfford(lots),

    log(text) { logs.push({ i, time: bar.time, kind: 'script', text: String(text) }); },
  };
}

function finish(acc, { bars, startIdx, endIdx, equityCurve, logs, script, params, stoppedAt }) {
  return {
    account:     acc,
    trades:      acc.trades,
    events:      acc.events,
    equityCurve,
    logs,
    range: {
      startIndex: startIdx,
      endIndex:   endIdx,
      startTime:  bars[startIdx]?.time ?? null,
      endTime:    bars[endIdx]?.time ?? null,
      bars:       bars.length ? endIdx - startIdx + 1 : 0,
    },
    scriptId: script?.id ?? null,
    params,
    stoppedAt,
  };
}
