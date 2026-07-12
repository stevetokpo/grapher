// Indicateurs vectorisés ALIGNÉS pour le moteur de backtest.
// Contrairement à lib/indicators.js (qui retourne des {time, value} filtrés pour
// lightweight-charts), chaque fonction retourne un tableau de même longueur que
// l'entrée, avec null avant la période de warm-up : ind[i] correspond toujours à
// candles[i], ce qui évite tout décalage d'index dans les stratégies.
// Par construction, ind[i] ne dépend que des bougies 0..i (pas de lookahead).

import { getSource } from '../indicators';

export function sourceArr(candles, source = 'close') {
  return candles.map(c => getSource(c, source));
}

export function smaArr(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function emaArr(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
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

export function wmaArr(values, period) {
  const out = new Array(values.length).fill(null);
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += values[i - period + 1 + j] * (j + 1);
    out[i] = sum / denom;
  }
  return out;
}

export function maArr(values, period, type = 'SMA') {
  switch (type) {
    case 'EMA': return emaArr(values, period);
    case 'WMA': return wmaArr(values, period);
    default:    return smaArr(values, period);
  }
}

// RSI de Wilder — même algorithme que lib/indicators.js calcRSI, sortie alignée.
export function rsiArr(values, period = 14) {
  const n = values.length;
  const out = new Array(n).fill(null);
  if (period < 2 || n <= period) return out;

  const rsiAt = (aG, aL) => aL === 0 ? 100 : 100 - 100 / (1 + aG / aL);

  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) avgGain += d;
    else       avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = rsiAt(avgGain, avgLoss);

  for (let i = period + 1; i < n; i++) {
    const d = values[i] - values[i - 1];
    const gain = d > 0 ?  d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = rsiAt(avgGain, avgLoss);
  }

  return out;
}

// ATR de Wilder (RMA du True Range), seedé par la SMA des `period` premiers TR.
export function atrArr(candles, period = 14) {
  const n = candles.length;
  const out = new Array(n).fill(null);
  if (n < period + 1) return out;

  const tr = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low  - candles[i - 1].close),
    );
  }

  let seed = 0;
  for (let i = 1; i <= period; i++) seed += tr[i];
  out[period] = seed / period;
  for (let i = period + 1; i < n; i++) {
    out[i] = (out[i - 1] * (period - 1) + tr[i]) / period;
  }
  return out;
}

// Croisement haussier de a au-dessus de b à l'index i (les deux doivent être définis).
export function crossOver(a, b, i) {
  return i > 0
    && a[i] != null && b[i] != null && a[i - 1] != null && b[i - 1] != null
    && a[i - 1] <= b[i - 1] && a[i] > b[i];
}

export function crossUnder(a, b, i) {
  return i > 0
    && a[i] != null && b[i] != null && a[i - 1] != null && b[i - 1] != null
    && a[i - 1] >= b[i - 1] && a[i] < b[i];
}
