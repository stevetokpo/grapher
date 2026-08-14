// $$$ — la détection.
//
// CE QUE C'EST. Deux imbalances 3 bougies, de sens CONTRAIRES et EMBOÎTÉES : la
// 3e bougie de la première est la 1re de la seconde. Les deux bougies centrales
// sont donc à exactement deux barres d'écart, et la figure tient sur cinq
// bougies :
//
//        i-1     i     i+1     i+2     i+3
//         └── motif 1 ──┘       │       │
//                       └──── motif 2 ──┘
//                        ▲
//                        la bougie PARTAGÉE
//
// L'appariement n'est pas une option qu'on allume : c'est la définition. Un
// motif seul n'est pas un $$$, et il n'y a aucun réglage pour le rendre seul.
//
// LA FIGURE EST PUREMENT GÉOMÉTRIQUE. Le motif descend du rFVG, qui classait ses
// imbalances selon la position de la centrale vis-à-vis de deux MM et ne gardait
// que les impulsions dépassant un multiple de l'ATR. Il n'en reste rien : ni le
// classement (rFVG / aFVG / cFVG / superFVG), ni les filtres qui en vivaient, ni
// le seuil de taille, ni les bornes du gap, ni la mèche de rejet. Le détecteur ne
// pose que deux questions par bougie — est-elle directionnelle, laisse-t-elle un
// vide franc — puis deux par couple : les deux motifs sont-ils opposés et
// emboîtés, et leurs boîtes se ressemblent-elles assez (`similarity`).
// `direction` ne juge rien, il trie ce qui reste.
//
// UN SEUL FILTRE REGARDE AILLEURS : l'EXTRÊME DE RSI (`rsiPeriod`, éteint par
// défaut), qui demande à la dernière bougie de sens contraire précédant la
// seconde impulsion d'avoir clôturé en zone extrême. Il ne change pas la figure
// — il en écarte —, mais c'est la seule chose de ce fichier qui ne se lise pas
// dans les seules bougies de la paire. À garder à part dans la tête : tout le
// reste tient dans cinq bougies.
//
// Conséquence à connaître avant de s'en servir : le motif ne trie plus rien. Une
// paire d'imbalances minuscules compte autant qu'une paire d'impulsions
// violentes, et sur une unité de temps courte il en sortira BEAUCOUP — c'est
// attendu, pas un défaut de détection. Il ne « sait » rien non plus de la
// tendance : il ne porte aucun sens de lui-même. Le tri, s'il en faut un,
// appartient à ce qui lira ces zones, pas à ce fichier.
//
// ── LA GÉOMÉTRIE, à lire avant de s'en servir ────────────────────────────────
// Les deux boîtes d'une paire ne sont PAS indépendantes. Elles partagent une
// arête, et c'est toujours la même — celle que donne la bougie partagée.
//
// Prenons une paire haussière-puis-baissière (centrale 1 en i, centrale 2 en i+2,
// bougie partagée en i+1) :
//   • motif 1, haussier : sa boîte va de candles[i-1].high à candles[i+1].low
//   • motif 2, baissier : sa boîte va de candles[i+3].high à candles[i+1].low
// Les deux se terminent sur candles[i+1].low. Les deux vides PENDENT donc sous
// le plus bas de la bougie partagée, l'une dans l'autre — celle qui descend le
// plus bas contient l'autre. À l'écran, une paire ne dessine pas deux boîtes
// côte à côte : elle dessine un NIVEAU, et deux profondeurs sous ce niveau.
// (Symétriquement pour une paire baissière-puis-haussière : les deux boîtes
// tiennent au-dessus du plus haut de la bougie partagée.)
//
// C'est ce niveau qu'on appelle ici le PIVOT, et il est rendu dans chaque zone
// comme dans chaque paire. Si une gestion de position doit un jour se raccrocher
// à un prix de cette figure, c'est celui-là — pas un bord de boîte choisi au
// hasard entre deux qui se valent.
//
// CE QUE LE SENS D'UNE PAIRE VEUT DIRE. Une paire qui commence HAUSSIÈRE, c'est
// un gap vers le haut puis, immédiatement, un gap vers le bas : le marché a
// poussé, s'est retourné sur une bougie, et est reparti dans l'autre sens en
// laissant deux vides. C'est une POINTE HAUTE — donc une structure de
// retournement BAISSIER. `direction: 'bull'` sélectionne ces paires-là ; ça ne
// veut pas dire « signal d'achat ». L'inverse pour 'bear' : une pointe basse.
// Le réglage porte sur le sens du PREMIER motif parce que c'est le seul tri qui
// ne coupe pas les paires en deux.
//
// LES CHAÎNES ET LES CHEVAUCHEMENTS. Si les centrales i, i+2, i+4 alternent de
// sens, (i, i+2) et (i+2, i+4) sont deux paires valides : le motif du milieu
// ferme la première et ouvre la seconde. Il n'est dessiné qu'une fois, avec le
// rôle 'both'. Deux centrales VOISINES (i et i+1) peuvent porter chacune sa
// paire : les figures se chevauchent, c'est normal, elles ne sont pas les mêmes.
//
// ── LES ÉTAGES ───────────────────────────────────────────────────────────────
//   1. motifAt() — juge UNE imbalance, avec ce qu'on sait d'elle seule. Elle ne
//      voit ni sa voisine, ni la paire à venir.
//   2. detectDollarPairs() — apparie ce que le premier étage a laissé. C'est le
//      seul endroit qui a le droit de regarder deux motifs ensemble.
//   3. calcDollars() — met la paire à plat en zones dessinables.
// Une condition nouvelle qui juge UNE bougie va dans l'étage 1 ; une qui compare
// les motifs entre eux, dans l'étage 2. Rien ne doit se glisser entre les deux.
//
// Chaque zone : { side, state: 'active', top, bottom, gap, startTime, endTime,
//                 idx, role, pairSide, pivotIdx, pivotTime, pivotPrice,
//                 readyIdx, readyTime, entryIdx, entryTime, entryPrice }
//   idx        → l'index de la bougie CENTRALE du motif dans `candles`.
//   role       → 'first' | 'second' | 'both' — sa place dans la paire ('both'
//                dans une chaîne, où le motif ferme une paire et ouvre l'autre).
//   pairSide   → le sens du PREMIER motif de sa paire, donc celui sur lequel
//                `direction` a trié. À ne pas confondre avec `side`, qui est le
//                sens de CE motif-ci.
//   similarity → le recouvrement MESURÉ des deux boîtes de la paire, 0–100 (cf.
//                similarityOf). Rendu même quand le seuil est à 0 : c'est une
//                mesure de la figure, pas la trace d'un filtre.
//   pivot*     → le niveau partagé par les deux boîtes (cf. ci-dessus). Un motif
//                appartenant à deux paires garde le pivot de la PREMIÈRE dans le
//                temps — l'autre est de toute façon son arête opposée.
//   ready*     → la bougie à la clôture de laquelle la figure est CONNUE, soit
//                la 5e. Rien de ce motif n'existe avant elle.
//   entry*     → l'ouverture de la bougie qui suit `readyIdx`. Aucune gestion
//                n'est branchée à ce jour ; c'est le seul prix qu'une future
//                simulation pourrait honnêtement prendre, et il est calculé ici
//                pour qu'elle n'ait pas à le redécouvrir de travers.
//   gap        → la hauteur du vide qui a fait la boîte, donc toujours > 0 : le
//                motif n'existe que si la 1re et la 3e bougie ne se touchent pas.
//   endTime null → extLen dépasse la fin des données, la boîte va jusqu'au bord.

import { DETECT_DEFAULTS } from './params';
import { smaArr } from '../patterns';
// Le RSI de la plateforme, celui de la corne et du laboratoire /rsi. Aligné sur
// l'index des bougies, null pendant le préchauffage. En écrire un second ici
// garantirait qu'ils divergent un jour.
import { rsiOf } from '../rsi/features';

// ── L'EXTRÊME DE RSI AVANT L'IMPULSION ───────────────────────────────────────
// La dernière bougie qui allait DANS LE SENS CONTRAIRE de l'impulsion, juste
// avant elle, a-t-elle clôturé en zone extrême ?
//
// Pour une paire haussière→baissière, l'impulsion qui creuse le second gap est
// BAISSIÈRE : on cherche la dernière bougie HAUSSIÈRE avant elle, et on la veut
// en SURACHAT. Autrement dit, le dernier sursaut d'achat avant la cassure était
// déjà à bout de souffle. Symétriquement en survente pour l'autre sens.
//
// LA RECHERCHE EST BORNÉE PAR CONSTRUCTION, sans réglage : le premier motif de
// la paire est toujours de sens contraire au second, donc sa centrale — deux
// barres avant l'impulsion — va forcément dans le sens cherché. La boucle
// s'arrête donc au pire à la deuxième bougie testée. Elle reste écrite en
// général : c'est la définition qui la borne, pas une limite qu'on aurait posée.
// Rend { idx, rsi, ok } — la bougie trouvée et son verdict, ou null si aucune.
// Le détail est gardé pour que la zone puisse le porter : sans lui, un motif
// écarté par ce filtre ne s'expliquerait pas.
function extremeAvant(candles, rsi, impulseIdx, cherchehaussiere, seuilHaut, seuilBas) {
  for (let j = impulseIdx - 1; j >= 0; j--) {
    const k = candles[j];
    const monte  = k.close > k.open;
    const baisse = k.close < k.open;
    // Un doji ne va nulle part : il n'est ni le sursaut ni le repli qu'on cherche.
    if (cherchehaussiere ? !monte : !baisse) continue;
    const v = rsi[j];
    // RSI pas encore chaud : on ne conclut pas, et on n'invente pas non plus.
    if (v == null) return { idx: j, rsi: null, ok: false };
    return { idx: j, rsi: v, ok: cherchehaussiere ? v >= seuilHaut : v <= seuilBas };
  }
  return null;
}

// ── La similitude des deux boîtes ────────────────────────────────────────────
// Combien les deux zones d'une paire se ressemblent, en pourcentage — 100 =
// elles sont le même rectangle, 0 = elles n'ont rien en commun.
//
// La mesure est le RECOUVREMENT : intersection / union, l'indice de Jaccard, la
// façon habituelle de comparer deux intervalles. Elle a deux qualités qu'un
// écart en points n'a pas : elle est SANS UNITÉ (un seuil trouvé sur un symbole
// vaut sur les autres, quel que soit le prix ou la volatilité) et elle est
// bornée entre 0 et 100, donc lisible telle quelle.
//
// Ici, elle dit quelque chose de très concret. Les deux boîtes partagent une
// arête — le pivot (cf. la géométrie plus haut) — et s'étendent du même côté :
// l'intersection est donc exactement la plus PETITE des deux, l'union la plus
// GRANDE, et le recouvrement se réduit au rapport de leurs hauteurs. « 85 »
// veut dire : le gap le moins profond couvre 85 % du plus profond.
//
// La forme générale est gardée quand même. Elle ne suppose rien de la
// géométrie, et restera juste le jour où celle-ci bougera.
function similarityOf(a, b) {
  const inter = Math.max(0, Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom));
  const union = (a.top - a.bottom) + (b.top - b.bottom) - inter;
  return union > 0 ? (inter / union) * 100 : 0;
}

// ── Étage 1 : une imbalance, jugée seule ─────────────────────────────────────
// L'imbalance 3 bougies centrée sur `i`, ou null. Deux questions, pas une de
// plus : la centrale est-elle directionnelle, et laisse-t-elle un vide franc.
function motifAt(candles, i) {
  const a = candles[i - 1]; // 1re — une borne du gap
  const m = candles[i];     // 2e  — la centrale, celle qui creuse le gap
  const c = candles[i + 1]; // 3e  — l'autre borne

  // La centrale est directionnelle. Un doji ne creuse rien.
  const isBull = m.close > m.open;
  const isBear = m.close < m.open;
  if (!isBull && !isBear) return null;

  // Les deux NIVEAUX du motif, et le VIDE entre eux.
  //   haussier : gap = bas de la 3e  − haut de la 1re
  //   baissier : gap = bas de la 1re − haut de la 3e
  // Le vide est exigé FRANC : la 1re et la 3e bougie ne doivent pas se toucher.
  // Il n'y a rien à régler ici — ni plancher, ni plafond, ni tolérance au
  // chevauchement. Un gap nul ou négatif n'est pas un déséquilibre : les deux
  // bougies se recouvrent, il n'y a pas de prix que le marché ait sauté, et la
  // boîte ne serait qu'une bande commune sans rien dedans.
  const hi  = isBull ? c.low  : a.low;
  const lo  = isBull ? a.high : c.high;
  const gap = hi - lo;
  if (gap <= 0) return null;

  // Et c'est tout. Ni TAILLE (une petite impulsion qui laisse un vrai vide est
  // une imbalance au même titre qu'une grosse), ni FORME (pas de mèche de rejet
  // à exiger sur la 3e bougie). Ce motif ne connaît que sa géométrie ; le jour
  // où il faudra trier, ça se fera sur la sortie, pas ici.
  return {
    i,
    side:   isBull ? 'bull' : 'bear',
    isBull,
    gap,
    top:    hi,
    bottom: lo,
  };
}

// ── Étage 2 : l'appariement ──────────────────────────────────────────────────
// Les paires, dans l'ordre des bougies. C'est la sortie « structurelle » du
// motif — celle à laquelle se brancherait une gestion de position, parce qu'elle
// porte la figure entière (les deux motifs, le pivot, la bougie où elle est
// connue) au lieu de deux boîtes qu'il faudrait rapparier.
export function detectDollarPairs(candles, opts = {}) {
  const p = { ...DETECT_DEFAULTS, ...opts };
  const n = candles.length;
  if (n < 5) return [];   // cinq bougies, c'est le minimum vital de la figure

  // Le RSI n'est calculé que s'il sert : un motif réglé sans ce filtre ne paie
  // pas une passe sur les bougies pour rien.
  const rsiOn = p.rsiPeriod > 0;
  const rsi   = rsiOn ? rsiOf(candles, Math.floor(p.rsiPeriod), 'close') : null;

  // La moyenne de la mesure d'écart. Elle est ici, dans l'APPARIEMENT, et non
  // dans les fonctions de dessin : depuis qu'un seuil peut écarter une figure,
  // c'est une condition du motif — donc quelque chose que les positions doivent
  // voir elles aussi. La calculer trois fois côté dessin aurait en plus laissé
  // trois occasions de diverger.
  const maOn = p.maDistPeriod > 0;
  const ma   = maOn ? smaArr(candles, Math.floor(p.maDistPeriod)) : null;
  // Le seuil, et un seul : un minimum et un maximum ne se règlent pas ensemble.
  const seuilMin = p.maDistMode === 'min' && p.maDistMin > 0 ? p.maDistMin : 0;
  const seuilMax = p.maDistMode === 'max' && p.maDistMax > 0 ? p.maDistMax : 0;

  // Un motif par bougie centrale, au plus : une bougie est haussière OU
  // baissière, jamais les deux — son index est donc une clé sûre. La Map
  // conserve l'ordre d'insertion, donc l'ordre des bougies.
  const motifs = new Map();
  for (let i = 1; i < n - 1; i++) {
    const mo = motifAt(candles, i);
    if (mo) motifs.set(i, mo);
  }

  const pairs = [];
  for (const [i, first] of motifs) {
    const second = motifs.get(i + 2);
    if (!second || second.side === first.side) continue;

    // Les deux boîtes se ressemblent-elles assez ? Un seuil à 0 laisse tout
    // passer sans qu'on ait à l'écrire : le recouvrement n'est jamais négatif.
    // C'est la seule condition du motif qui compare les deux moitiés de la
    // figure — sa place est donc ici, et nulle part ailleurs.
    const similarity = similarityOf(first, second);
    if (similarity < p.similarity) continue;

    // L'EXTRÊME DE RSI. Jugé sur le SECOND motif — celui qui donne le sens de la
    // figure —, et sur la bougie de sens CONTRAIRE qui le précède : le dernier
    // sursaut avant la cassure. Second motif baissier → on veut la dernière
    // haussière en SURACHAT ; second motif haussier → la dernière baissière en
    // SURVENTE. Sa place est ici, dans l'appariement : un motif seul ne sait pas
    // encore s'il est le premier ou le second de sa paire, et la question n'a de
    // sens que pour le second.
    const ext = rsiOn
      ? extremeAvant(candles, rsi, second.i, !second.isBull, p.rsiOverbought, p.rsiOversold)
      : null;
    if (rsiOn && !ext?.ok) continue;

    // LA 3e BOUGIE DU SECOND MOTIF, INVERSÉE. Celle qui referme le second gap
    // doit clôturer à CONTRE-SENS de l'impulsion qui vient de le creuser :
    // impulsion baissière → bougie haussière, et l'inverse. Le marché ne se
    // contente donc pas de s'arrêter, il rend déjà du terrain — c'est le premier
    // signe que la pointe est finie plutôt qu'en pause.
    // Cette bougie est aussi la 5e de la figure, celle qui la rend connue : la
    // condition ne coûte donc aucune bougie d'attente supplémentaire.
    // Un doji est refusé : il ne rend rien, il hésite.
    if (p.reverseThird === true) {
      const t = candles[second.i + 1];
      const rend = second.isBull ? t.close < t.open : t.close > t.open;
      if (!rend) continue;
    }

    // `direction` trie les PAIRES par le sens de leur premier motif. Jamais les
    // zones une à une : ça couperait la figure en deux.
    if (p.direction !== 'both' && first.side !== p.direction) continue;

    // Le pivot : l'extrémité de la bougie partagée du côté vers lequel la
    // première impulsion est allée. C'est l'arête commune aux deux boîtes.
    const shared  = candles[i + 1];
    const readyIdx = i + 3;                 // la 5e bougie de la figure — motifAt garantit qu'elle existe
    const entryIdx = readyIdx + 1 < n ? readyIdx + 1 : null;

    // L'ÉCART DE LA POINTE À LA MOYENNE, et son seuil. La mesure est prise sur la
    // bougie partagée, au bout du trait extrême.
    const extreme = first.isBull ? shared.high : shared.low;
    const ecart = ecartMoyenne(ma, i + 1, extreme, first.isBull);
    if (seuilMin || seuilMax) {
      // Sans mesure — moyenne pas encore chaude — on ne conclut pas, et on
      // n'invente pas : la figure ne peut pas passer un seuil qu'on ne sait pas
      // évaluer. Même position que le filtre de RSI juste au-dessus.
      if (ecart.dist == null) continue;
      const d = Math.abs(ecart.dist);
      if (seuilMin && d < seuilMin) continue;
      if (seuilMax && d > seuilMax) continue;
    }

    pairs.push({
      side: first.side,                     // le sens du PREMIER motif
      first, second,
      similarity,                           // le recouvrement mesuré, 0–100
      // La bougie qui a passé (ou non) le filtre de RSI, et sa valeur. null
      // quand le filtre est éteint. C'est le seul moyen de relire pourquoi une
      // figure a été retenue plutôt que de refaire le calcul à la main.
      rsiIdx:   ext ? ext.idx : null,
      rsiValue: ext ? ext.rsi : null,

      startIdx:   i - 1,
      pivotIdx:   i + 1,
      pivotTime:  shared.time,
      pivotPrice: first.isBull ? shared.low : shared.high,
      // L'écart mesuré et le prix de la moyenne, portés par la figure elle-même :
      // les trois dessins les lisent, aucun ne les recalcule.
      maDist:   ecart.dist,
      maValue:  ecart.value,
      maPeriod: maOn ? Math.floor(p.maDistPeriod) : null,
      // L'EXTRÊME — l'autre bout de la MÊME bougie. La partagée est celle qui
      // fait la pointe : d'un côté le pivot, l'arête d'où pendent les deux gaps,
      // de l'autre la POINTE elle-même, le plus loin où le marché est allé avant
      // de se retourner. Haut pour une pointe haute, bas pour une pointe basse —
      // exactement l'opposé du pivot, sur la même bougie.
      extremePrice: first.isBull ? shared.high : shared.low,
      readyIdx,
      readyTime:  candles[readyIdx].time,
      entryIdx,
      entryTime:  entryIdx != null ? candles[entryIdx].time : null,
      entryPrice: entryIdx != null ? candles[entryIdx].open : null,
    });
  }

  return pairs;
}

// ── LA DISTANCE À LA MOYENNE ─────────────────────────────────────────────────
// De combien la POINTE s'est-elle écartée d'une moyenne mobile ? La mesure est
// prise au départ du trait extrême : même bougie (la partagée), même instant.
//
// SIGNÉE, et dans le sens de la POINTE — pas dans celui des prix. Une pointe
// haute qui dépasse la moyenne de 12 points et une pointe basse qui la creuse de
// 12 points rendent toutes deux +12 : c'est le même événement vu des deux côtés,
// et le lire avec des signes opposés obligerait à retourner le chiffre de tête à
// chaque figure. Négatif veut donc dire quelque chose de précis : la pointe n'a
// même pas atteint la moyenne.
//
// LA MOYENNE EST CELLE DES BOUGIES QU'ON DÉTECTE. En mode fractal, la détection
// tourne sur des bougies HTF : la MM 200 est donc une MM 200 du HTF, pas du
// graphe. C'est la seule lecture cohérente — mesurer une figure M15 contre une
// moyenne M1 comparerait deux échelles différentes.
// Rend { dist, value } — l'écart signé ET le prix de la moyenne, ce dernier
// servant à tracer le trait qui relie les deux points. Sans lui, le dessin
// devrait recalculer la moyenne de son côté.
function ecartMoyenne(ma, idx, extreme, pointeHaute) {
  if (!ma) return { dist: null, value: null };
  const m = ma[idx];
  if (m == null) return { dist: null, value: null };   // moyenne pas encore chaude
  return { dist: pointeHaute ? extreme - m : m - extreme, value: m };
}

// ── Étage 3 bis : l'affichage SIMPLIFIÉ ──────────────────────────────────────
// UN TRAIT PAR PAIRE, au lieu de deux boîtes.
//
// Les deux boîtes d'une paire partagent une arête (cf. l'en-tête) : pour une
// paire haussière→baissière, c'est leur borne SUPÉRIEURE à toutes les deux —
// le bas de la bougie partagée —, et elles pendent dessous ; pour une paire
// baissière→haussière, c'est leur borne INFÉRIEURE, et elles tiennent dessus.
// Dessiner les deux boîtes revient donc à dessiner deux fois le même niveau avec
// deux profondeurs. Cette vue-ci ne garde que le niveau.
//
// DEUX NIVEAUX POSSIBLES, sur la MÊME bougie partagée — celle de la pointe :
//   'trait'   — le PIVOT, l'arête d'où pendent les deux gaps. Bas de la bougie
//               pour une pointe haute, haut pour une pointe basse.
//   'extreme' — la POINTE elle-même, l'autre bout de cette bougie : le plus loin
//               où le marché est allé avant de se retourner. Haut de la bougie
//               pour une pointe haute, bas pour une pointe basse.
// Les deux traits encadrent donc la bougie partagée, un de chaque côté.
//
// Techniquement c'est une zone PLATE — top et bottom sur le même prix. La
// primitive de dessin sait qu'une bande sans hauteur est un trait épais ; rien
// de neuf à entretenir de ce côté.
//
// LE TRAIT PORTE LE SENS DU TRADE, pas celui de la paire : c'est le second motif
// qui décide où l'on va, donc une pointe basse (achat) donne un trait haussier.
// Le nom de la paire, lui, vient du PREMIER motif — les confondre ici ferait un
// trait rouge sur un signal d'achat.
//
// Il court de la bougie PARTAGÉE — le pivot n'existe pas avant elle, il est son
// extrémité — jusqu'au bord droit de la seconde boîte, pour que les deux vues se
// superposent exactement quand on passe de l'une à l'autre.
export function calcDollarPivots(candles, opts = {}) {
  const p = { ...DETECT_DEFAULTS, ...opts };
  const n = candles.length;

  // La mesure n'est AFFICHÉE que si le trait dessiné est bien celui de la
  // pointe : en mode pivot elle n'aurait rien à désigner. Elle reste calculée et
  // reste filtrante dans les deux cas — c'est le dessin qu'on tait, pas la règle.
  const surExtreme = p.zoneStyle === 'extreme';

  return detectDollarPairs(candles, p).map(pair => {
    const endIdx = pair.second.i + p.extLen;
    const niveau = surExtreme ? pair.extremePrice : pair.pivotPrice;
    return {
      side:  pair.second.side,        // le sens JOUÉ
      state: 'active',
      top:    niveau,
      bottom: niveau,                 // plat : c'est ce qui en fait un trait
      thickness: p.pivotWidth,
      startTime: pair.pivotTime,
      endTime:   endIdx < n ? candles[endIdx].time : null,
      idx:  pair.pivotIdx,
      pairSide:   pair.side,
      niveau,                         // le prix réellement tracé
      maDist:       surExtreme ? pair.maDist  : null,
      maValue:      surExtreme ? pair.maValue : null,
      maPeriod:     surExtreme ? pair.maPeriod : null,
      pivotPrice:   pair.pivotPrice,
      extremePrice: pair.extremePrice,
      similarity: pair.similarity,
      readyIdx:   pair.readyIdx,
      readyTime:  pair.readyTime,
      entryIdx:   pair.entryIdx,
      entryTime:  pair.entryTime,
      entryPrice: pair.entryPrice,
    };
  });
}

// ── Étage 3 ter : le NUAGE ───────────────────────────────────────────────────
// La bande entre les deux niveaux — du pivot à l'extrême —, c'est-à-dire
// exactement l'amplitude de la bougie PARTAGÉE. Une seule zone par paire.
//
// Ses deux bords n'ont pas le même statut, et c'est ce que le dessin doit
// montrer : l'EXTRÊME est la butée, le prix que le marché n'a pas dépassé ; le
// PIVOT n'est que l'arête d'où pendent les gaps. `hotEdge` dit lequel est
// lequel, et components/charts/CloudPrimitive.js s'en sert pour poser le mur du
// bon côté. Un rectangle uniforme aurait tu cette différence.
export function calcDollarClouds(candles, opts = {}) {
  const p = { ...DETECT_DEFAULTS, ...opts };
  const n = candles.length;

  return detectDollarPairs(candles, p).map(pair => {
    const endIdx = pair.second.i + p.extLen;
    const haut = Math.max(pair.pivotPrice, pair.extremePrice);
    const bas  = Math.min(pair.pivotPrice, pair.extremePrice);
    return {
      side:  pair.second.side,        // le sens JOUÉ, comme pour les traits
      state: 'active',
      top:    haut,
      bottom: bas,
      // Pointe haute → l'extrême est en HAUT (le sommet du pic) ; pointe basse →
      // en bas. C'est le seul champ que la primitive lit en plus de la boîte.
      hotEdge: pair.side === 'bull' ? 'top' : 'bottom',
      startTime: pair.pivotTime,
      endTime:   endIdx < n ? candles[endIdx].time : null,
      // LA BOUGIE QUI CONFIRME — celle à la clôture de laquelle la figure est
      // complète, donc le premier instant où l'on avait le droit de la voir. Sur
      // le graphe courant c'est la 5e bougie du motif ; en mode fractal, le
      // wrapper la remplace par la bougie du LTF qui ferme le bucket HTF.
      confirmTime: pair.readyTime,
      idx:  pair.pivotIdx,
      pairSide:     pair.side,
      maDist:       pair.maDist,
      maValue:      pair.maValue,
      maPeriod:     pair.maPeriod,
      pivotPrice:   pair.pivotPrice,
      extremePrice: pair.extremePrice,
      similarity:   pair.similarity,
      readyIdx:   pair.readyIdx,
      readyTime:  pair.readyTime,
      entryIdx:   pair.entryIdx,
      entryTime:  pair.entryTime,
      entryPrice: pair.entryPrice,
    };
  });
}

// ── Étage 3 : les zones ──────────────────────────────────────────────────────
// La figure mise à plat pour le dessin : une boîte par motif retenu, jamais
// deux. Dans une chaîne, le motif du milieu ferme une paire et ouvre la
// suivante ; il sort une seule fois, avec le rôle 'both' et le pivot de la
// première paire dans le temps.
// La boîte d'UN motif, avec tout ce que sa paire lui apporte. Écrite une fois et
// partagée par les deux vues à boîtes — sans quoi ajouter un champ à l'une le
// ferait manquer à l'autre, et la différence ne se verrait qu'à l'usage.
function boiteDe(candles, mo, pair, role, p, n) {
  const endIdx = mo.i + p.extLen;
  return {
    side:  mo.side,
    state: 'active',
    top:    mo.top,
    bottom: mo.bottom,
    gap:    mo.gap,
    startTime: candles[mo.i].time,
    endTime:   endIdx < n ? candles[endIdx].time : null,
    idx:  mo.i,
    role,
    pairSide:   pair.side,
    similarity: pair.similarity,
    pivotIdx:   pair.pivotIdx,
    pivotTime:  pair.pivotTime,
    pivotPrice: pair.pivotPrice,
    extremePrice: pair.extremePrice,
    readyIdx:   pair.readyIdx,
    readyTime:  pair.readyTime,
    confirmTime: pair.readyTime,
    entryIdx:   pair.entryIdx,
    entryTime:  pair.entryTime,
    entryPrice: pair.entryPrice,
  };
}

export function calcDollars(candles, opts = {}) {
  const p = { ...DETECT_DEFAULTS, ...opts };
  const n = candles.length;
  const zones = new Map();   // index de la centrale → zone

  for (const pair of detectDollarPairs(candles, p)) {
    for (const [role, mo] of [['first', pair.first], ['second', pair.second]]) {
      const already = zones.get(mo.i);
      if (already) { already.role = 'both'; continue; }
      zones.set(mo.i, boiteDe(candles, mo, pair, role, p, n));
    }
  }

  return [...zones.values()];
}

// ── Étage 3 quater : LA SECONDE BOÎTE, seule ─────────────────────────────────
// Une seule zone par paire : celle du SECOND motif. C'est la boîte qui compte
// pour jouer la figure — celle qui donne le sens du trade et qui porte le bord
// d'entrée. La première ne sert qu'à faire la pointe ; la dessiner en plus ne
// fait qu'ajouter une profondeur sous un niveau déjà tracé (cf. la géométrie en
// en-tête, les deux boîtes partagent le pivot).
//
// Concrètement : une paire haussière→baissière ne montre que sa boîte BAISSIÈRE,
// une paire baissière→haussière que sa boîte HAUSSIÈRE.
//
// PAS DE DÉDOUBLONNAGE À FAIRE, contrairement à `calcDollars` : un motif ne peut
// être le SECOND que d'une seule paire — celle qui commence deux barres avant
// lui. Dans une chaîne, le motif du milieu apparaît donc une fois, et pas deux.
export function calcDollarSecond(candles, opts = {}) {
  const p = { ...DETECT_DEFAULTS, ...opts };
  const n = candles.length;
  return detectDollarPairs(candles, p)
    .map(pair => boiteDe(candles, pair.second, pair, 'second', p, n));
}
