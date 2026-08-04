// RSIER — la prise de position.
//
// Le motif détecte ; la gestion est celle, commune, de lib/patternPositions.js —
// la même que celle du Twins Bars, du liq et du rev. C'est voulu : quatre motifs
// mesurés par le même code, sinon un écart de résultat ne dit plus si la
// détection ou la sortie en est responsable.
//
// DEUX CHOSES SONT PROPRES À CE MOTIF, et elles tiennent toutes deux au fait
// qu'il marque du TEMPS et non un prix :
//
//   1. QUAND ON ENTRE. Une position par ENTRÉE en surzone — pas une par bougie
//      de la zone —, au marché, à l'OUVERTURE de la bougie qui ouvre la bande.
//      La bougie HTF qui a fait basculer le RSI s'est clôturée AVANT que
//      celle-ci ne s'ouvre : son RSI est donc déjà connu à cet instant, et il n'y
//      a aucune anticipation à entrer là. C'est le premier prix disponible une
//      fois la surzone constatée.
//      Traduit dans le contrat de signaux du simulateur (qui entre à l'ouverture
//      de `toIdx + 1`) : toIdx = la bougie qui PRÉCÈDE l'ouverture de la zone.
//      `entryMode` est réimposé à 'market' quoi qu'en dise un réglage enregistré —
//      la bande n'a aucun bord de prix où un ordre pourrait attendre, et laisser
//      passer 'zone' ferait chercher au simulateur un `top`/`bottom` que la
//      détection ne fournit pas. Conséquence : aucun signal 'missed'.
//
//   2. SUR QUOI S'APPUIE LE STOP STRUCTUREL. Le motif ne désigne aucune bougie
//      remarquable : il n'a pas de structure à lui. Le mode 'structure' regarde
//      donc les `slLookback` bougies qui PRÉCÈDENT l'entrée — le dernier extrême
//      que le marché a laissé avant qu'on entre. C'est exactement ce que le
//      simulateur sait faire avec fromIdx…toIdx, sans qu'il ait à connaître ce
//      motif. Une zone qui s'ouvre trop tôt dans les données pour qu'on dispose
//      de ces N bougies est ÉCARTÉE : inventer un ancrage sur ce qu'on n'a pas
//      chargé donnerait un risque faux, et donc un R faux.
//
// LE SENS JOUÉ (`tradeSide`) est un réglage, pas un choix caché : 'reversion'
// achète la survente et vend le surachat ; 'continuation' fait exactement
// l'inverse. Le SENS DE LA ZONE, lui, ne bouge jamais — une bande verte reste une
// survente, même quand on la vend.

import { calcRsier } from './detect';
import { DETECT_DEFAULTS, POSITION_DEFAULTS } from './params';
import { simulatePatternPositions } from '../patternPositions';

// `htfSeries` : la série HTF servie par /api/htf, comme pour la détection. Sans
// elle le RSI n'a que ce que le graphe a chargé (cf. calcRsier).
export function calcRsierPositions(candles, opts = {}, htfSeries = null) {
  const p = { ...DETECT_DEFAULTS, ...POSITION_DEFAULTS, ...opts, entryMode: 'market' };
  const { zones, warmup } = calcRsier(candles, p, htfSeries);

  const look    = Math.max(1, Math.round(p.slLookback ?? POSITION_DEFAULTS.slLookback));
  const flip    = p.tradeSide === 'continuation';
  const signals = [];
  let skippedByHistory = 0;

  for (const z of zones) {
    const toIdx   = z.startIdx - 1;      // l'entrée sera l'ouverture de startIdx
    const fromIdx = toIdx - look + 1;
    if (fromIdx < 0) { skippedByHistory++; continue; }

    signals.push({
      side:    flip ? (z.side === 'bull' ? 'bear' : 'bull') : z.side,
      fromIdx,
      toIdx,
      // Le motif ne marque AUCUN prix : le champ existe pour que toutes les
      // positions de la famille aient la même forme, il vaut null ici.
      level:   null,
      // Repères de lecture, portés jusqu'au rapport par le simulateur.
      zoneSide: z.side,
      rsiStart: z.rsiStart,
      htf:      z.htf,
    });
  }

  const trades = simulatePatternPositions(candles, signals, p, 'RSIER');
  // Ce que la simulation n'a pas pu jouer, et pourquoi. Deux comptes du même
  // ordre que `skippedByUnique` : ils appartiennent au décompte des signaux, pas
  // aux statistiques d'issue.
  trades.skippedByHistory = skippedByHistory;
  trades.zonesTotal       = zones.length;
  trades.warmup           = warmup;
  return trades;
}
