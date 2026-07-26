// POST /api/rfvg/probe — l'échelle de l'instrument, avant toute optimisation.
//
// Un TP de « 10 points » ne veut rien dire dans l'absolu : c'est 3 × l'ATR d'une
// bougie M15 sur XAUUSD et une poussière sur Volatility 75. Balayer la même
// grille de points sur deux symboles, c'est balayer deux choses différentes et
// comparer les résultats n'a aucun sens. Cette sonde donne les multiplicateurs à
// utiliser : ATR médian au TF, amplitude médiane, et surtout la distribution du
// RISQUE STRUCTUREL réel (distance entrée → stop) — c'est elle qui fixe l'échelle
// utile du TP, puisque le seuil de rentabilité dépend du rapport TP / risque.
//
// Donne aussi la dérive buy & hold sur la fenêtre : plusieurs symboles de cette
// base sont des indices synthétiques à tendance (Trek Up, Boom, Step…). Sur eux
// n'importe quel biais long imprime des points, et une stratégie qui gagne moins
// que la dérive ne gagne rien.

import { loadZones, toEpoch, windowPositions, TF_SECONDS } from '../../../lib/rfvg/data';
import { simulatePositions } from '../../../lib/rfvg/simulate';
import { DETECT_SCHEMA, EXIT_SCHEMA, sanitize } from '../../../lib/rfvg/params';
import { query } from '../../../lib/db';

// Le spread réel du broker est DANS les données : l'export MT5 le donne bougie
// par bougie (bars_m1.spread), en points MT5 — c'est-à-dire en multiples de
// _Point, pas en unités de prix. Le convertir demande le nombre de décimales de
// l'instrument, qu'on retrouve en comptant celles des prix eux-mêmes (MT5 écrit
// exactement `Digits` décimales). Sans cette conversion on comparerait un spread
// de « 30 » à un TP de 66 unités de prix, soit deux échelles sans rapport.
function digitsOf(bars) {
  let d = 0;
  const step = Math.max(1, Math.floor(bars.length / 500));
  for (let i = 0; i < bars.length; i += step) {
    const s = String(bars[i].close);
    const dot = s.indexOf('.');
    if (dot >= 0 && s.length - dot - 1 > d) d = s.length - dot - 1;
    if (d >= 8) break;
  }
  return d;
}

// Min/max par balayage, PAS par Math.min(...tableau) : sur du 1m, la fenêtre
// dépasse 200 000 bougies et l'étalement des arguments fait sauter la pile
// d'appel (« Maximum call stack size exceeded »).
const extent = (arr, get) => {
  let lo = Infinity, hi = -Infinity;
  for (const v of arr) { const x = get(v); if (x < lo) lo = x; if (x > hi) hi = x; }
  return { lo, hi };
};

const quantile = (sorted, q) => {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1));
  return sorted[i];
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const b = req.body ?? {};
    const symbolId = Number(b.symbolId);
    if (!Number.isFinite(symbolId)) return res.status(400).json({ error: 'symbolId requis' });
    const tf = b.tf ?? '15m';

    const det = sanitize(DETECT_SCHEMA, b.detect ?? {});
    const from = toEpoch(b.from);
    const to   = toEpoch(b.to);

    const { candles, ranges, m1, zones } = await loadZones(symbolId, tf, det.params);

    const win = candles.filter(c =>
      (from == null || c.time >= from) && (to == null || c.time < to));
    if (!win.length) return res.status(400).json({ error: 'aucune bougie dans la fenêtre' });

    // Amplitude par bougie — l'ATR de Wilder est déjà utilisé par la détection ;
    // ici c'est l'échelle brute qu'on veut, la médiane suffit et ne se laisse pas
    // tirer par une bougie de nouvelle.
    const rangesPts = win.map(c => c.high - c.low).sort((a, c) => a - c);

    // Risque structurel réel : on simule avec un TP volontairement énorme pour
    // que la mesure porte sur TOUTES les zones, sans qu'un TP serré n'en écarte.
    const probe = simulatePositions(candles, zones, {
      ...sanitize(EXIT_SCHEMA, { slMarginPts: b.slMarginPts ?? 2, tpPts: 1e9 }).params,
      fills: 'bar', m1: { bars: m1, ranges },
    });
    const risks = windowPositions(probe, from, to).map(p => p.risk0).sort((a, c) => a - c);

    const zonesWin = zones.filter(z =>
      z.entryTime != null && (from == null || z.entryTime >= from) && (to == null || z.entryTime < to));
    const days = (win[win.length - 1].time - win[0].time) / 86400 || 1;

    const first = win[0], last = win[win.length - 1];

    // Spread observé sur la fenêtre, tel que le broker l'a écrit dans l'export.
    const where = [`symbol_id = ${Number(symbolId)}`,
      from != null ? `epoch(ts) >= ${from}` : null,
      to   != null ? `epoch(ts) <  ${to}`   : null].filter(Boolean).join(' AND ');
    const [sp] = await query(`
      SELECT median(spread)::DOUBLE AS med,
             quantile_cont(spread, 0.9)::DOUBLE AS p90,
             max(spread)::DOUBLE AS mx,
             avg(spread)::DOUBLE AS avg
      FROM bars_m1 WHERE ${where}
    `);
    const digits = digitsOf(m1);
    const point  = Math.pow(10, -digits);
    const spread = sp && sp.med != null ? {
      digits, point,
      mt5Median: Number(sp.med), mt5P90: Number(sp.p90), mt5Max: Number(sp.mx),
      // C'est CE chiffre qui se met dans `spreadPoints` : même unité que le TP.
      priceMedian: +(Number(sp.med) * point).toFixed(digits + 2),
      priceP90:    +(Number(sp.p90) * point).toFixed(digits + 2),
    } : null;

    res.json({
      symbolId, tf,
      window: { from: first.time, to: last.time, days: +days.toFixed(1) },
      candles: win.length,
      price: { first: first.open, last: last.close,
               min: extent(win, c => c.low).lo, max: extent(win, c => c.high).hi },
      // Buy & hold sur la fenêtre, en points : le repère minimal d'un instrument
      // à dérive. Une stratégie longue qui fait moins que ça ne fait rien.
      buyHoldPts: +(last.close - first.open).toFixed(4),
      spread,
      barRange: {
        median: quantile(rangesPts, 0.5),
        p25: quantile(rangesPts, 0.25), p75: quantile(rangesPts, 0.75), p90: quantile(rangesPts, 0.9),
      },
      // Le nerf du calibrage : le TP se raisonne en multiples de CE risque.
      risk: {
        n: risks.length,
        median: quantile(risks, 0.5),
        p10: quantile(risks, 0.1), p25: quantile(risks, 0.25),
        p75: quantile(risks, 0.75), p90: quantile(risks, 0.9),
        min: risks[0] ?? null, max: risks[risks.length - 1] ?? null,
      },
      signals: {
        zones: zonesWin.length,
        perDay: +(zonesWin.length / days).toFixed(2),
        bull: zonesWin.filter(z => z.side === 'bull').length,
        bear: zonesWin.filter(z => z.side === 'bear').length,
      },
      detect: det.params,
    });
  } catch (err) {
    console.error('[rfvg/probe]', err);
    res.status(500).json({ error: err.message });
  }
}
