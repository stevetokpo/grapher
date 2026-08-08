#!/usr/bin/env node
// LE LABORATOIRE DE LA CORNE, en ligne de commande.
//
// Il répond à la seule question qui compte quand on essaie de mettre des
// chiffres sur une forme qu'on reconnaît à l'œil :
//
//    QUELLE MESURE SÉPARE VRAIMENT LES CORNES DU RESTE DES POINTES ?
//
// Une mesure ne vaut que par ce qu'elle ÉLIMINE. « Les cornes ont une montée de
// 14 bougies en médiane » ne sert à rien si toutes les pointes du graphe en ont
// autant. Le tableau du pouvoir de coupe pose donc, pour chaque mesure, le seuil
// qui garde 90 % des exemples marqués, et regarde combien de pointes ordinaires
// ce seuil élimine au passage. Ce qui coupe beaucoup est un critère ; ce qui
// coupe peu est un ornement.
//
//   node scripts/rsi-lab.mjs                 # rapport complet
//   node scripts/rsi-lab.mjs --json          # même chose, pour un autre outil
//   node scripts/rsi-lab.mjs --symbol 1 --tf 1m --period 7
//
// La population témoin (« toutes les pointes ») vient de /api/rsi/scan : serveur
// dev requis (npm run dev), sinon GRAPHER_URL. Sans serveur, le rapport tourne
// quand même, amputé de sa colonne témoin — et le dit.
//
// Les quantiles sont recalculés ici plutôt qu'importés de lib/rsi/features.js :
// ce fichier est en ESM, le reste du dépôt est chargé par Next. Trois lignes de
// doublon valent mieux qu'un bundler dans un script.

import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.GRAPHER_URL || 'http://localhost:3000';
const FILE = path.join(process.cwd(), 'data', 'rsi-samples.json');

const args = process.argv.slice(2);
const flag = (name, def = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] != null && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const has = name => args.includes(`--${name}`);
const die = m => { console.error(`\n✖ ${m}\n`); process.exit(1); };

/* ── mesures suivies ─────────────────────────────────────────────────────
   `dir` dit de quel côté se pose le seuil : 'min' = la corne a une valeur
   HAUTE (on coupe en dessous), 'max' = elle a une valeur BASSE. */
const FEATURES = [
  { key: 'riseBars',     dir: 'min', rule: 'minRiseBars',     label: 'montée (bougies)' },
  { key: 'riseAmp',      dir: 'min', rule: 'minRiseAmp',      label: 'montée (pts RSI)' },
  { key: 'riseSlope',    dir: 'max', rule: null,              label: 'pente de montée' },
  { key: 'riseEff',      dir: 'max', rule: null,              label: 'régularité montée' },
  { key: 'dropBars',     dir: 'max', rule: 'maxDropBars',     label: 'chute (bougies)' },
  { key: 'dropAmp',      dir: 'min', rule: null,              label: 'chute (pts RSI)' },
  { key: 'dropSlope',    dir: 'min', rule: null,              label: 'pente de chute' },
  { key: 'dropEff',      dir: 'min', rule: null,              label: 'régularité chute' },
  { key: 'firstShare',   dir: 'min', rule: null,              label: 'part 1re bougie' },
  { key: 'sharpness',    dir: 'min', rule: 'minSharpness',    label: 'POINTE (× pente)' },
  { key: 'timeRatio',    dir: 'min', rule: null,              label: 'durée montée/chute' },
  { key: 'rewindBars',   dir: 'min', rule: 'minRewind',       label: 'REMBOBINAGE (bougies)' },
  { key: 'rewindPerBar', dir: 'min', rule: 'minRewindPerBar', label: 'rembobinage / bougie' },
  { key: 'retrace',      dir: 'min', rule: 'minRetrace',      label: 'retour de la montée' },
  { key: 'tipFlat',      dir: 'max', rule: null,              label: 'plateau au sommet' },
  { key: 'level',        dir: 'min', rule: null,              label: 'niveau du sommet' },
];

/* ── petits calculs ──────────────────────────────────────────────────── */

const num = v => typeof v === 'number' && Number.isFinite(v);
const fmt = (v, d = 2) => v == null ? '—' : num(v) ? (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(d)) : '∞';
const pct = v => v == null ? '—' : `${(v * 100).toFixed(0)}%`;
const padR = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function vals(list, key) {
  return list.map(f => f?.[key]).filter(num).sort((a, b) => a - b);
}

function stat(list, key) {
  const v = vals(list, key);
  if (!v.length) return null;
  return {
    n: v.length, min: v[0], p10: quantile(v, 0.10), med: quantile(v, 0.50),
    p90: quantile(v, 0.90), max: v[v.length - 1],
  };
}

// Part de la population qu'un seuil ÉLIMINE.
function cutRate(list, key, dir, thr) {
  const v = vals(list, key);
  if (!v.length || thr == null) return null;
  const kept = v.filter(x => dir === 'min' ? x >= thr : x <= thr).length;
  return 1 - kept / v.length;
}

/* ── chargement ──────────────────────────────────────────────────────── */

let all;
try {
  all = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch (e) {
  if (e.code === 'ENOENT') die(`aucun cahier d'échantillons — ouvre /rsi, passe en mode Marquer et clique des cornes.\n  (le fichier apparaîtra en ${path.relative(process.cwd(), FILE)})`);
  die(`cahier illisible : ${e.message}`);
}
if (!Array.isArray(all) || !all.length) die("le cahier d'échantillons est vide — marque des cornes sur /rsi.");

// Contexte par défaut : celui du groupe le plus fourni.
const groups = new Map();
for (const s of all) {
  const k = `${s.symbolId}|${s.tf}|${s.period}`;
  groups.set(k, (groups.get(k) ?? 0) + 1);
}
const [topKey] = [...groups.entries()].sort((a, b) => b[1] - a[1])[0];
const [defSym, defTf, defPeriod] = topKey.split('|');

const symbolId = Number(flag('symbol', defSym));
const tf       = flag('tf', defTf);
const period   = Number(flag('period', defPeriod));

const samples = all.filter(s =>
  s.symbolId === symbolId && s.tf === tf && Number(s.period) === period);
if (!samples.length) die(`aucun échantillon pour symbole ${symbolId} / ${tf} / RSI ${period}.`);

const minAmp = Number(flag('minAmp', samples[0].minAmp ?? 4));
const oui = samples.filter(s => s.label === 'oui').map(s => s.features);
const non = samples.filter(s => s.label === 'non').map(s => s.features);

if (!oui.length) die("aucun exemple positif : marque au moins quelques cornes avant d'appeler ça un laboratoire.");

/* ── population témoin : toutes les pointes de l'historique ──────────── */

let pop = [], popInfo = null, popErr = null;
try {
  const win = [flag('from') && `&from=${flag('from')}`, flag('to') && `&to=${flag('to')}`]
    .filter(Boolean).join('');
  const r = await fetch(`${BASE}/api/rsi/scan?symbolId=${symbolId}&tf=${tf}&period=${period}` +
    `&minAmp=${minAmp}&only=all&limit=0&minRiseBars=0&maxDropBars=999&minRiseAmp=0` +
    `&minSharpness=0&minRewind=0&minRewindPerBar=0&minRetrace=0${win}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? r.statusText);
  pop = j.horns ?? [];
  popInfo = { bars: j.bars, pivots: j.pivots };
} catch (e) {
  popErr = e.message;
}

/* ── rapport ─────────────────────────────────────────────────────────── */

const proposal = propose();

if (has('json')) {
  console.log(JSON.stringify({
    symbolId, tf, period, minAmp,
    counts: { oui: oui.length, non: non.length, population: pop.length },
    features: FEATURES.map(f => ({
      key: f.key, dir: f.dir,
      oui: stat(oui, f.key), non: stat(non, f.key), population: stat(pop, f.key),
      threshold: proposal.thresholds[f.key] ?? null,
      cutsPopulation: cutRate(pop, f.key, f.dir, proposal.thresholds[f.key]),
      cutsNegatives:  cutRate(non, f.key, f.dir, proposal.thresholds[f.key]),
    })),
    rules: proposal.rules,
    evaluation: evaluate(proposal.rules),
  }, null, 2));
  process.exit(0);
}

const W = 78;
console.log('');
console.log(`  LABORATOIRE DE LA CORNE — symbole ${symbolId} · ${tf} · RSI ${period} · zigzag ${minAmp}`);
console.log('  ' + '─'.repeat(W));
console.log(`  cahier : ${oui.length} corne(s) marquée(s), ${non.length} contre-exemple(s)`);
if (popErr) {
  console.log(`  témoin : INDISPONIBLE (${popErr})`);
  console.log('           lance le serveur (npm run dev) pour la colonne « toutes les pointes ».');
} else {
  console.log(`  témoin : ${pop.length} pointes sur ${popInfo.bars} bougies d'historique`);
}
console.log('');

// ── 1. Où se placent les cornes ────────────────────────────────────────
console.log('  ┌ CE QUE MESURENT LES CORNES ' + '─'.repeat(W - 30));
console.log('  │ ' + padR('mesure', 22) + padL('cornes p10', 12) + padL('méd', 8) + padL('p90', 8)
  + padL('non méd', 10) + padL('toutes méd', 12));
for (const f of FEATURES) {
  const a = stat(oui, f.key), b = stat(non, f.key), c = stat(pop, f.key);
  console.log('  │ ' + padR(f.label, 22)
    + padL(fmt(a?.p10), 12) + padL(fmt(a?.med), 8) + padL(fmt(a?.p90), 8)
    + padL(fmt(b?.med), 10) + padL(fmt(c?.med), 12));
}
console.log('  └' + '─'.repeat(W));
console.log('');

// ── 2. Pouvoir de coupe ────────────────────────────────────────────────
console.log('  ┌ POUVOIR DE COUPE ' + '─'.repeat(W - 20));
console.log('  │ seuil posé de façon à garder 90 % des cornes marquées');
console.log('  │ ' + padR('mesure', 22) + padL('seuil', 10) + padL('élimine', 12) + padL('des contre-ex.', 16));
const ranked = FEATURES
  .map(f => ({ f, cut: cutRate(pop, f.key, f.dir, proposal.thresholds[f.key]) }))
  .sort((a, b) => (b.cut ?? -1) - (a.cut ?? -1));
for (const { f, cut } of ranked) {
  const thr = proposal.thresholds[f.key];
  const cn  = cutRate(non, f.key, f.dir, thr);
  const bar = cut == null ? '' : '█'.repeat(Math.round(cut * 10));
  console.log('  │ ' + padR(f.label, 22)
    + padL((f.dir === 'min' ? '≥ ' : '≤ ') + fmt(thr), 10)
    + padL(pct(cut), 8) + ' ' + padR(bar, 11)
    + padL(pct(cn), 8));
}
console.log('  └' + '─'.repeat(W));
console.log('');

// ── 3. Le jeu de seuils qui en découle ────────────────────────────────
const ev = evaluate(proposal.rules);
console.log('  ┌ SEUILS PROPOSÉS ' + '─'.repeat(W - 19));
for (const [k, v] of Object.entries(proposal.rules)) {
  console.log('  │ ' + padR(k, 22) + padL(String(v), 10));
}
console.log('  ├' + '─'.repeat(W));
console.log('  │ ' + padR('cornes retrouvées', 22) + padL(`${ev.recall.n}/${oui.length}`, 10) + padL(pct(ev.recall.rate), 10));
console.log('  │ ' + padR('contre-ex. rejetés', 22) + padL(`${ev.reject.n}/${non.length}`, 10) + padL(pct(ev.reject.rate), 10));
if (!popErr) {
  console.log('  │ ' + padR('pointes retenues', 22) + padL(`${ev.pop.n}/${pop.length}`, 10) + padL(pct(ev.pop.rate), 10));
  const every = ev.pop.n ? Math.round(popInfo.bars / ev.pop.n) : null;
  console.log('  │ ' + padR('fréquence', 22) + padL(every ? `1 / ${every} b` : '—', 10));
}
console.log('  └' + '─'.repeat(W));
console.log('');
console.log('  Reporte ces seuils dans la barre de /rsi (ou dans HORN_RULES,');
console.log('  lib/rsi/features.js) et regarde les candidats s\'allumer sur le graphe.');
console.log('');

/* ── proposition et évaluation ───────────────────────────────────────── */

// Le seuil de chaque mesure est posé pour garder 90 % des cornes marquées :
// p10 pour une mesure haute, p90 pour une mesure basse. C'est une proposition
// de DÉPART, pas un verdict — dix exemples ne connaissent pas la queue de
// distribution.
function propose() {
  const thresholds = {};
  for (const f of FEATURES) {
    const s = stat(oui, f.key);
    if (!s) continue;
    thresholds[f.key] = round(f.dir === 'min' ? s.p10 : s.p90, f.key);
  }

  const rules = { minAmp };
  for (const f of FEATURES) {
    if (!f.rule || thresholds[f.key] == null) continue;
    rules[f.rule] = thresholds[f.key];
  }
  const sides = new Set(samples.filter(s => s.label === 'oui').map(s => s.side));
  rules.side = sides.size === 1 ? [...sides][0] : 'both';
  return { thresholds, rules };
}

function round(v, key) {
  if (v == null) return null;
  if (key === 'riseBars' || key === 'dropBars' || key === 'rewindBars' || key === 'tipFlat') {
    return Math.round(v);
  }
  return Math.round(v * 100) / 100;
}

// Le même verdict que lib/rsi/features.js matchHorn, réécrit sur les seuls
// champs que le script manipule.
function passes(f, r) {
  if (!f) return false;
  if (r.side !== 'both' && f.side !== r.side) return false;
  if (r.minRiseBars     != null && f.riseBars     <  r.minRiseBars)     return false;
  if (r.maxDropBars     != null && f.dropBars     >  r.maxDropBars)     return false;
  if (r.minRiseAmp      != null && f.riseAmp      <  r.minRiseAmp)      return false;
  if (r.minSharpness    != null && f.sharpness    <  r.minSharpness)    return false;
  if (r.minRewind       != null && f.rewindBars   <  r.minRewind)       return false;
  if (r.minRewindPerBar != null && f.rewindPerBar <  r.minRewindPerBar) return false;
  if (r.minRetrace      != null && f.retrace      <  r.minRetrace)      return false;
  return true;
}

function evaluate(rules) {
  const hitOui = oui.filter(f => passes(f, rules)).length;
  const hitNon = non.filter(f => passes(f, rules)).length;
  const hitPop = pop.filter(f => passes(f, rules)).length;
  return {
    recall: { n: hitOui, rate: oui.length ? hitOui / oui.length : null },
    reject: { n: non.length - hitNon, rate: non.length ? (non.length - hitNon) / non.length : null },
    pop:    { n: hitPop, rate: pop.length ? hitPop / pop.length : null },
  };
}
