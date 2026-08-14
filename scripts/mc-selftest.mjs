#!/usr/bin/env node
// AUTO-CONTRÔLE DU MONTE-CARLO.
//
//   npm run mc-test
//
// Une simulation ne se relit pas à l'œil : elle rend des quantiles plausibles
// quoi qu'on lui donne, y compris quand elle est fausse. Ce qui se vérifie, en
// revanche, ce sont ses INVARIANTS — et ce sont exactement eux qui feraient un
// chiffre faux mais crédible :
//
//   · le REBATTAGE conserve le total. S'il ne le conserve pas, ce n'est plus une
//     permutation et le rang de l'observé ne veut plus rien dire.
//   · le RANG DU DRAWDOWN RÉEL détecte le groupement des pertes. C'est l'unique
//     affirmation forte de la carte : une série dont les pertes sont toutes à la
//     fin doit sortir au rang 1, la même série alternée au rang 0.
//   · le DÉTERMINISME. Deux lectures du même rapport doivent rendre les mêmes
//     quantiles, sinon on croit avoir découvert quelque chose en changeant le
//     prix du point.
//   · la RUINE relue dans les creux déjà simulés doit rendre exactement ce que
//     rendrait un recomptage à la main, sans quoi le découplage capital/tirages
//     est un bug silencieux.
//   · le GARDE-FOU DE COÛT, qui doit rogner les tirages sans jamais descendre
//     sous le plancher.

import { runMonteCarlo, ruinProbability } from '../lib/monteCarlo.js';

let fails = 0, total = 0;
const ok = (cond, name, extra = '') => {
  total++;
  if (cond) console.log(`  ✓ ${name}`);
  else { fails++; console.log(`  ✗ ${name} ${extra}`); }
};
const proche = (a, b, eps = 1e-9) => a != null && b != null && Math.abs(a - b) <= eps;

// Référence naïve du parcours, écrite à part de celle du module : c'est tout
// l'intérêt: si les deux disent la même chose, la boucle optimisée du module
// n'a pas dérivé.
function refStats(gains) {
  let cum = 0, peak = 0, maxDD = 0, minCum = 0, streak = 0, maxStreak = 0, uw = 0, maxUw = 0;
  for (const g of gains) {
    cum += g;
    peak = Math.max(peak, cum);
    maxDD = Math.max(maxDD, peak - cum);
    minCum = Math.min(minCum, cum);
    streak = g < 0 ? streak + 1 : 0;
    maxStreak = Math.max(maxStreak, streak);
    uw = cum < peak ? uw + 1 : 0;
    maxUw = Math.max(maxUw, uw);
  }
  return { net: cum, maxDD, lossStreak: maxStreak, underwater: maxUw, minCum };
}

// Série pseudo-aléatoire déterministe, pour ne pas dépendre de Math.random().
function serie(n) {
  let g = 7;
  const rnd = () => (g = (g * 1103515245 + 12345) % 2147483648) / 2147483648;
  return Array.from({ length: n }, () => (rnd() < 0.42 ? 2.7 : -1.3) * (0.5 + rnd()));
}

console.log('\nParcours — le module contre une référence naïve');
{
  const g = serie(300);
  const mc = runMonteCarlo(g, { draws: 50 });
  const r = refStats(g);
  ok(proche(mc.observed.net, r.net, 1e-9), 'net observé', `${mc.observed.net} ≠ ${r.net}`);
  ok(proche(mc.observed.maxDD, r.maxDD, 1e-9), 'drawdown observé', `${mc.observed.maxDD} ≠ ${r.maxDD}`);
  ok(mc.observed.lossStreak === r.lossStreak, 'série de pertes observée');
  ok(mc.observed.underwater === r.underwater, 'temps sous l\'eau observé');
  ok(proche(mc.observed.minCum, r.minCum, 1e-9), 'creux absolu observé');
  // Le pic part de ZÉRO, comme dans lib/signals/stats.js : une série qui ne
  // monte jamais doit creuser de tout son total, pas de zéro.
  const desc = [-1, -2, -3, -4];
  const md = runMonteCarlo(desc, { draws: 10 });
  ok(md.observed.maxDD === 10, 'le drawdown se mesure depuis le capital de départ', String(md.observed.maxDD));
  ok(md.observed.lossStreak === 4 && md.observed.underwater === 4, 'série et temps sous l\'eau sur une descente pure');
  const asc = runMonteCarlo([1, 2, 3, 4], { draws: 10 });
  ok(asc.observed.maxDD === 0 && asc.observed.lossStreak === 0 && asc.observed.underwater === 0,
    'une montée pure ne creuse rien');
}

console.log('\nRebattage — le total ne dépend pas de l\'ordre');
{
  const g = serie(400);
  const mc = runMonteCarlo(g, { mode: 'shuffle', draws: 800 });
  const ecart = Math.max(Math.abs(mc.net.max - mc.observed.net), Math.abs(mc.net.min - mc.observed.net));
  // Tolérance : la somme flottante dépend de l'ordre des additions. C'est du
  // bruit d'arrondi (1e-12 relatif), pas une variation de résultat.
  ok(ecart < 1e-9 * Math.max(1, Math.abs(mc.observed.net)),
    'les 800 rebattages finissent au même total', `écart max ${ecart}`);
  ok(proche(mc.band.p50[mc.band.p50.length - 1], mc.observed.net, 1e-9),
    'le faisceau se referme sur le total réel');
  ok(mc.maxDD.max > mc.maxDD.min, 'le CHEMIN, lui, varie bien');
  ok(mc.maxDD.p5 <= mc.maxDD.p25 && mc.maxDD.p25 <= mc.maxDD.p50
    && mc.maxDD.p50 <= mc.maxDD.p75 && mc.maxDD.p75 <= mc.maxDD.p95, 'quantiles ordonnés');
}

console.log('\nRang du drawdown réel — la détection du groupement');
{
  // 120 gains de +1 puis 60 pertes de −2 : total nul, et l'ordre réel est le
  // PIRE de tous les ordres possibles (on monte à 120 avant de tout rendre).
  const groupe = [...Array(120).fill(1), ...Array(60).fill(-2)];
  const mcG = runMonteCarlo(groupe, { mode: 'shuffle', draws: 2000 });
  ok(proche(mcG.observed.net, 0), 'série de contrôle à somme nulle');
  ok(mcG.observed.maxDD === 120, 'l\'ordre groupé creuse au maximum', String(mcG.observed.maxDD));
  ok(mcG.maxDD.rank >= 0.999, 'pertes groupées → rang ≈ 1', `rang ${mcG.maxDD.rank}`);

  // Les MÊMES trades, alternés pour creuser le moins possible : (+1, +1, −2) × 60.
  const alterne = Array.from({ length: 180 }, (_, i) => (i % 3 === 2 ? -2 : 1));
  const mcA = runMonteCarlo(alterne, { mode: 'shuffle', draws: 2000 });
  ok(proche(mcA.observed.net, 0), 'même total');
  ok(mcA.observed.maxDD === 2, 'l\'ordre alterné creuse au minimum', String(mcA.observed.maxDD));
  ok(mcA.maxDD.rank <= 0.01, 'pertes dispersées → rang ≈ 0', `rang ${mcA.maxDD.rank}`);
  // Et le point de la carte : les deux séries ont la MÊME distribution simulée.
  // Seul l'observé les sépare — c'est bien l'ordre qu'on teste, rien d'autre.
  ok(proche(mcG.maxDD.p50, mcA.maxDD.p50, 1e-9),
    'mêmes trades → même distribution, seul l\'observé diffère');
}

console.log('\nTirage avec remise');
{
  const g = serie(200);
  const moy = g.reduce((s, v) => s + v, 0) / g.length;
  const mc = runMonteCarlo(g, { mode: 'bootstrap', draws: 4000 });
  const attendu = moy * g.length;
  const sd = Math.sqrt(g.reduce((s, v) => s + (v - moy) ** 2, 0) / (g.length - 1));
  const se = sd * Math.sqrt(g.length) / Math.sqrt(4000);
  ok(Math.abs(mc.net.mean - attendu) < 4 * se,
    'le résultat moyen retombe sur n × l\'espérance', `${mc.net.mean.toFixed(2)} vs ${attendu.toFixed(2)} ± ${(4 * se).toFixed(2)}`);
  ok(mc.net.max > mc.net.min, 'le total varie, lui');
  // La part sous zéro doit être celle des échantillons réellement négatifs.
  const negs = [...mc.netsSorted].filter(v => v < 0).length;
  ok(proche(mc.pctLoss, negs / mc.draws, 1e-12), 'part des échantillons dans le rouge');
}

console.log('\nDéterminisme');
{
  const g = serie(250);
  const a = runMonteCarlo(g, { draws: 500 });
  const b = runMonteCarlo(g, { draws: 500 });
  ok(a.maxDD.p95 === b.maxDD.p95 && a.maxDD.rank === b.maxDD.rank,
    'deux exécutions identiques rendent les mêmes quantiles');
  const c = runMonteCarlo(g, { draws: 500, seed: 1234 });
  ok(c.maxDD.p95 !== a.maxDD.p95, 'une autre graine rend autre chose (la graine est bien câblée)');
}

console.log('\nRuine — relue dans les creux déjà simulés');
{
  const g = serie(300);
  const mc = runMonteCarlo(g, { mode: 'bootstrap', draws: 1000 });
  const pire = -mc.minCums[0];                      // le creux le plus profond
  for (const cap of [pire * 0.25, pire * 0.5, pire * 0.9]) {
    const attendu = [...mc.minCums].filter(v => v <= -cap).length / mc.draws;
    ok(proche(ruinProbability(mc, cap), attendu, 1e-12), `ruine à ${cap.toFixed(1)} pts recomptée`);
  }
  ok(ruinProbability(mc, pire * 1.0001) === 0, 'un capital au-delà du pire creux ne ruine jamais');
  ok(ruinProbability(mc, 0) === null && ruinProbability(mc, -5) === null,
    'pas de capital, pas de chiffre (plutôt qu\'un faux zéro)');
  // Monotonie : plus de capital ne peut pas augmenter le risque.
  let prev = 1;
  let mono = true;
  for (let k = 1; k <= 20; k++) {
    const p = ruinProbability(mc, (pire * k) / 20);
    if (p > prev + 1e-12) mono = false;
    prev = p;
  }
  ok(mono, 'la ruine décroît avec le capital');
}

console.log('\nPoints de contrôle et garde-fou de coût');
{
  const mc = runMonteCarlo(serie(1000), { draws: 100 });
  ok(mc.checkpoints.length === 200, 'un faisceau plafonné à 200 points de contrôle');
  ok(mc.checkpoints[mc.checkpoints.length - 1] === 999, 'le dernier trade y est toujours');
  ok(mc.checkpoints.every((v, i) => i === 0 || v > mc.checkpoints[i - 1]), 'indices strictement croissants');
  ok(mc.observed.path.length === 200, 'la courbe réelle est échantillonnée sur la même grille');

  const court = runMonteCarlo(serie(30), { draws: 50 });
  ok(court.checkpoints.length === 30 && court.observed.path.length === 30,
    'moins de trades que de points de contrôle : un point par trade');

  // 5 000 trades × 10 000 tirages = 5·10⁷, deux fois et demie le budget : à rogner.
  const gros = runMonteCarlo(serie(5000), { draws: 10000 });
  ok(gros.draws === 4000 && gros.drawsAsked === 10000, 'les tirages sont rognés sous le budget',
    `${gros.draws}`);
  ok(gros.draws >= 200, 'jamais sous le plancher de 200 tirages', String(gros.draws));
  const petit = runMonteCarlo(serie(50), { draws: 50 });
  ok(petit.draws === 50, 'un petit nombre demandé est respecté tel quel', String(petit.draws));
}

console.log('\nBords');
{
  ok(runMonteCarlo([], {}) === null, 'aucun trade : rien à rebattre');
  ok(runMonteCarlo([1], {}) === null, 'un seul trade non plus');
  const plat = runMonteCarlo([1, 1, 1, 1, 1], { draws: 100 });
  ok(plat.maxDD.min === 0 && plat.maxDD.max === 0, 'que des gains : aucun creux, quel que soit l\'ordre');
  ok(plat.maxDD.rank === 1, 'rang 1 quand tous les tirages égalent l\'observé');
  ok(ruinProbability(null, 100) === null, 'pas de simulation, pas de ruine');
}

console.log(`\n${fails ? '✗' : '✓'} ${total - fails}/${total} assertions\n`);
process.exit(fails ? 1 : 0);
