// GET /api/rsi/series — la série RSI d'un symbole, brute, pour être analysée.
//
// C'est la sortie de secours du laboratoire : le graphe ne montre que quelques
// milliers de bougies et ne sait pas faire de statistiques. Ici on tire la série
// complète (ou une fenêtre) avec les bougies en face, dans un JSON qu'un script
// avale directement.
//
//   /api/rsi/series?symbolId=1&tf=1m&period=7&limit=5000
//   /api/rsi/series?symbolId=1&tf=1m&period=7&from=2026-07-01&to=2026-08-01
//   …&format=csv    → t,o,h,l,c,rsi  (pour un tableur ou awk)
//
// `limit` garde les N DERNIÈRES bougies de la fenêtre, mais le RSI, lui, est
// toujours calculé sur tout l'historique en amont : jamais de préchauffage
// tronqué qui fausserait les premières valeurs.

import { loadTF, toEpoch, TF_SECONDS } from '../../../lib/signals/data';
import { rsiOf, PIVOT_DEFAULTS } from '../../../lib/rsi/features';

export const config = { api: { responseLimit: false } };

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const symbolId = Number(req.query.symbolId);
  if (!Number.isFinite(symbolId)) return res.status(400).json({ error: 'symbolId requis' });

  const tf = req.query.tf ?? '1m';
  if (!TF_SECONDS[tf]) return res.status(400).json({ error: `timeframe inconnu : ${tf}` });

  const period = Math.max(2, Number(req.query.period) || PIVOT_DEFAULTS.period);
  const limit  = Math.max(0, Number(req.query.limit) || 0);
  const from   = toEpoch(req.query.from);
  const to     = toEpoch(req.query.to);

  try {
    const { candles } = await loadTF(symbolId, tf);
    const rsi = rsiOf(candles, period);          // calculé sur TOUT l'historique

    let rows = [];
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      if (from && c.time < from) continue;
      if (to   && c.time > to)   continue;
      rows.push({
        t: c.time, o: c.open, h: c.high, l: c.low, c: c.close,
        rsi: rsi[i] == null ? null : Math.round(rsi[i] * 100) / 100,
      });
    }
    if (limit && rows.length > limit) rows = rows.slice(-limit);

    if (req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      const head = 't,o,h,l,c,rsi\n';
      res.send(head + rows.map(r => `${r.t},${r.o},${r.h},${r.l},${r.c},${r.rsi ?? ''}`).join('\n'));
      return;
    }

    res.json({
      symbolId, tf, period,
      count: rows.length,
      total: candles.length,
      first: rows[0]?.t ?? null,
      last:  rows[rows.length - 1]?.t ?? null,
      rows,
    });
  } catch (err) {
    console.error('[rsi/series]', err);
    res.status(500).json({ error: err.message });
  }
}
