# Contrat du moteur, métriques et pièges — vade-mecum de l'auditeur

Complément de `docs/backtesting.md` (le contrat officiel, à lire aussi), orienté
**audit** : ce que le moteur garantit, ce qu'il ne sait pas faire, et la liste
des défauts à chercher dans une stratégie.

## Ce que le moteur garantit (et qu'on ne peut pas lui reprocher)

| Règle | Conséquence pour l'analyse |
|---|---|
| Décision à la **clôture** de la bougie `i`, exécution à l'**ouverture** de `i+1` | pas de lookahead ; l'entrée n'est jamais au prix du signal — un écart entrée/signal est **normal**, pas un bug |
| SL/TP vérifiés **M1 par M1** dans chaque bougie TF | l'ordre intra-bougie est réel, pas deviné sur l'OHLC agrégé |
| SL et TP touchés dans la **même bougie M1** → le **SL gagne** | hypothèse conservatrice : les résultats sont pessimistes, pas optimistes |
| **Une position à la fois** ; signal opposé = flip (ferme + retourne) | un signal dans le même sens est ignoré ; pas de pyramidage |
| Spread = coût fixe en points, déduit **une fois par trade** | pas de modèle bid/ask ; le slippage n'existe pas — la réalité sera pire |
| Position ouverte en fin de données → fermée au dernier close, `exitReason: 'end'` | quelques trades `end` sont normaux ; une majorité de `end` est un symptôme |
| Ordre stop d'entrée actif **une seule bougie** | la stratégie doit le **ré-émettre** à chaque clôture pour le maintenir armé |
| `modify` (break-even, trailing) déplace les stops, mais le **R reste mesuré sur le risque initial** (`risk0`) | déplacer le SL ne regonfle pas le R : c'est voulu |
| Paramètre hors bornes → **remplacé silencieusement par le défaut** | l'API ne rejette jamais un param invalide. Toujours vérifier l'écho `meta.params` (le runner alerte : `⚠ CLAMPED`) |

## Vérification empirique du moteur (2026-07-13)

Le moteur a été audité en re-simulant les trades **indépendamment**, depuis les
bougies M1 brutes de l'API (XAUUSD, mars 2026, 15m, `ma-cross`, 104 trades) :

| Contrôle | Résultat |
|---|---|
| Nombre de trades (moteur vs re-simulation) | **104 = 104** |
| Sortie identique (motif, prix, horodatage) | **100 %**, aucun écart |
| Entrée = open de la bougie **suivant** le signal | ✔ vérifié sur les 104 (pas de lookahead) |
| `profitPoints` = (sortie − entrée) − spread | ✔ exact |
| `profitR` = profit / risque initial | ✔ exact |
| Stops **relatifs** (`slPoints`/`tpPoints`) | ✔ distance entrée→SL exacte au centième, R:R exact |
| Stops **absolus** calculés sur le close du signal | R:R demandé 2,00 → réalisé médiane **2,00** (p05 1,98 / p95 2,03) : la dérive due à l'entrée à l'open suivant est négligeable |
| Déterminisme (2 runs identiques) | ✔ résultats identiques |

Les indicateurs de `ta.js`, `calcTwinsBars` et le calcul de tendance HTF de
`trenderHarmony` (`out[i] = trend[j-1]`, dernière bougie HTF **clôturée**) ont
été relus : tous causaux, aucun accès au futur.

**Conclusion : les résultats du moteur sont fiables.** Ne perds pas de temps à
le suspecter — cherche les défauts dans la *stratégie*.

### Seule réserve connue : les fills sont exacts au niveau du stop

Le moteur clôture **exactement** à `sl` (ou `tp`), même si la bougie M1 a
traversé le niveau par un gap : dans ce cas, le fill réel serait **pire** que
simulé sur un SL (et meilleur sur un TP). Sur l'échantillon testé, **0 SL sur 45
et 0 TP sur 29** ont été traversés par un gap — l'hypothèse ne coûte rien en
intraday continu. Elle reste optimiste sur les ouvertures de semaine et les
instruments à trous. Il n'y a par ailleurs **aucun slippage** modélisé : la
réalité sera toujours un peu moins bonne que le backtest.

## Métriques — définitions exactes

- **points** : unités brutes de prix du symbole (pas de pips ; l'échelle change
  radicalement d'un instrument à l'autre — inutile de comparer les points de
  XAUUSD à ceux de Volatility 75).
- **R** : `profitPoints / risque initial`, le risque initial étant la distance
  entrée→SL **au moment de l'ouverture**. Un trade **sans SL a `profitR: null`**
  et sort de toutes les statistiques en R : une stratégie sans stop rend la
  moitié des métriques muettes.
- **avgR** : espérance par trade, en R. **La** métrique de décision.
- **winrate** : trompeur seul. Un TP serré donne 80 % de réussite et une
  espérance négative ; un TP lointain donne 25 % de réussite et un edge réel.
- **profitFactor** : gains bruts / pertes brutes. < 1 = perdant. ~1,0–1,1 sur
  quelques centaines de trades = bruit, pas un edge.
- **maxDD (R)** : pire recul de la courbe d'équité en R. À rapporter au totalR
  (`calmar`) : +50 R avec 45 R de drawdown n'est pas exploitable.
- **tStat** (score du runner) : `avgR / stdR × √n`. Confiance que l'espérance
  est réelle compte tenu de l'échantillon. Ordre de grandeur : < 1 = rien de
  prouvé ; ~2 = présomption d'edge ; > 3 = solide (*et encore : après N
  configurations testées, le meilleur tStat est mécaniquement gonflé — c'est
  exactement pourquoi l'OOS existe*).
- **exitReasons** : `tp` / `sl` / `signal` / `timeout` / `end`. Le profil de
  sortie raconte la stratégie (cf. tableau plus bas).

## Ce que le moteur NE sait PAS faire

Tout ce qui suit est un **manque de la plateforme**, pas un défaut de la
stratégie — mais c'est ce qui limite ce qu'on peut optimiser, et cela nourrit la
section « manques » du rapport :

- pas de **sizing en capital** (tout est en points et en R) ;
- pas de **filtre de session / d'heure** : les ventilations `byHour` et
  `byDayOfWeek` sont **diagnostiques**, aucun paramètre ne les exploite ;
- pas d'**ordres limites** d'entrée (marché et stop uniquement) ;
- pas de **pyramidage**, pas de positions multiples, pas de couverture ;
- pas de **slippage** ni de spread variable ; pas de commission séparée ;
- pas de **trailing stop natif** (faisable par la stratégie via `modify` à
  chaque bougie) ;
- pas de **persistance des runs** côté plateforme (d'où le ledger du runner).

## Défauts à chercher dans le code de la stratégie

`lib/backtest/strategies/<id>.js`. Dans l'ordre de gravité :

1. **Lookahead** — `onBar` lit-il `candles[i+1]`, `ind.x[i+1]`, ou un tableau
   calculé sur la totalité des bougies avec une fonction non causale (centrage,
   `Math.max(...tout)`, normalisation globale) ? C'est le défaut qui invalide
   tout : le backtest est alors une prophétie, pas un test.
2. **Warm-up non géré** — les indicateurs de `ta.js` valent `null` avant leur
   période. Sans garde (`if (ind.ema[i] == null) return null`), la stratégie
   décide sur du vide au début de chaque run.
3. **Absence de SL** (ou `slPoints: 0`) — plus de mesure en R, plus de risque
   borné, un seul trade peut effacer la série.
4. **Stop d'entrée non ré-armé** — l'ordre expire après une bougie : si la
   stratégie ne le ré-émet pas, elle croit avoir un ordre en attente qui
   n'existe plus.
5. **Flips en série** — signaux opposés à chaque bougie : la position se
   retourne sans cesse, chaque flip paie le spread. Regarder la part de sorties
   `signal` et la durée moyenne des trades.
6. **Paramètres redondants ou inertes** — deux réglages qui contrôlent la même
   chose, ou un paramètre dont le balayage est parfaitement plat : surface de
   surapprentissage gratuite. À signaler comme simplification.
7. **Paramètres en points non calibrés** — un défaut `slPoints: 50` n'a de sens
   que sur l'instrument pour lequel il a été écrit. À signaler si la stratégie
   doit servir sur plusieurs symboles : un SL en **multiple d'ATR** est portable,
   pas un SL en points.
8. **Logique dépendante de l'état** (`state` mutable dans `setup`) — vérifier
   qu'elle est bien réinitialisée et qu'elle ne fuit pas d'une bougie à l'autre
   (revanche ré-armée en boucle, break-even jamais remis à zéro…).

## Lire le profil de sorties

| Profil dominant | Lecture |
|---|---|
| `sl` ≫ `tp` avec espérance positive | normal pour du suivi de tendance (faible winrate, gros gains) |
| `tp` ≫ `sl` avec espérance négative | TP trop serré vs SL : le winrate flatte, le R:R tue |
| `signal` majoritaire | la stratégie sort sur retournement plus que sur ses stops → SL/TP quasi décoratifs, ou flips trop fréquents |
| `timeout` majoritaire | `maxBarsInTrade` coupe les trades avant leur dénouement : réglage à revoir |
| `end` majoritaire | les stops ne sont presque jamais touchés → SL/TP hors d'échelle par rapport à l'ATR |

## Rappels de calibration

- Un SL pertinent se situe généralement entre **0,5× et 3× l'ATR** du timeframe
  de décision (`node bt.mjs probe` donne l'ATR médian). En dessous, le bruit du
  marché le touche ; au-dessus, le R devient énorme et les stats en R illisibles.
- Le TP se raisonne en **multiple du risque** (R:R), jamais en absolu : un R:R
  de 2 exige ~33 % de réussite pour être à l'équilibre, un R:R de 1 en exige
  50 %, un R:R de 3 en exige 25 %. Confronte toujours le winrate observé à ce
  seuil d'équilibre — c'est le test de cohérence le plus rapide d'une stratégie.
