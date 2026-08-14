#!/usr/bin/env node
// AUTO-CONTRÔLE DU SCRIPT « Boom · RSIER ».
//
//   npm run boom-test                      # cas fabriqués, assertions
//   npm run boom-test -- --data bars.json  # + un vrai run sur des bougies réelles
//
// Deux choses ne se relisent pas à l'œil dans ce script, et ce sont exactement
// les deux qui feraient un rapport faux sans rien casser :
//
//   · LA CAISSE. Poche remise à niveau, surplus retiré, réserve rechargée : à
//     tout instant, poche + réserve doit valoir le capital plus ou moins ce que
//     le marché a donné. Une fuite d'un dollar par trade ne se voit pas sur un
//     trade et fait un rapport entièrement faux sur mille.
//   · LE GLISSEMENT DU STOP. À 0 % le stop est servi au niveau, à 100 % au pire
//     prix de la bougie. C'est le réglage qui décide du signe du résultat sur un
//     instrument qui bondit : il doit faire EXACTEMENT ce qu'il dit.
//
// Le reste (détection RSIER, marge, stop out) est couvert ailleurs.

import { readFileSync } from 'node:fs';
import { runScript } from '../lib/scripts/engine.js';
import { sanitizeAccount } from '../lib/scripts/account.js';
import { summarizeRun } from '../lib/scripts/report.js';
import boomRsier from '../lib/scripts/library/boomRsier.js';

let fails = 0, total = 0;
const ok = (cond, name, extra = '') => {
  total++;
  if (cond) console.log(`  ✓ ${name}`);
  else { fails++; console.log(`  ✗ ${name} ${extra}`); }
};
const proche = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const usd = v => `${v.toFixed(2)} $`;

const T0 = 1_700_000_000;

// Bougies fabriquées : une dérive baissière régulière, et des spikes haussiers
// posés là où on les veut — la caricature d'un Boom, en dix lignes.
function bougies({ n = 400, pas = 1, depart = 15000, spikes = {} }) {
  const out = [];
  let px = depart;
  for (let i = 0; i < n; i++) {
    const open = px;
    const spike = spikes[i] ?? 0;
    const close = spike > 0 ? open + spike * 0.6 : open - pas;
    out.push({
      time: T0 + i * 60,
      open,
      high: Math.max(open, close) + (spike > 0 ? spike * 0.4 : 0),
      low:  Math.min(open, close),
      close,
      volume: 1,
    });
    px = close;
  }
  return out;
}

// Un motif RSIER qui ouvre une survente à un index choisi, sans dépendre du RSI :
// on remplace la détection par une carte d'index. Le script lit `context.patterns`,
// donc on lui donne un vrai motif — mais pour maîtriser l'instant d'entrée, on
// s'appuie sur la seule chose qui compte ici : `state.byIdx`.
function scriptAvecEntrees(indexes) {
  return {
    ...boomRsier,
    setup(args) {
      const st = boomRsier.setup.call(boomRsier, args);
      st.byIdx = new Map(indexes.map(i => [i - 1, { startIdx: i, rsiStart: 12 }]));
      st.zones = indexes.length;
      return st;
    },
  };
}

const compte = (extra = {}) => sanitizeAccount({
  capital: 100, pointValue: 1, marginPerLot: 1, minLot: 0.01, lotStep: 0.01,
  spreadPts: 0, marginCallLevel: 0, stopOutLevel: 0, ...extra,
});

const params = (extra = {}) => ({ ...boomRsier.defaults, poche: 10, risqueUsd: 5, slPts: 10, rr: 1, ...extra });

// ── 1. La caisse ────────────────────────────────────────────────────────────
console.log('\nLA CAISSE — poche, réserve, et rien qui se perde en route');
{
  // Une seule entrée, qui gagne : dérive baissière pure, aucun spike.
  const c   = bougies({ n: 200 });
  const run = runScript({
    candles: c, script: scriptAvecEntrees([10]), params: params(), account: compte(), context: {},
  });
  const s = summarizeRun(run);
  const t = run.trades[0];

  ok(run.trades.length === 1, 'une entrée donne une position', `(${run.trades.length})`);
  ok(t.side === 'SELL', 'une survente se VEND', `(${t?.side})`);
  ok(t.reason === 'tp', 'la dérive baissière emmène au TP', `(${t?.reason})`);
  // lots = risque / (sl × pointValue) = 5 / 10 = 0.5 → TP à 10 pts = +5 $
  ok(proche(t.lots, 0.5), 'la taille vient du risque en dollars', `(${t?.lots})`);
  ok(proche(t.profitUsd, 5, 1e-9), 'le TP vaut le risque (RR 1)', `(${usd(t.profitUsd)})`);
  ok(proche(s.finalWealth, 105), 'patrimoine = capital + gain', `(${usd(s.finalWealth)})`);
  ok(proche(s.finalBalance + run.account.external, s.finalWealth), 'solde + hors compte = patrimoine');
  ok(s.finalBalance <= 10 + 1e-9, 'le broker ne garde jamais plus que la poche', `(${usd(s.finalBalance)})`);
  ok(proche(s.netProfit, 5), 'le profit net se lit sur le patrimoine, pas sur le solde', `(${usd(s.netProfit)})`);
}

{
  // Dix entrées d'affilée : la caisse doit rester juste sur la durée.
  const c   = bougies({ n: 900 });
  const idx = [10, 90, 170, 250, 330, 410, 490, 570, 650, 730];
  const run = runScript({
    candles: c, script: scriptAvecEntrees(idx), params: params(), account: compte(), context: {},
  });
  const s = summarizeRun(run);
  const gains = run.trades.reduce((a, t) => a + t.profitUsd, 0);
  ok(run.trades.length === idx.length, 'dix surventes, dix positions', `(${run.trades.length})`);
  ok(proche(s.finalWealth, 100 + gains, 1e-6), 'patrimoine = capital + somme des trades', `(${usd(s.finalWealth)} vs ${usd(100 + gains)})`);
  ok(proche(s.finalBalance, 10, 1e-6), 'la poche est ramenée à son montant', `(${usd(s.finalBalance)})`);
  ok(s.withdrawals > 0 && s.deposits === 0, 'que des retraits tant que rien ne perd',
     `(retraits ${usd(s.withdrawals)}, dépôts ${usd(s.deposits)})`);
}

// ── 2. Le spike, le stop, et le glissement ──────────────────────────────────
console.log('\nLE GLISSEMENT DU STOP — le réglage qui décide du signe');
{
  // Entrée à 10, spike de 60 points à la bougie 12 : le stop (10 pts au-dessus)
  // est traversé de loin. Au niveau, il coûte 10 pts ; au pire, tout le spike.
  const c = bougies({ n: 60, spikes: { 12: 60 } });
  const lance = slipPct => {
    const run = runScript({
      candles: c, script: scriptAvecEntrees([10]), params: params(), account: compte({ slipPct }), context: {},
    });
    return run.trades[0];
  };
  const t0 = lance(0), t50 = lance(50), t100 = lance(100);
  const entree = c[10].open;

  ok(t0.reason === 'sl' && proche(t0.exitPrice, t0.sl), 'à 0 %, le stop est servi au niveau demandé',
     `(${t0.exitPrice} vs ${t0.sl})`);
  ok(proche(t0.profitUsd, -5), 'à 0 %, la perte vaut le risque annoncé', `(${usd(t0.profitUsd)})`);
  ok(proche(t100.exitPrice, c[12].high), 'à 100 %, le stop est servi au pire prix de la bougie',
     `(${t100.exitPrice} vs ${c[12].high})`);
  ok(t100.profitUsd < t0.profitUsd, 'le glissement ne peut que coûter',
     `(${usd(t100.profitUsd)} vs ${usd(t0.profitUsd)})`);
  ok(proche(t50.exitPrice, (t0.exitPrice + t100.exitPrice) / 2, 1e-6),
     '50 % tombe à mi-chemin entre les deux bornes', `(${t50.exitPrice})`);
  ok(t0.exitPrice > entree && t100.exitPrice > entree, 'un stop de vente sort AU-DESSUS de l’entrée');
}

// ── 3. La poche cramée : ce qui borne vraiment une perte ────────────────────
console.log('\nLA POCHE CRAMÉE — la seule borne dure d’une perte');
{
  // Poche de 3 $ pour un lot qui perd 0,5 $/point, et un spike de 60 points :
  // la perte dépasse la poche. Elle doit s'arrêter à zéro, être comptée, et la
  // réserve doit recharger pour la position suivante.
  const c   = bougies({ n: 300, spikes: { 12: 60 } });
  const run = runScript({
    candles: c, script: scriptAvecEntrees([10, 100]),
    params: params({ poche: 3, risqueUsd: 5, slPts: 10 }), account: compte(), context: {},
  });
  const s = summarizeRun(run);
  const t = run.trades[0];

  ok(t.profitUsd < -3, 'le spike coûte plus que la poche', `(${usd(t.profitUsd)})`);
  ok(s.wipes >= 1 && s.absorbed > 0, 'la protection du solde négatif est comptée',
     `(${s.wipes} fois, ${usd(s.absorbed)})`);
  ok(proche(s.netProfit, s.trueProfit + s.absorbed, 1e-6),
     'profit net et profit hors effacement diffèrent exactement de ce qui a été effacé');
  ok(run.trades.length === 2, 'la réserve recharge et la partie continue', `(${run.trades.length})`);
  ok(!s.ruined, 'une poche cramée n’est pas une ruine tant que la réserve tient');
  ok(s.deposits > 0, 'la recharge apparaît dans les dépôts', `(${usd(s.deposits)})`);
}

{
  // Réserve à sec : là, c'est fini, et ça doit se dire.
  const c   = bougies({ n: 300, spikes: { 12: 400 } });
  const run = runScript({
    candles: c, script: scriptAvecEntrees([10, 100, 200]),
    params: params({ poche: 100, risqueUsd: 50, slPts: 10 }), account: compte(), context: {},
  });
  const s = summarizeRun(run);
  ok(s.ruined || run.trades.length < 3, 'sans réserve, le script s’arrête',
     `(ruine ${s.ruined}, ${run.trades.length} trades)`);
}

// ── 4. Une position à la fois ───────────────────────────────────────────────
console.log('\nUNE POSITION À LA FOIS — et les signaux que ça coûte');
{
  const c   = bougies({ n: 400 });
  const run = runScript({
    candles: c, script: scriptAvecEntrees([10, 12, 14, 200]), params: params(), account: compte(), context: {},
  });
  ok(run.trades.length === 2, 'les surventes tombées pendant une position sont ignorées',
     `(${run.trades.length})`);
  const journal = run.logs.map(l => l.text).join(' | ');
  ok(/ignorées/.test(journal), 'le journal dit combien ont été ignorées');
}

// ── 5. Un vrai run, si on lui donne des bougies ─────────────────────────────
const flagData = process.argv.indexOf('--data');
if (flagData !== -1 && process.argv[flagData + 1]) {
  const candles = JSON.parse(readFileSync(process.argv[flagData + 1], 'utf8'));
  console.log(`\nRUN RÉEL — ${candles.length} bougies`);

  const pat = {
    type: 'RSIER', enabled: true, htf: 'M1', rsiPeriod: 7, osLevel: 20, obLevel: 80,
    direction: 'bull', maDistPeriod: 0, maDistMode: 'off',
  };
  const p = { ...boomRsier.defaults, poche: 7.5, risqueUsd: 5, slPts: 17.33, tpMode: 'rr', rr: 1.5 };

  // `pertes effacées` est la colonne à lire en premier : c'est ce que la
  // protection du solde négatif a absorbé, donc ce que la stratégie aurait coûté
  // si la poche n'avait pas borné chaque perte. Un profit net qui n'existe que
  // parce que cette colonne est énorme n'est pas un edge, c'est un transfert.
  console.log('  glissement │ patrimoine │ profit net │   DD max  │ pertes effacées │ trades │ WR    │ poches cramées');
  for (const slipPct of [0, 25, 50, 75, 100]) {
    const run = runScript({
      candles, script: boomRsier, params: p, context: { patterns: [pat] },
      account: sanitizeAccount({
        capital: 500, pointValue: 1, marginPerLot: 15, spreadPts: 1.45,
        minLot: 0.2, maxLot: 100, lotStep: 0.01, marginCallLevel: 100, stopOutLevel: 50, slipPct,
      }),
    });
    const s = summarizeRun(run);
    console.log(
      `      ${String(slipPct).padStart(3)} %   │ ${usd(s.finalWealth).padStart(10)} │ `
      + `${(s.netProfit >= 0 ? '+' : '−') + usd(Math.abs(s.netProfit)).padStart(8)} │ `
      + `${usd(s.maxDrawdown).padStart(9)} │ ${usd(s.absorbed).padStart(15)} │ ${String(s.total).padStart(6)} │ `
      + `${(s.winrate ?? 0).toFixed(1)}% │ ${s.wipes}`,
    );
    if (slipPct === 0) for (const l of run.logs.slice(0, 3)) console.log(`     · ${l.text}`);
    if (slipPct === 100) for (const l of run.logs.slice(-1)) console.log(`     · ${l.text}`);
  }
}

console.log(`\n${fails === 0 ? '✓' : '✗'} ${total - fails}/${total} contrôles passés\n`);
process.exit(fails === 0 ? 0 : 1);
