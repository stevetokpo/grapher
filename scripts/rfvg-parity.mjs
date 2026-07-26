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
// profit, BE sur durée, BE sur retours (qui déplace le TP, pas le stop), les
// trois cumulés, le niveau BE négatif, le mode trade unique et le cooldown.
// Un seul cas « par défaut » passerait sur 90 % de code jamais exécuté.
const CASES = [
  { nom: 'sans BE, TP large',      exit: { slMarginPts: 2, tpPts: 300 } },
  { nom: 'sans BE, TP serré',      exit: { slMarginPts: 2, tpPts: 40 } },
  { nom: 'marge de stop élargie',  exit: { slMarginPts: 25, tpPts: 200 } },
  { nom: 'BE profit',              exit: { slMarginPts: 2, tpPts: 200, beTriggerPts: 80 } },
  { nom: 'BE profit + niveau > 0', exit: { slMarginPts: 2, tpPts: 200, beTriggerPts: 80, beLevelPts: 30 } },
  { nom: 'BE profit + niveau < 0', exit: { slMarginPts: 2, tpPts: 200, beTriggerPts: 80, beLevelPts: -40 } },
  { nom: 'BE durée',               exit: { slMarginPts: 2, tpPts: 200, beBarsTrigger: 5 } },
  { nom: 'BE retours (TP réduit)', exit: { slMarginPts: 2, tpPts: 200, beTouchTrigger: 2 } },
  { nom: 'les trois BE cumulés',   exit: { slMarginPts: 2, tpPts: 200, beTriggerPts: 60, beBarsTrigger: 8, beTouchTrigger: 3 } },
  { nom: 'trade unique',           exit: { slMarginPts: 2, tpPts: 200, uniqueTrade: true } },
  { nom: 'cooldown après TP',      exit: { slMarginPts: 2, tpPts: 200, uniqueTrade: true, skipAfterTp: 2 } },
  { nom: 'mode all (aFVG inclus)', detect: { mode: 'all' }, exit: { slMarginPts: 2, tpPts: 150 } },
  { nom: 'mode super',             detect: { mode: 'super' }, exit: { slMarginPts: 2, tpPts: 150 } },
];

// Champs comparés : tout ce qui décrit le sort d'une position. `beTime` en fait
// partie — c'est lui qui prouve que le break-even s'est armé au même endroit.
const FIELDS = ['id', 'direction', 'label', 'entryTime', 'entryPrice', 'exitTime', 'exitPrice',
  'sl', 'sl0', 'tp', 'tp0', 'risk0', 'profitPoints', 'status', 'barsHeld', 'entryTouches',
  'maxPullupPts', 'maxDrawdownPts', 'maeArmedPts', 'beActivated', 'beReason', 'beTime'];

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

  const meta = sim.meta;
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
