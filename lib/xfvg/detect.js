// xFVG — la détection.
//
// CE QUE C'EST. Deux façons de lire les bougies, choisies par le réglage `mode`.
// Les deux posent une boîte et rien d'autre : pas de mode « position », donc pas
// d'entrée, pas de SL/TP, pas de simulation. Une zone, tirée à droite sur extLen
// barres puis coupée net.
//
//   • mode 'x3' — l'IMBALANCE, le motif d'origine. Trois bougies dont la
//     CENTRALE creuse le gap. C'est le motif nu de la famille rFVG (l'ancien
//     mode 'all', aFVG) : pas de moyenne mobile, pas de sous-familles, il ne
//     reste comme conditions que celles portant sur la 2e bougie (l'impulsion)
//     et la 3e (la respiration).
//
//   • mode 'x2' — le RETOURNEMENT contra-MM, ajouté le 30/07/2026. Deux bougies :
//     une impulsion large, ENTIÈREMENT du côté opposé à son sens par rapport à
//     la MM (haussière sous la MM, baissière au-dessus), puis une petite bougie
//     qui ne relance pas le mouvement — de sens CONTRAIRE, ou (option
//     x2AllowSame) de même sens mais quasi sans corps. La boîte est ce qui reste
//     du corps de l'impulsion que la respiration n'a pas repris.
//     Cousin du KO (calcKO, lib/patterns.js) et il faut savoir en quoi il en
//     diffère : une seule MM au lieu de deux, respiration de sens IMPOSÉ au lieu
//     de sens libre, et pas de filtre de plénitude (corps/amplitude).
//     Une option (`x2Imb`) y rajoute l'imbalance du mode 'x3' — mais en simple
//     condition, sans toucher à la boîte. Les deux modes se rejoignent alors sur
//     la mesure, jamais sur la zone dessinée : c'est la raison d'être des deux
//     modes plutôt que d'un seul motif à réglages.
//
// COMMENT C'EST BÂTI — TROIS ÉTAGES, et il faut savoir lequel on vise.
//
//   1. Le SQUELETTE (SKELETONS) — la définition même du motif : quelles bougies,
//      quel côté, quelles bornes. Un squelette par mode, et c'est le SEUL étage
//      qui a le droit de poser une boîte. On n'en ajoute un que pour une figure
//      franchement différente, jamais pour une condition de plus.
//
//   2. Les RÈGLES (RULES) — des prédicats isolés qui jugent UNE bougie candidate
//      avec ce qu'on sait d'elle seule. Une règle ne voit jamais les autres
//      motifs. Chacune déclare les modes où elle s'applique.
//
//   3. Les FILTRES DE ZONES (ZONE_FILTERS), qui passent APRÈS et reçoivent la
//      liste complète. C'est le seul endroit d'où l'on peut juger un motif par
//      rapport aux AUTRES motifs — « celui-ci est précédé d'un motif inverse
//      tout proche » n'est pas une question qu'on peut poser à une bougie.
//      Impossible d'en faire une règle : pendant la boucle, les zones qui suivent
//      n'existent pas encore, et celles qui précèdent n'ont pas fini d'être
//      filtrées.
//
// Une condition nouvelle s'ajoute donc SANS toucher à la boucle, dans l'étage qui
// correspond à ce qu'elle regarde. Éteinte, elle ne coûte rien : les listes sont
// filtrées une fois pour toutes avant le travail, et le squelette du mode inactif
// n'est jamais appelé. C'est ce qui doit empêcher le motif de dériver vers
// l'escalier de `if` de calcRFVG au fil des ajouts.
//
// Chaque zone : { side, state: 'active', label, idx, top, bottom, gap,
//                 startTime, endTime, entryIdx, entryTime, entryPrice }
//   idx          → l'index de l'IMPULSION dans `candles`, quel que soit le mode.
//                  En 'x3' la 1re bougie est en idx−1 et la 3e en idx+1 ; en 'x2'
//                  l'impulsion ouvre le motif et la respiration est en idx+1. Les
//                  filtres de zones s'en servent pour mesurer des distances en
//                  BARRES d'un motif à l'autre.
//   gap          → l'écart SIGNÉ qui a fait la boîte. Son sens dépend du mode
//                  (le vide entre 1re et 3e en 'x3', le corps d'impulsion non
//                  repris en 'x2'), sa convention non : > 0 = dégagé, < 0 = les
//                  deux bougies empiètent l'une sur l'autre.
//   endTime null → extLen dépasse la fin des données, la boîte va jusqu'au bord.
//   entry*       → l'ouverture de la bougie qui SUIT le motif. Les deux modes se
//                  terminent en idx+1, donc c'est idx+2 dans les deux cas.
//                  Inutile au dessin, gardé parce que c'est le seul prix qu'une
//                  future simulation pourrait honnêtement prendre : le motif
//                  n'est connu qu'à la clôture de sa dernière bougie.

import { atrArr, smaArr } from '../patterns';
import {
  impulseIsLarge, breathIsSmall, breathHasWick,
  usesImpulseSize, usesBreathSize, usesBreathWick,
} from '../candleRules';
import { DETECT_DEFAULTS } from './params';

// ── Les squelettes ───────────────────────────────────────────────────────────
// Un squelette = { maPeriod(p), build(ctx, i, p) → x | null }.
//   maPeriod  la période de MM dont il a besoin, 0 s'il n'en veut aucune. Sans
//             ça, la série n'est pas allouée — même logique que needsAtr.
//   build     rend le CONTEXTE du candidat ouvert en i, ou null si la bougie i
//             n'ouvre rien. Le contexte est ce que liront les règles :
//             { candles, atr, ma, i, m, c, side, isBull, isBear, gap, top,
//             bottom } — et `a` en plus pour le mode 'x3'.
//             `m` est TOUJOURS l'impulsion et `c` TOUJOURS la respiration, dans
//             les deux modes : c'est ce qui permet aux prédicats de
//             lib/candleRules.js de servir tels quels de part et d'autre.
//             Le squelette ne connaît pas `direction` : filtrer un côté n'est pas
//             définir une figure, ça se fait après lui.

// Le corps rapporté à l'amplitude : 1 = bougie PLEINE, sans la moindre mèche ;
// 0 = doji, rien que de la mèche. C'est la mesure de FORME de la bougie, celle
// qui ne dépend d'aucune référence extérieure — contrairement aux seuils en ATR,
// qui disent sa taille. Les deux se cumulent partout où elles sont posées.
// Amplitude nulle (bougie parfaitement plate) : le ratio serait 0/0, on le lit 0
// — même convention que le KO, une bougie plate étant le comble de l'indécision.
function bodyRatio(c) {
  const range = c.high - c.low;
  return range > 0 ? Math.abs(c.close - c.open) / range : 0;
}

export const SKELETONS = {
  // Trois bougies, la centrale creuse le gap.
  x3: {
    maPeriod: () => 0,
    build(ctx, i, p) {
      const { candles } = ctx;
      const a = candles[i - 1]; // 1re — borne haute ou basse du gap
      const m = candles[i];     // 2e  — l'impulsion, celle qui creuse le gap
      const c = candles[i + 1]; // 3e  — l'autre borne

      // L'impulsion est directionnelle. Un doji ne creuse rien.
      const isBull = m.close > m.open;
      const isBear = m.close < m.open;
      if (!isBull && !isBear) return null;

      // Les deux NIVEAUX du motif et leur écart SIGNÉ.
      //   baissier : gap = bas de la 1re − haut de la 3e
      //   haussier : gap = bas de la 3e  − haut de la 1re
      // gap > 0 : les deux bougies ne se touchent pas, la zone est le vide entre
      //           elles — le FVG classique.
      // gap < 0 : elles se recouvrent, et la zone est leur bande commune : mêmes
      //           bornes, simplement dans l'autre ordre. minPts, qui peut être
      //           négatif, décide seul si ces chevauchements comptent.
      const hi  = isBear ? a.low  : c.low;
      const lo  = isBear ? c.high : a.high;
      const gap = hi - lo;
      if (gap === 0 || gap < p.minPts) return null;

      return {
        ...ctx, i, a, m, c,
        side: isBull ? 'bull' : 'bear', isBull, isBear,
        gap, top: gap > 0 ? hi : lo, bottom: gap > 0 ? lo : hi,
      };
    },
  },

  // Deux bougies : impulsion contra-MM, puis respiration de sens contraire.
  x2: {
    maPeriod: p => p.x2MaPeriod,
    build(ctx, i, p) {
      const { candles, ma } = ctx;
      const m = candles[i];     // B1 — l'impulsion
      const c = candles[i + 1]; // B2 — la respiration, de sens CONTRAIRE

      const isBull = m.close > m.open;
      const isBear = m.close < m.open;
      if (!isBull && !isBear) return null;

      // La respiration ne doit pas RELANCER le mouvement. Deux façons de s'en
      // assurer, la seconde ouverte par x2AllowSame :
      //   • sens CONTRAIRE — elle rend du terrain. Sa taille est jugée ailleurs,
      //     par la règle 'x2Breath' ; ici on ne regarde que le sens.
      //   • même sens, mais INDÉCISE — corps ≤ x2SameRatio × amplitude, donc
      //     presque rien que de la mèche : elle repart dans le sens du motif
      //     sans rien conclure. Un doji tombe dans cette branche lui aussi : il
      //     n'a pas de sens à opposer, mais son corps nul en fait le comble de
      //     l'indécision.
      // x2SameRatio ne juge QUE ce cas-là ; le plafond général de forme de la
      // respiration, lui, est la règle 'x2BreathRatio' et s'applique aux deux
      // sens. Pour une respiration de même sens les deux se cumulent : c'est le
      // plus strict des deux qui décide.
      const opposed = isBull ? c.close < c.open : c.close > c.open;
      if (!opposed) {
        if (!p.x2AllowSame) return null;
        if (bodyRatio(c) > p.x2SameRatio) return null;
      }

      // Le retournement : l'impulsion est ENTIÈREMENT du côté opposé à son sens
      // par rapport à la MM, mèches comprises — haussière sous la MM, baissière
      // au-dessus. C'est cette condition, et elle seule, qui distingue le motif
      // d'une grosse bougie quelconque suivie d'une petite.
      // MM à 0 = filtre éteint, comme partout ailleurs ici.
      if (ma) {
        const avg = ma[i];
        if (avg == null) return null;                        // MM pas encore chaude
        if (isBull ? m.high >= avg : m.low <= avg) return null;
      }

      // La boîte : ce qui RESTE du corps de l'impulsion, entre son ouverture et
      // l'extrémité de la respiration qui lui fait face.
      //   haussier (HB) : du plus BAS de la respiration baissière jusqu'à
      //                   l'ouverture de l'impulsion haussière
      //   baissier (BH) : du plus HAUT de la respiration haussière jusqu'à
      //                   l'ouverture de l'impulsion baissière
      // gap SIGNÉ, même convention et même réglage (minPts) qu'en mode 'x3' :
      // > 0 = la respiration n'a pas rendu tout le terrain, < 0 = elle est
      // repassée au-delà de l'ouverture de l'impulsion.
      const hi  = isBull ? c.low  : m.open;
      const lo  = isBull ? m.open : c.high;
      const gap = hi - lo;
      if (gap === 0 || gap < p.minPts) return null;

      return {
        ...ctx, i, m, c,
        side: isBull ? 'bull' : 'bear', isBull, isBear,
        gap, top: gap > 0 ? hi : lo, bottom: gap > 0 ? lo : hi,
      };
    },
  },
};

// ── Les règles ───────────────────────────────────────────────────────────────
// Une règle = { id, modes, needsAtr, active(p), test(x, p) }.
//   modes   les modes où elle s'applique. Une règle d'un autre mode n'est jamais
//           consultée — c'est ce qui laisse chaque mode garder SES seuils sans
//           que ceux de l'autre viennent le filtrer par-dessus.
//   active  décide si la règle s'applique, d'après les réglages. Renvoyer false
//           quand le réglage est à sa valeur neutre (0 / false) : c'est ce qui
//           rend les filtres gratuits une fois éteints.
//   test    renvoie true si la bougie candidate PASSE. Reçoit x, le contexte
//           rendu par le squelette.
//   needsAtr fait calculer la série d'ATR. Sans aucune règle qui le demande,
//           elle n'est même pas allouée.
export const RULES = [
  {
    id:       'size',
    modes:    ['x3'],
    needsAtr: true,
    active:   usesImpulseSize,
    test:     impulseIsLarge,
  },
  {
    // La 3e bougie est jugée avec l'ATR lu sur l'impulsion (i), la bougie qui la
    // précède — d'où le x.i inchangé et le x.c passé au prédicat.
    id:       'smallThird',
    modes:    ['x3'],
    needsAtr: true,
    active:   usesBreathSize,
    test:     breathIsSmall,
  },
  {
    id:       'wickThird',
    modes:    ['x3'],
    needsAtr: false,
    active:   usesBreathWick,
    test:     breathHasWick,
  },

  // Le mode 'x2' rejoue les deux mêmes questions — l'impulsion est-elle large,
  // la respiration est-elle petite — mais avec SES réglages, et les prédicats
  // reçoivent donc un p reconstruit sous les noms qu'ils attendent. Les clés
  // sont séparées à dessein : les deux figures ne se calibrent pas pareil (ici
  // le corps et 0,3 × ATR sur la respiration, là-haut l'amplitude et une
  // respiration libre), et partager les clés aurait forcé l'un des deux modes à
  // démarrer hors de sa définition.
  {
    id:       'x2Size',
    modes:    ['x2'],
    needsAtr: true,
    active:   p => p.atrPeriod > 0 && p.x2AtrMult > 0,
    test:     (x, p) => impulseIsLarge(x, { atrMult: p.x2AtrMult, sizeMode: p.x2SizeMode }),
  },
  {
    // UNE seule référence d'ATR pour les deux bougies, lue AVANT l'impulsion —
    // la décision prise pour le KO, et pour la même raison : à l'index i, l'ATR
    // contient déjà l'impulsion, et la respiration paraîtrait petite juste parce
    // que la référence a grossi. breathIsSmall lit atr[x.i], on lui passe donc
    // un x décalé d'un cran pour qu'il lise atr[i−1], celui qu'a déjà utilisé la
    // règle ci-dessus.
    id:       'x2Breath',
    modes:    ['x2'],
    needsAtr: true,
    active:   p => p.atrPeriod > 0 && p.x2BreathMult > 0,
    test:     (x, p) => breathIsSmall({ ...x, i: x.i - 1 }, { atrMult3: p.x2BreathMult }),
  },
  // Les deux conditions de FORME, en regard des deux conditions de TAILLE
  // ci-dessus. Une bougie peut être grosse et pleine de mèches, ou minuscule et
  // parfaitement pleine : taille et forme ne disent pas la même chose, et se
  // règlent donc séparément.
  {
    // L'impulsion est PLEINE : elle a poussé sans se faire repousser.
    id:       'x2ImpulseRatio',
    modes:    ['x2'],
    needsAtr: false,
    active:   p => p.x2ImpulseRatio > 0,
    test:     (x, p) => bodyRatio(x.m) >= p.x2ImpulseRatio,
  },
  {
    // La respiration est INDÉCISE : surtout de la mèche. Vaut pour les deux sens,
    // contrairement à x2SameRatio qui ne juge que celles de même sens.
    id:       'x2BreathRatio',
    modes:    ['x2'],
    needsAtr: false,
    active:   p => p.x2BreathRatio < 1,
    test:     (x, p) => bodyRatio(x.c) <= p.x2BreathRatio,
  },
  {
    // L'imbalance du mode 'x3', rapportée ici en simple CONDITION : un vide entre
    // la bougie qui précède l'impulsion (i−1) et la respiration (i+1), sautées
    // toutes deux par l'impulsion. C'est mot pour mot la mesure du mode 3
    // bougies — même formule, même convention signée — mais elle ne fait rien
    // d'autre que qualifier le motif : la boîte reste celle du mode 'x2', le
    // corps d'impulsion non repris. Et elle s'ajoute ici à la MM et au sens
    // imposé de la respiration, que le mode 'x3' n'exige pas.
    // i ≥ 1 est garanti par les bornes de la boucle : i−1 existe toujours.
    id:       'x2Imb',
    modes:    ['x2'],
    needsAtr: false,
    active:   p => p.x2Imb === true,
    test:     (x, p) => {
      const a   = x.candles[x.i - 1];
      const gap = x.isBull ? x.c.low - a.high : a.low - x.c.high;
      return gap !== 0 && gap >= p.x2ImbMinPts;
    },
  },
];

// ── Les filtres de zones ─────────────────────────────────────────────────────
// Un filtre = { id, needsAtr, active(p), apply(zones, p, ctx) → zones }.
// Il reçoit la liste ENTIÈRE, dans l'ordre des bougies, et rend celle qu'il
// garde. Il a le droit de ré-étiqueter une zone (c'est même le seul étage qui le
// peut) mais pas d'en déplacer une : les bornes d'une boîte sortent du motif, pas
// du tri qu'on fait ensuite.

// Écart vertical SIGNÉ entre deux boîtes, en prix.
//   > 0 : elles ne se touchent pas, c'est le vide qui les sépare
//   < 0 : elles se chevauchent, de cette hauteur-là
// Même convention que le `gap` d'un motif, pour ne pas avoir deux façons de dire
// « proche » dans le même fichier.
function separation(a, b) {
  return Math.max(a.bottom, b.bottom) - Math.min(a.top, b.top);
}

export const ZONE_FILTERS = [
  {
    // liqxFVG — un xFVG précédé d'un motif de sens INVERSE, proche des deux
    // façons à la fois : à quelques bougies derrière lui, et à portée verticale.
    // Les deux boîtes forment alors une pince, souvent entrelacée, autour du même
    // prix : le marché a laissé un déséquilibre dans un sens puis dans l'autre,
    // presque au même endroit.
    //
    // La PAIRE est conservée, pas seulement le motif retenu : l'entrelacement ne
    // se lit pas si le partenaire disparaît. Le motif retenu est ré-étiqueté
    // 'liqxFVG', le partenaire garde 'xFVG' — on voit ainsi lequel a déclenché.
    id:       'liq',
    needsAtr: true,
    active:   p => p.liq === true,
    apply: (zones, p, { atr }) => {
      const triggers = new Set();
      const partners = new Set();

      for (let j = 0; j < zones.length; j++) {
        const z   = zones[j];
        const ref = atr[z.idx];
        if (ref == null) continue;
        const maxSep = p.liqMaxSepAtr * ref;

        // En arrière, du plus proche au plus lointain. Les zones sont dans
        // l'ordre des bougies : dès qu'on dépasse la fenêtre, tout ce qui reste
        // derrière est encore plus loin — on s'arrête.
        for (let k = j - 1; k >= 0; k--) {
          const o = zones[k];
          if (z.idx - o.idx > p.liqMaxBars) break;
          if (o.side === z.side) continue;
          if (separation(z, o) > maxSep) continue;
          triggers.add(j);
          partners.add(k);
        }
      }

      const out = [];
      for (let j = 0; j < zones.length; j++) {
        if (triggers.has(j))      out.push({ ...zones[j], label: 'liqxFVG' });
        else if (partners.has(j)) out.push(zones[j]);
      }
      return out;
    },
  },
];

// ── Le détecteur ─────────────────────────────────────────────────────────────
// Options : celles de DETECT_DEFAULTS (lib/xfvg/params.js). Tout réglage absent
// reprend son défaut, donc calcXFVG(candles) seul donne l'imbalance nue.
export function calcXFVG(candles, opts = {}) {
  const p = { ...DETECT_DEFAULTS, ...opts };
  const n = candles?.length ?? 0;
  const zones = [];
  if (n < 3) return zones;

  // Un mode inconnu (motif enregistré avant l'ajout du réglage) retombe sur
  // l'imbalance : c'est ce que le motif faisait avant qu'il y ait des modes.
  const mode = SKELETONS[p.mode] ? p.mode : DETECT_DEFAULTS.mode;
  const sk   = SKELETONS[mode];

  const rules   = RULES.filter(r => r.modes.includes(mode) && r.active(p));
  const filters = ZONE_FILTERS.filter(f => f.active(p));
  const needAtr = rules.some(r => r.needsAtr) || filters.some(f => f.needsAtr);
  const atr     = needAtr ? atrArr(candles, p.atrPeriod) : null;

  const maPeriod = sk.maPeriod(p);
  const ma       = maPeriod > 0 ? smaArr(candles, maPeriod) : null;

  const ctx = { candles, atr, ma };

  // Bornes communes aux deux squelettes : 'x3' a besoin de i−1 et de i+1, 'x2'
  // de i+1 et de l'ATR lu en i−1. Même intervalle.
  for (let i = 1; i < n - 1; i++) {
    // Étage 1 — la figure et ses bornes.
    const x = sk.build(ctx, i, p);
    if (!x) continue;
    if (p.direction !== 'both' && p.direction !== x.side) continue;

    // Étage 2 — les règles, sur un candidat déjà géométriquement complet : une
    // règle à venir peut donc se servir de la boîte (top/bottom/gap), pas
    // seulement des bougies.
    let passed = true;
    for (const r of rules) {
      if (!r.test(x, p)) { passed = false; break; }
    }
    if (!passed) continue;

    const endIdx = i + p.extLen;
    zones.push({
      side:      x.side,
      state:     'active',
      label:     'xFVG',
      idx:       i,
      top:       x.top,
      bottom:    x.bottom,
      gap:       x.gap,
      startTime: x.m.time,
      endTime:   endIdx < n ? candles[endIdx].time : null,
      entryIdx:   i + 2 < n ? i + 2 : null,
      entryTime:  i + 2 < n ? candles[i + 2].time : null,
      entryPrice: i + 2 < n ? candles[i + 2].open : null,
    });
  }

  // Étage 3 — les filtres qui jugent les zones les unes par rapport aux autres.
  // Enchaînés dans l'ordre, chacun sur ce que le précédent a laissé.
  let out = zones;
  for (const f of filters) out = f.apply(out, p, { candles, atr });
  return out;
}
