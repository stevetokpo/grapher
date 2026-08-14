# KUMO — le nuage d'Ichimoku

`lib/ichimoku.js` · rendu `components/charts/KumoPrimitive.js` · réglages dans le panneau
Indicateurs · auto-contrôle `npm run ichimoku-test`

Les cinq courbes de l'*Ichimoku Kinko Hyo*, dont deux sont tracées **en avance sur le prix**.
C'est là tout l'intérêt : une moyenne mobile ne raconte que le passé, le nuage est déjà posé
26 bougies devant la dernière — le support et la résistance sont connus **avant** que le marché
n'y arrive.

## Les cinq lignes

| Ligne | Calcul | Où elle est posée |
|---|---|---|
| **Tenkan-sen** (9) | milieu du canal des 9 dernières bougies | sur sa bougie |
| **Kijun-sen** (26) | milieu du canal des 26 dernières | sur sa bougie |
| **Senkou A** | (Tenkan + Kijun) / 2 | **+26 bougies** |
| **Senkou B** (52) | milieu du canal des 52 dernières | **+26 bougies** |
| **Chikou** | la clôture, telle quelle | **−26 bougies** |

**Milieu du canal, pas moyenne.** Chaque ligne vaut `(plus haut + plus bas) / 2` sur sa fenêtre :
la médiane du *range*, pas celle des clôtures. Une ligne plate ne dit donc pas « pas de
tendance » mais « aucun nouvel extrême » — ce n'est pas la même information, et c'est ce qui
donne à l'Ichimoku ses paliers en escalier là où une moyenne mobile serpente.

Le calcul passe par deux files monotones : chaque bougie entre et sort une fois, donc O(n) même
avec une fenêtre de 52. Le replay, qui rappelle la fonction à chaque nouvelle bougie, ne le sent
pas.

## Le nuage

Le **kumo** est la surface entre les deux Senkou. Sa couleur suit le signe de leur écart :
Senkou A au-dessus, nuage haussier ; en dessous, baissier. Son **épaisseur** dit la force du
niveau — c'est pour ça que le remplissage est un aplat uniforme et rien d'autre : un dégradé ou
une lueur donneraient du poids à un bord plutôt qu'à la hauteur.

Le basculement d'un camp à l'autre tombe presque toujours **au milieu d'une bougie**, pas sur son
bord. Le remplissage est donc découpé à l'intersection exacte des deux segments : le nuage se
pince en pointe et repart de l'autre couleur au bon endroit. Colorier bougie par bougie donnerait
un escalier faux de la largeur d'une bougie.

lightweight-charts ne sait pas remplir entre deux courbes — d'où la primitive. Les cinq lignes,
elles, sont des séries ordinaires : étiquette de prix et marqueur de curseur viennent avec.

## Le décalage se compte en bougies

Les deux Senkou dépassent la dernière bougie chargée : **leurs horodatages n'existent pas
encore**. On les fabrique en prolongeant le pas de temps *le plus fréquent* des 300 dernières
bougies — ni le dernier écart, ni la moyenne, que le premier trou de week-end fausserait. C'est
ce `setData` sur des temps futurs qui ouvre la place à droite du graphe ; les séries Senkou sont
donc toujours alimentées, **même masquées**, sinon le nuage projeté n'aurait plus d'abscisse où
se poser.

Sur un marché à trous, les horodatages projetés sont réguliers là où le marché ne le sera pas.
Le décalage, lui, reste juste en **nombre de bougies** — la seule unité qui compte ici.

Le Chikou, à l'inverse, ne fabrique rien : ses 26 premières bougies tomberaient avant
l'historique chargé, on les laisse simplement de côté plutôt que d'inventer des bougies à gauche.

**Convention MT5** : le décalage est appliqué tel quel (26 bougies). L'Ichimoku intégré de
TradingView décale de `displacement − 1`, soit une bougie de moins — un graphe TradingView posé
à côté sera donc décalé d'un cran.

## Réglages

Périodes (9 / 26 / 52) et décalage (26) sont libres. Chaque ligne a sa couleur et son
interrupteur ; le nuage a les siennes (haussier / baissier), son taux de remplissage, et peut
être éteint pour ne garder que les bords — ou l'inverse, bords masqués et nuage seul.

## Lecture

- **Prix au-dessus du nuage** : tendance haussière, le nuage sert de support ; en dessous,
  l'inverse.
- **Nuage épais** : le marché a laissé un large écart entre sa vue courte et sa vue longue —
  niveau réputé difficile à traverser. Nuage fin : traversée facile, et souvent un
  retournement du kumo dans la foulée.
- **Croisement Tenkan / Kijun** : le signal court, d'autant plus lu qu'il tombe du bon côté du
  nuage.
- **Chikou** : la clôture ramenée en arrière ; libre au-dessus des bougies d'alors = rien ne
  freine.

Rien de tout cela n'est mesuré ni backtesté ici : cet indicateur **dessine**, il ne juge pas.
Pour savoir si l'une de ces lectures tient sur les données du projet, il faut la passer par
`lib/backtest` — voir [backtesting.md](backtesting.md).
