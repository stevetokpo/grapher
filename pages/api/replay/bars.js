import { query } from '../../../lib/db';

const MAX_BARS = 100_000;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { symbolId, from, to } = req.query;
  if (!symbolId || !from || !to)
    return res.status(400).json({ error: 'symbolId, from, to required' });

  const id     = parseInt(symbolId, 10);
  const fromTs = Number(from);
  const toTs   = Number(to);

  if (isNaN(id))                                    return res.status(400).json({ error: 'invalid symbolId' });
  if (!Number.isFinite(fromTs) || !Number.isFinite(toTs)) return res.status(400).json({ error: 'invalid from/to' });

  try {
    const rows = await query(`
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
      LIMIT ${MAX_BARS}
    `);
    res.json({ bars: rows, capped: rows.length >= MAX_BARS });
  } catch (err) {
    console.error('[replay/bars]', err);
    res.status(500).json({ error: err.message });
  }
}
