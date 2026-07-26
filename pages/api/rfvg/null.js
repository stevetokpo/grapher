// POST /api/rfvg/null — contrôle par DÉCALAGE CIRCULAIRE.
//
// Le problème que ça résout : après avoir essayé cent configurations, on finit
// toujours par en trouver une dont l'espérance est positive. Est-ce l'effet du
// motif, ou l'effet d'avoir cherché ? Le t-stat théorique (|t| ≳ 2) répond mal
// ici, parce qu'il suppose des trades indépendants et une distribution sage —
// alors que ce profil est « beaucoup de petites pertes, une énorme gagnante de
// temps en temps », c'est-à-dire tout l'inverse.
//
// Le contrôle : on garde EXACTEMENT les mêmes signaux — même nombre, même
// répartition dans le temps, même proportion haussier/baissier, même règle de
// sortie, même instrument — mais on décale leur date d'entrée de N bougies, en
// circulaire. Le motif est alors joué sur un morceau de marché qui n'a rien à
// voir avec celui qui l'a produit : tout ce qui reste est la structure de
// l'instrument et la géométrie du stop et du TP.
//
// Si la vraie configuration ne ressort pas de ce nuage de contrôles, elle ne
// mesure pas le motif. Elle mesure la façon dont un stop serré et un TP lointain
// se comportent sur cet instrument — ce que n'importe quelle date d'entrée
// donnerait.
//
// Ce que le contrôle ne casse PAS, et qu'il faut savoir : la saisonnalité
// intra-journalière (un décalage de 500 bougies M1 déplace l'heure d'entrée mais
// reste dans les mêmes plages horaires) et l'autocorrélation de la volatilité.
// C'est délibéré — ce sont précisément les effets qu'on ne veut pas confondre
// avec le motif.

import { loadZones, toEpoch, windowPositions } from '../../../lib/rfvg/data';
import { simulatePositions } from '../../../lib/rfvg/simulate';
import { computeStats, summarize } from '../../../lib/rfvg/stats';
import { DETECT_SCHEMA, EXIT_SCHEMA, sanitize } from '../../../lib/rfvg/params';

export const config = { api: { responseLimit: false } };

// Décale les entrées de `shift` bougies, en circulaire sur [1, n-1]. L'indice 0
// est exclu : une entrée en B4 a besoin d'un B3 devant elle.
function shiftZones(zones, candles, shift) {
  const n = candles.length;
  const span = n - 1;
  const out = zones.map(z => {
    if (z.entryIdx == null) return null;
    const idx = 1 + (((z.entryIdx - 1 + shift) % span) + span) % span;
    return { ...z, entryIdx: idx, entryTime: candles[idx].time, entryPrice: candles[idx].open };
  }).filter(Boolean);
  // L'ordre chronologique n'est pas décoratif : `uniqueTrade` et `skipAfterTp`
  // sont des états séquentiels, les servir dans le désordre les rendrait faux.
  out.sort((a, b) => a.entryIdx - b.entryIdx);
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

    const det = sanitize(DETECT_SCHEMA, b.detect ?? {});
    const ex  = sanitize(EXIT_SCHEMA,   b.exit   ?? {});
    const fills  = b.fills === 'm1' ? 'm1' : 'bar';
    const spread = Number(b.spreadPoints) || 0;
    const from = toEpoch(b.from), to = toEpoch(b.to);
    const draws = Math.min(Number(b.draws) || 60, 400);

    const { candles, ranges, m1, zones } = await loadZones(symbolId, tf, det.params);
    const m1Ctx = { bars: m1, ranges };

    const measure = zs => {
      const all = simulatePositions(candles, zs, { ...ex.params, fills, m1: m1Ctx });
      return computeStats(windowPositions(all, from, to), { tpPts: ex.params.tpPts, spreadPoints: spread });
    };

    const real = measure(zones);

    // Décalages répartis sur tout l'historique, en évitant les tout petits (un
    // décalage de 20 bougies laisse la zone sur le même mouvement de prix).
    const n = candles.length;
    const minShift = Math.max(500, Math.floor(n * 0.02));
    const controls = [];
    for (let k = 0; k < draws; k++) {
      const shift = minShift + Math.floor(((n - 2 * minShift) * k) / draws);
      const s = measure(shiftZones(zones, candles, shift));
      controls.push({ shift, ...summarize(s) });
    }

    const exps = controls.map(c => c.expPts).filter(v => v != null).sort((a, c) => a - c);
    const q = p => exps.length ? exps[Math.min(exps.length - 1, Math.max(0, Math.ceil(exps.length * p) - 1))] : null;
    const mean = exps.length ? exps.reduce((s, v) => s + v, 0) / exps.length : null;
    // Rang de la vraie mesure DANS le nuage : c'est la p-value empirique, et
    // elle ne suppose rien sur la forme de la distribution.
    const above = exps.filter(v => v >= (real.expPts ?? -Infinity)).length;

    res.json({
      meta: { symbolId, tf, fills, spreadPoints: spread, detect: det.params, exit: ex.params,
              from, to, draws: controls.length, zones: zones.length, ms: Date.now() - t0 },
      real: summarize(real),
      controls,
      verdict: {
        realExpPts: real.expPts,
        controlMean: mean,
        controlP05: q(0.05), controlMedian: q(0.5), controlP95: q(0.95),
        controlMin: exps[0] ?? null, controlMax: exps[exps.length - 1] ?? null,
        // p empirique : proportion de contrôles au moins aussi bons que le vrai.
        pValue: exps.length ? (above + 1) / (exps.length + 1) : null,
        betterThan: exps.length ? 1 - above / exps.length : null,
      },
    });
  } catch (err) {
    console.error('[rfvg/null]', err);
    res.status(500).json({ error: err.message });
  }
}
