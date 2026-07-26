import { query } from '../../../lib/db';
import { ingestAuthorized, validSymbolName } from '../../../lib/ingest';

// Point de synchronisation de l'EA MT5 (mql5/GrapherFeeder.mq5).
// POST { symbol } → { symbolId, firstTs, lastTs, days: [[jour, nb], …] }
//   firstTs / lastTs : epoch (s) des bougies M1 extrêmes en base, null si le
//     symbole est inconnu ou vide.
//   days : relevé de couverture — pour chaque jour ayant au moins une bougie,
//     [epoch du jour à 00:00, nombre de bougies M1]. Trié, jours vides omis.
//
// L'EA compare ce relevé à son historique local et ne renvoie que les jours
// où il a plus de bougies que la base. C'est ce qui lui permet de combler les
// trous INTERNES (import partiel, backfill interrompu) et pas seulement la
// queue après la dernière bougie connue. Les jours fermés (week-ends, fériés)
// sont vides des deux côtés : ils ne déclenchent aucun renvoi.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!ingestAuthorized(req)) return res.status(401).json({ error: 'clé x-ingest-key invalide' });

  const symbol = req.body?.symbol;
  if (!validSymbolName(symbol)) return res.status(400).json({ error: 'symbol invalide' });

  try {
    const [sym] = await query('SELECT id FROM symbols WHERE name = ?', symbol.trim());
    if (!sym) return res.json({ symbolId: null, firstTs: null, lastTs: null, days: [] });

    const [{ first, last }] = await query(
      `SELECT epoch(min(ts))::BIGINT AS first, epoch(max(ts))::BIGINT AS last
         FROM bars_m1 WHERE symbol_id = ?`,
      sym.id,
    );

    // date_trunc + epoch restent en heure naïve (heure broker), même convention
    // que le (long)datetime de MT5 : les deux côtés découpent le même jour.
    const days = await query(
      `SELECT epoch(date_trunc('day', ts))::BIGINT AS d, count(*)::BIGINT AS c
         FROM bars_m1 WHERE symbol_id = ?
        GROUP BY 1 ORDER BY 1`,
      sym.id,
    );

    res.json({
      symbolId: sym.id,
      firstTs: first == null ? null : Number(first),
      lastTs:  last  == null ? null : Number(last),
      days:    days.map(r => [Number(r.d), Number(r.c)]),
    });
  } catch (err) {
    console.error('[live/sync]', err);
    res.status(500).json({ error: err.message });
  }
}
