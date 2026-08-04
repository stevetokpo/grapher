// TRENDER (motif) — la prise de position.
//
// Les zones sont celles de l'indicateur (./detect.js → calcHarmony) ; la gestion
// est celle, commune, de lib/patternPositions.js — la même que Twins Bars, RSIER,
// liq et rev. C'est voulu : cinq motifs mesurés par le même code, sinon un écart
// de résultat ne dit plus si la détection ou la sortie en est responsable.
//
// TROIS CHOSES SONT PROPRES À CE MOTIF :
//
//   1. QUAND ON ENTRE. Une position par OUVERTURE DE ZONE — pas une par bougie de
//      zone —, au marché, à l'OUVERTURE de la bougie qui ouvre la zone.
//      L'harmonie y est déjà connue : elle ne lit que des bougies HTF CLÔTURÉES,
//      donc la valeur portée par cette bougie était figée avant même qu'elle ne
//      s'ouvre. Et l'ATR qui dimensionne les distances est lu sur la bougie
//      PRÉCÉDENTE. Rien de ce qui décide de la position ne vient de la bougie où
//      l'on entre : il n'y a donc aucune raison d'attendre une bougie de plus.
//      Traduit dans le contrat de signaux du simulateur (qui entre à l'ouverture
//      de `toIdx + 1`) : toIdx = la bougie qui PRÉCÈDE l'ouverture de la zone.
//
//   2. SL ET TP SONT FIXES ET INDÉPENDANTS, chacun réglé en POINTS ou en ATR.
//      Aucun des deux ne se déduit de l'autre : le RR est un résultat, pas un
//      réglage. Le trait « ≈ SL » que l'indicateur dessine n'est PAS le stop —
//      c'est un dessin, et il le reste.
//      En ATR, la distance change à chaque signal : elle est calculée ici et
//      passée au simulateur signal par signal (`slPts` / `tpPts` du signal), qui
//      n'a pas à savoir d'où elle vient.
//
//   3. L'ATR EST CELUI DE LA DERNIÈRE BOUGIE CLÔTURÉE avant l'entrée, jamais
//      celui de la bougie d'entrée — qui n'est pas finie au moment où l'on entre.
//      Une zone qui s'ouvre avant que l'ATR n'existe est écartée et comptée : on
//      ne dimensionne pas un stop sur une volatilité qu'on n'a pas mesurée.
//
// LE SENS EST CELUI DE LA ZONE, et il n'y a rien à régler là : une harmonie
// haussière s'achète, une baissière se vend. Le TRENDER est un indicateur de
// TENDANCE — le prendre à contre-pied serait un autre motif, pas un réglage.

import { calcTrenderZones } from './detect';
import { DETECT_DEFAULTS, POSITION_DEFAULTS } from './params';
import { simulatePatternPositions } from '../patternPositions';
import { atrArr } from '../patterns';

export function calcTrenderPositions(candles, opts = {}, htfSeries = null) {
  const p = { ...DETECT_DEFAULTS, ...POSITION_DEFAULTS, ...opts, entryMode: 'market' };
  const { zones, warmup } = calcTrenderZones(candles, p, htfSeries);

  const slInAtr = p.slMode === 'atr';
  const tpInAtr = p.tpMode === 'atr';
  // L'ATR n'est calculé que s'il sert : un motif réglé tout en points ne paie pas
  // une passe sur les bougies pour rien.
  const atr = (slInAtr || tpInAtr)
    ? atrArr(candles, Math.max(1, Math.floor(p.atrPeriod ?? POSITION_DEFAULTS.atrPeriod)))
    : null;

  const signals = [];
  let skippedByAtr = 0;

  for (const z of zones) {
    // L'entrée est l'OUVERTURE de la bougie qui ouvre la zone : la dernière
    // bougie clôturée avant elle est donc startIdx − 1, et c'est là que se lit
    // l'ATR. Une zone qui ouvre sur la toute première bougie chargée n'a pas de
    // bougie précédente.
    const toIdx = z.startIdx - 1;
    if (toIdx < 0) { skippedByAtr++; continue; }

    const a = atr ? atr[toIdx] : null;
    if ((slInAtr || tpInAtr) && !(a > 0)) { skippedByAtr++; continue; }

    signals.push({
      side:    z.side,
      fromIdx: toIdx,
      toIdx,
      // Les DISTANCES, en points, résolues ici une fois pour toutes. Elles ne
      // sont posées que dans le mode qui les concerne : sans ça, une distance en
      // ATR prendrait la place d'un réglage en points.
      ...(slInAtr ? { slPts: a * p.slAtrMult } : {}),
      ...(tpInAtr ? { tpPts: a * p.tpAtrMult } : {}),
      // Repères de lecture, jusqu'au rapport. `level` est le trait « ≈ SL » de
      // l'indicateur : il est porté pour qu'on puisse le relire, PAS pour servir
      // de stop.
      level:   z.slLevel,
      confirm: z.confirm,
      endIdx:  z.endIdx,
      atr:     a,
    });
  }

  // Le simulateur lit `slPts` / `tpPts` du SIGNAL en priorité, et retombe sur le
  // réglage global sinon. Le mode de stop qu'il connaît est donc 'points' dans
  // les deux cas — l'ATR est déjà converti.
  const trades = simulatePatternPositions(
    candles, signals, { ...p, slMode: 'points', tpMode: 'points' }, 'TRENDER');

  trades.zonesTotal   = zones.length;
  trades.skippedByAtr = skippedByAtr;
  trades.warmup       = warmup;
  return trades;
}
