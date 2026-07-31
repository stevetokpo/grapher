// POST /api/ko/null — contrôle par DÉCALAGE CIRCULAIRE.
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
// POUR LE KO C'EST OBLIGATOIRE, PAS OPTIONNEL : la détection étant balayable
// (/api/ko/optimize), le nombre d'essais est bien plus grand que sur le rFVG, et
// donc la chance de tomber sur un beau réglage par hasard aussi. Un réglage KO
// sans contrôle par décalage n'est pas un résultat, c'est une anecdote.
//
// Ce que le contrôle ne casse PAS, et qu'il faut savoir : la saisonnalité
// intra-journalière (un décalage de 500 bougies M1 déplace l'heure d'entrée mais
// reste dans les mêmes plages horaires) et l'autocorrélation de la volatilité.
// C'est délibéré — ce sont précisément les effets qu'on ne veut pas confondre
// avec le motif.

import { toEpoch, windowPositions } from '../../../lib/signals/data';
import { simulatePositions } from '../../../lib/signals/engine';
import { computeStats, summarize } from '../../../lib/signals/stats';
import { DETECT_SCHEMA, EXIT_SCHEMA, sanitize } from '../../../lib/ko/params';
import { loadKO } from '../../../lib/ko/pattern';

export const config = { api: { responseLimit: false } };

// Décale les entrées de `shift` bougies, en circulaire sur [1, n-1]. L'indice 0
// est exclu : une entrée a besoin d'une bougie devant elle (le stop structurel
// se lit sur la bougie qui précède celle d'entrée).
function shiftSignals(signals, candles, shift) {
  const n = candles.length;
  const span = n - 1;
  const out = signals.map(z => {
    if (z.entryIdx == null) return null;
    const idx = 1 + (((z.entryIdx - 1 + shift) % span) + span) % span;
    return { ...z, entryIdx: idx, entryTime: candles[idx].time, entryPrice: candles[idx].open };
  }).filter(Boolean);
  // L'ordre chronologique n'est pas décoratif : `uniqueTrade` et `skipAfterTp`
  // sont des états séquentiels, les servir dans le désordre les rendrait faux.
  out.sort((a, b) => a.entryIdx - b.entryIdx);
  return out;
}

// Rang empirique d'une valeur dans un nuage trié — ne suppose rien sur la forme
// de la distribution, ce qui est tout l'intérêt ici.
function rank(sorted, value) {
  if (!sorted.length || value == null) return { pValue: null, betterThan: null };
  const above = sorted.filter(v => v >= value).length;
  return { pValue: (above + 1) / (sorted.length + 1), betterThan: 1 - above / sorted.length };
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

    const { candles, ranges, m1, signals } = await loadKO(symbolId, tf, det.params);
    const m1Ctx = { bars: m1, ranges };

    const measure = zs => {
      const all = simulatePositions(candles, zs, { ...ex.params, spreadPts: spread, fills, m1: m1Ctx });
      return computeStats(windowPositions(all, from, to), {
        tpPts: ex.params.tpUnit === 'atr' ? undefined : ex.params.tpPts, spreadPoints: spread,
      });
    };

    const real = measure(signals);

    // Décalages répartis sur tout l'historique, en évitant les tout petits (un
    // décalage de 20 bougies laisse le signal sur le même mouvement de prix).
    const n = candles.length;
    const minShift = Math.max(500, Math.floor(n * 0.02));
    const controls = [];
    for (let k = 0; k < draws; k++) {
      const shift = minShift + Math.floor(((n - 2 * minShift) * k) / draws);
      const s = measure(shiftSignals(signals, candles, shift));
      controls.push({ shift, ...summarize(s) });
    }

    const exps = controls.map(c => c.expPts).filter(v => v != null).sort((a, c) => a - c);
    const ts   = controls.map(c => c.tStat).filter(v => v != null).sort((a, c) => a - c);
    const q = (arr, p) => arr.length ? arr[Math.min(arr.length - 1, Math.max(0, Math.ceil(arr.length * p) - 1))] : null;
    const mean = exps.length ? exps.reduce((s, v) => s + v, 0) / exps.length : null;
    const rExp = rank(exps, real.expPts);

    res.json({
      meta: { symbolId, tf, fills, pattern: 'ko', spreadPoints: spread,
              detect: det.params, exit: ex.params,
              from, to, draws: controls.length, signals: signals.length, ms: Date.now() - t0 },
      real: summarize(real),
      controls,
      verdict: {
        realExpPts: real.expPts,
        controlMean: mean,
        controlP05: q(exps, 0.05), controlMedian: q(exps, 0.5), controlP95: q(exps, 0.95),
        controlMin: exps[0] ?? null, controlMax: exps[exps.length - 1] ?? null,
        // p empirique : proportion de contrôles au moins aussi bons que le vrai.
        pValue: rExp.pValue,
        betterThan: rExp.betterThan,
        // Le même rang, mais sur le score qui sert au CLASSEMENT des grilles.
        // Une espérance flatteuse portée par trois coups de chance sort du nuage
        // en points et pas en t-stat : c'est exactement ce qu'on veut voir.
        realTStat: real.tStat,
        tStatControlMedian: q(ts, 0.5), tStatControlP95: q(ts, 0.95),
        tStatPValue: rank(ts, real.tStat).pValue,
      },
    });
  } catch (err) {
    console.error('[ko/null]', err);
    res.status(500).json({ error: err.message });
  }
}
