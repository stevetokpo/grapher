// corne — la figure du RSI, marquée sur les bougies du graphe.
//
// Le motif est décrit et mesuré dans lib/rsi/features.js ; ce fichier ne fait
// que le brancher sur la chaîne des motifs. Une seule implémentation des mesures
// pour les deux usages : ce que le laboratoire /rsi affiche et ce que le graphe
// marque ne peuvent pas dire deux choses différentes.
//
// QUAND LA FIGURE EST-ELLE CONNUE ? Pas au sommet. Au sommet, il n'y a qu'une
// montée qui s'arrête — rien ne dit qu'elle va s'effondrer plutôt que continuer.
// La corne n'existe qu'une fois la chute accomplie, et c'est là que le repère se
// pose : sur la bougie où les mesures franchissent les seuils, au plus tard
// `maxDropBars` bougies après la pointe. Un repère posé sur la pointe serait un
// repère qui apparaît dans le passé — joli sur l'historique, invisible en direct.
//
//     RSI ╱‾╲                          la pointe est ICI
//        ╱   ╲
//     ╱‾╯     ╲___                     le repère est LÀ, une ou deux bougies après
//     ─────────────────────────────
//     bougies :  ▏▏▏▏▏▏▏▏▏▏▏▏▎▎  ← le repère « CO » se pose sur cette bougie
//
// Chaque figure : { side, label, idx, fromIdx, toIdx, time, value, level,
//                   peakIdx, peakTime, rsi… }
//   side     — 'bear' (corne : pointe haute du RSI, signal de vente)
//              'bull' (corne inversée : creux pointu, signal d'achat)
//   idx      — la bougie où la figure est ACQUISE ; c'est là que va le repère
//   fromIdx  — le creux de départ de la jambe lente
//   peakIdx  — la pointe elle-même, pour qui voudrait dessiner la figure
//   value    — le prix du repère : le plus HAUT de la figure quand elle est
//   /level     baissière, le plus BAS quand elle est haussière. Même convention
//              que le reste de la famille à repère — et c'est l'extrême qu'un
//              stop structurel devrait couvrir.
//   les mesures du RSI (riseBars, dropBars, sharpness, rewindBars, …) voyagent
//   avec la figure : elles servent aux étiquettes, aux rapports, et à vérifier
//   une détection à la main sans avoir à la refaire.

import { rsiOf, findPivots, measureLegs, matchHorn } from '../rsi/features';
import { DETECT_DEFAULTS } from './params';

export function calcCorne(candles, opts = {}) {
  const p = { ...DETECT_DEFAULTS, ...opts };
  const n = candles?.length ?? 0;
  const period = Math.max(2, Math.round(p.rsiPeriod ?? DETECT_DEFAULTS.rsiPeriod));
  if (n <= period + 2) return [];

  const minAmp  = Math.max(0.5, Number(p.minAmp) || DETECT_DEFAULTS.minAmp);
  const maxDrop = Math.max(1, Math.round(p.maxDropBars ?? DETECT_DEFAULTS.maxDropBars));

  const rsi    = rsiOf(candles, period);
  const pivots = findPivots(rsi, minAmp);

  // Les seuils tels que matchHorn les attend. `side` y est traduit une fois pour
  // toutes : le réglage parle du sens du SIGNAL, et c'est déjà celui de `side`.
  const rules = {
    minAmp,
    side:            p.direction ?? 'both',
    minRiseBars:     p.minRiseBars,
    maxDropBars:     maxDrop,
    minRiseAmp:      p.minRiseAmp,
    minSharpness:    p.minSharpness,
    minRewind:       p.minRewind,
    minRewindPerBar: p.minRewindPerBar,
    minRetrace:      p.minRetrace,
    minLevel:        p.minLevel,
  };

  const out = [];

  for (let k = 1; k < pivots.length; k++) {
    const piv  = pivots[k];
    const prev = pivots[k - 1];

    // La chute est mesurée bougie par bougie, en avançant : la figure est
    // signalée à la PREMIÈRE bougie où elle passe les seuils, et une seule fois.
    const last = Math.min(piv.idx + maxDrop, n - 1);
    for (let j = piv.idx + 1; j <= last; j++) {
      // Tant que le repli n'a pas atteint l'amplitude du zigzag, la pointe n'est
      // pas acquise : on ne peut pas encore parler de sommet à cette bougie-là.
      if (piv.confirmIdx > j) continue;

      const f = measureLegs(rsi, {
        t: prev.idx, p: piv.idx, b: j, kind: piv.kind, confirmIdx: piv.confirmIdx,
      }, candles);
      if (!f) continue;

      const { ok } = matchHorn(f, rules);
      if (!ok) continue;

      const bull = f.side === 'bull';
      let level = bull ? candles[j].low : candles[j].high;
      for (let x = prev.idx; x <= j; x++) {
        level = bull ? Math.min(level, candles[x].low) : Math.max(level, candles[x].high);
      }

      // Les trois niveaux de la mesure sont des valeurs de RSI ; `level`, dans
      // la famille des motifs, est un PRIX. On les renomme au passage plutôt que
      // de laisser le prix écraser le RSI en silence — et les index de la mesure
      // repartent sous les noms de la famille (fromIdx / peakIdx / toIdx).
      // `open` ne suit pas non plus : c'est une notion du laboratoire (« la
      // chute n'a pas encore de fin »). Ici, toute figure émise est close par
      // construction — la bougie du repère EST sa fin.
      const {
        level: rsiLevel, levelStart: rsiLevelStart, levelEnd: rsiLevelEnd,
        idxStart: _s, idxPeak: _p, idxEnd: _e, open: _o,
        ...measures
      } = f;

      out.push({
        ...measures,
        rsiLevel, rsiLevelStart, rsiLevelEnd,
        label:    'corne',
        idx:      j,
        fromIdx:  prev.idx,
        toIdx:    j,
        peakIdx:  piv.idx,
        peakTime: candles[piv.idx].time,
        time:     candles[j].time,
        value:    level,
        level,
        rsiPeriod: period,
      });
      break;
    }
  }

  return out;
}
