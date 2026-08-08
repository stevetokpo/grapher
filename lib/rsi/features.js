// LA CORNE DU RSI — mesurer la forme avant de prétendre la reconnaître.
//
// Le motif, tel qu'il a été décrit : le RSI met BEAUCOUP de temps à monter (une
// courbe lente, qui traîne), fait une POINTE, puis retombe BRUTALEMENT en une ou
// deux bougies — et cette chute « repasse sur plusieurs points passés », c'est-à-
// dire qu'elle efface d'un coup ce que la montée avait mis vingt bougies à
// construire. La corne inversée est l'image miroir : descente lente, creux
// pointu, remontée brutale.
//
//        ╱╲                         ·
//       ╱  ╲                       · ·
//      ╱    ╲                     ·   ·
//   ╱─╯      ╲          montée lente ╲ chute brutale
//  ╱           ╲                      ╲
//                                      ╲___ le trait retombe au niveau
//                                           qu'il avait 20 bougies plus tôt
//
// Ce module ne DÉCIDE de rien : il découpe le RSI en jambes (zigzag), et pour
// chaque pointe il sort une fiche de mesures. Les seuils qui font passer une
// pointe du statut de « candidat » à celui de « corne » vivent dans HORN_RULES,
// et c'est le laboratoire (/rsi + scripts/rsi-lab.mjs) qui sert à les régler sur
// des exemples marqués à la main — pas l'inverse.
//
// CONVENTION DE SIGNE — tout est écrit une seule fois, pour la corne « haute »
// (sommet). Pour la corne inversée on travaille sur -RSI : le creux devient un
// sommet, et toutes les mesures gardent le même sens. C'est le rôle de `V()`.
//
// PAS DE LOOKAHEAD dans ce qui compte : un pivot n'est CONFIRMÉ qu'au moment où
// le RSI s'en écarte de `minAmp`. Chaque pivot porte donc `confirmIdx` — la
// bougie à partir de laquelle on avait le droit de savoir. Les mesures d'une
// corne, elles, regardent la jambe de chute : elles ne sont complètes qu'une
// fois le creux d'après confirmé (`open: true` tant que ce n'est pas le cas).

import { sourceArr, rsiArr } from '../backtest/ta';

// ── Réglages ─────────────────────────────────────────────────────────────────

// Le zigzag : une pointe n'existe que si le RSI s'en écarte d'au moins `minAmp`
// points. C'est le seul filtre de bruit en amont de tout le reste.
//
// 8 points, et pas 4 : sur un RSI 7 — celui de la corne — un repli de 4 points
// est la respiration ordinaire du trait. Mesuré sur BTCUSD 15m, il donne une
// pointe toutes les 2,7 bougies ; à 8, une toutes les 4. On ne découpe pas des
// jambes dans du bruit.
export const PIVOT_DEFAULTS = { period: 7, minAmp: 8 };

// Les seuils du détecteur. Valeurs de DÉPART, à corriger avec les échantillons.
export const HORN_RULES = {
  minAmp:          8,   // amplitude du zigzag (pts RSI)
  minRiseBars:     8,   // « met beaucoup de temps » : bougies de la jambe lente
  maxDropBars:     3,   // « descend brutalement » : bougies de la jambe rapide
  minRiseAmp:     10,   // hauteur de la corne (pts RSI)
  minSharpness:    3,   // pente de chute / pente de montée — la POINTE
  minRewind:       8,   // bougies passées effacées par la chute
  minRewindPerBar: 4,   // bougies effacées PAR bougie de chute
  minRetrace:    0.6,   // part de la montée rendue
  minLevel:        0,   // niveau du sommet (0 = on ne filtre pas sur le niveau)
  side:       'both',   // 'both' | 'bear' (corne) | 'bull' (corne inversée)
};

// Pourquoi une pointe est recalée, dit en français. C'est ce que lit l'infobulle
// du graphe : « hors seuils » ne dit pas lequel desserrer.
export const RULE_LABELS = {
  minRiseBars:     'montée trop courte',
  maxDropBars:     'chute trop lente',
  minRiseAmp:      'corne trop basse',
  minSharpness:    'pointe trop molle',
  minRewind:       'rembobinage trop court',
  minRewindPerBar: 'rembobinage par bougie trop faible',
  minRetrace:      'retour insuffisant',
  minLevel:        'sommet trop bas',
  sens:            'mauvais sens',
};

// ── RSI aligné sur l'index des bougies ───────────────────────────────────────
// rsi[i] correspond à candles[i], null pendant le préchauffage.
export function rsiOf(candles, period = PIVOT_DEFAULTS.period, source = 'close') {
  return rsiArr(sourceArr(candles ?? [], source), period);
}

// ── Zigzag : découpe le RSI en jambes alternées ──────────────────────────────
// Rend [{ idx, kind: 'peak'|'trough', value, confirmIdx }] dans l'ordre du temps.
export function findPivots(rsi, minAmp = PIVOT_DEFAULTS.minAmp) {
  const out = [];
  const n = rsi?.length ?? 0;
  let i0 = -1;
  for (let i = 0; i < n; i++) { if (rsi[i] != null) { i0 = i; break; } }
  if (i0 < 0) return out;

  // La jambe de départ est supposée MONTANTE. Ce n'est pas une hypothèse sur le
  // marché : si le RSI part en baisse, le premier repli acte immédiatement un
  // sommet sur la bougie de départ, et l'alternance reprend son cours. En
  // revanche, une direction « inconnue » qui suivrait les deux sens ferait
  // glisser l'extrême à chaque bougie — aucun repli ne s'accumulerait jamais et
  // le zigzag ne rendrait aucun pivot.
  let dir    = 1;        // +1 : on prolonge une montée, -1 : une descente
  let extIdx = i0;
  let extVal = rsi[i0];

  for (let i = i0 + 1; i < n; i++) {
    const v = rsi[i];
    if (v == null) continue;

    // Prolongement de la jambe en cours : l'extrême se déplace, rien n'est acté.
    if (dir > 0 && v >= extVal) { extIdx = i; extVal = v; continue; }
    if (dir < 0 && v <= extVal) { extIdx = i; extVal = v; continue; }

    // Repli : le pivot n'est acté que si le repli atteint minAmp.
    if (dir > 0 && extVal - v >= minAmp) {
      out.push({ idx: extIdx, kind: 'peak', value: extVal, confirmIdx: i });
      dir = -1; extIdx = i; extVal = v;
    } else if (dir < 0 && v - extVal >= minAmp) {
      out.push({ idx: extIdx, kind: 'trough', value: extVal, confirmIdx: i });
      dir = 1; extIdx = i; extVal = v;
    }
  }

  return out;
}

// ── Mesures d'une corne ──────────────────────────────────────────────────────
// `k` est l'index d'un pivot dans `pivots`. Il faut le pivot d'avant (le départ
// de la jambe lente) ; celui d'après (le bas de la chute) peut manquer si le
// motif est encore en train de se faire — dans ce cas on mesure la chute sur ce
// qui est disponible et on marque `open: true`.
export function measureHorn(rsi, pivots, k, candles = null) {
  const piv = pivots?.[k];
  if (!piv) return null;
  const prev = pivots[k - 1];
  if (!prev) return null;

  const next = pivots[k + 1];
  // Corne encore ouverte : on suit la chute jusqu'à la dernière bougie connue.
  const b = next ? next.idx : lastExtreme(rsi, piv.idx, piv.kind === 'peak' ? -1 : 1);

  return measureLegs(rsi, {
    t: prev.idx, p: piv.idx, b, kind: piv.kind,
    open: !next,
    confirmIdx: next ? next.confirmIdx : null,
  }, candles);
}

// Le même calcul, mais sur trois index DONNÉS — creux de départ, pointe, fin de
// la chute. C'est par là que passe la détection en direct : elle ne peut pas
// attendre le pivot suivant du zigzag (il n'existe qu'une fois la chute finie),
// elle mesure la chute à la bougie où elle en est. Une seule implémentation pour
// les deux usages : le graphe et le laboratoire ne peuvent pas diverger.
export function measureLegs(rsi, { t, p, b, kind, open = false, confirmIdx = null }, candles = null) {
  if (rsi?.[t] == null || rsi?.[p] == null || rsi?.[b] == null) return null;

  const s    = kind === 'peak' ? 1 : -1;         // corne haute : +1, inversée : -1
  const side = kind === 'peak' ? 'bear' : 'bull';
  const V    = i => s * rsi[i];

  if (b <= p) return null;

  const riseBars = p - t;
  const dropBars = b - p;
  if (riseBars < 1 || dropBars < 1) return null;

  const riseAmp  = V(p) - V(t);
  const dropAmp  = V(p) - V(b);
  const riseSlope = riseAmp / riseBars;
  const dropSlope = dropAmp / dropBars;

  // Le rembobinage : combien de bougies PASSÉES la chute vient-elle effacer.
  // On remonte le temps depuis le sommet jusqu'à retrouver un RSI aussi bas que
  // celui d'arrivée. C'est la mesure la plus proche de la description d'origine
  // — « elle retrace plusieurs points passés ».
  let r = p;
  while (r > 0 && rsi[r - 1] != null && V(r - 1) > V(b)) r--;
  const rewindBars    = p - r;
  const rewindCapped  = rsi[r - 1] == null || r === 0;   // butée : fenêtre trop courte
  const rewindPerBar  = rewindBars / dropBars;

  return {
    side,
    open,
    // repères
    idxStart: t, idxPeak: p, idxEnd: b,
    confirmIdx,
    timeStart: candles?.[t]?.time ?? null,
    timePeak:  candles?.[p]?.time ?? null,
    timeEnd:   candles?.[b]?.time ?? null,
    // niveaux bruts du RSI
    level:      round2(rsi[p]),
    levelStart: round2(rsi[t]),
    levelEnd:   round2(rsi[b]),
    // la jambe lente
    riseBars,
    riseAmp:    round2(riseAmp),
    riseSlope:  round2(riseSlope),
    riseEff:    round2(efficiency(rsi, t, p, s)),   // 1 = trait droit, 0 = zigzag
    maxDip:     round2(maxCounterMove(rsi, t, p, s)),
    // la jambe brutale
    dropBars,
    dropAmp:    round2(dropAmp),
    dropSlope:  round2(dropSlope),
    dropEff:    round2(efficiency(rsi, p, b, -s)),
    firstBar:   round2(V(p) - V(Math.min(p + 1, b))),          // la 1re bougie de chute
    firstShare: round2(dropAmp ? (V(p) - V(Math.min(p + 1, b))) / dropAmp : 0),
    // les rapports — ce sont eux qui reconnaissent le motif
    sharpness:  round2(riseSlope > 0 ? dropSlope / riseSlope : Infinity),
    timeRatio:  round2(riseBars / dropBars),
    retrace:    round2(riseAmp > 0 ? dropAmp / riseAmp : 0),
    rewindBars,
    rewindPerBar: round2(rewindPerBar),
    rewindCapped,
    tipFlat:    plateau(rsi, p, s, 1),             // bougies collées au sommet
    // contexte prix (signé dans le sens de la chute du RSI)
    priceMove: candles?.[p] && candles?.[b]
      ? round2(s * (candles[p].close - candles[b].close)) : null,
    priceRise: candles?.[t] && candles?.[p]
      ? round2(s * (candles[p].close - candles[t].close)) : null,
  };
}

// Dernier extrême dans la direction `dir` depuis `from` (jambe encore ouverte).
function lastExtreme(rsi, from, dir) {
  let best = from, bestV = dir * rsi[from];
  for (let i = from + 1; i < rsi.length; i++) {
    if (rsi[i] == null) continue;
    const v = dir * rsi[i];
    if (v >= bestV) { best = i; bestV = v; }
  }
  return best;
}

// Rendement du trajet : |net| / somme des pas. 1 = ligne droite, proche de 0 =
// le trait a beaucoup hésité. C'est ce qui sépare une montée « qui traîne » d'une
// montée franche, et une chute brutale d'une érosion.
function efficiency(rsi, from, to, s) {
  let sum = 0;
  for (let i = from + 1; i <= to; i++) {
    if (rsi[i] == null || rsi[i - 1] == null) continue;
    sum += Math.abs(rsi[i] - rsi[i - 1]);
  }
  if (!sum) return 0;
  return Math.abs(s * (rsi[to] - rsi[from])) / sum;
}

// Le plus gros contre-mouvement à l'intérieur d'une jambe (pts RSI).
function maxCounterMove(rsi, from, to, s) {
  let peak = s * rsi[from], worst = 0;
  for (let i = from + 1; i <= to; i++) {
    if (rsi[i] == null) continue;
    const v = s * rsi[i];
    if (v > peak) peak = v;
    else if (peak - v > worst) worst = peak - v;
  }
  return worst;
}

// Bougies dont le RSI reste à moins de `tol` du sommet : une POINTE en a très
// peu, un plateau en a beaucoup.
function plateau(rsi, p, s, tol) {
  const top = s * rsi[p];
  let n = 1;
  for (let i = p - 1; i >= 0 && rsi[i] != null && top - s * rsi[i] <= tol; i--) n++;
  for (let i = p + 1; i < rsi.length && rsi[i] != null && top - s * rsi[i] <= tol; i++) n++;
  return n;
}

// ── Le détecteur ─────────────────────────────────────────────────────────────
// Rend { ok, fails } — `fails` nomme les critères qui ont sauté, ce qui permet à
// l'interface de dire POURQUOI un candidat n'est pas retenu au lieu de le taire.
export function matchHorn(f, rules = HORN_RULES) {
  const r = { ...HORN_RULES, ...rules };
  const fails = [];
  if (!f) return { ok: false, fails: ['mesure impossible'] };

  if (r.side !== 'both' && f.side !== r.side) fails.push('sens');
  if (f.riseBars    <  r.minRiseBars)     fails.push('minRiseBars');
  if (f.dropBars    >  r.maxDropBars)     fails.push('maxDropBars');
  if (f.riseAmp     <  r.minRiseAmp)      fails.push('minRiseAmp');
  if (f.sharpness   <  r.minSharpness)    fails.push('minSharpness');
  if (f.rewindBars  <  r.minRewind)       fails.push('minRewind');
  if (f.rewindPerBar <  r.minRewindPerBar) fails.push('minRewindPerBar');
  if (f.retrace     <  r.minRetrace)      fails.push('minRetrace');
  if (r.minLevel > 0) {
    const lvl = f.side === 'bear' ? f.level : 100 - f.level;
    if (lvl < r.minLevel) fails.push('minLevel');
  }

  return { ok: fails.length === 0, fails };
}

// ── Balayage complet ─────────────────────────────────────────────────────────
// Une passe sur les bougies : RSI, pivots, fiche de mesures de chaque pointe, et
// le verdict du détecteur. `horns` contient TOUTES les pointes mesurables — les
// refusées comprises, avec leurs `fails`. C'est volontaire : sans les refusées,
// impossible de savoir si un seuil coupe au bon endroit.
export function scanHorns(candles, { period = PIVOT_DEFAULTS.period, rules = HORN_RULES } = {}) {
  const rsi    = rsiOf(candles, period);
  const minAmp = rules.minAmp ?? PIVOT_DEFAULTS.minAmp;
  const pivots = findPivots(rsi, minAmp);

  const horns = [];
  for (let k = 1; k < pivots.length; k++) {
    const f = measureHorn(rsi, pivots, k, candles);
    if (!f) continue;
    const { ok, fails } = matchHorn(f, rules);
    horns.push({ ...f, ok, fails });
  }

  return { rsi, pivots, horns, matches: horns.filter(h => h.ok) };
}

// Le pivot le plus proche d'un temps donné — c'est ce qui « aimante » le clic de
// marquage sur la pointe plutôt que sur la bougie exacte visée.
export function nearestPivot(pivots, candles, time, maxBars = 6) {
  if (!pivots?.length || !candles?.length) return -1;
  let idx = 0;
  for (let i = 1; i < candles.length; i++) {
    if (Math.abs(candles[i].time - time) < Math.abs(candles[idx].time - time)) idx = i;
  }
  let best = -1, bestD = Infinity;
  for (let k = 0; k < pivots.length; k++) {
    const d = Math.abs(pivots[k].idx - idx);
    if (d < bestD) { bestD = d; best = k; }
  }
  return bestD <= maxBars ? best : -1;
}

// ── Statistiques ─────────────────────────────────────────────────────────────

export const FEATURE_KEYS = [
  'riseBars', 'riseAmp', 'riseSlope', 'riseEff', 'maxDip',
  'dropBars', 'dropAmp', 'dropSlope', 'dropEff', 'firstShare',
  'sharpness', 'timeRatio', 'retrace', 'rewindBars', 'rewindPerBar',
  'tipFlat', 'level',
];

export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo  = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// Résumé par mesure : n, min, p10, médiane, p90, max. De quoi lire d'un coup
// d'œil où se placent les exemples marqués par rapport au reste des pointes.
export function describe(list, keys = FEATURE_KEYS) {
  const out = {};
  for (const key of keys) {
    const vals = list
      .map(f => f?.[key])
      .filter(v => typeof v === 'number' && Number.isFinite(v))
      .sort((a, b) => a - b);
    if (!vals.length) { out[key] = null; continue; }
    out[key] = {
      n:   vals.length,
      min: round2(vals[0]),
      p10: round2(quantile(vals, 0.10)),
      med: round2(quantile(vals, 0.50)),
      p90: round2(quantile(vals, 0.90)),
      max: round2(vals[vals.length - 1]),
    };
  }
  return out;
}

function round2(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return v;
  return Math.round(v * 100) / 100;
}
