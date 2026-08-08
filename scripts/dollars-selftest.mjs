#!/usr/bin/env node
// AUTO-CONTRÔLE DU MOTIF $$$ — détection, entrée, sorties, lot.
//
//   npm run dollars-test
//
// Pourquoi un test plutôt qu'une relecture : ce motif accumule des règles qui se
// croisent (deux BE sur le même niveau, un TP qui se repousse, un trade unique
// qui dépend de la santé, un lot qui multiplie les résultats). Chacune est
// simple ; ensemble elles ont des priorités qu'on ne vérifie pas à l'œil. Ce
// fichier fige ces priorités : le jour où l'une d'elles bouge, ça se voit.
//
// Tout est en bougies FABRIQUÉES, à la main, pour que chaque assertion porte sur
// un cas nommé et non sur ce que le marché a bien voulu produire.

import { calcDollars, calcDollarPivots, detectDollarPairs } from '../lib/dollars/detect.js';
import { calcDollarsPositions } from '../lib/dollars/positions.js';
import { computeStats } from '../lib/signals/stats.js';

let fails = 0, total = 0;
const ok = (cond, name, extra = '') => {
  total++;
  if (cond) console.log(`  ✓ ${name}`);
  else { fails++; console.log(`  ✗ ${name} ${extra}`); }
};
const near = (a, b, eps = 1e-6) => a != null && Math.abs(a - b) < eps;
const C = rows => rows.map((r, i) => ({ time: 1700000000 + i * 60, open: r[0], high: r[1], low: r[2], close: r[3] }));

// ── La figure de référence ───────────────────────────────────────────────────
// POINTE BASSE (baissier puis haussier) → on ACHÈTE. Centrales en 2 et 4, bougie
// partagée en 3. Pivot 103, bord libre de la 2e boîte 108 = le niveau d'entrée
// ET le niveau de santé.
const BASE = [
  [110, 112, 108, 110],   // 0
  [110, 112, 106, 110],   // 1  low 106
  [109, 110,  99, 100],   // 2  centrale baissière → boîte [103, 106]
  [100, 103,  97,  98],   // 3  PARTAGÉE — high 103 = le pivot
  [ 98, 112,  97, 111],   // 4  centrale haussière → boîte [103, 108]
  [111, 115, 108, 112],   // 5  low 108 = bord libre
];
const SL5 = { slPts: 5, tpPts: 40 };   // SL 103, TP 148

console.log('\n── DÉTECTION ──────────────────────────────────────────────────');
{
  const candles = C([...BASE, [112, 114, 110, 113]]);
  const [p] = detectDollarPairs(candles, {});
  ok(p != null, 'la figure est trouvée');
  ok(p.side === 'bear' && p.second.side === 'bull', 'pointe basse : commence baissière, finit haussière');
  ok(p.pivotPrice === 103, 'pivot = extrémité de la bougie partagée', String(p.pivotPrice));
  ok(p.first.bottom === 103 && p.second.bottom === 103,
     'LES DEUX BOÎTES PARTAGENT LE PIVOT — c’est la géométrie du motif');
  ok(p.readyIdx === 5, 'la figure n’est connue qu’à sa 5e bougie', String(p.readyIdx));

  ok(calcDollars(candles, { direction: 'bear' }).length === 2, 'direction bear garde la pointe basse');
  ok(calcDollars(candles, { direction: 'bull' }).length === 0, 'direction bull l’écarte');

  // Le vide est exigé FRANC, et ce n'est pas réglable.
  const colle = C([...BASE.slice(0, 3), [100, 106, 97, 98], ...BASE.slice(4), [112, 114, 110, 113]]);
  ok(calcDollars(colle, {}).length === 0, 'chevauchement des bornes = pas de motif');

  // Similitude : recouvrement des deux boîtes (3 et 5 de haut → 60 %).
  ok(near(p.similarity, 60), 'similitude = min/max des hauteurs', String(p.similarity));
  ok(calcDollars(candles, { similarity: 61 }).length === 0, 'un seuil au-dessus écarte la paire');
  ok(calcDollars(candles, { similarity: 60 }).length === 2, 'un seuil atteint la garde');
}

console.log('\n── AFFICHAGE SIMPLIFIÉ (le trait) ─────────────────────────────');
{
  const candles = C([...BASE, [112, 114, 110, 113]]);
  const boites = calcDollars(candles, {});
  const traits = calcDollarPivots(candles, { pivotWidth: 4 });

  ok(boites.length === 2 && traits.length === 1, 'deux boîtes, mais UN seul trait par paire',
     `${boites.length}/${traits.length}`);
  const [t] = traits;
  ok(t.top === t.bottom, 'le trait est une zone PLATE — c’est ce qui le fait dessiner en segment');
  ok(t.top === 103, 'posé sur le pivot', String(t.top));
  ok(boites.every(z => z.top === t.top || z.bottom === t.top),
     'et le pivot est bien une arête des DEUX boîtes');
  // Pointe basse → le second motif est haussier → le trait porte le sens du TRADE.
  ok(t.side === 'bull' && t.pairSide === 'bear',
     'le trait prend le sens JOUÉ, pas celui de la paire', `${t.side}/${t.pairSide}`);
  ok(t.thickness === 4, 'l’épaisseur suit le réglage', String(t.thickness));
  ok(t.startTime === candles[3].time, 'il part de la bougie PARTAGÉE — le pivot n’existe pas avant elle');
  ok(t.endTime === boites.find(z => z.idx === 4)?.endTime,
     'et s’arrête au même endroit que la seconde boîte : les deux vues se superposent');

  // Le dessin ne touche pas la détection : mêmes figures des deux côtés.
  ok(calcDollarPivots(candles, { direction: 'bull' }).length === 0,
     'les filtres de détection s’appliquent à l’identique');

  // MODE EXTRÊME — l'autre bout de la MÊME bougie partagée.
  const [e] = calcDollarPivots(candles, { zoneStyle: 'extreme' });
  const partagee = candles[3];
  ok(e.top === e.bottom && e.top === 97, 'pointe BASSE → le trait descend au plus BAS de la partagée',
     String(e.top));
  ok(e.idx === t.idx, 'c’est la même bougie que le pivot', `${e.idx}/${t.idx}`);
  ok(e.top === partagee.low && t.top === partagee.high,
     'les deux traits encadrent la bougie partagée, un de chaque côté');
  ok(e.side === t.side, 'même couleur : c’est toujours le sens du trade');
  ok(e.pivotPrice === t.top && e.extremePrice === e.top,
     'la zone porte les DEUX niveaux, quel que soit celui qu’elle trace');

  // Miroir : une pointe HAUTE doit monter au plus HAUT de sa bougie partagée.
  const haute = C([
    [100, 102,  98, 100],
    [100, 102,  98, 100],   // 1  high 102
    [100, 112,  99, 111],   // 2  centrale haussière
    [111, 116, 108, 112],   // 3  PARTAGÉE — low 108 = pivot, high 116 = extrême
    [112, 113,  99, 100],   // 4  centrale baissière
    [100, 104,  98,  99],   // 5
    [ 99, 101,  97,  98],   // 6
  ]);
  const [ph] = calcDollarPivots(haute, {});
  const [eh] = calcDollarPivots(haute, { zoneStyle: 'extreme' });
  ok(ph.pairSide === 'bull', 'pointe haute');
  ok(ph.top === 108, 'son pivot est le plus BAS de la partagée', String(ph.top));
  ok(eh.top === 116, 'son extrême est le plus HAUT de la partagée', String(eh.top));
  ok(eh.side === 'bear', 'et le trait reste au sens du trade — une vente', eh.side);
}

console.log('\n── RSI AVANT L’IMPULSION ──────────────────────────────────────');
{
  // Il faut de l'histoire pour que le RSI 7 soit chaud. On fabrique une longue
  // montée régulière, puis la figure de référence : la dernière bougie
  // BAISSIÈRE avant l'impulsion haussière est alors en zone très basse.
  const montee = [];
  let px = 100;
  for (let i = 0; i < 40; i++) { const o = px, c = px + 1; montee.push([o, c + 0.5, o - 0.5, c]); px = c; }

  // Figure POINTE BASSE greffée après : le second motif est HAUSSIER, on
  // cherche donc la dernière bougie BAISSIÈRE avant lui, et on la veut en
  // SURVENTE. Après 40 bougies de hausse, le RSI est au plafond → recalée.
  const suite = px0 => [
    [px0,      px0 + 2,  px0 - 2,  px0],
    [px0,      px0 + 2,  px0 - 4,  px0],
    [px0 - 1,  px0,      px0 - 11, px0 - 10],
    [px0 - 10, px0 - 7,  px0 - 13, px0 - 12],
    [px0 - 12, px0 + 2,  px0 - 13, px0 + 1],
    [px0 + 1,  px0 + 5,  px0 - 2,  px0 + 2],
    [px0 + 2,  px0 + 4,  px0,      px0 + 3],
  ];
  const apresHausse = C([...montee, ...suite(px)]);

  const sansFiltre = detectDollarPairs(apresHausse, {});
  ok(sansFiltre.length === 1, 'la figure existe sans le filtre', String(sansFiltre.length));
  ok(detectDollarPairs(apresHausse, { rsiPeriod: 7, rsiOversold: 20, rsiOverbought: 80 }).length === 0,
     'après une longue HAUSSE, la dernière baissière n’est pas en survente → écartée');
  // Un seuil grand ouvert la laisse passer : c'est bien le SEUIL qui décide.
  const large = detectDollarPairs(apresHausse, { rsiPeriod: 7, rsiOversold: 100, rsiOverbought: 0 });
  ok(large.length === 1, 'seuil grand ouvert → la même figure repasse');
  ok(large[0].rsiIdx != null && large[0].rsiValue != null,
     'la paire porte la bougie jugée et sa valeur de RSI',
     `${large[0].rsiIdx}/${large[0].rsiValue?.toFixed(1)}`);
  ok(apresHausse[large[0].rsiIdx].close < apresHausse[large[0].rsiIdx].open,
     'et c’est bien une bougie BAISSIÈRE qui a été jugée');
  ok(large[0].rsiIdx < large[0].second.i,
     'située AVANT l’impulsion du second motif',
     `${large[0].rsiIdx} < ${large[0].second.i}`);
  ok(large[0].rsiIdx >= large[0].first.i,
     'et jamais plus loin que la centrale du premier motif — la recherche est bornée par construction');

  // Miroir : après une longue BAISSE, la dernière baissière EST en survente.
  const baisse = [];
  let qx = 200;
  for (let i = 0; i < 40; i++) { const o = qx, c = qx - 1; baisse.push([o, o + 0.5, c - 0.5, c]); qx = c; }
  const apresBaisse = C([...baisse, ...suite(qx)]);
  ok(detectDollarPairs(apresBaisse, {}).length === 1, 'la figure existe aussi là');
  const passe = detectDollarPairs(apresBaisse, { rsiPeriod: 7, rsiOversold: 20, rsiOverbought: 80 });
  ok(passe.length === 1, 'après une longue BAISSE, elle est en survente → gardée');
  ok(passe[0].rsiValue <= 20, 'et sa valeur est bien sous le seuil', passe[0].rsiValue?.toFixed(1));

  ok(detectDollarPairs(apresBaisse, { rsiPeriod: 0 }).length === 1, 'période 0 = filtre éteint');
}

console.log('\n── ENTRÉE ─────────────────────────────────────────────────────');
{
  const candles = C([...BASE,
    [112, 114, 110, 113],   // 6  ordre armé
    [113, 116, 112, 115],   // 7
    [115, 116, 107, 108],   // 8  descend toucher 108
    [108, 130, 107, 129],   // 9
  ]);
  const [t] = calcDollarsPositions(candles, { ...SL5, tpPts: 10 });
  ok(t.direction === 'BUY', 'le SENS est celui du SECOND motif', t.direction);
  ok(near(t.level, 108) && near(t.entryPrice, 108), 'ordre limité sur le bord libre, rempli au niveau');
  ok(t.waitedBars === 2, 'il a attendu 2 bougies', String(t.waitedBars));

  // Marge SIGNÉE : positive = pré-entrée.
  const [tot] = calcDollarsPositions(candles, { ...SL5, tpPts: 10, entryMarginPts: 3 });
  ok(near(tot.level, 111) && tot.waitedBars === 0, 'marge +3 : servi plus tôt, plus haut');
  const [loin] = calcDollarsPositions(candles, { ...SL5, tpPts: 10, entryMarginPts: -2 });
  ok(loin.status === 'missed', 'marge −2 : le prix n’y descend jamais → ordre non servi');

  // Niveau déjà dépassé → entrée au marché, à l'ouverture.
  const court = C([...BASE, [112, 114, 110, 113], [113, 130, 112, 129]]);
  const [m] = calcDollarsPositions(court, { ...SL5, tpPts: 40, entryMarginPts: 20 });
  ok(near(m.level, 128) && m.waitedBars === 0 && near(m.entryPrice, 112),
     'niveau au-dessus du marché → ouvert sur-le-champ, à l’OUVERTURE');

  // ── ENTRÉE SUR LE TRAIT EXTRÊME ───────────────────────────────────────────
  // Le prix doit redescendre de l'autre côté de toute la figure : 97, le plus
  // bas de la bougie partagée, contre 108 pour le bord.
  const profond = C([...BASE,
    [112, 114, 110, 113],   // 6  ordre armé
    [113, 116, 112, 115],   // 7
    [115, 116, 107, 108],   // 8  touche 108 — assez pour le BORD, pas pour l'extrême
    [104, 105,  96,  99],   // 9  descend à 96 → atteint 97, sans filer au TP
    [ 99, 130,  98, 129],   // 10
  ]);
  const [b] = calcDollarsPositions(profond, { ...SL5, tpPts: 10, entryLevel: 'bord' });
  const [x] = calcDollarsPositions(profond, { ...SL5, tpPts: 10, entryLevel: 'extreme' });
  ok(near(b.level, 108), 'bord : ordre à 108', String(b.level));
  ok(near(x.level, 97), 'extrême : ordre à 97, le plus bas de la bougie PARTAGÉE', String(x.level));
  ok(x.entryTime === profond[9].time && b.entryTime === profond[8].time,
     'l’extrême est donc servi PLUS TARD, quand il l’est');
  ok(x.waitedBars > b.waitedBars, 'et après une attente plus longue', `${x.waitedBars} > ${b.waitedBars}`);
  ok(near(x.entryEdge, 97), 'la position porte le niveau retenu', String(x.entryEdge));

  // LE NIVEAU DE SANTÉ SUIT L'ENTRÉE — sans quoi la position naîtrait malsaine.
  ok(x.stayedHealthy === true,
     'entrée à l’extrême : la position est SAINE au départ, pas condamnée d’office');
  ok(x.healthyBars === x.barsHeld,
     'restée saine jusqu’au bout → elle l’a été toute sa vie', `${x.healthyBars}/${x.barsHeld}`);

  // Un ordre placé à l'extrême est souvent jamais servi : c'est le prix à payer.
  const jamais = C([...BASE, [112, 114, 110, 113], [113, 116, 112, 115], [115, 116, 107, 108]]);
  ok(calcDollarsPositions(jamais, { ...SL5, tpPts: 10, entryLevel: 'extreme' })[0].status === 'missed',
     'le prix n’y revient pas toujours → « missed » y est bien plus fréquent');
  ok(calcDollarsPositions(jamais, { ...SL5, tpPts: 10, entryLevel: 'bord' })[0].status !== 'missed',
     '… alors que le bord, lui, avait été servi');

  // ── L'ORDRE DES OUVERTURES ────────────────────────────────────────────────
  // Les motifs se terminent dans un ordre, les ordres sont servis dans un autre :
  // un ordre lointain peut attendre des centaines de bougies pendant que le
  // suivant part tout de suite. Les règles séquentielles (trade unique, repos,
  // dû, numéro de lot) doivent être nourries dans l'ordre des OUVERTURES —
  // sinon une position se voit bloquée par une autre ouverte PLUS TARD.
  let s0 = 3;
  const rnd0 = () => (s0 = (s0 * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const bruit0 = []; let q = 500;
  for (let i = 0; i < 6000; i++) {
    const o = q, c = +(q + (rnd0() - 0.5) * 12).toFixed(2);
    bruit0.push({ time: 1700000000 + i * 60, open: o, close: c,
      high: +(Math.max(o, c) + rnd0() * 4).toFixed(2),
      low:  +(Math.min(o, c) - rnd0() * 4).toFixed(2) });
    q = c;
  }
  for (const niveau of ['bord', 'extreme']) {
    const t = calcDollarsPositions(bruit0, { slPts: 40, tpPts: 180, entryLevel: niveau })
      .filter(x => x.status !== 'missed');
    ok(t.every((x, i) => i === 0 || t[i - 1].entryTime <= x.entryTime),
       `entryLevel '${niveau}' : les positions sont jouées dans l’ordre des OUVERTURES`);
    ok(t.every((x, i) => x.tradeNo === i + 1),
       `… et le lot les numérote dans ce même ordre`);
  }
}

console.log('\n── TP DYNAMIQUE ───────────────────────────────────────────────');
{
  const candles = C([...BASE,
    [108, 109, 107, 108],   // 6  entrée 108
    [108, 119, 107, 118],   // 7  TP de base (118) atteint en 1 bougie
    [118, 129, 117, 128],   // 8
    [128, 130, 127, 129],   // 9
  ]);
  const [sans] = calcDollarsPositions(candles, { slPts: 5, tpPts: 10 });
  ok(sans.status === 'tp' && near(sans.exitPrice, 118), 'sans la règle : sortie au TP de base');

  const [vite] = calcDollarsPositions(candles, { slPts: 5, tpPts: 10, tpFastBars: 3, tpFastMult: 2 });
  ok(vite.tpBoosted && vite.tpBoostReason === 'fast', 'atteint vite → cible repoussée');
  ok(near(vite.tp, 128), 'repoussée depuis la distance de DÉPART (108 + 2×10)', String(vite.tp));
  ok(near(vite.tpBaseDistPts, 10) && near(vite.tpDistPts, 20), 'les deux distances restent lisibles');

  // Une seule extension, et jamais sur la bougie qui l'arme.
  const gros = C([...BASE, [108, 109, 107, 108], [108, 140, 107, 139], [139, 141, 138, 140]]);
  const [g] = calcDollarsPositions(gros, { slPts: 5, tpPts: 10, tpFastBars: 5, tpFastMult: 2 });
  ok(g.exitTime === gros[8].time, 'la nouvelle cible n’est pas touchable sur la bougie qui l’arme');

  // LE STOP NE BOUGE PAS : un gain acquis peut redevenir une perte.
  const retour = C([...BASE, [108, 109, 107, 108], [108, 119, 107, 118], [118, 119, 102, 103]]);
  const r = calcDollarsPositions(retour, { slPts: 5, tpPts: 10, tpFastBars: 5, tpFastMult: 2 });
  ok(r[0].status === 'sl' && near(r[0].profitPoints, -5), 'cible repoussée puis stoppée : +10 devenu −5');
  ok(r.tpBoosted === 1 && r.tpBoostedLost === 1 && near(r.tpBoostedNet, -15),
     'le rapport compte l’extension, sa perte, et ce qu’elle a coûté');
}

console.log('\n── BE DU MALSAIN ──────────────────────────────────────────────');
{
  const candles = C([...BASE,
    [108, 110, 107, 106],   // 6  entrée 108, CLÔTURE 106 sous le bord → malsaine
    [106, 109, 105, 108],   // 7
    [108, 111, 107, 110],   // 8  revient à 110
    [110, 150, 109, 149],   // 9
  ]);
  const [t] = calcDollarsPositions(candles, { ...SL5, beUnhealthyPts: 2 });
  ok(t.status === 'be' && t.beReason === 'unhealthy', 'soldée par le BE du malsain');
  ok(near(t.exitPrice, 110) && near(t.profitPoints, 2), 'à entrée + 2 : un petit GAIN, pas un zéro');

  // Une MÈCHE sous le bord ne rompt rien : c'est la CLÔTURE qui juge.
  const meche = C([...BASE, [108, 110, 104, 109], [109, 119, 108, 118], [118, 129, 117, 128]]);
  ok(calcDollarsPositions(meche, { ...SL5, tpPts: 10, beUnhealthyPts: 2 })[0].status === 'tp',
     'une mèche sous le bord ne rend pas la position malsaine');

  // Le stop reste actif pendant l'attente : rien n'est garanti.
  const perdu = C([...BASE, [108, 110, 107, 106], [106, 107, 102, 103], [103, 115, 102, 114]]);
  const p = calcDollarsPositions(perdu, { ...SL5, beUnhealthyPts: 2 });
  ok(p[0].status === 'sl', 'le stop peut gagner la course');
  ok(p.beUnhealthyArmed === 1 && p.beUnhealthySaved === 0 && p.beUnhealthyLost === 1,
     'les occasions sont comptées, pas seulement les sauvetages');
}

console.log('\n── BE EXISTENTIEL ─────────────────────────────────────────────');
{
  const EX = n => ({ ...SL5, beUnhealthyPts: 2, beExistBars: n });   // niveau 110

  // CÔTÉ PROTECTION : au-delà du niveau, on ne redescend plus dessous.
  const haut = C([...BASE,
    [108, 113, 107, 112],   // 6  entrée 108, clôture 112 > 110
    [112, 114, 111, 113],   // 7
    [113, 114, 109, 110],   // 8  redescend traverser 110
    [110, 150, 109, 149],   // 9
  ]);
  ok(calcDollarsPositions(haut, { ...SL5 })[0].status === 'tp', 'sans la règle : va au TP');
  const [h] = calcDollarsPositions(haut, EX(2));
  ok(h.status === 'be' && h.beReason === 'existential', 'protégée par l’existentiel');
  ok(near(h.exitPrice, 110) && near(h.profitPoints, 2), 'soldée AU niveau, pas plus bas');

  // Mais le TP reste jouable tant qu'on reste au-dessus.
  const tenu = C([...BASE, [108, 113, 107, 112], [112, 114, 111, 113], [113, 116, 111, 115], [115, 150, 114, 149]]);
  ok(calcDollarsPositions(tenu, EX(2))[0].status === 'tp', 'restée au-dessus : le TP reste atteignable');

  // La protection passe AVANT le stop — c'est de la géométrie, pas un arbitrage.
  const krach = C([...BASE, [108, 113, 107, 112], [112, 114, 111, 113], [113, 114, 102, 103]]);
  ok(calcDollarsPositions(krach, EX(2))[0].status === 'be', 'le niveau est croisé avant le stop');
  ok(calcDollarsPositions(krach, { ...SL5 })[0].status === 'sl', 'sans la règle, la même bougie donne un SL');

  // Un gap SOUS le niveau se remplit au pire : un BE n'est pas une garantie.
  const gap = C([...BASE, [108, 113, 107, 112], [112, 114, 111, 113], [106, 107, 105, 106]]);
  const [gp] = calcDollarsPositions(gap, EX(2));
  ok(near(gp.exitPrice, 106) && near(gp.profitPoints, -2), 'gap sous le niveau : rempli à l’ouverture, en PERTE');

  // CÔTÉ CIBLE : en deçà, on coupe dès qu'on y arrive.
  const bas = C([...BASE, [108, 109, 107, 109], [109, 110, 108, 109], [109, 111, 108, 110], [110, 150, 109, 149]]);
  const [b] = calcDollarsPositions(bas, EX(2));
  ok(b.status === 'be' && b.beReason === 'existential' && near(b.exitPrice, 110), 'coupée au niveau');

  // Sans niveau réglé, la règle ne peut rien.
  ok(calcDollarsPositions(haut, { ...SL5, beExistBars: 2 })[0].status === 'tp',
     'pas de distance de BE → aucun niveau, aucune sortie');
}

console.log('\n── TRADE UNIQUE « position saine » ────────────────────────────');
{
  // Figure A (achat, bord 108) puis figure B, une POINTE HAUTE entièrement
  // au-dessus : A reste jouable pendant que B se forme.
  const build = clot6 => C([
    ...BASE,
    [108, 110, 107, clot6],  // 6  entrée A ; sa CLÔTURE décide de la santé
    [109, 111, 107, 110],    // 7
    [110, 112, 109, 110],    // 8  1re bougie de B
    [110, 125, 109, 124],    // 9  centrale haussière
    [124, 130, 118, 125],    // 10 partagée
    [125, 126, 112, 113],    // 11 centrale baissière
    [113, 116, 111, 112],    // 12 bord B = 116
    [112, 114, 110, 112],    // 13
    [112, 117, 111, 116],    // 14 entrée B
    [116, 118, 114, 117],    // 15
  ]);
  const U = { slPts: 5, tpPts: 40, uniqueTrade: true };
  ok(calcDollarsPositions(build(109), { slPts: 5, tpPts: 40 }).length === 2, 'sans trade unique : deux positions');

  const saine = calcDollarsPositions(build(109), U);
  ok(saine.length === 1 && saine.skippedByUnique === 1, 'A SAINE → B est ignorée');
  ok(saine[0].stayedHealthy === true, 'et A est bien restée saine');

  const malsaine = calcDollarsPositions(build(106), U);
  ok(malsaine.length === 2 && malsaine.skippedByUnique === 0, 'A MALSAINE → la porte se rouvre');
  ok(malsaine[0].healthyBars === 0, 'elle a cessé d’être saine dès sa bougie d’entrée');

  // La santé du trade unique ne regarde AUCUNE moyenne mobile.
  const avecMa = calcDollarsPositions(build(109), { ...U, tpSaneMaPeriod: 7, tpSaneMult: 2 });
  ok(avecMa.skippedByUnique === saine.skippedByUnique, 'régler la MM ne change rien au blocage');
}

console.log('\n── LOT ────────────────────────────────────────────────────────');
{
  // Une série longue : il faut des dizaines de trades pour voir les marches.
  let s = 7;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const bruit = []; let px = 1000;
  for (let i = 0; i < 4000; i++) {
    const open = px, close = +(px + (rnd() - 0.5) * 12).toFixed(2);
    bruit.push({ time: 1700000000 + i * 60, open, close,
      high: +(Math.max(open, close) + rnd() * 4).toFixed(2),
      low:  +(Math.min(open, close) - rnd() * 4).toFixed(2) });
    px = close;
  }
  const P = { slPts: 10, tpPts: 20 };
  const EXPO = { ...P, lotMode: 'exponentiel', lotStepTrades: 10, lotFactor: 2 };

  const fixe = calcDollarsPositions(bruit, P).filter(p => p.status !== 'missed');
  const expo = calcDollarsPositions(bruit, EXPO).filter(p => p.status !== 'missed');

  ok(fixe.every(p => p.lot === 1), 'lot classique : 1 partout');
  ok(expo[0].lot === 1 && expo[9].lot === 1 && expo[10].lot === 2 && expo[19].lot === 2 && expo[20].lot === 4,
     'exponentiel : 1 lot sur 10 trades, puis 2, puis 4');

  // PAS À PAS — le pendant linéaire : +1 par marche au lieu de ×2.
  const PAS = { ...P, lotMode: 'pas', lotStepTrades: 10, lotPlus: 1 };
  const pas = calcDollarsPositions(bruit, PAS).filter(p => p.status !== 'missed');
  ok(pas[0].lot === 1 && pas[9].lot === 1 && pas[10].lot === 2 && pas[19].lot === 2
     && pas[20].lot === 3 && pas[30].lot === 4,
     'pas à pas : 1, puis 2, puis 3, puis 4 — jamais 4 au 21e');
  ok(pas.every((p, i) => near(p.profitPoints, fixe[i].profitPoints * p.lot)),
     'et lui aussi ne fait que multiplier le résultat');
  ok(calcDollarsPositions(bruit, { ...PAS, lotPlus: 0 }).filter(p => p.status !== 'missed')
       .every(p => p.lot === 1),
     'un pas de 0 revient au lot classique');
  ok(calcDollarsPositions(bruit, { ...PAS, lotMax: 2 }).filter(p => p.status !== 'missed')
       .every(p => p.lot <= 2), 'le plafond vaut pour les deux escaliers');
  ok(expo.every((p, i) => p.tradeNo === i + 1), 'la numérotation ne saute jamais');
  ok(calcDollarsPositions(bruit, EXPO).filter(p => p.status === 'missed').every(p => p.lot === null),
     'un ordre jamais servi n’est pas un trade et ne fait pas monter la marche');

  ok(fixe.every((p, i) => near(p.entryPrice, expo[i].entryPrice) && near(p.exitPrice, expo[i].exitPrice)
        && near(p.sl0, expo[i].sl0) && near(p.tp, expo[i].tp) && near(p.risk0, expo[i].risk0)
        && p.status === expo[i].status),
     'LE LOT NE TOUCHE À RIEN : mêmes entrées, mêmes stops, mêmes cibles, mêmes issues');
  ok(expo.every((p, i) => near(p.profitPoints, fixe[i].profitPoints * p.lot)),
     'il multiplie le RÉSULTAT, exactement');
  ok(expo.every(p => near(p.netPoints, p.profitPoints - p.spreadPts)),
     'net = brut − spread reste vrai à tout lot');

  const sp = calcDollarsPositions(bruit, { ...EXPO, spreadPts: 1 })
    .filter(p => p.status !== 'missed' && p.status !== 'open');
  ok(sp.every(p => near(p.spreadPts, p.lot)), 'deux lots paient deux spreads');

  const cap = calcDollarsPositions(bruit, { ...EXPO, lotMax: 4 }).filter(p => p.status !== 'missed');
  ok(cap.every(p => p.lot <= 4), 'le plafond tient');

  // LE PIÈGE, et c'est le résultat le plus important de ce fichier.
  const net = t => t.reduce((a, p) => a + (p.netPoints ?? 0), 0);
  const nFixe = net(calcDollarsPositions(bruit, P));
  const nExpo = net(calcDollarsPositions(bruit, EXPO));
  ok(fixe.every((p, i) => Math.sign(p.netPoints) === Math.sign(expo[i].netPoints)),
     'aucun trade ne change de signe — le lot ne retourne rien, trade par trade');
  ok(Math.sign(nFixe) !== Math.sign(nExpo),
     `MAIS LE TOTAL BASCULE : ${nFixe.toFixed(0)} pts à lot fixe → ${nExpo.toFixed(0)} en escalier`);
  console.log('     → un escalier ne mesure plus la stratégie, il mesure la chance des derniers trades.');

  // LES DEUX ESCALIERS NE SE VALENT PAS. En exponentiel le dernier bloc pèse
  // comme 2^n : le total lui appartient. En pas à pas il pèse comme n, et le
  // total reste une moyenne à peu près honnête. La comparaison chiffrée est le
  // seul argument qui tienne pour choisir entre les deux.
  const nPas = net(calcDollarsPositions(bruit, { ...P, lotMode: 'pas', lotStepTrades: 10, lotPlus: 1 }));
  console.log(`     fixe ${nFixe.toFixed(0)} · pas à pas ${nPas.toFixed(0)} · exponentiel ${nExpo.toFixed(0)}`);
  ok(Math.abs(nPas) < Math.abs(nExpo),
     'le pas à pas déforme BEAUCOUP moins que l’exponentiel',
     `${Math.abs(nPas).toFixed(0)} vs ${Math.abs(nExpo).toFixed(0)}`);

  // ── CE QUE LES STATISTIQUES DOIVENT FAIRE DU LOT ──────────────────────────
  // La frontière : ce qui JUGE la stratégie se lit à 1 lot, ce qui décrit le
  // COMPTE l'inclut. Sans cette séparation, le seuil de rentabilité et les deux
  // études se règlent sur le calendrier des lots au lieu du marché — et l'étude
  // du SL plafonné compare carrément une perte de compte à un plafond de prix.
  const sf = computeStats(calcDollarsPositions(bruit, P), { tpPts: 20 });
  const se = computeStats(calcDollarsPositions(bruit, EXPO), { tpPts: 20 });
  for (const k of ['beThresh', 'expPts', 'profitFactor', 'avgWin', 'avgLoss',
                   'riskMed', 'rrMed', 'winrate', 'avgMfeLosers', 'avgMaeWinners']) {
    ok(near(sf[k] ?? 0, se[k] ?? 0), `« ${k} » juge la STRATÉGIE → identique à tout lot`,
       `${sf[k]} vs ${se[k]}`);
  }
  ok(sf.bestSl?.d === se.bestSl?.d && sf.bestBe?.t === se.bestBe?.t,
     'les deux ÉTUDES aussi : même réglage recommandé à tout lot');
  ok(!near(sf.netPts, se.netPts) && !near(sf.maxDD, se.maxDD),
     '… mais « netPts » et « maxDD » décrivent le COMPTE → eux, ils suivent le lot');
}

console.log(fails ? `\n${fails} ÉCHEC(S) sur ${total}` : `\nTout passe (${total} assertions).`);
process.exit(fails ? 1 : 0);
