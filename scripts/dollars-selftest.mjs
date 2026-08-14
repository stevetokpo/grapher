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

import { calcDollars, calcDollarSecond, calcDollarPivots, calcDollarClouds, detectDollarPairs } from '../lib/dollars/detect.js';
import { calcDollarsPositions } from '../lib/dollars/positions.js';
import { computeStats } from '../lib/signals/stats.js';
import { createCloudPrimitive } from '../components/charts/CloudPrimitive.js';
import { fractalZones } from '../lib/dollars/fractal.js';

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

  // ── LA 3e BOUGIE DU SECOND MOTIF, INVERSÉE ────────────────────────────────
  // La figure de référence est une pointe BASSE : son second motif est haussier,
  // la condition exige donc une 5e bougie BAISSIÈRE. Ici elle est haussière
  // (111 → 112), la paire doit tomber.
  ok(candles[5].close > candles[5].open, 'la 5e bougie de la figure est haussière');
  ok(calcDollars(candles, { reverseThird: true }).length === 0,
     'second motif haussier + 5e bougie haussière → écartée');
  ok(calcDollars(candles, {}).length === 2, '… et sans la condition, elle passe');

  // La même figure dont on retourne la 5e bougie : elle rend du terrain.
  const rendu = C([...BASE.slice(0, 5), [115, 115, 108, 111], [112, 114, 110, 113]]);
  ok(calcDollars(rendu, {}).length === 2, 'la figure existe toujours');
  ok(calcDollars(rendu, { reverseThird: true }).length === 2,
     '5e bougie BAISSIÈRE → la paire est validée');

  // Un doji ne rend rien : il est refusé.
  const doji = C([...BASE.slice(0, 5), [112, 115, 108, 112], [112, 114, 110, 113]]);
  ok(calcDollars(doji, {}).length === 2, 'la figure existe');
  ok(calcDollars(doji, { reverseThird: true }).length === 0, 'un doji hésite → écarté');

  // Miroir : une pointe HAUTE exige une 5e bougie HAUSSIÈRE.
  const hauteOk = C([
    [100, 102,  98, 100], [100, 102,  98, 100], [100, 112,  99, 111],
    [111, 116, 108, 112], [112, 113,  99, 100], [ 99, 104,  98, 103],
    [103, 105, 101, 104],
  ]);
  ok(hauteOk[5].close > hauteOk[5].open, 'sa 5e bougie est haussière');
  ok(calcDollarSecond(hauteOk, { reverseThird: true })[0]?.side === 'bear',
     'pointe haute + 5e bougie haussière → validée');

  // LA CONDITION VAUT PARTOUT : tous les dessins, et les positions.
  ok(calcDollarPivots(candles, { reverseThird: true }).length === 0
     && calcDollarClouds(candles, { reverseThird: true }).length === 0
     && calcDollarSecond(candles, { reverseThird: true }).length === 0,
     'elle s’applique aux quatre autres dessins');
  ok(calcDollarsPositions(candles, { ...SL5, reverseThird: true }).pairsTotal === 0,
     '… et aux positions');
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

  // NUAGE — la bande entre les deux niveaux, soit l'amplitude de la partagée.
  const [nb] = calcDollarClouds(candles, {});
  ok(nb.top === partagee.high && nb.bottom === partagee.low,
     'le nuage couvre exactement l’amplitude de la bougie partagée',
     `${nb.bottom}-${nb.top}`);
  ok(nb.top === t.top && nb.bottom === e.top,
     'ses deux bords sont le pivot et l’extrême');
  ok(nb.hotEdge === 'bottom', 'pointe BASSE → le mur est en BAS, sur l’extrême', nb.hotEdge);
  const [nh] = calcDollarClouds(haute, {});
  ok(nh.hotEdge === 'top', 'pointe HAUTE → le mur passe en HAUT', nh.hotEdge);
  ok(nh.top === 116 && nh.bottom === 108, 'et la bande va du pivot à l’extrême',
     `${nh.bottom}-${nh.top}`);
  ok(nb.side === t.side, 'même couleur que les traits : le sens du trade');
  ok(calcDollarClouds(candles, { direction: 'bull' }).length === 0,
     'la détection s’applique là aussi à l’identique');

  // ── DISTANCE DU TRAIT EXTRÊME À LA MOYENNE ────────────────────────────────
  // Période 3 pour que la moyenne soit chaude sur sept bougies. À la bougie
  // partagée (index 3), SMA(3) = (110 + 100 + 98) / 3 = 102,667.
  const [mb] = calcDollarClouds(candles, { maDistPeriod: 3 });
  ok(near(mb.maDist, 102 + 2 / 3 - 97),
     'pointe BASSE : la mesure est prise sous la moyenne, au départ du trait extrême',
     String(mb.maDist));
  ok(mb.maDist > 0,
     'et elle est POSITIVE — signée dans le sens de la pointe, pas dans celui des prix');
  ok(mb.maPeriod === 3, 'la zone dit sur quelle période elle a été mesurée');

  // Miroir : une pointe HAUTE au-dessus de sa moyenne rend elle aussi du positif.
  const [mh] = calcDollarClouds(haute, { maDistPeriod: 3 });
  ok(near(mh.maDist, 116 - 323 / 3),
     'pointe HAUTE : même convention, même signe', String(mh.maDist));
  ok(mh.maDist > 0, 'les deux sens se lisent donc sans retourner le chiffre de tête');

  // LA PREUVE DE LA CONVENTION : les deux figures sont des miroirs, donc l'écart
  // BRUT de prix (extrême − moyenne) y est de signes opposés — et pourtant les
  // deux mesures sont positives. C'est bien le sens de la POINTE qui décide, pas
  // celui des prix. Un signe négatif voudrait alors dire quelque chose de
  // précis : la pointe n'a pas atteint sa moyenne.
  ok(mb.extremePrice - (102 + 2 / 3) < 0 && mh.extremePrice - 323 / 3 > 0,
     'les écarts BRUTS de prix sont de signes opposés');
  ok(mb.maDist > 0 && mh.maDist > 0,
     '… et les deux mesures sont POSITIVES : le signe suit la pointe');

  ok(calcDollarClouds(candles, { maDistPeriod: 0 })[0].maDist === null, 'période 0 = éteint');
  ok(calcDollarClouds(candles, { maDistPeriod: 200 })[0].maDist === null,
     'moyenne pas encore chaude → rien plutôt qu’un chiffre inventé');

  // Le mode PIVOT ne la calcule pas : le trait qu'il dessine n'est pas l'extrême.
  ok(calcDollarPivots(candles, { maDistPeriod: 3 })[0].maDist == null,
     'mode pivot : pas de mesure, le trait n’est pas celui de la pointe');
  ok(calcDollarPivots(candles, { zoneStyle: 'extreme', maDistPeriod: 3 })[0].maDist > 0,
     'mode extrême : la mesure revient');

  // ── LE FILTRE DE DISTANCE ─────────────────────────────────────────────────
  // L'écart mesuré vaut 5,667 sur cette figure. Le seuil porte sur sa VALEUR
  // ABSOLUE, et un seul des deux peut être actif.
  const d = mb.maDist;
  const F = extra => calcDollarClouds(candles, { maDistPeriod: 3, ...extra });
  ok(F({ maDistMode: 'off', maDistMin: 99 }).length === 1, '« Aucun » : les seuils dorment');
  ok(F({ maDistMode: 'min', maDistMin: d - 1 }).length === 1, 'minimum atteint → gardée');
  ok(F({ maDistMode: 'min', maDistMin: d + 1 }).length === 0, 'minimum non atteint → écartée');
  ok(F({ maDistMode: 'max', maDistMax: d + 1 }).length === 1, 'sous le maximum → gardée');
  ok(F({ maDistMode: 'max', maDistMax: d - 1 }).length === 0, 'au-dessus du maximum → écartée');
  // Choisir « max » désarme le minimum, même si sa valeur reste en base.
  ok(F({ maDistMode: 'max', maDistMax: d + 1, maDistMin: d + 99 }).length === 1,
     'un seul seuil agit : le minimum resté en base ne s’applique pas');

  // Sans mesure possible, une figure ne peut pas passer un seuil.
  ok(calcDollarClouds(candles, { maDistPeriod: 200, maDistMode: 'min', maDistMin: 1 }).length === 0,
     'moyenne pas chaude + seuil actif → écartée, on n’invente pas');
  ok(calcDollarClouds(candles, { maDistPeriod: 200 }).length === 1,
     '… mais sans seuil, la figure reste dessinée sans mesure');

  // LE FILTRE VAUT AUSSI POUR LES POSITIONS : c'est une condition du motif.
  const avec = calcDollarsPositions(candles, { ...SL5, maDistPeriod: 3 });
  const sans = calcDollarsPositions(candles, {
    ...SL5, maDistPeriod: 3, maDistMode: 'min', maDistMin: d + 1,
  });
  ok(avec.pairsTotal === 1 && sans.pairsTotal === 0,
     'le seuil retire la figure des POSITIONS, pas seulement du dessin',
     `${avec.pairsTotal}/${sans.pairsTotal}`);

  // Et il s'applique quel que soit le dessin, même celui qui ne l'affiche pas.
  ok(calcDollars(candles, { maDistPeriod: 3, maDistMode: 'min', maDistMin: d + 1 }).length === 0,
     'les boîtes aussi, alors qu’elles n’affichent pas la mesure');
}

console.log('\n── LA SECONDE BOÎTE, SEULE ────────────────────────────────────');
{
  const candles = C([...BASE, [112, 114, 110, 113]]);
  const deux = calcDollars(candles, {});
  const [une] = calcDollarSecond(candles, {});

  ok(deux.length === 2 && calcDollarSecond(candles, {}).length === 1,
     'deux boîtes d’un côté, une seule de l’autre');
  const seconde = deux.find(z => z.role === 'second');
  ok(une.idx === seconde.idx && une.top === seconde.top && une.bottom === seconde.bottom,
     'c’est exactement la boîte du SECOND motif', `${une.bottom}-${une.top}`);
  // Pointe basse → le second motif est haussier : c'est la zone HAUSSIÈRE qu'on garde.
  ok(une.pairSide === 'bear' && une.side === 'bull',
     'paire baissière→haussière : on garde la zone HAUSSIÈRE', `${une.pairSide}/${une.side}`);
  ok(une.entryPrice === seconde.entryPrice && une.pivotPrice === seconde.pivotPrice,
     'elle porte les mêmes repères que dans la vue à deux boîtes');

  // Miroir.
  const haute = C([
    [100, 102,  98, 100], [100, 102,  98, 100], [100, 112,  99, 111],
    [111, 116, 108, 112], [112, 113,  99, 100], [100, 104,  98,  99],
    [ 99, 101,  97,  98],
  ]);
  const [uh] = calcDollarSecond(haute, {});
  ok(uh.pairSide === 'bull' && uh.side === 'bear',
     'paire haussière→baissière : on garde la zone BAISSIÈRE', `${uh.pairSide}/${uh.side}`);

  // Dans une CHAÎNE, un motif ne peut être le second que d'une paire : pas de
  // doublon à craindre, et le premier motif de la chaîne disparaît.
  const chaine = C([
    [100, 101,  99,   100], [100, 101,  99,   100], [100, 110,  99.5, 109],
    [109, 112, 108,   110], [110, 111, 100,   101], [101, 103,  99,   100],
    [100, 112,  99.5, 111], [111, 115, 110,   112], [112, 113, 111,   112],
  ]);
  const sec = calcDollarSecond(chaine, {});
  ok(detectDollarPairs(chaine, {}).length === 2, 'la chaîne fait deux paires');
  ok(sec.length === 2, 'donc deux secondes boîtes', String(sec.length));
  ok(new Set(sec.map(z => z.idx)).size === 2, 'et aucune n’est comptée deux fois');
  ok(calcDollars(chaine, {}).length === 3, '… là où la vue complète en montre trois');

  ok(calcDollarSecond(candles, { direction: 'bull' }).length === 0,
     'les filtres de détection s’appliquent à l’identique');
}

console.log('\n── MODE FRACTAL ───────────────────────────────────────────────');
{
  // On fabrique la figure de référence EN M15, puis on la découpe en bougies M1 :
  // le fractal doit y retrouver exactement la même chose.
  const M15 = 900, M1 = 60;
  const t0 = Math.floor(1700000000 / M15) * M15;
  const gros = [...BASE, [112, 114, 110, 113]];     // 7 bougies M15

  // Chaque bougie M15 devient 15 bougies M1 qui la reconstituent : ouverture au
  // début, extrêmes au milieu, clôture à la fin.
  const fin = [];
  gros.forEach(([o, hi, lo, c], g) => {
    for (let k = 0; k < 15; k++) {
      const b = t0 + g * M15 + k * M1;
      if (k === 0)       fin.push({ time: b, open: o, high: o, low: o, close: o });
      else if (k === 5)  fin.push({ time: b, open: o, high: hi, low: o, close: hi });
      else if (k === 9)  fin.push({ time: b, open: hi, high: hi, low: lo, close: lo });
      else if (k === 14) fin.push({ time: b, open: lo, high: Math.max(lo, c), low: Math.min(lo, c), close: c });
      else               fin.push({ time: b, open: c, high: c, low: c, close: c });
    }
  });

  const enM15 = calcDollarClouds(C(gros), {});
  const enM1  = calcDollarClouds(fin, {});
  const frac  = fractalZones(fin, { fractalHtf: 'M15' }, calcDollarClouds);

  ok(enM15.length === 1, 'la figure existe en M15');
  ok(frac.length === 1, 'le fractal la retrouve depuis les bougies M1', String(frac.length));
  ok(frac[0].top === enM15[0].top && frac[0].bottom === enM15[0].bottom,
     'MÊMES PRIX qu’en M15 — c’est la figure du HTF, pas une du LTF',
     `${frac[0].bottom}-${frac[0].top}`);
  ok(frac[0].hotEdge === enM15[0].hotEdge, 'même mur');
  ok(enM1.length !== 1 || enM1[0].top !== frac[0].top,
     'et ce n’est PAS ce que le M1 aurait détecté tout seul');

  // Les temps sont ramenés sur des bougies qui EXISTENT dans le graphe.
  const heures = new Set(fin.map(c => c.time));
  ok(heures.has(frac[0].startTime), 'le début tombe sur une bougie du graphe');
  ok(frac[0].endTime === null || heures.has(frac[0].endTime), 'la fin aussi');
  ok(frac[0].htf === 'M15', 'la zone dit de quel HTF elle vient', frac[0].htf);

  // L'ÉTIREMENT : extLen compte en bougies M15, donc 15 fois plus large en M1.
  // La zone part du PIVOT (bougie partagée) et finit `extLen` bougies après la
  // seconde centrale, soit extLen + 1 buckets — et ces buckets sont des M15.
  const court = fractalZones(fin, { fractalHtf: 'M15', extLen: 1 }, calcDollarClouds);
  const large = court[0].endTime - court[0].startTime;
  ok(large === 2 * M15, 'l’extension se compte en bougies M15, pas en M1',
     `${large / 60} min`);
  ok(large === 30 * M1, '… donc 15 fois plus large à l’écran qu’en M1', `${large / 60} min`);

  // La bougie HTF EN COURS est écartée : pas de repaint.
  const tronque = fin.slice(0, fin.length - 8);   // dernier bucket M15 incomplet
  ok(fractalZones(tronque, { fractalHtf: 'M15' }, calcDollarClouds).length
       <= fractalZones(fin, { fractalHtf: 'M15' }, calcDollarClouds).length,
     'un bucket HTF non clôturé ne produit aucune figure');

  // LA BOUGIE QUI CONFIRME — sur le LTF, pas sur le HTF.
  const conf = frac[0].confirmTime;
  ok(heures.has(conf), 'la confirmation tombe sur une bougie du graphe', String(conf));
  // La figure est complète à la clôture du 6e bucket (readyIdx = 5) : sur le
  // graphe, c'est la DERNIÈRE bougie M1 que ce bucket contient.
  const bucketConf = t0 + 5 * M15;
  ok(conf === bucketConf + M15 - M1,
     'c’est la DERNIÈRE bougie M1 du bucket M15 qui clôt la figure',
     `${(conf - bucketConf) / 60} min après le début du bucket`);
  ok(conf > frac[0].startTime,
     'elle arrive APRÈS le début du nuage — avant elle, la zone n’existait pas');
  ok(conf - frac[0].startTime === 2 * M15 + 14 * M1,
     'soit 44 minutes après le début du nuage, en M1',
     `${(conf - frac[0].startTime) / 60} min`);

  // Hors fractal, la confirmation est simplement la 5e bougie du motif.
  const direct = calcDollarClouds(C([...BASE, [112, 114, 110, 113]]), {});
  ok(direct[0].confirmTime === C(BASE)[5].time,
     'sans fractal : la 5e bougie de la figure', String(direct[0].confirmTime));

  ok(fractalZones(fin, { fractalHtf: 'ZZ' }, calcDollarClouds).length === 0,
     'une unité inconnue ne dessine rien plutôt que de planter');
  ok(fractalZones([], { fractalHtf: 'M15' }, calcDollarClouds).length === 0, 'aucune bougie');
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

console.log('\n── LE NUAGE, RÉELLEMENT PEINT ─────────────────────────────────');
{
  // Un canvas avale en silence tout ce qu'on lui donne de travers : une
  // coordonnée NaN et la zone disparaît sans un mot. On rejoue donc le dessin
  // sur un contexte FACTICE qui refuse ce que le vrai accepterait — la seule
  // façon de savoir qu'un nuage est vraiment à l'écran sans l'ouvrir.
  const fini = v => typeof v === 'number' && Number.isFinite(v);
  const RGBA = /^rgba\(\d{1,3},\d{1,3},\d{1,3},(0|1|0?\.\d+)\)$/;

  const dessine = (zones, opts, { hr = 2, vr = 2, prix = p => 400 - (p - 100) * 8 } = {}) => {
    const bad = []; bad.peints = 0; bad.traits = 0; bad.textes = 0;
    const grad = () => ({ addColorStop(o, c) {
      // Le vrai canvas LÈVE sur un offset hors [0,1] ou non fini.
      if (!fini(o) || o < 0 || o > 1) bad.push(`stop ${o}`);
      if (!RGBA.test(c)) bad.push(`couleur « ${c} »`);
    } });
    const ctx = {
      _a: 1,
      set globalAlpha(v) { if (!fini(v) || v < 0 || v > 1) bad.push(`alpha ${v}`); this._a = v; },
      get globalAlpha() { return this._a; },
      globalCompositeOperation: '', fillStyle: null, strokeStyle: null,
      lineWidth: 1, font: '', textBaseline: '',
      createLinearGradient(...a) { if (a.some(v => !fini(v))) bad.push(`linGrad ${a}`); return grad(); },
      createRadialGradient(...a) { if (a.some(v => !fini(v))) bad.push(`radGrad ${a}`); return grad(); },
      fillRect(x, y, w, h) {
        if (![x, y, w, h].every(fini)) bad.push(`fillRect ${[x, y, w, h]}`);
        else if (w > 0 && h > 0) bad.peints++;
      },
      beginPath() {}, stroke() { bad.traits++; },
      textAlign: '',
      fillText(t, x, y) {
        if (![x, y].every(fini)) bad.push(`fillText ${[x, y]}`);
        else bad.textes++;
      },
      moveTo(x, y) { if (![x, y].every(fini)) bad.push(`moveTo ${[x, y]}`); },
      lineTo(x, y) { if (![x, y].every(fini)) bad.push(`lineTo ${[x, y]}`); },
      setLineDash(a) { if (!a.every(fini)) bad.push(`dash ${a}`); },
    };
    const prim = createCloudPrimitive();
    prim.attached({
      chart:  { timeScale: () => ({ timeToCoordinate: t => (t - 1700000000) / 60 * 9 }) },
      series: { priceToCoordinate: prix },
      requestUpdate: () => {},
    });
    prim.update(zones, opts);
    prim.updateAllViews();
    prim.paneViews()[0].renderer().draw({
      useBitmapCoordinateSpace: cb => cb({
        context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr,
        bitmapSize: { width: 1600, height: 800 },
      }),
    });
    return bad;
  };

  const nuages = calcDollarClouds(C([...BASE, [112, 114, 110, 113]]), {});
  const STYLE = { bullColor: '#26A69A', bearColor: '#EF5350', opacity: 0.18, showLabel: true, labelText: '$$$' };

  const n0 = dessine(nuages, STYLE);
  ok(n0.length === 0, 'aucun appel canvas invalide', n0.slice(0, 3).join(' | '));
  ok(n0.peints > 20, 'le nuage est RÉELLEMENT peint', `${n0.peints} rectangles`);
  ok(n0.traits === 3, 'trois traits : le mur, le repère de confirmation, l’arête froide',
     `${n0.traits}`);
  ok(dessine(nuages.map(z => ({ ...z, confirmTime: null })), STYLE).traits === 2,
     'sans confirmation connue, le repère n’est pas tracé');

  const n1 = dessine(nuages, STYLE);
  ok(n0.peints === n1.peints,
     'le rendu est STABLE — le nuage ne bouge pas d’un redessin à l’autre');

  ok(dessine(nuages, { ...STYLE, opacity: 0.6 }).length === 0, 'opacité au maximum');
  ok(dessine(nuages, STYLE, { prix: p => 400 - (p - 100) * 0.3 }).length === 0,
     'bande écrasée à quelques pixels');
  ok(dessine(nuages, STYLE, { hr: 1.5, vr: 1.5, prix: p => 4000 - (p - 100) * 200 }).length === 0,
     'bande géante, écran à ratio fractionnaire');
  ok(dessine(nuages.map(z => ({ ...z, endTime: null })), STYLE).peints > 20,
     'zone ouverte, tirée jusqu’au bord droit');
  ok(dessine(nuages.map(z => ({ ...z, side: 'bear', hotEdge: 'top' })), STYLE).length === 0,
     'pointe haute : le mur passe en haut');
  ok(dessine(nuages, STYLE, { prix: () => null }).peints === 0,
     'prix hors échelle → zone ignorée, sans casse');

  // LE TRAIT DE MESURE — une verticale grise de la pointe à la moyenne.
  const mesures = calcDollarClouds(C([...BASE, [112, 114, 110, 113]]), { maDistPeriod: 3 });
  ok(mesures[0].maValue != null, 'la zone porte le PRIX de la moyenne, pas que l’écart',
     String(mesures[0].maValue));
  const nm = dessine(mesures, STYLE);
  ok(nm.length === 0, 'rendu valide avec la mesure', nm.slice(0, 2).join(' | '));
  ok(nm.traits === 4, 'un trait de plus : mur, confirmation, mesure, arête froide',
     `${nm.traits}`);
  ok(dessine(mesures.map(z => ({ ...z, maValue: null })), STYLE).traits === 3,
     'sans moyenne connue, aucun trait de mesure');
  ok(nm.textes === 1, 'l’écart est écrit UNE fois — au milieu du trait, pas au mur',
     `${nm.textes} textes`);
  // Sans mesure, c'est le nom du motif qui reste contre le mur.
  ok(dessine(nuages, STYLE).textes === 1, 'sans mesure, l’étiquette du motif reprend sa place');
  ok(dessine(mesures, { ...STYLE, showLabel: false }).textes === 0, 'labels masqués → rien d’écrit');

  // MASQUER LA MESURE — le trait gris et son chiffre disparaissent, le reste non.
  const cache = dessine(mesures, { ...STYLE, showMaDist: false });
  ok(cache.traits === 3, 'trait de mesure masqué', `${cache.traits} traits`);
  ok(cache.textes === 1, '… et l’étiquette du motif reprend sa place', `${cache.textes}`);
  ok(cache.peints === nm.peints, 'le nuage lui-même est inchangé');
  // Masquer n'éteint PAS le filtre : c'est une règle, pas un dessin.
  const dd = mesures[0].maDist;
  ok(calcDollarClouds(C([...BASE, [112, 114, 110, 113]]),
       { maDistPeriod: 3, maDistMode: 'min', maDistMin: dd + 1 }).length === 0,
     'masquer le trait n’éteint pas le seuil — seul « Aucun » le fait');
}

console.log(fails ? `\n${fails} ÉCHEC(S) sur ${total}` : `\nTout passe (${total} assertions).`);
process.exit(fails ? 1 : 0);
