// Chargement et mise en cache des données pour l'optimiseur rFVG.
//
// La mécanique (cache M1 partagé, agrégation au TF, cache de signaux par motif,
// fenêtrage sur la date d'entrée) est commune à tous les motifs et vit dans
// lib/signals/data.js. Ici on ne fait que la brancher sur la détection rFVG, en
// gardant les noms d'origine — `zones` plutôt que `signals`.

import { loadSignals } from '../signals/data';
import { RFVG_PATTERN, DETECT_DEFAULTS } from './simulate';
import { detectKeyOf } from '../signals/data';

export { TF_SECONDS, loadM1, loadTF, clearCache, cacheInfo, toEpoch, windowPositions } from '../signals/data';

// Clé de détection : seuls les champs qui changent le résultat de calcRFVG.
// `extLen` n'en fait pas partie — il ne pilote que le dessin des boîtes.
export const detectKey = detect => detectKeyOf(DETECT_DEFAULTS, detect);

export async function loadZones(symbolId, tf, detect) {
  const { signals, ...data } = await loadSignals(RFVG_PATTERN, symbolId, tf, detect);
  return { ...data, zones: signals };
}
