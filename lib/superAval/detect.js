// super avalante — UNE bougie qui en avale plusieurs d'un coup.
//
// Le cas HAUSSIER, tel qu'il a été posé :
//   1. l'avalante est HAUSSIÈRE ;
//   2. elle est précédée d'une bougie BAISSIÈRE ;
//   3. les `count` bougies situées DERRIÈRE cette baissière tiennent
//      ENTIÈREMENT — de leur plus bas à leur plus haut — entre le plus bas et le
//      plus haut de l'avalante.
// La bougie baissière du 2., elle, n'a rien à respecter : qu'elle dépasse ou non
// ne change rien. C'est ce qui distingue le motif d'une avalante classique — on
// ne regarde pas ce qu'elle mange juste devant elle, mais jusqu'où elle remonte
// DERRIÈRE le mouvement qui vient de la précéder.
//
// Le cas BAISSIER est le même par symétrie : avalante baissière, précédée d'une
// haussière, et les `count` bougies derrière celle-ci entièrement couvertes.
//
//     ▁▁ ▁▁ ▁▁     ← les `count` bougies avalées (ici 2 + celle d'avant hors motif)
//            ▐      ← la bougie opposée : libre de dépasser
//            █      ← la SUPER AVALANTE : son haut et son bas couvrent tout
//
// CE QUI N'Y EST PAS : aucune zone, aucune position. Le motif est marqué d'un
// repère sur l'avalante, rien de plus — tant qu'on n'a pas dit ce qu'il désigne
// comme prix à jouer, en inventer un serait inventer le motif à la place de
// celui qui l'écrit.
//
// Chaque figure : { side, label, idx, fromIdx, toIdx, time, value, level,
//                   count, swallowed, high, low }
//   side      — 'bull' (avalante haussière, achat) | 'bear' (vente)
//   idx       — index de l'AVALANTE : le motif n'est connu que là
//   fromIdx   — la plus ancienne bougie de la figure, soit idx − 1 − count
//   time      — la date de l'avalante, c'est là que se pose le repère
//   value     — le prix du repère : le plus BAS de la figure entière quand elle
//               est haussière, le plus HAUT quand elle est baissière. Même
//               convention que les autres motifs à repère — et c'est l'extrême
//               qu'un stop structurel devrait couvrir, la bougie opposée
//               comprise puisqu'elle a le droit de dépasser.
//   level     — le même prix, sous le nom que porte le reste de la famille.
//   count     — le nombre EXIGÉ de bougies avalées, celui du réglage.
//   swallowed — le nombre RÉELLEMENT avalé en remontant : ≥ count, et souvent
//               plus. Rien ne le dessine ; il est là pour qu'une détection se
//               vérifie à la main, et pour trier les figures par profondeur.
//   high/low  — les deux bords de l'avalante, ceux qui ont servi à juger.

import { DETECT_DEFAULTS } from './params';

// La bougie `s` couvre-t-elle entièrement la bougie `c` ?
// Non strict (défaut) : toucher exactement le même extrême, c'est encore l'avoir
// couvert. Strict : il faut dépasser des deux côtés.
function engulfs(s, c, strict) {
  return strict
    ? (s.high > c.high && s.low < c.low)
    : (s.high >= c.high && s.low <= c.low);
}

export function calcSuperAval(candles, opts = {}) {
  const p = { ...DETECT_DEFAULTS, ...opts };
  const out = [];
  const n = candles?.length ?? 0;

  // Au moins une bougie avalée, sinon il n'y a pas de figure du tout.
  const count = Math.max(1, Math.round(p.count ?? DETECT_DEFAULTS.count));

  // La figure la plus courte tient sur 1 (avalante) + 1 (opposée) + count.
  for (let i = 1 + count; i < n; i++) {
    const s = candles[i];

    // ── Condition 1 : le sens de l'avalante ────────────────────────────────
    const bull = s.close > s.open;
    const bear = s.close < s.open;
    if (!bull && !bear) continue;                 // un doji n'avale rien
    const side = bull ? 'bull' : 'bear';
    if (p.direction !== 'both' && p.direction !== side) continue;

    // ── Condition 2 : la bougie précédente est de sens OPPOSÉ ──────────────
    const prev = candles[i - 1];
    if (bull ? !(prev.close < prev.open) : !(prev.close > prev.open)) continue;

    // ── Condition 3 : les `count` bougies DERRIÈRE l'opposée sont avalées ──
    // Elles vont de i−2 (juste derrière l'opposée) à i−1−count. La boucle ne
    // peut pas déborder du début des données : la boucle extérieure part de
    // 1 + count, donc i−1−count ≥ 0 toujours.
    let ok = true;
    for (let k = i - 2; k >= i - 1 - count; k--) {
      if (!engulfs(s, candles[k], p.strict)) { ok = false; break; }
    }
    if (!ok) continue;

    // La bougie opposée n'est jugée que si le réglage le demande — par défaut
    // elle a le droit de dépasser des deux côtés.
    if (p.engulfPrev === true && !engulfs(s, prev, p.strict)) continue;

    // Jusqu'où l'avalante remonte-t-elle VRAIMENT ? On continue de remonter
    // au-delà de ce qui était exigé, tant que les bougies tiennent dedans. Rien
    // n'en dépend : c'est une mesure de la figure, pas une condition.
    let swallowed = count;
    for (let k = i - 2 - count; k >= 0 && engulfs(s, candles[k], p.strict); k--) swallowed++;

    // L'extrême de la FIGURE ENTIÈRE, du côté que l'avalante désigne. Toutes les
    // bougies avalées tiennent déjà dans l'avalante, mais pas l'opposée : c'est
    // elle, et elle seule, qui peut repousser cet extrême au-delà.
    const fromIdx = i - 1 - count;
    let level = bull ? s.low : s.high;
    for (let k = fromIdx; k < i; k++) {
      level = bull ? Math.min(level, candles[k].low) : Math.max(level, candles[k].high);
    }

    out.push({
      side,
      label: 'super avalante',
      idx:   i,
      fromIdx,
      toIdx: i,
      time:  s.time,
      value: level,
      level,
      count,
      swallowed,
      high: s.high,
      low:  s.low,
    });
  }

  return out;
}
