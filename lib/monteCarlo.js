// MONTE-CARLO DES POSITIONS — ce que le hasard aurait pu faire de ces trades.
//
// Un backtest rend UNE courbe : 400 trades dans un ordre précis, un creux de
// −12 %. Cet ordre est un accident de l'histoire. Ce module rejoue les mêmes
// résultats des milliers de fois dans d'autres ordres (ou en retire d'autres
// dans le même chapeau) et rend la DISTRIBUTION de ce que le compte aurait
// vécu : le creux médian, celui du pire centile, la plus longue série de pertes,
// le temps passé sous l'eau, la probabilité de ruine à capital donné.
//
// DEUX MODES, DEUX QUESTIONS DIFFÉRENTES — les confondre est l'erreur classique.
//
//   'shuffle'   REBATTAGE, sans remise. Exactement les mêmes trades, un autre
//               ordre. Le total final est donc IDENTIQUE à chaque tirage : seul
//               le CHEMIN change. C'est le mode qui répond à « mon drawdown
//               est-il de la malchance ou la normale ? » sans rien supposer de
//               plus que l'indépendance de l'ordre. C'est aussi, mot pour mot,
//               un test de permutation : le rang de l'observé dans la
//               distribution EST une p-valeur.
//   'bootstrap' TIRAGE AVEC REMISE. n trades retirés au hasard dans le même
//               chapeau, doublons permis. Le total varie alors, ce qui donne la
//               dispersion du RÉSULTAT FINAL et la probabilité de finir dans le
//               rouge. En échange, ce mode suppose les trades i.i.d. — tirés
//               d'une même loi, indépendants —, ce qui est une hypothèse forte
//               et souvent fausse.
//
// CE QUE LE MONTE-CARLO NE FAIT PAS, et qu'on lui prête sans arrêt :
//
//   • Il ne répare AUCUN surapprentissage. Rebattre les trades de la meilleure
//     config d'un balayage de 112 configs ne dit rien de sa validité hors
//     échantillon — seulement de la variance de ce jeu de trades là. La porte
//     de significativité reste le contrôle par décalage circulaire.
//   • Il suppose l'ordre sans mémoire. Si les pertes se GROUPENT (régime de
//     marché, motif qui s'enchaîne), rebattre les disperse et le creux simulé
//     sort trop optimiste. C'est mesurable, et c'est même le meilleur usage du
//     mode 'shuffle' : quand le drawdown réel se loge au p97 des rebattages,
//     c'est que les pertes se suivent, et la distribution simulée SOUS-ESTIME
//     le risque au lieu de le décrire. Le rang rendu ici sert précisément à ça.
//   • Il hérite de tous les défauts de la série qu'on lui donne. Des positions
//     qui se chevauchent produisent une courbe qui n'est pas la suite des
//     encaissements d'un compte : le creux y est déjà optimiste avant le
//     premier tirage, et le rebattage ne le corrige pas.
//   • Il ne sait rien d'un plan de taille. Rebattre des résultats déjà
//     multipliés par un lot en escalier accrocherait le lot du 300e trade au
//     résultat du 12e : ce serait mesurer le calendrier des lots. La série à
//     donner ici est donc celle À 1 LOT, celle de la stratégie.
//
// TOUT EST EN POINTS, comme partout ailleurs dans la chaîne — la conversion en
// dollars est un facteur d'affichage, et tout ce qui sort d'ici est linéaire en
// l'entrée. Le capital de ruine, lui, se convertit en points AVANT d'arriver.

const DEFAULTS = {
  mode: 'shuffle',
  draws: 2000,
  // Graine FIXE, et c'est important : un même rapport doit rendre deux fois les
  // mêmes quantiles. Sans ça, changer le prix du point ferait bouger le p95 du
  // drawdown, et on croirait avoir découvert quelque chose.
  seed: 20260813,
  // Points de contrôle du faisceau. 200 suffisent à dessiner un cône lisse sur
  // 1080 px de large, et gardent la matrice de quantiles à quelques Mo.
  checkpoints: 200,
  // Garde-fou de coût : tirages × trades. Un rapport 1m peut porter des dizaines
  // de milliers de positions, et 10 000 tirages dessus figeraient l'onglet une
  // dizaine de secondes. Le nombre de tirages réellement joué est rendu, pour
  // que la page puisse le dire au lieu de mentir sur ce qu'elle a calculé.
  budget: 2e7,
};

export const MC_MODES = ['shuffle', 'bootstrap'];

// mulberry32 — générateur déterministe, 32 bits d'état. Math.random() ferait
// exactement le même travail statistique, mais pas deux fois de suite : c'est la
// reproductibilité qu'on achète ici, pas la qualité du hasard.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Quantile par interpolation linéaire (type 7, celui de R et de numpy) sur un
// tableau DÉJÀ TRIÉ.
function quantile(sorted, q) {
  const n = sorted.length;
  if (!n) return null;
  if (n === 1) return sorted[0];
  const h = (n - 1) * q;
  const lo = Math.floor(h), hi = Math.ceil(h);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
}

// Combien d'éléments d'un tableau trié valent au plus x. Dichotomie : le rang de
// l'observé et la probabilité de ruine se relisent alors en O(log n), donc à
// chaque frappe dans le champ « capital » sans rejouer une seule simulation.
function countLE(sorted, x) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * UN SEUL PARCOURS, pour le vrai ordre comme pour les tirages. Deux boucles
 * séparées finiraient par diverger d'un détail — le pic de départ, la bougie où
 * le creux se compte — et le rang de l'observé ne comparerait plus la même
 * chose que ce qu'il prétend.
 *
 * Le pic part de 0, comme dans lib/signals/stats.js : le drawdown se mesure
 * depuis le capital de départ, pas depuis le premier sommet.
 *
 * @param gainAt  (i) => résultat du i-ème trade du chemin
 * @param n       longueur du chemin
 * @param cpIdx   indices des points de contrôle (croissants)
 * @param mat     matrice [point de contrôle][tirage] où déposer le cumul, ou null
 * @param d       colonne à remplir dans `mat`
 * @param draws   pas de la matrice
 */
function walk(gainAt, n, cpIdx, mat, d, draws) {
  let cum = 0, peak = 0, maxDD = 0, minCum = 0;
  let streak = 0, maxStreak = 0, uw = 0, maxUw = 0;
  let c = 0;
  const nCp = cpIdx.length;
  for (let i = 0; i < n; i++) {
    const g = gainAt(i);
    cum += g;
    if (cum > peak) peak = cum;
    else {
      const dd = peak - cum;
      if (dd > maxDD) maxDD = dd;
    }
    if (cum < minCum) minCum = cum;
    // Série de pertes : un résultat nul (un break-even parfait) ne la prolonge
    // pas plus qu'il ne la casse — il la casse, comme dans stats.js, où seul
    // g < 0 compte. Deux définitions donneraient deux « pire série » pour le
    // même rapport.
    if (g < 0) { if (++streak > maxStreak) maxStreak = streak; }
    else streak = 0;
    // Temps sous l'eau : combien de trades d'affilée sans revoir le sommet.
    if (cum < peak) { if (++uw > maxUw) maxUw = uw; }
    else uw = 0;
    if (c < nCp && i === cpIdx[c]) {
      if (mat) mat[c * draws + d] = cum;
      c++;
    }
  }
  return { net: cum, maxDD, lossStreak: maxStreak, underwater: maxUw, minCum };
}

// Résumé d'une distribution + où se loge la valeur observée dedans.
// `rank` = part des tirages qui font AU PLUS aussi bien que l'observé. Pour un
// drawdown (où « plus » est pire), un rang de 0.97 dit que 97 % des chemins ont
// creusé MOINS : le creux réel est dans les 3 % les pires.
function dist(sorted, observed) {
  const n = sorted.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += sorted[i];
  return {
    min:  sorted[0],
    p5:   quantile(sorted, 0.05),
    p25:  quantile(sorted, 0.25),
    p50:  quantile(sorted, 0.50),
    p75:  quantile(sorted, 0.75),
    p95:  quantile(sorted, 0.95),
    max:  sorted[n - 1],
    mean: sum / n,
    observed,
    rank: countLE(sorted, observed) / n,
  };
}

/**
 * @param gains  résultats NETS par trade, en points, DANS L'ORDRE RÉEL (celui
 *   des entrées). À 1 lot : voir l'avertissement en tête de fichier.
 * @param opts.mode    'shuffle' (défaut) ou 'bootstrap'
 * @param opts.draws   nombre de tirages (2000 par défaut, ramené sous le budget)
 * @param opts.seed    graine du générateur
 * @returns null si moins de deux trades — il n'y a alors rien à rebattre.
 */
export function runMonteCarlo(gains, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const n = gains.length;
  if (n < 2) return null;

  const bootstrap = o.mode === 'bootstrap';
  const asked = Math.max(1, Math.floor(o.draws));
  // Au moins 200 tirages quoi qu'il arrive : sous ce seuil un p95 n'est plus
  // qu'une anecdote, autant ne rien afficher.
  const draws = Math.max(Math.min(asked, 200), Math.min(asked, Math.floor(o.budget / n)));

  // Points de contrôle : indices croissants et distincts (le pas vaut au moins
  // 1 puisque nCp ≤ n), dernier trade toujours inclus.
  const nCp = Math.min(o.checkpoints, n);
  const cpIdx = new Int32Array(nCp);
  for (let c = 0; c < nCp; c++) cpIdx[c] = Math.round(((c + 1) / nCp) * n) - 1;

  // L'ORDRE RÉEL d'abord, avec exactement la même boucle : c'est lui la
  // référence à laquelle tout le reste se compare.
  const obsPath = new Float64Array(nCp);
  const observed = walk(i => gains[i], n, cpIdx, obsPath, 0, 1);

  const rand = mulberry32(o.seed);
  const mat = new Float64Array(nCp * draws);
  const nets = new Float64Array(draws);
  const dds = new Float64Array(draws);
  const streaks = new Float64Array(draws);
  const uws = new Float64Array(draws);
  const mins = new Float64Array(draws);

  const idx = new Int32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;

  for (let d = 0; d < draws; d++) {
    let gainAt;
    if (bootstrap) {
      gainAt = () => gains[(rand() * n) | 0];
    } else {
      // Fisher-Yates EN PLACE, sur le tableau déjà mélangé du tirage précédent.
      // C'est légitime : un passage de Fisher-Yates rend un mélange uniforme
      // quel que soit l'état de départ. Et ça évite n allocations par tirage,
      // ce qui, à 2000 tirages sur 2000 trades, se voit.
      for (let i = n - 1; i > 0; i--) {
        const j = (rand() * (i + 1)) | 0;
        const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
      }
      gainAt = i => gains[idx[i]];
    }
    const s = walk(gainAt, n, cpIdx, mat, d, draws);
    nets[d] = s.net;
    dds[d] = s.maxDD;
    streaks[d] = s.lossStreak;
    uws[d] = s.underwater;
    mins[d] = s.minCum;
  }

  // Enveloppe du faisceau : à chaque point de contrôle, les quantiles du cumul
  // sur tous les tirages. Bien plus lisible que 2000 courbes superposées, et
  // c'est la seule forme qui tienne quand les tirages se comptent en milliers.
  const band = { p5: [], p25: [], p50: [], p75: [], p95: [] };
  const col = new Float64Array(draws);
  for (let c = 0; c < nCp; c++) {
    col.set(mat.subarray(c * draws, (c + 1) * draws));
    col.sort();
    band.p5.push(quantile(col, 0.05));
    band.p25.push(quantile(col, 0.25));
    band.p50.push(quantile(col, 0.50));
    band.p75.push(quantile(col, 0.75));
    band.p95.push(quantile(col, 0.95));
  }

  const netsSorted = nets.slice().sort();
  const ddsSorted = dds.slice().sort();
  const streaksSorted = streaks.slice().sort();
  const uwsSorted = uws.slice().sort();

  return {
    mode: o.mode,
    n,
    draws,
    // Le nombre demandé, quand le budget l'a rogné : la page doit pouvoir dire
    // ce qu'elle a réellement joué.
    drawsAsked: asked,
    observed: { ...observed, path: Array.from(obsPath) },
    net: dist(netsSorted, observed.net),
    maxDD: dist(ddsSorted, observed.maxDD),
    lossStreak: dist(streaksSorted, observed.lossStreak),
    underwater: dist(uwsSorted, observed.underwater),
    // Part des tirages qui finissent dans le rouge. En rebattage elle vaut 0 ou
    // 1 — le total ne dépend pas de l'ordre —, et c'est justement ce qui dit que
    // la question ne se pose pas dans ce mode.
    pctLoss: countLE(netsSorted, -1e-12) / draws,
    // Le CREUX ABSOLU de chaque chemin (son point le plus bas sous zéro), trié.
    // C'est tout ce qu'il faut pour relire une probabilité de ruine à n'importe
    // quel capital, sans rejouer la simulation.
    minCums: mins.slice().sort(),
    // L'enveloppe du faisceau et la grille sur laquelle elle est échantillonnée.
    band,
    checkpoints: Array.from(cpIdx),
    // Les échantillons bruts et TRIÉS, pour les histogrammes : les bornes s'y
    // lisent aux deux bouts sans reparcourir 10 000 nombres.
    netsSorted, ddsSorted, streaksSorted, uwsSorted,
  };
}

/**
 * Probabilité de ruine à capital donné, relue dans les creux déjà simulés.
 * « Ruine » = le cumul est PASSÉ sous −capital au moins une fois. Le chemin,
 * lui, continue ensuite dans la simulation : le résultat final d'un chemin ruiné
 * est donc fictif, puisqu'un vrai compte se serait arrêté là. C'est assumé — la
 * probabilité de toucher le fond est la question, pas ce qu'il y aurait eu
 * après.
 *
 * @param mc          sortie de runMonteCarlo
 * @param capitalPts  capital de départ EN POINTS (0 ou moins : pas de calcul)
 */
export function ruinProbability(mc, capitalPts) {
  if (!mc || !(capitalPts > 0)) return null;
  return countLE(mc.minCums, -capitalPts) / mc.draws;
}
