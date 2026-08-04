// ringble — DEUX bougies collées et de sens opposés.
//
//   HB — haussière puis baissière → la seconde baisse, signal BAISSIER
//   BH — baissière puis haussière → la seconde monte,  signal HAUSSIER
//
// La SECONDE bougie porte tout : c'est elle qui donne le sens, et c'est elle que
// les conditions jugent. La première n'est là que comme mesure — on lui compare
// la seconde.
//
// CHAQUE SENS A SES PROPRES SEUILS. Une fois le sens de la figure connu, on va
// chercher les réglages de CE sens-là (cf. `sideOptions` dans ./params.js) et on
// juge avec eux. Le reste du fichier ne sait pas de quel côté il travaille : il
// lit `ratioMin`, `bodyRatio2`… sous leur nom générique, et c'est params.js qui
// a déjà choisi la bonne moitié.
//
// LES CONDITIONS, dans l'ordre où elles ont été posées :
//   1. TAILLE — la seconde fait au moins autant que la première (ratioMin) et
//      pas plus de ratioMax fois celle-ci. Mesurée en amplitude (défaut) ou en
//      corps, selon `sizeMode` — mais toujours de la même façon pour les deux
//      bougies, sinon la comparaison ne voudrait rien dire.
//   2. PLEINE — le corps de la seconde occupe au moins `bodyRatio2` de son
//      amplitude totale (0.8 par défaut : les mèches ne pèsent pas plus d'un
//      cinquième). Elle a poussé sans hésiter. Cette condition-là se mesure
//      toujours ainsi, quel que soit `sizeMode` : c'est la définition d'une
//      bougie pleine, pas un choix de mesure.
//   3. EXTRÊME (optionnelle, éteinte par défaut) — la paire marque un plus BAS
//      pour un BH, un plus HAUT pour un HB : son extrême dépasse celui des
//      `extremeBars` bougies qui PRÉCÈDENT la paire. Les deux bougies du motif
//      sont exclues de la comparaison — elles sont ce qu'on mesure, pas la
//      référence. Strictement, et contre TOUTES : une seule bougie qui égale
//      l'extrême suffit à écarter la figure. Sans `extremeBars` bougies
//      d'histoire disponibles, la figure est écartée plutôt que devinée.
//
// CE QUI N'Y EST PAS ENCORE : aucun niveau, aucune zone, aucune position. Le
// motif est marqué d'un repère sur sa seconde bougie, rien de plus — tant qu'on
// n'a pas dit ce qu'il désigne comme prix, en inventer un serait inventer le
// motif à la place de celui qui l'écrit.
//
// Chaque figure : { side, label, idx, fromIdx, toIdx, time, value, ratio,
//                   bodyPct, sizes }
//   side    — 'bull' (BH) | 'bear' (HB), le sens de la seconde bougie
//   idx     — index de la SECONDE bougie : le motif n'est connu que là
//   time    — sa date, c'est là que se pose le repère
//   value   — le prix du repère : le plus bas de la paire pour un BH, le plus
//             haut pour un HB (même convention que les autres motifs à repère)
//   ratio   — taille de la 2e ÷ taille de la 1e, dans l'unité de `sizeMode`
//   bodyPct — corps de la 2e ÷ son amplitude : à quel point elle est pleine

import { DETECT_DEFAULTS, sideOptions } from './params';

// La taille d'une bougie, dans l'unité choisie. Une seule définition pour les
// deux bougies comparées.
function sizeOf(bar, sizeMode) {
  return sizeMode === 'body'
    ? Math.abs(bar.close - bar.open)
    : bar.high - bar.low;
}

// La part de l'amplitude occupée par le corps. null si la bougie n'a pas
// d'amplitude (haut = bas) : il n'y a alors pas de forme à juger.
function bodyShare(bar) {
  const range = bar.high - bar.low;
  return range > 0 ? Math.abs(bar.close - bar.open) / range : null;
}

// L'extrême de la paire dépasse-t-il celui des `bars` bougies qui la PRÉCÈDENT ?
// `i` est l'index de la seconde bougie ; la fenêtre examinée est donc
// [i−1−bars … i−2], soit exactement `bars` bougies, la paire exclue.
//
// Strictement, et contre toutes : une seule bougie dont le plus bas ÉGALE celui
// de la paire suffit à dire que le motif n'a rien marqué de neuf. Et si la
// fenêtre déborde du début des données, la figure est écartée — on ne juge pas
// sur une histoire qu'on n'a pas.
function isExtreme(candles, i, side, extreme, bars) {
  const from = i - 1 - bars;
  if (from < 0) return false;
  for (let k = from; k <= i - 2; k++) {
    if (side === 'bull' ? candles[k].low  <= extreme : candles[k].high >= extreme) return false;
  }
  return true;
}

export function calcRingble(candles, opts = {}) {
  const p = { ...DETECT_DEFAULTS, ...opts };
  const out = [];
  const n = candles?.length ?? 0;
  if (n < 2) return out;

  // Les deux jeux de seuils, lus une fois pour toutes.
  const rules = { bull: sideOptions(p, 'bull'), bear: sideOptions(p, 'bear') };

  for (let i = 1; i < n; i++) {
    const b1 = candles[i - 1];
    const b2 = candles[i];

    // ── Le squelette : deux bougies de sens opposés ────────────────────────
    const bull1 = b1.close > b1.open;
    const bear1 = b1.close < b1.open;
    const bull2 = b2.close > b2.open;
    const bear2 = b2.close < b2.open;
    if (!(bull1 || bear1) || !(bull2 || bear2)) continue;   // un doji ne tranche rien
    if (bull1 === bull2) continue;                          // même sens : pas un ringble

    const side = bull2 ? 'bull' : 'bear';                   // BH ou HB
    if (p.direction !== 'both' && p.direction !== side) continue;

    // À partir d'ici, on ne juge plus qu'avec les seuils de CE sens.
    const r = rules[side];

    // ── Condition 1 : la taille de la 2e, rapportée à la 1re ───────────────
    const s1 = sizeOf(b1, r.sizeMode);
    const s2 = sizeOf(b2, r.sizeMode);
    if (!(s1 > 0)) continue;              // rien à quoi comparer
    const ratio = s2 / s1;
    if (r.ratioMin > 0 && ratio < r.ratioMin) continue;
    if (r.ratioMax > 0 && ratio > r.ratioMax) continue;

    // ── Condition 2 : la 2e est pleine ─────────────────────────────────────
    const bodyPct = bodyShare(b2);
    if (r.bodyRatio2 > 0 && !(bodyPct >= r.bodyRatio2)) continue;

    // L'extrême de la paire, du côté que le retournement désigne. Il sert deux
    // fois : à la condition 3, et comme prix du repère.
    const extreme = side === 'bull'
      ? Math.min(b1.low,  b2.low)
      : Math.max(b1.high, b2.high);

    // ── Condition 3 : la paire marque un extrême ───────────────────────────
    if (r.extremeBars > 0 && !isExtreme(candles, i, side, extreme, r.extremeBars)) continue;

    out.push({
      side,
      label:   'ringble',
      idx:     i,
      fromIdx: i - 1,
      toIdx:   i,
      time:    b2.time,
      // Le repère se pose sur l'extrême de la paire : sous elle quand la seconde
      // monte, au-dessus quand elle baisse.
      value:   extreme,
      ratio,
      bodyPct,
      sizes:   { first: s1, second: s2 },
    });
  }

  return out;
}
