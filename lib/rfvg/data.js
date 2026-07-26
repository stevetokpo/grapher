// Chargement et mise en cache des données pour l'optimiseur rFVG.
//
// L'optimisation ne touche QUE les sorties (SL / TP / BE) : la détection est
// figée par l'utilisateur. On paie donc une seule fois ce qui est cher —
// lecture M1, agrégation au TF, détection des zones — et on rejoue la grille de
// sorties sur le même matériel. Sans ça, une grille de 500 configurations
// relirait 500 fois 300 000 bougies.
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
// survivre au hot-reload). Il est volontairement petit : un symbole de M1, c'est
// ~300 000 objets.

import { query } from '../db';
import { aggregateWithRanges, detectZones, DETECT_DEFAULTS } from './simulate';

export const TF_SECONDS = {
  '1m': 60, '3m': 180, '5m': 300, '10m': 600, '15m': 900,
  '20m': 1200, '30m': 1800, '1h': 3600, '2h': 7200, '4h': 14400, '1D': 86400,
};

const CACHE_KEY = '__rfvg_cache';
function store() {
  if (!global[CACHE_KEY]) global[CACHE_KEY] = { m1: new Map(), tf: new Map(), zones: new Map() };
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
  s.m1.clear(); s.tf.clear(); s.zones.clear();
}

export function cacheInfo() {
  const s = store();
  return { m1: [...s.m1.keys()], tf: [...s.tf.keys()], zones: s.zones.size };
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

// Clé de détection : seuls les champs qui changent le résultat de calcRFVG.
// `extLen` n'en fait pas partie — il ne pilote que le dessin des boîtes.
const DETECT_KEYS = Object.keys(DETECT_DEFAULTS);
export function detectKey(detect) {
  const d = { ...DETECT_DEFAULTS, ...detect };
  return DETECT_KEYS.map(k => `${k}=${d[k]}`).join('|');
}

export async function loadZones(symbolId, tf, detect) {
  const s   = store();
  const key = `${symbolId}:${tf}:${detectKey(detect)}`;
  if (s.zones.has(key)) return { ...(await loadTF(symbolId, tf)), zones: s.zones.get(key) };

  const data  = await loadTF(symbolId, tf);
  const zones = detectZones(data.candles, detect);
  put(s.zones, key, zones, 12);
  return { ...data, zones };
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
