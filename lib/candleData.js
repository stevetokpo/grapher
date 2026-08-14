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

// Heikin Ashi — « barres moyennes ». Chaque bougie est LISSÉE par la précédente :
//   haClose = (o + h + l + c) / 4
//   haOpen  = (haOpen précédent + haClose précédent) / 2   (première : (o + c) / 2)
//   haHigh  = max(h, haOpen, haClose)   haLow = min(l, haOpen, haClose)
// La série garde les TEMPS et les VOLUMES d'origine — une bougie source, une
// bougie HA —, seuls les quatre prix changent. Deux conséquences à connaître :
//   • les prix affichés ne sont plus des prix traités. Un haOpen est une moyenne,
//     aucun ordre n'a été rempli à ce niveau ;
//   • la première bougie de la fenêtre amorce la récurrence sur elle-même. En
//     chargeant de l'historique vers la gauche, les toutes premières bougies HA
//     changent donc un peu — c'est inhérent au calcul, pas un bug.
// Les prix réels sont conservés dans `src` : ce qui a besoin du vrai marché (une
// infobulle, un export) peut les retrouver sans recharger.
export function heikinAshi(candles) {
  if (!candles?.length) return [];
  const out = [];
  let prevOpen = null, prevClose = null;

  for (const c of candles) {
    const haClose = (c.open + c.high + c.low + c.close) / 4;
    const haOpen  = prevOpen == null ? (c.open + c.close) / 2 : (prevOpen + prevClose) / 2;
    out.push({
      time:   c.time,
      open:   haOpen,
      high:   Math.max(c.high, haOpen, haClose),
      low:    Math.min(c.low,  haOpen, haClose),
      close:  haClose,
      volume: c.volume ?? 0,
      src:    { open: c.open, high: c.high, low: c.low, close: c.close },
    });
    prevOpen  = haOpen;
    prevClose = haClose;
  }
  return out;
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
