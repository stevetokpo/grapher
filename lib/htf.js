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
  const bars = htfBars?.length ? htfBars : htfBarsFromCandles(candles, htfSec, htfOff);
  return htfValuePerBar(candles, htfSec, htfOff, bars, htfTrend(bars, bbLen, bbMult), 0);
}

// LE mécanisme non-repaint, isolé de ce qu'on calcule sur les bougies HTF.
//   values[j] est une grandeur quelconque attachée à bars[j] (tendance, RSI…).
//   out[i]    = values de la dernière bougie HTF CLÔTURÉE avant celle qui
//               contient candles[i], ou `absent` s'il n'y en a pas encore.
// Toutes les bougies du graphe d'un même bucket HTF portent donc la même valeur,
// et cette valeur est figée avant que le bucket ne s'ouvre : ce qui est affiché
// sur une bougie ne changera plus jamais.
export function htfValuePerBar(candles, htfSec, htfOff, bars, values, absent = null) {
  const n = candles.length;
  const bucketOf = t => Math.floor((t - htfOff) / htfSec) * htfSec + htfOff;

  const out = new Array(n).fill(absent);
  let j = -1; // dernier index dont le bucket est STRICTEMENT antérieur à celui de i
  for (let i = 0; i < n; i++) {
    const b = bucketOf(candles[i].time);
    while (j + 1 < bars.length && bars[j + 1].time < b) j++;
    if (j >= 0) out[i] = values[j] ?? absent;
  }
  return out;
}

// Ce qu'il faut demander à /api/htf pour couvrir un graphe avec un HTF donné :
// assez de bougies HTF pour enjamber la fenêtre affichée, PLUS le `warmup` que
// consomme le calcul (Bollinger, RSI…) avant de produire sa première valeur.
//
// La borne `to` est le début du bucket courant : on ne sert que des bougies HTF
// CLÔTURÉES. Deux bénéfices — les calculs non-repaint ne lisent de toute façon
// que des bougies closes, et la requête ne change qu'au passage d'un bucket au
// lieu de changer à chaque bougie (essentiel en replay, où le curseur avance
// sans arrêt).
//
// Renvoie { key, sec, off, to, limit } — ou null si le HTF est inconnu.
export function htfSeriesRequest(key, candles, warmup) {
  const n = candles?.length ?? 0;
  const sec = HTF_SECONDS[key];
  if (!n || !sec) return null;

  const off   = HTF_OFFSET[key] ?? 0;
  const first = candles[0].time;
  const last  = candles[n - 1].time;
  const span  = Math.ceil((last - first) / sec) + 2;

  return {
    key, sec, off,
    to:    Math.floor((last - off) / sec) * sec + off,
    limit: Math.min(5000, span + warmup + 2),
  };
}

// Fusionne plusieurs listes de requêtes : une seule par HTF, celle qui demande
// le plus d'historique. Deux lecteurs du même HTF (un TRENDER en H4 et un RSIER
// en H4) ne déclenchent ainsi qu'un seul appel réseau.
export function mergeHtfRequests(...lists) {
  const byKey = new Map();
  for (const list of lists) {
    for (const r of list ?? []) {
      if (!r) continue;
      const prev = byKey.get(r.key);
      if (!prev || r.limit > prev.limit) byKey.set(r.key, r);
    }
  }
  return [...byKey.values()];
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
