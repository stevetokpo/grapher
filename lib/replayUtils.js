export const TF_SECONDS = {
  '1m':  60,
  '3m':  180,
  '5m':  300,
  '10m': 600,
  '15m': 900,
  '20m': 1200,
  '30m': 1800,
  '1h':  3600,
  '2h':  7200,
  '4h':  14400,
  '1D':  86400,
};

export const TF_MINUTES = {
  '1m':  1,
  '3m':  3,
  '5m':  5,
  '10m': 10,
  '15m': 15,
  '20m': 20,
  '30m': 30,
  '1h':  60,
  '2h':  120,
  '4h':  240,
  '1D':  1440,
};

// Aggregate the first `limit` M1 bars into the target timeframe.
// Processes in-place up to limit to avoid a slice copy.
export function aggregateBars(m1Bars, tf, limit) {
  const n = limit !== undefined ? Math.min(limit, m1Bars.length) : m1Bars.length;
  if (n === 0) return [];

  if (tf === '1m') {
    return limit !== undefined ? m1Bars.slice(0, n) : m1Bars;
  }

  const sec     = TF_SECONDS[tf] ?? 60;
  const buckets = new Map();

  for (let i = 0; i < n; i++) {
    const bar    = m1Bars[i];
    const bucket = Math.floor(bar.time / sec) * sec;
    const b      = buckets.get(bucket);
    if (!b) {
      buckets.set(bucket, {
        time:   bucket,
        open:   bar.open,
        high:   bar.high,
        low:    bar.low,
        close:  bar.close,
        volume: bar.volume ?? 0,
      });
    } else {
      if (bar.high > b.high) b.high = bar.high;
      if (bar.low  < b.low)  b.low  = bar.low;
      b.close  = bar.close;
      b.volume = (b.volume ?? 0) + (bar.volume ?? 0);
    }
  }

  return Array.from(buckets.values());
}
