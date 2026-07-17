// Biais de tendance sur une unité de temps supérieure (HTF), partagé par
// l'indicateur de graphe (lib/harmony.js) et la stratégie de backtest
// (lib/backtest/strategies/trenderHarmony.js) — une seule implémentation, donc
// le graphe et le backtest ne peuvent pas diverger.

// Unités de temps supérieures disponibles (notation MT5).
export const HTF_SECONDS = {
  M1:  60,     M2:  120,   M3:  180,   M4:  240,    M5:  300,
  M6:  360,    M10: 600,   M12: 720,   M15: 900,    M20: 1200,   M30: 1800,
  H1:  3600,   H2:  7200,  H3:  10800, H4:  14400,  H6:  21600,
  H8:  28800,  H12: 43200, H16: 57600,
  D1:  86400,  W1:  604800,
};

// Les buckets se calculent depuis l'époque Unix ; W1 doit être aligné sur le
// LUNDI (l'époque 0 tombe un jeudi → décalage jusqu'au premier lundi, 1970-01-05).
export const HTF_OFFSET = { W1: 345600 };

// Bougies HTF reconstruites par bucket depuis les bougies du graphe. Fallback :
// n'a d'historique que ce que le graphe a chargé. Le backtest s'en contente
// (il charge lui-même une marge de warm-up) ; le graphe, lui, préfère la série
// servie par /api/htf.
export function htfBarsFromCandles(candles, htfSec, htfOff) {
  const bucketOf = t => Math.floor((t - htfOff) / htfSec) * htfSec + htfOff;
  const out = [];
  for (const c of candles) {
    const b = bucketOf(c.time);
    const last = out[out.length - 1];
    if (!last || last.time !== b) out.push({ time: b, close: c.close });
    else last.close = c.close;   // le close du bucket = celui de sa dernière bougie
  }
  return out;
}

// Biais Bollinger de chaque bougie HTF : 1 / −1 / 0.
// Écart-type de population, comme Pine ta.stdev.
function htfTrend(htfBars, bbLen, bbMult) {
  const m = htfBars.length;
  const trend = new Array(m).fill(0);
  let sum = 0;
  for (let j = 0; j < m; j++) {
    sum += htfBars[j].close;
    if (j >= bbLen) sum -= htfBars[j - bbLen].close;
    if (j < bbLen - 1) continue;
    const mean = sum / bbLen;
    let variance = 0;
    for (let k = j - bbLen + 1; k <= j; k++) {
      const d = htfBars[k].close - mean;
      variance += d * d;
    }
    const dev = bbMult * Math.sqrt(variance / bbLen);
    trend[j] = htfBars[j].close > mean + dev ? 1 : htfBars[j].close < mean - dev ? -1 : 0;
  }
  return trend;
}

// Tendance HTF alignée par bougie du graphe.
//   out[i] = biais de la dernière bougie HTF CLÔTURÉE avant celle qui contient
//            candles[i]  — équivalent Pine request.security(expr[1], lookahead_on).
// NON-REPAINT : la valeur portée par une bougie ne change plus jamais ensuite.
//
// `htfBars` (optionnel) : la série HTF servie par /api/htf, qui a l'historique
// complet. Sans elle, la série est reconstruite depuis `candles` — même résultat
// dès lors que la fenêtre chargée est assez profonde.
//
// L'alignement se fait sur les TEMPS de bucket, jamais sur les positions de
// tableau : la série fournie s'arrête au dernier bucket clos, celle qui est
// reconstruite inclut le bucket courant (incomplet). Comparer des temps rend le
// calcul insensible à cette différence.
export function htfTrendPerBar(candles, htfSec, htfOff, bbLen, bbMult, htfBars = null) {
  const n = candles.length;
  const bucketOf = t => Math.floor((t - htfOff) / htfSec) * htfSec + htfOff;

  const bars  = htfBars?.length ? htfBars : htfBarsFromCandles(candles, htfSec, htfOff);
  const trend = htfTrend(bars, bbLen, bbMult);

  const out = new Array(n).fill(0);
  let j = -1; // dernier index dont le bucket est STRICTEMENT antérieur à celui de i
  for (let i = 0; i < n; i++) {
    const b = bucketOf(candles[i].time);
    while (j + 1 < bars.length && bars[j + 1].time < b) j++;
    out[i] = j >= 0 ? trend[j] : 0;
  }
  return out;
}

// "H1" → "1h", "M15" → "15min", "D1" → "1j" — étiquette du HTF confirmateur.
export function htfLabel(key) {
  const sec = HTF_SECONDS[key];
  if (!sec) return key;
  if (sec >= 604800) return `${sec / 604800}sem`;
  if (sec >= 86400)  return `${sec / 86400}j`;
  if (sec >= 3600)   return `${sec / 3600}h`;
  return `${sec / 60}min`;
}
