import { query } from '../../../lib/db';
import { inferDigits } from '../../../lib/ticker/resolutions';

// Couverture des ticks d'un symbole. Sans elle, le ticker est un graphe à
// l'aveugle : les ticks ne couvrent qu'une fenêtre étroite (ce que l'EA a vu
// passer), et rien à l'écran ne dirait où chercher. La page s'en sert pour
// afficher la plage disponible, proposer un saut à une date, et griser la
// source « Last » sur les instruments qui n'en publient pas.
//
// GET /api/ticks/coverage?symbolId=1
// → { firstMs, lastMs, count, hasLast, hasQuotes, digits, days: [[jourMs, nb], …] }
//   days est trié ; les jours sans aucun tick sont simplement absents.
//   digits : décimales de l'instrument, lues sur les COTATIONS BRUTES. C'est le
//     seul endroit où on peut les connaître : le mid rendu par /api/ticks est
//     une moyenne, qui tombe légitimement sur le demi-point et ferait croire à
//     une décimale de plus que n'en publie le broker.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const id = parseInt(req.query.symbolId, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'symbolId invalide' });

  try {
    const [agg] = await query(
      `SELECT
         epoch_ms(min(ts))::BIGINT AS first_ms,
         epoch_ms(max(ts))::BIGINT AS last_ms,
         count(*)::BIGINT          AS n,
         count(last_price)::BIGINT AS n_last,
         count(bid)::BIGINT        AS n_bid
       FROM ticks WHERE symbol_id = ?`,
      id,
    );

    const count = Number(agg?.n ?? 0);
    if (count === 0) {
      return res.json({
        firstMs: null, lastMs: null, count: 0,
        hasLast: false, hasQuotes: false, digits: 5, days: [],
      });
    }

    // Échantillon de cotations récentes : assez pour tomber sur un prix qui
    // exerce toutes les décimales, assez peu pour ne rien coûter.
    const sample = await query(
      `SELECT coalesce(bid, ask, last_price) AS p FROM ticks
        WHERE symbol_id = ? AND coalesce(bid, ask, last_price) IS NOT NULL
        ORDER BY ts DESC LIMIT 500`,
      id,
    );

    // date_trunc + epoch restent en heure naïve (heure broker), même convention
    // que /api/live/sync : les deux côtés découpent le même jour.
    const days = await query(
      `SELECT epoch_ms(date_trunc('day', ts))::BIGINT AS d, count(*)::BIGINT AS c
         FROM ticks WHERE symbol_id = ?
        GROUP BY 1 ORDER BY 1`,
      id,
    );

    res.json({
      firstMs:   Number(agg.first_ms),
      lastMs:    Number(agg.last_ms),
      count,
      hasLast:   Number(agg.n_last) > 0,
      hasQuotes: Number(agg.n_bid)  > 0,
      digits:    inferDigits(sample.map(r => Number(r.p)), { sample: 500 }),
      days:      days.map(r => [Number(r.d), Number(r.c)]),
    });
  } catch (err) {
    console.error('[ticks/coverage]', err);
    res.status(500).json({ error: err.message });
  }
}
