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
