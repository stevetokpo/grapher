// Les conditions élémentaires portant sur UNE bougie, partagées par les familles
// de motifs qui les emploient.
//
// Elles vivaient dans lib/xfvg/detect.js, qui les avait inventées. Elles en sont
// sorties le jour où un second motif autonome (lib/liq) a eu besoin des mêmes :
// le faire importer lib/xfvg aurait rendu un pattern indépendant dépendant d'un
// autre, pour trois fonctions qui n'appartiennent en propre à aucun des deux.
// Ici, chaque motif importe vers le bas et aucun ne connaît son voisin — mais
// tous posent LITTÉRALEMENT la même question à une bougie.
//
// Chaque prédicat reçoit x, le contexte du candidat : { atr, i, m ou c, isBull }.
//   i désigne toujours la bougie qui PRÉCÈDE celle qu'on juge, parce que c'est
//   là qu'on lit l'ATR — juger une bougie avec un ATR qui la contient déjà
//   reviendrait à la comparer à elle-même.
//
// Les réglages (p) gardent les mêmes NOMS d'un motif à l'autre : atrMult et
// sizeMode pour l'impulsion, atrMult3 et wick3 pour la respiration. Chaque motif
// est libre de les exposer sous le libellé qu'il veut dans son panneau, mais pas
// de les rebaptiser dans son objet de réglages, sinon ces prédicats ne les
// trouveraient plus.

// L'IMPULSION est large : elle mesure au moins atrMult × ATR. `m` est la bougie
// jugée, l'ATR étant lu en i−1.
//   sizeMode 'range' — amplitude haut−bas (défaut) | 'body' — corps |clôture−ouverture|
export function impulseIsLarge(x, p) {
  const ref = x.atr[x.i - 1];
  if (ref == null) return false;
  const size = p.sizeMode === 'body'
    ? Math.abs(x.m.close - x.m.open)
    : x.m.high - x.m.low;
  return size >= p.atrMult * ref;
}

// La RESPIRATION n'avance plus : son corps tient sous atrMult3 × ATR. Toujours le
// corps, quel que soit sizeMode — ce qu'on veut voir, c'est une bougie qui ne va
// nulle part. `c` est la bougie jugée, l'ATR lu en i.
export function breathIsSmall(x, p) {
  const ref = x.atr[x.i];
  if (ref == null) return false;
  return Math.abs(x.c.close - x.c.open) <= p.atrMult3 * ref;
}

// La RESPIRATION rejette : sa mèche du côté d'où vient le mouvement dépasse son
// corps — mèche BASSE si l'impulsion qui précède est haussière, HAUTE si elle est
// baissière. Combinée à la précédente, ça dessine un marteau ou une étoile
// filante.
export function breathHasWick(x) {
  const body = Math.abs(x.c.close - x.c.open);
  const wick = x.isBull
    ? Math.min(x.c.open, x.c.close) - x.c.low
    : x.c.high - Math.max(x.c.open, x.c.close);
  return wick > body;
}

// Les conditions sont-elles seulement allumées ? Une seule lecture des réglages,
// pour que « éteint » veuille dire la même chose partout.
export const usesImpulseSize = p => p.atrPeriod > 0 && p.atrMult  > 0;
export const usesBreathSize  = p => p.atrPeriod > 0 && p.atrMult3 > 0;
export const usesBreathWick  = p => p.wick3 === true;
