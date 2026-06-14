import { query } from '../../lib/db';

const TF_BUCKET = {
  '1m':  '1 minute',
  '5m':  '5 minutes',
  '15m': '15 minutes',
  '30m': '30 minutes',
  '1h':  '1 hour',
  '4h':  '4 hours',
  '1D':  '1 day',
  '1W':  '1 week',
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { symbolId, tf = '1h' } = req.query;
  if (!symbolId) return res.status(400).json({ error: 'symbolId required' });

  const id = parseInt(symbolId, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'invalid symbolId' });

  const bucket = TF_BUCKET[tf];
  if (!bucket) return res.status(400).json({ error: `unknown tf: ${tf}` });

  const sql = `
    WITH tick_moves AS (
      SELECT
        time_bucket(INTERVAL '${bucket}', ts)      AS bar_ts,
        (bid + ask) / 2.0                          AS mid,
        LAG((bid + ask) / 2.0) OVER (ORDER BY ts)  AS prev_mid
      FROM ticks
      WHERE symbol_id = ${id}
        AND bid IS NOT NULL
        AND ask IS NOT NULL
    ),
    classified AS (
      SELECT bar_ts,
        CASE WHEN mid > prev_mid THEN 1 ELSE 0 END AS is_up,
        CASE WHEN mid < prev_mid THEN 1 ELSE 0 END AS is_down
      FROM tick_moves
      WHERE prev_mid IS NOT NULL AND mid <> prev_mid
    )
    SELECT
      epoch(bar_ts)::INTEGER               AS time,
      sum(is_up)::INTEGER                  AS up_ticks,
      sum(is_down)::INTEGER                AS down_ticks,
      (sum(is_up) - sum(is_down))::INTEGER AS delta
    FROM classified
    GROUP BY bar_ts
    ORDER BY bar_ts ASC
  `;

  try {
    const rows = await query(sql);
    res.json(rows);
  } catch (err) {
    console.error('[cvd]', err);
    res.status(500).json({ error: err.message });
  }
}
