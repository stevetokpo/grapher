// Twins Bars: two consecutive candles that are both "full" and of similar size,
// preceded by a compression phase of wick-dominant candles, and large vs ATR.
//
// Rule 1 — Full candle: body >= upper_wick + lower_wick
// Rule 2 — Similar size: min(body1, body2) / max(body1, body2) >= 0.7
// Rule 3 — Compression (lookback > 0): each of the `lookback` candles before the
//           pair must be wick-dominant: body < upper_wick + lower_wick
// Rule 4 — Size (atrPeriod > 0): both TB bodies > ATR(atrPeriod) * atrMult,
//           ATR computed on the candles ending just before the pair.
// direction: 'bull' (bear→bull) | 'bear' (bull→bear) | 'both'
export function calcTwinsBars(candles, { direction = 'both', lookback = 4, atrPeriod = 7, atrMult = 1.5, similarityRatio = 0.7 } = {}) {
  const results = [];
  const n = candles.length;

  function isFull(bar) {
    const body      = Math.abs(bar.close - bar.open);
    const upperWick = bar.high - Math.max(bar.open, bar.close);
    const lowerWick = Math.min(bar.open, bar.close) - bar.low;
    return body > 0 && body >= upperWick + lowerWick;
  }

  function isWickDominant(bar) {
    const body      = Math.abs(bar.close - bar.open);
    const upperWick = bar.high - Math.max(bar.open, bar.close);
    const lowerWick = Math.min(bar.open, bar.close) - bar.low;
    return body < upperWick + lowerWick;
  }

  for (let i = 1; i < n; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];

    if (!isFull(prev) || !isFull(curr)) continue;

    const prevBody = Math.abs(prev.close - prev.open);
    const currBody = Math.abs(curr.close - curr.open);

    if (Math.min(prevBody, currBody) / Math.max(prevBody, currBody) < similarityRatio) continue;

    const isBull = prev.close < prev.open && curr.close > curr.open;
    const isBear = prev.close > prev.open && curr.close < curr.open;

    if (direction === 'bull' && !isBull) continue;
    if (direction === 'bear' && !isBear) continue;
    if (!isBull && !isBear) continue;

    // Rule 3 — each preceding candle must be wick-dominant.
    if (lookback > 0) {
      const start = i - 1 - lookback;
      if (start < 0) continue;
      let ok = true;
      for (let k = start; k < i - 1; k++) {
        if (!isWickDominant(candles[k])) { ok = false; break; }
      }
      if (!ok) continue;
    }

    // Rule 4 — both bodies > ATR(atrPeriod) * atrMult.
    // ATR window ends at i-2 (candle just before the pair).
    if (atrPeriod > 0) {
      const atrEnd   = i - 2;
      const atrBegin = atrEnd - atrPeriod + 1;
      if (atrBegin < 1) continue; // need prev close for first TR
      let sumTR = 0;
      for (let k = atrBegin; k <= atrEnd; k++) {
        sumTR += Math.max(
          candles[k].high - candles[k].low,
          Math.abs(candles[k].high - candles[k - 1].close),
          Math.abs(candles[k].low  - candles[k - 1].close),
        );
      }
      const threshold = (sumTR / atrPeriod) * atrMult;
      if (prevBody <= threshold || currBody <= threshold) continue;
    }

    results.push({
      time:  curr.time,
      value: isBull ? Math.min(prev.low, curr.low) : Math.max(prev.high, curr.high),
      side:  isBull ? 'bull' : 'bear',
    });
  }

  return results;
}

// Fair Value Gap (FVG) + inverse FVG (iFVG) — drawn as price zones, not markers.
//
// A FVG is a 3-candle imbalance between candle[i-1] and candle[i+1] (the middle
// candle being the impulse that left the gap):
//   • Bullish: candle[i+1].low  > candle[i-1].high  (untraded gap below price)
//   • Bearish: candle[i+1].high < candle[i-1].low   (untraded gap above price)
//
// Lifecycle, by scanning the candles formed after the gap:
//   active     — price has not re-entered the gap
//   mitigated  — a wick tapped into the gap (kept on screen, but greyed)
//   inverse    — a candle CLOSED through the far side: the FVG flips into an
//                iFVG of the opposite bias (old support becomes resistance, …)
//                keeping the same price levels but starting at the break.
//
// Each zone: { side, state, top, bottom, startTime, endTime }
//   top/bottom  price bounds (top > bottom)
//   endTime     null → the box extends to the right edge of the chart
//
// Options:
//   direction      'bull' | 'bear' | 'both'
//   showMitigated  include greyed (touched / consumed) gaps   (default true)
//   showInverse    emit iFVG zones on a close-through          (default true)
export function calcFVG(candles, { direction = 'both', showMitigated = true, showInverse = true, maxLen = 0 } = {}) {
  const zones = [];
  const n = candles.length;

  // If maxLen > 0, cap an open-ended zone so it stops at startIdx + maxLen.
  // Already-bounded zones (endTime !== null) are left untouched.
  const capEnd = (startIdx, endTime) => {
    if (!maxLen || endTime !== null) return endTime;
    const capIdx = startIdx + maxLen;
    return capIdx < n ? candles[capIdx].time : null;
  };

  for (let i = 1; i < n - 1; i++) {
    const a = candles[i - 1];
    const c = candles[i + 1];

    let side, bottom, top;
    if (c.low > a.high)      { side = 'bull'; bottom = a.high;  top = c.low; }
    else if (c.high < a.low) { side = 'bear'; bottom = c.high;  top = a.low; }
    else continue;

    if (direction === 'bull' && side !== 'bull') continue;
    if (direction === 'bear' && side !== 'bear') continue;

    const startTime = candles[i].time;

    // First wick to tap the gap (mitigation) and first close through it (inversion).
    let touched = false, invIdx = -1;
    for (let j = i + 2; j < n; j++) {
      const k = candles[j];
      const tapped = side === 'bull' ? k.low  <= top    : k.high >= bottom;
      const closed = side === 'bull' ? k.close < bottom : k.close > top;
      if (tapped) touched = true;
      if (closed) { invIdx = j; break; }
    }

    if (invIdx === -1) {
      if (!touched) {
        zones.push({ side, state: 'active', top, bottom, startTime, endTime: capEnd(i, null) });
      } else if (showMitigated) {
        zones.push({ side, state: 'mitigated', top, bottom, startTime, endTime: capEnd(i, null) });
      }
      continue;
    }

    // Closed through → original FVG is consumed up to the break candle…
    const invTime = candles[invIdx].time;
    if (showMitigated) {
      zones.push({ side, state: 'mitigated', top, bottom, startTime, endTime: invTime });
    }
    // …and an inverse FVG of the opposite bias takes over from the break.
    if (showInverse) {
      const invSide = side === 'bull' ? 'bear' : 'bull';
      let ifvgEnd = null;
      for (let j = invIdx + 1; j < n; j++) {
        const k = candles[j];
        const broke = invSide === 'bull' ? k.close < bottom : k.close > top;
        if (broke) { ifvgEnd = k.time; break; }
      }
      zones.push({ side: invSide, state: 'inverse', top, bottom, startTime: invTime, endTime: capEnd(invIdx, ifvgEnd) });
    }
  }

  return zones;
}

// HBH / BHB — 3-candle reversal where the 1st and 3rd candles FULLY ENGULF the
// middle candle's whole range (body + wicks), and the 3rd candle closes FULLY
// through the middle:
//   • HBH (bull-bear-bull): 3rd closes ABOVE the middle's high  → bullish zone
//   • BHB (bear-bull-bear): 3rd closes BELOW the middle's low    → bearish zone
// Each zone spans the middle candle's high–low range, drawn as a box. Because it
// reads the candles prop, it works on raw candles AND on grouped trend candles.
//
// Offsets (matching the Pine source): a = 1st outer, m = middle, c = 3rd (current).
//
// Options:
//   direction  'bull' (HBH) | 'bear' (BHB) | 'both'
//   engMult    1st & 3rd total range (high-low) must be >= engMult × the
//              middle's total range, AND each must contain it fully (default 1.5)
//   extLen     zone width in bars to the right of the middle candle (default 20)
//
// Each zone: { side, top, bottom, mid, startTime, endTime }
//   endTime null → extends to the right chart edge (extLen ran past the data)
export function calcHBHBHB(candles, { direction = 'both', engMult = 1.5, extLen = 20 } = {}) {
  const zones = [];
  const n = candles.length;

  for (let i = 2; i < n; i++) {
    const a = candles[i - 2]; // 1st  (outer, engulfing)
    const m = candles[i - 1]; // middle (small, opposite)
    const c = candles[i];     // 3rd  (confirming, current)

    // 1st & 3rd must each fully ENGULF the middle's entire range (body + wicks)…
    const engulfA = a.high >= m.high && a.low <= m.low;
    const engulfC = c.high >= m.high && c.low <= m.low;
    // …and each be at least engMult × the middle candle's total range.
    const mRange = m.high - m.low;
    const sizeOk = mRange > 0
      && (a.high - a.low) >= engMult * mRange
      && (c.high - c.low) >= engMult * mRange;
    if (!engulfA || !engulfC || !sizeOk) continue;

    const bullA = a.close > a.open, bearA = a.close < a.open;
    const bullM = m.close > m.open, bearM = m.close < m.open;
    const bullC = c.close > c.open, bearC = c.close < c.open;

    // 3rd candle must close entirely through the middle candle's range.
    const hbh = bullA && bearM && bullC && c.open <= m.high && c.close > m.high;
    const bhb = bearA && bullM && bearC && c.open >= m.low  && c.close < m.low;

    let side;
    if (hbh && direction !== 'bear')      side = 'bull';
    else if (bhb && direction !== 'bull') side = 'bear';
    else continue;

    const endIdx = (i - 1) + extLen; // box left = middle candle, spans extLen bars
    zones.push({
      side,
      top:       m.high,
      bottom:    m.low,
      mid:       (m.high + m.low) / 2,
      startTime: m.time,
      endTime:   endIdx < n ? candles[endIdx].time : null,
    });
  }

  return zones;
}

// HBHB / BHBH — 4-candle pattern designed for grouped alternating candles.
//
// Candle roles (indices i-3 … i):
//   HBHB: Bull(1) → Bear(2) → Bull(3) → Bear(4)
//   BHBH: Bear(1) → Bull(2) → Bear(3) → Bull(4)
//
// Conditions:
//   1. body(1) >= bodyMult × body(2)  AND  body(3) >= bodyMult × body(2)
//   2. HBHB: candle(4).close < candle(2).open  (4th breaks below B2 open)
//      BHBH: candle(4).close > candle(2).open  (4th breaks above B2 open)
//
// Zone: high–low of candle(2), starting at candle(2).time, spanning extLen bars.
//   HBHB → side 'bull'   BHBH → side 'bear'
//
// Options:
//   direction  'bull' (HBHB) | 'bear' (BHBH) | 'both'  (default 'both')
//   bodyMult   body(1) and body(3) must be ≥ bodyMult × body(2)  (default 1.5)
//   extLen     zone width in bars to the right of candle(2)       (default 20)
export function calcHBHB(candles, { direction = 'both', bodyMult = 1.5, extLen = 20 } = {}) {
  const zones = [];
  const n = candles.length;

  for (let i = 3; i < n; i++) {
    const a = candles[i - 3]; // 1st
    const b = candles[i - 2]; // 2nd  (zone source)
    const c = candles[i - 1]; // 3rd
    const d = candles[i];     // 4th  (confirming)

    const bullA = a.close > a.open;
    const bullB = b.close > b.open;
    const bullC = c.close > c.open;
    const bullD = d.close > d.open;

    const isHBHB = bullA && !bullB && bullC && !bullD;
    const isBHBH = !bullA && bullB && !bullC && bullD;

    if (!isHBHB && !isBHBH) continue;

    if (direction === 'bull' && !isHBHB) continue;
    if (direction === 'bear' && !isBHBH) continue;

    const bodyA = Math.abs(a.close - a.open);
    const bodyB = Math.abs(b.close - b.open);
    const bodyC = Math.abs(c.close - c.open);

    if (bodyB === 0) continue;
    if (bodyA < bodyMult * bodyB || bodyC < bodyMult * bodyB) continue;

    if (isHBHB && d.close >= b.open) continue;
    if (isBHBH && d.close <= b.open) continue;

    const endIdx = (i - 2) + extLen;
    zones.push({
      side:      isHBHB ? 'bull' : 'bear',
      top:       b.high,
      bottom:    b.low,
      startTime: b.time,
      endTime:   endIdx < n ? candles[endIdx].time : null,
    });
  }

  return zones;
}

// True Range per bar (tr[0] = 0, needs the previous close).
function trueRanges(candles) {
  const n = candles.length;
  const tr = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low  - candles[i - 1].close),
    );
  }
  return tr;
}

// Wilder's ATR (RMA of TR), seeded with the SMA of the first `period` TRs.
// Returns an array aligned to candles; entries before the seed are NaN.
function wilderATR(candles, period) {
  const n = candles.length;
  const atr = new Array(n).fill(NaN);
  if (n < period + 1) return atr;
  const tr = trueRanges(candles);
  let seed = 0;
  for (let i = 1; i <= period; i++) seed += tr[i];
  atr[period] = seed / period;
  for (let i = period + 1; i < n; i++) atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  return atr;
}

// Build a finished zone from a flat run [s..e] and an optional breakout bar.
function makeZone(candles, s, e, brokeIdx, extendToBreak) {
  const n = candles.length;
  let top = -Infinity, bottom = Infinity;
  for (let k = s; k <= e; k++) {
    if (candles[k].high > top)    top = candles[k].high;
    if (candles[k].low  < bottom) bottom = candles[k].low;
  }

  let side = null, breakTime = null, breakPrice = null, endIdx = e;
  if (brokeIdx >= 0) {
    const b = candles[brokeIdx];
    side = b.close > top ? 'up'
         : b.close < bottom ? 'down'
         : (b.close >= b.open ? 'up' : 'down');
    breakTime = b.time; breakPrice = b.close; endIdx = brokeIdx;
  }

  let endTime;
  if (side) endTime = candles[extendToBreak ? endIdx : e].time;
  else      endTime = e >= n - 1 ? null : candles[e].time; // open only at the live edge

  return { state: side ? 'fired' : 'forming', side, top, bottom, startTime: candles[s].time, endTime, breakTime, breakPrice };
}

// ── ATR-flat detector (default) ───────────────────────────────────────────────
// Compression = the ATR sits FLAT over a stretch of bars (volatility frozen),
// then a bar makes a BRUSQUE expansion (the ATR "changes direction" from flat to
// rising) → that spike is the breakout. Scale-free: thresholds are relative to
// the local ATR level, so no price units are hard-coded.
//
//   • flatness is per-bar via a trailing window of `minLength` ATR values: the
//     bar is "flat" when (max−min) ≤ flatTol × mean over that window. Using a
//     window (not a running mean) rejects BOTH spikes and slow drift, so a zone
//     only starts once the ATR has truly settled — Wilder's ATR is laggy and
//     ramps for ~period bars after any move.
//   • consecutive flat bars form the zone; covered bars span the whole window.
//   • breakout = the first bar after the run whose TRUE RANGE ≥ flatATR ×
//     breakMult. We test TR (instantaneous), not the smoothed ATR, because the
//     ATR itself reacts too slowly to flag a sudden expansion in time.
//     Direction comes from that candle's close vs the box.
//
// Options: atrPeriod (14), flatTol (0.12 = ±12 %), breakMult (1.8× the flat ATR),
//          minLength (6), extendToBreak (true).
function atrFlatZones(candles, { atrPeriod = 14, flatTol = 0.12, breakMult = 1.8, minLength = 6, extendToBreak = true }) {
  const zones = [];
  const n = candles.length;
  const atr = wilderATR(candles, atrPeriod);
  const tr  = trueRanges(candles);
  const win = Math.max(2, minLength);

  // Per-bar flat flag: ATR dispersion over the trailing `win` bars is tight.
  const flat = new Array(n).fill(false);
  for (let i = atrPeriod + win - 1; i < n; i++) {
    let mn = Infinity, mx = -Infinity, sum = 0, ok = true;
    for (let k = i - win + 1; k <= i; k++) {
      const a = atr[k];
      if (isNaN(a)) { ok = false; break; }
      if (a < mn) mn = a;
      if (a > mx) mx = a;
      sum += a;
    }
    if (!ok) continue;
    const mean = sum / win;
    flat[i] = mean > 0 && (mx - mn) <= flatTol * mean;
  }

  let i = 0;
  while (i < n) {
    if (!flat[i]) { i++; continue; }
    let e = i;
    while (e + 1 < n && flat[e + 1]) e++;

    // flat[k] means the window ENDING at k is flat → covered bars start `win-1` back.
    const s = i - win + 1;

    // Reference ATR over the flat stretch, then look for the breakout spike.
    let refSum = 0;
    for (let k = s; k <= e; k++) refSum += atr[k];
    const ref = refSum / (e - s + 1);

    let brokeIdx = -1;
    for (let j = e + 1; j < n; j++) {
      if (tr[j] >= ref * breakMult) { brokeIdx = j; break; } // brusque expansion = breakout
      if (flat[j]) break;                                    // settled again without a spike
    }

    if (e - s + 1 >= minLength) zones.push(makeZone(candles, s, e, brokeIdx, extendToBreak));

    i = brokeIdx >= 0 ? brokeIdx + 1 : e + 1;
  }

  return zones;
}

// ── TTM Squeeze detector (Bollinger Bands inside Keltner Channels) ─────────────
// squeeze ON when BB(length,bbMult·σ) sits fully inside KC(length,kcMult·ATR).
// Consecutive squeeze bars form a box; it fires on the first later bar that
// CLOSES outside [bottom, top]. Options: length (20), bbMult (2), kcMult (1.5),
// minLength (6), extendToBreak (true).
function squeezeZones(candles, { length = 20, bbMult = 2, kcMult = 1.5, minLength = 6, extendToBreak = true }) {
  const zones = [];
  const n = candles.length;
  if (n < length + 1) return zones;
  const tr = trueRanges(candles);

  const squeeze = new Array(n).fill(false);
  for (let i = length; i < n; i++) {
    let sumC = 0;
    for (let k = i - length + 1; k <= i; k++) sumC += candles[k].close;
    const mean = sumC / length;

    let sumSq = 0, sumTR = 0;
    for (let k = i - length + 1; k <= i; k++) {
      const d = candles[k].close - mean;
      sumSq += d * d;
      sumTR += tr[k];
    }
    const stdev = Math.sqrt(sumSq / length);
    const atr   = sumTR / length;
    squeeze[i] = (mean + bbMult * stdev) < (mean + kcMult * atr)
              && (mean - bbMult * stdev) > (mean - kcMult * atr);
  }

  let s = 0;
  while (s < n) {
    if (!squeeze[s]) { s++; continue; }
    let e = s;
    while (e + 1 < n && squeeze[e + 1]) e++;

    if (e - s + 1 >= minLength) {
      // box bounds, then first post-run bar closing outside it
      let top = -Infinity, bottom = Infinity;
      for (let k = s; k <= e; k++) {
        if (candles[k].high > top)    top = candles[k].high;
        if (candles[k].low  < bottom) bottom = candles[k].low;
      }
      let brokeIdx = -1;
      for (let j = e + 1; j < n; j++) {
        if (candles[j].close > top || candles[j].close < bottom) { brokeIdx = j; break; }
      }
      zones.push(makeZone(candles, s, e, brokeIdx, extendToBreak));
    }
    s = e + 1;
  }

  return zones;
}

// Compression zones. Two interchangeable methods, same zone output shape:
//   mode 'atr'     — flat ATR then a brusque expansion (default)  → atrFlatZones
//   mode 'squeeze' — TTM Squeeze (Bollinger inside Keltner)        → squeezeZones
//
// Each zone: { state, side, top, bottom, startTime, endTime, breakTime, breakPrice }
//   state 'forming' — no clean breakout yet (open to the live edge)
//   state 'fired'   — broke out; side 'up'/'down', breakTime/breakPrice set
export function calcCompression(candles, opts = {}) {
  return (opts.mode === 'squeeze' ? squeezeZones : atrFlatZones)(candles, opts);
}
