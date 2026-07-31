#!/usr/bin/env node
// Runner CLI de l'optimiseur KO. Pilote /api/ko/* (serveur dev requis,
// port 3000 — sinon GRAPHER_URL).
//
//   node scripts/ko-opt.mjs <commande> [options]
//
// La mission vit dans un fichier JSON (défaut backtests/ko-mission.json) :
// timeframe, réglages de DÉTECTION de départ, et par symbole le spread et les
// sorties. Les flags de la ligne de commande l'écrasent.
//
// DEUX DISCIPLINES, PAS UNE :
//
//   • OUT-OF-SAMPLE — `sweep` et `grid` REFUSENT de tourner ailleurs que sur
//     l'in-sample. Chaque coup d'œil à l'OOS avant d'avoir figé les paramètres le
//     consomme, et il n'y en a pas de second. `validate` est la seule commande
//     qui l'ouvre, une fois.
//   • CONTRÔLE PAR DÉCALAGE — le KO autorise le balayage de la DÉTECTION (le
//     rFVG l'interdit), donc le nombre d'essais est bien plus grand et un beau
//     réglage peut sortir du seul fait d'avoir cherché. `control` rejoue les
//     mêmes signaux à des dates d'entrée décalées : si le vrai réglage ne sort
//     pas de ce nuage, il ne mesure pas le motif. `validate` le lance d'office et
//     `save` refuse le statut « validated » sans lui.

import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.GRAPHER_URL || 'http://localhost:3000';
const MISSION_DEFAULT = 'backtests/ko-mission.json';
const LEDGER = 'backtests/ko-ledger.jsonl';

/* ───────────────────────────── utilitaires ───────────────────────────── */

const fmt = (v, d = 2) => v == null || Number.isNaN(v) ? '—' : Number.isFinite(v) ? v.toFixed(d) : '∞';
const pct = v => v == null ? '—' : `${(v * 100).toFixed(1)}%`;
const padR = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);
const die  = m => { console.error(`\n✖ ${m}\n`); process.exit(1); };

const dayISO = e => new Date(e * 1000).toISOString().slice(0, 10);
function toEpoch(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const t = Date.parse(v.length === 10 ? `${v}T00:00:00Z` : `${v}Z`);
  if (Number.isNaN(t)) die(`date illisible : ${v}`);
  return Math.floor(t / 1000);
}

async function post(route, body) {
  const r = await fetch(`${BASE}/api/ko/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { die(`${route} : réponse illisible — ${text.slice(0, 300)}`); }
  if (!r.ok) die(`${route} : ${j.error ?? r.statusText}`);
  return j;
}

/* ─────────────────────────── arguments / mission ─────────────────────── */

const argv = process.argv.slice(2);
const cmd  = argv[0];
const rest = argv.slice(1);

function flag(name, def = null) {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] != null && !rest[i + 1].startsWith('--') ? rest[i + 1] : def;
}
const has = name => rest.includes(`--${name}`);

// Surcharges cle=valeur, répétables : -p pour les SORTIES, -d pour la DÉTECTION.
// Les deux sont séparés parce qu'ils ne se règlent pas au même titre — la
// détection change ce qu'on étudie, les sorties calibrent comment on le trade.
function pairs(...flags) {
  const out = {};
  for (let i = 0; i < rest.length; i++) {
    if (!flags.includes(rest[i])) continue;
    const [k, v] = String(rest[++i] ?? '').split('=');
    if (!k) continue;
    out[k] = v === 'true' ? true : v === 'false' ? false : Number.isFinite(+v) ? +v : v;
  }
  return out;
}

function loadMission() {
  const file = flag('cfg', MISSION_DEFAULT);
  if (!fs.existsSync(file)) die(`mission introuvable : ${file} — crée-la (voir --help)`);
  return { file, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
}

// Le premier argument non-flag est le symbole (nom ou id).
function positional() {
  const out = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) { if (rest[i + 1] && !rest[i + 1].startsWith('--')) i++; continue; }
    if (rest[i] === '-p' || rest[i] === '-d' || rest[i] === '--param-set') { i++; continue; }
    out.push(rest[i]);
  }
  return out;
}

let SYMBOLS = null;
async function symbols() {
  if (!SYMBOLS) SYMBOLS = await (await fetch(`${BASE}/api/symbols`)).json();
  return SYMBOLS;
}

async function resolveSymbol(token) {
  const list = await symbols();
  if (token == null) die('symbole requis');
  const byId = list.find(s => String(s.id) === String(token));
  if (byId) return byId;
  const low = String(token).toLowerCase();
  const exact = list.find(s => s.name.toLowerCase() === low);
  if (exact) return exact;
  const partial = list.filter(s => s.name.toLowerCase().includes(low));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) die(`« ${token} » est ambigu : ${partial.map(s => s.name).join(', ')}`);
  die(`symbole inconnu : ${token}`);
}

// Contexte d'un symbole : mission + surcharges CLI, plus le découpage IS/OOS.
// Le découpage se fait sur les DATES des données réelles du symbole, pas sur une
// période commune : deux symboles n'ont ni la même profondeur ni la même fin.
async function context(token) {
  const m   = loadMission();
  const sym = await resolveSymbol(token ?? m.symbol);
  const per = (m.symbols ?? {})[sym.name] ?? (m.symbols ?? {})[String(sym.id)] ?? {};

  const tf     = flag('tf', per.tf ?? m.tf ?? '15m');
  const detect = { ...(m.detect ?? {}), ...(per.detect ?? {}), ...pairs('-d') };
  const exit   = { ...(m.exit ?? {}), ...(per.exit ?? {}), ...pairs('-p', '--param-set') };
  const spread = Number(flag('spread', per.spread ?? m.spread ?? 0));
  const fills  = flag('fills', per.fills ?? m.fills ?? 'bar');
  const minTrades = Number(flag('min-trades', m.minTrades ?? 30));

  const dataFrom = toEpoch(sym.ts_min.slice(0, 10));
  const dataTo   = Math.floor(Date.parse(sym.ts_max.replace(' ', 'T') + 'Z') / 1000);

  // Découpage chronologique : l'OOS est la partie RÉCENTE. Un OOS pris au milieu
  // rejouerait un régime déjà vu de part et d'autre.
  const split = Number(flag('split', m.split ?? 0.7));
  const cut   = per.split ? toEpoch(per.split) : Math.floor(dataFrom + (dataTo - dataFrom) * split);

  return {
    mission: m, sym, tf, detect, exit, spread, fills, minTrades,
    windows: {
      is:   { from: dataFrom, to: cut },
      oos:  { from: cut,      to: null },
      full: { from: dataFrom, to: null },
    },
  };
}

function pickWindow(ctx) {
  const w = flag('window', 'is');
  if (!ctx.windows[w]) die(`fenêtre inconnue : ${w} (is | oos | full)`);
  return { name: w, ...ctx.windows[w] };
}

function ledger(entry) {
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  fs.appendFileSync(LEDGER, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
}

/* ────────────────────────────── affichage ────────────────────────────── */

const ROW_H = `${padR('config', 34)}${padL('n', 5)}${padL('wr', 8)}${padL('exp', 9)}${padL('t', 7)}${padL('PF', 7)}${padL('DD', 9)}${padL('net', 10)}`;

function row(label, r) {
  return padR(label, 34) + padL(r.n, 5) + padL(pct(r.winrate), 8) +
    padL(fmt(r.expPts, 3), 9) + padL(fmt(r.tStat), 7) + padL(fmt(r.profitFactor), 7) +
    padL(fmt(-r.maxDD, 1), 9) + padL(fmt(r.netPts, 1), 10);
}

const comboLabel = p => Object.entries(p).map(([k, v]) => `${k}=${v}`).join(' ') || 'base';

// Le budget de liberté, tel que l'API l'a compté. Toujours affiché après un
// balayage : c'est le chiffre qu'on oublie de regarder quand la grille est belle.
function printFreedom(f) {
  if (!f) return;
  console.log(`\n  BUDGET DE LIBERTÉ  ${f.ok ? '✓' : '⚠'}  ${f.note}`);
  if (f.detectParams > 0) {
    console.log(`  (dont ${f.detectParams} de DÉTECTION : un seuil de motif se règle comme un TP,`);
    console.log(`   il consomme le même budget et doit passer le contrôle par décalage.)`);
  }
}

// Axe d'une grille : --param k (sortie) ou --detect k (détection).
function axis(nameParam, nameDetect, nameValues) {
  const p = flag(nameParam), d = flag(nameDetect);
  if (p && d) die(`--${nameParam} et --${nameDetect} sont exclusifs`);
  if (!p && !d) die(`--${nameParam} (sortie) ou --${nameDetect} (détection) requis`);
  const values = flag(nameValues) ?? die(`--${nameValues} requis (ex. 4:40:2 ou 4,8,12)`);
  return { key: p ?? d, values, kind: p ? 'exit' : 'detect' };
}

const gridsOf = (...axes) => ({
  grid:       Object.fromEntries(axes.filter(a => a.kind === 'exit').map(a => [a.key, a.values])),
  detectGrid: Object.fromEntries(axes.filter(a => a.kind === 'detect').map(a => [a.key, a.values])),
});

/* ────────────────────────────── commandes ────────────────────────────── */

const COMMANDS = {

async symbols() {
  const list = await symbols();
  console.log(`\n${padR('id', 5)}${padR('symbole', 34)}${padL('bougies M1', 12)}   plage`);
  for (const s of list) {
    console.log(padR(s.id, 5) + padR(s.name, 34) + padL(s.bar_count, 12) +
      `   ${s.ts_min.slice(0, 10)} → ${s.ts_max.slice(0, 10)}`);
  }
  console.log();
},

// Échelle de l'instrument. À lire AVANT de choisir la moindre grille en points.
async probe(token) {
  const ctx = await context(token);
  const w   = pickWindow(ctx);
  const p   = await post('probe', { symbolId: ctx.sym.id, tf: ctx.tf, detect: ctx.detect,
                                    from: w.from, to: w.to, slMarginPts: ctx.exit.slMarginPts });

  console.log(`\n${ctx.sym.name} · ${ctx.tf} · fenêtre ${w.name} (${dayISO(p.window.from)} → ${dayISO(p.window.to)}, ${p.window.days} j)`);
  console.log(`  détection : ${comboLabel(p.detect)}\n`);
  if (p.clamped?.length) console.log(`  ⚠ CLAMPED  ${p.clamped.join(', ')}\n`);
  console.log(`  bougies             ${p.candles}`);
  console.log(`  prix                ${fmt(p.price.first)} → ${fmt(p.price.last)}   (min ${fmt(p.price.min)} / max ${fmt(p.price.max)})`);
  console.log(`  buy & hold          ${fmt(p.buyHoldPts, 1)} pts   ← le repère à battre sur un instrument à dérive`);
  console.log(`  amplitude/bougie    médiane ${fmt(p.barRange.median, 2)}   p25 ${fmt(p.barRange.p25, 2)}  p75 ${fmt(p.barRange.p75, 2)}  p90 ${fmt(p.barRange.p90, 2)}`);
  if (p.spread) console.log(`  spread du broker    médiane ${fmt(p.spread.priceMedian, 3)} pts   p90 ${fmt(p.spread.priceP90, 3)}   ← à mettre dans --spread`);
  console.log(`\n  RISQUE STRUCTUREL (distance entrée → stop, marge ${ctx.exit.slMarginPts ?? 2} pts)`);
  console.log(`    n=${p.risk.n}  médiane ${fmt(p.risk.median, 2)}   p10 ${fmt(p.risk.p10, 2)}  p25 ${fmt(p.risk.p25, 2)}  p75 ${fmt(p.risk.p75, 2)}  p90 ${fmt(p.risk.p90, 2)}`);
  console.log(`    étendue ${fmt(p.risk.min, 2)} → ${fmt(p.risk.max, 2)}  (rapport ${fmt(p.risk.max / p.risk.min, 1)}×)`);
  const m = p.risk.median;
  if (m > 0) console.log(`\n  → grille de TP suggérée : ${fmt(m * 0.5, 1)} … ${fmt(m * 4, 1)} pts  (0,5× à 4× le risque médian)`);
  console.log(`\n  signaux             ${p.signals.count}  (${p.signals.perDay}/jour · ${p.signals.bull} haussiers / ${p.signals.bear} baissiers)`);
  console.log(`  budget de liberté   ${Math.floor(p.signals.count / 30)} paramètre(s) réglables — DÉTECTION COMPRISE (30 positions par paramètre)`);
  if (p.signals.count < 100) console.log(`  ⚠ moins de 100 signaux sur cette fenêtre — élargir la période, baisser le TF, ou assouplir la détection (atrMult1, bodyRatio1…)`);
  console.log();
},

// Un run détaillé — c'est « le rapport ». --first N le limite aux N premières
// positions prises (échantillon chronologique, pas un tirage).
async run(token) {
  const ctx = await context(token);
  const w   = pickWindow(ctx);
  const firstN = Number(flag('first', 0));

  const res = await post('run', {
    symbolId: ctx.sym.id, tf: ctx.tf, detect: ctx.detect, exit: ctx.exit,
    fills: ctx.fills, spreadPoints: ctx.spread,
    from: w.from, to: w.to, firstN, limit: 0,
  });
  const { meta, stats } = res;

  console.log(`\n${ctx.sym.name} · ${ctx.tf} · ${w.name} · fills=${meta.fills} · spread ${ctx.spread} pts`);
  console.log(`  détection : ${comboLabel(meta.detect)}`);
  console.log(`  sorties   : ${comboLabel(ctx.exit)}`);
  if (meta.clamped.length) console.log(`  ⚠ CLAMPED  ${meta.clamped.join(', ')}`);
  console.log(`  ${meta.signals} signaux · ${meta.positionsInWindow} positions dans la fenêtre` +
    (firstN ? ` · limité aux ${firstN} premières` : '') +
    (meta.skippedByCooldown ? ` · ${meta.skippedByCooldown} sautées par le cooldown (${meta.skippedWon} auraient gagné)` : ''));

  console.log(`\n  ${padR('', 22)}${padL('valeur', 12)}`);
  const line = (k, v, note = '') => console.log(`  ${padR(k, 22)}${padL(v, 12)}   ${note}`);
  line('positions résolues', stats.resolvedAll, `TP ${stats.tp} · SL ${stats.sl} · BE ${stats.be}` +
    (stats.timeout ? ` · timeout ${stats.timeout}` : '') + ` · ${stats.open} encore ouverte(s)`);
  line('winrate', pct(stats.winrate), `seuil de rentabilité réalisé ${pct(stats.beThresh)}` +
    (stats.winrate != null && stats.beThresh != null ? (stats.winrate >= stats.beThresh ? '  ✓ au-dessus' : '  ✗ en dessous') : ''));
  line('espérance', `${fmt(stats.expPts, 3)} pts`, 'par position résolue, spread déduit');
  line('t-stat', fmt(stats.tStat), '|t| ≳ 2 = espérance distinguable du bruit');
  line('facteur de profit', fmt(stats.profitFactor), `gain moyen ${fmt(stats.avgWin, 1)} / perte moyenne ${fmt(stats.avgLoss, 1)}`);
  line('points nets', fmt(stats.netPts, 1), `${stats.nWin} gagnantes · ${stats.nLoss} perdantes`);
  line('drawdown max', fmt(-stats.maxDD, 1), `${stats.maxLossStreak} pertes d'affilée au pire`);
  line('risque médian', fmt(stats.riskMed, 2), `étendue ${fmt(stats.riskMin, 1)} → ${fmt(stats.riskMax, 1)} · RR médian ${fmt(stats.rrMed)}`);
  line('durée médiane', `${fmt(stats.barsHeldMedian, 1)} b.`, `max ${stats.barsHeldMax} · ${stats.onEntryBar} résolues dans la bougie d'entrée (sans stop actif)`);
  line('retours sur entrée', fmt(stats.entryTouchesMean), `max ${stats.entryTouchesMax} · ${stats.neverReturned} sans retour`);
  line('sorties ambiguës', meta.ambiguousExits, 'stop ET TP dans la même bougie → le stop a été retenu');

  if (stats.beStudy.length) {
    console.log(`\n  ÉTUDE BREAK-EVEN (borne OPTIMISTE — gagnantes supposées intactes)`);
    console.log(`    ${padR('seuil', 12)}${padL('sauvées', 10)}${padL('%', 8)}${padL('espérance', 12)}`);
    console.log(`    ${padR('sans BE', 12)}${padL('—', 10)}${padL('—', 8)}${padL(fmt(stats.expWL, 3), 12)}`);
    for (const r of stats.beStudy) {
      console.log(`    ${padR(fmt(r.t, 1), 12)}${padL(`${r.saved}/${stats.sl}`, 10)}${padL(pct(r.pct), 8)}${padL(fmt(r.exp, 3), 12)}` +
        (r === stats.bestBe ? '  ←' : ''));
    }
  }
  if (stats.slStudy.length) {
    console.log(`\n  ÉTUDE SL PLAFONNÉ (borne PESSIMISTE — chaleur supposée venir avant le TP)`);
    console.log(`    ${padR('plafond', 12)}${padL('rognées', 10)}${padL('tuées', 8)}${padL('espérance', 12)}`);
    for (const r of stats.slStudy) {
      console.log(`    ${padR(fmt(r.d, 1), 12)}${padL(`${r.capped}/${stats.resolved}`, 10)}${padL(`${r.killed}/${stats.tp}`, 8)}${padL(fmt(r.exp, 3), 12)}` +
        (r === stats.bestSl ? '  ←' : ''));
    }
  }
  console.log(`\n  ⚠ les deux études sont des BORNES construites sur les excursions globales :`);
  console.log(`    l'ordre intra-vie est inconnu. Une piste qui en sort doit être rejouée ici,`);
  console.log(`    en simulation complète, avant d'y croire.\n`);

  ledger({ cmd: 'run', symbol: ctx.sym.name, tf: ctx.tf, window: w.name,
           detect: meta.detect, exit: ctx.exit, spread: ctx.spread, fills: ctx.fills,
           stats: { n: stats.resolvedAll, winrate: stats.winrate, expPts: stats.expPts,
                    tStat: stats.tStat, netPts: stats.netPts } });
},

// « Est-ce que 100 trades se passent bien ? » — la seule façon honnête de
// répondre est de regarder TOUS les blocs de 100 trades consécutifs de
// l'historique, pas un seul. Un réglage dont l'espérance est positive peut très
// bien perdre sur la moitié de ses blocs de 100 : c'est ça qu'on vit en trading,
// pas la moyenne sur 2 000 trades.
async blocks(token) {
  const ctx  = await context(token);
  const w    = pickWindow(ctx);
  const size = Number(flag('size', 100));

  const res = await post('run', {
    symbolId: ctx.sym.id, tf: ctx.tf, detect: ctx.detect, exit: ctx.exit,
    fills: ctx.fills, spreadPoints: ctx.spread, from: w.from, to: w.to, limit: 100000,
  });

  const RESOLVED = new Set(['tp', 'sl', 'be', 'timeout']);
  const pos = res.positions.filter(p => RESOLVED.has(p.status))
    .sort((a, b) => a.entryTime - b.entryTime);
  if (pos.length < size) die(`${pos.length} positions résolues, moins que la taille de bloc (${size})`);

  // Blocs DISJOINTS et consécutifs : deux blocs qui se recouvrent partagent des
  // trades, et le taux de blocs gagnants qu'on en tirerait serait gonflé par
  // cette dépendance.
  const blocks = [];
  for (let i = 0; i + size <= pos.length; i += size) {
    const b = pos.slice(i, i + size);
    const net = b.reduce((s, p) => s + (p.profitPoints ?? 0) - ctx.spread, 0);
    const tp  = b.filter(p => p.status === 'tp').length;
    let peak = 0, cum = 0, dd = 0;
    for (const p of b) { cum += (p.profitPoints ?? 0) - ctx.spread; peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum); }
    blocks.push({ from: b[0].entryTime, to: b[size - 1].entryTime, net, tp, dd });
  }

  const nets = blocks.map(b => b.net).sort((a, b) => a - b);
  const win  = blocks.filter(b => b.net > 0).length;
  const med  = nets.length % 2 ? nets[nets.length >> 1] : (nets[(nets.length >> 1) - 1] + nets[nets.length >> 1]) / 2;

  console.log(`\n${ctx.sym.name} · ${ctx.tf} · ${w.name} · blocs de ${size} trades consécutifs`);
  console.log(`  sorties : ${comboLabel(ctx.exit)} · spread ${ctx.spread}\n`);
  console.log(`  ${padR('bloc', 8)}${padR('période', 26)}${padL('TP', 5)}${padL('net', 11)}${padL('DD', 10)}`);
  blocks.forEach((b, i) => {
    console.log(`  ${padR(`#${i + 1}`, 8)}${padR(`${dayISO(b.from)} → ${dayISO(b.to)}`, 26)}` +
      `${padL(b.tp, 5)}${padL(fmt(b.net, 1), 11)}${padL(fmt(-b.dd, 1), 10)}` +
      (b.net > 0 ? '  ✓' : '  ✗'));
  });
  console.log(`\n  ${win}/${blocks.length} blocs gagnants (${pct(win / blocks.length)})`);
  console.log(`  net médian ${fmt(med, 1)} pts · pire ${fmt(nets[0], 1)} · meilleur ${fmt(nets[nets.length - 1], 1)}`);
  console.log(`\n  Un réglage qui ne gagne qu'un bloc sur deux a beau avoir une espérance`);
  console.log(`  positive : sur 100 trades, il joue à pile ou face.\n`);
},

// Balayage 1D — trie les paramètres INFLUENTS de ceux qui sont plats. Un
// paramètre plat se laisse au défaut : le régler n'ajoute que du surapprentissage.
// --param k pour une sortie, --detect k pour un seuil du motif.
async sweep(token) {
  const ctx = await context(token);
  const w   = pickWindow(ctx);
  if (w.name !== 'is') die(`sweep ne tourne que sur l'in-sample (--window is). Regarder l'OOS maintenant le brûle.`);

  const a = axis('param', 'detect', 'values');

  const res = await post('optimize', {
    symbolId: ctx.sym.id, tf: ctx.tf, detect: ctx.detect, base: ctx.exit,
    ...gridsOf(a), fills: ctx.fills, spreadPoints: ctx.spread,
    window: { from: w.from, to: w.to }, minTrades: ctx.minTrades,
  });

  console.log(`\n${ctx.sym.name} · ${ctx.tf} · IS · balayage ${a.kind === 'detect' ? 'DÉTECTION ' : ''}${a.key} = ${a.values}  (${res.meta.combos} configs, ${res.meta.ms} ms)`);
  console.log(`  détection : ${comboLabel(ctx.detect)}`);
  console.log(`  sorties   : ${comboLabel(ctx.exit)}\n`);
  console.log(`  ${ROW_H}${a.kind === 'detect' ? padL('signaux', 9) : ''}`);
  for (const r of res.allOrdered) {
    console.log(`  ${row(comboLabel(r.params), r)}${a.kind === 'detect' ? padL(r.signals, 9) : ''}` +
      `${r.thin ? '  ⚠ peu de trades' : ''}${r === res.best ? '  ← meilleur t' : ''}`);
  }
  printFreedom(res.freedom);
  console.log(`\n  Rappel : retenir un PLATEAU, pas un pic. Si le meilleur point est entouré`);
  console.log(`  de voisins médiocres, c'est du bruit — il ne survivra pas hors échantillon.`);
  if (a.kind === 'detect') {
    console.log(`  Et sur un seuil de DÉTECTION, la colonne « signaux » compte autant que le t :`);
    console.log(`  un seuil qui ne laisse passer que 40 motifs a l'air brillant parce qu'il est rare.`);
  }
  console.log();
  ledger({ cmd: 'sweep', symbol: ctx.sym.name, tf: ctx.tf, kind: a.kind, param: a.key,
           values: a.values, best: res.best, freedom: res.freedom });
},

// Grille 2D — uniquement sur les paramètres couplés (le TP et le seuil de BE en
// sont : le second n'a de sens qu'en fraction du premier ; atrMult1 et bodyRatio1
// aussi, ils décrivent la même bougie).
async grid(token) {
  const ctx = await context(token);
  const w   = pickWindow(ctx);
  if (w.name !== 'is') die(`grid ne tourne que sur l'in-sample (--window is).`);

  const a1 = axis('param',  'detect',  'values');
  const a2 = axis('param2', 'detect2', 'values2');
  const metric = flag('metric', 'tStat');

  const res = await post('optimize', {
    symbolId: ctx.sym.id, tf: ctx.tf, detect: ctx.detect, base: ctx.exit,
    ...gridsOf(a1, a2), fills: ctx.fills, spreadPoints: ctx.spread,
    window: { from: w.from, to: w.to }, minTrades: ctx.minTrades,
  });

  const xs = [...new Set(res.allOrdered.map(r => r.params[a1.key]))];
  const ys = [...new Set(res.allOrdered.map(r => r.params[a2.key]))];
  const cell = new Map(res.allOrdered.map(r => [`${r.params[a1.key]}|${r.params[a2.key]}`, r]));

  console.log(`\n${ctx.sym.name} · ${ctx.tf} · IS · grille ${a1.key} × ${a2.key} — ${metric}  (${res.meta.combos} configs, ${res.meta.ms} ms)`);
  console.log(`  détection : ${comboLabel(ctx.detect)}`);
  console.log(`  sorties   : ${comboLabel(ctx.exit)}\n`);
  console.log(`  ${padR(`${a2.key} \\ ${a1.key}`, 16)}${xs.map(x => padL(x, 9)).join('')}`);
  for (const y of ys) {
    let line = `  ${padR(y, 16)}`;
    for (const x of xs) {
      const r = cell.get(`${x}|${y}`);
      const v = r ? r[metric] : null;
      line += padL(r?.thin ? `(${fmt(v)})` : fmt(v), 9);
    }
    console.log(line);
  }
  console.log(`\n  (valeur) = moins de ${ctx.minTrades} positions, non concluant`);
  console.log(`\n  Meilleurs points :\n  ${ROW_H}`);
  for (const r of res.allOrdered.slice().sort((a, b) => (b.tStat ?? -9e9) - (a.tStat ?? -9e9)).slice(0, 8)) {
    console.log(`  ${row(comboLabel(r.params), r)}${r.thin ? '  ⚠' : ''}`);
  }
  printFreedom(res.freedom);
  console.log(`\n  RÈGLE DU PLATEAU : ne retenir un candidat que si ses voisins immédiats`);
  console.log(`  (±1 pas sur chaque axe) gardent une espérance positive et un t ≥ ~60 % du sien.\n`);
  ledger({ cmd: 'grid', symbol: ctx.sym.name, tf: ctx.tf, a1, a2, best: res.best, freedom: res.freedom });
},

// Contrôle par décalage circulaire — la question « est-ce le motif, ou est-ce
// d'avoir cherché ? ». Obligatoire avant de conclure quoi que ce soit.
async control(token) {
  const ctx = await context(token);
  const w   = pickWindow(ctx);
  const draws = Number(flag('draws', 60));

  const res = await post('null', {
    symbolId: ctx.sym.id, tf: ctx.tf, detect: ctx.detect, exit: ctx.exit,
    fills: ctx.fills, spreadPoints: ctx.spread, from: w.from, to: w.to, draws,
  });
  const v = res.verdict;

  console.log(`\n${ctx.sym.name} · ${ctx.tf} · ${w.name} · CONTRÔLE PAR DÉCALAGE (${res.meta.draws} tirages)`);
  console.log(`  détection : ${comboLabel(res.meta.detect)}`);
  console.log(`  sorties   : ${comboLabel(ctx.exit)}\n`);
  console.log(`  espérance réelle      ${fmt(v.realExpPts, 3)} pts   (n=${res.real.n}, t=${fmt(v.realTStat)})`);
  console.log(`  nuage de contrôle     médiane ${fmt(v.controlMedian, 3)}   moyenne ${fmt(v.controlMean, 3)}`);
  console.log(`                        p05 ${fmt(v.controlP05, 3)}  p95 ${fmt(v.controlP95, 3)}  étendue ${fmt(v.controlMin, 2)} → ${fmt(v.controlMax, 2)}`);
  console.log(`  p empirique (exp)     ${fmt(v.pValue, 3)}   ← le motif bat ${pct(v.betterThan)} des contrôles`);
  console.log(`  p empirique (t-stat)  ${fmt(v.tStatPValue, 3)}   t des contrôles : médiane ${fmt(v.tStatControlMedian)}  p95 ${fmt(v.tStatControlP95)}`);

  const pass = v.pValue != null && v.pValue <= 0.05;
  console.log(`\n  ${pass ? '✓' : '✖'} ${pass
    ? 'le réglage sort du nuage (p ≤ 0,05) — condition MINIMALE remplie, pas une preuve'
    : 'le réglage ne se distingue pas de ses contrôles : il mesure la géométrie du stop et du TP sur cet instrument, pas le motif KO'}`);
  console.log(`\n  Ce que le contrôle ne casse pas : la saisonnalité intra-journalière et`);
  console.log(`  l'autocorrélation de la volatilité. C'est délibéré.\n`);

  ledger({ cmd: 'control', symbol: ctx.sym.name, tf: ctx.tf, window: w.name,
           detect: res.meta.detect, exit: ctx.exit, verdict: v });
  return v;
},

// Batterie de robustesse. C'est ICI, et seulement ici, que l'OOS s'ouvre.
async validate(token) {
  const ctx = await context(token);
  const exit = ctx.exit;

  const call = (over = {}) => post('run', {
    symbolId: ctx.sym.id, tf: over.tf ?? ctx.tf,
    detect: { ...ctx.detect, ...(over.detect ?? {}) },
    exit: { ...exit, ...(over.exit ?? {}) },
    fills: over.fills ?? ctx.fills,
    spreadPoints: over.spread ?? ctx.spread,
    from: over.from, to: over.to, limit: 0,
  });

  console.log(`\n${ctx.sym.name} · ${ctx.tf} · VALIDATION`);
  console.log(`  détection : ${comboLabel(ctx.detect)}`);
  console.log(`  sorties   : ${comboLabel(exit)}`);
  console.log(`  IS  ${dayISO(ctx.windows.is.from)} → ${dayISO(ctx.windows.is.to)}`);
  console.log(`  OOS ${dayISO(ctx.windows.oos.from)} → fin des données\n`);

  const tests = [];
  const add = async (label, over) => {
    const r = await call(over);
    tests.push({ label, s: r.stats, meta: r.meta });
  };

  await add('in-sample',            { ...ctx.windows.is });
  await add('OUT-OF-SAMPLE',        { ...ctx.windows.oos });
  await add('période complète',     { ...ctx.windows.full });
  await add(`spread ×2 (${+(ctx.spread * 2).toFixed(4)})`, { ...ctx.windows.full, spread: ctx.spread * 2 });
  await add(`spread ×3 (${+(ctx.spread * 3).toFixed(4)})`, { ...ctx.windows.full, spread: ctx.spread * 3 });
  await add(`fills ${ctx.fills === 'm1' ? 'bougie' : 'M1'}`, { ...ctx.windows.full, fills: ctx.fills === 'm1' ? 'bar' : 'm1' });

  const TFS = ['1m', '3m', '5m', '15m', '30m', '1h'];
  const i = TFS.indexOf(ctx.tf);
  for (const t of [TFS[i - 1], TFS[i + 1]].filter(Boolean)) await add(`TF voisin ${t}`, { ...ctx.windows.full, tf: t });

  // Sur un instrument à dérive, un biais long imprime des points tout seul :
  // séparer les deux sens dit si la stratégie apporte quelque chose ou si elle
  // ne fait que suivre la pente.
  for (const d of ['bull', 'bear']) await add(`direction ${d}`, { ...ctx.windows.full, detect: { direction: d } });

  // Voisinage de DÉTECTION : un motif dont les seuils sont au bord d'une falaise
  // n'est pas un motif, c'est un filtre calé sur l'historique. On desserre et on
  // resserre le seuil principal d'un cran et on regarde si tout s'écroule.
  const m1 = Number(ctx.detect.atrMult1 ?? 1.3);
  for (const d of [-0.2, 0.2]) {
    const v = +(m1 + d).toFixed(2);
    if (v > 0) await add(`atrMult1 ${v}`, { ...ctx.windows.full, detect: { atrMult1: v } });
  }

  console.log(`  ${ROW_H}`);
  for (const t of tests) console.log(`  ${row(t.label, { ...t.s, n: t.s.resolvedAll })}`);

  // — Contrôle par décalage sur la période complète, systématique.
  const nullRes = await post('null', {
    symbolId: ctx.sym.id, tf: ctx.tf, detect: ctx.detect, exit,
    fills: ctx.fills, spreadPoints: ctx.spread, ...ctx.windows.full,
    draws: Number(flag('draws', 60)),
  });
  const v = nullRes.verdict;
  console.log(`\n  CONTRÔLE PAR DÉCALAGE (période complète, ${nullRes.meta.draws} tirages)`);
  console.log(`    réel ${fmt(v.realExpPts, 3)} pts  ·  nuage médiane ${fmt(v.controlMedian, 3)}  p95 ${fmt(v.controlP95, 3)}`);
  console.log(`    p empirique ${fmt(v.pValue, 3)} (exp) · ${fmt(v.tStatPValue, 3)} (t-stat)`);

  // — Diagnostic
  const get  = l => tests.find(t => t.label === l)?.s;
  const is   = get('in-sample'), oos = get('OUT-OF-SAMPLE');
  const x2   = get(`spread ×2 (${+(ctx.spread * 2).toFixed(4)})`);
  const full = get('période complète');
  const verdicts = [];

  if (!oos || oos.resolvedAll < ctx.minTrades)
    verdicts.push(`⚠ OOS trop maigre (${oos?.resolvedAll ?? 0} positions, plancher ${ctx.minTrades}) — non concluant, pas « validé »`);
  if (oos && oos.expPts <= 0)
    verdicts.push(`✖ espérance OOS ${fmt(oos.expPts, 3)} ≤ 0 — surapprentissage, ce réglage est mort`);
  if (is && oos && is.expPts > 0 && oos.expPts > 0 && oos.expPts < is.expPts * 0.5)
    verdicts.push(`⚠ dégradation IS→OOS de ${pct(1 - oos.expPts / is.expPts)} — edge fragile`);
  if (x2 && x2.expPts <= 0 && ctx.spread > 0)
    verdicts.push(`✖ l'edge meurt avec un spread doublé — aucune marge face aux coûts réels`);
  if (full && Math.abs(full.tStat ?? 0) < 2)
    verdicts.push(`⚠ |t| = ${fmt(full.tStat)} sur la période complète — non distinguable du bruit (viser ≥ 2)`);
  if (full && full.open > full.resolvedAll * 0.1)
    verdicts.push(`⚠ ${full.open} positions encore ouvertes en fin de données — un plafond de durée (maxBars) manque peut-être`);
  if (v.pValue == null || v.pValue > 0.05)
    verdicts.push(`✖ contrôle par décalage : p = ${fmt(v.pValue, 3)} — le réglage ne sort pas de son nuage, il ne mesure pas le motif`);
  // Falaise de détection : les deux voisins de atrMult1 doivent tenir debout.
  for (const d of [-0.2, 0.2]) {
    const s = get(`atrMult1 ${+(m1 + d).toFixed(2)}`);
    if (full && s && full.expPts > 0 && s.expPts <= 0)
      verdicts.push(`⚠ atrMult1 ${+(m1 + d).toFixed(2)} fait passer l'espérance à ${fmt(s.expPts, 3)} — le seuil du motif est au bord d'une falaise`);
  }

  console.log(`\n  DIAGNOSTIC`);
  if (!verdicts.length) console.log(`  ✓ aucun signal d'alarme sur cette batterie.`);
  for (const vd of verdicts) console.log(`  ${vd}`);
  console.log(`\n  Ce qui compte pour décider : les chiffres OUT-OF-SAMPLE et le contrôle par`);
  console.log(`  décalage. Pas ceux d'optimisation.\n`);

  ledger({ cmd: 'validate', symbol: ctx.sym.name, tf: ctx.tf, detect: ctx.detect, exit,
           spread: ctx.spread, nullCheck: v,
           is: is && { n: is.resolvedAll, expPts: is.expPts, tStat: is.tStat },
           oos: oos && { n: oos.resolvedAll, expPts: oos.expPts, tStat: oos.tStat }, verdicts });
},

// Enregistre le réglage en base — c'est le livrable, pas le tableau du terminal.
// `--status validated` exige le contrôle par décalage : il est lancé ici, et un
// p au-dessus de 0,05 fait refuser le statut. Ce n'est pas de la rigidité : sans
// lui, « validé » ne veut rien dire sur un motif dont les seuils ont été balayés.
async save(token) {
  const ctx = await context(token);
  const status = flag('status', 'draft');
  const name   = flag('name', 'base');

  const isR  = await post('run', { symbolId: ctx.sym.id, tf: ctx.tf, detect: ctx.detect, exit: ctx.exit,
    fills: ctx.fills, spreadPoints: ctx.spread, ...ctx.windows.is, limit: 0 });
  const oosR = await post('run', { symbolId: ctx.sym.id, tf: ctx.tf, detect: ctx.detect, exit: ctx.exit,
    fills: ctx.fills, spreadPoints: ctx.spread, ...ctx.windows.oos, limit: 0 });

  const nullRes = await post('null', { symbolId: ctx.sym.id, tf: ctx.tf, detect: ctx.detect, exit: ctx.exit,
    fills: ctx.fills, spreadPoints: ctx.spread, ...ctx.windows.full, draws: Number(flag('draws', 60)) });
  const v = nullRes.verdict;

  if (status === 'validated' && !(v.pValue <= 0.05) && !has('force')) {
    die(`contrôle par décalage : p = ${fmt(v.pValue, 3)} > 0,05 — refus d'enregistrer « validated ».\n` +
        `  → enregistrer en 'draft', ou --force si tu assumes de contredire le contrôle.`);
  }

  const brief = s => ({ n: s.resolvedAll, tp: s.tp, sl: s.sl, be: s.be, winrate: s.winrate,
    beThresh: s.beThresh, expPts: s.expPts, tStat: s.tStat, netPts: s.netPts,
    profitFactor: Number.isFinite(s.profitFactor) ? s.profitFactor : null, maxDD: s.maxDD, riskMed: s.riskMed });

  await post('configs', {
    symbolId: ctx.sym.id, tf: ctx.tf, name,
    detect: ctx.detect, exit: ctx.exit, fills: ctx.fills, spreadPoints: ctx.spread, status,
    notes: flag('notes', null),
    metrics: {
      is: brief(isR.stats), oos: brief(oosR.stats),
      isWindow: ctx.windows.is, oosWindow: ctx.windows.oos,
      combosTested: Number(flag('combos', 0)) || null,
      savedAt: new Date().toISOString(),
    },
    nullCheck: { window: 'full', draws: nullRes.meta.draws, ...v },
  });
  console.log(`\n✓ ${ctx.sym.name} · ${ctx.tf} · « ${name} » enregistré (${status})`);
  console.log(`  IS  n=${isR.stats.resolvedAll} exp=${fmt(isR.stats.expPts, 3)} t=${fmt(isR.stats.tStat)}`);
  console.log(`  OOS n=${oosR.stats.resolvedAll} exp=${fmt(oosR.stats.expPts, 3)} t=${fmt(oosR.stats.tStat)}`);
  console.log(`  contrôle par décalage : p=${fmt(v.pValue, 3)}\n`);
},

async configs() {
  const rows = await (await fetch(`${BASE}/api/ko/configs`)).json();
  if (!rows.length) return console.log('\nAucune configuration enregistrée.\n');
  console.log(`\n${padR('symbole', 28)}${padR('tf', 5)}${padR('nom', 18)}${padR('statut', 11)}${padL('n OOS', 7)}${padL('exp OOS', 10)}${padL('t OOS', 8)}${padL('p déc.', 9)}`);
  for (const c of rows) {
    const o = c.metrics?.oos;
    // Tronqué plutôt que débordant : une colonne qui pousse les suivantes rend
    // le tableau illisible dès qu'un nom de réglage est un peu long.
    const cut = (s, w) => String(s).length > w - 1 ? String(s).slice(0, w - 2) + '…' : s;
    console.log(padR(cut(c.symbol ?? c.symbolId, 28), 28) + padR(c.tf, 5) + padR(cut(c.name, 18), 18) + padR(c.status, 11) +
      padL(o?.n ?? '—', 7) + padL(fmt(o?.expPts, 3), 10) + padL(fmt(o?.tStat), 8) +
      padL(c.nullCheck ? fmt(c.nullCheck.pValue, 3) : '—', 9));
  }
  console.log();
},

help() {
  console.log(`
Optimiseur KO — motif de 2 bougies, sorties ET détection réglables.

  node scripts/ko-opt.mjs <commande> [symbole] [options]

  symbols                        symboles disponibles et plages de données
  probe    <sym>                 échelle de l'instrument + budget de liberté — EN PREMIER
  run      <sym> [--first N]     rapport détaillé (études BE et SL plafonné)
  blocks   <sym> [--size 100]    tous les blocs de N trades consécutifs
  sweep    <sym> --param tpPts   --values 4:40:2      (balayage d'une SORTIE)
  sweep    <sym> --detect atrMult1 --values 0.8:2:0.2 (balayage d'un seuil du MOTIF)
  grid     <sym> --param|--detect k --values … --param2|--detect2 k2 --values2 …
  control  <sym> [--draws 60]    contrôle par décalage circulaire — OBLIGATOIRE
  validate <sym>                 IS / OOS / coûts / TF / directions / voisinage du
                                 motif / contrôle par décalage → diagnostic
  save     <sym> [--status validated] [--name base] [--notes "…"] [--force]
  configs                        réglages enregistrés en base

  --cfg <fichier>       mission (défaut ${MISSION_DEFAULT})
  --window is|oos|full  fenêtre (défaut is ; sweep et grid n'acceptent que is)
  --tf, --spread, --fills bar|m1, --split 0.7, --min-trades 30, --draws 60
  -p cle=valeur         surcharge une SORTIE   (répétable)
  -d cle=valeur         surcharge la DÉTECTION (répétable)

Le motif : B1 pleine (corps ≥ atrMult1 × ATR, corps/amplitude ≥ bodyRatio1)
entièrement du côté opposé à son sens par rapport aux DEUX MM ; B2 indécise
(corps ≤ atrMult2 × ATR, corps/amplitude ≤ bodyRatio2), sens indifférent. Entrée
à l'ouverture de la 3e bougie, stop structurel sous/sur l'extrême B2-B3.

Mission (JSON) :
{
  "tf": "5m", "split": 0.7, "minTrades": 100, "fills": "bar",
  "detect": { "maPeriodFast": 15, "maPeriodSlow": 200, "atrPeriod": 14,
              "atrMult1": 1.3, "bodyRatio1": 0.9, "atrMult2": 0.3, "bodyRatio2": 0.3 },
  "symbols": {
    "XAUUSD":              { "spread": 0.3, "exit": { "slMarginPts": 0.5, "tpPts": 8 } },
    "Volatility 75 Index": { "spread": 12,  "exit": { "slMarginPts": 5, "tpPts": 200 } }
  }
}
`);
},
};

const fn = COMMANDS[cmd] ?? (cmd == null || cmd === '--help' ? COMMANDS.help : null);
if (!fn) die(`commande inconnue : ${cmd}\n  → node scripts/ko-opt.mjs --help`);
await fn(positional()[0]);
