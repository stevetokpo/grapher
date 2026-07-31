// Chargement et mise en cache des données pour les optimiseurs de motifs.
//
// On paie UNE fois ce qui est cher — lecture M1, agrégation au TF, détection —
// puis on rejoue la grille de sorties sur le même matériel. Sans ça, une grille
// de 500 configurations relirait 500 fois 300 000 bougies.
//
// Le cache M1 et le cache TF sont PARTAGÉS entre motifs : ce sont les mêmes
// bougies, et un symbole M1 pèse ~200 Mo. Seul le cache des signaux est
// compartimenté par motif — c'est le seul étage dont le contenu dépend de la
// détection.
//
// FENÊTRAGE — la simulation tourne TOUJOURS sur l'historique complet, et le
// découpage in-sample / out-of-sample se fait en filtrant les positions sur leur
// date d'ENTRÉE. Deux raisons :
//   • le warm-up (MM 200 au TF choisi = 200 bougies avant le premier signal) est
//     absorbé d'office, sans avoir à le dimensionner à la main ;
//   • `uniqueTrade` et `skipAfterTp` sont des états SÉQUENTIELS. Redémarrer la
//     simulation au bord de la fenêtre remettrait ces compteurs à zéro et
//     fabriquerait des trades que la règle n'aurait jamais pris.
//
// Le cache vit dans le processus du serveur dev (attaché à `global` pour
// survivre au hot-reload).

import { query } from '../db';
import { aggregateWithRanges } from './engine';

export const TF_SECONDS = {
  '1m': 60, '3m': 180, '5m': 300, '10m': 600, '15m': 900,
  '20m': 1200, '30m': 1800, '1h': 3600, '2h': 7200, '4h': 14400, '1D': 86400,
};

const CACHE_KEY = '__signals_cache';
function store() {
  if (!global[CACHE_KEY]) global[CACHE_KEY] = { m1: new Map(), tf: new Map(), signals: new Map() };
  return global[CACHE_KEY];
}

// Cache borné à la main : le LRU d'une Map JS, c'est l'ordre d'insertion.
function put(map, key, value, max) {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) map.delete(map.keys().next().value);
  return value;
}

export function clearCache() {
  const s = store();
  s.m1.clear(); s.tf.clear(); s.signals.clear();
}

export function cacheInfo() {
  const s = store();
  return { m1: [...s.m1.keys()], tf: [...s.tf.keys()], signals: s.signals.size };
}

// Historique M1 complet d'un symbole, trié. C'est le seul accès disque.
export async function loadM1(symbolId) {
  const s   = store();
  const key = String(symbolId);
  if (s.m1.has(key)) return s.m1.get(key);

  const rows = await query(`
    SELECT epoch(ts)::INTEGER AS time,
           open, high, low, close, tick_vol AS volume
    FROM bars_m1
    WHERE symbol_id = ${Number(symbolId)}
    ORDER BY ts ASC
  `);
  // DuckDB rend des BigInt/Int32 selon les colonnes : on normalise une fois ici
  // plutôt que dans chaque boucle chaude.
  const bars = rows.map(r => ({
    time:   Number(r.time),
    open:   Number(r.open),
    high:   Number(r.high),
    low:    Number(r.low),
    close:  Number(r.close),
    volume: Number(r.volume ?? 0),
  }));
  return put(s.m1, key, bars, 2);
}

export async function loadTF(symbolId, tf) {
  const sec = TF_SECONDS[tf];
  if (!sec) throw new Error(`timeframe inconnu : ${tf}`);
  const s   = store();
  const key = `${symbolId}:${tf}`;
  if (s.tf.has(key)) return s.tf.get(key);

  const m1 = await loadM1(symbolId);
  const { candles, ranges } = aggregateWithRanges(m1, sec);
  return put(s.tf, key, { candles, ranges, m1 }, 4);
}

// Clé de détection : seuls les champs qui changent le résultat de la détection,
// c'est-à-dire ceux que le motif déclare dans ses défauts. `extLen` n'en fait
// jamais partie — il ne pilote que le dessin des boîtes.
export function detectKeyOf(defaults, detect) {
  const d = { ...defaults, ...detect };
  return Object.keys(defaults).map(k => `${k}=${d[k]}`).join('|');
}

/**
 * Signaux d'un motif, mis en cache.
 * @param pattern { name, detect(candles, opts), defaults } — cf. lib/ko/detect.js
 */
export async function loadSignals(pattern, symbolId, tf, detect) {
  const s   = store();
  const key = `${pattern.name}:${symbolId}:${tf}:${detectKeyOf(pattern.defaults, detect)}`;
  const data = await loadTF(symbolId, tf);
  if (s.signals.has(key)) return { ...data, signals: s.signals.get(key) };

  const signals = pattern.detect(data.candles, { ...pattern.defaults, ...detect });
  // 24 entrées : un balayage de détection en garde une par combinaison, et
  // repasser sur la même grille (validation, fenêtre OOS) doit rester gratuit.
  put(s.signals, key, signals, 24);
  return { ...data, signals };
}

// 'YYYY-MM-DD' | 'YYYY-MM-DDTHH:MM' | epoch → epoch secondes (UTC)
export function toEpoch(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  const t = Date.parse(v.length === 10 ? `${v}T00:00:00Z` : `${v.replace(/Z?$/, '')}Z`);
  if (Number.isNaN(t)) throw new Error(`date illisible : ${v}`);
  return Math.floor(t / 1000);
}

// Fenêtrage sur la date d'ENTRÉE (cf. bloc de tête). Borne haute EXCLUSIVE,
// pour que deux fenêtres adjacentes ne partagent jamais une position.
export function windowPositions(positions, from, to) {
  if (from == null && to == null) return positions;
  return positions.filter(p =>
    (from == null || p.entryTime >= from) && (to == null || p.entryTime < to));
}
