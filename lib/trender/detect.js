// TRENDER (motif) — les zones d'harmonie, telles que l'indicateur les calcule.
//
// IL N'Y A PAS DE DÉTECTION ICI, et c'est volontaire : le motif appelle
// `calcHarmony` (lib/harmony.js), la MÊME fonction que l'indicateur TRENDER du
// panneau des indicateurs et que la stratégie de backtest trenderHarmony. Une
// zone du motif et une zone de l'indicateur sont donc la même zone, au dernier
// chiffre près. Recopier la logique ici l'aurait fait diverger au premier
// réglage ajouté d'un seul côté.
//
// Ce fichier n'ajoute qu'une chose, et elle ne crée aucune zone : le FILTRE DE
// SENS. Il retient, il n'invente pas. Il vit ici plutôt que dans le graphe ou
// dans les positions pour que les bandes dessinées et les positions jouées
// soient toujours les mêmes zones — sans quoi on jouerait des zones invisibles,
// ou l'inverse.

import { calcHarmony } from '../harmony';
import { DETECT_DEFAULTS } from './params';

// Renvoie { zones, warmup } — cf. calcHarmony. `htfSeries` est la série servie
// par /api/htf ; sans elle, elle est reconstruite depuis les bougies du graphe,
// ce qui suppose une fenêtre assez profonde (une Bollinger 50 en H16 réclame
// ~34 jours).
export function calcTrenderZones(candles, opts = {}, htfSeries = null) {
  const p = { ...DETECT_DEFAULTS, ...opts };
  const { zones, warmup } = calcHarmony(candles, p, htfSeries);

  const dir = p.direction ?? 'both';
  return {
    zones: dir === 'both' ? zones : zones.filter(z => z.side === dir),
    warmup,
  };
}
