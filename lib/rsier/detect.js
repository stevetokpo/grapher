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
//                 rsiPeak, level, entryPrice, maDist, maValue, maPeriod }
//   side      — 'bull' (survente, contexte d'achat) | 'bear' (surachat)
//   startIdx  — la bougie du graphe qui ouvre la zone ; endIdx la dernière
//               qu'elle couvre (la zone encore ouverte s'arrête à la dernière
//               bougie chargée, elle reprendra à la suivante)
//   rsiStart  — le RSI qui a ouvert la zone
//   rsiPeak   — le plus extrême atteint DANS la zone : le plus bas si survente,
//               le plus haut si surachat. Sert à l'étiquette et à trier les
//               zones par profondeur ; rien ne dépend de lui.
//   level     — le seuil franchi (osLevel ou obLevel), figé à l'ouverture.
//   entryPrice — l'ouverture de startIdx : le prix auquel on entre en surzone.
//   maDist    — de combien ce prix s'est écarté de la moyenne mobile, SIGNÉ
//               DANS LE SENS DE L'EXCÈS : positif = la survente est bien SOUS
//               la moyenne, le surachat bien AU-DESSUS. Négatif = l'entrée est
//               du mauvais côté de la moyenne — un RSI en surzone alors que le
//               prix n'a même pas franchi sa moyenne. null si la moyenne n'est
//               pas encore chaude, ou si la mesure est éteinte.
//   maValue   — le prix de la moyenne au même instant, pour tracer la cote sans
//               la recalculer côté dessin. maPeriod, la période employée.

import {
  HTF_SECONDS, HTF_OFFSET, htfBarsFromCandles, htfValuePerBar, htfLabel, htfSeriesRequest,
  mergeHtfRequests,
} from '../htf';
import { smaArr } from '../patterns';
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

// ── L'AFFICHAGE EN BOÎTES ────────────────────────────────────────────────────
// La même surzone, dessinée autrement : un rectangle ancré sur le PRIX D'ENTRÉE
// plutôt qu'une bande de temps pleine hauteur.
//
// Ce que la boîte dit, et ce qu'elle NE dit PAS. La bande couvre exactement la
// durée de la surzone : son bord droit est une information. La boîte, elle,
// s'ouvre sur la bougie d'entrée et court `lenBars` bougies, que le RSI soit
// encore en surzone ou non — sa longueur est un RÉGLAGE, pas une mesure. Elle
// répond à une autre question : où le prix est-il allé dans les N bougies qui
// ont suivi l'entrée, et de combien.
//
// La hauteur est réglée en POINTS de part et d'autre du prix d'entrée, les deux
// côtés séparément — rien n'oblige la fenêtre qu'on regarde à être symétrique.
// Un point est ici une unité de prix, comme partout ailleurs dans les motifs
// (cf. slPts / tpPts de lib/patternPositions.js).
//
// C'est du DESSIN, et rien d'autre : aucune zone n'est écartée, aucun seuil
// n'est jugé, les positions ne s'en aperçoivent pas. Les zones reçues sont déjà
// celles qu'on affiche — sens joué compris (cf. playedSide) —, cette fonction ne
// fait que leur donner une géométrie.
export function rsierBoxes(candles, zones, opts = {}) {
  const n = candles?.length ?? 0;
  const up   = Math.max(0, opts.boxUpPts   ?? 0);
  const down = Math.max(0, opts.boxDownPts ?? 0);
  const len  = Math.max(1, Math.round(opts.boxLenBars ?? 1));

  const out = [];
  for (const z of zones ?? []) {
    // Sans prix d'entrée il n'y a rien à ancrer. Ne peut pas arriver aujourd'hui
    // (toute zone en porte un), mais une boîte sans ancre serait dessinée sur un
    // prix inventé — autant ne rien dessiner.
    if (z.entryPrice == null) continue;
    const endIdx = z.startIdx + len;
    out.push({
      ...z,
      state:  'active',
      top:    z.entryPrice + up,
      bottom: z.entryPrice - down,
      // Le bord droit tombe `len` bougies après l'entrée. Au-delà des bougies
      // chargées, `null` = la boîte s'étend jusqu'au bord droit du graphe : elle
      // est vraie jusque-là, et un bord dessiné sur la dernière bougie chargée
      // ferait croire à une fin qui n'existe pas.
      endTime: endIdx < n ? candles[endIdx].time : null,
      // La cote de distance à la moyenne part du prix d'ENTRÉE — le centre de la
      // boîte, pas son bord haut : c'est ce prix-là qu'on a comparé à la moyenne.
      mesureDepuis: z.entryPrice,
      // Aucune étiquette sur la boîte : le repère de début de zone porte déjà le
      // HTF et le RSI, et la cote porte son chiffre. Un troisième texte au même
      // endroit ne ferait que se superposer aux deux autres.
      label: '',
    });
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

  // LA DISTANCE DE L'ENTRÉE À LA MOYENNE MOBILE, comme le $$$ mesure celle de sa
  // pointe. Elle est ici, dans la DÉTECTION, et non dans l'habillage : depuis
  // qu'un seuil peut écarter une zone, c'est une condition du motif — donc
  // quelque chose que les positions voient aussi, puisqu'elles rejouent cette
  // fonction. La calculer côté dessin aurait laissé une occasion de diverger.
  //
  // LA MOYENNE EST CELLE DU GRAPHE, pas du HTF — contrairement au RSI. Ce qu'on
  // mesure est un PRIX D'ENTRÉE, qui est un prix du graphe : le comparer à une
  // moyenne H4 comparerait deux échelles. Le RSI reste, lui, celui du HTF.
  const maOn = p.maDistPeriod > 0;
  const ma   = maOn ? smaArr(candles, Math.floor(p.maDistPeriod)) : null;
  // Le seuil, et un seul — même règle que le $$$ : un plancher et un plafond ne
  // se règlent pas ensemble, et le seuil porte sur la VALEUR ABSOLUE de l'écart.
  const seuilMin = p.maDistMode === 'min' && p.maDistMin > 0 ? p.maDistMin : 0;
  const seuilMax = p.maDistMode === 'max' && p.maDistMax > 0 ? p.maDistMax : 0;

  // La mesure d'une zone qui ouvre sur `idx`. La moyenne est lue sur la bougie
  // PRÉCÉDENTE : à l'ouverture de `idx`, la clôture de `idx` n'existe pas encore,
  // et une moyenne qui l'inclurait ferait entrer sur un chiffre qu'on n'avait
  // pas. Même discipline que le non-repaint du RSI, à l'échelle du graphe.
  const mesure = (idx, side) => {
    const entry = candles[idx].open;
    const m = maOn && idx > 0 ? ma[idx - 1] : null;
    if (m == null) return { entryPrice: entry, maDist: null, maValue: null };
    // Signée dans le sens de l'EXCÈS, jamais dans celui de la position : c'est
    // une mesure de la surzone, et elle ne doit pas changer de signe quand on
    // bascule `tradeSide`. Survente → positif si l'entrée est SOUS la moyenne.
    return {
      entryPrice: entry,
      maDist:  side === 'bull' ? m - entry : entry - m,
      maValue: m,
    };
  };

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
        maPeriod:  maOn ? Math.floor(p.maDistPeriod) : null,
        ...mesure(i, side),
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

  // LE SEUIL DE DISTANCE, appliqué APRÈS coup et non pendant la boucle. Refuser
  // une zone au moment où elle s'ouvre laisserait la surzone sans zone ouverte :
  // la bougie suivante, toujours en surzone, en rouvrirait une — et une seule
  // surzone écartée se rallumerait en autant de zones qu'elle compte de bougies.
  // Filtrer la liste finie ne peut pas produire ça.
  //
  // Sans mesure — moyenne pas encore chaude, ou zone qui ouvre sur la toute
  // première bougie — la zone est ÉCARTÉE quand un seuil est actif : on ne
  // conclut pas sur ce qu'on ne sait pas évaluer. Même règle que le $$$.
  const filtrees = seuilMin || seuilMax
    ? zones.filter(z => {
        if (z.maDist == null) return false;
        const d = Math.abs(z.maDist);
        if (seuilMin && d < seuilMin) return false;
        if (seuilMax && d > seuilMax) return false;
        return true;
      })
    : zones;

  return { zones: filtrees, warmup };
}
