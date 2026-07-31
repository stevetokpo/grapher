// Le motif KO, tel que le voient le serveur et l'optimiseur.
//
// Tout le reste est partagé et n'a pas de jumeau ici — c'est délibéré :
//   • le moteur de sorties          lib/signals/engine.js
//   • les statistiques et études    lib/signals/stats.js
//   • le cache M1 / TF / signaux    lib/signals/data.js
//   • le schéma des sorties         lib/signals/params.js
// Le KO n'apporte donc que sa détection. C'est la différence avec le rFVG, qui
// porte deux implémentations de la même règle de sortie (une pour le graphe, une
// pour le serveur) et un script de parité pour les tenir alignées : ici le graphe
// et le serveur appellent le MÊME code, il n'y a rien à aligner.

import { calcKO } from '../patterns';
import { loadSignals } from '../signals/data';

// Défauts alignés sur PATTERN_TYPES.KO (components/PatternPanel.js) et sur la
// signature de calcKO — les changer ici ferait mentir la page /ko par rapport au
// graphe. `extLen` n'en fait pas partie : il ne pilote que le dessin des boîtes,
// et l'inclure ferait rater le cache de signaux à chaque changement d'affichage.
export const DETECT_DEFAULTS = {
  direction:    'both',
  maPeriodFast: 15,
  maPeriodSlow: 200,
  atrPeriod:    14,
  atrMult1:     1.3,
  bodyRatio1:   0.9,
  atrMult2:     0.3,
  bodyRatio2:   0.3,
};

// Descripteur attendu par lib/signals/data.js.
export const KO_PATTERN = {
  name:     'ko',
  detect:   calcKO,
  defaults: DETECT_DEFAULTS,
};

// Détection seule — à appeler UNE fois, puis à réinjecter dans chaque simulation.
export function detectSignals(candles, detect = {}) {
  return calcKO(candles, { ...DETECT_DEFAULTS, ...detect });
}

// { candles, ranges, m1, signals } — tout ce qu'il faut pour simuler, en cache.
export const loadKO = (symbolId, tf, detect) =>
  loadSignals(KO_PATTERN, symbolId, tf, detect);
