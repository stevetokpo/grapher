import { query } from '../../lib/db';

// Map UI timeframe id → DuckDB interval string (null = raw M1)
const TF_INTERVAL = {
  '1m':  null,
  '5m':  '5 minutes',
  '15m': '15 minutes',
  '30m': '30 minutes',
  '1h':  '1 hour',
  '4h':  '4 hours',
  '1D':  '1 day',
  '1W':  '1 week',
};

// Build a SELECT that returns unified OHLCV columns for any timeframe.
// M1 is queried directly; all others aggregate via time_bucket.
// Results are sorted ascending by ts, limited to `limit` most recent bars.
function buildBarsQuery(symbolId, tf, limit, from, to) {
  const interval = TF_INTERVAL[tf];

  const whereClause = buildWhere(symbolId, from, to);

  if (!interval) {
    // Raw M1
    return `
      SELECT * FROM (
        SELECT
          epoch(ts)::INTEGER AS time,
          open, high, low, close,
          tick_vol AS volume
        FROM bars_m1
        ${whereClause}
        ORDER BY ts DESC
        LIMIT ${limit}
      ) ORDER BY time ASC
    `;
  }

  // Aggregated timeframe
  return `
    SELECT * FROM (
      SELECT
        epoch(time_bucket(INTERVAL '${interval}', ts))::INTEGER AS time,
        arg_min(open,  ts)::DOUBLE AS open,
        max(high)      ::DOUBLE AS high,
        min(low)       ::DOUBLE AS low,
        arg_max(close, ts)::DOUBLE AS close,
        sum(tick_vol)  ::INTEGER AS volume
      FROM bars_m1
      ${whereClause}
      GROUP BY time_bucket(INTERVAL '${interval}', ts)
      ORDER BY 1 DESC
      LIMIT ${limit}
    ) ORDER BY time ASC
  `;
}

function buildWhere(symbolId, from, to) {
  const parts = [`symbol_id = ${symbolId}`];
  // Use epoch(ts) on both sides to stay in Unix-seconds space and avoid
  // TIMESTAMP vs TIMESTAMPTZ timezone-offset issues with to_timestamp().
  if (from) parts.push(`epoch(ts) >= ${Number(from)}`);
  // `to` is an exclusive upper bound cursor for backward pagination
  if (to)   parts.push(`epoch(ts) < ${Number(to)}`);
  return 'WHERE ' + parts.join(' AND ');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { symbolId, tf = '1h', limit = '500', from, to } = req.query;

  if (!symbolId) return res.status(400).json({ error: 'symbolId required' });
  if (!TF_INTERVAL.hasOwnProperty(tf)) {
    return res.status(400).json({ error: `unknown tf: ${tf}` });
  }

  const id = parseInt(symbolId, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'invalid symbolId' });

  const n = Math.min(parseInt(limit, 10) || 500, 5000);

  try {
    const sql = buildBarsQuery(id, tf, n, from, to);
    const rows = await query(sql);
    res.json(rows);
  } catch (err) {
    console.error('[bars]', err);
    res.status(500).json({ error: err.message });
  }
}
