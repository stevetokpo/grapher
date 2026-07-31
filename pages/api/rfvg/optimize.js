// POST /api/rfvg/optimize — balaye une grille de réglages de SORTIE sur des
// zones détectées UNE seule fois.
//
// La détection est figée : elle ne fait pas partie de la grille (cf. le bloc de
// tête de lib/rfvg/params.js). Le coût d'une configuration se réduit donc à la
// simulation des positions, et une grille de plusieurs centaines de points
// tient en quelques secondes.
//
// Corps :
//   { symbolId, tf, detect, base, grid: { cle: "10:60:10" | [..] , ... },
//     window: { from, to }, evalWindows?: { nom: {from,to}, ... },
//     fills?, spreadPoints?, minTrades?, top? }
//
// `window` est la fenêtre de CLASSEMENT (in-sample). `evalWindows` rejoue les
// configurations retenues sur d'autres fenêtres — à n'utiliser qu'APRÈS avoir
// figé les paramètres : regarder l'out-of-sample pendant l'optimisation le
// brûle, et il n'y a pas de second OOS.
//
// Classement : `tStat` (espérance / écart-type × √n), jamais le winrate ni le
// total en points (cf. lib/rfvg/stats.js).

import { loadZones, toEpoch, windowPositions } from '../../../lib/rfvg/data';
import { simulatePositions } from '../../../lib/rfvg/simulate';
import { computeStats, summarize } from '../../../lib/rfvg/stats';
import { DETECT_SCHEMA, EXIT_SCHEMA, sanitize, expandValues } from '../../../lib/rfvg/params';

export const config = { api: { responseLimit: false } };

const MAX_COMBOS = 6000;

// Produit cartésien, ordre des clés préservé.
function cartesian(entries) {
  let out = [{}];
  for (const [key, values] of entries) {
    const next = [];
    for (const acc of out) for (const v of values) next.push({ ...acc, [key]: v });
    out = next;
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const t0 = Date.now();
  try {
    const b = req.body ?? {};
    const symbolId = Number(b.symbolId);
    if (!Number.isFinite(symbolId)) return res.status(400).json({ error: 'symbolId requis' });
    const tf = b.tf ?? '15m';

    const det  = sanitize(DETECT_SCHEMA, b.detect ?? {});
    const base = sanitize(EXIT_SCHEMA,   b.base   ?? {});
    const fills  = b.fills === 'm1' ? 'm1' : 'bar';
    const spread = Number(b.spreadPoints) || 0;
    const minTrades = Number(b.minTrades) ?? 0;

    const gridSpec = b.grid ?? {};
    const known = new Set(EXIT_SCHEMA.map(s => s.key));
    const entries = [];
    for (const [key, spec] of Object.entries(gridSpec)) {
      if (!known.has(key)) return res.status(400).json({ error: `paramètre inconnu dans la grille : ${key}` });
      const values = expandValues(spec);
      if (!values.length) return res.status(400).json({ error: `grille vide pour ${key}` });
      entries.push([key, values]);
    }
    const combos = entries.length ? cartesian(entries) : [{}];
    if (combos.length > MAX_COMBOS) {
      return res.status(400).json({ error: `${combos.length} configurations demandées, plafond ${MAX_COMBOS} — resserre la grille` });
    }

    const win  = b.window ?? {};
    const from = toEpoch(win.from);
    const to   = toEpoch(win.to);

    const evalWindows = Object.entries(b.evalWindows ?? {})
      .map(([name, w]) => [name, toEpoch(w.from), toEpoch(w.to)]);

    const { candles, ranges, m1, zones } = await loadZones(symbolId, tf, det.params);
    const m1Ctx = { bars: m1, ranges };

    const results = [];
    for (const combo of combos) {
      const params = { ...base.params, ...combo };
      // Les valeurs de grille passent par le même clamp que les autres : une
      // borne franchie doit se voir, pas se corriger en douce.
      const { params: clean } = sanitize(EXIT_SCHEMA, params);

      const all = simulatePositions(candles, zones, { ...clean, spreadPts: spread, fills, m1: m1Ctx });
      const inWin = windowPositions(all, from, to);
      const stats = computeStats(inWin, {
        tpPts: clean.tpUnit === 'atr' ? undefined : clean.tpPts, spreadPoints: spread,
      });

      const row = {
        params: combo,
        exit:   clean,
        ...summarize(stats, { ambiguous: all.ambiguous ?? 0 }),
      };

      for (const [name, f, t] of evalWindows) {
        const s = computeStats(windowPositions(all, f, t), {
          tpPts: clean.tpUnit === 'atr' ? undefined : clean.tpPts, spreadPoints: spread,
        });
        row[name] = summarize(s);
      }
      results.push(row);
    }

    // Le plancher d'échantillon n'ÉLIMINE pas : il marque. Voir qu'un réglage
    // brillant ne repose que sur 8 positions vaut mieux que le voir disparaître.
    for (const r of results) r.thin = r.n < minTrades;

    const ranked = [...results].sort((a, b2) => {
      if (a.thin !== b2.thin) return a.thin ? 1 : -1;
      return (b2.tStat ?? -Infinity) - (a.tStat ?? -Infinity);
    });

    const top = Number(b.top) || 0;

    res.json({
      meta: {
        symbolId, tf, fills, spreadPoints: spread,
        detect: det.params, base: base.params,
        clamped: [...det.clamped, ...base.clamped],
        window: { from, to },
        grid: Object.fromEntries(entries),
        combos: combos.length,
        candles: candles.length, zones: zones.length,
        ms: Date.now() - t0,
      },
      best:    ranked[0] ?? null,
      results: top > 0 ? ranked.slice(0, top) : ranked,
      // Grille complète dans l'ordre du produit cartésien : c'est elle qui
      // permet de juger un PLATEAU (les voisins d'un candidat), le classement
      // seul ne montre que des pics.
      allOrdered: results,
    });
  } catch (err) {
    console.error('[rfvg/optimize]', err);
    res.status(500).json({ error: err.message });
  }
}
