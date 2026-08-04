// Twins Bars — deux bougies COLLÉES, de sens opposés, à corps plein et de
// taille comparable.
//
//     bougie 1 ↓ (corps plein)   ·   bougie 2 ↑ (corps plein, taille voisine)
//
//   • CORPS PLEIN — le corps vaut au moins la somme des deux mèches. La bougie
//     va quelque part et n'y renonce pas.
//   • TAILLE VOISINE — min(corps) / max(corps) ≥ `similarityRatio`. C'est ce qui
//     fait des JUMELLES plutôt qu'une grande suivie d'une petite.
//   • TAILLE ABSOLUE — les deux corps dépassent ATR(`atrPeriod`) × `atrMult`,
//     l'ATR étant calculé sur la fenêtre qui se termine JUSTE AVANT la paire
//     (i−2) : sinon il contiendrait déjà les bougies qu'on juge.
//   • SENS OPPOSÉS — l'une monte, l'autre descend. Le signal suit la SECONDE :
//     baissière puis haussière = achat, haussière puis baissière = vente.
//   • BALAYAGE DU SWING PRÉCÉDENT (`swingFilter`) — OPTION, éteinte par défaut.
//     Allumée, la paire doit être allée CHERCHER la dernière structure d'en
//     face, et la dépasser :
//         HB (haussière puis baissière, signal de VENTE) → le plus HAUT des deux
//           doit passer au-dessus du dernier swing HAUT ;
//         BH (baissière puis haussière, signal d'ACHAT) → le plus BAS des deux
//           doit passer sous le dernier swing BAS.
//     C'est le même extrême que celui qui porte le stop : le motif ne se contente
//     plus d'exister, il doit avoir pris quelque chose. Sans swing précédent
//     connu — début des données, ou `swingBars` trop grand pour qu'il en existe
//     un — la paire est ÉCARTÉE : on ne devine pas une structure qu'on n'a pas.
//
// Ce fichier ne fait que DÉTECTER. La prise de position vit dans ./positions.js
// et délègue au simulateur partagé de la famille (lib/patternPositions.js).
//
// D'OÙ VIENT CE CODE. Il était dans lib/patterns.js, qui l'exporte encore par
// simple réexport : la stratégie de backtest lib/backtest/strategies/twinsBars.js
// et tout autre lecteur continuent de l'importer de là sans rien savoir de ce
// déménagement. Les RÈGLES et les valeurs par défaut n'ont pas bougé d'un iota —
// le nombre de signaux est exactement celui d'avant.
//
// Chaque signal : { time, value, side, idx, level, fromIdx, toIdx,
//                   swingIdx, swingPrice }
//   time/value — ce que lisent les marqueurs du graphe (la flèche se pose sur
//                la seconde bougie, au prix extrême de la paire).
//   fromIdx/toIdx — les DEUX bougies du motif. Le simulateur y appuie son stop
//                structurel et entre sur `toIdx + 1`.
//   level      — l'extrême de la paire : le plus BAS des deux en achat, le plus
//                HAUT en vente. C'est le même prix que `value`, nommé comme le
//                reste de la famille pour que le rapport ait la même forme.
//   swing*     — le swing balayé : son indice et son prix, ou null quand le
//                filtre est éteint. Rien ne le dessine ; il est là pour qu'une
//                détection se vérifie à la main sans refaire le calcul.

// Les chaînes de swings sont prises à leur SOURCE (lib/signals/engine.js) et non
// à l'adresse historique par laquelle le xFVG y accède (lib/patterns.js) : c'est
// patterns.js qui réexporte notre propre détection, et passer par lui ferait un
// cycle d'imports.
import { prevSwingChains } from '../signals/engine';
import { DETECT_DEFAULTS } from './params';

export function calcTwinsBars(candles, opts = {}) {
  const { direction, atrPeriod, atrMult, similarityRatio, swingFilter, swingBars } =
    { ...DETECT_DEFAULTS, ...opts };
  const results = [];
  const n = candles?.length ?? 0;

  // Les chaînes de swings ne sont calculées que si le filtre les demande — un
  // motif dont le filtre est éteint ne paie pas la passe.
  const useSwing = swingFilter === true && swingBars > 0;
  const swings   = useSwing ? prevSwingChains(candles, swingBars) : null;

  function isFull(bar) {
    const body      = Math.abs(bar.close - bar.open);
    const upperWick = bar.high - Math.max(bar.open, bar.close);
    const lowerWick = Math.min(bar.open, bar.close) - bar.low;
    return body > 0 && body >= upperWick + lowerWick;
  }

  for (let i = 1; i < n; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];

    if (!isFull(prev) || !isFull(curr)) continue;

    const prevBody = Math.abs(prev.close - prev.open);
    const currBody = Math.abs(curr.close - curr.open);

    if (Math.min(prevBody, currBody) / Math.max(prevBody, currBody) < similarityRatio) continue;

    const isBull = prev.close < prev.open && curr.close > curr.open;
    const isBear = prev.close > prev.open && curr.close < curr.open;

    if (direction === 'bull' && !isBull) continue;
    if (direction === 'bear' && !isBear) continue;
    if (!isBull && !isBear) continue;

    // Taille absolue — les deux corps > ATR(atrPeriod) × atrMult.
    // La fenêtre d'ATR se termine en i−2, la bougie qui précède la paire.
    if (atrPeriod > 0) {
      const atrEnd   = i - 2;
      const atrBegin = atrEnd - atrPeriod + 1;
      if (atrBegin < 1) continue; // need prev close for first TR
      let sumTR = 0;
      for (let k = atrBegin; k <= atrEnd; k++) {
        sumTR += Math.max(
          candles[k].high - candles[k].low,
          Math.abs(candles[k].high - candles[k - 1].close),
          Math.abs(candles[k].low  - candles[k - 1].close),
        );
      }
      const threshold = (sumTR / atrPeriod) * atrMult;
      if (prevBody <= threshold || currBody <= threshold) continue;
    }

    const level = isBull ? Math.min(prev.low, curr.low) : Math.max(prev.high, curr.high);

    // Balayage du swing précédent. On part de la PREMIÈRE bougie de la paire :
    // la chaîne rend le dernier swing situé strictement avant elle, donc ceux
    // que la paire forme elle-même ne sont jamais candidats.
    //
    // Et il faut qu'il ait été CONFIRMÉ à la clôture du motif : un swing d'indice
    // j ne l'est qu'à j + swingBars, et en retenir un que la paire ne pouvait pas
    // encore voir ferait entrer sur une structure venue du futur. On ne cherche
    // pas plus loin dans ce cas — c'est LE swing précédent qui compte, pas
    // « l'un des précédents » : si celui-là n'est pas confirmé, il n'y a rien à
    // balayer.
    let swingIdx = -1, swingPrice = null;
    if (useSwing) {
      const j = (isBull ? swings.lows : swings.highs)[i - 1];
      if (j < 0 || j + swingBars > i) continue;
      swingPrice = isBull ? candles[j].low : candles[j].high;
      // Strictement au-delà : toucher le swing sans le dépasser n'est pas l'avoir
      // pris, et c'est la même stricte inégalité qui définit le swing lui-même.
      if (isBull ? !(level < swingPrice) : !(level > swingPrice)) continue;
      swingIdx = j;
    }

    results.push({
      time:  curr.time,
      value: level,
      side:  isBull ? 'bull' : 'bear',
      // Repères de la figure. Le motif tient sur DEUX bougies collées : la
      // première est i−1, la seconde i, et l'entrée se fera sur i+1.
      idx:     i,
      fromIdx: i - 1,
      toIdx:   i,
      level,
      // Le swing balayé, quand le filtre est allumé.
      swingIdx:   swingIdx >= 0 ? swingIdx : null,
      swingPrice: swingIdx >= 0 ? swingPrice : null,
    });
  }

  return results;
}
