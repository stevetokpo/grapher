// LE CAHIER D'ÉCHANTILLONS — ce que l'œil a reconnu, écrit sur le disque.
//
// Un échantillon, c'est une pointe du RSI que quelqu'un a désignée du doigt sur
// le graphe en disant « ça, c'est une corne » — ou, tout aussi précieux, « ça y
// ressemble mais non ». Le fichier data/rsi-samples.json est le matériau à
// partir duquel on règle les seuils : sans contre-exemples, n'importe quel jeu
// de seuils qui attrape les exemples semble parfait.
//
// Chaque échantillon est AUTONOME : il embarque la fenêtre de bougies et les
// valeurs du RSI autour de la pointe. On peut donc rejouer une mesure, en
// inventer une nouvelle, ou tout recalculer six mois plus tard sans la base.
//
// Les mesures sont faites côté serveur sur l'historique COMPLET, pas sur ce que
// le navigateur avait chargé : le RSI y a son préchauffage entier et le zigzag
// voit les jambes en amont de la fenêtre affichée.

import fs from 'fs';
import path from 'path';
import { rsiOf, findPivots, measureHorn, nearestPivot, PIVOT_DEFAULTS } from './features';

const FILE = path.join(process.cwd(), 'data', 'rsi-samples.json');

export const WINDOW_DEFAULTS = { before: 90, after: 45 };

export function readSamples() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

export function writeSamples(list) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2) + '\n', 'utf8');
  return list;
}

// Construit l'échantillon complet à partir de l'historique et d'un temps visé.
// Le clic est AIMANTÉ sur le pivot le plus proche : on marque une pointe, pas
// une bougie. Rend null si aucune pointe n'est assez proche du clic.
export function buildSample(candles, {
  symbolId, symbol, tf,
  period = PIVOT_DEFAULTS.period,
  minAmp = PIVOT_DEFAULTS.minAmp,
  time,
  label = 'oui',
  note = '',
  snapBars = 6,
  before = WINDOW_DEFAULTS.before,
  after  = WINDOW_DEFAULTS.after,
}) {
  const rsi    = rsiOf(candles, period);
  const pivots = findPivots(rsi, minAmp);
  const k      = nearestPivot(pivots, candles, Number(time), snapBars);
  if (k < 1) return null;                    // k = 0 : pas de jambe avant, inutilisable

  const features = measureHorn(rsi, pivots, k, candles);
  if (!features) return null;

  const p    = pivots[k].idx;
  const from = Math.max(0, p - before);
  const to   = Math.min(candles.length - 1, p + after);

  const bars = [];
  const rsiWin = [];
  for (let i = from; i <= to; i++) {
    const c = candles[i];
    bars.push({ t: c.time, o: c.open, h: c.high, l: c.low, c: c.close });
    rsiWin.push(rsi[i] == null ? null : Math.round(rsi[i] * 100) / 100);
  }

  return {
    id: `${symbolId}-${tf}-${period}-${candles[p].time}`,
    createdAt: new Date().toISOString(),
    label: label === 'non' ? 'non' : 'oui',
    note: String(note ?? '').slice(0, 400),
    symbolId, symbol, tf, period, minAmp,
    side: features.side,
    time: candles[p].time,
    peak: p - from,             // index de la pointe DANS la fenêtre
    window: { before: p - from, after: to - p },
    features,
    bars,
    rsi: rsiWin,
  };
}

// Ajout idempotent : re-marquer la même pointe remplace l'échantillon (on change
// d'avis sur un cas limite sans se retrouver avec deux verdicts contradictoires).
export function upsertSample(sample) {
  const list = readSamples();
  const i = list.findIndex(s => s.id === sample.id);
  if (i >= 0) list[i] = sample;
  else list.push(sample);
  list.sort((a, b) => a.time - b.time);
  writeSamples(list);
  return sample;
}

export function removeSample(id) {
  const list = readSamples();
  const next = list.filter(s => s.id !== id);
  writeSamples(next);
  return list.length - next.length;
}
