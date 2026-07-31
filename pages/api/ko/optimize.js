// POST /api/ko/optimize — balaye une grille de réglages, SORTIES et/ou DÉTECTION.
//
// CE QUI CHANGE PAR RAPPORT AU rFVG. Là-bas la détection est hors grille : le
// motif est celui de l'utilisateur, pas une variable libre. Le KO est neuf — ses
// seuils (1,3 × ATR, 90 %, 0,3 × ATR, 30 %) n'ont jamais été mesurés — et refuser
// de les balayer reviendrait à optimiser les sorties autour d'une supposition. Ils
// sont donc balayables, à trois conditions, toutes tenues par ce fichier :
//
//   1. LE BUDGET DE LIBERTÉ EST COMPTÉ ET RENDU. `freedom` dit combien de
//      paramètres sont réglés, combien de positions il faudrait pour les tenir
//      (~30 par paramètre) et si le compte y est. Ce n'est pas un garde-fou
//      bloquant : c'est un chiffre qu'on ne peut plus dire ne pas avoir vu.
//   2. LA DÉTECTION EST DÉTECTÉE UNE FOIS PAR COMBINAISON, pas une fois par
//      configuration : la boucle de détection est à l'EXTÉRIEUR, les sorties à
//      l'intérieur. Une grille 4 × 4 de détection sur 30 sorties = 16 détections,
//      pas 480.
//   3. LE CLASSEMENT NE CONCLUT RIEN. Un réglage de détection sorti d'ici doit
//      passer /api/ko/null (contrôle par décalage circulaire) avant de compter :
//      avec assez d'essais, on trouve toujours un motif qui a bien marché.
//
// Corps :
//   { symbolId, tf, detect, base, grid: { cleSortie: "10:60:10" | [..] },
//     detectGrid: { cleDetection: "1:2:0.1" | [..] },
//     window: { from, to }, evalWindows?: { nom: {from,to}, ... },
//     fills?, spreadPoints?, minTrades?, top? }
//
// `window` est la fenêtre de CLASSEMENT (in-sample). `evalWindows` rejoue les
// configurations retenues sur d'autres fenêtres — à n'utiliser qu'APRÈS avoir
// figé les paramètres : regarder l'out-of-sample pendant l'optimisation le brûle,
// et il n'y a pas de second OOS.
//
// Classement : `tStat` (espérance / écart-type × √n), jamais le winrate ni le
// total en points (cf. lib/signals/stats.js).

import { toEpoch, windowPositions } from '../../../lib/signals/data';
import { simulatePositions } from '../../../lib/signals/engine';
import { computeStats, summarize } from '../../../lib/signals/stats';
import { DETECT_SCHEMA, EXIT_SCHEMA, SWEEPABLE_DETECT } from '../../../lib/ko/params';
import { sanitize, buildGrid, cartesian } from '../../../lib/signals/params';
import { loadKO } from '../../../lib/ko/pattern';

export const config = { api: { responseLimit: false } };

const MAX_COMBOS = 6000;
// Repère de la maison : en dessous de ~30 positions par paramètre réglé, on
// mémorise l'historique au lieu de mesurer quoi que ce soit.
const POSITIONS_PER_PARAM = 30;

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
    // `|| 0` et pas `?? 0` : Number(undefined) vaut NaN, que `??` laisse passer —
    // et `n < NaN` étant toujours faux, le plancher d'échantillon ne marquerait
    // jamais rien. (Le bug existe encore dans /api/rfvg/optimize.)
    const minTrades = Number(b.minTrades) || 0;

    // `direction` est dans DETECT_SCHEMA mais pas dans SWEEPABLE_DETECT : le
    // dire franchement, sinon l'erreur générique laisserait croire à une faute
    // de frappe alors que le refus est délibéré.
    if (b.detectGrid && Object.keys(b.detectGrid).includes('direction')) {
      return res.status(400).json({ error:
        "direction ne se balaye pas : ce n'est pas un réglage mais une question séparée " +
        "(« le motif marche-t-il des deux côtés ? »). La balayer revient à choisir son camp sur le bruit de l'in-sample — la fixer dans `detect` et comparer les deux runs." });
    }

    let exitEntries, detectEntries;
    try {
      exitEntries   = buildGrid(EXIT_SCHEMA,      b.grid       ?? {});
      detectEntries = buildGrid(SWEEPABLE_DETECT, b.detectGrid ?? {});
    } catch (e) { return res.status(400).json({ error: e.message }); }

    const exitCombos   = exitEntries.length   ? cartesian(exitEntries)   : [{}];
    const detectCombos = detectEntries.length ? cartesian(detectEntries) : [{}];
    const total = exitCombos.length * detectCombos.length;
    if (total > MAX_COMBOS) {
      return res.status(400).json({ error: `${total} configurations demandées, plafond ${MAX_COMBOS} — resserre la grille` });
    }

    const win  = b.window ?? {};
    const from = toEpoch(win.from);
    const to   = toEpoch(win.to);

    const evalWindows = Object.entries(b.evalWindows ?? {})
      .map(([name, w]) => [name, toEpoch(w.from), toEpoch(w.to)]);

    const results = [];
    let candleCount = 0, signalMin = Infinity, signalMax = 0;

    // Détection à l'EXTÉRIEUR : une passe de détection par combinaison de motif,
    // réutilisée par toutes les sorties (cf. condition 2 du bloc de tête).
    for (const dCombo of detectCombos) {
      const { params: detect, clamped: dClamped } = sanitize(DETECT_SCHEMA, { ...det.params, ...dCombo });
      const { candles, ranges, m1, signals } = await loadKO(symbolId, tf, detect);
      candleCount = candles.length;
      if (signals.length < signalMin) signalMin = signals.length;
      if (signals.length > signalMax) signalMax = signals.length;
      const m1Ctx = { bars: m1, ranges };

      for (const eCombo of exitCombos) {
        // Les valeurs de grille passent par le même clamp que les autres : une
        // borne franchie doit se voir, pas se corriger en douce.
        const { params: exit, clamped: eClamped } = sanitize(EXIT_SCHEMA, { ...base.params, ...eCombo });

        const all   = simulatePositions(candles, signals, { ...exit, spreadPts: spread, fills, m1: m1Ctx });
        const inWin = windowPositions(all, from, to);
        const stats = computeStats(inWin, {
          tpPts: exit.tpUnit === 'atr' ? undefined : exit.tpPts, spreadPoints: spread,
        });

        const row = {
          params: { ...dCombo, ...eCombo },   // ce qui a bougé, détection et sorties mêlées
          detect, exit,
          signals: signals.length,
          clamped: [...dClamped, ...eClamped],
          ...summarize(stats, { ambiguous: all.ambiguous ?? 0 }),
        };

        for (const [name, f, t] of evalWindows) {
          const s = computeStats(windowPositions(all, f, t), {
            tpPts: exit.tpUnit === 'atr' ? undefined : exit.tpPts, spreadPoints: spread,
          });
          row[name] = summarize(s);
        }
        results.push(row);
      }
    }

    // Le plancher d'échantillon n'ÉLIMINE pas : il marque. Voir qu'un réglage
    // brillant ne repose que sur 8 positions vaut mieux que le voir disparaître.
    for (const r of results) r.thin = r.n < minTrades;

    const ranked = [...results].sort((a, b2) => {
      if (a.thin !== b2.thin) return a.thin ? 1 : -1;
      return (b2.tStat ?? -Infinity) - (a.tStat ?? -Infinity);
    });

    const top = Number(b.top) || 0;

    // Budget de liberté — le chiffre qu'on ne peut plus dire ne pas avoir vu.
    const swept = detectEntries.length + exitEntries.length;
    const ns = results.map(r => r.n).sort((a, c) => a - c);
    const medianN = ns.length ? ns[ns.length >> 1] : 0;
    const needed  = swept * POSITIONS_PER_PARAM;

    res.json({
      meta: {
        symbolId, tf, fills, pattern: 'ko', spreadPoints: spread,
        detect: det.params, base: base.params,
        clamped: [...det.clamped, ...base.clamped],
        window: { from, to },
        grid:       Object.fromEntries(exitEntries),
        detectGrid: Object.fromEntries(detectEntries),
        combos: total, detectCombos: detectCombos.length, exitCombos: exitCombos.length,
        candles: candleCount,
        signalsMin: Number.isFinite(signalMin) ? signalMin : 0, signalsMax: signalMax,
        ms: Date.now() - t0,
      },
      freedom: {
        params: swept,
        detectParams: detectEntries.length,
        exitParams: exitEntries.length,
        positionsPerParam: POSITIONS_PER_PARAM,
        medianPositions: medianN,
        needed,
        ok: swept === 0 || medianN >= needed,
        note: swept === 0 ? 'aucun paramètre balayé'
          : medianN >= needed
            ? `${medianN} positions pour ${swept} paramètre(s) réglé(s) : le compte y est`
            : `${medianN} positions pour ${swept} paramètre(s) réglé(s) — il en faudrait ${needed}. Au-delà, on mémorise l'historique`,
      },
      best:    ranked[0] ?? null,
      results: top > 0 ? ranked.slice(0, top) : ranked,
      // Grille complète dans l'ordre du produit cartésien : c'est elle qui
      // permet de juger un PLATEAU (les voisins d'un candidat), le classement
      // seul ne montre que des pics.
      allOrdered: results,
    });
  } catch (err) {
    console.error('[ko/optimize]', err);
    res.status(500).json({ error: err.message });
  }
}
