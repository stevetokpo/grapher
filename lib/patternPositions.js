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
//   { side: 'bull'|'bear', fromIdx, toIdx, level?, top?, bottom?, breathCount? }
//   • fromIdx…toIdx — les bougies DU MOTIF. Le stop structurel s'y appuie, et la
//     bougie d'entrée est toIdx+1. Ni l'une ni l'autre n'en fait partie.
//   • top/bottom    — la bande, nécessaire au seul mode d'entrée 'zone'.
//   Les signaux doivent arriver dans l'ordre chronologique : `uniqueTrade` et
//   `skipAfterTp` sont des états SÉQUENTIELS.
//
// LES RÈGLES :
//   ENTRÉE — deux façons (`entryMode`), et ce n'est pas un détail : elles ne
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
//   TP    — `rr` fois le risque : TP = entrée ± rr × |entrée − stop|.
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
// avant la clôture de la position en cours est IGNORÉ, dans son sens comme à
// contre-sens, et n'apparaît nulle part. Deux choses à en savoir :
//   • ce n'est pas un filtre neutre — il retire des signaux selon ce que le
//     marché a fait ENTRE-TEMPS. Une position qui traîne masque les suivants ; si
//     ceux-là étaient les mauvais, la stratégie a l'air meilleure sans avoir
//     changé. C'est un faux edge classique, déjà rencontré sur eq-balance ;
//   • il rend le résultat SÉQUENTIEL : les signaux doivent être joués dans
//     l'ordre, ce que garantit toute détection rendant ses signaux dans l'ordre
//     des bougies.
//
// PAS DE STOP SUIVEUR ni de sortie en temps. Le rapport porte les excursions
// (MFE / MAE) de chaque position : ce sont elles qui permettent de régler le BE
// sur pièces plutôt qu'au jugé.

export function simulatePatternPositions(candles, signals, p, label = 'signal') {
  const n = candles?.length ?? 0;
  const trades = [];
  let ambiguous = 0;
  if (!(p.rr > 0) || n < 3 || !signals?.length) {
    trades.ambiguous = 0; trades.skippedByUnique = 0;
    trades.skippedByCooldown = 0; trades.skippedWon = 0;
    return trades;
  }

  let id = 1;
  // États SÉQUENTIELS. Ils imposent que les signaux soient joués dans l'ordre des
  // bougies — c'est au détecteur de le garantir.
  let lastExitIdx = -1;        // sortie de la dernière position RETENUE (trade unique)
  let skippedByUnique = 0;
  let cooldown = 0;            // signaux restant à sauter après un gain
  let armExit  = -1;           // bougie de sortie du gain qui a armé ce repos
  let skippedByCooldown = 0, skippedWon = 0;

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

    // Trade unique : jugé sur la bougie de REMPLISSAGE, pas sur celle du signal —
    // un ordre en attente n'est pas une position et ne bloque donc rien. Placé
    // après le calcul du remplissage, et après le cas 'missed' qui n'ouvre rien.
    if (!missed && p.uniqueTrade && entryIdx <= lastExitIdx) { skippedByUnique++; continue; }

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
      if (!(p.slPts > 0)) continue;
      sl = isBuy ? entry - p.slPts : entry + p.slPts;
    } else {
      let anchor = isBuy ? Infinity : -Infinity;
      for (let j = z.fromIdx; j <= z.toIdx; j++) {
        anchor = isBuy ? Math.min(anchor, candles[j].low)
                       : Math.max(anchor, candles[j].high);
      }
      sl = isBuy ? anchor - p.slMarginPts : anchor + p.slMarginPts;
    }

    const risk0 = Math.abs(entry - sl);
    if (!(risk0 > 0)) continue;          // stop du mauvais côté ou collé à l'entrée
    const tp = isBuy ? entry + p.rr * risk0 : entry - p.rr * risk0;

    // Le stop de break-even, borné par le stop d'origine : un déplacement ne peut
    // que RESSERRER le risque, jamais l'élargir. Un blocage à −1 R retombe donc
    // exactement sur le stop initial, et tout ce qui est en deçà est ignoré.
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

    let exitIdx = null, exitPrice = null, exitReason = null, ambiguousExit = false;
    let slMoved = false, beTime = null;

    for (let j = entryIdx; j < n; j++) {
      const k    = candles[j];
      const stop = slMoved ? beStop : sl;

      if (hitStop(stop, k)) {
        if (hitTp(k)) ambiguousExit = true;   // les deux : le stop gagne
        exitIdx = j; exitPrice = stopFill(stop, k);
        exitReason = slMoved ? 'be' : 'sl';
        break;
      }
      if (hitTp(k)) { exitIdx = j; exitPrice = tp; exitReason = 'tp'; break; }

      // Armement en dernier : le stop déplacé ne prend effet qu'à la CLÔTURE de
      // cette bougie, donc au tour suivant. Sans ça, la mèche qui arme le BE
      // pourrait le faire toucher dans la foulée — un mouvement qu'aucun ordre
      // réel n'aurait subi.
      if (beOn && !slMoved && favOf(k) >= beTrigger) {
        slMoved = true;
        beTime  = k.time;
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
    const tpPtsEff = p.rr * risk0;
    maxPullupPts   = Math.min(Math.max(0, maxPullupPts),   tpPtsEff);
    maxDrawdownPts = Math.min(Math.max(0, maxDrawdownPts), risk0);

    // Le coût de l'aller-retour n'est dû que par une position CLÔTURÉE.
    const grossPts  = isBuy ? exitPrice - entry : entry - exitPrice;
    const spreadDue = exitReason === 'open' ? 0 : (p.spreadPts > 0 ? p.spreadPts : 0);

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
      beActivated:  slMoved,
      beReason:     slMoved ? 'profit' : null,
      beTime,
      level:        z.level,          // le niveau marqué par le motif
      risk0,
      profitPoints: grossPts,         // BRUT — ce qui se lit sur le graphe
      spreadPts:    spreadDue,
      netPoints:    grossPts - spreadDue,
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
    lastExitIdx = exitIdx;

    // Un gain arme le repos. EXACTEMENT skipAfterTp signaux seront sautés : à la
    // différence du rFVG, un signal sauté qui aurait gagné ne relance pas le
    // compteur — il est compté dans skippedWon, et c'est tout.
    if (p.skipAfterTp > 0 && isWin) {
      cooldown = p.skipAfterTp;
      armExit  = exitIdx;
    }
  }

  trades.ambiguous         = ambiguous;
  trades.skippedByUnique   = skippedByUnique;
  trades.skippedByCooldown = skippedByCooldown;
  trades.skippedWon        = skippedWon;
  return trades;
}
