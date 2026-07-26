// Twins Bars: two consecutive candles that are both "full", of similar size, and
// large vs ATR.
//
// Rule 1 — Full candle: body >= upper_wick + lower_wick
// Rule 2 — Similar size: min(body1, body2) / max(body1, body2) >= 0.7
// Rule 3 — Size (atrPeriod > 0): both TB bodies > ATR(atrPeriod) * atrMult,
//           ATR computed on the candles ending just before the pair.
// direction: 'bull' (bear→bull) | 'bear' (bull→bear) | 'both'
export function calcTwinsBars(candles, { direction = 'both', atrPeriod = 7, atrMult = 1.5, similarityRatio = 0.7 } = {}) {
  const results = [];
  const n = candles.length;

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

    // Rule 3 — both bodies > ATR(atrPeriod) * atrMult.
    // ATR window ends at i-2 (candle just before the pair).
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

    results.push({
      time:  curr.time,
      value: isBull ? Math.min(prev.low, curr.low) : Math.max(prev.high, curr.high),
      side:  isBull ? 'bull' : 'bear',
    });
  }

  return results;
}

// Fair Value Gap (FVG) + inverse FVG (iFVG) — drawn as price zones, not markers.
//
// A FVG is a 3-candle imbalance between candle[i-1] and candle[i+1] (the middle
// candle being the impulse that left the gap):
//   • Bullish: candle[i+1].low  > candle[i-1].high  (untraded gap below price)
//   • Bearish: candle[i+1].high < candle[i-1].low   (untraded gap above price)
//
// Lifecycle, by scanning the candles formed after the gap:
//   active     — price has not re-entered the gap
//   mitigated  — a wick tapped into the gap (kept on screen, but greyed)
//   inverse    — a candle CLOSED through the far side: the FVG flips into an
//                iFVG of the opposite bias (old support becomes resistance, …)
//                keeping the same price levels but starting at the break.
//
// Each zone: { side, state, top, bottom, startTime, endTime }
//   top/bottom  price bounds (top > bottom)
//   endTime     null → the box extends to the right edge of the chart
//
// Options:
//   direction      'bull' | 'bear' | 'both'
//   showMitigated  include greyed (touched / consumed) gaps   (default true)
//   showInverse    emit iFVG zones on a close-through          (default true)
//   minPts         ignore gaps thinner than this (price units, 0 = off)
//   atrPeriod / atrMin / atrMax
//                  the MIDDLE candle — the one that opens the gap — must have a
//                  range between atrMin×ATR and atrMax×ATR, the ATR being read
//                  BEFORE it. Keeps out both the gaps left by a candle too small
//                  to mean anything and those left by a spike (0 = bound off).
//                  Portage de pines/trender.pine.

// ATR de Wilder (RMA des true ranges) — comme Pine ta.atr.
function atrArr(candles, period) {
  const n = candles.length;
  const out = new Array(n).fill(null);
  if (period < 1 || n < 2) return out;

  let sum = 0, prev = null;
  for (let i = 1; i < n; i++) {
    const c = candles[i], p = candles[i - 1];
    const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    if (i <= period) {
      sum += tr;
      if (i === period) { prev = sum / period; out[i] = prev; }
    } else {
      prev = (prev * (period - 1) + tr) / period;
      out[i] = prev;
    }
  }
  return out;
}

// Moyenne mobile simple, alignée sur l'index des bougies (null avant la période).
function smaArr(candles, period) {
  const n = candles.length;
  const out = new Array(n).fill(null);
  if (period < 1) return out;

  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function calcFVG(candles, {
  direction = 'both', showMitigated = true, showInverse = true, maxLen = 0,
  minPts = 0, atrPeriod = 14, atrMin = 0, atrMax = 0,
} = {}) {
  const zones = [];
  const n = candles.length;

  const useAtr = atrPeriod > 0 && (atrMin > 0 || atrMax > 0);
  const atr    = useAtr ? atrArr(candles, atrPeriod) : null;

  // If maxLen > 0, cap an open-ended zone so it stops at startIdx + maxLen.
  // Already-bounded zones (endTime !== null) are left untouched.
  const capEnd = (startIdx, endTime) => {
    if (!maxLen || endTime !== null) return endTime;
    const capIdx = startIdx + maxLen;
    return capIdx < n ? candles[capIdx].time : null;
  };

  for (let i = 1; i < n - 1; i++) {
    const a = candles[i - 1];
    const c = candles[i + 1];

    let side, bottom, top;
    if (c.low > a.high)      { side = 'bull'; bottom = a.high;  top = c.low; }
    else if (c.high < a.low) { side = 'bear'; bottom = c.high;  top = a.low; }
    else continue;

    if (direction === 'bull' && side !== 'bull') continue;
    if (direction === 'bear' && side !== 'bear') continue;

    // Gap trop mince pour signifier quoi que ce soit
    if (minPts > 0 && top - bottom < minPts) continue;

    // La bougie centrale (i) est celle qui creuse le gap : son amplitude doit
    // tenir dans la bande ATR. L'ATR est lu AVANT elle (i-1), sinon il
    // contiendrait déjà la bougie qu'on cherche à qualifier.
    if (useAtr) {
      const a = atr[i - 1];
      if (a == null) continue;
      const range = candles[i].high - candles[i].low;
      if (atrMin > 0 && range < atrMin * a) continue;
      if (atrMax > 0 && range > atrMax * a) continue;
    }

    const startTime = candles[i].time;

    // First wick to tap the gap (mitigation) and first close through it (inversion).
    let touched = false, invIdx = -1;
    for (let j = i + 2; j < n; j++) {
      const k = candles[j];
      const tapped = side === 'bull' ? k.low  <= top    : k.high >= bottom;
      const closed = side === 'bull' ? k.close < bottom : k.close > top;
      if (tapped) touched = true;
      if (closed) { invIdx = j; break; }
    }

    if (invIdx === -1) {
      if (!touched) {
        zones.push({ side, state: 'active', top, bottom, startTime, endTime: capEnd(i, null) });
      } else if (showMitigated) {
        zones.push({ side, state: 'mitigated', top, bottom, startTime, endTime: capEnd(i, null) });
      }
      continue;
    }

    // Closed through → original FVG is consumed up to the break candle…
    const invTime = candles[invIdx].time;
    if (showMitigated) {
      zones.push({ side, state: 'mitigated', top, bottom, startTime, endTime: invTime });
    }
    // …and an inverse FVG of the opposite bias takes over from the break.
    if (showInverse) {
      const invSide = side === 'bull' ? 'bear' : 'bull';
      let ifvgEnd = null;
      for (let j = invIdx + 1; j < n; j++) {
        const k = candles[j];
        const broke = invSide === 'bull' ? k.close < bottom : k.close > top;
        if (broke) { ifvgEnd = k.time; break; }
      }
      zones.push({ side: invSide, state: 'inverse', top, bottom, startTime: invTime, endTime: capEnd(invIdx, ifvgEnd) });
    }
  }

  return zones;
}

// rFVG / aFVG — imbalance 3 bougies dont la bougie CENTRALE (celle qui creuse le
// gap) est directionnelle et large. Cf. pines/rFVG.pine, même détection.
//
// MOTIF DE BASE, commun aux deux — la centrale est directionnelle, et les deux
// bougies qui l'encadrent définissent deux NIVEAUX dont l'écart signé est le gap :
//   • baissier : bougie centrale BAISSIÈRE, gap = candle[i-1].low − candle[i+1].high
//   • haussier : bougie centrale HAUSSIÈRE, gap = candle[i+1].low − candle[i-1].high
//
//   gap > 0 → VIDE : les deux bougies ne se touchent pas, la zone est le vide
//             laissé entre elles (le FVG classique).
//   gap < 0 → CHEVAUCHEMENT : elles se recouvrent, et la zone est la bande
//             commune aux deux — mêmes niveaux, simplement inversés.
//   Dans les deux cas la zone va de min à max des deux niveaux ; `minPts` (qui
//   peut être NÉGATIF) fixe le gap minimum accepté et décide donc à lui seul si
//   les chevauchements comptent : 0 = vide strict (comportement historique),
//   −5 = on tolère jusqu'à 5 points de recouvrement, −∞ = tout passe.
//   Un gap exactement nul est toujours rejeté : la zone serait plate.
//
//   Taille : la centrale doit mesurer >= atrMult × ATR(atrPeriod). L'ATR est lu
//   AVANT elle (i-1), sinon il contiendrait déjà la bougie à qualifier.
//     sizeMode 'range' — amplitude high−low (défaut) | 'body' — corps |close−open|
//
//   Petitesse de la 3e bougie (atrMult3 > 0) : son CORPS |close−open| doit rester
//   <= atrMult3 × ATR(atrPeriod), l'ATR étant lu sur la centrale (i), la bougie
//   qui précède la 3e. Toujours le corps, quel que soit sizeMode.
//
//   Rejet de la 3e bougie (wick3) : sa mèche du côté du motif doit être plus
//   grande que son corps — mèche BASSE > corps si le motif est haussier, mèche
//   HAUTE > corps s'il est baissier. Combiné à atrMult3, ça donne un marteau
//   (haussier) ou une étoile filante (baissier) à l'endroit de la pré-entrée.
//
// LES MODES ne diffèrent que par la position de la centrale vs les deux MM
// (rapide + lente), plus un filtre optionnel sur le sens de la 3e bougie :
//   • mode 'rfvg' (défaut) — RETOURNEMENT : la centrale va à contre-courant de son
//     côté de la moyenne et ne touche NI l'une NI l'autre — baissière entièrement
//     AU-DESSUS des deux MM, ou haussière entièrement EN DESSOUS des deux. Les
//     deux conditions doivent être vraies en même temps.
//   • mode 'all' — la position vs les MM n'est pas regardée : tout motif de base
//     compte, rFVG inclus (aFVG ⊇ rFVG). Chaque zone porte le label de ce qu'elle
//     est vraiment : 'rFVG' si elle respecte aussi les deux MM, 'aFVG' sinon.
//   • mode 'super' — sous-ensemble des rFVG (mêmes conditions que le mode
//     'rfvg') dont la 3e bougie (celle qui referme le gap) clôture à CONTRE-SENS
//     du motif : rFVG haussier + 3e bougie baissière, ou rFVG baissier + 3e
//     bougie haussière. Zones étiquetées 'superFVG'.
//
// Deux sens, et c'est tout : haussier, baissier. Pas de gap comblé grisé, pas
// d'inversion (irFVG) — la zone est une simple boîte, tirée à droite sur extLen
// barres puis coupée net.
//
// Chaque zone : { side, state: 'active', label, top, bottom, gap, startTime, endTime }
//   endTime null → extLen dépasse la fin des données, la boîte va jusqu'au bord droit.
//
// Options :
//   mode           'rfvg' | 'all' | 'super'
//   direction      'bull' | 'bear' | 'both'
//   maPeriodFast   période de la MM rapide (défaut 15)
//   maPeriodSlow   période de la MM lente (défaut 200)
//   atrPeriod      période de l'ATR (défaut 14)
//   atrMult        le « x » de « taille >= x × ATR » (défaut 1.5, 0 = filtre off)
//   atrMult3       le « x » de « corps de la 3e bougie <= x × ATR » (défaut 0 = off)
//   wick3          true = exige la mèche de rejet sur la 3e bougie (défaut false)
//   sizeMode       'range' | 'body'
//   minPts         gap minimum accepté (unités de prix, SIGNÉ). 0 = vide strict,
//                  négatif = accepte le chevauchement jusqu'à cette profondeur
//   extLen         extension max de la zone, en barres à droite du gap (défaut 20)
export function calcRFVG(candles, {
  mode = 'rfvg', direction = 'both', minPts = 0,
  maPeriodFast = 15, maPeriodSlow = 200,
  atrPeriod = 14, atrMult = 1.5, atrMult3 = 0, wick3 = false,
  sizeMode = 'range', extLen = 20,
} = {}) {
  const zones = [];
  const n = candles.length;

  const maFast  = smaArr(candles, maPeriodFast);
  const maSlow  = smaArr(candles, maPeriodSlow);
  const useAtr  = atrPeriod > 0 && atrMult > 0;
  const useAtr3 = atrPeriod > 0 && atrMult3 > 0;
  const atr     = (useAtr || useAtr3) ? atrArr(candles, atrPeriod) : null;
  const onlyR   = mode !== 'all';

  for (let i = 1; i < n - 1; i++) {
    const a = candles[i - 1]; // précédente
    const m = candles[i];     // centrale — celle qui creuse le gap
    const c = candles[i + 1]; // suivante

    const avgFast = maFast[i];
    const avgSlow = maSlow[i];
    if (avgFast == null || avgSlow == null) continue;

    // Motif de base : centrale directionnelle. Le gap (vide ou chevauchement)
    // est mesuré plus bas et filtré par minPts. Pas de MM ici.
    const baseBear = m.close < m.open;
    const baseBull = m.close > m.open;

    // Condition de retournement : la centrale est entièrement du côté opposé à son
    // sens, sans toucher NI la MM rapide NI la MM lente — les deux à la fois.
    // C'est elle, et elle seule, qui sépare rFVG de aFVG.
    const maBear = m.low  > avgFast && m.low  > avgSlow;
    const maBull = m.high < avgFast && m.high < avgSlow;

    let isBear = baseBear && (!onlyR || maBear);
    let isBull = baseBull && (!onlyR || maBull);
    if (!isBear && !isBull) continue;

    // Mode 'super' : en plus d'être un rFVG, la 3e bougie (celle qui referme
    // le gap) doit clôturer à contre-sens du motif.
    if (mode === 'super') {
      if (isBear && !(c.close > c.open)) isBear = false;
      if (isBull && !(c.close < c.open)) isBull = false;
      if (!isBear && !isBull) continue;
    }

    const side  = isBear ? 'bear' : 'bull';
    const label = mode === 'super' ? 'superFVG' : ((isBear ? maBear : maBull) ? 'rFVG' : 'aFVG');
    if (direction === 'bull' && side !== 'bull') continue;
    if (direction === 'bear' && side !== 'bear') continue;

    // Les deux niveaux du motif, et leur écart signé. Positif = vide entre les
    // bougies, négatif = elles se chevauchent et la zone devient la bande
    // commune (les mêmes bornes, dans l'autre ordre).
    const hi  = isBear ? a.low  : c.low;
    const lo  = isBear ? c.high : a.high;
    const gap = hi - lo;

    if (gap === 0 || gap < minPts) continue;

    const top    = gap > 0 ? hi : lo;
    const bottom = gap > 0 ? lo : hi;

    if (useAtr) {
      const ref = atr[i - 1];
      if (ref == null) continue;
      const size = sizeMode === 'body' ? Math.abs(m.close - m.open) : m.high - m.low;
      if (size < atrMult * ref) continue;
    }

    // La 3e bougie doit rester petite : corps <= atrMult3 × ATR, l'ATR étant lu
    // sur la centrale (i), la bougie qui la précède.
    if (useAtr3) {
      const ref3 = atr[i];
      if (ref3 == null) continue;
      if (Math.abs(c.close - c.open) > atrMult3 * ref3) continue;
    }

    // Mèche de rejet sur la 3e bougie : du côté d'où vient le motif — la mèche
    // BASSE si le motif est haussier, la HAUTE s'il est baissier.
    if (wick3) {
      const body3 = Math.abs(c.close - c.open);
      const wick  = isBull
        ? Math.min(c.open, c.close) - c.low
        : c.high - Math.max(c.open, c.close);
      if (!(wick > body3)) continue;
    }

    const endIdx = i + extLen;
    zones.push({
      side,
      state:     'active',
      label,
      top,
      bottom,
      gap,                 // signé : > 0 vide entre les bougies, < 0 chevauchement
      startTime: m.time,
      endTime:   endIdx < n ? candles[endIdx].time : null,
      // Entrée (mode « position ») : au MARCHÉ à l'ouverture de la bougie qui
      // SUIT le motif — B4, la 4e. Le motif n'est connu qu'à la clôture de la
      // 3e, on prend donc le premier prix disponible après lui. null tant que
      // B4 n'existe pas (motif sur la dernière bougie chargée).
      entryIdx:   i + 2 < n ? i + 2 : null,
      entryTime:  i + 2 < n ? candles[i + 2].time : null,
      entryPrice: i + 2 < n ? candles[i + 2].open : null,
    });
  }

  return zones;
}

// rFVG en mode « position prise » — portage fidèle de la machine à états de
// mql5/superFVG-EA.mq5. Aucun ordre en attente : dès que le motif est complet
// (donc à la clôture de sa 3e bougie), la position est prise AU MARCHÉ à
// l'ouverture de la bougie suivante — B4. Elle est donc TOUJOURS prise ; il
// n'existe plus de position « ratée », ni d'expiration d'ordre.
//
// Numérotation du motif : B2 est la centrale (celle qui creuse le gap), B3 la
// bougie qui le referme, B4 celle de l'entrée.
//
// LE STOP N'EST PAS UNE DISTANCE — il est STRUCTUREL, et n'est posé qu'à la
// CLÔTURE de B4, sous/sur l'extrême des deux bougies B3-B4 :
//   • motif haussier (BUY)  → SL = min(bas B3,  bas B4)  − slMarginPts
//   • motif baissier (SELL) → SL = max(haut B3, haut B4) + slMarginPts
// Le risque `risk0 = |entrée − SL|` VARIE donc d'une position à l'autre : c'est
// la taille de B3-B4 qui le fait, plus la marge. Tout ce qui est exprimé en R
// (excursions, profit) doit être normalisé position par position, jamais par un
// SL global — il n'y en a plus.
//
// PENDANT TOUTE B4 la position est NON PROTÉGÉE : le stop n'existe pas encore,
// seul le TP est actif. Ce n'est pas un optimisme de simulation — le stop étant
// construit à partir du bas (resp. haut) de B4 lui-même, il ne PEUT pas être
// touché pendant B4. Un TP atteint sur B4 est donc un vrai TP, sans ambiguïté
// d'ordre intra-bougie. À partir de B5, stop et TP sont tous deux actifs.
//
// La position est ensuite simulée bougie par bougie :
//   • stop touché (la mèche franchit le stop courant) → sortie au PIRE du
//     stop et de l'open de la bougie (un gap ne remplit jamais au niveau) ;
//     exitReason 'sl' si c'est le stop structurel, 'be' si le stop déplacé
//   • TP touché                              → sortie à l'objectif, gain
//   • stop et TP dans la même bougie         → pessimiste : le stop gagne
//   • données épuisées avant résolution      → sortie à la dernière clôture,
//     exitReason 'open' (position encore en vie au bord droit, pas de trait)
//
// BREAK-EVEN — TROIS déclencheurs indépendants, aux EFFETS DIFFÉRENTS. Chacun
// s'arme une seule fois ; ils peuvent se cumuler si plusieurs sont réglés.
//   • PROFIT (beTriggerPts > 0) — DÉPLACE LE STOP. Une bougie avance de
//     beTriggerPts dans le sens de la position → le stop passe au niveau BE =
//     entrée ± beLevelPts (0 = entrée exacte, positif = gain verrouillé, négatif
//     = perte réduite). Évalué dès B4 : si B4 atteint le seuil, le stop BE est
//     posé à sa clôture, à la place du stop structurel.
//   • DURÉE (beBarsTrigger > 0) — DÉPLACE LE STOP au même niveau BE, dès que la
//     position dure depuis beBarsTrigger bougies. Elle sort alors au BE au
//     retour sur l'entrée, ou tout de suite si elle est déjà sous l'eau.
//   • RETOURS (beTouchTrigger > 0) — DÉPLACE LE TP, pas le stop. Dès que le prix
//     est REVENU beTouchTrigger fois sur l'entrée (cf. entryTouches ; B4 exclue),
//     le TP est ramené au MIROIR DU SL : même distance que le stop structurel,
//     côté profit — entrée ± risk0, soit un objectif à 1R. Le stop structurel
//     reste en place ; la position vise ce gain de 1R plutôt que le TP d'origine.
//     Sortie sur le TP réduit → 'tp' (un vrai gain) ; sur le stop → 'sl'. Le
//     drapeau beActivated / beReason='touch' garde la trace du déclenchement.
//     ATTENTION : entrée ± risk0 est « plus tôt » que le TP d'origine seulement
//     si risk0 < tpPts ; si le stop est plus large que le TP, le TP réduit est
//     plus LOIN — c'est la conséquence directe de « même distance que le SL ».
// Le stop déplacé ne peut jamais ÉLARGIR le risque : un niveau BE au-delà du
// stop structurel est ignoré. Pessimisme intra-bougie : le stop et le TP
// courants sont testés AVANT l'armement (un TP atteint sur la bougie de
// déclenchement l'emporte) ; un stop BE atteint sur sa bougie d'armement est
// rempli au pire du niveau et de l'open — un BE du mauvais côté du marché sort
// au marché, jamais mieux. `beReason` note le premier déclencheur armé
// ('profit'|'touch'|'bars').
//
// Chaque position reprend la forme attendue par TradesPrimitive :
//   { id, direction, entryTime, entryPrice, exitTime, exitPrice,
//     sl, tp, risk0, profitPoints, exitReason, status, label }
// `status` (== exitReason) déclenche le trait épais du milieu dans la
// primitive : vert 'tp', rouge 'sl', ambre 'be', rien pour 'open'.
//
// Pour l'étude trailing / break-even, chaque position porte aussi ses
// excursions, mesurées de B4 (l'entrée) à la bougie de sortie :
//   maxPullupPts   (MFE) — le plus loin que le prix est allé DANS le sens de
//     la position. Pour une sortie sur stop ('sl' ou 'be'), la bougie de
//     sortie est EXCLUE : rien ne prouve que son extrême favorable a précédé
//     le stop. Plafonné au TP.
//   maxDrawdownPts (MAE) — le plus loin CONTRE la position, bougie de sortie
//     incluse (pessimiste : la chaleur est supposée venir d'abord). Plafonné
//     à risk0 — avec un stop dur, on ne perd jamais plus. Sur B4, où le stop
//     n'existe pas, le plafond tient quand même : le stop est construit sous
//     l'extrême de B4.
//   maeArmedPts — la MÊME mesure, mais restreinte à la fenêtre où un stop
//     existe vraiment (B5 → sortie). C'est elle, et pas maxDrawdownPts, qui
//     répond à « et si le stop était plus serré ? » : un stop resserré reste
//     posé à la clôture de B4, donc la chaleur prise PENDANT B4 ne peut
//     toujours pas le déclencher. Avec une marge nulle, maxDrawdownPts vaut
//     mécaniquement 1 R sur toute position dont B4 fait le plus bas — s'en
//     servir ferait passer des gagnantes pour tuées. null si la position s'est
//     résolue sur B4 même : aucun stop n'a jamais existé pour elle.
//   barsHeld (bougies entre l'entrée et la sortie).
//   entryTouches — combien de fois le prix est REVENU sur le niveau d'entrée
//     pendant la vie de la position : une bougie dont l'amplitude contient ce
//     niveau (bas <= entrée <= haut) compte pour une. La bougie d'entrée B4 est
//     exclue — elle s'ouvre AU niveau, elle compterait toujours ; la bougie de
//     sortie, elle, est incluse. 0 = la position n'est jamais repassée par son
//     prix d'entrée, elle est allée droit à son sort.
//
// TRADE UNIQUE (optionnel, uniqueTrade) — une seule position à la fois. Tant
// qu'une position n'est pas clôturée, tout nouveau motif est IGNORÉ, dans le
// sens de la position en cours comme à contre-sens ; il ne produit rien, ni
// position ni trace. L'entrée se faisant à l'OUVERTURE de B4 — le tout premier
// prix de la bougie — un motif dont B4 tombe sur la bougie de sortie de la
// position précédente est lui aussi ignoré : à cet instant précis la position
// vit encore, elle ne se refermera que plus tard dans la bougie.
//
// COOLDOWN APRÈS UN GAIN (optionnel, skipAfterTp > 0) — après un TP réel, on
// SAUTE les `skipAfterTp` prochains signaux pour « se remettre en condition ».
// Chaque signal sauté est quand même simulé À BLANC : s'il aurait AUSSI été
// gagnant (TP), le compteur se recharge à skipAfterTp — on continue de se
// reposer tant que le marché aurait continué de payer, et on ne reprend qu'au
// premier signal qui n'aurait pas gagné. Les trades sautés NE FIGURENT PAS dans
// le rapport (ni gain, ni statistique de résultat) : ils ne servent qu'à piloter
// le compteur. Anti-lookahead : un signal n'est sauté que si son entrée tombe
// APRÈS la sortie du gain qui a armé le cooldown — donc son issue est déjà
// connue (garanti en mode trade unique, où les positions ne se chevauchent pas).
// En mode trade unique, un trade sauté occupe quand même le temps.
//
// Options : celles de calcRFVG (passées telles quelles à la détection), plus
//   slMarginPts   marge du stop sous/sur l'extrême B3-B4, en unités de prix
//   tpPts         distance de l'objectif, en unités de prix (> 0 sinon aucune position)
//   beTriggerPts  BE sur profit : seuil d'activation, en points de profit (0 = off)
//   beTouchTrigger BE sur retours : nombre de retours sur l'entrée requis (0 = off)
//   beBarsTrigger BE sur durée : nombre de bougies tenues requis (0 = off)
//   beLevelPts    niveau du stop déplacé, en points par rapport à l'entrée (défaut 0)
//   uniqueTrade   true = une seule position à la fois (défaut false)
//   skipAfterTp   nombre de signaux à sauter après un TP, avec recharge sur gain
//                 virtuel (0 = off)
export function calcRFVGPositions(candles, opts = {}) {
  const { slMarginPts = 2, tpPts = 10, beTriggerPts = 0, beLevelPts = 0,
          beTouchTrigger = 0, beBarsTrigger = 0, uniqueTrade = false,
          skipAfterTp = 0 } = opts;
  const trades = [];
  if (!(tpPts > 0)) return trades;

  const zones = calcRFVG(candles, opts);
  const n = candles.length;

  // Bougie de sortie de la dernière position prise — sert au mode trade unique.
  // Les zones sortent de calcRFVG dans l'ordre des bougies, donc les B4 aussi.
  let lastExitIdx = -1;

  // Cooldown après un gain (cf. bloc de doc). cooldown = signaux restant à
  // sauter ; armExit = bougie de sortie du gain qui a armé le repos (garde
  // anti-lookahead : on ne saute qu'un signal entrant APRÈS elle).
  let cooldown = 0, armExit = -1, skipped = 0, skippedWon = 0;

  let id = 1;
  for (const z of zones) {
    if (z.entryIdx == null) continue;   // B4 n'existe pas encore : rien à prendre
    if (uniqueTrade && z.entryIdx <= lastExitIdx) continue;   // déjà en position

    const isBuy = z.side === 'bull';
    const b4Idx = z.entryIdx;
    const b3    = candles[b4Idx - 1];
    const b4    = candles[b4Idx];
    const entry = z.entryPrice;         // ouverture de B4, au marché

    const tp = isBuy ? entry + tpPts : entry - tpPts;
    // Stop structurel, connu seulement à la clôture de B4.
    const sl = isBuy ? Math.min(b3.low,  b4.low)  - slMarginPts
                     : Math.max(b3.high, b4.high) + slMarginPts;
    const risk0 = Math.abs(entry - sl);
    if (!(risk0 > 0)) continue;         // stop collé à l'entrée : pas de position tenable

    // Break-even — trois déclencheurs indépendants (cf. bloc de doc). PROFIT et
    // DURÉE déplacent le STOP ; RETOURS déplace le TP.
    const beProfit = beTriggerPts   > 0;
    const beTouch  = beTouchTrigger > 0;
    const beBars   = beBarsTrigger  > 0;
    const beOn     = beProfit || beTouch || beBars;
    // Stop déplacé (profit/durée), borné par le structurel : resserre, jamais l'inverse.
    const beStop = isBuy ? Math.max(entry + beLevelPts, sl) : Math.min(entry - beLevelPts, sl);
    // TP réduit (retours) : miroir du SL, à risk0 de l'entrée côté profit.
    const tpTouch = isBuy ? entry + risk0 : entry - risk0;

    let slMoved = false, tpMoved = false, beTime = null, beReason = null;
    let touchCount = 0;   // retours sur l'entrée constatés en cours de route

    // Un stop traversé en gap est rempli au pire du niveau et de l'open de la
    // bougie — jamais mieux que le marché.
    const stopFill = (stop, k) => isBuy ? Math.min(stop, k.open) : Math.max(stop, k.open);

    let exitIdx = null, exitPrice = null, exitReason = null;

    // B4 — position non protégée, seul le TP peut la résoudre. Seul le BE sur
    // PROFIT peut s'y armer (déplace le stop) : les retours excluent B4 (elle
    // s'ouvre au niveau) et la durée y vaut zéro.
    if (isBuy ? b4.high >= tp : b4.low <= tp) {
      exitIdx = b4Idx; exitPrice = tp; exitReason = 'tp';
    } else if (beProfit) {
      const fav = isBuy ? b4.high - entry : entry - b4.low;
      if (fav >= beTriggerPts) { slMoved = true; beTime = b4.time; beReason = 'profit'; }
    }

    // B5 et au-delà — stop et TP COURANTS actifs jusqu'à l'un des deux.
    if (exitIdx == null) {
      for (let j = b4Idx + 1; j < n; j++) {
        const k = candles[j];
        const stop = slMoved ? beStop  : sl;
        const tpT  = tpMoved ? tpTouch : tp;
        // Stop d'abord (pessimiste) : 'be' si le stop a été déplacé, 'sl' sinon.
        if (isBuy ? k.low <= stop : k.high >= stop) {
          exitIdx = j; exitPrice = stopFill(stop, k); exitReason = slMoved ? 'be' : 'sl'; break;
        }
        // Puis le TP courant (réduit au miroir du SL si le BE retours a tapé).
        if (isBuy ? k.high >= tpT : k.low <= tpT) { exitIdx = j; exitPrice = tpT; exitReason = 'tp'; break; }
        if (beOn) {
          // Retour sur l'entrée pour cette bougie (B4 déjà exclue : j > b4Idx).
          if (k.low <= entry && k.high >= entry) touchCount++;
          const fav = isBuy ? k.high - entry : entry - k.low;

          // PROFIT / DURÉE → déplacent le stop au niveau BE (une seule fois).
          const profitFires = beProfit && fav >= beTriggerPts;
          const barsFires   = beBars   && j - b4Idx >= beBarsTrigger;
          if (!slMoved && (profitFires || barsFires)) {
            slMoved = true; beTime ??= k.time; beReason ??= profitFires ? 'profit' : 'bars';
            // Si la bougie d'armement a aussi atteint le niveau BE, sortie au BE,
            // remplie au pire du niveau et de l'open (BE du mauvais côté = marché).
            if (isBuy ? k.low <= beStop : k.high >= beStop) {
              exitIdx = j; exitPrice = stopFill(beStop, k); exitReason = 'be'; break;
            }
          }

          // RETOURS → déplace le TP au miroir du SL (une seule fois). Le TP
          // réduit peut être atteint dès la bougie d'armement.
          if (!tpMoved && beTouch && touchCount >= beTouchTrigger) {
            tpMoved = true; beTime ??= k.time; beReason ??= 'touch';
            if (isBuy ? k.high >= tpTouch : k.low <= tpTouch) {
              exitIdx = j; exitPrice = tpTouch; exitReason = 'tp'; break;
            }
          }
        }
      }
      if (exitIdx == null) {
        exitIdx    = n - 1;
        exitPrice  = candles[n - 1].close;
        exitReason = 'open';
      }
    }

    const isWin = exitReason === 'tp';

    // Cooldown après un gain : ce signal est sauté s'il entre APRÈS la sortie du
    // gain qui a armé le repos (garde anti-lookahead). Il est simulé à blanc —
    // s'il aurait gagné, on recharge — mais ne figure pas dans le rapport.
    if (cooldown > 0 && z.entryIdx > armExit) {
      cooldown -= 1;
      if (isWin) { cooldown = skipAfterTp; armExit = exitIdx; skippedWon++; }
      lastExitIdx = exitIdx;   // occupe le temps (trade unique)
      skipped++;
      continue;
    }

    // Excursions pendant la vie de la position (cf. bloc de doc ci-dessus).
    let maxPullupPts = 0, maxDrawdownPts = 0, maeArmed = 0, entryTouches = 0;
    const mfeLast = exitReason === 'sl' || exitReason === 'be' ? exitIdx - 1 : exitIdx;
    for (let j = b4Idx; j <= exitIdx; j++) {
      const k = candles[j];
      const fav = isBuy ? k.high - entry : entry - k.low;
      const adv = isBuy ? entry - k.low  : k.high - entry;
      if (j <= mfeLast && fav > maxPullupPts) maxPullupPts = fav;
      if (adv > maxDrawdownPts) maxDrawdownPts = adv;
      if (j > b4Idx) {
        if (adv > maeArmed) maeArmed = adv;              // fenêtre où le stop existe
        // Retour sur l'entrée : la bougie enjambe le niveau. B4 est exclue —
        // elle s'ouvre dessus, elle compterait toujours.
        if (k.low <= entry && k.high >= entry) entryTouches++;
      }
    }
    maxPullupPts   = Math.min(Math.max(0, maxPullupPts),   tpPts);
    maxDrawdownPts = Math.min(Math.max(0, maxDrawdownPts), risk0);
    const maeArmedPts = exitIdx > b4Idx ? Math.min(Math.max(0, maeArmed), risk0) : null;

    trades.push({
      id:           id++,
      direction:    isBuy ? 'BUY' : 'SELL',
      label:        z.label,
      entryTime:    z.entryTime,
      entryPrice:   entry,
      exitTime:     candles[exitIdx].time,
      exitPrice,
      // Stop courant à la sortie : le déplacé si le BE profit/durée s'est armé.
      // risk0 reste le risque initial — TradesPrimitive en déduit le pointillé
      // du SL initial. tp = objectif courant (réduit si le BE retours a tapé).
      sl:           slMoved ? beStop : sl,
      sl0:          sl,
      tp:           tpMoved ? tpTouch : tp,
      tp0:          tp,
      beActivated:  slMoved || tpMoved,
      beReason,
      beTime,
      tpReduced:    tpMoved,
      risk0,
      profitPoints: isBuy ? exitPrice - entry : entry - exitPrice,
      exitReason,
      status:       exitReason,
      barsHeld:     exitIdx - b4Idx,
      entryTouches,
      maxPullupPts,
      maxDrawdownPts,
      maeArmedPts,
    });
    lastExitIdx = exitIdx;

    // Un TP réel démarre le repos (le cooldown était à 0, sinon on aurait sauté).
    if (skipAfterTp > 0 && isWin) { cooldown = skipAfterTp; armExit = exitIdx; }
  }

  // Méta hors-tableau : combien de signaux le cooldown a sauté, et combien
  // auraient gagné (ils ne sont pas dans le rapport, juste comptés ici).
  trades.skippedByCooldown = skipped;
  trades.skippedWon = skippedWon;

  return trades;
}

// HM-BM — motif de 2 bougies, avec niveau d'entrée sur la 3e (X) et stop loss.
//
//   • Bougie 1 (i) — grosse bougie directionnelle à CONTRE-COURANT de la MM
//     (période maPeriod), entièrement du mauvais côté :
//       - HM : haussière et high < MM   → biais haussier
//       - BM : baissière et low  > MM   → biais baissier
//     avec corps |close−open| ≥ mult1 × ATR.
//   • Bougie 2 / M (i+1) — petite : corps |close−open| ≤ mult2 × ATR.
//   L'ATR (période atrPeriod) est lu AVANT la bougie 1 (i−1) pour ne pas
//   s'auto-inclure. Un seul ATR de référence sert aux deux tests.
//
//   • Bougie X (i+2) — la suivante : NIVEAU D'ENTRÉE = son ouverture.
//   • STOP LOSS = extrême entre M et X (HM → plus bas des bas ; BM → plus haut
//     des hauts). La grosse bougie 1 n'entre PAS dans le SL.
//
// Rendu : une zone encadre le motif (bougies 1 et 2) ; les niveaux entrée et SL
// sont tirés sur extLen barres à droite de X.
//
// Chaque motif : { side, label, top, bottom, startTime, endTime,
//   entryTime, entryPrice, sl, slStartTime, levelEndTime }
//   levelEndTime null → extLen dépasse les données, les niveaux vont au bord droit.
//
// Options :
//   direction  'bull' (HM) | 'bear' (BM) | 'both'
//   maPeriod   période de la MM simple (défaut 75)
//   atrPeriod  période de l'ATR (défaut 14)
//   mult1      corps bougie 1 ≥ mult1 × ATR (défaut 1)
//   mult2      corps bougie 2 ≤ mult2 × ATR (défaut 0.5)
//   extLen     extension des niveaux, en barres à droite de X (défaut 5)
export function calcHMBM(candles, {
  direction = 'both', maPeriod = 75, atrPeriod = 14,
  mult1 = 1, mult2 = 0.5, extLen = 5,
} = {}) {
  const out = [];
  const n = candles.length;
  const ma  = smaArr(candles, maPeriod);
  const atr = atrArr(candles, atrPeriod);

  for (let i = 1; i + 2 < n; i++) {
    const c1 = candles[i];       // bougie 1 — grosse
    const m  = candles[i + 1];   // bougie 2 (M) — petite
    const x  = candles[i + 2];   // bougie X — entrée

    const avg  = ma[i];
    const aref = atr[i - 1];      // ATR lu AVANT la bougie 1
    if (avg == null || aref == null) continue;

    const body1 = Math.abs(c1.close - c1.open);
    const body2 = Math.abs(m.close - m.open);
    if (body1 < mult1 * aref) continue;   // bougie 1 assez grosse
    if (body2 > mult2 * aref) continue;   // bougie 2 assez petite

    const hm = c1.close > c1.open && c1.high < avg;   // haussière sous la MM
    const bm = c1.close < c1.open && c1.low  > avg;   // baissière sur la MM

    let side = null;
    if (hm && direction !== 'bear')      side = 'bull';
    else if (bm && direction !== 'bull') side = 'bear';
    else continue;

    const endIdx = i + 2 + extLen;
    out.push({
      side,
      label:       side === 'bull' ? 'HM' : 'BM',
      entryIdx:    i + 2,          // index de la bougie X (pour la simulation)
      top:         Math.max(c1.high, m.high),
      bottom:      Math.min(c1.low,  m.low),
      startTime:   c1.time,
      endTime:     x.time,
      entryTime:   x.time,
      entryPrice:  x.open,
      sl:          side === 'bull' ? Math.min(m.low, x.low) : Math.max(m.high, x.high),
      slStartTime: m.time,
      levelEndTime: endIdx < n ? candles[endIdx].time : null,
    });
  }

  return out;
}

// HM-BM en mode « position simulée » — chaque motif devient un trade :
//   • ENTRÉE au MARCHÉ à l'ouverture de la bougie X (entryPrice = X.open) : elle
//     est toujours prise (pas d'ordre en attente, donc jamais « missed »).
//   • SL = extrême entre M et X (déjà déterminé par calcHMBM), TP = entrée ± tpPts.
//     Pas de break-even.
//   • Le SL n'étant posé qu'à la CLÔTURE de X, la position est suivie à partir de
//     X+1. Chaque bougie : stop testé AVANT le TP (pessimiste) ; un stop traversé
//     en gap est rempli au PIRE du niveau et de l'open ; le TP est rempli au niveau.
//   • Stop et TP dans la même bougie → le stop gagne (pessimiste).
//   • Données épuisées avant résolution → exitReason 'open', sortie à la dernière
//     clôture (position encore en vie au bord droit).
//
// Chaque position reprend la forme attendue par TradesPrimitive :
//   { id, direction, label, entryTime, entryPrice, exitTime, exitPrice, sl, tp,
//     risk0, profitPoints, exitReason, status, barsHeld, maxPullupPts, maxDrawdownPts }
//   risk0 = |entrée − SL| (le SL varie d'un motif à l'autre, contrairement au rFVG).
//   Excursions (points) : maxPullupPts (MFE, bougie de sortie exclue si stop,
//   plafonné au TP) ; maxDrawdownPts (MAE, bougie de sortie incluse, plafonné à risk0).
//
// Options : celles de calcHMBM, plus
//   tpPts  distance du TP en unités de prix (> 0 sinon aucune position)
export function calcHMBMPositions(candles, opts = {}) {
  const { tpPts = 10 } = opts;
  const trades = [];
  if (!(tpPts > 0)) return trades;

  const motifs = calcHMBM(candles, opts);
  const n = candles.length;

  let id = 1;
  for (const mo of motifs) {
    const isBuy = mo.side === 'bull';
    const entry = mo.entryPrice;                 // X.open
    const sl    = mo.sl;                         // extrême(M, X)
    const tp    = isBuy ? entry + tpPts : entry - tpPts;
    const xIdx  = mo.entryIdx;
    const risk0 = Math.abs(entry - sl);

    // Suivi à partir de X+1. Stop traversé en gap → pire du niveau et de l'open.
    let exitIdx = null, exitPrice = null, exitReason = null;
    for (let j = xIdx + 1; j < n; j++) {
      const k = candles[j];
      if (isBuy) {
        if (k.low  <= sl) { exitIdx = j; exitPrice = Math.min(sl, k.open); exitReason = 'sl'; break; }
        if (k.high >= tp) { exitIdx = j; exitPrice = tp;                   exitReason = 'tp'; break; }
      } else {
        if (k.high >= sl) { exitIdx = j; exitPrice = Math.max(sl, k.open); exitReason = 'sl'; break; }
        if (k.low  <= tp) { exitIdx = j; exitPrice = tp;                   exitReason = 'tp'; break; }
      }
    }
    if (exitIdx == null) {
      exitIdx    = n - 1;
      exitPrice  = candles[n - 1].close;
      exitReason = 'open';
    }

    // Excursions de X+1 à la sortie (cf. bloc de doc).
    let maxPullupPts = 0, maxDrawdownPts = 0;
    const mfeLast = exitReason === 'sl' ? exitIdx - 1 : exitIdx;
    for (let j = xIdx + 1; j <= exitIdx; j++) {
      const k = candles[j];
      const fav = isBuy ? k.high - entry : entry - k.low;
      const adv = isBuy ? entry - k.low  : k.high - entry;
      if (j <= mfeLast && fav > maxPullupPts) maxPullupPts = fav;
      if (adv > maxDrawdownPts) maxDrawdownPts = adv;
    }
    maxPullupPts   = Math.min(Math.max(0, maxPullupPts),   tpPts);
    maxDrawdownPts = risk0 > 0 ? Math.min(Math.max(0, maxDrawdownPts), risk0) : Math.max(0, maxDrawdownPts);

    trades.push({
      id:           id++,
      direction:    isBuy ? 'BUY' : 'SELL',
      label:        mo.label,
      entryTime:    candles[xIdx].time,
      entryPrice:   entry,
      exitTime:     candles[exitIdx].time,
      exitPrice,
      sl,
      tp,
      risk0,
      profitPoints: isBuy ? exitPrice - entry : entry - exitPrice,
      exitReason,
      status:       exitReason,
      barsHeld:     exitIdx - xIdx,
      maxPullupPts,
      maxDrawdownPts,
    });
  }

  return trades;
}

// HBH / BHB — 3-candle reversal where the 1st and 3rd candles FULLY ENGULF the
// middle candle's whole range (body + wicks), and the 3rd candle closes FULLY
// through the middle:
//   • HBH (bull-bear-bull): 3rd closes ABOVE the middle's high  → bullish zone
//   • BHB (bear-bull-bear): 3rd closes BELOW the middle's low    → bearish zone
// Each zone spans the middle candle's high–low range, drawn as a box. Because it
// reads the candles prop, it works on raw candles AND on grouped trend candles.
//
// Offsets (matching the Pine source): a = 1st outer, m = middle, c = 3rd (current).
//
// Options:
//   direction  'bull' (HBH) | 'bear' (BHB) | 'both'
//   engMult    1st & 3rd total range (high-low) must be >= engMult × the
//              middle's total range, AND each must contain it fully (default 1.5)
//   extLen     zone width in bars to the right of the middle candle (default 20)
//
// Each zone: { side, top, bottom, mid, startTime, endTime }
//   endTime null → extends to the right chart edge (extLen ran past the data)
export function calcHBHBHB(candles, { direction = 'both', engMult = 1.5, extLen = 20 } = {}) {
  const zones = [];
  const n = candles.length;

  for (let i = 2; i < n; i++) {
    const a = candles[i - 2]; // 1st  (outer, engulfing)
    const m = candles[i - 1]; // middle (small, opposite)
    const c = candles[i];     // 3rd  (confirming, current)

    // 1st & 3rd must each fully ENGULF the middle's entire range (body + wicks)…
    const engulfA = a.high >= m.high && a.low <= m.low;
    const engulfC = c.high >= m.high && c.low <= m.low;
    // …and each be at least engMult × the middle candle's total range.
    const mRange = m.high - m.low;
    const sizeOk = mRange > 0
      && (a.high - a.low) >= engMult * mRange
      && (c.high - c.low) >= engMult * mRange;
    if (!engulfA || !engulfC || !sizeOk) continue;

    const bullA = a.close > a.open, bearA = a.close < a.open;
    const bullM = m.close > m.open, bearM = m.close < m.open;
    const bullC = c.close > c.open, bearC = c.close < c.open;

    // 3rd candle must close entirely through the middle candle's range.
    const hbh = bullA && bearM && bullC && c.open <= m.high && c.close > m.high;
    const bhb = bearA && bullM && bearC && c.open >= m.low  && c.close < m.low;

    let side;
    if (hbh && direction !== 'bear')      side = 'bull';
    else if (bhb && direction !== 'bull') side = 'bear';
    else continue;

    const endIdx = (i - 1) + extLen; // box left = middle candle, spans extLen bars
    zones.push({
      side,
      top:       m.high,
      bottom:    m.low,
      mid:       (m.high + m.low) / 2,
      startTime: m.time,
      endTime:   endIdx < n ? candles[endIdx].time : null,
    });
  }

  return zones;
}

// HBHB / BHBH — 4-candle pattern designed for grouped alternating candles.
//
// Candle roles (indices i-3 … i):
//   HBHB: Bull(1) → Bear(2) → Bull(3) → Bear(4)
//   BHBH: Bear(1) → Bull(2) → Bear(3) → Bull(4)
//
// Conditions:
//   1. body(1) >= bodyMult × body(2)  AND  body(3) >= bodyMult × body(2)
//   2. HBHB: candle(4).close < candle(2).open  (4th breaks below B2 open)
//      BHBH: candle(4).close > candle(2).open  (4th breaks above B2 open)
//
// Zone: high–low of candle(2), starting at candle(2).time, spanning extLen bars.
//   HBHB → side 'bull'   BHBH → side 'bear'
//
// Options:
//   direction  'bull' (HBHB) | 'bear' (BHBH) | 'both'  (default 'both')
//   bodyMult   body(1) and body(3) must be ≥ bodyMult × body(2)  (default 1.5)
//   extLen     zone width in bars to the right of candle(2)       (default 20)
export function calcHBHB(candles, { direction = 'both', bodyMult = 1.5, extLen = 20 } = {}) {
  const zones = [];
  const n = candles.length;

  for (let i = 3; i < n; i++) {
    const a = candles[i - 3]; // 1st
    const b = candles[i - 2]; // 2nd  (zone source)
    const c = candles[i - 1]; // 3rd
    const d = candles[i];     // 4th  (confirming)

    const bullA = a.close > a.open;
    const bullB = b.close > b.open;
    const bullC = c.close > c.open;
    const bullD = d.close > d.open;

    const isHBHB = bullA && !bullB && bullC && !bullD;
    const isBHBH = !bullA && bullB && !bullC && bullD;

    if (!isHBHB && !isBHBH) continue;

    if (direction === 'bull' && !isHBHB) continue;
    if (direction === 'bear' && !isBHBH) continue;

    const bodyA = Math.abs(a.close - a.open);
    const bodyB = Math.abs(b.close - b.open);
    const bodyC = Math.abs(c.close - c.open);

    if (bodyB === 0) continue;
    if (bodyA < bodyMult * bodyB || bodyC < bodyMult * bodyB) continue;

    if (isHBHB && d.close >= b.open) continue;
    if (isBHBH && d.close <= b.open) continue;

    const endIdx = (i - 2) + extLen;
    zones.push({
      side:      isHBHB ? 'bull' : 'bear',
      top:       b.high,
      bottom:    b.low,
      startTime: b.time,
      endTime:   endIdx < n ? candles[endIdx].time : null,
    });
  }

  return zones;
}

// True Range per bar (tr[0] = 0, needs the previous close).
function trueRanges(candles) {
  const n = candles.length;
  const tr = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low  - candles[i - 1].close),
    );
  }
  return tr;
}

// Wilder's ATR (RMA of TR), seeded with the SMA of the first `period` TRs.
// Returns an array aligned to candles; entries before the seed are NaN.
function wilderATR(candles, period) {
  const n = candles.length;
  const atr = new Array(n).fill(NaN);
  if (n < period + 1) return atr;
  const tr = trueRanges(candles);
  let seed = 0;
  for (let i = 1; i <= period; i++) seed += tr[i];
  atr[period] = seed / period;
  for (let i = period + 1; i < n; i++) atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  return atr;
}

// Build a finished zone from a flat run [s..e] and an optional breakout bar.
function makeZone(candles, s, e, brokeIdx, extendToBreak) {
  const n = candles.length;
  let top = -Infinity, bottom = Infinity;
  for (let k = s; k <= e; k++) {
    if (candles[k].high > top)    top = candles[k].high;
    if (candles[k].low  < bottom) bottom = candles[k].low;
  }

  let side = null, breakTime = null, breakPrice = null, endIdx = e;
  if (brokeIdx >= 0) {
    const b = candles[brokeIdx];
    side = b.close > top ? 'up'
         : b.close < bottom ? 'down'
         : (b.close >= b.open ? 'up' : 'down');
    breakTime = b.time; breakPrice = b.close; endIdx = brokeIdx;
  }

  let endTime;
  if (side) endTime = candles[extendToBreak ? endIdx : e].time;
  else      endTime = e >= n - 1 ? null : candles[e].time; // open only at the live edge

  return { state: side ? 'fired' : 'forming', side, top, bottom, startTime: candles[s].time, endTime, breakTime, breakPrice };
}

// ── ATR-flat detector (default) ───────────────────────────────────────────────
// Compression = the ATR sits FLAT over a stretch of bars (volatility frozen),
// then a bar makes a BRUSQUE expansion (the ATR "changes direction" from flat to
// rising) → that spike is the breakout. Scale-free: thresholds are relative to
// the local ATR level, so no price units are hard-coded.
//
//   • flatness is per-bar via a trailing window of `minLength` ATR values: the
//     bar is "flat" when (max−min) ≤ flatTol × mean over that window. Using a
//     window (not a running mean) rejects BOTH spikes and slow drift, so a zone
//     only starts once the ATR has truly settled — Wilder's ATR is laggy and
//     ramps for ~period bars after any move.
//   • consecutive flat bars form the zone; covered bars span the whole window.
//   • breakout = the first bar after the run whose TRUE RANGE ≥ flatATR ×
//     breakMult. We test TR (instantaneous), not the smoothed ATR, because the
//     ATR itself reacts too slowly to flag a sudden expansion in time.
//     Direction comes from that candle's close vs the box.
//
// Options: atrPeriod (14), flatTol (0.12 = ±12 %), breakMult (1.8× the flat ATR),
//          minLength (6), extendToBreak (true).
function atrFlatZones(candles, { atrPeriod = 14, flatTol = 0.12, breakMult = 1.8, minLength = 6, extendToBreak = true }) {
  const zones = [];
  const n = candles.length;
  const atr = wilderATR(candles, atrPeriod);
  const tr  = trueRanges(candles);
  const win = Math.max(2, minLength);

  // Per-bar flat flag: ATR dispersion over the trailing `win` bars is tight.
  const flat = new Array(n).fill(false);
  for (let i = atrPeriod + win - 1; i < n; i++) {
    let mn = Infinity, mx = -Infinity, sum = 0, ok = true;
    for (let k = i - win + 1; k <= i; k++) {
      const a = atr[k];
      if (isNaN(a)) { ok = false; break; }
      if (a < mn) mn = a;
      if (a > mx) mx = a;
      sum += a;
    }
    if (!ok) continue;
    const mean = sum / win;
    flat[i] = mean > 0 && (mx - mn) <= flatTol * mean;
  }

  let i = 0;
  while (i < n) {
    if (!flat[i]) { i++; continue; }
    let e = i;
    while (e + 1 < n && flat[e + 1]) e++;

    // flat[k] means the window ENDING at k is flat → covered bars start `win-1` back.
    const s = i - win + 1;

    // Reference ATR over the flat stretch, then look for the breakout spike.
    let refSum = 0;
    for (let k = s; k <= e; k++) refSum += atr[k];
    const ref = refSum / (e - s + 1);

    let brokeIdx = -1;
    for (let j = e + 1; j < n; j++) {
      if (tr[j] >= ref * breakMult) { brokeIdx = j; break; } // brusque expansion = breakout
      if (flat[j]) break;                                    // settled again without a spike
    }

    if (e - s + 1 >= minLength) zones.push(makeZone(candles, s, e, brokeIdx, extendToBreak));

    i = brokeIdx >= 0 ? brokeIdx + 1 : e + 1;
  }

  return zones;
}

// ── TTM Squeeze detector (Bollinger Bands inside Keltner Channels) ─────────────
// squeeze ON when BB(length,bbMult·σ) sits fully inside KC(length,kcMult·ATR).
// Consecutive squeeze bars form a box; it fires on the first later bar that
// CLOSES outside [bottom, top]. Options: length (20), bbMult (2), kcMult (1.5),
// minLength (6), extendToBreak (true).
function squeezeZones(candles, { length = 20, bbMult = 2, kcMult = 1.5, minLength = 6, extendToBreak = true }) {
  const zones = [];
  const n = candles.length;
  if (n < length + 1) return zones;
  const tr = trueRanges(candles);

  const squeeze = new Array(n).fill(false);
  for (let i = length; i < n; i++) {
    let sumC = 0;
    for (let k = i - length + 1; k <= i; k++) sumC += candles[k].close;
    const mean = sumC / length;

    let sumSq = 0, sumTR = 0;
    for (let k = i - length + 1; k <= i; k++) {
      const d = candles[k].close - mean;
      sumSq += d * d;
      sumTR += tr[k];
    }
    const stdev = Math.sqrt(sumSq / length);
    const atr   = sumTR / length;
    squeeze[i] = (mean + bbMult * stdev) < (mean + kcMult * atr)
              && (mean - bbMult * stdev) > (mean - kcMult * atr);
  }

  let s = 0;
  while (s < n) {
    if (!squeeze[s]) { s++; continue; }
    let e = s;
    while (e + 1 < n && squeeze[e + 1]) e++;

    if (e - s + 1 >= minLength) {
      // box bounds, then first post-run bar closing outside it
      let top = -Infinity, bottom = Infinity;
      for (let k = s; k <= e; k++) {
        if (candles[k].high > top)    top = candles[k].high;
        if (candles[k].low  < bottom) bottom = candles[k].low;
      }
      let brokeIdx = -1;
      for (let j = e + 1; j < n; j++) {
        if (candles[j].close > top || candles[j].close < bottom) { brokeIdx = j; break; }
      }
      zones.push(makeZone(candles, s, e, brokeIdx, extendToBreak));
    }
    s = e + 1;
  }

  return zones;
}

// Compression zones. Two interchangeable methods, same zone output shape:
//   mode 'atr'     — flat ATR then a brusque expansion (default)  → atrFlatZones
//   mode 'squeeze' — TTM Squeeze (Bollinger inside Keltner)        → squeezeZones
//
// Each zone: { state, side, top, bottom, startTime, endTime, breakTime, breakPrice }
//   state 'forming' — no clean breakout yet (open to the live edge)
//   state 'fired'   — broke out; side 'up'/'down', breakTime/breakPrice set
export function calcCompression(candles, opts = {}) {
  return (opts.mode === 'squeeze' ? squeezeZones : atrFlatZones)(candles, opts);
}
