#!/usr/bin/env node
// Runner CLI de l'optimiseur rFVG. Pilote /api/rfvg/* (serveur dev requis,
// port 3000 — sinon GRAPHER_URL).
//
//   node scripts/rfvg-opt.mjs <commande> [options]
//
// La mission vit dans un fichier JSON (défaut backtests/rfvg-mission.json) :
// timeframe, réglages de DÉTECTION (communs, figés), et par symbole le spread et
// les sorties de départ. Les flags de la ligne de commande l'écrasent.
//
// DISCIPLINE OUT-OF-SAMPLE — `sweep` et `grid` REFUSENT de tourner ailleurs que
// sur l'in-sample. Ce n'est pas une gêne, c'est le cœur de la méthode : chaque
// coup d'œil à l'OOS avant d'avoir figé les paramètres le consomme, et il n'y en
// a pas de second. `validate` est la seule commande qui l'ouvre, une fois.

import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.GRAPHER_URL || 'http://localhost:3000';
const MISSION_DEFAULT = 'backtests/rfvg-mission.json';
const LEDGER = 'backtests/rfvg-ledger.jsonl';

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
  const r = await fetch(`${BASE}/api/rfvg/${route}`, {
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

// -p cle=valeur, répétable
function overrides() {
  const out = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] !== '-p' && rest[i] !== '--param-set') continue;
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
    if (rest[i] === '-p' || rest[i] === '--param-set') { i++; continue; }
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
  const detect = { ...(m.detect ?? {}), ...(per.detect ?? {}) };
  const exit   = { ...(m.exit ?? {}), ...(per.exit ?? {}), ...overrides() };
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

  console.log(`\n${ctx.sym.name} · ${ctx.tf} · fenêtre ${w.name} (${dayISO(p.window.from)} → ${dayISO(p.window.to)}, ${p.window.days} j)\n`);
  console.log(`  bougies             ${p.candles}`);
  console.log(`  prix                ${fmt(p.price.first)} → ${fmt(p.price.last)}   (min ${fmt(p.price.min)} / max ${fmt(p.price.max)})`);
  console.log(`  buy & hold          ${fmt(p.buyHoldPts, 1)} pts   ← le repère à battre sur un instrument à dérive`);
  console.log(`  amplitude/bougie    médiane ${fmt(p.barRange.median, 2)}   p25 ${fmt(p.barRange.p25, 2)}  p75 ${fmt(p.barRange.p75, 2)}  p90 ${fmt(p.barRange.p90, 2)}`);
  console.log(`\n  RISQUE STRUCTUREL (distance entrée → stop, marge ${ctx.exit.slMarginPts ?? 2} pts)`);
  console.log(`    n=${p.risk.n}  médiane ${fmt(p.risk.median, 2)}   p10 ${fmt(p.risk.p10, 2)}  p25 ${fmt(p.risk.p25, 2)}  p75 ${fmt(p.risk.p75, 2)}  p90 ${fmt(p.risk.p90, 2)}`);
  console.log(`    étendue ${fmt(p.risk.min, 2)} → ${fmt(p.risk.max, 2)}  (rapport ${fmt(p.risk.max / p.risk.min, 1)}×)`);
  const m = p.risk.median;
  if (m > 0) console.log(`\n  → grille de TP suggérée : ${fmt(m * 0.5, 1)} … ${fmt(m * 4, 1)} pts  (0,5× à 4× le risque médian)`);
  console.log(`\n  signaux             ${p.signals.zones}  (${p.signals.perDay}/jour · ${p.signals.bull} haussiers / ${p.signals.bear} baissiers)`);
  if (p.signals.zones < 100) console.log(`  ⚠ moins de 100 signaux sur cette fenêtre — élargir la période, baisser le TF, ou assouplir la détection`);
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
  console.log(`  sorties : ${comboLabel(ctx.exit)}`);
  if (meta.clamped.length) console.log(`  ⚠ CLAMPED  ${meta.clamped.join(', ')}`);
  console.log(`  ${meta.zones} zones · ${meta.positionsInWindow} positions dans la fenêtre` +
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
  line('durée médiane', `${fmt(stats.barsHeldMedian, 1)} b.`, `max ${stats.barsHeldMax} · ${stats.onEntryBar} résolues dans B4 (sans stop actif)`);
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
           exit: ctx.exit, spread: ctx.spread, fills: ctx.fills, stats: { n: stats.resolvedAll,
           winrate: stats.winrate, expPts: stats.expPts, tStat: stats.tStat, netPts: stats.netPts } });
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
async sweep(token) {
  const ctx = await context(token);
  const w   = pickWindow(ctx);
  if (w.name !== 'is') die(`sweep ne tourne que sur l'in-sample (--window is). Regarder l'OOS maintenant le brûle.`);

  const param  = flag('param') ?? die('--param requis');
  const values = flag('values') ?? die('--values requis (ex. 4:40:2 ou 4,8,12)');

  const res = await post('optimize', {
    symbolId: ctx.sym.id, tf: ctx.tf, detect: ctx.detect, base: ctx.exit,
    grid: { [param]: values }, fills: ctx.fills, spreadPoints: ctx.spread,
    window: { from: w.from, to: w.to }, minTrades: ctx.minTrades,
  });

  console.log(`\n${ctx.sym.name} · ${ctx.tf} · IS · balayage ${param} = ${values}  (${res.meta.combos} configs, ${res.meta.ms} ms)`);
  console.log(`  base : ${comboLabel(ctx.exit)}\n`);
  console.log(`  ${ROW_H}`);
  for (const r of res.allOrdered) {
    console.log(`  ${row(comboLabel(r.params), r)}${r.thin ? '  ⚠ peu de trades' : ''}${r === res.best ? '  ← meilleur t' : ''}`);
  }
  console.log(`\n  Rappel : retenir un PLATEAU, pas un pic. Si le meilleur point est entouré`);
  console.log(`  de voisins médiocres, c'est du bruit — il ne survivra pas hors échantillon.\n`);
  ledger({ cmd: 'sweep', symbol: ctx.sym.name, tf: ctx.tf, param, values, best: res.best });
},

// Grille 2D — uniquement sur les paramètres couplés (le TP et le seuil de BE en
// sont : le second n'a de sens qu'en fraction du premier).
async grid(token) {
  const ctx = await context(token);
  const w   = pickWindow(ctx);
  if (w.name !== 'is') die(`grid ne tourne que sur l'in-sample (--window is).`);

  const p1 = flag('param')  ?? die('--param requis');
  const v1 = flag('values') ?? die('--values requis');
  const p2 = flag('param2') ?? die('--param2 requis');
  const v2 = flag('values2') ?? die('--values2 requis');
  const metric = flag('metric', 'tStat');

  const res = await post('optimize', {
    symbolId: ctx.sym.id, tf: ctx.tf, detect: ctx.detect, base: ctx.exit,
    grid: { [p1]: v1, [p2]: v2 }, fills: ctx.fills, spreadPoints: ctx.spread,
    window: { from: w.from, to: w.to }, minTrades: ctx.minTrades,
  });

  const xs = [...new Set(res.allOrdered.map(r => r.params[p1]))];
  const ys = [...new Set(res.allOrdered.map(r => r.params[p2]))];
  const cell = new Map(res.allOrdered.map(r => [`${r.params[p1]}|${r.params[p2]}`, r]));

  console.log(`\n${ctx.sym.name} · ${ctx.tf} · IS · grille ${p1} × ${p2} — ${metric}  (${res.meta.combos} configs, ${res.meta.ms} ms)`);
  console.log(`  base : ${comboLabel(ctx.exit)}\n`);
  console.log(`  ${padR(`${p2} \\ ${p1}`, 14)}${xs.map(x => padL(x, 9)).join('')}`);
  for (const y of ys) {
    let line = `  ${padR(y, 14)}`;
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
  console.log(`\n  RÈGLE DU PLATEAU : ne retenir un candidat que si ses voisins immédiats`);
  console.log(`  (±1 pas sur chaque axe) gardent une espérance positive et un t ≥ ~60 % du sien.\n`);
  ledger({ cmd: 'grid', symbol: ctx.sym.name, tf: ctx.tf, p1, v1, p2, v2, best: res.best });
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
  console.log(`  sorties : ${comboLabel(exit)}`);
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

  console.log(`  ${ROW_H}`);
  for (const t of tests) console.log(`  ${row(t.label, { ...t.s, n: t.s.resolvedAll })}`);

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

  console.log(`\n  DIAGNOSTIC`);
  if (!verdicts.length) console.log(`  ✓ aucun signal d'alarme sur cette batterie.`);
  for (const v of verdicts) console.log(`  ${v}`);
  console.log(`\n  Ce qui compte pour décider, ce sont les chiffres OUT-OF-SAMPLE, pas ceux d'optimisation.\n`);

  ledger({ cmd: 'validate', symbol: ctx.sym.name, tf: ctx.tf, exit, spread: ctx.spread,
           is: is && { n: is.resolvedAll, expPts: is.expPts, tStat: is.tStat },
           oos: oos && { n: oos.resolvedAll, expPts: oos.expPts, tStat: oos.tStat }, verdicts });
},

// Enregistre le réglage en base — c'est le livrable, pas le tableau du terminal.
async save(token) {
  const ctx = await context(token);
  const status = flag('status', 'draft');
  const name   = flag('name', 'base');

  const isR  = await post('run', { symbolId: ctx.sym.id, tf: ctx.tf, detect: ctx.detect, exit: ctx.exit,
    fills: ctx.fills, spreadPoints: ctx.spread, ...ctx.windows.is, limit: 0 });
  const oosR = await post('run', { symbolId: ctx.sym.id, tf: ctx.tf, detect: ctx.detect, exit: ctx.exit,
    fills: ctx.fills, spreadPoints: ctx.spread, ...ctx.windows.oos, limit: 0 });

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
  });
  console.log(`\n✓ ${ctx.sym.name} · ${ctx.tf} · « ${name} » enregistré (${status})`);
  console.log(`  IS  n=${isR.stats.resolvedAll} exp=${fmt(isR.stats.expPts, 3)} t=${fmt(isR.stats.tStat)}`);
  console.log(`  OOS n=${oosR.stats.resolvedAll} exp=${fmt(oosR.stats.expPts, 3)} t=${fmt(oosR.stats.tStat)}\n`);
},

async configs() {
  const rows = await (await fetch(`${BASE}/api/rfvg/configs`)).json();
  if (!rows.length) return console.log('\nAucune configuration enregistrée.\n');
  console.log(`\n${padR('symbole', 28)}${padR('tf', 5)}${padR('nom', 20)}${padR('statut', 11)}${padL('n OOS', 7)}${padL('exp OOS', 10)}${padL('t OOS', 8)}`);
  for (const c of rows) {
    const o = c.metrics?.oos;
    // Tronqué plutôt que débordant : une colonne qui pousse les suivantes rend
    // le tableau illisible dès qu'un nom de réglage est un peu long.
    const cut = (s, w) => String(s).length > w - 1 ? String(s).slice(0, w - 2) + '…' : s;
    console.log(padR(cut(c.symbol ?? c.symbolId, 28), 28) + padR(c.tf, 5) + padR(cut(c.name, 20), 20) + padR(c.status, 11) +
      padL(o?.n ?? '—', 7) + padL(fmt(o?.expPts, 3), 10) + padL(fmt(o?.tStat), 8));
  }
  console.log();
},

help() {
  console.log(`
Optimiseur rFVG — SL / TP / break-even, par symbole.

  node scripts/rfvg-opt.mjs <commande> [symbole] [options]

  symbols                        symboles disponibles et plages de données
  probe    <sym>                 échelle de l'instrument — À LIRE EN PREMIER
  run      <sym> [--first N]     rapport détaillé (études BE et SL plafonné)
  sweep    <sym> --param k --values 4:40:2
  grid     <sym> --param k --values … --param2 k2 --values2 …
  validate <sym>                 IS / OOS / coûts / TF voisins / fills → diagnostic
  save     <sym> [--status validated] [--name base] [--notes "…"]
  configs                        réglages enregistrés en base

  --cfg <fichier>       mission (défaut ${MISSION_DEFAULT})
  --window is|oos|full  fenêtre (défaut is ; sweep et grid n'acceptent que is)
  --tf, --spread, --fills bar|m1, --split 0.7, --min-trades 30
  -p cle=valeur         surcharge un paramètre de sortie (répétable)

Mission (JSON) :
{
  "tf": "5m", "split": 0.7, "minTrades": 100, "fills": "bar",
  "detect": { "mode": "rfvg", "maPeriodFast": 15, "maPeriodSlow": 200, "atrMult": 1.5 },
  "symbols": {
    "XAUUSD":              { "spread": 0.3, "exit": { "slMarginPts": 0.5, "tpPts": 8 } },
    "Volatility 75 Index": { "spread": 12,  "exit": { "slMarginPts": 5, "tpPts": 200 } }
  }
}
`);
},
};

const fn = COMMANDS[cmd] ?? (cmd == null || cmd === '--help' ? COMMANDS.help : null);
if (!fn) die(`commande inconnue : ${cmd}\n  → node scripts/rfvg-opt.mjs --help`);
await fn(positional()[0]);
