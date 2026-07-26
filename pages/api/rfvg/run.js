// POST /api/rfvg/run — une simulation rFVG complète, côté serveur.
//
// Différence avec le rapport du graphe : celui-ci ne voit que les bougies
// chargées dans le navigateur (quelques milliers). Ici on simule sur TOUT
// l'historique M1 du symbole, puis on ne garde que la fenêtre demandée — le
// warm-up des MM est donc absorbé sans avoir à le dimensionner.
//
// Corps :
//   { symbolId, tf, from?, to?, detect?, exit?, fills?, spreadPoints?,
//     limit?      // nb de positions renvoyées (0 = aucune, juste les stats)
//     firstN? }   // ne garder que les N PREMIÈRES positions de la fenêtre
//
// `firstN` répond à « fais-moi le rapport sur 100 trades » : c'est un
// échantillon CHRONOLOGIQUE (les 100 premières prises), pas un tirage — les
// suivantes existent toujours, elles sont juste hors du compte.

import { loadZones, toEpoch, windowPositions } from '../../../lib/rfvg/data';
import { simulatePositions } from '../../../lib/rfvg/simulate';
import { computeStats } from '../../../lib/rfvg/stats';
import { DETECT_SCHEMA, EXIT_SCHEMA, sanitize } from '../../../lib/rfvg/params';
import { calcRFVGPositions } from '../../../lib/patterns';

export const config = { api: { responseLimit: false } };

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

    const from = toEpoch(b.from);
    const to   = toEpoch(b.to);

    const { candles, ranges, m1, zones } = await loadZones(symbolId, tf, det.params);

    // `engine: 'legacy'` rejoue la fonction du graphe (calcRFVGPositions) sur
    // les mêmes bougies. Elle n'est pas là pour être utilisée en production —
    // elle est le TÉMOIN de scripts/rfvg-parity.mjs : tant que 'sim' en mode
    // bougie lui est identique, l'optimiseur et la plateforme parlent bien de la
    // même stratégie. Le jour où les deux divergent, on veut le savoir par un
    // test, pas par un écart de résultats inexpliqué six semaines plus tard.
    const all = b.engine === 'legacy'
      ? calcRFVGPositions(candles, { ...det.params, ...ex.params })
      : simulatePositions(candles, zones, { ...ex.params, fills, m1: { bars: m1, ranges } });

    let positions = windowPositions(all, from, to);
    const inWindow = positions.length;
    const firstN = Number(b.firstN) || 0;
    if (firstN > 0) positions = positions.slice(0, firstN);

    const stats = computeStats(positions, { tpPts: ex.params.tpPts, spreadPoints: spread });

    const limit = b.limit === 0 ? 0 : (Number(b.limit) || 2000);

    res.json({
      meta: {
        symbolId, tf, fills, engine: b.engine === 'legacy' ? 'legacy' : 'sim',
        spreadPoints: spread,
        detect: det.params, exit: ex.params,
        clamped: [...det.clamped, ...ex.clamped],
        from, to, firstN: firstN || null,
        candles: candles.length, m1Bars: m1.length, zones: zones.length,
        positionsTotal: all.length, positionsInWindow: inWindow,
        // Positions sorties sur une bougie (ou une minute en fills:'m1') où le
        // stop ET le TP étaient tous deux touchés : le simulateur a tranché pour
        // le stop. C'est la mesure du pessimisme de la convention.
        ambiguousExits: all.ambiguous ?? 0,
        skippedByCooldown: all.skippedByCooldown ?? 0,
        skippedWon: all.skippedWon ?? 0,
        dataFrom: candles.length ? candles[0].time : null,
        dataTo:   candles.length ? candles[candles.length - 1].time : null,
        ms: Date.now() - t0,
      },
      stats,
      positions: limit > 0 ? positions.slice(0, limit) : [],
      positionsTruncated: limit > 0 && positions.length > limit,
    });
  } catch (err) {
    console.error('[rfvg/run]', err);
    res.status(500).json({ error: err.message });
  }
}
