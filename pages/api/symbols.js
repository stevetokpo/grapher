import { query } from '../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const rows = await query(`
      SELECT
        s.id,
        s.name,
        s.created_at::VARCHAR AS created_at,
        (SELECT count(*)::INTEGER FROM bars_m1 WHERE symbol_id = s.id) AS bar_count,
        (SELECT min(ts)::VARCHAR  FROM bars_m1 WHERE symbol_id = s.id) AS ts_min,
        (SELECT max(ts)::VARCHAR  FROM bars_m1 WHERE symbol_id = s.id) AS ts_max,
        (SELECT count(*)::INTEGER FROM ticks   WHERE symbol_id = s.id) AS tick_count
      FROM symbols s
      ORDER BY s.name
    `);

    res.json(rows);
  } catch (err) {
    console.error('[symbols]', err);
    res.status(500).json({ error: err.message });
  }
}
