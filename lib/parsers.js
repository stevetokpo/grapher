// MT5 export filename patterns:
//   Bars  : {SYMBOL}_{TIMEFRAME}_{FROM12}_{TO12}.csv   e.g. "Volatility 75 Index_M1_202606140100_202606140110.csv"
//   Ticks : {SYMBOL}_{FROM12}_{TO12}.csv               e.g. "Volatility 75 Index_202606140100_202606140108.csv"
//
// MT5 timeframe codes: M1 M2 M3 M4 M5 M6 M10 M12 M15 M20 M30 H1 H2 H3 H4 H6 H8 H12 D1 W1 MN

const TF_RE = /^(M[0-9]+|H[0-9]+|D1|W1|MN)$/;
const TS_RE = /^\d{12}$/; // YYYYMMDDhhmm

export function parseFilename(filename) {
  const base = filename.replace(/\.csv$/i, '');

  // MT5 uses underscores as separators — but the symbol name may also contain spaces.
  // We split on '_' then work backwards: the two trailing segments are timestamps,
  // and the segment just before them may be a timeframe code.
  const parts = base.split('_');

  // Identify timestamp positions from the right
  const tsIdx = [];
  for (let i = parts.length - 1; i >= 0; i--) {
    if (TS_RE.test(parts[i])) tsIdx.unshift(i);
    else break;
  }

  if (tsIdx.length < 2) return null;

  const fromStr = parts[tsIdx[0]];
  const toStr   = parts[tsIdx[1]];
  const prefix  = parts.slice(0, tsIdx[0]); // everything before timestamps

  // Does the last prefix segment look like a timeframe code?
  const lastPre = prefix[prefix.length - 1] ?? '';
  if (TF_RE.test(lastPre)) {
    return {
      symbol:    prefix.slice(0, -1).join('_'),
      timeframe: lastPre,  // e.g. "M1"
      type:      'bars',
      from:      fromStr,
      to:        toStr,
    };
  }

  return {
    symbol:    prefix.join('_'),
    timeframe: null,
    type:      'ticks',
    from:      fromStr,
    to:        toStr,
  };
}

// Detect file type from CSV header line (tab-separated MT5 format)
export function detectCsvType(headerLine) {
  const cols = headerLine.split('\t').map(c => c.trim().replace(/[<>]/g, '').toUpperCase());
  if (cols.includes('OPEN'))  return 'bars';
  if (cols.includes('BID'))   return 'ticks';
  return 'unknown';
}

// Map MT5 timeframe code → display label used in the UI
export const TF_LABEL = {
  M1: '1m', M5: '5m', M15: '15m', M30: '30m',
  H1: '1h', H4: '4h', D1: '1D', W1: '1W', MN: '1M',
};
