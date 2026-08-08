#!/usr/bin/env node
// Contrôle de parité : `simulatePositions` (lib/rfvg/simulate.js, mode bougie)
// doit rendre EXACTEMENT les mêmes positions que `calcRFVGPositions`
// (lib/patterns.js), la fonction qu'affiche le graphe et que porte l'EA MT5.
//
// Pourquoi un test plutôt qu'une relecture : les deux implémentations vont
// diverger un jour (un réglage ajouté d'un côté, une règle affinée de l'autre).
// Si ça arrive en silence, l'optimiseur recommandera des paramètres pour une
// stratégie que personne ne trade. Ce script rend la divergence bruyante.
//
//   node scripts/rfvg-parity.mjs [--symbol 1] [--tf 15m]
//
// Serveur dev requis (npm run dev), ou GRAPHER_URL.

const BASE = process.env.GRAPHER_URL || 'http://localhost:3000';

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const symbolId = Number(flag('symbol', 1));
const tf       = flag('tf', '15m');

// Les cas doivent couvrir chaque branche de la machine à états : sans BE, BE sur
// profit, BE sur durée, BE sur swing (qui pose le stop sur la structure), BE sur
// retours (qui coupe la position au prix d'entrée), leurs cumuls, le niveau BE
// négatif, le mode trade unique et le cooldown.
// Un seul cas « par défaut » passerait sur 90 % de code jamais exécuté.
const CASES = [
  { nom: 'sans BE, TP large',      exit: { slMarginPts: 2, tpPts: 300 } },
  { nom: 'sans BE, TP serré',      exit: { slMarginPts: 2, tpPts: 40 } },
  { nom: 'marge de stop élargie',  exit: { slMarginPts: 25, tpPts: 200 } },
  { nom: 'BE profit',              exit: { slMarginPts: 2, tpPts: 200, beTriggerPts: 80 } },
  { nom: 'BE profit + niveau > 0', exit: { slMarginPts: 2, tpPts: 200, beTriggerPts: 80, beLevelPts: 30 } },
  { nom: 'BE profit + niveau < 0', exit: { slMarginPts: 2, tpPts: 200, beTriggerPts: 80, beLevelPts: -40 } },
  { nom: 'BE durée',               exit: { slMarginPts: 2, tpPts: 200, beBarsTrigger: 5 } },
  { nom: 'BE retours (coupe)',     exit: { slMarginPts: 2, tpPts: 200, beTouchTrigger: 2 } },
  { nom: 'BE retours (1 seul)',    exit: { slMarginPts: 2, tpPts: 200, beTouchTrigger: 1 } },
  { nom: 'BE swing 2/2',           exit: { slMarginPts: 2, tpPts: 200, beSwingBars: 2 } },
  { nom: 'BE swing 1/1 (fréquent)',exit: { slMarginPts: 2, tpPts: 200, beSwingBars: 1 } },
  { nom: 'BE swing 4/4 (rare)',    exit: { slMarginPts: 2, tpPts: 300, beSwingBars: 4 } },
  { nom: 'BE swing + marge large', exit: { slMarginPts: 30, tpPts: 200, beSwingBars: 2 } },
  { nom: 'BE swing + profit',      exit: { slMarginPts: 2, tpPts: 200, beSwingBars: 2, beTriggerPts: 80 } },
  { nom: 'les quatre BE cumulés',  exit: { slMarginPts: 2, tpPts: 200, beTriggerPts: 60, beBarsTrigger: 8, beTouchTrigger: 3, beSwingBars: 2 } },
  { nom: 'trade unique',           exit: { slMarginPts: 2, tpPts: 200, uniqueTrade: true } },
  { nom: 'cooldown après TP',      exit: { slMarginPts: 2, tpPts: 200, uniqueTrade: true, skipAfterTp: 2 } },
  { nom: 'mode all (aFVG inclus)', detect: { mode: 'all' }, exit: { slMarginPts: 2, tpPts: 150 } },
  { nom: 'mode super',             detect: { mode: 'super' }, exit: { slMarginPts: 2, tpPts: 150 } },
  { nom: 'mode cfvg (continuation)', detect: { mode: 'cfvg' }, exit: { slMarginPts: 2, tpPts: 150 } },
  // SL plafonné : serré (il décide presque partout, et coupe dès B4), large (il
  // ne décide jamais, la structure reste maîtresse), et croisé avec les BE — le
  // stop déplacé doit rester borné par le plafond, pas par le seul structurel.
  { nom: 'SL plafonné serré',      exit: { slMarginPts: 2, tpPts: 200, slCapPts: 60 } },
  { nom: 'SL plafonné très serré', exit: { slMarginPts: 2, tpPts: 200, slCapPts: 15 } },
  { nom: 'SL plafonné large',      exit: { slMarginPts: 2, tpPts: 200, slCapPts: 5000 } },
  { nom: 'SL plafonné + BE profit', exit: { slMarginPts: 2, tpPts: 200, slCapPts: 80, beTriggerPts: 60 } },
  { nom: 'SL plafonné + BE swing', exit: { slMarginPts: 2, tpPts: 200, slCapPts: 80, beSwingBars: 2 } },
  { nom: 'SL plafonné + tout',     exit: { slMarginPts: 2, tpPts: 200, slCapPts: 100, beTriggerPts: 60, beBarsTrigger: 8, beTouchTrigger: 3, beSwingBars: 2, uniqueTrade: true } },
  // Spread : le coût est appliqué par le SIMULATEUR, position par position. Les
  // deux implémentations doivent donc rendre le même netPoints, pas seulement le
  // même brut — la coupe au prix d'entrée (brut nul, net = −spread) le prouve.
  { nom: 'spread 4 pts',           exit: { slMarginPts: 2, tpPts: 200 }, spread: 4 },
  { nom: 'spread 4 pts + BE coupe', exit: { slMarginPts: 2, tpPts: 200, beTouchTrigger: 2 }, spread: 4 },
  { nom: 'spread 12 pts + tout',   exit: { slMarginPts: 2, tpPts: 200, slCapPts: 100, beTriggerPts: 60, beSwingBars: 2 }, spread: 12 },
  // Le dû : l'objectif de remboursement remplace le TP, l'ardoise se remplit et
  // se vide au fil des positions. Les deux modes, avec spread (une perte se juge
  // au NET), en chevauchement (l'anti-anticipation décide de ce qui est déjà
  // connu) comme en trade unique, et croisé avec chaque type de BE — c'est là
  // que se joue « le dû déplace la cible, pas la protection ».
  { nom: 'dû 3 full',              exit: { slMarginPts: 2, tpPts: 200, dueAfterSl: 3 } },
  { nom: 'dû 3 step',              exit: { slMarginPts: 2, tpPts: 200, dueAfterSl: 3, dueMode: 'step' } },
  { nom: 'dû 8 full + spread',     exit: { slMarginPts: 2, tpPts: 200, dueAfterSl: 8 }, spread: 4 },
  { nom: 'dû 5 + BE profit',       exit: { slMarginPts: 2, tpPts: 200, dueAfterSl: 5, beTriggerPts: 80 } },
  { nom: 'dû 5 + BE durée',        exit: { slMarginPts: 2, tpPts: 200, dueAfterSl: 5, beBarsTrigger: 5 } },
  { nom: 'dû 5 + BE retours',      exit: { slMarginPts: 2, tpPts: 200, dueAfterSl: 5, beTouchTrigger: 2 } },
  { nom: 'dû 5 + BE swing',        exit: { slMarginPts: 2, tpPts: 200, dueAfterSl: 5, beSwingBars: 2 } },
  { nom: 'dû 4 + les quatre BE',   exit: { slMarginPts: 2, tpPts: 200, dueAfterSl: 4, beTriggerPts: 60, beBarsTrigger: 8, beTouchTrigger: 3, beSwingBars: 2 } },
  { nom: 'dû 4 step + SL plafonné',exit: { slMarginPts: 2, tpPts: 200, dueAfterSl: 4, dueMode: 'step', slCapPts: 80 } },
  { nom: 'dû 4 + trade unique',    exit: { slMarginPts: 2, tpPts: 200, dueAfterSl: 4, uniqueTrade: true } },
  { nom: 'dû 4 + unique + repos',  exit: { slMarginPts: 2, tpPts: 200, dueAfterSl: 4, uniqueTrade: true, skipAfterTp: 2 } },
  { nom: 'dû 4 + repos, chevauché',exit: { slMarginPts: 2, tpPts: 200, dueAfterSl: 4, skipAfterTp: 2 }, spread: 2 },
];

// Champs comparés : tout ce qui décrit le sort d'une position. `beTime` en fait
// partie — c'est lui qui prouve que le break-even s'est armé au même endroit.
const FIELDS = ['id', 'direction', 'label', 'entryTime', 'entryPrice', 'exitTime', 'exitPrice',
  'sl', 'sl0', 'slCapped', 'tp', 'risk0', 'profitPoints', 'status', 'barsHeld', 'entryTouches',
  'maxPullupPts', 'maxDrawdownPts', 'maeArmedPts', 'beActivated', 'beReason', 'beTime',
  'cutAtEntry', 'spreadPts', 'netPoints',
  // Le dû : ce que la position a visé et ce qu'elle devait. Deux ardoises qui
  // divergeraient d'une position rendraient tous les objectifs suivants faux.
  'duePts', 'dueTotalPts', 'dueCount'];

// Deux flottants issus de deux chemins de calcul peuvent différer du dernier
// bit. On compare donc à 1e-9 près, pas à l'identique binaire.
const same = (a, b) =>
  typeof a === 'number' && typeof b === 'number'
    ? Math.abs(a - b) < 1e-9
    : a === b || (a == null && b == null);

async function run(engine, kase) {
  const r = await fetch(`${BASE}/api/rfvg/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbolId, tf, engine,
      detect: kase.detect ?? {}, exit: kase.exit,
      spreadPoints: kase.spread ?? 0,
      limit: 100000,
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? r.statusText);
  return j;
}

let failed = 0;

for (const kase of CASES) {
  const [sim, legacy] = await Promise.all([run('sim', kase), run('legacy', kase)]);
  const A = sim.positions, B = legacy.positions;

  const diffs = [];
  if (A.length !== B.length) diffs.push(`nombre de positions : ${A.length} vs ${B.length}`);
  for (let i = 0; i < Math.min(A.length, B.length) && diffs.length < 6; i++) {
    for (const f of FIELDS) {
      if (!same(A[i][f], B[i][f])) diffs.push(`position ${A[i].id} · ${f} : ${A[i][f]} ≠ ${B[i][f]}`);
    }
  }

  // Compteurs de lot : ils se calculent en dehors des positions (signaux sautés,
  // ardoise restante), donc une divergence n'y apparaîtrait nulle part ailleurs.
  const meta = sim.meta;
  for (const m of ['skippedByCooldown', 'skippedWon', 'dueArmed', 'dueRemainingPts', 'dueRemainingSl']) {
    if (!same(meta[m], legacy.meta[m])) diffs.push(`méta ${m} : ${meta[m]} ≠ ${legacy.meta[m]}`);
  }

  if (diffs.length) {
    failed++;
    console.log(`✖ ${kase.nom}  (${A.length} positions)`);
    for (const d of diffs) console.log(`    ${d}`);
  } else {
    console.log(`✓ ${kase.nom.padEnd(28)} ${String(A.length).padStart(4)} positions identiques` +
      (meta.skippedByCooldown ? `  (${meta.skippedByCooldown} sautées)` : ''));
  }
}

console.log(failed
  ? `\n✖ ${failed}/${CASES.length} cas divergent — l'optimiseur ne teste PAS la stratégie du graphe.\n`
  : `\n✓ parité complète sur ${CASES.length} cas : l'optimiseur et le graphe simulent la même règle.\n`);
process.exit(failed ? 1 : 0);
