// Simulateur de positions des motifs à STOP STRUCTUREL CONNU D'AVANCE.
//
// POURQUOI CE N'EST PAS lib/signals/engine.js. Le moteur partagé du rFVG et du KO
// fixe trois choses que cette famille fait autrement, et pas par accident :
//   • son stop est bâti sur les DEUX dernières bougies (celle d'entrée et la
//     précédente) — ici, il l'est sur TOUTES les bougies du motif ;
//   • son TP est une distance en points ou en ATR — ici, c'est un RR ;
//   • son stop n'existe qu'à la CLÔTURE de la bougie d'entrée, parce qu'il se
//     calcule à partir de cette bougie-là — ici, le stop est entièrement connu
//     AVANT d'entrer, donc posé avec l'ordre et actif immédiatement.
// Le dernier point est une différence de fond, pas de réglage.
//
// CE FICHIER NE SAIT PAS QUEL MOTIF IL JOUE. Il reçoit des signaux déjà détectés
// et les mène jusqu'à leur sortie — c'est ce qui permet à deux motifs de partager
// exactement la même gestion, et donc de comparer leurs résultats sans se
// demander si l'écart vient de la sortie ou de la détection.
//
// CONTRAT D'UN SIGNAL :
//   { side: 'bull'|'bear', fromIdx, toIdx, level?, top?, bottom?, breathCount?,
//     healthLevel? }
//   • healthLevel   — le prix au-delà duquel une CLÔTURE dit que le motif n'a
//     pas tenu. Sert au seul TP dynamique « position saine » ; absent, la règle
//     ne peut pas s'appliquer et rien d'autre ne change.
//   • fromIdx…toIdx — les bougies DU MOTIF. Le stop structurel s'y appuie, et la
//     bougie d'entrée est toIdx+1. Ni l'une ni l'autre n'en fait partie.
//   • top/bottom    — la bande, nécessaire au seul mode d'entrée 'zone'.
//   Les signaux doivent arriver dans l'ordre des motifs. Le simulateur les
//   REJOUE ensuite dans l'ordre des OUVERTURES, qui n'est pas le même dès qu'un
//   ordre en attente patiente : `uniqueTrade`, le repos après gain, le dû et la
//   numérotation des lots sont des états SÉQUENTIELS, et les nourrir dans le
//   désordre bloquerait une position au nom d'une autre ouverte plus tard.
//
// LES RÈGLES :
//   ENTRÉE — trois façons (`entryMode`), et ce n'est pas un détail : elles ne
//     prennent pas les mêmes trades.
//       'zone'   — ORDRE EN ATTENTE au bord de la bande tracée. Le motif désigne
//         un prix ; on n'achète pas dans le vide, on attend que le marché y
//         revienne. Le remplissage se fait au bord de la bande que le prix
//         atteint en premier — jamais au milieu, jamais au niveau exact. Si le
//         prix ne revient pas dans `entryWaitBars` bougies, l'ordre est annulé :
//         le signal existe mais aucune position n'a été prise, statut 'missed'.
//         C'est la seule façon d'être honnête sur ce mode : compter ces
//         signaux-là comme s'ils n'avaient jamais existé donnerait un taux de
//         réussite calculé sur les seuls trades que le marché a bien voulu
//         servir.
//       'limit'  — ORDRE À COURS LIMITÉ sur `level`, DIRECTIONNEL : le sens du
//         signal décide seul du côté d'où l'on attend le prix (achat servi quand
//         il descend au niveau, vente quand il monte). Il ne demande pas au prix
//         d'être sorti d'abord — le niveau peut être DÉJÀ dépassé, l'ordre part
//         alors au marché à la première ouverture, comme le ferait une vraie
//         limite posée du mauvais côté du marché. `entryWaitBars` l'annule de la
//         même façon (statut 'missed'). C'est la différence de fond avec 'zone' :
//         là-bas le côté d'approche vient du PRIX, ici il vient du SIGNAL.
//       'market' — au MARCHÉ, à l'ouverture de la bougie qui SUIT la seconde
//         impulsion. Le motif n'est connu qu'à la clôture de celle-ci ; c'est le
//         premier prix disponible ensuite, et une position est toujours prise.
//     Achat sur pince haussière, vente sur baissière, dans les deux cas.
//   STOP  — deux origines au choix (`slMode`), et c'est ce qui décide si le
//     risque varie ou non d'une position à l'autre :
//       'structure' — sous le PLUS BAS de toutes les bougies du motif, de la
//         première impulsion à la seconde incluses (au-dessus du plus haut en
//         vente), moins `slMarginPts`. Ni la bougie d'entrée ni rien d'autre n'y
//         entre. Le risque suit la taille du motif.
//       'points'    — à `slPts` points de l'entrée, tout simplement. Le risque
//         devient CONSTANT : compter en points ou en R revient alors au même, et
//         le seuil de rentabilité redevient le 1/(1+RR) des manuels.
//   TP    — deux façons (`tpMode`), et le choix décide si le TP est ATTACHÉ au
//     stop ou non :
//       'rr'     — `rr` fois le risque : TP = entrée ± rr × |entrée − stop|. Le
//         RR est constant, le TP en points suit la taille du stop. C'est le
//         défaut, et le seul mode que la famille ait connu jusqu'ici.
//       'points' — `tpPts` points de l'entrée, un point c'est tout. Le TP est
//         alors INDÉPENDANT du stop, comme celui du rFVG : avec un stop en
//         points, les deux bouts sont fixes et le RR réalisé devient une
//         conséquence, plus un réglage. Avec un stop structurel, c'est
//         l'inverse — le TP est fixe et c'est le RR qui varie d'une position à
//         l'autre.
//     Le break-even, lui, reste en R dans les deux cas : il se règle sur le
//     risque, qui existe toujours.
//   TP DYNAMIQUE — la cible peut être REPOUSSÉE UNE FOIS, et le choix se fait à
//     l'instant précis où le TP de base est touché : soit la position sort, soit
//     sa cible passe à `mult` × la distance de BASE (jamais × la cible courante)
//     et elle continue. Deux raisons, cumulables mais non composables, toutes
//     deux éteintes par défaut :
//       `tpFastBars` / `tpFastMult` — la cible a été atteinte VITE, en au plus
//         `tpFastBars` bougies depuis l'entrée. Une position qui va droit au but
//         est présumée avoir de la marge.
//       `tpSaneMult` (+ `tpSaneMa`, une série alignée sur les bougies, et
//         `healthLevel` porté par le signal) — la position est SAINE : elle est
//         entrée du bon côté de la moyenne (sous elle à l'achat, au-dessus à la
//         vente, lu à la bougie d'entrée) et AUCUNE bougie n'a CLÔTURÉ au-delà
//         de `healthLevel` depuis. Une mèche qui traverse ne compte pas — ce
//         qu'on veut voir est un rejet, pas une visite.
//     Si les deux valent, c'est le PLUS GRAND multiplicateur qui s'applique, pas
//     leur produit : les deux disent « cette position se comporte bien » et se
//     recouvrent, les composer compterait deux fois la même preuve.
//     TROIS GARDE-FOUS. Une seule extension par position, sinon la cible d'une
//     position rapide fuirait indéfiniment. La nouvelle cible ne peut pas être
//     touchée sur la bougie qui vient de l'armer (même prudence que le BE : à la
//     granularité de la bougie, l'ordre des événements est inconnu). Et un DÛ en
//     cours l'interdit — une position partie rembourser vise une dette, pas un
//     profit.
//     CE QUE ÇA COÛTE, à savoir avant de s'en servir : LE STOP NE BOUGE PAS. Une
//     position qui avait atteint son TP repart avec le même risque qu'au départ ;
//     si elle se retourne, le gain acquis devient une perte pleine. Le rapport
//     compte les positions étendues et celles qui ont fini au stop après l'avoir
//     été — c'est ce couple de chiffres, et lui seul, qui dit si la règle paie.
//   BE DU MALSAIN (`beUnhealthyPts`, 0 = éteint ; distance par signal possible)
//     — une sortie de SECOURS, armée le jour où la position CESSE D'ÊTRE SAINE
//     (une bougie clôture au-delà de `healthLevel`). On ne vise plus l'objectif :
//     on attend que le prix revienne à `beUnhealthyPts` points AU-DESSUS de
//     l'entrée en achat, en dessous en vente, et on solde là — un petit gain,
//     pas un vrai break-even. Le stop reste actif pendant l'attente : c'est une
//     course, et rien ne garantit que le prix revienne.
//     Actif à partir de la bougie SUIVANT celle qui a rompu la santé, jamais sur
//     elle : sa clôture n'est connue qu'à sa fin.
//     Il passe AVANT le TP dans la bougie, et ce n'est pas un arbitrage : le prix
//     revient du mauvais côté, il croise donc forcément ce niveau — plus proche
//     de l'entrée — avant l'objectif. CONSÉQUENCE : une position devenue malsaine
//     ne peut plus atteindre son TP, sa meilleure issue devient ce petit gain.
//     Sortie → statut 'be', avec beReason = 'unhealthy'.
//   BE EXISTENTIEL (`beExistBars`, 0 = éteint) — armé par le TEMPS et non par
//     une avarie : passé `beExistBars` bougies, la position a assez duré pour
//     qu'on cesse de lui faire crédit. Il vise le MÊME niveau que le BE du
//     malsain (même distance, `beUnhealthyPts` — sans elle il n'a pas de niveau
//     et reste éteint), mais il agit des DEUX CÔTÉS :
//       • la position est DÉJÀ au-delà du niveau → PROTECTION : on ne la laisse
//         plus redescendre dessous. Testé AVANT le stop, et ce n'est pas un
//         arbitrage : venant d'au-dessus, le prix croise forcément ce niveau
//         avant le stop, plus bas. Le TP reste jouable tant qu'elle y reste.
//       • elle est EN DEÇÀ → CIBLE : on coupe dès qu'elle y arrive.
//     Le côté est jugé sur la clôture de la bougie PRÉCÉDENTE, jamais sur celle
//     en cours — la juger sur la bougie ouverte reviendrait à lire son avenir.
//     Sortie → statut 'be', avec beReason = 'existential'.
//     LES DEUX BE PARTAGENT LE NIVEAU et ne diffèrent que par ce qui les arme et
//     par le côté d'où ils agissent. Ils se cumulent sans se gêner : le premier
//     armé qui voit le prix toucher le niveau sort la position.
//   BE    — un déplacement UNIQUE du stop, tout en R. Dès qu'une bougie avance de
//     `beTriggerR` × risque dans le sens de la position, le stop passe à
//     entrée ± `beLevelR` × risque et n'y bouge plus : ce n'est pas un stop
//     suiveur. Blocage à 0 = le vrai break-even, positif = du gain sécurisé,
//     négatif = une perte réduite. Deux garde-fous, les mêmes que le moteur
//     partagé : le stop déplacé ne peut jamais ÉLARGIR le risque (un blocage
//     au-delà du stop d'origine est ignoré), et il ne prend effet qu'à la
//     CLÔTURE de la bougie qui l'a armé — sans quoi on le ferait toucher par la
//     mèche même qui vient de le déclencher. Sortie sur ce stop → statut 'be'.
//   SORTIE— stop ou TP, le premier atteint. Les deux dans la même bougie : le
//     stop gagne (pessimiste, et compté dans `ambiguous`). Données épuisées :
//     la position reste 'open' et sort à la dernière clôture, hors statistiques.
//
// TOUS LES SIGNAUX SONT PRIS par défaut : les positions se chevauchent si les
// motifs se chevauchent, et la courbe de gains du rapport additionne donc des
// positions simultanées — à savoir avant de lire un drawdown.
//
// `skipAfterTp` ajoute un REPOS : après un TP, les N signaux suivants sont
// ignorés, puis on reprend. Exactement N — un signal sauté qui aurait gagné ne
// relance pas le compteur (le rFVG, lui, le relance). Les sautés ne sont listés
// nulle part, mais `skippedByCooldown` les compte et `skippedWon` dit combien
// auraient gagné : sans ce second chiffre, on ne saurait pas ce que le repos a
// coûté. Anti-anticipation : un signal n'est écarté que s'il entre APRÈS la
// sortie du gain qui a armé le repos.
//
// `uniqueTrade` change ça : une seule position à la fois, tout motif qui survient
// pendant qu'une position TIENT LA PORTE est IGNORÉ, dans son sens comme à
// contre-sens, et n'apparaît nulle part.
//
// JUSQU'À QUAND la porte est fermée dépend de `uniqueMode` :
//   'exit' (défaut) — jusqu'à la CLÔTURE de la position, quoi qu'elle fasse
//     entre-temps. C'est le mode historique, et celui de toute la famille.
//   'healthy' — jusqu'à sa clôture OU jusqu'à ce qu'elle cesse d'être SAINE, le
//     PREMIER DES DEUX. Une position est saine tant qu'aucune bougie n'a
//     CLÔTURÉ au-delà de son `healthLevel` — le même critère que le TP dynamique
//     « position saine », mais SANS sa condition de moyenne mobile : ici la
//     santé ne dépend que du motif, jamais d'où la position a été prise.
//     Autrement dit : une position qui a cessé de tenir son niveau ne mérite
//     plus qu'on lui réserve la place, et le motif suivant peut être joué même
//     si elle court toujours. Une position sans `healthLevel` n'est jamais saine
//     et ne bloque donc rien : le mode s'éteint de lui-même au lieu de retomber
//     en silence sur 'exit'.
//     Conséquence à connaître : le nombre de positions simultanées n'est PLUS
//     borné à une. Deux positions peuvent se chevaucher dès lors que la première
//     est devenue malsaine — ce qui est voulu, mais fait que « trade unique » ne
//     veut plus dire « un seul trade à la fois ». `healthyBars` dit, position par
//     position, combien de temps la porte est restée fermée.
//
// Deux choses à savoir dans les deux modes :
//   • ce n'est pas un filtre neutre — il retire des signaux selon ce que le
//     marché a fait ENTRE-TEMPS. Une position qui traîne masque les suivants ; si
//     ceux-là étaient les mauvais, la stratégie a l'air meilleure sans avoir
//     changé. C'est un faux edge classique, déjà rencontré sur eq-balance ;
//   • il rend le résultat SÉQUENTIEL : les signaux doivent être joués dans
//     l'ordre, ce que garantit toute détection rendant ses signaux dans l'ordre
//     des bougies.
//
// LE DÛ (`dueAfterSl`, 0 = éteint) — REMBOURSER AVANT DE GAGNER. Toute position
// clôturée dans le rouge laisse sa perte NETTE sur une ardoise ; tout gain la
// rembourse en commençant par la plus ancienne. Dès que l'ardoise compte
// `dueAfterSl` pertes, la position suivante vise le remboursement au lieu de son
// vrai TP — même s'il tombe plus PRÈS que son objectif normal. La règle complète
// (modes 'full' / 'step', perte jugée au net, anti-anticipation) vit dans
// lib/dueLedger.js, avec la file elle-même : elle est partagée mot pour mot avec
// le rFVG et le KO, et la redocumenter ici la ferait diverger.
//
//   CE QUI EST PROPRE À CETTE FAMILLE : le dû remplace la DISTANCE de
//   l'objectif, calculée juste avant, quel que soit le mode de TP ('rr' ou
//   'points'). Le BREAK-EVEN, lui, ne bouge pas d'un pouce : il est en R, donc
//   réglé sur le risque et non sur l'objectif. Une position partie rembourser
//   protège donc exactement comme les autres — c'est voulu, le dû déplace la
//   cible, pas la protection.
//
// LA TAILLE DE POSITION (`lotMode`) — elle ne touche à RIEN de la simulation.
// L'entrée, le stop, la cible et les excursions sont des PRIX : ils ne bougent
// pas d'un lot à l'autre. Le lot ne multiplie que le RÉSULTAT, à la toute fin —
// brut, spread et net ensemble, pour que net = brut − spread reste vrai (deux
// lots paient deux spreads).
//   'fixe' (défaut)  — 1 lot, toujours.
//   'exponentiel'    — ×`lotFactor` tous les `lotStepTrades` trades PRIS : les N
//     premiers à 1 lot, les N suivants à F, les N d'après à F².
//   'pas'            — +`lotPlus` tous les `lotStepTrades` trades : 1, 2, 3, 4…
//     Le pendant LINÉAIRE de l'exponentiel, et il ne se comporte pas du tout
//     pareil : le poids du dernier bloc y croît comme n, pas comme 2^n. Le total
//     reste donc une moyenne à peu près honnête au lieu d'être dicté par les
//     derniers trades — c'est le seul des deux dont un backtest garde du sens.
//   Dans les deux cas le compte se fait sur les positions RETENUES, dans l'ordre
//     d'ENTRÉE ; un ordre jamais servi n'est pas un trade et ne fait pas monter
//     la marche. `lotMax` plafonne (0 = aucun) ; en exponentiel ce n'est pas de
//     la prudence mais une nécessité : F^k déborde, et un lot Infinity rendrait
//     tous les résultats NaN en silence.
//
//   CE QU'UN ESCALIER FAIT, ET CE QU'IL NE FAIT PAS. Il multiplie l'espérance de
//   CHAQUE trade — tous les lots étant positifs, le signe de chacun est
//   inchangé —, il n'en crée aucune. Mais il faut être précis sur ce qui suit,
//   parce que c'est là que tout le monde se trompe :
//
//     LE TOTAL RÉALISÉ, LUI, PEUT CHANGER DE SIGNE. Ce n'est plus une moyenne,
//     c'est une somme PONDÉRÉE dont les poids doublent avec le temps : les
//     derniers trades pèsent autant que tous les précédents réunis. Le résultat
//     est donc dicté par le dernier bloc, c'est-à-dire par une poignée de
//     trades. Mesuré sur les bougies de test : une configuration qui rend
//     +20 points à lot fixe en rend −240 en escalier. Rien n'a changé dans la
//     stratégie — ni une entrée, ni une sortie ; seul l'ordre du temps a été
//     mis à prix.
//
//   Autrement dit un backtest en escalier ne mesure plus la stratégie, il mesure
//   la chance des derniers trades. À brancher APRÈS avoir montré que la
//   stratégie gagne à lot fixe, et à lire à côté de ce résultat-là, jamais à sa
//   place.
//   LE DÛ, lui, ignore le lot : il vise une DISTANCE de prix, pas un résultat.
//
// PAS DE STOP SUIVEUR ni de sortie en temps. Le rapport porte les excursions
// (MFE / MAE) de chaque position : ce sont elles qui permettent de régler le BE
// sur pièces plutôt qu'au jugé.

import { createDueLedger } from './dueLedger';

export function simulatePatternPositions(candles, signals, p, label = 'signal') {
  const n = candles?.length ?? 0;
  const trades = [];
  let ambiguous = 0;
  // Le TP se règle en RR ou en points. `tpMode` absent = 'rr' : les motifs
  // écrits avant ce réglage ne changent pas de comportement, et un rapport
  // enregistré se relit à l'identique.
  const tpInPts = p.tpMode === 'points';
  // Sans objectif il n'y a pas de position à simuler — le réglage qui le porte
  // dépend du mode, la condition aussi. Un motif peut aussi donner sa propre
  // distance signal par signal (`z.tpPts`, cf. plus bas) : le réglage global a
  // alors le droit d'être nul, et c'est chaque signal qui décide.
  const anySignalTp = signals?.some(s => s.tpPts > 0);
  if (!(anySignalTp || (tpInPts ? p.tpPts > 0 : p.rr > 0)) || n < 3 || !signals?.length) {
    trades.ambiguous = 0; trades.skippedByUnique = 0; trades.skippedByStop = 0;
    trades.skippedByCooldown = 0; trades.skippedWon = 0;
    trades.dueArmed = 0; trades.dueRemainingPts = 0; trades.dueRemainingSl = 0;
    return trades;
  }

  // ── LA TAILLE DE POSITION ──────────────────────────────────────────────────
  // Le lot ne change RIEN à la simulation : ni l'entrée, ni le stop, ni la cible,
  // qui sont des PRIX. Il ne multiplie que le RÉSULTAT — un gain de 10 points à
  // 2 lots en vaut 20. C'est pour ça qu'il s'applique tout à la fin, sur le brut,
  // le spread et le net à la fois : l'égalité net = brut − spread doit tenir.
  //   'fixe'        — 1 lot, toujours. Le comportement de toujours.
  //   'exponentiel' — ×`lotFactor` tous les `lotStepTrades` trades PRIS. Les N
  //     premiers à 1 lot, les N suivants à F, les N d'après à F²…
  //   'pas'         — +`lotPlus` tous les `lotStepTrades` trades. 1, 2, 3, 4…
  //     Le pendant LINÉAIRE du précédent : même compteur de marches, seule la
  //     façon de monter change.
  // Le compte se fait sur les positions RETENUES, dans l'ordre d'ENTRÉE : un
  // ordre jamais servi n'est pas un trade et ne fait pas monter la marche.
  const lotMode = (p.lotMode === 'exponentiel' || p.lotMode === 'pas') ? p.lotMode : 'fixe';
  const lotStep = p.lotStepTrades > 0 ? Math.floor(p.lotStepTrades) : 0;
  const lotFact = p.lotFactor > 0 ? p.lotFactor : 1;
  const lotPlus = p.lotPlus > 0 ? p.lotPlus : 0;
  // Plafond, 0 = aucun. Il n'est pas là par prudence mais par nécessité
  // arithmétique : F^k déborde. À facteur 2 et marche de 10, le 341e trade
  // demande 2^34 lots, et quelques centaines de trades plus loin le nombre
  // devient Infinity — tous les résultats passeraient alors à NaN sans qu'une
  // seule ligne ne le signale.
  const lotMax  = p.lotMax > 0 ? p.lotMax : Infinity;
  const lotOf = no => {
    if (lotMode === 'fixe' || lotStep <= 0) return 1;
    // Combien de marches ont été franchies. Le compte est le même dans les deux
    // modes ; seule la façon de monter d'une marche change.
    const marches = Math.floor((no - 1) / lotStep);
    return Math.min(lotMax, lotMode === 'exponentiel'
      ? lotFact ** marches           // ×F par marche : 1, 2, 4, 8…
      : 1 + lotPlus * marches);      // +P par marche : 1, 2, 3, 4…
  };
  let tradeNo = 0;   // positions RETENUES, dans l'ordre d'entrée

  let id = 1;
  // États SÉQUENTIELS. Ils imposent que les signaux soient joués dans l'ordre des
  // bougies — c'est au détecteur de le garantir.
  // Jusqu'à quelle bougie la dernière position RETENUE empêche les suivantes.
  // Ce n'est pas forcément sa sortie : cf. `uniqueMode` dans l'en-tête.
  let lastBlockIdx = -1;
  let skippedByUnique = 0;
  let cooldown = 0;            // signaux restant à sauter après un gain
  let armExit  = -1;           // bougie de sortie du gain qui a armé ce repos
  let skippedByCooldown = 0, skippedWon = 0;
  // Signaux dont le stop n'était pas POSABLE : distance absente ou nulle, ou stop
  // du mauvais côté de l'entrée. Sans stop il n'y a ni risque, ni R, ni TP — ce ne
  // sont pas des positions, mais les taire ferait disparaître des signaux sans
  // la moindre explication.
  let skippedByStop = 0;

  // ── LE DÛ ────────────────────────────────────────────────────────────────
  // La file des pertes non remboursées et son arithmétique vivent dans
  // lib/dueLedger.js — partagées avec le rFVG et le KO, pour que « seuil 8 »
  // veuille dire la même chose d'un motif à l'autre.
  const due = createDueLedger({ threshold: p.dueAfterSl, mode: p.dueMode });
  let dueArmedCount = 0;

  // ── PASSE 1 — OÙ ET QUAND CHAQUE ORDRE EST SERVI ───────────────────────────
  // Rien de séquentiel ici : le remplissage ne dépend que du signal et des
  // bougies, jamais des autres positions. C'est ce qui permet de le résoudre
  // AVANT de trancher qui a le droit d'ouvrir — cf. le tri juste après.
  const remplissages = [];
  for (const z of signals) {
    // La bougie d'entrée suit la seconde impulsion. Elle peut ne pas exister
    // encore : le motif est complet, la position n'est simplement pas prise.
    const eIdx = z.toIdx + 1;
    if (eIdx >= n) continue;

    const isBuy = z.side === 'bull';

    // — Où et quand on est rempli.
    let entryIdx = eIdx, entry = candles[eIdx].open, missed = false;

    if (p.entryMode === 'zone') {
      // REVENIR suppose d'être SORTI. Le prix doit donc d'abord se trouver hors
      // de la bande — c'est ce qui distingue ce mode d'un ordre au marché.
      //   • à la clôture de la 2e impulsion il est déjà dehors (le cas courant) :
      //     l'ordre est armé tout de suite, et le côté où il se trouve décide du
      //     bord où l'on sera servi ;
      //   • il est DANS la bande : il n'y a rien à attendre au sens propre. On
      //     patiente qu'il en sorte, et c'est le côté par lequel il sort qui
      //     fixera le bord. Sans cette règle, un signal sur sept entrait au
      //     marché en croyant attendre un retour.
      let armed = false, fromAbove = false;
      const ref = candles[z.toIdx].close;
      if (ref > z.top)         { armed = true; fromAbove = true;  }
      else if (ref < z.bottom) { armed = true; fromAbove = false; }

      const last = p.entryWaitBars > 0
        ? Math.min(n - 1, eIdx + p.entryWaitBars - 1)
        : n - 1;

      entryIdx = null;
      for (let j = eIdx; j <= last; j++) {
        const k = candles[j];

        if (!armed) {
          // La sortie se juge à la CLÔTURE : une mèche qui dépasse puis rentre
          // n'a rien quitté. Et la bougie qui arme ne remplit jamais — on ne sait
          // pas, à la granularité de la bougie, si le retour a suivi la sortie ou
          // l'a précédée.
          if (k.close > z.top)         { armed = true; fromAbove = true;  }
          else if (k.close < z.bottom) { armed = true; fromAbove = false; }
          continue;
        }

        // Le prix touche-t-il la bande ? On teste l'amplitude entière : une mèche
        // qui la traverse suffit, c'est bien le prix qui y est passé.
        const limit  = fromAbove ? z.top : z.bottom;
        const touche = fromAbove ? k.low <= limit : k.high >= limit;
        if (!touche) continue;
        // Rempli au bord — sauf si la bougie a OUVERT au-delà, auquel cas un
        // ordre en attente aurait été servi à l'ouverture, donc mieux.
        entry = fromAbove ? Math.min(limit, k.open) : Math.max(limit, k.open);
        entryIdx = j;
        break;
      }

      if (entryIdx == null) {
        // Jamais servi. Le signal est listé pour ne pas disparaître des comptes,
        // sans prix ni résultat : statut 'missed', que lib/signals/stats.js et
        // /rapports savent déjà tenir à l'écart des statistiques.
        missed = true;
        entryIdx = eIdx;
      }
    }

    // ORDRE À COURS LIMITÉ, DIRECTIONNEL. Le SENS décide seul du côté d'où l'on
    // attend le prix : un achat est servi quand il DESCEND au niveau, une vente
    // quand il MONTE. C'est ce qui le sépare du mode 'zone', qui déduit ce côté
    // de la position du prix et exige donc qu'il soit d'abord SORTI pour y
    // « revenir ».
    //
    // Conséquence voulue : le niveau a le droit d'être DÉJÀ dépassé quand
    // l'ordre est posé. Il est alors rempli sur-le-champ, à l'ouverture de la
    // première bougie — exactement ce qu'un ordre réel aurait fait : une limite
    // d'achat posée sous un marché qui est déjà plus bas part au marché. Et
    // c'est la MÊME formule qui le dit (`min(niveau, ouverture)`), sans branche
    // séparée : si la bougie ouvre au-delà du niveau, on est servi à son
    // ouverture, ici comme partout ailleurs.
    if (p.entryMode === 'limit') {
      const lvl = z.level;
      const last = p.entryWaitBars > 0
        ? Math.min(n - 1, eIdx + p.entryWaitBars - 1)
        : n - 1;

      entryIdx = null;
      // Sans niveau il n'y a pas d'ordre à poser. Le signal n'est pas jeté pour
      // autant : il reste 'missed', comme un ordre jamais servi — le taire
      // ferait disparaître un motif détecté sans la moindre explication.
      if (Number.isFinite(lvl)) {
        for (let j = eIdx; j <= last; j++) {
          const k = candles[j];
          if (isBuy ? k.low > lvl : k.high < lvl) continue;
          entry    = isBuy ? Math.min(lvl, k.open) : Math.max(lvl, k.open);
          entryIdx = j;
          break;
        }
      }

      if (entryIdx == null) { missed = true; entryIdx = eIdx; }
    }

    remplissages.push({ z, eIdx, isBuy, entryIdx, entry, missed });
  }

  // ── L'ORDRE DU TEMPS, et pourquoi il ne va pas de soi ──────────────────────
  // Les signaux arrivent dans l'ordre où les MOTIFS se terminent. Les ordres,
  // eux, sont servis dans l'ordre où le PRIX revient les chercher — et ce n'est
  // pas le même. Un ordre en attente peut patienter des centaines de bougies
  // pendant que le suivant est rempli tout de suite ; mesuré sur un motif à
  // niveau lointain, un remplissage sur cinq arrivait ainsi AVANT celui du
  // signal précédent, avec des reculs de plus de 300 bougies.
  //
  // Or `uniqueTrade`, le repos après gain et le dû sont des états SÉQUENTIELS
  // comparés à la bougie de remplissage, et le lot numérote les trades. Les
  // jouer dans l'ordre de détection revenait donc à écarter une position parce
  // qu'une AUTRE, ouverte plus tard, occupait déjà la place — un blocage par une
  // position qui n'existait pas encore. C'est le genre de faute qui ne se voit
  // pas dans un total : elle enlève des trades, elle n'en invente pas.
  //
  // On rejoue donc la suite dans l'ordre des OUVERTURES. À égalité, le motif
  // détecté le premier passe devant : deux ordres remplis sur la même bougie
  // doivent être départagés par quelque chose de stable.
  remplissages.sort((a, b) => (a.entryIdx - b.entryIdx) || (a.z.toIdx - b.z.toIdx));

  // ── PASSE 2 — la vie de chaque position, dans l'ordre des ouvertures ───────
  for (const { z, eIdx, isBuy, entryIdx, entry, missed } of remplissages) {
    // Trade unique : jugé sur la bougie de REMPLISSAGE, pas sur celle du signal —
    // un ordre en attente n'est pas une position et ne bloque donc rien. Placé
    // après le calcul du remplissage, et après le cas 'missed' qui n'ouvre rien.
    if (!missed && p.uniqueTrade && entryIdx <= lastBlockIdx) { skippedByUnique++; continue; }

    if (missed) {
      trades.push({
        id:           id++,
        direction:    isBuy ? 'BUY' : 'SELL',
        label,
        entryTime:    candles[eIdx].time,
        entryPrice:   null,
        // L'ordre n'a jamais été servi : aucune attente n'a abouti. Le champ
        // existe quand même — toutes les positions doivent avoir la MÊME forme,
        // sans quoi un lecteur (rapport, page, étude) doit deviner laquelle il a.
        waitedBars:   null,
        exitTime:     null,
        exitPrice:    null,
        sl: null, sl0: null, tp: null,
        level:        z.level,
        risk0:        0,
        profitPoints: 0,
        spreadPts:    0,
        netPoints:    0,
        // Aucun trade n'a été pris : pas de lot, et surtout pas de numéro — un
        // ordre jamais servi ne doit pas faire monter la marche de l'escalier.
        lot:          null,
        tradeNo:      null,
        profitPoints1: 0,
        netPoints1:    0,
        exitReason:   'missed',
        status:       'missed',
        barsHeld:     null,
        entryTouches: null,
        maxPullupPts: null,
        maxDrawdownPts: null,
        maeArmedPts:  null,
        beActivated:  false,
        beReason:     null,
        beTime:       null,
        fromIdx:      z.fromIdx,
        toIdx:        z.toIdx,
        breathCount:  z.breathCount,
      });
      continue;
    }

    // Le stop. Deux origines possibles, et le choix n'est pas cosmétique : il
    // décide si le risque VARIE d'une position à l'autre ou non.
    //   'structure' — sous/sur l'extrême de TOUTES les bougies du motif, première
    //     et seconde impulsions comprises. Le risque suit la taille du motif ;
    //     c'est ce qui oblige à compter les gains en points plutôt qu'en R.
    //   'points'    — une distance fixe depuis l'entrée. Le risque devient
    //     constant, et points et R ne disent plus que la même chose.
    // Dans les deux cas le stop est connu AVANT d'entrer, donc posé avec l'ordre
    // et actif dès la bougie d'entrée — contrairement au rFVG.
    let sl;
    if (p.slMode === 'points') {
      // DISTANCE PAR SIGNAL. Un motif peut fournir la sienne (`z.slPts`) plutôt
      // que de s'en remettre au réglage global : c'est ce que fait un stop réglé
      // en ATR, dont la distance change à chaque signal. Le simulateur n'a pas à
      // savoir d'où vient ce nombre — il le prend en points, comme l'autre.
      const slPts = z.slPts ?? p.slPts;
      if (!(slPts > 0)) { skippedByStop++; continue; }
      sl = isBuy ? entry - slPts : entry + slPts;
    } else {
      let anchor = isBuy ? Infinity : -Infinity;
      for (let j = z.fromIdx; j <= z.toIdx; j++) {
        anchor = isBuy ? Math.min(anchor, candles[j].low)
                       : Math.max(anchor, candles[j].high);
      }
      sl = isBuy ? anchor - p.slMarginPts : anchor + p.slMarginPts;
    }

    // LE STOP DOIT ÊTRE DU BON CÔTÉ de l'entrée : sous elle à l'achat, au-dessus
    // à la vente. Le risque était calculé en valeur ABSOLUE, ce qui laissait
    // passer un stop du mauvais côté — la position se faisait alors stopper dès
    // sa première bougie, à un prix qui ne veut rien dire. Le cas est impossible
    // avec un stop en points, rarissime avec un stop structurel (il faut un gap
    // par-dessus l'extrême du motif), mais COURANT avec un stop de niveau : rien
    // n'empêche le prix de repasser de l'autre côté du niveau avant qu'on entre.
    // Ces signaux ne sont pas des positions ; ils sont comptés à part.
    const risk0 = isBuy ? entry - sl : sl - entry;
    if (!(risk0 > 0)) { skippedByStop++; continue; }
    // LE DÛ, s'il est armé, PREND LA PLACE de l'objectif — même s'il tombe plus
    // près que le vrai TP : rembourser passe avant. Il se lit à l'ENTRÉE et n'y
    // bouge plus, comme un ordre qu'on pose une fois. Les pertes qui s'ajoutent
    // pendant la vie de la position ne le déplacent donc pas ; elles seront dans
    // le dû de la SUIVANTE.
    due.settle(entryIdx);
    const { duePts, dueTotalPts, dueCount } = due.target();

    // La DISTANCE de l'objectif : le dû, sinon celle que le SIGNAL porte
    // (`z.tpPts` — un TP réglé en ATR, qui change à chaque signal), sinon le
    // réglage global, proportionnel au risque ou fixe. Une fois calculée, la
    // suite ne sait plus d'où elle vient — le plafond de la MFE la relit telle
    // quelle.
    const tpPtsOwn = z.tpPts ?? (tpInPts ? p.tpPts : p.rr * risk0);
    if (!(tpPtsOwn > 0)) continue;
    const tpPtsEff = duePts > 0 ? duePts : tpPtsOwn;
    // La cible n'est plus forcément figée : elle peut être REPOUSSÉE UNE FOIS,
    // au moment précis où le TP de base est touché (cf. le TP DYNAMIQUE en
    // en-tête). `tpDist` est la distance en vigueur, `tp` le prix qu'elle vise.
    let tpDist = tpPtsEff;
    let tp = isBuy ? entry + tpDist : entry - tpDist;

    // Le stop de break-even, borné par le stop d'origine : un déplacement ne peut
    // que RESSERRER le risque, jamais l'élargir. Un blocage à −1 R retombe donc
    // exactement sur le stop initial, et tout ce qui est en deçà est ignoré.
    //
    // TOUT EN R, DONC INDÉPENDANT DU DÛ : une position partie rembourser arme son
    // BE au même endroit qu'une autre, et le déplace au même niveau. Le dû
    // change l'objectif, jamais la protection — sans quoi une longue série de
    // pertes éloignerait le seuil et désarmerait le break-even au moment précis
    // où il sert le plus.
    const beOn      = p.beTriggerR > 0;
    const beTrigger = p.beTriggerR * risk0;
    const beRaw     = isBuy ? entry + p.beLevelR * risk0 : entry - p.beLevelR * risk0;
    const beStop    = isBuy ? Math.max(beRaw, sl) : Math.min(beRaw, sl);

    // Un stop traversé en gap se remplit au pire du niveau et de l'ouverture :
    // jamais mieux que le marché.
    const stopFill = (lvl, k) => isBuy ? Math.min(lvl, k.open) : Math.max(lvl, k.open);
    const hitStop  = (lvl, k) => isBuy ? k.low  <= lvl : k.high >= lvl;
    const hitTp    = k => isBuy ? k.high >= tp : k.low  <= tp;
    const favOf    = k => isBuy ? k.high - entry : entry - k.low;

    // ── LE TP DYNAMIQUE ──────────────────────────────────────────────────────
    // Deux raisons de repousser la cible, toutes deux jugées à l'instant OÙ le
    // TP de base est touché — pas avant, pas après. Un dû en cours l'interdit :
    // une position partie rembourser vise une dette, pas un profit.
    const boostOn   = duePts <= 0;
    const fastBars  = p.tpFastBars > 0 ? p.tpFastBars : 0;
    const fastMult  = p.tpFastMult > 1 ? p.tpFastMult : 1;
    const saneMult  = p.tpSaneMult > 1 ? p.tpSaneMult : 1;
    const saneMa    = p.tpSaneMa ?? null;
    const healthLvl = z.healthLevel;
    // « Saine » suppose d'être entré du BON CÔTÉ de la moyenne : sous elle à
    // l'achat, au-dessus à la vente. Lu à la bougie d'ENTRÉE et figé là. Sans
    // moyenne, ou avant qu'elle soit chaude, la règle ne peut pas s'appliquer.
    const maAtEntry = saneMa ? saneMa[entryIdx] : null;
    const saneSide  = maAtEntry != null && (isBuy ? entry < maAtEntry : entry > maAtEntry);

    // ── LE BE DU MALSAIN ─────────────────────────────────────────────────────
    // Une sortie de SECOURS, armée le jour où la position cesse d'être saine :
    // on ne vise plus le TP, on attend que le prix revienne à `beUnhPts` points
    // AU-DESSUS de l'entrée (en dessous en vente) et on solde là, sur un petit
    // gain. Le stop reste actif entre-temps — c'est une course entre les deux,
    // et rien ne garantit que le prix revienne.
    // LE NIVEAU DE BE, partagé par les DEUX règles ci-dessous. Une seule
    // distance : les deux disent « sortir à ce petit gain », elles ne diffèrent
    // que par ce qui les arme et par le côté d'où elles agissent.
    const beUnhPts = z.beUnhealthyPts ?? p.beUnhealthyPts;
    const beLevel  = isBuy ? entry + beUnhPts : entry - beUnhPts;
    const beUnhOn  = beUnhPts > 0 && healthLvl != null;

    // ── LE BE EXISTENTIEL ────────────────────────────────────────────────────
    // Armé par le TEMPS, pas par une avarie : passé `beExistBars` bougies, la
    // position a assez duré pour qu'on cesse de lui faire crédit. Le niveau
    // devient alors un point de sortie des DEUX CÔTÉS — protection au-dessus,
    // cible en dessous. Il lui faut le même niveau, donc la même distance.
    const existBars = p.beExistBars > 0 ? p.beExistBars : 0;
    const existOn   = existBars > 0 && beUnhPts > 0;

    let exitIdx = null, exitPrice = null, exitReason = null, ambiguousExit = false;
    // `beReason` dit LEQUEL des break-even a agi : 'profit' pour le déplacement
    // de stop de la famille, 'unhealthy' pour la sortie de secours du malsain,
    // 'existential' pour celle du temps. Les confondre rendrait un statut 'be'
    // illisible — trois mécaniques différentes sous une même étiquette.
    let slMoved = false, beTime = null, beReason = null;
    // La position est SAINE tant qu'aucune bougie n'a CLÔTURÉ au-delà du niveau
    // de référence — le bord du gap qui l'a fait entrer. Une mèche qui le
    // traverse ne compte pas : ce qu'on veut voir, c'est un rejet, pas une
    // visite. Sans niveau, la question ne se pose pas et rien n'est jugé.
    let healthy = healthLvl != null;
    // La bougie où elle a CESSÉ de l'être — Infinity si elle l'est restée
    // jusqu'au bout. C'est ce qui borne le trade unique en mode 'healthy'.
    let unhealthyIdx = Infinity;
    let boosted = null;   // { reason, mult, bars } une fois la cible repoussée

    for (let j = entryIdx; j < n; j++) {
      const k    = candles[j];
      const stop = slMoved ? beStop : sl;

      // ── LES DEUX BE, SUR LE MÊME NIVEAU ────────────────────────────────────
      // Ce qui les sépare : ce qui les arme, et le côté d'où ils agissent.
      //   • MALSAIN     — armé par une AVARIE, à partir de la bougie suivant la
      //     rupture de santé. Il ATTEND que le prix revienne au niveau.
      //   • EXISTENTIEL — armé par le TEMPS, à la `beExistBars`-ième bougie
      //     après l'entrée. Il agit des DEUX côtés.
      const beMalsain = beUnhOn && j > unhealthyIdx;
      const beExist   = existOn && j > entryIdx && (j - entryIdx) >= existBars;

      // De quel côté du niveau on se trouve, jugé au dernier prix CONNU — la
      // clôture de la bougie PRÉCÉDENTE. Le juger sur la bougie en cours
      // reviendrait à lire son avenir.
      const dessus = j > entryIdx
        && (isBuy ? candles[j - 1].close > beLevel : candles[j - 1].close < beLevel);

      // CÔTÉ PROTECTION — la position est déjà au-delà du niveau : on ne la
      // laisse plus redescendre dessous. Testé AVANT le stop, et ce n'est pas un
      // arbitrage : venant d'au-dessus, le prix croise forcément ce niveau avant
      // d'atteindre le stop, qui est plus bas. Seul l'EXISTENTIEL protège — le
      // malsain n'a rien à attendre d'un prix déjà au-delà.
      if (beExist && dessus) {
        if (isBuy ? k.low <= beLevel : k.high >= beLevel) {
          exitIdx = j; exitPrice = stopFill(beLevel, k); exitReason = 'be';
          beTime = k.time; beReason = 'existential';
          break;
        }
        // Toujours au-delà du niveau : le TP reste jouable, on continue.
      }

      if (hitStop(stop, k)) {
        if (hitTp(k)) ambiguousExit = true;   // les deux : le stop gagne
        exitIdx = j; exitPrice = stopFill(stop, k);
        exitReason = slMoved ? 'be' : 'sl';
        break;
      }

      // CÔTÉ CIBLE — la position n'a pas atteint le niveau : on coupe dès
      // qu'elle y arrive, quelle que soit celle des deux règles qui a armé.
      // LE BE DU MALSAIN, avant le TP. Il n'y a pas d'arbitrage à faire : le
      // prix revient du MAUVAIS côté, il croise donc forcément ce niveau-ci —
      // plus proche de l'entrée — avant le TP. Conséquence à connaître : une
      // fois un BE armé, une position ne peut plus atteindre son objectif par le
      // bas : sa meilleure issue devient ce petit gain. Le malsain n'est actif
      // qu'à partir de la bougie SUIVANT celle qui a rompu la santé — la clôture
      // qui l'arme n'est connue qu'à la fin de cette bougie-là.
      if ((beMalsain || beExist) && !dessus
          && (isBuy ? k.high >= beLevel : k.low <= beLevel)) {
        exitIdx = j; exitPrice = beLevel; exitReason = 'be';
        beTime = k.time; beReason = beMalsain ? 'unhealthy' : 'existential';
        break;
      }

      if (hitTp(k)) {
        // La cible est-elle repoussée, ou la position sort-elle ? Une seule
        // extension par position : la seconde fois, on prend le gain. Sans ça
        // une position rapide verrait sa cible fuir indéfiniment.
        const bars = j - entryIdx;
        const fast = boostOn && !boosted && fastBars > 0 && fastMult > 1 && bars <= fastBars;
        const sane = boostOn && !boosted && saneMult > 1 && healthy && saneSide;
        // Les deux raisons disent la même chose — « cette position se comporte
        // bien » — et se recouvrent souvent. On prend donc le PLUS GRAND des
        // deux multiplicateurs, on ne les compose pas : les multiplier
        // compterait deux fois la même preuve.
        const mult = Math.max(fast ? fastMult : 1, sane ? saneMult : 1);

        if (mult > 1) {
          // Repoussée depuis la distance de BASE, jamais depuis la cible
          // courante. Et la nouvelle cible ne peut pas être atteinte sur CETTE
          // bougie : à la granularité de la bougie on ne sait pas si le reste du
          // mouvement a suivi ou précédé le premier toucher. Même prudence que
          // pour l'armement du break-even.
          tpDist  = tpPtsEff * mult;
          tp      = isBuy ? entry + tpDist : entry - tpDist;
          boosted = { reason: fast && sane ? 'fast+sane' : fast ? 'fast' : 'sane', mult, bars };
        } else {
          exitIdx = j; exitPrice = tp; exitReason = 'tp'; break;
        }
      }

      // La SANTÉ se juge à la CLÔTURE, et en DERNIER : sur la bougie qui touche
      // le TP, on ignore si la clôture est venue avant ou après le toucher. La
      // santé lue au moment de décider ne porte donc que sur les bougies
      // ENTIÈREMENT connues avant celle-là.
      if (healthy && (isBuy ? k.close < healthLvl : k.close > healthLvl)) {
        healthy = false;
        unhealthyIdx = j;
      }

      // Armement en dernier : le stop déplacé ne prend effet qu'à la CLÔTURE de
      // cette bougie, donc au tour suivant. Sans ça, la mèche qui arme le BE
      // pourrait le faire toucher dans la foulée — un mouvement qu'aucun ordre
      // réel n'aurait subi.
      if (beOn && !slMoved && favOf(k) >= beTrigger) {
        slMoved  = true;
        beTime   = k.time;
        beReason = 'profit';
      }
    }
    if (exitIdx == null) {
      exitIdx = n - 1; exitPrice = candles[n - 1].close; exitReason = 'open';
    }
    const isWin = exitReason === 'tp';

    // REPOS APRÈS UN GAIN. Le signal vient d'être simulé jusqu'au bout, ce qui
    // permet de dire s'il AURAIT gagné avant de le jeter — sans ça on saurait
    // seulement combien ont été sautés, jamais ce que ça a coûté.
    //
    // ANTI-ANTICIPATION : un signal n'est écarté que s'il entre APRÈS la sortie
    // du gain qui a armé le repos. Un motif entré avant que ce TP ne tombe ne
    // pouvait pas savoir qu'il allait tomber, et les positions se chevauchant par
    // défaut, le cas est courant — sans cette règle, le repos remonterait le
    // temps.
    if (cooldown > 0 && entryIdx > armExit) {
      cooldown -= 1;
      skippedByCooldown++;
      if (isWin) skippedWon++;
      // Le signal n'est PAS pris : il ne consomme donc pas le créneau du trade
      // unique et n'entre dans aucun compteur d'issue.
      continue;
    }

    if (ambiguousExit) ambiguous++;

    // Excursions, bougie d'entrée comprise. La MFE exclut la bougie de sortie
    // quand c'est le stop qui a tranché : sur cette bougie-là, l'ordre entre le
    // sommet et le stop est inconnu, et le supposer favorable serait optimiste.
    let maxPullupPts = 0, maxDrawdownPts = 0, entryTouches = 0;
    const mfeLast = (exitReason === 'sl' || exitReason === 'be') ? exitIdx - 1 : exitIdx;
    for (let j = entryIdx; j <= exitIdx; j++) {
      const k   = candles[j];
      const fav = isBuy ? k.high - entry : entry - k.low;
      const adv = isBuy ? entry - k.low  : k.high - entry;
      if (j <= mfeLast && fav > maxPullupPts) maxPullupPts = fav;
      if (adv > maxDrawdownPts) maxDrawdownPts = adv;
      // La bougie d'entrée s'ouvre AU niveau d'entrée : la compter ferait un
      // retour à chaque position. La bougie de sortie, elle, compte.
      if (j > entryIdx && k.low <= entry && k.high >= entry) entryTouches++;
    }
    // Plafonnée à la distance de la cible EN VIGUEUR à la sortie — celle qui a
    // été repoussée le cas échéant, sinon la MFE d'une position à cible étendue
    // serait tronquée à un objectif qu'elle avait déjà dépassé.
    maxPullupPts   = Math.min(Math.max(0, maxPullupPts),   tpDist);
    maxDrawdownPts = Math.min(Math.max(0, maxDrawdownPts), risk0);

    // Le coût de l'aller-retour n'est dû que par une position CLÔTURÉE.
    const gross1    = isBuy ? exitPrice - entry : entry - exitPrice;
    const spread1   = exitReason === 'open' ? 0 : (p.spreadPts > 0 ? p.spreadPts : 0);

    // LE LOT, enfin. Cette position est retenue : elle prend le numéro suivant
    // et la marche qui va avec. Brut, spread et net sont multipliés ENSEMBLE —
    // deux lots paient deux spreads —, ce qui garde net = brut − spread vrai.
    tradeNo++;
    const lot       = lotOf(tradeNo);
    const grossPts  = gross1  * lot;
    const spreadDue = spread1 * lot;

    trades.push({
      id:           id++,
      direction:    isBuy ? 'BUY' : 'SELL',
      label,
      entryTime:    candles[entryIdx].time,
      entryPrice:   entry,
      // Combien de bougies l'ordre en attente a mis à être servi (0 = tout de
      // suite, sur la bougie qui suit le motif).
      waitedBars:   entryIdx - eIdx,
      exitTime:     candles[exitIdx].time,
      exitPrice,
      sl:           slMoved ? beStop : sl,   // le stop EN VIGUEUR à la sortie
      sl0:          sl,                      // celui d'origine, toujours conservé
      tp,
      beActivated:  slMoved || beReason != null,
      beReason:     beReason ?? (slMoved ? 'profit' : null),
      beTime,
      level:        z.level,          // le niveau marqué par le motif
      risk0,
      // Le dû visé par CETTE position, en points, ou 0 si elle jouait son vrai
      // TP — et, à côté, l'ardoise ENTIÈRE au moment d'entrer. Les deux sont
      // égales en remboursement d'un coup ; par bonds, l'écart dit ce qui
      // restera à devoir. Conservé pour qu'un remboursement se vérifie à la main.
      duePts,
      dueTotalPts,
      dueCount,
      // La distance de l'objectif RÉELLEMENT visé, en points. Elle vaut le vrai
      // TP dans le cas courant, le dû quand celui-ci a pris sa place — et c'est
      // le seul endroit où la lire quand le TP est réglé en ATR, puisqu'il change
      // alors d'une position à l'autre.
      // La distance de la cible en vigueur à la sortie, extension comprise. La
      // distance de DÉPART reste lisible à côté : sans elle, une cible repoussée
      // se relirait comme un réglage qui n'a jamais existé.
      tpDistPts:      tpDist,
      tpBaseDistPts:  tpPtsEff,
      tpBoosted:      boosted != null,
      tpBoostReason:  boosted?.reason ?? null,
      tpBoostMult:    boosted?.mult ?? null,
      tpBoostBars:    boosted?.bars ?? null,
      // La SANTÉ de la position : est-elle restée saine jusqu'au bout, et
      // combien de bougies l'a-t-elle été. C'est la durée pendant laquelle elle
      // a fermé la porte aux suivantes en trade unique 'healthy' — le seul moyen
      // de savoir si ce mode filtre beaucoup ou presque rien.
      stayedHealthy:  healthLvl != null && unhealthyIdx === Infinity,
      healthyBars:    healthLvl == null ? null
        : Math.max(0, Math.min(exitIdx, unhealthyIdx) - entryIdx),
      // Les trois sont EN LOTS : c'est le résultat du compte, pas la distance
      // parcourue par le prix. Celle-ci se relit dans `sl`, `tp` et `risk0`, qui
      // restent des prix et ne sont jamais multipliés.
      profitPoints: grossPts,         // BRUT — ce qui se lit sur le graphe, × lot
      spreadPts:    spreadDue,        // le coût réel : deux lots paient deux spreads
      netPoints:    grossPts - spreadDue,
      // La taille de CETTE position, et son rang dans la série qui l'a fixée.
      // Sans eux, un résultat multiplié serait illisible.
      lot,
      tradeNo,
      // LE RÉSULTAT RAMENÉ À 1 LOT — celui de la STRATÉGIE, débarrassé du plan
      // de taille. C'est lui que doivent lire les mesures qui jugent ou règlent
      // la stratégie (gain moyen, seuil de rentabilité, facteur de profit,
      // études BE et SL) : elles vivent dans l'espace des PRIX, et les nourrir
      // de résultats pondérés par le lot reviendrait à les régler sur le
      // calendrier des lots plutôt que sur le marché. Identique au net tant que
      // le lot vaut 1, c'est-à-dire partout sauf en escalier.
      profitPoints1: gross1,
      netPoints1:    gross1 - spread1,
      exitReason,
      status:       exitReason,
      barsHeld:     exitIdx - entryIdx,
      entryTouches,
      maxPullupPts,
      maxDrawdownPts,
      // Le moteur partagé restreint la MAE à la fenêtre où le stop existe, la
      // bougie d'entrée étant à découvert. Ici le stop couvre TOUT, dès l'entrée :
      // la MAE armée est donc la MAE. Le champ reste, pour que les rapports des
      // deux familles aient la même forme.
      maeArmedPts:  maxDrawdownPts,
      // Repères du motif, pour retrouver la figure sur le graphe.
      fromIdx:      z.fromIdx,
      toIdx:        z.toIdx,
      breathCount:  z.breathCount,
    });
    // Jusqu'où cette position EMPÊCHE les suivantes, si le trade unique est
    // actif. Deux façons de fermer la porte (cf. l'en-tête) :
    //   'exit'    — jusqu'à sa sortie, quoi qu'elle fasse entre-temps.
    //   'healthy' — jusqu'à sa sortie OU jusqu'à ce qu'elle cesse d'être SAINE,
    //     le premier des deux. La bougie qui la rend malsaine bloque encore :
    //     une entrée qui s'y produit a lieu avant qu'on connaisse cette clôture.
    //     Une position sans niveau de santé n'est jamais saine et ne bloque donc
    //     rien du tout — le mode s'éteint de lui-même plutôt que de retomber en
    //     silence sur l'autre.
    lastBlockIdx = p.uniqueMode === 'healthy'
      ? (healthLvl == null ? -1 : Math.min(exitIdx, unhealthyIdx))
      : exitIdx;

    // La position est RETENUE : son résultat entre dans le dû — mais seulement
    // quand une entrée postérieure à sa sortie viendra le lire. Une position
    // ouverte au bord des données n'a rien réalisé et n'y entre pas.
    if (duePts > 0) dueArmedCount++;
    // LE DÛ IGNORE LE LOT, exprès : il vise une DISTANCE de prix (il déplace la
    // cible), pas un résultat de compte. Lui donner le résultat multiplié
    // déplacerait le TP en proportion du lot, ce qui n'a aucun sens — une dette
    // de 40 points à 4 lots ne se rembourse pas en visant 160 points de prix.
    if (exitReason !== 'open') due.record(exitIdx, gross1 - spread1);

    // Un gain arme le repos. EXACTEMENT skipAfterTp signaux seront sautés : à la
    // différence du rFVG, un signal sauté qui aurait gagné ne relance pas le
    // compteur — il est compté dans skippedWon, et c'est tout.
    if (p.skipAfterTp > 0 && isWin) {
      cooldown = p.skipAfterTp;
      armExit  = exitIdx;
    }
  }

  trades.ambiguous         = ambiguous;
  trades.skippedByStop     = skippedByStop;
  trades.skippedByUnique   = skippedByUnique;
  trades.skippedByCooldown = skippedByCooldown;
  trades.skippedWon        = skippedWon;
  // Le dû : combien de positions ont visé un remboursement plutôt que leur vrai
  // TP, et ce qui reste sur l'ardoise au bord des données. Les sorties encore
  // en attente sont soldées ici — sans quoi le reliquat oublierait les dernières
  // positions closes, qu'aucune entrée suivante n'est venue lire.
  due.settle(Infinity);
  const dueLeft = due.remaining();
  trades.dueArmed        = dueArmedCount;
  trades.dueRemainingPts = dueLeft.pts;
  trades.dueRemainingSl  = dueLeft.count;
  return trades;
}
