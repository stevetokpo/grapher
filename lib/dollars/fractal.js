// LE MODE FRACTAL — voir le motif d'une unité SUPÉRIEURE sans quitter la sienne.
//
// L'idée : détecter le $$$ sur des bougies M15 reconstruites, puis dessiner le
// résultat sur le graphe M1. On voit alors la figure telle qu'elle est en M15 —
// mêmes prix, mêmes proportions, et une extension qui couvre `extLen` bougies
// M15, donc quinze fois plus large à l'écran — tout en gardant le détail M1 sous
// les yeux. C'est un ZOOM sur une figure du HTF, pas une figure du LTF.
//
// C'EST UN AFFICHAGE, ET RIEN D'AUTRE. Les positions continuent d'être calculées
// sur les bougies du graphe. Voir une figure M15 pendant qu'on trade en M1 est
// précisément l'intérêt du mode ; croire que la gestion a suivi serait une faute
// coûteuse, et rien dans le dessin ne le laisse entendre.
//
// DEUX PRÉCAUTIONS, et elles ne sont pas décoratives :
//
//   1. LA BOUGIE HTF EN COURS EST ÉCARTÉE (cf. htfOhlcFromCandles). Un motif
//      détecté sur un bucket qui n'est pas fini se déformerait à chaque tick
//      avant de disparaître — du repaint pur.
//
//   2. LES TEMPS SONT RAMENÉS SUR DES BOUGIES QUI EXISTENT. Une zone HTF porte
//      des débuts de bucket ; sur le graphe LTF, ces instants n'ont pas toujours
//      de bougie — un week-end, une séance fermée, un trou de données suffisent.
//      La primitive rendrait alors `null` et la zone disparaîtrait SANS UN MOT,
//      ce qui est la panne la plus pénible à diagnostiquer. Chaque temps est donc
//      accroché à la première bougie du graphe qui le suit.

// ── QUELLE BOUGIE DU GRAPHE CONFIRME LA FIGURE ───────────────────────────────
// La question n'est pas cosmétique. Une figure HTF n'existe qu'à la CLÔTURE de
// sa 5e bougie ; sur le graphe LTF, cet instant tombe sur la DERNIÈRE bougie du
// bucket correspondant — et c'est la seule à partir de laquelle on avait le
// droit de voir la zone. Sans ce repère, on lit un nuage posé sur des bougies
// qui l'ont précédé et on croit qu'il était là depuis le début : exactement
// l'illusion que le mode fractal pourrait donner s'il se taisait là-dessus.

import { HTF_SECONDS, HTF_OFFSET, htfOhlcFromCandles } from '../htf';

// Première bougie du graphe dont l'heure est >= t. Recherche dichotomique : la
// fonction est appelée deux fois par zone, sur des séries de plusieurs milliers
// de bougies.
function apres(candles, t) {
  let lo = 0, hi = candles.length - 1, res = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].time >= t) { res = mid; hi = mid - 1; }
    else lo = mid + 1;
  }
  return res;
}

// Rejoue `calc` (calcDollarClouds, calcDollarPivots, calcDollars…) sur les
// bougies HTF, puis ramène les zones obtenues sur l'échelle de temps du graphe.
// Générique exprès : le jour où le fractal servira à un autre dessin que le
// nuage, il n'y aura rien à réécrire ici.
// Dernière bougie du graphe dont l'heure est STRICTEMENT antérieure à t, ou null.
function avant(candles, t) {
  const i = apres(candles, t);
  if (i < 0) return candles[candles.length - 1] ?? null;   // t dépasse les données
  return i > 0 ? candles[i - 1] : null;
}

export function fractalZones(candles, opts, calc) {
  const sec = HTF_SECONDS[opts.fractalHtf];
  if (!sec || !candles?.length) return [];

  const htf = htfOhlcFromCandles(candles, sec, HTF_OFFSET[opts.fractalHtf] ?? 0);
  if (htf.length < 5) return [];

  const zones = [];
  for (const z of calc(htf, opts)) {
    const i0 = apres(candles, z.startTime);
    if (i0 < 0) continue;                     // la zone commence après les données

    // `endTime` null veut déjà dire « jusqu'au bord droit » : on le garde tel
    // quel. Sinon, si la fin tombe au-delà des bougies chargées, on retombe sur
    // ce même « jusqu'au bord » plutôt que de perdre la zone.
    let fin = null;
    if (z.endTime != null) {
      const i1 = apres(candles, z.endTime);
      if (i1 >= 0) fin = candles[i1].time;
    }

    // La figure HTF est complète à la CLÔTURE de son bucket `readyTime` : sur le
    // graphe, c'est la dernière bougie que ce bucket contient.
    const conf = z.readyTime != null ? avant(candles, z.readyTime + sec) : null;

    zones.push({
      ...z,
      startTime: candles[i0].time,
      endTime:   fin,
      confirmTime: conf ? conf.time : null,
      // De quel HTF vient cette zone : le dessin peut le dire, et un rapport
      // futur saura qu'elle n'a pas été détectée sur les bougies du graphe.
      htf: opts.fractalHtf,
    });
  }
  return zones;
}
