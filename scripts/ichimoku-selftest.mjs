#!/usr/bin/env node
// AUTO-CONTRÔLE DE L'ICHIMOKU.
//
//   npm run ichimoku-test
//
// Deux choses seulement ne se relisent pas à l'œil dans cet indicateur, et ce
// sont exactement les deux qui feraient un faux nuage silencieux :
//
//   · le MILIEU DU CANAL calculé par files monotones — un O(n) qui doit rendre
//     à la virgule près ce que rendrait un max/min naïf sur chaque fenêtre ;
//   · le DÉCALAGE, qui est en BOUGIES et doit le rester même quand le temps,
//     lui, saute (week-end). Une projection qui compterait en secondes poserait
//     le nuage au mauvais endroit un lundi matin sur deux.
//
// Tout est en bougies fabriquées : chaque assertion porte sur un cas nommé.

import { calcIchimoku, ICHIMOKU_DEFAULTS } from '../lib/ichimoku.js';

let fails = 0, total = 0;
const ok = (cond, name, extra = '') => {
  total++;
  if (cond) console.log(`  ✓ ${name}`);
  else { fails++; console.log(`  ✗ ${name} ${extra}`); }
};

const T0 = 1_700_000_000;

// Marche aléatoire déterministe : le même jeu de bougies à chaque exécution.
function bougies(n, { step = 60, trou = null } = {}) {
  let graine = 42;
  const rnd = () => (graine = (graine * 1103515245 + 12345) % 2147483648) / 2147483648;
  const out = [];
  let prix = 100;
  let t = T0;
  for (let i = 0; i < n; i++) {
    const open = prix;
    const close = open + (rnd() - 0.5) * 2;
    const high = Math.max(open, close) + rnd();
    const low  = Math.min(open, close) - rnd();
    out.push({ time: t, open, high, low, close, volume: 1 });
    prix = close;
    // Un trou de week-end au milieu, pour que le pas le plus fréquent ne soit
    // pas le seul pas observé.
    t += (trou != null && i === trou) ? step * 3000 : step;
  }
  return out;
}

// Référence naïve : max/min relus sur toute la fenêtre à chaque bougie.
function midNaif(candles, period, i) {
  if (i < period - 1) return null;
  let h = -Infinity, l = Infinity;
  for (let j = i - period + 1; j <= i; j++) {
    if (candles[j].high > h) h = candles[j].high;
    if (candles[j].low  < l) l = candles[j].low;
  }
  return (h + l) / 2;
}

const proche = (a, b) => a != null && b != null && Math.abs(a - b) < 1e-9;

// ── 1. Les lignes valent le milieu du canal ───────────────────────────────────
{
  console.log('\nMilieu du canal (files monotones vs relecture naïve)');
  const c = bougies(400);
  const { tenkanLen: TL, kijunLen: KL, senkouLen: SL, displacement: D } = ICHIMOKU_DEFAULTS;
  const r = calcIchimoku(c, {});

  const tMap = new Map(r.tenkan.map(p => [p.time, p.value]));
  const kMap = new Map(r.kijun.map(p => [p.time, p.value]));

  let tOk = true, kOk = true, tNb = 0;
  for (let i = 0; i < c.length; i++) {
    const att = midNaif(c, TL, i);
    const got = tMap.get(c[i].time);
    if (att == null) { if (got != null) tOk = false; }
    else { tNb++; if (!proche(got, att)) tOk = false; }

    const attK = midNaif(c, KL, i);
    const gotK = kMap.get(c[i].time);
    if (attK == null) { if (gotK != null) kOk = false; }
    else if (!proche(gotK, attK)) kOk = false;
  }
  ok(tOk, `Tenkan(${TL}) exact sur les ${tNb} bougies attendues`);
  ok(kOk, `Kijun(${KL}) exact`);
  ok(r.tenkan.length === c.length - TL + 1, 'Tenkan commence à la bougie period-1',
     `(${r.tenkan.length} ≠ ${c.length - TL + 1})`);

  // Senkou A = (Tenkan + Kijun) / 2 de la bougie SOURCE, posée D plus loin.
  const aMap = new Map(r.spanA.map(p => [p.time, p.value]));
  let aOk = true;
  for (let i = KL - 1; i < c.length; i++) {
    const src = (midNaif(c, TL, i) + midNaif(c, KL, i)) / 2;
    const tCible = i + D < c.length ? c[i + D].time : null;
    if (tCible != null && !proche(aMap.get(tCible), src)) aOk = false;
  }
  ok(aOk, 'Senkou A = (Tenkan + Kijun) / 2, posée sur la bougie source + décalage');

  const bMap = new Map(r.spanB.map(p => [p.time, p.value]));
  let bOk = true;
  for (let i = SL - 1; i < c.length - D; i++) {
    if (!proche(bMap.get(c[i + D].time), midNaif(c, SL, i))) bOk = false;
  }
  ok(bOk, `Senkou B(${SL}) = milieu du canal, même décalage`);
}

// ── 2. Le décalage se compte en bougies ──────────────────────────────────────
{
  console.log('\nDécalage — en bougies, jamais en secondes');
  const c = bougies(300);
  const D = 26;
  const r = calcIchimoku(c, { displacement: D });

  // Chikou : la clôture de la bougie i posée sur le temps de la bougie i-D.
  ok(r.chikou.length === c.length - D, 'Chikou : les D premières bougies n’ont pas d’ancre à gauche',
     `(${r.chikou.length} ≠ ${c.length - D})`);
  let chOk = true;
  for (let i = D; i < c.length; i++) {
    const p = r.chikou[i - D];
    if (p.time !== c[i - D].time || !proche(p.value, c[i].close)) chOk = false;
  }
  ok(chOk, 'Chikou : close[i] posée au temps de la bougie i − D');

  // Le nuage dépasse la dernière bougie chargée d'exactement D points, à un pas
  // régulier — c'est cette place à droite qui rend l'indicateur lisible.
  const last = c[c.length - 1].time;
  const futur = r.cloud.filter(p => p.time > last);
  ok(futur.length === D, `${D} points de nuage projetés au-delà de la dernière bougie`,
     `(${futur.length})`);
  ok(futur.every((p, i) => p.time === last + (i + 1) * 60), 'les temps projetés suivent le pas des bougies');

  // Décalage nul : tout retombe sur la bougie courante, rien ne dépasse.
  const r0 = calcIchimoku(c, { displacement: 0 });
  ok(r0.cloud.every(p => p.time <= last), 'décalage 0 → aucun point dans le futur');
  ok(r0.chikou.length === c.length, 'décalage 0 → Chikou aussi long que les bougies');
}

// ── 3. Un trou dans le temps ne déplace pas le nuage ─────────────────────────
{
  console.log('\nMarché à trous (week-end)');
  const c = bougies(300, { trou: 150 });   // un saut de 50 h au milieu
  const r = calcIchimoku(c, {});
  const D = ICHIMOKU_DEFAULTS.displacement;

  // La bougie 100 est avant le trou, la 100+D après : le décalage doit
  // atterrir sur la bougie, pas sur « 26 minutes plus tard ».
  const src = 140;
  const tCible = c[src + D].time;
  const a = r.spanA.find(p => p.time === tCible);
  ok(a != null, 'Senkou A atterrit sur la bougie source + D même à travers le trou');

  // Le pas de projection est le pas le PLUS FRÉQUENT, pas le dernier écart ni
  // la moyenne — la moyenne serait ici gonflée par le seul trou.
  const last = c[c.length - 1].time;
  const futur = r.cloud.filter(p => p.time > last);
  ok(futur[0]?.time === last + 60, 'la projection reprend le pas normal (60 s), pas la moyenne');
}

// ── 4. Bords, garde-fous ─────────────────────────────────────────────────────
{
  console.log('\nGarde-fous');
  ok(calcIchimoku([], {}).cloud.length === 0, 'aucune bougie → rien');
  ok(calcIchimoku(bougies(30), {}).cloud.length === 0,
     'moins de bougies que la plus longue fenêtre → rien (le nuage ne naît pas sur 3 points)');

  const c = bougies(60);
  const r = calcIchimoku(c, { tenkanLen: 9, kijunLen: 26, senkouLen: 52, displacement: 26 });
  ok(r.cloud.every(p => p.a != null && p.b != null),
     'le nuage n’existe que là où ses DEUX bords existent');
  ok(r.cloud.length === r.spanB.length,
     'Senkou B, la plus tardive des deux, décide du début du nuage');

  // La table de l'infobulle rend bien ce qui est dessiné à ce temps-là.
  const t = c[55].time;
  const pt = r.points.get(t);
  ok(pt?.tenkan != null && pt?.kijun != null, 'points : Tenkan et Kijun à leur propre temps');
  const attChikou = c[55 + 26]?.close;
  ok(attChikou === undefined ? pt.chikou === undefined : proche(pt.chikou, attChikou),
     'points : Chikou = la clôture de 26 bougies plus tard');
}

console.log(`\n${total - fails}/${total} vérifications passées`);
process.exit(fails ? 1 : 0);
