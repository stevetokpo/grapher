export function generateCandles(count, basePrice, intervalSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const candles = [];
  let price = basePrice;

  for (let i = count; i >= 0; i--) {
    const time = now - i * intervalSeconds;
    const volatility = price * 0.0025;
    const drift = (Math.random() - 0.49) * volatility;
    const open = price;
    const close = Math.max(0.0001, open + drift);
    const wickExtent = Math.random() * volatility;
    const high = Math.max(open, close) + wickExtent * Math.random();
    const low = Math.min(open, close) - wickExtent * Math.random();
    const volume = price * (0.0003 + Math.random() * 0.002);

    candles.push({ time, open, high, low, close, volume });
    price = close;
  }

  return candles;
}

// Group consecutive same-direction candles into single "trend" candles.
// A candle is bullish when close >= open, bearish otherwise. Runs of the same
// direction are merged into one bar: open = first.open, close = last.close,
// high/low = extremes of the run, volume = sum. The series is no longer
// time-regular — e.g. H B H H B HHHHH BB → H B H B H B (alternating).
// Each merged bar keeps its FIRST candle's time, which stays unique and
// strictly ascending so lightweight-charts renders it correctly.
export function groupCandles(candles) {
  if (!candles?.length) return [];
  const dir = c => (c.close >= c.open ? 1 : -1);
  const grouped = [];
  let cur = null;
  let curDir = 0;

  for (const c of candles) {
    const d = dir(c);
    if (!cur || d !== curDir) {
      if (cur) grouped.push(cur);
      cur = {
        time:   c.time,
        open:   c.open,
        high:   c.high,
        low:    c.low,
        close:  c.close,
        volume: c.volume ?? 0,
        count:  1, // number of source candles merged into this bar
      };
      curDir = d;
    } else {
      cur.high    = Math.max(cur.high, c.high);
      cur.low     = Math.min(cur.low,  c.low);
      cur.close   = c.close;
      cur.volume += c.volume ?? 0;
      cur.count  += 1;
    }
  }
  if (cur) grouped.push(cur);
  return grouped;
}

export function calcStats(candles) {
  if (!candles.length) return null;
  const last = candles[candles.length - 1];
  const slice24 = candles.slice(-Math.min(24, candles.length));
  return {
    price: last.close,
    open24h: slice24[0].open,
    change: ((last.close - slice24[0].open) / slice24[0].open) * 100,
    high24h: Math.max(...slice24.map(c => c.high)),
    low24h: Math.min(...slice24.map(c => c.low)),
    volume24h: slice24.reduce((s, c) => s + c.volume, 0),
  };
}
