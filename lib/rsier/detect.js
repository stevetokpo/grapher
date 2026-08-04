// RSIER — les surzones du RSI d'une unité de temps SUPÉRIEURE, marquées sur le
// graphe d'une unité de temps inférieure.
//
// L'idée, telle qu'elle a été posée : à chaque clôture de bougie du graphe, on
// regarde le RSI de la dernière bougie HTF CLÔTURÉE. S'il est en surzone —
// au-dessus du seuil de surachat, ou en dessous de celui de survente — la zone
// s'ouvre sur cette bougie et court tant que le RSI y reste. Ni plus, ni moins :
// pas de niveau, pas de position, pas de sortie inventée. C'est un CONTEXTE
// dessiné sur le graphe, comme les zones d'harmonie du TRENDER.
//
// NON-REPAINT, et c'est toute la raison du « de la bougie PRÉCÉDENTE clôturée ».
// Le RSI de la bougie HTF EN COURS bouge à chaque tick : une zone qui s'ouvrirait
// dessus pourrait se refermer, se déplacer, disparaître — l'historique mentirait
// sur ce qu'on aurait vu en direct. En ne lisant que des bougies HTF closes, la
// valeur portée par une bougie du graphe est figée avant même que cette bougie
// n'existe. Toutes les bougies d'un même bucket HTF portent donc la même valeur,
// et une zone commence toujours sur la PREMIÈRE bougie du bucket qui suit celui
// où le RSI est entré en surzone. C'est le décalage qu'on paie pour ne pas
// mentir — l'équivalent exact du request.security(expr[1], lookahead_on) de Pine.
//
//     RSI H4 :   45      28  ←── entre en survente à la clôture de cette bougie
//     graphe :  ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈▕████████████  ←── la zone ouvre ICI, au bucket suivant
//
// Chaque zone : { side, startIdx, endIdx, startTime, endTime, htf, rsiStart,
//                 rsiPeak, level }
//   side      — 'bull' (survente, contexte d'achat) | 'bear' (surachat)
//   startIdx  — la bougie du graphe qui ouvre la zone ; endIdx la dernière
//               qu'elle couvre (la zone encore ouverte s'arrête à la dernière
//               bougie chargée, elle reprendra à la suivante)
//   rsiStart  — le RSI qui a ouvert la zone
//   rsiPeak   — le plus extrême atteint DANS la zone : le plus bas si survente,
//               le plus haut si surachat. Sert à l'étiquette et à trier les
//               zones par profondeur ; rien ne dépend de lui.
//   level     — le seuil franchi (osLevel ou obLevel), figé à l'ouverture.

import {
  HTF_SECONDS, HTF_OFFSET, htfBarsFromCandles, htfValuePerBar, htfLabel, htfSeriesRequest,
  mergeHtfRequests,
} from '../htf';
import { DETECT_DEFAULTS } from './params';

// RSI de Wilder sur les clôtures HTF, ALIGNÉ sur l'index des bougies (null avant
// la période). lib/indicators.js a déjà calcRSI, mais il rend une série
// { time, value } pour le GRAPHE : elle saute le préchauffage, donc son index 0
// est la bougie `period`. Un alignement par bucket qui l'indexerait comme les
// bougies lirait la mauvaise barre. Le calcul, lui, est celui de calcRSI au
// dernier chiffre près — même amorce, même lissage.
export function rsiArr(bars, period) {
  const n = bars?.length ?? 0;
  const out = new Array(n).fill(null);
  if (n <= period || period < 2) return out;

  const gains = new Array(n).fill(0);
  const losses = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const d = bars[i].close - bars[i - 1].close;
    if (d > 0) gains[i] = d;
    else       losses[i] = -d;
  }

  // Amorce : moyenne simple des `period` premières variations.
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) { avgGain += gains[i]; avgLoss += losses[i]; }
  avgGain /= period;
  avgLoss /= period;

  const rsiAt = (aG, aL) => aL === 0 ? 100 : 100 - 100 / (1 + aG / aL);
  out[period] = rsiAt(avgGain, avgLoss);

  for (let i = period + 1; i < n; i++) {
    avgGain = (avgGain * (period - 1) + gains[i])  / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    out[i] = rsiAt(avgGain, avgLoss);
  }
  return out;
}

// Ce que les motifs RSIER doivent demander à /api/htf. `rsiPeriod + 2` bougies
// HTF de plus que la fenêtre affichée : le RSI en consomme `period` avant sa
// première valeur, et le non-repaint en décale d'une de plus.
export function rsierHtfRequests(patterns, candles) {
  const reqs = [];
  for (const pat of patterns ?? []) {
    if (pat.type !== 'RSIER' || !pat.enabled) continue;
    const period = Math.max(2, Math.floor(pat.rsiPeriod ?? DETECT_DEFAULTS.rsiPeriod));
    reqs.push(htfSeriesRequest(pat.htf ?? DETECT_DEFAULTS.htf, candles, period + 2));
  }
  return mergeHtfRequests(reqs);
}

// Renvoie { zones, warmup }.
//
//   htfSeries  { H4: [{ time, close }], … } servi par /api/htf. Optionnel : sans
//              lui la série HTF est reconstruite depuis `candles`, ce qui la
//              limite à ce que le graphe a chargé — largement insuffisant dès que
//              le HTF est long (un RSI 14 en H4, c'est ~3 jours de M1 rien que
//              pour le préchauffage).
//   warmup     { ok, htf, have, need } — de quoi dire à l'écran POURQUOI rien ne
//              s'affiche, plutôt que de laisser croire à un bug.
export function calcRsier(candles, opts = {}, htfSeries = null) {
  const p = { ...DETECT_DEFAULTS, ...opts };
  const n = candles?.length ?? 0;
  if (!n) return { zones: [], warmup: { ok: true } };

  const key = p.htf;
  const sec = HTF_SECONDS[key];
  if (!sec) return { zones: [], warmup: { ok: true } };
  const off = HTF_OFFSET[key] ?? 0;

  const period = Math.max(2, Math.floor(p.rsiPeriod));
  const bars   = htfSeries?.[key]?.length ? htfSeries[key] : htfBarsFromCandles(candles, sec, off);

  // Le RSI consomme `period` bougies HTF, et le non-repaint une de plus (on lit
  // la dernière HTF *clôturée*). En dessous, aucune zone ne peut exister.
  const need = period + 2;
  const warmup = bars.length >= need
    ? { ok: true }
    : { ok: false, htf: key, have: bars.length, need };

  const perBar = htfValuePerBar(candles, sec, off, bars, rsiArr(bars, period), null);

  const osLevel = p.osLevel;
  const obLevel = p.obLevel;
  const wantBull = p.direction !== 'bear';
  const wantBear = p.direction !== 'bull';

  const zones = [];
  let open = null;

  for (let i = 0; i < n; i++) {
    const v = perBar[i];
    // Surzone de la bougie courante — bornes COMPRISES. Le surachat est testé en
    // premier : si les deux seuils se croisent (osLevel > obLevel), un même RSI
    // peut satisfaire les deux, et il faut bien trancher une fois pour toutes.
    const side = v == null ? null
      : (v >= obLevel && wantBear) ? 'bear'
      : (v <= osLevel && wantBull) ? 'bull'
      : null;

    // La zone se ferme dès que le RSI quitte sa surzone — ou bascule d'un coup
    // dans l'autre, sans bougie neutre entre les deux.
    if (open && open.side !== side) {
      open.endIdx  = i - 1;
      open.endTime = candles[i - 1].time;
      zones.push(open);
      open = null;
    }

    if (side && !open) {
      open = {
        side,
        startIdx:  i,
        endIdx:    i,
        startTime: candles[i].time,
        endTime:   candles[i].time,
        htf:       key,
        htfLabel:  htfLabel(key),
        rsiStart:  v,
        rsiPeak:   v,
        level:     side === 'bull' ? osLevel : obLevel,
      };
    } else if (open) {
      open.rsiPeak = open.side === 'bull' ? Math.min(open.rsiPeak, v) : Math.max(open.rsiPeak, v);
    }
  }

  // Zone encore ouverte sur la dernière bougie chargée.
  if (open) {
    open.endIdx  = n - 1;
    open.endTime = candles[n - 1].time;
    zones.push(open);
  }

  return { zones, warmup };
}
