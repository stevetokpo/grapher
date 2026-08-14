# Les types de graphe

Cinq boutons à droite de la barre du graphe. Le choix est retenu dans
`localStorage` (`grapher.chartMode`).

| mode | ce qui est dessiné | série lue par les indicateurs et les motifs |
|---|---|---|
| **Candle** | bougies OHLC | les bougies brutes |
| **Line** | courbe des clôtures, remplissage optionnel | les bougies brutes |
| **Heikin** | bougies Heikin Ashi | **les bougies lissées** |
| **Grouped** | bougies de tendance fusionnées (cf. [grouped-candles.md](grouped-candles.md)) | **les bougies fusionnées** |
| **Footprint** | carnet par niveau de prix, toujours en M1 | — (vue autonome, exige des ticks) |

La troisième colonne est le point important : **la série affichée est la source de
tout le reste**. Indicateurs, motifs, scripts et infobulle lisent les bougies que
le mode a produites, pas les bougies brutes. En Heikin et en Grouped, ce ne sont
donc plus les prix du marché qui sont analysés — c'est voulu (le mode Grouped
existe pour ça), mais un motif d'imbalance n'y détecte plus les mêmes choses. Pour
juger une stratégie, rester en **Candle**.

## Line — la courbe des clôtures

Une seule valeur par bougie : la clôture. Réglable dans **Réglages › Bougies** —
couleur, épaisseur du trait (1 à 4 px), remplissage dégradé sous la courbe.

Côté rendu (`components/charts/TradingChart.js`), la série de bougies **n'est pas
remplacée** : elle est rendue transparente et une série d'aire est ajoutée à côté.
Tout ce qui vit accroché aux bougies — primitives des motifs, lignes de prix des
positions, marqueurs, dessins — continue donc de se dessiner, et l'échelle des prix
reste cadrée sur les mèches. La détruire à chaque bascule de mode obligerait à
ré-attacher une trentaine de choses, pour rien.

## Heikin — les barres moyennes

```
haClose = (open + high + low + close) / 4
haOpen  = (haOpen précédent + haClose précédent) / 2      première : (open + close) / 2
haHigh  = max(high, haOpen, haClose)
haLow   = min(low,  haOpen, haClose)
```

Une bougie source donne une bougie HA : les temps et les volumes sont ceux du
marché, seuls les quatre prix changent (`heikinAshi` dans `lib/candleData.js`, qui
conserve les prix réels sous `src`).

Deux conséquences à connaître :

- **les prix affichés ne sont pas des prix traités.** Un `haOpen` est une moyenne ;
  aucun ordre n'a été rempli à ce niveau. L'étiquette du dernier prix affiche donc
  une valeur différente de celle de l'en-tête, qui est la vraie clôture ;
- **la première bougie de la fenêtre amorce la récurrence sur elle-même.** En
  chargeant de l'historique vers la gauche, les toutes premières bougies HA
  changent légèrement. C'est inhérent au calcul, pas un défaut d'affichage.

Le lissage est le but : les séries de bougies de même couleur ressortent, le bruit
d'une bougie isolée disparaît. C'est un mode de LECTURE de tendance.
