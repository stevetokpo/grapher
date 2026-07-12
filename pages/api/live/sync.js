import { query } from '../../../lib/db';
import { ingestAuthorized, validSymbolName } from '../../../lib/ingest';

// Point de synchronisation de l'EA MT5 (mq5/GrapherFeeder.mq5).
// POST { symbol } → { symbolId, lastTs }
//   lastTs : epoch (s) de la dernière bougie M1 en base, null si le symbole
//   est inconnu ou vide. L'EA en déduit d'où reprendre l'envoi.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!ingestAuthorized(req)) return res.status(401).json({ error: 'clé x-ingest-key invalide' });

  const symbol = req.body?.symbol;
  if (!validSymbolName(symbol)) return res.status(400).json({ error: 'symbol invalide' });

  try {
    const [sym] = await query('SELECT id FROM symbols WHERE name = ?', symbol.trim());
    if (!sym) return res.json({ symbolId: null, lastTs: null });

    const [{ last }] = await query(
      'SELECT epoch(max(ts))::BIGINT AS last FROM bars_m1 WHERE symbol_id = ?',
      sym.id,
    );
    res.json({ symbolId: sym.id, lastTs: last == null ? null : Number(last) });
  } catch (err) {
    console.error('[live/sync]', err);
    res.status(500).json({ error: err.message });
  }
}
