// xFVG+ — la prise de position.
//
// Le motif détecte (./detect.js) ; la gestion est celle, commune, de
// lib/patternPositions.js — la même que celle du liq, du rev, du Twins Bars, du
// RSIER et du TRENDER. C'est voulu : six motifs mesurés par le même code, sinon
// un écart de résultat ne dit plus si la détection ou la sortie en est
// responsable.
//
// CE QUI EST PROPRE À CE MOTIF tient en une idée : ON ATTEND LE TRAIT.
//
//   1. OÙ L'ORDRE EST POSÉ. Sur le swing que l'impulsion a cassé — le trait blanc
//      tracé dans la boîte —, plus ou moins `entryMarginPts` POINTS. La marge est
//      SIGNÉE et se compte par rapport au côté d'où le prix revient, jamais vers
//      le haut ou vers le bas : positive, l'ordre est EN DEÇÀ du trait (au-dessus
//      pour un motif haussier, en dessous pour un baissier) et sera servi plus
//      tôt ; négative, il est AU-DELÀ et exige que le prix dépasse le trait.
//      Traduit dans le contrat du simulateur : une bande de HAUTEUR NULLE, top et
//      bottom sur ce niveau. Un ordre en attente au bord d'une bande sans hauteur
//      EST un ordre au niveau — le mode 'zone' le remplit exactement comme il
//      faut, sans qu'il ait à connaître ce motif. Ce que ça donne, avec ses
//      garde-fous (le prix doit d'abord être HORS du niveau pour qu'il y
//      « revienne », remplissage à l'ouverture si la bougie a ouvert au-delà,
//      annulation après `entryWaitBars`), est documenté là-bas.
//
//   2. QUAND. La figure se termine en `idx + 1` dans les DEUX modes du xFVG (la
//      3e bougie en 'x3', la respiration en 'x2') : le motif n'est connu qu'à sa
//      clôture, et l'ordre ne peut donc pas exister avant la bougie suivante.
//      C'est exactement `toIdx + 1`, ce que le simulateur prend pour première
//      bougie où l'ordre est armé.
//
//   3. LE STOP ET L'OBJECTIF, deux distances FIXES en points depuis l'entrée
//      (slMode / tpMode réimposés sur 'points'). Le motif n'a pas de stop
//      structurel qui lui soit propre : la boîte est déjà ce qu'on joue, et s'en
//      servir de stop attacherait le risque au hasard de la taille de
//      l'impulsion. Conséquence à connaître : le risque est CONSTANT, points et R
//      disent la même chose, et le seuil de rentabilité redevient le 1/(1+RR).
//
// `fromIdx` désigne la première bougie de la figure — i−1 en mode 3 bougies, i en
// mode 2 bougies. Le stop étant en points, il ne sert à rien ici ; il est juste
// pour que le rapport pointe la BONNE figure sur le graphe, et pour qu'un futur
// stop structurel n'ait pas à redécouvrir où le motif commence.

import { calcXfvgExtra } from './detect';
import { DETECT_DEFAULTS, POSITION_DEFAULTS } from './params';
import { simulatePatternPositions } from '../patternPositions';

export function calcXfvgxPositions(candles, opts = {}) {
  const p = {
    ...DETECT_DEFAULTS, ...POSITION_DEFAULTS, ...opts,
    // Non négociables, même si un réglage enregistré disait autre chose : ce sont
    // les règles du motif, pas des préférences. Cf. l'en-tête, et lib/xfvgx/params.js.
    swing:     'extra',
    entryMode: 'zone',
    slMode:    'points',
    tpMode:    'points',
  };

  const zones  = calcXfvgExtra(candles, p);
  // Le mode inconnu retombe sur 'x3', comme dans calcXFVG : le motif enregistré
  // avant qu'il y ait des modes reste jouable, et `fromIdx` ne ment pas.
  const twoBar = p.mode === 'x2';
  const margin = p.entryMarginPts ?? 0;

  const signals = [];
  for (const z of zones) {
    // Par construction un extra porte son swing — la sélection est faite là-dessus.
    // Le test reste : sans niveau il n'y a pas d'ordre à poser, et inventer une
    // entrée au marché ferait passer pour ce motif quelque chose qui n'est pas lui.
    if (z.swingPrice == null) continue;

    // La marge, du côté d'où le prix REVIENT : au-dessus du trait pour un motif
    // haussier (on achète le retour vers le bas), en dessous pour un baissier.
    const level = z.side === 'bull' ? z.swingPrice + margin : z.swingPrice - margin;

    signals.push({
      side:    z.side,
      fromIdx: twoBar ? z.idx : z.idx - 1,
      toIdx:   z.idx + 1,
      // Une bande de hauteur NULLE : c'est ainsi qu'un ordre au niveau se dit
      // dans le contrat du simulateur.
      top:     level,
      bottom:  level,
      level,
      // Repères portés jusqu'au rapport, pour qu'une position se relise sans
      // avoir à relancer la détection : le trait lui-même, et la boîte du motif.
      swingPrice: z.swingPrice,
      zoneTop:    z.top,
      zoneBottom: z.bottom,
    });
  }

  const trades = simulatePatternPositions(candles, signals, p, 'xFVG+');
  // Combien de motifs la détection a trouvés en tout — le rapport aurait sinon
  // moins de positions que de zones sans jamais dire pourquoi (une figure trop
  // près du bord des données n'a pas de bougie où poser l'ordre).
  trades.zonesTotal = zones.length;
  return trades;
}
