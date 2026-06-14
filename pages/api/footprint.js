import { query } from '../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { symbolId, from, to, tickSize = '5', limit = '200' } = req.query;
  if (!symbolId) return res.status(400).json({ error: 'symbolId required' });

  const id  = parseInt(symbolId, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'invalid symbolId' });

  // Sanitize user inputs that go into SQL as literals
  const ts  = Math.max(0.01, Math.min(100000, parseFloat(tickSize) || 5));
  const lim = Math.min(500, Math.max(1, parseInt(limit, 10) || 200));

  const fromFilter = from ? `AND epoch(ts) >= ${Number(from)}` : '';
  const toFilter   = to   ? `AND epoch(ts) <  ${Number(to)}`   : '';

  // Build tick-imbalance footprint:
  //   mid = (bid+ask)/2 ; up-tick = mid rose vs prev tick ; down-tick = mid fell
  //   Aggregate counts per (M1 bar, price level)
  const sql = `
    WITH
    tick_moves AS (
      SELECT
        time_bucket(INTERVAL '1 minute', ts)            AS bar_ts,
        round((bid + ask) / 2.0 / ${ts}) * ${ts}       AS level,
        (bid + ask) / 2.0                               AS mid,
        LAG((bid + ask) / 2.0) OVER (ORDER BY ts)       AS prev_mid
      FROM ticks
      WHERE symbol_id = ${id} ${fromFilter} ${toFilter}
    ),
    classified AS (
      SELECT bar_ts, level,
        CASE WHEN mid > prev_mid THEN 1 ELSE 0 END AS is_up,
        CASE WHEN mid < prev_mid THEN 1 ELSE 0 END AS is_down
      FROM tick_moves
      -- drop first tick (no prev) and flat ticks (no direction info)
      WHERE prev_mid IS NOT NULL AND mid != prev_mid
    ),
    level_stats AS (
      SELECT
        bar_ts,
        level::DOUBLE                            AS level,
        sum(is_up)::INTEGER                      AS up_ticks,
        sum(is_down)::INTEGER                    AS down_ticks,
        (sum(is_up) - sum(is_down))::INTEGER     AS delta,
        (sum(is_up) + sum(is_down))::INTEGER     AS total_ticks
      FROM classified
      GROUP BY bar_ts, level
    ),
    -- Limit to most-recent N bars that actually have tick coverage
    target_bars AS (
      SELECT DISTINCT bar_ts FROM level_stats ORDER BY bar_ts DESC LIMIT ${lim}
    )
    SELECT
      epoch(b.ts)::INTEGER  AS time,
      b.open::DOUBLE  AS open,
      b.high::DOUBLE  AS high,
      b.low::DOUBLE   AS low,
      b.close::DOUBLE AS close,
      l.level               AS price,
      l.up_ticks,
      l.down_ticks,
      l.delta,
      l.total_ticks
    FROM bars_m1 b
    INNER JOIN level_stats l  ON l.bar_ts  = b.ts
    INNER JOIN target_bars tb ON tb.bar_ts = b.ts
    WHERE b.symbol_id = ${id}
    ORDER BY b.ts ASC, l.level ASC
  `;

  try {
    const rows = await query(sql);
    res.json({ rows, tickSize: ts });
  } catch (err) {
    console.error('[footprint]', err);
    res.status(500).json({ error: err.message });
  }
}
