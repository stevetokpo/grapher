// ── Source extraction ─────────────────────────────────────────────────────────

export function getSource(bar, source) {
  switch (source) {
    case 'open':  return bar.open;
    case 'high':  return bar.high;
    case 'low':   return bar.low;
    case 'hl2':   return (bar.high + bar.low) / 2;
    case 'hlc3':  return (bar.high + bar.low + bar.close) / 3;
    case 'ohlc4': return (bar.open + bar.high + bar.low + bar.close) / 4;
    default:      return bar.close;
  }
}

// ── Algorithms ────────────────────────────────────────────────────────────────

function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  // Seed with SMA of first `period` bars
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function wma(values, period) {
  const out = new Array(values.length).fill(null);
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += values[i - period + 1 + j] * (j + 1);
    out[i] = sum / denom;
  }
  return out;
}

// ── RSI (Wilder's smoothing) ──────────────────────────────────────────────────

export function calcRSI(candles, { period = 14, source = 'close' }) {
  if (!candles?.length || period < 2 || candles.length <= period) return [];

  const values = candles.map(c => getSource(c, source));
  const n      = values.length;

  // Gains/losses per bar
  const gains  = new Array(n).fill(0);
  const losses = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gains[i]  = d;
    else       losses[i] = -d;
  }

  // Seed: simple average of first `period` bars
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) { avgGain += gains[i]; avgLoss += losses[i]; }
  avgGain /= period;
  avgLoss /= period;

  const rsiAt = (aG, aL) => aL === 0 ? 100 : 100 - 100 / (1 + aG / aL);

  const result = [{ time: candles[period].time, value: rsiAt(avgGain, avgLoss) }];

  // Wilder's smoothed average for remaining bars
  for (let i = period + 1; i < n; i++) {
    avgGain = (avgGain * (period - 1) + gains[i])  / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    result.push({ time: candles[i].time, value: rsiAt(avgGain, avgLoss) });
  }

  return result;
}

// ── Bollinger Bands ───────────────────────────────────────────────────────────

export function calcBB(candles, { period = 20, stdDev = 2, offset = 0, source = 'close' }) {
  if (!candles?.length || period < 2) return { upper: [], middle: [], lower: [] };

  const values = candles.map(c => getSource(c, source));
  const n      = values.length;

  const upper  = [];
  const middle = [];
  const lower  = [];

  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i < period - 1) continue;

    const ti = i + offset;
    if (ti < 0 || ti >= n) continue;

    const avg = sum / period;

    // Population standard deviation
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j] - avg;
      variance += d * d;
    }
    const sd   = Math.sqrt(variance / period);
    const time = candles[ti].time;

    upper.push({ time, value: avg + stdDev * sd });
    middle.push({ time, value: avg });
    lower.push({ time, value: avg - stdDev * sd });
  }

  return { upper, middle, lower };
}

// ── Swing High / Swing Low ────────────────────────────────────────────────────
// A swing high at index i: candles[i].high is strictly greater than all highs
// in the leftBars bars before it AND the rightBars bars after it.
// Mirror logic for swing low (strictly smaller low).

export function calcSwings(candles, { leftBars = 5, rightBars = 5 }) {
  const highs = [];
  const lows  = [];
  const n     = candles.length;

  for (let i = leftBars; i < n - rightBars; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    let isHigh = true, isLow = true;

    for (let j = i - leftBars; j < i; j++) {
      if (candles[j].high >= h) isHigh = false;
      if (candles[j].low  <= l) isLow  = false;
      if (!isHigh && !isLow) break;
    }
    for (let j = i + 1; j <= i + rightBars; j++) {
      if (candles[j].high >= h) isHigh = false;
      if (candles[j].low  <= l) isLow  = false;
      if (!isHigh && !isLow) break;
    }

    if (isHigh) highs.push({ time: candles[i].time, value: h });
    if (isLow)  lows.push({  time: candles[i].time, value: l });
  }

  return { highs, lows };
}

// ── Public entry point ────────────────────────────────────────────────────────

// Returns an array of { time, value } ready for lightweight-charts setData()
export function calcMA(candles, { type, period, source }) {
  if (!candles?.length || period < 2) return [];
  const values = candles.map(c => getSource(c, source));

  let raw;
  switch (type) {
    case 'EMA': raw = ema(values, period); break;
    case 'WMA': raw = wma(values, period); break;
    default:    raw = sma(values, period); break;
  }

  const result = [];
  for (let i = 0; i < candles.length; i++) {
    if (raw[i] !== null) result.push({ time: candles[i].time, value: raw[i] });
  }
  return result;
}
