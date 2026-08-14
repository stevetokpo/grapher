// ICHIMOKU KINKO HYO — « l'équilibre d'un coup d'œil ».
//
// Cinq courbes, dont deux décalées dans le FUTUR : c'est tout l'intérêt du
// nuage. Là où une moyenne mobile ne dit que le passé, le kumo est déjà tracé
// 26 bougies devant le prix — le support et la résistance sont connus AVANT
// que le marché n'y arrive.
//
//   · Tenkan-sen  (9)   milieu du canal des 9 dernières bougies
//   · Kijun-sen   (26)  milieu du canal des 26 dernières
//   · Senkou A          (Tenkan + Kijun) / 2,  poussée de 26 bougies en avant
//   · Senkou B    (52)  milieu du canal des 52, poussée de 26 en avant
//   · Chikou            la clôture, ramenée 26 bougies en arrière
//
// Le NUAGE est la surface entre Senkou A et Senkou B. Sa couleur suit le signe
// de A − B : A dessus = nuage haussier. Le calcul ne rend pas une couleur mais
// la paire de valeurs à chaque instant, et c'est le rendu qui tranche — y
// compris à l'intérieur d'une bougie, là où les deux courbes se croisent.
//
// LE MILIEU DU CANAL, PAS UNE MOYENNE. Chaque ligne est (plus haut + plus bas)
// sur sa fenêtre, divisé par deux : la médiane du RANGE, pas celle des
// clôtures. Une ligne plate ne dit donc pas « pas de tendance » mais « aucun
// nouvel extrême » — ce n'est pas la même information.
//
// LE DÉCALAGE, EN BOUGIES ET NON EN TEMPS. Les deux Senkou dépassent la
// dernière bougie chargée : leurs horodatages n'existent pas encore. On les
// fabrique en prolongeant le pas de temps le plus fréquent des bougies
// récentes (`barStep`), ce qui suffit au graphe pour ouvrir la place à droite.
// Sur un marché à trous (week-ends, séances), les horodatages projetés sont
// donc réguliers là où le marché ne le sera pas — le décalage reste juste en
// nombre de bougies, qui est la seule unité qui compte pour l'indicateur.
//
// Convention MT5 : le décalage est appliqué tel quel (26 bougies), pas
// « displacement − 1 » comme dans l'Ichimoku intégré de TradingView.

export const ICHIMOKU_DEFAULTS = {
  tenkanLen:    9,
  kijunLen:     26,
  senkouLen:    52,
  displacement: 26,
};

// Pas de temps entre deux bougies : le plus FRÉQUENT des écarts récents, et non
// le dernier ni la moyenne — un seul trou de week-end fausserait les deux.
function barStep(candles) {
  const n = candles.length;
  if (n < 2) return 60;
  const counts = new Map();
  for (let i = Math.max(1, n - 300); i < n; i++) {
    const d = candles[i].time - candles[i - 1].time;
    if (d > 0) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  let best = candles[n - 1].time - candles[n - 2].time || 60;
  let bestN = 0;
  for (const [d, k] of counts) if (k > bestN) { best = d; bestN = k; }
  return best;
}

// Milieu du canal de Donchian sur une fenêtre glissante.
// Deux files monotones : chaque bougie entre et sort une fois, donc O(n) même
// avec une fenêtre de 52 — la fonction est rappelée à chaque bougie du replay.
function midChannel(candles, period) {
  const n   = candles.length;
  const out = new Array(n).fill(null);
  const qH  = [];   // indices, hauts décroissants
  const qL  = [];   // indices, bas croissants
  let iH = 0, iL = 0;

  for (let i = 0; i < n; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    while (qH.length > iH && candles[qH[qH.length - 1]].high <= h) qH.pop();
    qH.push(i);
    while (qL.length > iL && candles[qL[qL.length - 1]].low  >= l) qL.pop();
    qL.push(i);

    const from = i - period + 1;
    while (qH[iH] < from) iH++;
    while (qL[iL] < from) iL++;

    if (i >= period - 1) out[i] = (candles[qH[iH]].high + candles[qL[iL]].low) / 2;
  }
  return out;
}

// ── Point d'entrée ────────────────────────────────────────────────────────────
//
// Rend les cinq séries prêtes pour setData(), la liste des paires (a, b) du
// nuage pour la primitive, et une table time → valeurs pour l'infobulle.
export function calcIchimoku(candles, params = {}) {
  const vide = { tenkan: [], kijun: [], spanA: [], spanB: [], chikou: [], cloud: [], points: new Map() };

  const tLen = Math.max(1, params.tenkanLen    ?? ICHIMOKU_DEFAULTS.tenkanLen);
  const kLen = Math.max(1, params.kijunLen     ?? ICHIMOKU_DEFAULTS.kijunLen);
  const sLen = Math.max(1, params.senkouLen    ?? ICHIMOKU_DEFAULTS.senkouLen);
  const disp = Math.max(0, params.displacement ?? ICHIMOKU_DEFAULTS.displacement);

  const n = candles?.length ?? 0;
  // Sans la fenêtre la plus longue, aucune des cinq lignes n'a de sens à
  // afficher : le nuage n'existerait que sur les dernières bougies.
  if (!n || n < Math.max(tLen, kLen, sLen)) return vide;

  const step     = barStep(candles);
  const lastTime = candles[n - 1].time;
  // Horodatage de la bougie i, RÉELLE ou projetée à droite du dernier chargé.
  const timeAt = (i) => (i < n ? candles[i].time : lastTime + (i - (n - 1)) * step);

  const tenkanRaw = midChannel(candles, tLen);
  const kijunRaw  = midChannel(candles, kLen);
  const spanBRaw  = midChannel(candles, sLen);

  const tenkan = [], kijun = [], spanA = [], spanB = [], chikou = [], cloud = [];
  const points = new Map();

  const noteAt = (time, key, value) => {
    let e = points.get(time);
    if (!e) { e = {}; points.set(time, e); }
    e[key] = value;
  };

  for (let i = 0; i < n; i++) {
    const time = candles[i].time;

    if (tenkanRaw[i] != null) {
      tenkan.push({ time, value: tenkanRaw[i] });
      noteAt(time, 'tenkan', tenkanRaw[i]);
    }
    if (kijunRaw[i] != null) {
      kijun.push({ time, value: kijunRaw[i] });
      noteAt(time, 'kijun', kijunRaw[i]);
    }

    // Les deux Senkou : calculées ici, POSÉES `disp` bougies plus loin.
    const tf = timeAt(i + disp);
    const a  = tenkanRaw[i] != null && kijunRaw[i] != null ? (tenkanRaw[i] + kijunRaw[i]) / 2 : null;
    const b  = spanBRaw[i];
    if (a != null) { spanA.push({ time: tf, value: a }); noteAt(tf, 'spanA', a); }
    if (b != null) { spanB.push({ time: tf, value: b }); noteAt(tf, 'spanB', b); }
    // Le nuage n'existe que là où les DEUX bords existent.
    if (a != null && b != null) cloud.push({ time: tf, a, b });

    // Chikou : la clôture ramenée en arrière. Les `disp` premières bougies
    // tomberaient avant l'historique chargé — on ne fabrique pas de temps à
    // gauche, ce serait inventer des bougies que le graphe n'a pas.
    const j = i - disp;
    if (j >= 0) {
      const tb = candles[j].time;
      chikou.push({ time: tb, value: candles[i].close });
      noteAt(tb, 'chikou', candles[i].close);
    }
  }

  return { tenkan, kijun, spanA, spanB, chikou, cloud, points };
}
