# Le motif KO — détection, positions, optimisation

Deuxième motif de la famille « impulsion à contre-courant + stop structurel »,
après le rFVG. Il tient en **deux bougies** et ne se lit pas dans un gap : il se
lit dans la **forme** des bougies.

## Le motif

| | |
|---|---|
| **B1** — l'impulsion | Bougie **pleine** : corps ≥ `atrMult1` × ATR **et** corps / amplitude ≥ `bodyRatio1`. Entièrement du côté **opposé à son sens** par rapport aux **deux** MM, mèches comprises : haussière avec son plus haut sous les deux MM → KO **haussier** ; baissière avec son plus bas au-dessus des deux → KO **baissier**. |
| **B2** — la respiration | Petite **et** indécise : corps ≤ `atrMult2` × ATR **et** corps / amplitude ≤ `bodyRatio2`. **Son sens n'entre pas dans le motif.** Aucune contrainte de position vis-à-vis des MM. |
| **B3** — l'entrée | Ouverture de la bougie suivante, **au marché**. Pas d'ordre en attente, donc jamais de position ratée. |

Défauts : `atrMult1 = 1.3`, `bodyRatio1 = 0.9`, `atrMult2 = 0.3`,
`bodyRatio2 = 0.3`, MM 15 et 200, ATR(14).

**Un seul ATR de référence, lu AVANT B1**, pour les deux bougies. Le faire courir
jusqu'à B1 relâcherait le filtre de B2 d'environ 2 % — B1 étant par construction
≥ 1,3 × ATR, elle tire l'ATR de Wilder vers le haut — et « ATR » cesserait de
désigner une seule chose dans le motif.

**Le stop est structurel**, posé à la **clôture de B3** sous/sur l'extrême
**B2–B3** (+ marge) : `min(bas B2, bas B3) − marge` en BUY,
`max(haut B2, haut B3) + marge` en SELL. **B1 n'entre pas dans le stop** — c'est
ce qui rend le risque petit et l'invalidation nette. Pendant toute B3 la position
est non protégée, seul le TP est actif ; le stop étant construit sous l'extrême de
B3, il ne peut pas y être touché.

Le risque varie donc d'une position à l'autre : **tout se compte en points**, à
lot fixe, jamais en R, et le seuil de rentabilité affiché est celui *réalisé*
(`perte moyenne / (gain moyen + perte moyenne)`), pas un `1/(1+RR)` qui n'a de
sens qu'à risque constant.

## Architecture — ce que le KO n'a pas eu à réécrire

```
lib/signals/          NOYAU COMMUN à tous les motifs à stop structurel
  engine.js           moteur de sorties : SL structurel, TP, 4 break-even,
                      fills 'bar' | 'm1', plafond de durée, cooldown, trade unique
  stats.js            statistiques et études BE / SL plafonné — SOURCE UNIQUE
  params.js           schéma des SORTIES + grilles (expandValues, cartesian)
  data.js             cache M1 / TF (partagé) + cache de signaux (par motif)
  probe.js            échelle de l'instrument (risque, spread, buy & hold)

lib/ko/
  params.js           schéma de DÉTECTION du KO
  pattern.js          défauts, descripteur, chargement des signaux
lib/patterns.js       calcKO (détection) et calcKOPositions (3 lignes : le moteur)

pages/api/ko/         run · optimize · probe · null · configs · cache
pages/ko.js           page « Réglages KO »
scripts/ko-opt.mjs    CLI : probe / run / blocks / sweep / grid / control /
                      validate / save / configs
```

Le KO n'apporte que **sa détection**. C'est la différence de fond avec le rFVG,
qui porte deux implémentations de la même règle de sortie — `calcRFVGPositions`
pour le graphe, `simulatePositions` pour le serveur — tenues alignées par
`scripts/rfvg-parity.mjs`. Ici le graphe, la page, l'optimiseur et les API
appellent **le même code** : il n'y a pas de parité à vérifier, donc rien qui
puisse diverger. (Le rFVG a été rebranché sur ce noyau sans changer d'un pouce ce
qu'il calcule : `node scripts/rfvg-parity.mjs` passe toujours ses 18 cas.)

Conséquence directe pour la lecture des résultats : **les deux motifs sont mesurés
avec exactement la même règle de gestion**. Un écart entre eux vient du motif, pas
de la sortie.

## Ce que le KO fait et que le rFVG ne fait pas

**La détection est balayable.** Le rFVG l'interdit à dessein : le motif est celui
de l'utilisateur, pas une variable libre. Mais les seuils du KO sont neufs —
personne ne sait si 1,3 × ATR et 90 % tombent au bon endroit — et les figer sans
les avoir mesurés reviendrait à optimiser les sorties autour d'une supposition.
Trois garde-fous rendent ça tenable :

1. **Le budget de liberté est compté et rendu.** `/api/ko/optimize` renvoie un
   bloc `freedom` : combien de paramètres sont réglés, combien de positions il en
   faudrait (~30 par paramètre), et si le compte y est. La sonde et la page /ko
   affichent le même chiffre. Ce n'est pas bloquant — c'est un chiffre qu'on ne
   peut plus dire ne pas avoir vu. Un seuil de détection consomme le **même**
   budget qu'un TP.
2. **La détection est refaite une fois par combinaison, pas une fois par
   configuration.** La boucle de détection est à l'extérieur, les sorties à
   l'intérieur : une grille 4 × 5 tourne en 4 détections, pas 20.
3. **Le contrôle par décalage est obligatoire.** `/api/ko/null` rejoue les mêmes
   signaux — même nombre, même répartition, mêmes proportions — à des dates
   d'entrée décalées en circulaire. `validate` le lance d'office, `save
   --status validated` **refuse** un p > 0,05 (sauf `--force`), et le verdict est
   stocké avec le réglage (colonne `null_check`). Quand la détection est
   balayable, le nombre d'essais explose : sans ce contrôle, « validé » ne veut
   rien dire.

Trois autres différences, plus petites :

- **`sweep` affiche la colonne « signaux ».** Sur un seuil de détection elle
  compte autant que le t : un seuil qui ne laisse passer que 40 motifs a l'air
  brillant parce qu'il est rare.
- **`validate` teste le voisinage du motif** (`atrMult1 ± 0,2`) et signale la
  falaise : un motif dont les seuils sont au bord d'un précipice n'est pas un
  motif, c'est un filtre calé sur l'historique.
- **Le plancher d'échantillon fonctionne.** `/api/rfvg/optimize` fait
  `Number(b.minTrades) ?? 0`, qui vaut `NaN` quand le champ est absent — et
  `n < NaN` étant toujours faux, le marqueur `thin` ne marquait jamais rien.
  `/api/ko/optimize` utilise `|| 0`.

## Méthode

Reprend celle du skill `backtest-optimizer`, adaptée au comptage en points.

1. **Sonder** (`probe`) — le TP se raisonne en multiples du **risque structurel
   médian**, pas dans l'absolu. La sonde donne aussi le nombre de signaux (donc
   le budget de liberté), le spread réellement écrit par le broker, et le **buy &
   hold** de la fenêtre, repère indispensable sur les indices synthétiques à
   dérive.
2. **Portillon** — moins de 30 positions : non concluant, on s'arrête.
   `⚠ CLAMPED` : on ne testait pas ce qu'on croyait. Trop de sorties `open` : les
   stops sont mal dimensionnés.
3. **Balayage 1D** (`sweep`) — trier les paramètres **influents** des plats. Un
   paramètre plat se laisse au défaut : le régler n'ajoute que du
   surapprentissage. Commencer par les sorties ; ne toucher à la détection que si
   le budget de liberté le permet encore.
4. **Grille 2D** (`grid`) — seulement sur les paramètres **couplés** : TP et seuil
   de break-even (le second n'a de sens qu'en fraction du premier), `atrMult1` et
   `bodyRatio1` (ils décrivent la même bougie). **Retenir un plateau, jamais un
   pic.**
5. **Contrôle** (`control`) — le motif sort-il de son propre nuage ? Si non, tout
   ce qui précède mesure la géométrie du stop et du TP sur cet instrument.
6. **Validation** (`validate`) — IS/OOS, spread ×2 et ×3, TF voisins, les deux
   directions, les deux modes de fills, voisinage du motif, contrôle par
   décalage, puis diagnostic. C'est la **seule** commande qui ouvre
   l'out-of-sample : `sweep` et `grid` le refusent.
7. **Enregistrer** (`save`, ou le bouton de la page) — la ligne en base porte les
   métriques IS **et** OOS **et** le verdict du contrôle.

Le score de classement est la **t-statistique** `espérance / écart-type × √n`.
Jamais le winrate (un TP serré donne 80 % de réussite et une espérance négative),
jamais le total en points (dominé par les coups de chance et par la dérive de
l'instrument).

## Utilisation

```bash
# Serveur dev requis (npm run dev)
node scripts/ko-opt.mjs symbols
node scripts/ko-opt.mjs probe    XAUUSD                 # l'échelle, avant toute grille
node scripts/ko-opt.mjs run      XAUUSD --first 100
node scripts/ko-opt.mjs blocks   XAUUSD --size 100      # tous les blocs de 100 trades
node scripts/ko-opt.mjs sweep    XAUUSD --param  tpPts    --values 4:40:4
node scripts/ko-opt.mjs sweep    XAUUSD --detect atrMult1 --values 0.8:2:0.2
node scripts/ko-opt.mjs grid     XAUUSD --detect atrMult1 --values 1:1.6:0.2 \
                                        --param2 tpPts    --values2 50:250:50
node scripts/ko-opt.mjs control  XAUUSD --window full --draws 60
node scripts/ko-opt.mjs validate XAUUSD
node scripts/ko-opt.mjs save     XAUUSD --status validated
node scripts/ko-opt.mjs configs
```

`-p cle=valeur` surcharge une **sortie**, `-d cle=valeur` la **détection**. La
mission (timeframe, motif de départ, spread et sorties par symbole) vit dans
`backtests/ko-mission.json` ; chaque run est journalisé dans
`backtests/ko-ledger.jsonl`.

La page **/ko** (bouton « KO » du graphe) fait le même travail à l'unité : sonder,
simuler sur les trois fenêtres, contrôler par décalage, lire les deux études,
enregistrer. Les balayages restent en ligne de commande — ils produisent des
centaines de configurations qu'aucun formulaire ne rend lisibles.

Sur le graphe, le motif s'active dans le panneau des patterns (« KO »), en
représentation **zone** (la boîte encadre B1–B2), **position** (entrée, SL, TP,
issue) ou les deux. Le moniteur et le bouton « KO » du rapport JSON n'apparaissent
qu'en représentation position.

## Densité observée du motif (réglages par défaut, in-sample)

| symbole | 1m | 5m |
|---|---|---|
| Volatility 75 Index | 161 signaux (1,1/j) | 26 |
| Volatility 15 (1s) Index | 150 | 11 |
| Step Index | 113 | 17 |
| XAUUSD | 81 | 9 |

Le motif est **rare** : la conjonction « corps ≥ 1,3 × ATR » **et** « corps ≥ 90 %
de l'amplitude » élimine à elle seule l'essentiel des candidats (sur XAUUSD 5m :
55 signaux sans le filtre de taille, 31 sans le filtre de plénitude, 9 avec les
deux). En pratique, **le 1m est le seul timeframe qui donne un échantillon
exploitable** avec ces seuils ; en 5m et au-delà, il faut les desserrer — et donc
les balayer, budget de liberté en main.

## Limites connues

- Les deux études (break-even, SL plafonné) sont des **bornes** construites sur
  les excursions globales de chaque position : l'ordre intra-vie est inconnu à la
  granularité bougie. Un seuil qui en sort doit être **rejoué en simulation
  complète** avant d'être retenu.
- Le spread est un coût fixe par position, pas un modèle bid/ask : il est déduit
  du résultat, il ne décale pas les niveaux, donc il ne peut pas déclencher un
  stop qu'il aurait touché en réel. Il est appliqué par le **simulateur**, sur
  chaque position **clôturée** : `profitPoints` reste le brut, `netPoints` est ce
  qu'on encaisse, et c'est le net qui alimente les statistiques. Une position
  encore ouverte au bord des données ne le paie pas.
- Pas de sizing en capital : tout est en points, à lot fixe.
- Le contrôle par décalage ne casse **ni** la saisonnalité intra-journalière **ni**
  l'autocorrélation de la volatilité. C'est délibéré : ce sont précisément les
  effets qu'on ne veut pas confondre avec le motif.
- `beSwingBars`, `beTouchTrigger` et `maxBars` sont des **évolutions** du moteur, absentes des EA
  MT5. Un réglage retenu qui s'en sert demande de modifier l'EA avant d'être tradé.
- Aucun portage MT5/Pine du KO pour l'instant.
