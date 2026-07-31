// Rapport JSON des positions, pour les motifs à stop structurel connu d'avance
// (liq, rev). Une seule construction pour toute la famille : deux rapports de
// forme différente ne se compareraient plus, et /rapports devrait apprendre à
// lire chaque variante.
//
// Le document produit se dépose tel quel dans /rapports, qui ne connaît aucun
// motif en particulier — il lui faut un tableau `positions` et des `params`.

export function buildPatternReport({ titre, params, stats, positions }) {
const iso = t => t != null ? new Date(t * 1000).toISOString() : null;
    const rOf = (pts, risk0) => pts != null && risk0 > 0 ? +(pts / risk0).toFixed(4) : null;
    // Un signal jamais rempli ('missed') n'a ni prix ni excursion : arrondir un
    // null jetterait. Tout ce qui vient d'une position doit passer par ici.
    const num = (v, d = 6) => v == null ? null : +v.toFixed(d);

    const resolved = stats.tp + stats.sl;
    const doc = {
      pattern:     titre,
      generatedAt: new Date().toISOString(),
      params,
      stats: {
        total:   stats.total,
        tp:      stats.tp,
        sl:      stats.sl,
        be:      stats.be,
        missed:  stats.missed,
        open:    stats.open,
        winrate: resolved > 0 ? +(stats.tp / resolved).toFixed(4) : null,
        breakevenWinrate: stats.beThresh != null ? +stats.beThresh.toFixed(4) : null,
        expectancyPts:    stats.expPts != null ? +stats.expPts.toFixed(4) : null,
        netPts:           +stats.netPts.toFixed(4),
        profitFactor: stats.profitFactor != null && Number.isFinite(stats.profitFactor)
          ? +stats.profitFactor.toFixed(4) : null,
        barsHeldMedian: stats.barsHeldMedian,
        barsHeldMean:   stats.barsHeldMean != null ? +stats.barsHeldMean.toFixed(2) : null,
        barsHeldMax:    stats.barsHeldMax,
        onEntryBar:     stats.onEntryBar,
        entryTouchesMean: stats.entryTouchesMean != null ? +stats.entryTouchesMean.toFixed(2) : null,
        entryTouchesMax:  stats.entryTouchesMax,
        neverReturned:    stats.neverReturned,
        ambiguous:        positions.ambiguous ?? 0,
        // Signaux écartés par le trade unique : ils n'existent nulle part
        // ailleurs, et leur nombre est ce qui dit à quel point ce mode filtre.
        skippedByUnique:  positions.skippedByUnique ?? 0,
        // Repos après gain : combien sautés, et combien auraient gagné — c'est
        // le second chiffre qui dit ce que le repos a coûté.
        skippedByCooldown: positions.skippedByCooldown ?? 0,
        skippedWon:        positions.skippedWon ?? 0,
      },
      conventions: {
        unites:  "P&L en POINTS : le lot est fixe, c'est lui qui est proportionnel au gain réel. Les champs en R (points / risk0) sont fournis en plus, le risque variant d'une position à l'autre",
        entree:  "entryMode = 'zone' (défaut) : ORDRE EN ATTENTE au bord de la bande tracée. La bande est haute de zonePts POINTS de prix et le NIVEAU en est le bord EXTÉRIEUR : elle est tirée depuis lui vers l'intérieur du motif (sous le plus haut d'une pince haussière, au-dessus du plus bas d'une baissière), donc rien ne dépasse l'extrême. On n'entre que si le prix revient dedans, et on est rempli au bord qu'il atteint en premier — le niveau lui-même dans le cas normal — ou à l'ouverture de la bougie si elle a ouvert au-delà. Le côté d'approche est figé à la clôture de la 2e impulsion, comme le ferait un ordre réel au moment d'être posé. Passé entryWaitBars bougies l'ordre est annulé : le signal reste listé avec le statut 'missed', sans prix ni résultat, et n'entre dans aucune statistique. entryMode = 'market' : au marché à l'ouverture de la bougie qui suit la 2e impulsion, une position est toujours prise",
        signauxRates: "les 'missed' sont des signaux dont l'ordre n'a jamais été rempli. Ils sont LISTÉS exprès : les omettre donnerait un taux de réussite calculé sur les seuls trades que le marché a bien voulu servir, ce qui flatte le mode 'zone' sans rien mesurer. waitedBars dit, pour les autres, combien de bougies l'ordre a attendu",
        stop:    "slMode = 'structure' : sous le PLUS BAS de toutes les bougies du motif (1re impulsion → 2e incluses), moins slMarginPts ; au-dessus du PLUS HAUT plus la marge en vente — le risque suit alors la taille du motif et VARIE d'une position à l'autre. slMode = 'points' : à slPts de l'entrée, le risque devient CONSTANT et le seuil de rentabilité redevient 1/(1+RR). Dans les deux cas le stop est ENTIÈREMENT connu avant l'entrée, donc posé avec l'ordre et actif dès la bougie d'entrée — différence de fond avec le rFVG, dont le stop se calcule à partir de sa bougie d'entrée et ne peut exister qu'à sa clôture",
        tp:      "entrée ± rr × |entrée − stop|. Le RR est constant, le risque non : le TP en points varie donc d'une position à l'autre",
        signaux: "par défaut TOUS les signaux sont pris — les positions se chevauchent si les motifs se chevauchent, et la courbe de gains additionne donc des positions simultanées",
        cooldown: "skipAfterTp > 0 : après un TP touché, les N signaux suivants sont ignorés, puis on reprend. EXACTEMENT N — contrairement au rFVG, un signal sauté qui aurait gagné ne relance PAS le compteur. Les sautés ne sont pas dans `positions` : skippedByCooldown les compte et skippedWon dit combien auraient gagné, ce qui est le seul moyen de savoir ce que le repos a coûté. Anti-anticipation : un signal n'est écarté que s'il entre APRÈS la sortie du gain qui a armé le repos — les positions se chevauchant par défaut, le cas est fréquent. Un signal sauté ne consomme pas non plus le créneau du trade unique, puisqu'aucune position n'est ouverte",
        tradeUnique: "uniqueTrade = true : une seule position à la fois. Tout motif survenant avant la clôture de la position en cours est ignoré, dans son sens comme à contre-sens, et n'apparaît PAS dans `positions` — seul skippedByUnique les compte. ATTENTION, ce n'est pas un filtre neutre : il écarte des signaux selon ce que le marché a fait entre-temps, donc une position qui traîne masque les suivants. Si ceux-là étaient les mauvais, la stratégie paraît meilleure sans avoir changé. Le mode rend aussi le résultat séquentiel : les signaux doivent être joués dans l'ordre des bougies",
        breakEven: "beTriggerR > 0 : dès qu'une bougie avance de beTriggerR × risque dans le sens de la position, le stop se déplace À entrée ± beLevelR × risque, une seule fois pour toute la vie de la position — ce n'est PAS un stop suiveur. beLevelR = 0 met le stop à l'entrée (break-even au sens strict), positif sécurise du gain, négatif réduit la perte sans l'annuler. Le déplacement ne peut jamais ÉLARGIR le risque : un blocage au-delà du stop d'origine est ramené à celui-ci. ANTI-ANTICIPATION : le stop déplacé ne prend effet qu'à la CLÔTURE de la bougie qui l'a armé, il ne peut donc pas être touché par la mèche même qui vient de le déclencher. Sortie sur ce stop → statut 'be'. beActivated dit si le déplacement a eu lieu, beDate quand. Tout est en R et non en points : le risque variant d'une position à l'autre, un seuil en points ne voudrait pas dire la même chose deux fois",
        stopSuiveur: "aucun, et aucune sortie en temps. Les excursions ci-dessous sont là pour régler le BE sur pièces plutôt qu'au jugé",
        ambiguite: 'stop et TP touchés dans la même bougie : le stop gagne (pessimiste)',
        spread:  "coût de l'aller-retour, déduit de chaque position CLÔTURÉE. profitPoints est le BRUT (celui qui se relit sur le graphe), netPoints le réel, et c'est le net qui alimente les statistiques",
        maxPullupPts:   "MFE — plus forte avancée dans le sens de la position ; bougie de sortie EXCLUE si c'est le stop qui a tranché ; plafonnée au TP",
        maxDrawdownPts: "MAE — plus forte avancée contre la position, bougie de sortie incluse (pessimiste), plafonnée à risk0",
        maeArmedPts:    "identique à maxDrawdownPts ici : le stop couvre toute la vie de la position, bougie d'entrée comprise. Le champ existe pour que les rapports des deux familles aient la même forme",
      },
      positions: positions.map(p => ({
        id:           p.id,
        label:        p.label,
        direction:    p.direction,
        status:       p.status,
        entryTime:    p.entryTime,
        entryDate:    iso(p.entryTime),
        exitDate:     iso(p.exitTime),
        barsHeld:     p.barsHeld,
        entryTouches: p.entryTouches,
        entryPrice:   p.entryPrice,
        exitPrice:    p.exitPrice,
        sl:           p.sl,     // stop en vigueur à la sortie (déplacé le cas échéant)
        sl0:          p.sl0,    // stop d'origine, celui qui a défini risk0
        tp:           p.tp,
        beActivated:  p.beActivated ?? false,
        beReason:     p.beReason ?? null,
        beDate:       iso(p.beTime),
        level:        p.level,
        // Combien de bougies l'ordre en attente a mis à être servi.
        waitedBars:   p.waitedBars ?? null,
        risk0:        num(p.risk0),
        rr:           params.rr,                       // le RR VISÉ, constant
        profitPoints: num(p.profitPoints),
        profitR:      rOf(p.profitPoints, p.risk0),    // le R RÉALISÉ
        spreadPts:    p.spreadPts,
        netPoints:    num(p.netPoints),
        netR:         rOf(p.netPoints, p.risk0),
        maxPullupPts:   num(p.maxPullupPts),
        maxDrawdownPts: num(p.maxDrawdownPts),
        maeArmedPts:    num(p.maeArmedPts),
        breathCount:  p.breathCount,
      })),
    };

    return doc;
}
