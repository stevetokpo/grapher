// POST /api/backtest — exécute un backtest côté serveur.
//
// Body JSON :
//   {
//     symbolId:   number,
//     from, to:   epoch secondes (bornes incluses),
//     tf:         '1m' … '1D' (timeframe de décision de la stratégie),
//     strategyId: id du registre lib/backtest/strategies,
//     params:     paramètres de la stratégie (complétés/clampés par le schéma),
//     execution:  { spreadPoints?, maxBarsInTrade? }
//   }
//
// Réponse : { meta, summary, equity, trades, byDirection, monthly, byHour, byDayOfWeek }
// Les métriques sont calculées sur TOUS les trades ; seule la liste `trades`
// renvoyée est plafonnée (payload).
//
// GET /api/backtest — liste les stratégies disponibles avec leur schéma de
// paramètres (consommé par le formulaire auto-généré de pages/backtest.js).

import { query } from '../../lib/db';
import { runBacktest } from '../../lib/backtest/engine';
import { computeMetrics } from '../../lib/backtest/metrics';
import { STRATEGIES, getStrategy, sanitizeParams } from '../../lib/backtest/strategies';
import { TF_SECONDS } from '../../lib/replayUtils';

const MAX_M1_BARS   = 500_000;
const MAX_TRADES_IN_RESPONSE = 5_000;

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // Découverte des stratégies : id, label, desc, schéma des params
    return res.json(STRATEGIES.map(({ id, label, desc, params }) => ({ id, label, desc, params })));
  }
  if (req.method !== 'POST') return res.status(405).end();

  const { symbolId, from, to, tf = '1h', strategyId, params = {}, execution = {} } = req.body ?? {};

  const id     = parseInt(symbolId, 10);
  const fromTs = Number(from);
  const toTs   = Number(to);

  if (isNaN(id))                  return res.status(400).json({ error: 'symbolId invalide' });
  if (!Number.isFinite(fromTs) || !Number.isFinite(toTs) || fromTs >= toTs)
    return res.status(400).json({ error: 'plage from/to invalide' });
  if (!TF_SECONDS.hasOwnProperty(tf))
    return res.status(400).json({ error: `tf inconnu : ${tf}` });

  const strategy = getStrategy(strategyId);
  if (!strategy) return res.status(400).json({ error: `stratégie inconnue : ${strategyId}` });

  const cleanParams = sanitizeParams(strategy, params);
  const cleanExec = {
    spreadPoints:   Math.max(0, Number(execution.spreadPoints)   || 0),
    maxBarsInTrade: Math.max(0, Number(execution.maxBarsInTrade) || 0),
  };

  try {
    const t0 = Date.now();

    const m1Bars = await query(`
      SELECT
        epoch(ts)::INTEGER AS time,
        open::DOUBLE        AS open,
        high::DOUBLE        AS high,
        low::DOUBLE         AS low,
        close::DOUBLE       AS close,
        tick_vol::INTEGER   AS volume
      FROM bars_m1
      WHERE symbol_id = ${id}
        AND epoch(ts) >= ${fromTs}
        AND epoch(ts) <= ${toTs}
      ORDER BY ts ASC
      LIMIT ${MAX_M1_BARS}
    `);

    if (m1Bars.length === 0)
      return res.status(404).json({ error: 'aucune donnée M1 sur cette plage' });

    const { candles, trades } = runBacktest({
      m1Bars, tf, strategy,
      params:    cleanParams,
      execution: cleanExec,
    });

    const metrics = computeMetrics(trades);

    res.json({
      meta: {
        symbolId:   id,
        tf,
        from:       fromTs,
        to:         toTs,
        strategyId: strategy.id,
        params:     cleanParams,
        execution:  cleanExec,
        m1Count:    m1Bars.length,
        capped:     m1Bars.length >= MAX_M1_BARS,
        tfBarCount: candles.length,
        elapsedMs:  Date.now() - t0,
      },
      ...metrics,
      trades:       trades.slice(-MAX_TRADES_IN_RESPONSE),
      tradesCapped: trades.length > MAX_TRADES_IN_RESPONSE,
    });
  } catch (err) {
    console.error('[backtest]', err);
    res.status(500).json({ error: err.message });
  }
}
