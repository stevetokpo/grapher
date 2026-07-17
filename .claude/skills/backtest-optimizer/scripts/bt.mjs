#!/usr/bin/env node
// Runner CLI du skill backtest-optimizer.
// Pilote POST /api/backtest (serveur dev Next), recalcule les métriques
// localement à partir des trades (pour pouvoir filtrer la fenêtre de warm-up),
// et journalise chaque run dans un ledger JSONL comparable.
//
// Toutes les commandes acceptent --cfg <fichier.json> (contexte de la mission)
// ; les flags CLI écrasent le contexte.
//
//   node .claude/skills/backtest-optimizer/scripts/bt.mjs <commande> [options]
//
// Commandes : symbols | strategies | probe | run | sweep | grid | validate | top
// (voir usage() en bas de fichier)

import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.GRAPHER_URL || 'http://localhost:3000';
const LEDGER_DEFAULT = 'backtests/ledger.jsonl';

/* ─────────────────────────── utilitaires ─────────────────────────── */

const num = (v) => (v == null || v === '' ? null : Number(v));
const fmt = (v, d = 2) =>
  v == null || Number.isNaN(v) ? '—' : Number.isFinite(v) ? v.toFixed(d) : '∞';
const pad = (s, w, right = true) =>
  right ? String(s).padEnd(w) : String(s).padStart(w);

// 'YYYY-MM-DD' | 'YYYY-MM-DDTHH:MM' | epoch secondes → epoch secondes (UTC)
function toEpoch(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  const iso = v.length === 10 ? `${v}T00:00:00Z` : `${v}Z`.replace(/Z+$/, 'Z');
  const t = Date.parse(iso);
  if (Number.isNaN(t)) die(`date illisible : ${v} (attendu YYYY-MM-DD ou epoch)`);
  return Math.floor(t / 1000);
}
const toISO = (e) => new Date(e * 1000).toISOString().slice(0, 16).replace('T', ' ');

function die(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

// Les balayages enchaînent des centaines de POST. Le serveur dev ferme les
// sockets inactives avant le client, qui en réutilise parfois une morte : le
// corps arrive tronqué et Next répond 500 « Unexpected end of JSON input ».
// Ce n'est pas une erreur de backtest — on rejoue, sur une connexion neuve.
async function api(pathname, init, attempt = 0) {
  let res;
  try {
    res = await fetch(`${BASE}${pathname}`, init);
  } catch (err) {
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
      return api(pathname, init, attempt + 1);
    }
    die(
      `serveur injoignable sur ${BASE} (${err.message}).\n` +
        `  Démarre-le dans un autre terminal :  npm run dev\n` +
        `  (ou export GRAPHER_URL=http://localhost:PORT)`,
    );
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status >= 500 && attempt < 3) {
      await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
      return api(pathname, init, attempt + 1);
    }
    die(`${pathname} → HTTP ${res.status} : ${body.error ?? 'erreur inconnue'}`);
  }
  return body;
}

/* ────────────────────── parsing des arguments ────────────────────── */

// --flag valeur | --flag=valeur | --bool | -p cle=valeur (répétable)
function parseArgs(argv) {
  const out = { _: [], params: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-p' || a === '--param-kv') {
      const [k, ...rest] = String(argv[++i]).split('=');
      out.params[k] = coerce(rest.join('='));
    } else if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = (eq === -1 ? a.slice(2) : a.slice(2, eq)).replace(/-([a-z])/g, (_, c) =>
        c.toUpperCase(),
      );
      const next = eq === -1 ? argv[i + 1] : a.slice(eq + 1);
      if (eq === -1 && (next == null || next.startsWith('--'))) out[key] = true;
      else {
        out[key] = eq === -1 ? argv[++i] : next;
      }
    } else out._.push(a);
  }
  return out;
}

const coerce = (v) => {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v !== '' && !Number.isNaN(Number(v))) return Number(v);
  return v;
};

// '10,20,30' | '20:100:20' (min:max:pas) → tableau de valeurs
function parseValues(spec) {
  const s = String(spec);
  if (s.includes(':')) {
    const [min, max, step] = s.split(':').map(Number);
    if (![min, max, step].every(Number.isFinite) || step <= 0)
      die(`--values "${s}" invalide (attendu min:max:pas)`);
    const out = [];
    // arrondi pour éviter les 0.30000000000000004
    const dec = (String(step).split('.')[1] ?? '').length;
    for (let v = min; v <= max + 1e-9; v += step) out.push(Number(v.toFixed(dec)));
    return out;
  }
  return s.split(',').map((x) => coerce(x.trim()));
}

/* ─────────────────── contexte de mission (--cfg) ──────────────────── */
// { symbol, tf, strategy, spread, maxBars, warmupDays, params,
//   is: {from,to}, oos: {from,to}, full: {from,to}, ledger, minTrades }

function loadCfg(args) {
  let cfg = {};
  if (args.cfg) {
    if (!fs.existsSync(args.cfg)) die(`--cfg introuvable : ${args.cfg}`);
    cfg = JSON.parse(fs.readFileSync(args.cfg, 'utf8'));
  }
  // les flags CLI écrasent le fichier
  for (const k of ['symbol', 'tf', 'strategy', 'ledger']) if (args[k] != null) cfg[k] = args[k];
  for (const k of ['spread', 'maxBars', 'warmupDays', 'minTrades'])
    if (args[k] != null) cfg[k] = num(args[k]);

  cfg.spread ??= 0;
  cfg.maxBars ??= 0;
  cfg.warmupDays ??= 0;
  cfg.minTrades ??= 30;
  cfg.ledger ??= LEDGER_DEFAULT;
  cfg.params = { ...(cfg.params ?? {}), ...(args.params ?? {}) };
  if (args.paramsJson) Object.assign(cfg.params, JSON.parse(args.paramsJson));

  // fenêtre d'évaluation : --window is|oos|full, ou --from/--to explicites
  const win = args.window ?? 'is';
  let from = args.from != null ? toEpoch(args.from) : null;
  let to = args.to != null ? toEpoch(args.to) : null;
  if (from == null || to == null) {
    const w = cfg[win];
    if (!w) die(`fenêtre "${win}" absente du --cfg (et pas de --from/--to)`);
    from ??= toEpoch(w.from);
    to ??= toEpoch(w.to);
  }
  cfg.window = win;
  cfg.from = from;
  cfg.to = to;
  return cfg;
}

/* ───────────────── résolution symbole / stratégie ────────────────── */

let _symbols = null;
async function symbols() {
  _symbols ??= await api('/api/symbols');
  return _symbols;
}

async function resolveSymbol(ref) {
  if (ref == null) die('symbole manquant (--symbol <id|nom> ou "symbol" dans le --cfg)');
  const list = await symbols();
  if (/^\d+$/.test(String(ref))) {
    const s = list.find((x) => x.id === parseInt(ref, 10));
    return s ?? die(`symbole id=${ref} inconnu`);
  }
  const q = String(ref).toLowerCase();
  const hits = list.filter((x) => x.name.toLowerCase().includes(q));
  if (hits.length === 0) die(`aucun symbole ne correspond à "${ref}"`);
  if (hits.length > 1)
    die(`"${ref}" est ambigu : ${hits.map((h) => `${h.name} (id ${h.id})`).join(', ')}`);
  return hits[0];
}

async function resolveStrategy(id) {
  const list = await api('/api/backtest');
  const s = list.find((x) => x.id === id);
  if (!s) die(`stratégie inconnue : ${id}\n  disponibles : ${list.map((x) => x.id).join(', ')}`);
  return s;
}

/* ───────────────────── métriques (locales) ───────────────────────── */
// Recalculées depuis `trades` pour pouvoir exclure la fenêtre de warm-up.
// Définitions : cf. references/engine-contract.md

function metrics(trades, minTrades) {
  const n = trades.length;
  const base = {
    n,
    winrate: null,
    totalPoints: 0,
    totalR: null,
    avgR: null,
    stdR: null,
    tStat: null,
    profitFactor: null,
    maxDDR: null,
    calmar: null,
    bestMonthShare: null,
    exitReasons: {},
    noSL: false,
    score: null,
  };
  if (n === 0) return base;

  const wins = trades.filter((t) => t.result === 'win');
  const losses = trades.filter((t) => t.result === 'loss');
  const grossWin = wins.reduce((s, t) => s + t.profitPoints, 0);
  const grossLoss = -losses.reduce((s, t) => s + t.profitPoints, 0);

  base.winrate = (wins.length / n) * 100;
  base.totalPoints = trades.reduce((s, t) => s + t.profitPoints, 0);
  base.profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null;
  for (const t of trades) base.exitReasons[t.exitReason] = (base.exitReasons[t.exitReason] ?? 0) + 1;

  const rT = trades.filter((t) => t.profitR != null);
  base.noSL = rT.length === 0;
  if (rT.length > 0) {
    base.totalR = rT.reduce((s, t) => s + t.profitR, 0);
    base.avgR = base.totalR / rT.length;
    if (rT.length > 1) {
      const v = rT.reduce((s, t) => s + (t.profitR - base.avgR) ** 2, 0) / (rT.length - 1);
      base.stdR = Math.sqrt(v);
    }
    // drawdown sur la courbe d'équité en R (trades triés par sortie)
    let cum = 0,
      peak = 0,
      dd = 0;
    for (const t of [...rT].sort((a, b) => a.exitTime - b.exitTime)) {
      cum += t.profitR;
      if (cum > peak) peak = cum;
      if (peak - cum > dd) dd = peak - cum;
    }
    base.maxDDR = dd;
    base.calmar = dd > 0 ? base.totalR / dd : base.totalR > 0 ? Infinity : null;

    // concentration : part du R total apportée par le meilleur mois
    const byMonth = new Map();
    for (const t of rT) {
      const k = new Date(t.exitTime * 1000).toISOString().slice(0, 7);
      byMonth.set(k, (byMonth.get(k) ?? 0) + t.profitR);
    }
    if (base.totalR > 0) base.bestMonthShare = Math.max(...byMonth.values()) / base.totalR;
    base.months = [...byMonth.entries()].sort().map(([k, r]) => ({ month: k, r }));
  }

  // score = t-statistique de l'espérance : avgR / stdR × √n
  // (mesure la confiance que l'edge est réel COMPTE TENU de la taille
  //  d'échantillon — un avgR flatteur sur 12 trades ne monte pas au classement)
  if (n >= minTrades && base.avgR != null && base.stdR > 0)
    base.score = (base.avgR / base.stdR) * Math.sqrt(rT.length);

  return base;
}

/* ────────────────────────── exécution d'un run ─────────────────────── */

async function execRun(cfg, params, over = {}) {
  const sym = await resolveSymbol(over.symbol ?? cfg.symbol);
  const from = over.from ?? cfg.from;
  const to = over.to ?? cfg.to;
  const tf = over.tf ?? cfg.tf ?? '15m';
  const spread = over.spread ?? cfg.spread;
  const warmupDays = over.warmupDays ?? cfg.warmupDays;

  // Le warm-up charge des bougies AVANT la fenêtre d'évaluation (les
  // indicateurs démarrent au 1er bar chargé) ; les trades entrés pendant le
  // warm-up sont ensuite exclus des métriques.
  const dataFrom = from - Math.round(warmupDays * 86400);

  const body = {
    symbolId: sym.id,
    from: dataFrom,
    to,
    tf,
    strategyId: over.strategy ?? cfg.strategy,
    params,
    execution: { spreadPoints: spread, maxBarsInTrade: over.maxBars ?? cfg.maxBars },
  };

  const res = await api('/api/backtest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const warn = [];
  if (res.meta.capped)
    warn.push('CAPPED: plage tronquée à 500k bougies M1 — la fin de la fenêtre est absente');
  if (res.tradesCapped) warn.push('TRADES_CAPPED: >5000 trades, métriques locales partielles');
  // clamp silencieux : l'API remplace toute valeur hors bornes par le défaut
  for (const [k, v] of Object.entries(params)) {
    const got = res.meta.params[k];
    if (got !== undefined && got !== v && !(typeof v === 'number' && Math.abs(got - v) < 1e-9))
      warn.push(`CLAMPED: ${k}=${JSON.stringify(v)} → ${JSON.stringify(got)} (hors bornes)`);
  }

  const kept = res.trades.filter((t) => t.entryTime >= from);
  const m = metrics(kept, cfg.minTrades);

  return {
    ts: new Date().toISOString(),
    symbol: sym.name,
    symbolId: sym.id,
    strategy: body.strategyId,
    tf,
    window: over.label ?? cfg.window,
    from,
    to,
    warmupDays,
    spread,
    maxBars: body.execution.maxBarsInTrade,
    params: res.meta.params, // params RÉELLEMENT appliqués (post-clamp)
    metrics: m,
    warn,
    elapsedMs: res.meta.elapsedMs,
    tfBars: res.meta.tfBarCount,
  };
}

function appendLedger(cfg, run, tag) {
  const file = cfg.ledger;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ ...run, tag: tag ?? null }) + '\n');
}

/* ─────────────────────────── affichage ────────────────────────────── */

const COLS = [
  ['n', 5, (m) => m.n],
  ['win%', 6, (m) => fmt(m.winrate, 1)],
  ['avgR', 7, (m) => (m.avgR == null ? '—' : (m.avgR >= 0 ? '+' : '') + fmt(m.avgR, 3))],
  ['totR', 8, (m) => fmt(m.totalR, 1)],
  ['PF', 6, (m) => fmt(m.profitFactor, 2)],
  ['maxDD', 7, (m) => fmt(m.maxDDR, 1)],
  ['calmar', 7, (m) => fmt(m.calmar, 2)],
  ['tStat', 7, (m) => fmt(m.score ?? (m.stdR > 0 ? (m.avgR / m.stdR) * Math.sqrt(m.n) : null), 2)],
];

const header = (label, w) =>
  pad(label, w) + COLS.map(([h, cw]) => pad(h, cw, false)).join(' ');
const row = (label, w, m) =>
  pad(label, w) + COLS.map(([, cw, f]) => pad(f(m), cw, false)).join(' ');

function printWarns(run, prefix = '  ') {
  for (const w of run.warn) console.log(`${prefix}⚠  ${w}`);
  if (run.metrics.noSL && run.metrics.n > 0)
    console.log(`${prefix}⚠  NO_SL: aucun trade n'a de stop → toutes les stats en R sont muettes`);
}

function printRunDetail(run) {
  const m = run.metrics;
  console.log(
    `\n${run.strategy} · ${run.symbol} · ${run.tf} · ${toISO(run.from)} → ${toISO(run.to)}` +
      ` · spread ${run.spread} · [${run.window}]`,
  );
  console.log(`params: ${JSON.stringify(run.params)}`);
  console.log('');
  console.log(header('', 0));
  console.log(row('', 0, m));
  console.log('');
  console.log(
    `sorties: ${Object.entries(m.exitReasons)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ')}  ·  best-month share: ${m.bestMonthShare == null ? '—' : (m.bestMonthShare * 100).toFixed(0) + '%'}` +
      `  ·  ${run.tfBars} bougies ${run.tf}  ·  ${run.elapsedMs}ms`,
  );
  if (m.months?.length)
    console.log(
      `mensuel (R): ${m.months.map((x) => `${x.month.slice(5)}:${x.r >= 0 ? '+' : ''}${x.r.toFixed(1)}`).join('  ')}`,
    );
  printWarns(run, '');
  if (m.score == null && m.n > 0 && m.n < (run.minTrades ?? 30))
    console.log(`⚠  ÉCHANTILLON INSUFFISANT (n=${m.n}) — non classable, ne rien conclure`);
  console.log('');
}

/* ──────────────────────────── commandes ───────────────────────────── */

async function cmdSymbols() {
  const list = await symbols();
  console.log('\n' + pad('id', 4) + pad('nom', 34) + pad('bougies M1', 12) + 'plage disponible (UTC)');
  console.log('─'.repeat(96));
  for (const s of list)
    console.log(
      pad(s.id, 4) +
        pad(s.name, 34) +
        pad(s.bar_count.toLocaleString('fr'), 12) +
        `${s.ts_min} → ${s.ts_max}`,
    );
  console.log('');
}

async function cmdStrategies(args) {
  const list = await api('/api/backtest');
  const id = args._[1];
  if (!id) {
    console.log('');
    for (const s of list) console.log(`${pad(s.id, 20)} ${s.label}\n${' '.repeat(20)} ${s.desc}\n`);
    console.log('détail d’une stratégie : bt.mjs strategies <id>\n');
    return;
  }
  const s = list.find((x) => x.id === id) ?? die(`stratégie inconnue : ${id}`);
  console.log(`\n${s.id} — ${s.label}\n${s.desc}\n`);
  console.log(pad('clé', 16) + pad('type', 8) + pad('défaut', 10) + 'bornes / options');
  console.log('─'.repeat(90));
  for (const p of s.params) {
    const dom =
      p.type === 'select'
        ? p.options.join(' | ')
        : p.type === 'bool'
          ? 'true | false'
          : `${p.min ?? '−∞'} … ${p.max ?? '+∞'}${p.step ? ` (pas ${p.step})` : ''}`;
    console.log(pad(p.key, 16) + pad(p.type, 8) + pad(JSON.stringify(p.def), 10) + dom);
    if (p.hint) console.log(' '.repeat(34) + `↳ ${p.hint}`);
  }
  console.log('\n⚠  toute valeur hors bornes est SILENCIEUSEMENT remplacée par le défaut.\n');
}

// Échelle de l'instrument : indispensable avant de régler des params en POINTS,
// et benchmark buy & hold (les indices synthétiques à dérive rendent tout
// biais long rentable — il faut comparer à la dérive, pas à zéro).
async function cmdProbe(args) {
  const cfg = loadCfg(args);
  const sym = await resolveSymbol(cfg.symbol);
  const tf = cfg.tf ?? '15m';

  const get = async (t, limit) =>
    api(`/api/bars?symbolId=${sym.id}&tf=${t}&from=${cfg.from}&to=${cfg.to}&limit=${limit}`);

  const [bars, days] = await Promise.all([get(tf, 5000), get('1D', 5000)]);
  if (!bars.length || !days.length) die('aucune bougie sur cette plage');

  const med = (a) => {
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  };
  const ranges = bars.map((b) => b.high - b.low);
  // ATR14 (Wilder simplifié : moyenne des true ranges sur 14)
  const tr = bars.map((b, i) =>
    i === 0
      ? b.high - b.low
      : Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close)),
  );
  const atr = [];
  for (let i = 13; i < tr.length; i++) atr.push(tr.slice(i - 13, i + 1).reduce((a, b) => a + b) / 14);

  const first = days[0].open;
  const last = days[days.length - 1].close;
  const bh = last - first;
  const dayRanges = days.map((d) => d.high - d.low);

  console.log(`\n${sym.name} (id ${sym.id}) · ${toISO(cfg.from)} → ${toISO(cfg.to)} · ${cfg.window}`);
  console.log('─'.repeat(78));
  console.log(`prix                    ${fmt(first, 2)} → ${fmt(last, 2)}`);
  console.log(`bougies ${pad(tf, 4)}            ${bars.length}${bars.length === 5000 ? ' (tronqué : stats sur les 5000 dernières)' : ''}, ${days.length} jours`);
  console.log(`range médian ${pad(tf, 4)}       ${fmt(med(ranges), 2)} points`);
  console.log(`ATR14 médian ${pad(tf, 4)}       ${fmt(med(atr), 2)} points   ← calibre SL/TP en points là-dessus`);
  console.log(`range journalier médian ${fmt(med(dayRanges), 2)} points`);
  console.log(`BUY & HOLD (benchmark)  ${bh >= 0 ? '+' : ''}${fmt(bh, 2)} points sur la période`);
  console.log(
    `\n↳ Si l'instrument dérive fortement (buy & hold ≫ 0), toute stratégie biaisée long\n` +
      `  paraîtra rentable. Compare le totalPoints de la stratégie à ce benchmark, et\n` +
      `  teste systématiquement direction=long vs short.\n`,
  );
}

async function cmdRun(args) {
  const cfg = loadCfg(args);
  const strat = await resolveStrategy(cfg.strategy);
  const params = { ...defaults(strat), ...cfg.params };
  const run = await execRun(cfg, params);
  run.minTrades = cfg.minTrades;
  printRunDetail(run);
  if (!args.noLedger) appendLedger(cfg, run, args.tag);
  if (args.json) console.log(JSON.stringify(run, null, 2));
}

const defaults = (strat) => Object.fromEntries(strat.params.map((p) => [p.key, p.def]));

// Balayage 1D : un paramètre, N valeurs, tout le reste figé.
async function cmdSweep(args) {
  const cfg = loadCfg(args);
  guardOOS(cfg, args);
  const strat = await resolveStrategy(cfg.strategy);
  const key = args.param ?? die('--param <clé> requis');
  if (!strat.params.some((p) => p.key === key))
    die(`"${key}" n'est pas un paramètre de ${strat.id} (voir: bt.mjs strategies ${strat.id})`);
  const values = parseValues(args.values ?? die('--values a,b,c ou min:max:pas requis'));

  const base = { ...defaults(strat), ...cfg.params };
  console.log(
    `\nsweep ${strat.id}.${key} sur ${values.length} valeurs · ${cfg.symbol} ${cfg.tf} · [${cfg.window}] ${toISO(cfg.from)} → ${toISO(cfg.to)}`,
  );
  console.log(`base: ${JSON.stringify(base)}\n`);
  console.log(header(key, 12));
  console.log('─'.repeat(12 + COLS.reduce((s, c) => s + c[1] + 1, 0)));

  const runs = [];
  for (const v of values) {
    const run = await execRun(cfg, { ...base, [key]: v });
    runs.push({ v, run });
    console.log(row(String(v), 12, run.metrics));
    printWarns(run, '   ');
    if (!args.noLedger) appendLedger(cfg, run, args.tag ?? `sweep:${key}`);
  }
  summarizeBest(runs, key, cfg);
}

// Balayage 2D : deux paramètres couplés (ex. slPoints × tpPoints, bbLen × bbMult).
async function cmdGrid(args) {
  const cfg = loadCfg(args);
  guardOOS(cfg, args);
  const strat = await resolveStrategy(cfg.strategy);
  const [k1, k2] = [args.param ?? die('--param <clé> requis'), args.param2 ?? die('--param2 <clé> requis')];
  const v1 = parseValues(args.values ?? die('--values requis'));
  const v2 = parseValues(args.values2 ?? die('--values2 requis'));
  const base = { ...defaults(strat), ...cfg.params };

  console.log(
    `\ngrid ${strat.id} · ${k1} × ${k2} (${v1.length}×${v2.length} = ${v1.length * v2.length} runs)` +
      ` · [${cfg.window}] ${toISO(cfg.from)} → ${toISO(cfg.to)}`,
  );
  console.log(`base: ${JSON.stringify(base)}\n`);
  console.log(`cellules = tStat (score) · lignes = ${k1} · colonnes = ${k2}\n`);
  console.log(pad(`${k1}\\${k2}`, 12) + v2.map((v) => pad(v, 8, false)).join(' '));
  console.log('─'.repeat(12 + v2.length * 9));

  const runs = [];
  for (const a of v1) {
    let line = pad(String(a), 12);
    for (const b of v2) {
      const run = await execRun(cfg, { ...base, [k1]: a, [k2]: b });
      runs.push({ v: `${k1}=${a},${k2}=${b}`, run, a, b });
      const m = run.metrics;
      line += pad(m.score == null ? (m.n < cfg.minTrades ? `n=${m.n}` : '—') : fmt(m.score, 2), 8, false) + ' ';
      if (!args.noLedger) appendLedger(cfg, run, args.tag ?? `grid:${k1}x${k2}`);
    }
    console.log(line);
  }
  console.log('');
  summarizeBest(runs, `${k1}×${k2}`, cfg);
}

function summarizeBest(runs, label, cfg) {
  const ranked = runs
    .filter((r) => r.run.metrics.score != null)
    .sort((a, b) => b.run.metrics.score - a.run.metrics.score);
  if (ranked.length === 0) {
    console.log(
      `\n⚠  aucune combinaison classable (n < minTrades=${cfg.minTrades} partout, ou aucun SL).` +
        `\n   Élargis la période, assouplis les filtres, ou vérifie que la stratégie déclenche.\n`,
    );
    return;
  }
  const top = ranked.slice(0, 3);
  console.log(`meilleurs ${label} (par tStat) :`);
  for (const r of top)
    console.log(
      `  ${pad(r.v, 26)} tStat ${fmt(r.run.metrics.score, 2)} · avgR ${fmt(r.run.metrics.avgR, 3)} · n ${r.run.metrics.n} · PF ${fmt(r.run.metrics.profitFactor, 2)}`,
    );
  if (top[0].run.metrics.avgR <= 0) {
    console.log(
      `\n✖  AUCUNE combinaison n'a une espérance positive sur ce balayage.\n` +
        `   Ne retiens pas « le moins mauvais » : c'est du bruit. Cherche ailleurs\n` +
        `   (autre paramètre, autre TF, autre direction) ou conclus à l'absence d'edge.\n`,
    );
    return;
  }
  console.log(
    `\n↳ NE PAS retenir le pic brut : vérifie que les valeurs VOISINES tiennent aussi\n` +
      `  (plateau). Un maximum isolé entouré de scores faibles = surapprentissage.\n`,
  );
}

// Les sweeps/grids sur la fenêtre OOS détruisent sa valeur de test.
function guardOOS(cfg, args) {
  if (cfg.window === 'oos' && !args.allowOosTuning)
    die(
      `optimisation sur la fenêtre OOS interdite — elle ne sert qu'à VALIDER une fois.\n` +
        `  Utilise --window is (défaut). Si tu sais ce que tu fais : --allow-oos-tuning`,
    );
  if (cfg.window === 'full' && !args.allowOosTuning)
    die(
      `optimisation sur la fenêtre "full" interdite : elle contient l'OOS.\n` +
        `  Utilise --window is (défaut).`,
    );
}

// Batterie de robustesse sur UN jeu de params : IS, OOS, coûts, TF voisins,
// direction. C'est l'étape qui décide si l'edge est réel ou surappris.
async function cmdValidate(args) {
  const cfg = loadCfg(args);
  const strat = await resolveStrategy(cfg.strategy);
  const params = { ...defaults(strat), ...cfg.params };
  const W = 22;

  console.log(`\nVALIDATION · ${strat.id} · ${cfg.symbol} · ${cfg.tf}`);
  console.log(`params: ${JSON.stringify(params)}\n`);
  console.log(header('test', W));
  console.log('─'.repeat(W + COLS.reduce((s, c) => s + c[1] + 1, 0)));

  const out = [];
  const line = async (label, over) => {
    const run = await execRun(cfg, params, over);
    console.log(row(label, W, run.metrics));
    printWarns(run, '   ');
    if (!args.noLedger) appendLedger(cfg, run, args.tag ?? 'validate');
    out.push([label, run]);
    return run;
  };

  // 1. fenêtres
  const isRun = cfg.is ? await line('IS (optimisé)', { ...cfg.is, from: toEpoch(cfg.is.from), to: toEpoch(cfg.is.to), label: 'is' }) : null;
  const oosRun = cfg.oos ? await line('OOS (jamais vu)', { from: toEpoch(cfg.oos.from), to: toEpoch(cfg.oos.to), label: 'oos' }) : null;

  // 2. sensibilité aux coûts
  const s = cfg.spread || 0;
  await line(`spread ×2 (${fmt(s * 2 || 1, 2)})`, { spread: s * 2 || 1 });
  await line(`spread ×3 (${fmt(s * 3 || 2, 2)})`, { spread: s * 3 || 2 });

  // 3. timeframes voisins
  const TFS = ['1m', '3m', '5m', '10m', '15m', '20m', '30m', '1h', '2h', '4h', '1D'];
  const i = TFS.indexOf(cfg.tf);
  for (const t of [TFS[i - 1], TFS[i + 1]].filter(Boolean)) await line(`tf voisin ${t}`, { tf: t });

  // 4. biais directionnel (si la stratégie l'expose)
  const dirP = strat.params.find((p) => p.key === 'direction');
  if (dirP) {
    for (const d of dirP.options.filter((o) => o !== params.direction)) {
      const run = await execRun(cfg, { ...params, direction: d });
      console.log(row(`direction=${d}`, W, run.metrics));
      if (!args.noLedger) appendLedger(cfg, run, 'validate:direction');
      out.push([`direction=${d}`, run]);
    }
  }

  /* verdict automatique — signaux d'alarme, pas un jugement final */
  console.log('\nDIAGNOSTIC');
  console.log('─'.repeat(78));
  const flags = [];
  const m = (r) => r?.metrics;
  if (isRun && oosRun) {
    const a = m(isRun),
      b = m(oosRun);
    if (a.avgR == null || a.avgR <= 0) {
      // Rien à valider : la stratégie ne gagne même pas là où elle a été réglée.
      flags.push(
        `✖  PAS D'EDGE EN ÉCHANTILLON (avgR IS ${fmt(a.avgR, 3)}) — l'OOS est hors sujet.\n` +
          `   Ces paramètres sont à rejeter : rien à optimiser autour.`,
      );
    } else {
      if (b.n < cfg.minTrades)
        flags.push(`⚠  OOS trop court (n=${b.n} < ${cfg.minTrades}) — validation non concluante`);
      if (b.avgR != null && b.avgR <= 0)
        flags.push(`✖  ÉCHEC OOS : espérance négative hors échantillon (avgR ${fmt(b.avgR, 3)}) → surapprentissage probable`);
      else if (b.avgR != null && b.avgR < a.avgR * 0.5)
        flags.push(`⚠  dégradation OOS > 50 % (avgR ${fmt(a.avgR, 3)} → ${fmt(b.avgR, 3)}) — edge fragile`);
      else if (b.avgR > 0) flags.push(`✔  OOS positif (avgR ${fmt(b.avgR, 3)}, PF ${fmt(b.profitFactor, 2)})`);
    }
  }
  const stress = out.find(([l]) => l.startsWith('spread ×2'));
  if (stress && m(stress[1]).avgR != null && m(stress[1]).avgR <= 0)
    flags.push('✖  l’edge disparaît en doublant le spread → marge insuffisante face aux coûts réels');
  const bms = m(isRun ?? out[0][1])?.bestMonthShare;
  if (bms != null && bms > 0.6)
    flags.push(`⚠  ${(bms * 100).toFixed(0)} % du R total vient d’un SEUL mois → performance concentrée, pas un edge stable`);
  const tfn = out.filter(([l]) => l.startsWith('tf voisin')).map(([, r]) => m(r).avgR);
  if (tfn.length && tfn.every((x) => x == null || x <= 0))
    flags.push('⚠  aucun timeframe voisin n’est rentable → réglage sur-spécifique au TF choisi');
  if (flags.length === 0) flags.push('✔  aucun signal d’alarme automatique — juge sur le tableau complet');
  for (const f of flags) console.log(f);
  console.log('');
}

// Classement du ledger (tous les runs journalisés).
async function cmdTop(args) {
  const cfg = loadCfg({ ...args, window: args.window ?? 'is', from: args.from ?? 0, to: args.to ?? 9e9 });
  const file = cfg.ledger;
  if (!fs.existsSync(file)) die(`ledger vide : ${file}`);
  let runs = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((r) => r.metrics.score != null);
  if (args.strategy) runs = runs.filter((r) => r.strategy === args.strategy);
  if (args.tag) runs = runs.filter((r) => r.tag === args.tag);
  if (args.windowFilter) runs = runs.filter((r) => r.window === args.windowFilter);
  runs.sort((a, b) => b.metrics.score - a.metrics.score);

  const n = parseInt(args.n ?? 10, 10);
  console.log(`\ntop ${n} / ${runs.length} runs classables · ${file}\n`);
  console.log(header('run', 10));
  console.log('─'.repeat(10 + COLS.reduce((s, c) => s + c[1] + 1, 0)));
  for (const r of runs.slice(0, n)) {
    console.log(row(`${r.window}`, 10, r.metrics));
    console.log(`   ${JSON.stringify(r.params)}`);
  }
  console.log('');
}

/* ──────────────────────────── dispatch ────────────────────────────── */

function usage() {
  console.log(`
bt.mjs — runner de backtest (skill backtest-optimizer)

  symbols                          symboles + plages de données disponibles
  strategies [id]                  stratégies + schéma des paramètres
  probe        --cfg c.json        échelle de l'instrument (ATR, ranges) + benchmark buy&hold
  run          --cfg c.json        un backtest, métriques détaillées
  sweep        --cfg c.json --param slPoints --values 20:200:20
  grid         --cfg c.json --param slPoints --values 20:100:20 --param2 tpPoints --values2 40:300:40
  validate     --cfg c.json        batterie de robustesse (IS/OOS, coûts, TF, direction) + diagnostic
  top          --cfg c.json [--n 10] [--tag …]   classement du ledger

Options communes
  --cfg <f.json>   contexte de mission : symbol, tf, strategy, spread, warmupDays,
                   minTrades, params (base), is/oos/full {from,to}, ledger
  --window is|oos|full   fenêtre d'évaluation (défaut: is) — sweep/grid refusent oos/full
  --from --to      bornes explicites (YYYY-MM-DD ou epoch), écrasent --window
  --symbol --tf --strategy --spread --max-bars --warmup-days --min-trades
  -p cle=valeur    paramètre de stratégie (répétable) ; --params-json '{"a":1}'
  --tag <nom>      étiquette dans le ledger      --no-ledger  ne pas journaliser
  --json           dump JSON complet (run)

Serveur : ${BASE} (npm run dev) — surchargeable via GRAPHER_URL.
`);
}

const CMDS = {
  symbols: cmdSymbols,
  strategies: cmdStrategies,
  probe: cmdProbe,
  run: cmdRun,
  sweep: cmdSweep,
  grid: cmdGrid,
  validate: cmdValidate,
  top: cmdTop,
};

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
if (!cmd || args.help || !CMDS[cmd]) {
  usage();
  process.exit(cmd && !CMDS[cmd] ? 1 : 0);
}
await CMDS[cmd](args);
