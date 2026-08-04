// Moteur de SORTIES — commun à tous les motifs à stop structurel (rFVG, KO…).
//
// Ce fichier ne sait pas ce qu'est un motif. Il reçoit des SIGNAUX déjà détectés
// et les joue jusqu'à leur sortie. C'est ce qui permet à deux patterns différents
// de partager exactement la même règle de gestion — et donc de comparer leurs
// résultats sans se demander si l'écart vient de la sortie ou de la détection.
//
// CONTRAT D'UN SIGNAL (ce que la détection doit fournir) :
//   { side: 'bull'|'bear', entryIdx, entryTime, entryPrice, label? }
//   • entryIdx  — indice de la bougie d'ENTRÉE (appelée B4 dans le rFVG, B3 dans
//     le KO : le moteur ne compte pas les bougies du motif, il n'en a pas besoin).
//     null = le motif est complet mais sa bougie d'entrée n'existe pas encore.
//   • entryPrice — le prix d'entrée AU MARCHÉ, soit l'ouverture de cette bougie.
// Les signaux doivent arriver dans l'ordre chronologique d'entryIdx : `uniqueTrade`
// et `skipAfterTp` sont des états SÉQUENTIELS, les servir en désordre les rend faux.
//
// LE STOP N'EST PAS UNE DISTANCE — il est STRUCTUREL, posé à la CLÔTURE de la
// bougie d'entrée, sous/sur l'extrême des DEUX dernières bougies (celle d'entrée
// et celle qui la précède, la dernière du motif) :
//   • signal haussier (BUY)  → SL = min(bas  E−1, bas  E) − slMarginPts
//   • signal baissier (SELL) → SL = max(haut E−1, haut E) + slMarginPts
// Le risque `risk0 = |entrée − SL|` VARIE donc d'une position à l'autre. Tout ce
// qui est exprimé en R doit être normalisé position par position : il n'existe pas
// de SL global à qui rapporter les gains.
//
// PENDANT TOUTE LA BOUGIE D'ENTRÉE la position est NON PROTÉGÉE : le stop n'existe
// pas encore, seul le TP est actif. Ce n'est pas un optimisme de simulation — le
// stop étant construit à partir du bas (resp. haut) de cette bougie même, il ne
// PEUT pas y être touché. Un TP atteint là est donc un vrai TP, sans ambiguïté.
// Le SL PLAFONNÉ ci-dessous est la seule exception : lui est une DISTANCE, il
// existe donc dès l'entrée.
//
// SL PLAFONNÉ (`slCapPts` > 0) — PLAFOND DE PERTE, en points, et c'est un vrai
// STOP, pas un break-even : dès que le prix s'éloigne de l'entrée de slCapPts
// points À CONTRE-SENS, la position est soldée à ce niveau, même si le stop
// structurel est encore loin. Sortie 'sl', comme n'importe quelle perte.
//   • Le stop effectif devient le PLUS SERRÉ des deux : structurel si lui est
//     plus proche, plafond sinon. `risk0` suit — il ne peut plus dépasser
//     slCapPts, et c'est tout l'intérêt : il BORNE le risque d'une règle qui,
//     sans lui, le laisse varier au gré de la taille des bougies du motif.
//     `slCapped` dit, position par position, lequel des deux a décidé.
//   • ACTIF DÈS LA BOUGIE D'ENTRÉE, contrairement au structurel : le plafond est
//     une distance à un prix connu à l'instant de l'entrée, il peut donc être
//     posé avec l'ordre. C'est là qu'il sert le plus — c'est la seule bougie que
//     le stop structurel ne couvre pas. Conséquence assumée : sur cette bougie le
//     TP n'est plus au-dessus de tout soupçon, plafond et TP peuvent y tomber
//     ensemble et la convention pessimiste s'applique (le stop gagne, la position
//     est comptée dans `ambiguous`).
//   • Un plafond plus large que le stop structurel ne change rien : il ne peut
//     pas ÉLARGIR le risque, même règle que les stops déplacés.
//   • ÉVOLUTION : absente des EA MT5.
//
// La position est ensuite simulée bougie par bougie :
//   • stop touché (la mèche franchit le stop courant) → sortie au PIRE du stop et
//     de l'open de la bougie (un gap ne remplit jamais au niveau) ; exitReason
//     'sl' si c'est le stop structurel, 'be' si le stop déplacé ;
//   • TP touché                       → sortie à l'objectif, gain ;
//   • stop et TP dans la même bougie  → pessimiste : le stop gagne ;
//   • données épuisées                → sortie à la dernière clôture, 'open'.
//
// BREAK-EVEN — QUATRE déclencheurs indépendants, aux EFFETS DIFFÉRENTS. Chacun
// s'arme une seule fois ; ils peuvent se cumuler. Les trois qui DÉPLACENT LE STOP
// (profit, durée, swing) se partagent un unique mouvement : le premier qui tire
// pose le stop déplacé, les autres ne le rejouent pas — le stop ne bouge qu'une
// fois dans la vie d'une position, ce n'est PAS un stop suiveur. Le quatrième
// (retours) ne déplace rien : il FERME la position.
//   • PROFIT (beTriggerPts > 0) — le stop passe au niveau BE = entrée ± beLevelPts
//     dès qu'une bougie avance de beTriggerPts dans le sens de la position.
//     Évalué dès la bougie d'entrée.
//   • DURÉE (beBarsTrigger > 0) — même niveau BE, dès que la position dure depuis
//     ce nombre de bougies.
//   • SWING (beSwingBars > 0) — le stop passe SOUS LA STRUCTURE, pas au BE : au
//     premier swing confirmé pendant la position (bas en BUY, haut en SELL, même
//     définition que l'indicateur SWING de lib/indicators.js), le stop va sous ce
//     pivot − slMarginPts (BUY) / sur ce pivot + slMarginPts (SELL). beLevelPts ne
//     le concerne pas. ANTI-LOOKAHEAD : un swing n'est CONNU qu'à la clôture de la
//     bougie pivot + beSwingBars — c'est elle qui arme, jamais le pivot.
//   • RETOURS (beTouchTrigger > 0) — NE DÉPLACE NI STOP NI TP : il COUPE NET. Dès
//     que le prix est revenu ce nombre de fois sur l'entrée, la position est
//     soldée AU PRIX D'ENTRÉE sur la bougie qui atteint le compte — sortie 'be',
//     gain BRUT nul (le spread, lui, reste dû). C'est un abandon, pas une
//     protection : le motif n'a pas travaillé, on rend la place. Le prix d'entrée
//     est atteignable par construction — c'est le fait même de le retoucher qui
//     déclenche. Évalué à la CLÔTURE de la bougie, donc APRÈS le stop, le TP et
//     les trois autres déclencheurs : une bougie qui repasse par l'entrée ET
//     atteint le TP part au TP, et une position que le stop (structurel ou
//     déplacé) a déjà refermée ne coupe jamais.
// Un stop déplacé ne peut JAMAIS élargir le risque : un niveau au-delà du stop
// structurel est ignoré (il arme le déclencheur sans rien bouger).
//
// RÉSOLUTION INTRA-BOUGIE (`fills`) — c'est un réglage, pas une fatalité :
//   • 'bar' (défaut) — quand le stop ET le TP tombent dans la même bougie du TF,
//     le stop l'emporte. Convention conservatrice, pas une mesure. `ambiguous`
//     compte les positions concernées : c'est le prix de la convention.
//   • 'm1' — la même bougie est re-parcourue minute par minute ; l'arbitraire ne
//     subsiste que dans la minute de collision. L'EA, lui, arbitre au tick : le
//     mode bougie SOUS-ESTIME donc le résultat réel.
// Différences assumées du mode 'm1', parce qu'elles changent le sens d'un réglage :
//   • le break-even sur PROFIT s'arme à la minute (l'EA s'arme au tick) ; ceux sur
//     DURÉE, RETOURS et SWING restent évalués à la clôture de la bougie TF, parce
//     qu'ils COMPTENT DES BOUGIES — un swing « 2 de chaque côté » en M15 n'est pas
//     un swing de 2 minutes ;
//   • les excursions (MFE/MAE) restent mesurées sur les bougies TF dans les deux
//     modes : elles alimentent les études BE / SL plafonné, qui sont des bornes à
//     la granularité bougie.
//
// SPREAD (`spreadPts`) — le coût du trade, en points, DÉDUIT POSITION PAR
// POSITION. Un aller-retour se paie une fois : entrée à l'ask, sortie au bid (ou
// l'inverse en vente), et c'est cet écart-là que le paramètre porte, en entier.
//   • `profitPoints` reste le BRUT, celui qui se relit sur le graphe entre les
//     deux traits ; `spreadPts` est le coût appliqué et `netPoints` le résultat
//     réel. Trois champs, parce qu'une seule valeur nette rendrait impossible de
//     vérifier une position à la main.
//   • SEULES LES POSITIONS CLÔTURÉES le paient. Une position encore en vie au
//     bord des données ('open') n'a pas de sortie, donc pas de coût réalisé :
//     spreadPts = 0 et netPoints = profitPoints. Elle est de toute façon hors des
//     statistiques, qui ne comptent que les résolues.
//   • Un BE qui coupe au prix d'entrée rend un brut NUL, jamais un net nul : le
//     spread reste dû. C'est le sens même de ce paramètre — une stratégie qui
//     tourne à l'équilibre brut perd exactement un spread par position.
//   • C'est un COÛT, pas une règle de sortie : il ne déplace aucun niveau, ne
//     déclenche rien, et ne change ni le TP ni le stop. Il ne fait pas partie de
//     EXIT_SCHEMA et n'a rien à faire dans une grille de balayage — il se stresse
//     à part, en rejouant une configuration retenue à spread croissant.
//
// LE DÛ (`dueAfterSl`, 0 = éteint) — REMBOURSER AVANT DE GAGNER. Toute position
// clôturée dans le rouge laisse sa perte NETTE sur une ardoise ; tout gain la
// rembourse en commençant par la plus ancienne. Dès que l'ardoise compte
// `dueAfterSl` pertes, la position suivante vise le remboursement au lieu de son
// vrai TP — même s'il tombe plus PRÈS que son objectif normal, parce que
// rembourser passe avant. La règle complète (modes `dueMode` 'full' / 'step',
// perte jugée au NET et non au statut, anti-anticipation des sorties) vit dans
// lib/dueLedger.js, avec la file elle-même : elle est partagée mot pour mot avec
// la famille liq / rev / Twins Bars (lib/patternPositions.js), et la
// redocumenter ici la ferait diverger.
//   CE QUI EST PROPRE À CE MOTEUR :
//   • le dû remplace la DISTANCE de l'objectif, quelle que soit l'unité dans
//     laquelle le TP était réglé (points ou × ATR) ;
//   • LE BREAK-EVEN N'EST PAS CONCERNÉ, et c'est une décision : ses quatre
//     déclencheurs s'arment exactement comme sur une position ordinaire. En
//     unité 'pct', le seuil et le niveau restent un pourcentage du TP NORMAL de
//     la position — jamais de l'objectif de remboursement. Sinon une longue
//     série de pertes éloignerait le seuil et désarmerait le break-even au
//     moment précis où il sert le plus, et un remboursement par petits bonds le
//     ferait au contraire s'armer sur un mouchoir de poche. Le dû déplace la
//     cible, pas la protection ;
//   • un signal SAUTÉ par le repos après gain est simulé à blanc : il lit le dû
//     (donc vise le remboursement, comme il l'aurait fait) mais son résultat
//     n'entre jamais dans l'ardoise — aucune position n'a été prise ;
//   • ÉVOLUTION : absent des EA MT5.
//
// SORTIE EN TEMPS (`maxBars`) — plafond de durée de vie. Sans lui, une position
// qui n'atteint ni son stop ni son TP reste ouverte jusqu'au bord des données
// ('open') et ne compte nulle part. C'EST UNE ÉVOLUTION, absente des EA MT5 : si
// un réglage retenu l'utilise, l'EA doit être modifié avant de le trader.

import { atrArr } from '../backtest/ta';
import { createDueLedger } from '../dueLedger';

// Swing confirmé à l'indice p — MÊME définition que l'indicateur SWING
// (calcSwings, lib/indicators.js) : l'extrême de la bougie p est STRICTEMENT
// au-delà de ceux des `bars` bougies de chaque côté. La stricte égalité ne
// confirme donc rien : un double bas parfait n'arme aucun swing, et c'est le
// comportement voulu — mieux vaut ne pas déplacer le stop que le déplacer sur une
// structure ambiguë. Réexportée par lib/patterns.js, où elle vivait avant : le
// prédicat doit rester UNIQUE, sinon la parité entre le graphe et le serveur ne
// tient plus.
export function isSwingAt(candles, p, bars, side) {
  if (!(bars > 0) || p - bars < 0 || p + bars >= candles.length) return false;
  const low = side === 'low';
  const ref = low ? candles[p].low : candles[p].high;
  for (let j = p - bars; j <= p + bars; j++) {
    if (j === p) continue;
    if (low ? candles[j].low <= ref : candles[j].high >= ref) return false;
  }
  return true;
}

// CHAÎNES DE SWINGS — de quoi répondre à « quel est le swing précédent ? » sans
// reparcourir les bougies à chaque candidat.
//
// chains.highs[i] = l'indice du dernier swing haut situé STRICTEMENT avant i, et
// chains.highs de cet indice-là donne l'avant-dernier, etc. Une seule passe en
// O(n × bars) pour tout le graphe, et remonter de k swings coûte k lectures — au
// lieu d'un balayage arrière par candidat, qui ferait d'une détection un O(n²).
//
// ATTENTION, une chaîne ne dit rien de la CONFIRMATION : le swing d'indice j
// n'est connu qu'à la clôture de j + bars, et c'est à l'appelant de refuser ceux
// que son motif ne pouvait pas encore voir. Le seul juge du « quand » est celui
// qui sait où sa figure se termine.
//
// Écrite pour le xFVG (lib/xfvg/detect.js), elle vit ici depuis que le Twins Bars
// en a eu besoin lui aussi — même raison que pour isSwingAt juste au-dessus : un
// seul endroit, sinon deux motifs finissent par ne plus parler du même swing.
export function prevSwingChains(candles, bars) {
  const n     = candles.length;
  const highs = new Int32Array(n).fill(-1);
  const lows  = new Int32Array(n).fill(-1);
  let lastH = -1, lastL = -1;
  for (let i = 0; i < n; i++) {
    highs[i] = lastH;
    lows[i]  = lastL;
    if (isSwingAt(candles, i, bars, 'high')) lastH = i;
    if (isSwingAt(candles, i, bars, 'low'))  lastL = i;
  }
  return { highs, lows };
}

// Défauts des sorties. Toute stratégie construite sur ce moteur les partage :
// deux motifs comparés le sont à règles de gestion identiques.
export const EXIT_DEFAULTS = {
  slMarginUnit:   'pts',
  slMarginPts:    2,
  slMarginAtr:    0.2,
  slCapPts:       0,
  tpUnit:         'pts',
  tpPts:          10,
  tpAtr:          1,
  exitAtrPeriod:  14,
  beTriggerUnit:  'pts',
  beTriggerPts:   0,
  beTriggerPct:   0,
  beLevelUnit:    'pts',
  beLevelPts:     0,
  beLevelPct:     0,
  beTouchTrigger: 0,
  beBarsTrigger:  0,
  beSwingBars:    0,
  uniqueTrade:    false,
  skipAfterTp:    0,
  maxBars:        0,
  // Le dû — cf. lib/dueLedger.js. 0 = éteint, et c'est le défaut : un motif ne
  // rembourse rien tant qu'on ne le lui demande pas.
  dueAfterSl:     0,
  dueMode:        'full',
  // Coût, pas règle de sortie : absent de EXIT_SCHEMA, donc jamais balayé.
  spreadPts:      0,
};

// Agrégation M1 → TF en conservant, pour chaque bougie TF, la plage d'indices M1
// qui la compose. Identique à lib/backtest/engine.js (mêmes seaux que le
// time_bucket de /api/bars : ancrés sur l'epoch).
export function aggregateWithRanges(m1Bars, tfSeconds) {
  const candles = [];
  const ranges  = [];

  for (let i = 0; i < m1Bars.length; i++) {
    const bar    = m1Bars[i];
    const bucket = Math.floor(bar.time / tfSeconds) * tfSeconds;
    const last   = candles[candles.length - 1];

    if (!last || last.time !== bucket) {
      candles.push({
        time:   bucket,
        open:   bar.open,
        high:   bar.high,
        low:    bar.low,
        close:  bar.close,
        volume: bar.volume ?? 0,
      });
      ranges.push([i, i]);
    } else {
      if (bar.high > last.high) last.high = bar.high;
      if (bar.low  < last.low)  last.low  = bar.low;
      last.close   = bar.close;
      last.volume += bar.volume ?? 0;
      ranges[ranges.length - 1][1] = i;
    }
  }

  return { candles, ranges };
}

// signals : sortie d'une détection (contrat en tête de fichier).
// candles : bougies du TF. opts.m1 : { bars, ranges } — requis en fills: 'm1'.
//
// Renvoie un tableau de positions portant aussi trois compteurs de lot :
// `skippedByCooldown`, `skippedWon`, `ambiguous`.
export function simulatePositions(candles, signals, opts = {}) {
  const p = { ...EXIT_DEFAULTS, ...opts };
  const { slMarginUnit, slMarginPts, slMarginAtr, slCapPts, tpUnit, tpPts, tpAtr, exitAtrPeriod,
          beTriggerUnit, beTriggerPts, beTriggerPct, beLevelUnit, beLevelPts, beLevelPct,
          beTouchTrigger, beBarsTrigger, beSwingBars, uniqueTrade, skipAfterTp, maxBars,
          spreadPts, dueAfterSl, dueMode } = p;

  const trades = [];
  trades.skippedByCooldown = 0;
  trades.skippedWon        = 0;
  trades.ambiguous         = 0;   // sorties où stop ET TP étaient dans la bougie
  trades.dueArmed          = 0;   // positions parties rembourser l'ardoise
  trades.dueRemainingPts   = 0;
  trades.dueRemainingSl    = 0;
  const tpActive = tpUnit === 'atr' ? tpAtr > 0 : tpPts > 0;
  if (!tpActive) return trades;

  const useM1  = opts.fills === 'm1' && opts.m1?.bars?.length && opts.m1?.ranges?.length;
  const m1Bars = useM1 ? opts.m1.bars   : null;
  const m1Rng  = useM1 ? opts.m1.ranges : null;

  // ATR des sorties — un seul calcul pour toute la série, réutilisé par chaque
  // position. Lu à i−1 au moment de l'entrée (cf. plus bas) : jamais la bougie
  // d'entrée elle-même, sinon le SL/TP dépendrait d'une bougie pas encore close.
  const useAtr = exitAtrPeriod > 0 && (slMarginUnit === 'atr' || tpUnit === 'atr');
  const atr    = useAtr ? atrArr(candles, exitAtrPeriod) : null;

  const n = candles.length;
  let lastExitIdx = -1;
  let cooldown = 0, armExit = -1, skipped = 0, skippedWon = 0, ambiguous = 0;
  let id = 1;

  // L'ardoise des pertes non remboursées — arithmétique partagée avec les autres
  // motifs (lib/dueLedger.js), pour que « seuil 8 » veuille dire la même chose
  // partout. Éteinte, elle ne rend jamais que 0 et ne coûte rien.
  const due = createDueLedger({ threshold: dueAfterSl, mode: dueMode });
  let dueArmedCount = 0;

  for (const z of signals) {
    if (z.entryIdx == null) continue;
    if (uniqueTrade && z.entryIdx <= lastExitIdx) continue;

    const isBuy = z.side === 'bull';
    const eIdx  = z.entryIdx;          // bougie d'entrée
    const prev  = candles[eIdx - 1];   // dernière bougie du motif
    const bar0  = candles[eIdx];
    const entry = z.entryPrice;

    // ATR lu à la clôture de la bougie qui précède l'entrée. Pas assez
    // d'historique pour la période demandée → le signal est ignoré, pas
    // approximé avec un ATR nul (qui donnerait un SL/TP nul, silencieusement).
    const atrRef = useAtr ? atr[eIdx - 1] : null;
    if (useAtr && !(atrRef > 0)) continue;

    // Valeurs effectives EN POINTS de cette position — c'est ce qui alimente le
    // moteur et le rapport, quelle que soit l'unité de saisie choisie.
    const slMarginEff = slMarginUnit === 'atr' ? slMarginAtr * atrRef : slMarginPts;
    const tpPtsEff     = tpUnit === 'atr' ? tpAtr * atrRef : tpPts;
    if (!(tpPtsEff > 0)) continue;
    // Le BE se règle sur le TP NORMAL de la position, celui qu'on vient de
    // calculer — jamais sur le dû, même quand c'est lui qui sera visé (cf. bloc
    // de tête). En unité 'pts' la question ne se pose pas : la distance est
    // absolue et le dû ne la regarde pas non plus.
    const beTriggerEff = beTriggerUnit === 'pct' ? (beTriggerPct / 100) * tpPtsEff : beTriggerPts;
    const beLevelEff   = beLevelUnit   === 'pct' ? (beLevelPct   / 100) * tpPtsEff : beLevelPts;

    // LE DÛ, s'il est armé, PREND LA PLACE de l'objectif — même s'il tombe plus
    // près que le vrai TP : rembourser passe avant. Il se lit à l'ENTRÉE et n'y
    // bouge plus, comme un ordre qu'on pose une fois ; les pertes qui
    // s'ajouteront pendant la vie de la position iront dans le dû de la
    // SUIVANTE. Les sorties postérieures à cette bougie ne comptent pas encore :
    // c'est `settle` qui tient l'anti-anticipation.
    due.settle(eIdx);
    const { duePts, dueTotalPts, dueCount } = due.target();
    // La distance de l'objectif RÉELLEMENT visé. Une fois calculée, la suite ne
    // sait plus d'où elle vient — le plafond de la MFE la relit telle quelle.
    const tpEffPts = duePts > 0 ? duePts : tpPtsEff;

    const tp = isBuy ? entry + tpEffPts : entry - tpEffPts;
    const slStruct = isBuy ? Math.min(prev.low,  bar0.low)  - slMarginEff
                           : Math.max(prev.high, bar0.high) + slMarginEff;
    // SL plafonné : une DISTANCE à l'entrée, connue dès l'entrée. Le stop retenu
    // est le plus serré des deux — le plafond ne peut jamais élargir le risque.
    const capOn   = slCapPts > 0;
    const capStop = isBuy ? entry - slCapPts : entry + slCapPts;
    const sl      = !capOn ? slStruct
                  : isBuy ? Math.max(slStruct, capStop) : Math.min(slStruct, capStop);
    const slCapped = capOn && sl === capStop && capStop !== slStruct;
    const risk0 = Math.abs(entry - sl);
    if (!(risk0 > 0)) continue;

    const beProfit = beTriggerEff   > 0;
    const beTouch  = beTouchTrigger > 0;
    const beBars   = beBarsTrigger  > 0;
    const beSwing  = beSwingBars    > 0;
    const beOn     = beProfit || beTouch || beBars || beSwing;
    const beStop   = isBuy ? Math.max(entry + beLevelEff, sl) : Math.min(entry - beLevelEff, sl);
    // Stop de swing : sous/sur le pivot, même marge et même borne que le structurel.
    const swingStopAt = p2 => isBuy ? Math.max(candles[p2].low  - slMarginEff, sl)
                                    : Math.min(candles[p2].high + slMarginEff, sl);

    let slMoved = false, cutByTouch = false, beTime = null, beReason = null;
    let movedStop = null;   // niveau du stop une fois déplacé (BE ou swing)
    let touchCount = 0;

    // Un stop traversé en gap est rempli au pire du niveau et de l'ouverture —
    // jamais mieux que le marché.
    const stopFill = (stop, k) => isBuy ? Math.min(stop, k.open) : Math.max(stop, k.open);
    const hitStop  = (k, stop) => isBuy ? k.low  <= stop : k.high >= stop;
    const hitTp    = (k, lvl)  => isBuy ? k.high >= lvl  : k.low  <= lvl;
    const favOf    = k         => isBuy ? k.high - entry : entry - k.low;

    let exitIdx = null, exitPrice = null, exitReason = null, ambiguousExit = false;

    // — Bougie d'entrée : le stop structurel n'existe pas encore, seuls le TP et
    // le SL plafonné (une distance, donc posable avec l'ordre) peuvent la
    // résoudre. Le plafond est testé le premier : convention pessimiste, comme
    // partout ailleurs. Sans plafond, la bougie n'a qu'une issue possible, le TP,
    // et le parcours minute par minute ne changerait rien.
    if (capOn) {
      const [s0, e0] = useM1 ? m1Rng[eIdx] : [0, 0];
      const sub0     = useM1 ? e0 - s0 + 1 : 1;
      for (let q = 0; q < sub0 && exitIdx == null; q++) {
        const k = useM1 ? m1Bars[s0 + q] : bar0;
        if (hitStop(k, capStop)) {
          if (hitTp(k, tp)) ambiguousExit = true;
          exitIdx = eIdx; exitPrice = stopFill(capStop, k); exitReason = 'sl';
        } else if (hitTp(k, tp)) {
          exitIdx = eIdx; exitPrice = tp; exitReason = 'tp';
        }
      }
    } else if (hitTp(bar0, tp)) {
      exitIdx = eIdx; exitPrice = tp; exitReason = 'tp';
    }

    // Le BE sur profit s'arme sur cette bougie si elle n'a rien résolu — le stop
    // déplacé, lui, ne prend effet qu'à sa clôture.
    if (exitIdx == null && beProfit && favOf(bar0) >= beTriggerEff) {
      slMoved = true; movedStop = beStop; beTime = bar0.time; beReason = 'profit';
    }

    // — Bougie suivante et au-delà.
    if (exitIdx == null) {
      for (let j = eIdx + 1; j < n && exitIdx == null; j++) {
        const bar = candles[j];

        // Sous-bougies : les M1 de la bougie TF, ou la bougie TF elle-même.
        const [s, e] = useM1 ? m1Rng[j] : [0, 0];
        const subN   = useM1 ? e - s + 1 : 1;

        for (let q = 0; q < subN; q++) {
          const k    = useM1 ? m1Bars[s + q] : bar;
          const stop = slMoved ? movedStop : sl;

          // Stop d'abord (pessimiste, dans la minute comme dans la bougie).
          if (hitStop(k, stop)) {
            if (hitTp(k, tp)) { ambiguousExit = true; }
            exitIdx = j; exitPrice = stopFill(stop, k);
            exitReason = slMoved ? 'be' : 'sl';
            break;
          }
          if (hitTp(k, tp)) { exitIdx = j; exitPrice = tp; exitReason = 'tp'; break; }

          // BE sur PROFIT — armé à la granularité de la sous-bougie.
          if (beProfit && !slMoved && favOf(k) >= beTriggerEff) {
            slMoved = true; movedStop = beStop; beTime ??= k.time; beReason ??= 'profit';
            if (hitStop(k, beStop)) {
              exitIdx = j; exitPrice = stopFill(beStop, k); exitReason = 'be'; break;
            }
          }
        }
        if (exitIdx != null) break;

        // — Fin de bougie TF : les déclencheurs qui COMPTENT DES BOUGIES.
        if (beOn) {
          if (bar.low <= entry && bar.high >= entry) touchCount++;

          if (!slMoved && beBars && j - eIdx >= beBarsTrigger) {
            slMoved = true; movedStop = beStop; beTime ??= bar.time; beReason ??= 'bars';
            if (hitStop(bar, beStop)) {
              exitIdx = j; exitPrice = stopFill(beStop, bar); exitReason = 'be'; break;
            }
          }

          // BE sur SWING — premier pivot confirmé pendant la position. Le
          // candidat est j − beSwingBars, le seul que cette clôture confirme.
          // Pas de test de sortie immédiate : la bougie j appartient à la
          // fenêtre droite du swing, elle n'a pas pu toucher le nouveau stop.
          if (!slMoved && beSwing) {
            const pv = j - beSwingBars;
            if (pv >= eIdx && isSwingAt(candles, pv, beSwingBars, isBuy ? 'low' : 'high')) {
              slMoved = true; movedStop = swingStopAt(pv);
              beTime ??= bar.time; beReason ??= 'swing';
            }
          }

          // RETOURS → coupe nette au prix d'entrée. EN DERNIER, et c'est la règle
          // d'arbitrage : les sorties liées au stop se résolvent à un PRIX, donc
          // dans la bougie ; la coupe se résout à un COMPTE, donc à sa clôture.
          // Une position déjà refermée par son stop (structurel ou déplacé) n'y
          // arrive jamais — sur une bougie qui arme le BE profit ET repasse par
          // l'entrée, c'est le stop déplacé qui sort, rempli au pire de son niveau
          // et de l'open.
          if (beTouch && touchCount >= beTouchTrigger) {
            cutByTouch = true; beTime ??= bar.time; beReason ??= 'touch';
            exitIdx = j; exitPrice = entry; exitReason = 'be'; break;
          }
        }

        // — Plafond de durée (évolution, hors règle EA).
        if (maxBars > 0 && j - eIdx >= maxBars) {
          exitIdx = j; exitPrice = bar.close; exitReason = 'timeout'; break;
        }
      }

      if (exitIdx == null) {
        exitIdx    = n - 1;
        exitPrice  = candles[n - 1].close;
        exitReason = 'open';
      }
    }

    const isWin = exitReason === 'tp';

    // Cooldown après un gain — le signal sauté est simulé à blanc, jamais listé.
    if (cooldown > 0 && z.entryIdx > armExit) {
      cooldown -= 1;
      if (isWin) { cooldown = skipAfterTp; armExit = exitIdx; skippedWon++; }
      lastExitIdx = exitIdx;
      skipped++;
      continue;
    }

    if (ambiguousExit) ambiguous++;

    // Excursions — bougies TF dans les deux modes (cf. bloc de tête).
    let maxPullupPts = 0, maxDrawdownPts = 0, maeArmed = 0, entryTouches = 0;
    const mfeLast = exitReason === 'sl' || exitReason === 'be' ? exitIdx - 1 : exitIdx;
    for (let j = eIdx; j <= exitIdx; j++) {
      const k   = candles[j];
      const fav = isBuy ? k.high - entry : entry - k.low;
      const adv = isBuy ? entry - k.low  : k.high - entry;
      if (j <= mfeLast && fav > maxPullupPts) maxPullupPts = fav;
      if (adv > maxDrawdownPts) maxDrawdownPts = adv;
      if (j > eIdx) {
        if (adv > maeArmed) maeArmed = adv;
        if (k.low <= entry && k.high >= entry) entryTouches++;
      }
    }
    // Plafond de la MFE : l'objectif EN VIGUEUR, dû compris — le prix ne peut
    // pas aller au-delà sans que la position soit sortie.
    maxPullupPts   = Math.min(Math.max(0, maxPullupPts),   tpEffPts);
    maxDrawdownPts = Math.min(Math.max(0, maxDrawdownPts), risk0);
    const maeArmedPts = exitIdx > eIdx ? Math.min(Math.max(0, maeArmed), risk0) : null;

    // Coût du trade : dû par toute position CLÔTURÉE, quelle que soit son issue.
    // Une position encore ouverte au bord des données n'a rien payé.
    const grossPts  = isBuy ? exitPrice - entry : entry - exitPrice;
    const spreadDue = exitReason === 'open' ? 0 : (spreadPts > 0 ? spreadPts : 0);

    trades.push({
      id:           id++,
      direction:    isBuy ? 'BUY' : 'SELL',
      label:        z.label,
      entryTime:    z.entryTime,
      entryPrice:   entry,
      exitTime:     candles[exitIdx].time,
      exitPrice,
      sl:           slMoved ? movedStop : sl,
      sl0:          sl,
      slCapped,     // le plafond a décidé du stop initial, pas la structure
      tp,
      beActivated:  slMoved || cutByTouch,
      beReason,
      beTime,
      cutAtEntry:   cutByTouch,
      risk0,
      // Le dû visé par CETTE position, en points, ou 0 si elle jouait son vrai
      // TP — et, à côté, l'ardoise ENTIÈRE au moment d'entrer. Les deux sont
      // égales en remboursement d'un coup ; par bonds, l'écart dit ce qui
      // restera à devoir. Conservé pour qu'un remboursement se vérifie à la main.
      duePts,
      dueTotalPts,
      dueCount,
      profitPoints: grossPts,          // BRUT — ce qui se lit sur le graphe
      spreadPts:    spreadDue,         // coût appliqué à CETTE position
      netPoints:    grossPts - spreadDue,
      exitReason,
      status:       exitReason,
      barsHeld:     exitIdx - eIdx,
      entryTouches,
      maxPullupPts,
      maxDrawdownPts,
      maeArmedPts,
    });
    lastExitIdx = exitIdx;

    // La position est RETENUE : son résultat entre dans l'ardoise — mais il n'y
    // pèsera que lorsqu'une entrée POSTÉRIEURE à sa sortie viendra le lire. Une
    // position encore ouverte au bord des données n'a rien réalisé.
    if (duePts > 0) dueArmedCount++;
    if (exitReason !== 'open') due.record(exitIdx, grossPts - spreadDue);

    if (skipAfterTp > 0 && isWin) { cooldown = skipAfterTp; armExit = exitIdx; }
  }

  trades.skippedByCooldown = skipped;
  trades.skippedWon        = skippedWon;
  trades.ambiguous         = ambiguous;
  // Le dû : combien de positions ont visé un remboursement plutôt que leur vrai
  // TP, et ce qui reste sur l'ardoise au bord des données. Les sorties encore en
  // attente sont soldées ici — sans quoi le reliquat oublierait les dernières
  // positions closes, qu'aucune entrée suivante n'est venue lire.
  due.settle(Infinity);
  const dueLeft = due.remaining();
  trades.dueArmed        = dueArmedCount;
  trades.dueRemainingPts = dueLeft.pts;
  trades.dueRemainingSl  = dueLeft.count;
  return trades;
}
