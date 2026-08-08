// $$$ — la prise de position.
//
// Le motif détecte (./detect.js) ; la gestion est celle, commune, de
// lib/patternPositions.js — la même que le liq, le rev, le Twins Bars, le xFVG+,
// le RSIER et le TRENDER. C'est voulu : sept motifs mesurés par le même code,
// sinon un écart de résultat ne dit plus si la détection ou la sortie en est
// responsable.
//
// QUATRE CHOSES SONT PROPRES À CE MOTIF.
//
//   1. LE SENS EST CELUI DU SECOND MOTIF — le dernier FVG de la paire — et il
//      n'y a rien à régler là. Une paire baissière→haussière s'ACHÈTE, une paire
//      haussière→baissière se VEND.
//      Ce n'est pas la même chose que de suivre la première impulsion, et c'est
//      le point de vue de la figure : une paire qui commence haussière est une
//      POINTE HAUTE, on la vend. Le tri `direction` (qui choisit les paires par
//      le sens du PREMIER motif) sélectionne donc aussi le sens des trades, à
//      l'envers de son nom — « pointe haute » ne donne que des ventes. Le libellé
//      du panneau le dit ; le nom de la clé, hérité de la famille, ne le peut pas.
//
//   2. OÙ L'ORDRE EST POSÉ (`entryLevel`). Deux niveaux, tous deux déjà dans la
//      figure, et on attend que le prix y revienne.
//        'bord'    — le bord de la SECONDE boîte opposé au pivot. Les deux
//          boîtes partagent le pivot (cf. l'en-tête de ./detect.js) et pendent
//          du même côté ; le bord LIBRE de la seconde est donc celui qui fait
//          face au prix quand la figure se termine — le haut pour un achat, le
//          bas pour une vente. C'est aussi, par construction, l'extrémité de la
//          DERNIÈRE bougie de la figure.
//        'extreme' — la POINTE : l'autre bout de la bougie PARTAGÉE, le plus
//          loin où le marché est allé avant de se retourner. Il est de l'autre
//          côté de toute la figure, donc BEAUCOUP plus loin du prix : l'ordre y
//          est servi bien plus rarement, et bien mieux placé quand il l'est.
//          Le niveau de SANTÉ le suit — sans quoi toute position naîtrait
//          malsaine, puisque atteindre l'extrême suppose d'avoir traversé le
//          bord du gap.
//      ± `entryMargin`, marge SIGNÉE comptée du côté d'où le prix revient :
//      positive, l'ordre est EN DEÇÀ du bord (pré-entrée, servi plus tôt et plus
//      souvent, à un prix moins bon) ; négative, il est plus loin DANS la boîte.
//
//   3. LE PRIX PEUT ÊTRE DÉJÀ PASSÉ. Une marge de pré-entrée assez large met le
//      niveau du mauvais côté du marché dès la pose de l'ordre. Il est alors
//      rempli sur-le-champ, à l'ouverture de la bougie suivante — c'est le mode
//      'limit' du simulateur, écrit pour ça (le mode 'zone', lui, exigerait que
//      le prix soit d'abord SORTI pour y « revenir », et attendrait le retour du
//      mauvais côté). Une vraie limite d'achat posée sous un marché déjà plus bas
//      part au marché : c'est cette mécanique-là, pas une exception au motif.
//
//   4. TOUTES LES DISTANCES SE RÈGLENT EN POINTS OU EN ATR, d'un seul
//      interrupteur — marge d'entrée, SL et TP changent d'unité ensemble. En ATR,
//      l'ATR est lu sur la DERNIÈRE BOUGIE DE LA FIGURE (celle qui la rend
//      connue, close avant que l'ordre existe : rien n'est anticipé) et FIGÉ là
//      pour toute la vie de la position. Un stop qui suivrait l'ATR se
//      déplacerait tout seul, ce qui n'est plus un stop. Les distances sont
//      converties ici et passées au simulateur signal par signal (`slPts` /
//      `tpPts`), qui n'a pas à savoir d'où elles viennent.
//
// SL ET TP SONT FIXES ET INDÉPENDANTS. Aucun stop structurel : la boîte est déjà
// l'objet qu'on joue, s'en servir de stop attacherait le risque au hasard de la
// taille de l'impulsion. Le risque est donc CONSTANT — points et R disent la même
// chose, et le seuil de rentabilité redevient le 1/(1+RR) des manuels.
//
// DEUX BREAK-EVEN, UN SEUL NIVEAU. Celui DE LA FAMILLE — un déplacement de stop
// dès que la position avance d'un seuil en R — est éteint de force : ce n'est
// pas celui de ce motif. Les deux d'ici visent le même petit gain au-dessus de
// l'entrée (`beUnhealthyPts` / `beUnhealthyAtr`, la distance est partagée) et ne
// diffèrent que par ce qui les arme et par le côté d'où ils agissent.
//
//   • LE BE DU MALSAIN — armé par une AVARIE. Le jour où la position cesse
//     d'être saine, on renonce à l'objectif et on attend que le prix revienne au
//     niveau pour solder là. Il n'agit que d'un côté : il ATTEND. Ce n'est pas
//     un stop qu'on déplace, c'est une CIBLE qu'on abaisse. Le stop reste actif
//     pendant l'attente — c'est une course, et rien ne garantit le retour.
//
//   • LE BE EXISTENTIEL — armé par le TEMPS (`beExistBars`). Passé N bougies, la
//     position a assez duré pour qu'on cesse de lui faire crédit, et le niveau
//     devient un point de sortie des DEUX CÔTÉS : au-delà il protège (on ne
//     redescend plus dessous), en deçà il coupe dès qu'on y arrive.
//
// Ils se cumulent sans se gêner : le premier armé qui voit le prix toucher le
// niveau sort la position, et `beReason` dit lequel a agi. Conséquence commune :
// une position dont un BE est armé ne peut plus atteindre son TP PAR LE BAS —
// le niveau est plus près de l'entrée que l'objectif. Seule une position
// protégée par l'existentiel, restée au-delà du niveau, peut encore y aller.
//
// LE TRADE UNIQUE, LUI, EXISTE — mais ce n'est pas celui de la famille. Une
// position ne réserve la place que TANT QU'ELLE EST SAINE : aucune bougie n'a
// clôturé au-delà du bord du gap qui l'a fait entrer. Dès qu'elle cesse de
// l'être, le motif suivant est jouable même si elle court toujours — elle ne
// tient plus son niveau, elle ne mérite plus qu'on lui garde la place. Peu
// importe où elle a été prise : aucune moyenne mobile n'entre ici, contrairement
// au TP dynamique 2 qui partage le mot « saine » mais y ajoute sa condition de
// MM. C'est `uniqueMode: 'healthy'` du simulateur, forcé ici.
// À SAVOIR : « trade unique » ne veut donc plus dire « un seul trade à la fois ».
// Deux positions peuvent se chevaucher dès que la première est devenue malsaine.
//
// UNE PAIRE = UNE POSITION, jamais deux : c'est le second motif qui la porte.
// Dans une chaîne (centrales i, i+2, i+4 de sens alternés), le motif du milieu
// est le second d'une paire et le premier de la suivante — il donne donc une
// position au titre de la première seulement. Sans trade unique, deux paires
// enchaînées donnent deux positions qui se chevauchent librement : la courbe de
// gains du rapport additionne alors des trades simultanés, à savoir avant d'y
// lire un drawdown.

import { detectDollarPairs } from './detect';
import { DETECT_DEFAULTS, POSITION_DEFAULTS } from './params';
import { simulatePatternPositions } from '../patternPositions';
import { atrArr, smaArr } from '../patterns';

export function calcDollarsPositions(candles, opts = {}) {
  const p = {
    ...DETECT_DEFAULTS, ...POSITION_DEFAULTS, ...opts,
    // Non négociables, même si un réglage enregistré disait autre chose : ce
    // sont les règles du motif, pas des préférences. Cf. l'en-tête.
    entryMode: 'limit',
    slMode:    'points',
    tpMode:    'points',
    // Le TRADE UNIQUE de ce motif n'est pas celui de la famille : une position
    // ne réserve la place que tant qu'elle est SAINE. `uniqueTrade` reste un
    // réglage (on l'allume ou non), `uniqueMode` non — c'est la règle.
    uniqueMode: 'healthy',
    // Le break-even DE LA FAMILLE (déplacement de stop sur seuil en R) reste
    // éteint de force : ce n'est pas celui de ce motif. Le BE DU MALSAIN, lui,
    // est bien à lui et se règle plus haut (`beUnhealthyPts` / `beUnhealthyAtr`).
    beTriggerR: 0,
    beLevelR:   0,
  };

  const pairs  = detectDollarPairs(candles, p);
  const inAtr  = p.distUnit === 'atr';
  // L'ATR n'est calculé que s'il sert : un motif réglé tout en points ne paie
  // pas une passe sur les bougies pour rien.
  const atr = inAtr
    ? atrArr(candles, Math.max(1, Math.floor(p.atrPeriod ?? POSITION_DEFAULTS.atrPeriod)))
    : null;

  // La moyenne du TP dynamique 2, et RIEN d'autre. C'est la seule moyenne mobile
  // de ce motif ; elle ne touche pas à la détection — les zones sont les mêmes
  // qu'elle existe ou non — et ne sert qu'à dire de quel côté la position s'est
  // ouverte. Le simulateur la lit à la bougie d'entrée, qu'il est seul à
  // connaître (l'ordre est en attente), d'où la série entière passée telle
  // quelle plutôt qu'une valeur par signal.
  const saneOn = p.tpSaneMaPeriod > 0 && p.tpSaneMult > 1;
  const saneMa = saneOn ? smaArr(candles, Math.floor(p.tpSaneMaPeriod)) : null;

  const signals = [];
  let skippedByAtr = 0;

  for (const pair of pairs) {
    const second = pair.second;

    // L'ATR de référence, lu sur la dernière bougie de la figure et figé là.
    // Une figure trop proche du début des données pour que l'ATR existe est
    // écartée et comptée : on ne dimensionne pas un stop sur une volatilité
    // qu'on n'a pas mesurée.
    const a = atr ? atr[pair.readyIdx] : null;
    if (inAtr && !(a > 0)) { skippedByAtr++; continue; }

    const margin = inAtr ? a * p.entryMarginAtr : p.entryMarginPts;
    const slPts  = inAtr ? a * p.slAtr : p.slPts;
    const tpPts  = inAtr ? a * p.tpAtr : p.tpPts;
    const beUnh  = inAtr ? a * p.beUnhealthyAtr : p.beUnhealthyPts;

    // LE NIVEAU ATTENDU. Deux choix, tous deux déjà dans la figure :
    //   'bord'    — le bord LIBRE de la seconde boîte, celui qui n'est pas le
    //     pivot et qui fait donc face au prix quand la figure se termine.
    //   'extreme' — la POINTE : l'autre bout de la bougie partagée, le plus loin
    //     où le marché est allé. Bien plus loin du prix — servi plus rarement,
    //     et beaucoup mieux placé quand il l'est.
    // La marge s'ajoute dans les deux cas du côté d'où le prix revient : vers le
    // HAUT pour un achat (on l'attend en descente), vers le BAS pour une vente.
    const edge  = p.entryLevel === 'extreme'
      ? pair.extremePrice
      : (second.isBull ? second.top : second.bottom);
    const level = second.isBull ? edge + margin : edge - margin;

    signals.push({
      // LE SENS DU SECOND MOTIF, et lui seul.
      side:    second.side,
      // La figure entière, pour que le rapport pointe la bonne chose sur le
      // graphe. Le stop étant en points, `fromIdx` ne sert à rien de plus.
      fromIdx: pair.startIdx,
      // La figure n'est connue qu'à la clôture de sa dernière bougie : le
      // simulateur arme l'ordre à `toIdx + 1`, donc juste après elle.
      toIdx:   pair.readyIdx,
      level,
      slPts,
      tpPts,
      // Le BE du malsain, dans la même unité que le reste. 0 = éteint.
      beUnhealthyPts: beUnh,
      // Le niveau qui dit si la position reste SAINE : celui qu'on a ATTENDU,
      // marge NON comprise. Une bougie qui CLÔTURE au-delà dit que le niveau n'a
      // pas tenu ; une mèche qui le traverse ne dit rien.
      // IL SUIT L'ENTRÉE, et c'est nécessaire : entrer à l'extrême suppose
      // d'avoir traversé le bord du gap, donc garder ce bord comme référence
      // ferait naître toute position malsaine — le BE du malsain s'armerait
      // aussitôt et le trade unique ne bloquerait plus rien.
      // Marge exclue en revanche, dans les deux cas : juger la santé sur le prix
      // d'entrée la ferait dépendre d'un réglage plutôt que de la figure.
      healthLevel: edge,
      // Repères portés jusqu'au rapport, pour qu'une position se relise sans
      // relancer la détection.
      zoneTop:    second.top,
      zoneBottom: second.bottom,
      entryEdge:  edge,
      pivotPrice: pair.pivotPrice,
      similarity: pair.similarity,
      pairSide:   pair.side,
      atr:        a,
    });
  }

  const trades = simulatePatternPositions(candles, signals, { ...p, tpSaneMa: saneMa }, '$$$');

  // Le simulateur ne recopie que les champs qu'il CONNAÎT : les repères propres
  // à ce motif sont réattachés ici, sinon ils s'arrêteraient au signal. `toIdx`
  // est la dernière bougie de la figure — une clé sûre, deux paires ne pouvant
  // pas finir sur la même. Ils partent dans `extra`, que le rapport déverse tel
  // quel : c'est ce qui permet de relire une position sans relancer la détection.
  const byToIdx = new Map(signals.map(s => [s.toIdx, s]));
  for (const t of trades) {
    const s = byToIdx.get(t.toIdx);
    if (!s) continue;
    t.entryEdge  = s.entryEdge;
    t.pivotPrice = s.pivotPrice;
    t.similarity = s.similarity;
    t.pairSide   = s.pairSide;
    t.extra = {
      entryEdge:  s.entryEdge,      // le bord visé, marge NON comprise
      pivotPrice: s.pivotPrice,     // l'arête commune aux deux boîtes
      similarity: s.similarity != null ? +s.similarity.toFixed(2) : null,
      pairSide:   s.pairSide,       // le sens du PREMIER motif — l'inverse du trade
      zoneTop:    s.zoneTop,
      zoneBottom: s.zoneBottom,
      atr:        s.atr,            // l'ATR figé, null quand tout est en points
    };
  }

  // Combien de paires la détection a trouvées en tout — le rapport aurait sinon
  // moins de positions que de figures sans jamais dire pourquoi.
  trades.pairsTotal   = pairs.length;
  trades.skippedByAtr = skippedByAtr;

  // CE QUE LE TP DYNAMIQUE A COÛTÉ ET RAPPORTÉ. Le stop ne bougeant pas, une
  // cible repoussée transforme un gain acquis en perte pleine quand le marché se
  // retourne. Compter les extensions ne dit donc rien tout seul : il faut savoir
  // combien ont fini au stop, et ce que la règle a changé au total. `tpBoostNet`
  // est la différence entre ce que les positions étendues ont réellement rendu
  // et ce qu'elles auraient rendu en sortant à leur cible de départ — le seul
  // chiffre qui tranche.
  // CE QUE LE BE DU MALSAIN A SAUVÉ. Une position qui tourne mal n'est pas
  // sauvée pour autant : le prix doit REVENIR, et il ne revient pas toujours.
  // Compter les sorties en BE ne dit donc rien tout seul — il faut le rapporter
  // au nombre de positions qui sont devenues malsaines, c'est-à-dire à celles
  // que la règle a EU l'occasion de sauver.
  const wentBad = trades.filter(t => t.status !== 'missed' && t.stayedHealthy === false);
  trades.beUnhealthyArmed = wentBad.length;
  trades.beUnhealthySaved = wentBad.filter(t => t.beReason === 'unhealthy').length;
  trades.beUnhealthyLost  = wentBad.filter(t => t.status === 'sl').length;
  // Le BE existentiel, compté à part : les deux règles partagent le niveau mais
  // pas la raison de sortir, et les mélanger empêcherait de savoir laquelle des
  // deux agit réellement.
  trades.beExistExits = trades.filter(t => t.beReason === 'existential').length;

  const boosted = trades.filter(t => t.tpBoosted);
  trades.tpBoosted     = boosted.length;
  trades.tpBoostedLost = boosted.filter(t => t.status === 'sl').length;
  trades.tpBoostedNet  = +boosted
    .reduce((s, t) => s + ((t.netPoints ?? 0) - ((t.tpBaseDistPts ?? 0) - (t.spreadPts ?? 0))), 0)
    .toFixed(4);
  return trades;
}
