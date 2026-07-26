# Optimisation des sorties rFVG (SL / TP / break-even)

Environnement pour calibrer, **par symbole**, les sorties de la stratégie rFVG en
mode « position » — celle de `calcRFVGPositions` (lib/patterns.js), affichée par
le panneau du graphe et exécutée en live par `mql5/superFVG-EA.mq5` /
`mql5/rFVG-Full-EA.mq5`.

Ce module ne remplace pas `lib/backtest/` : celui-là teste la stratégie
`rfvg-zone` (retest de zone, SL/TP en points ou en ATR, moteur générique). Ici on
teste **l'autre** règle rFVG, celle sans ordre en attente, à stop structurel.

## Ce qui se règle, et ce qui ne se règle pas

| | |
|---|---|
| **Détection** (mode, MM, ATR, gap…) | le **motif**. Figé par l'utilisateur. Le changer ne calibre rien : ça change ce qu'on étudie. |
| **Sorties** (marge du stop, TP, break-even, durée) | ce qui se calibre **par instrument** — un TP de 10 points, c'est deux bougies sur XAUUSD et un frisson sur Volatility 75. |

Le stop **n'est pas une distance** : il est structurel, posé à la clôture de B4
sous/sur l'extrême B3-B4. Seule sa **marge** se règle, et le risque varie du
simple au décuple d'une position à l'autre. C'est pour ça que **tout se compte en
points** (lot fixe) et jamais en R, et que le seuil de rentabilité affiché est
celui *réalisé* — `perte moyenne / (gain moyen + perte moyenne)` — et non un
`1/(1+RR)` qui n'a de sens qu'à risque constant.

## Architecture

```
lib/rfvg/
  simulate.js   simulateur : zones injectées, fills 'bar' ou 'm1', plafond de durée
  stats.js      statistiques et études BE / SL plafonné — SOURCE UNIQUE
                (utilisée aussi par pages/rapports.js et par la page /rfvg)
  data.js       chargement M1 + agrégation + détection, mis en cache
  params.js     schéma des paramètres → formulaire UI ET validation API

pages/api/rfvg/
  run.js        une simulation complète (stats + positions)
  optimize.js   balaye une grille de sorties sur des zones détectées une fois
  probe.js      échelle de l'instrument (risque structurel, signaux, buy & hold)
  configs.js    réglages retenus, table DuckDB rfvg_configs
  cache.js      état / purge du cache mémoire

pages/rfvg.js   page « Réglages rFVG » — un symbole, un réglage, IS/OOS, sauvegarde
scripts/
  rfvg-opt.mjs     CLI : probe / run / sweep / grid / validate / save / configs
  rfvg-parity.mjs  contrôle de parité avec calcRFVGPositions
```

## Les trois décisions de conception

**1. Les zones sont détectées une seule fois.** Optimiser les sorties ne touche
pas la détection : on lit les M1, on agrège, on détecte — puis on rejoue la
grille entière sur le même matériel. Une grille de 50 configurations tourne en
~70 ms, là où elle prendrait plusieurs minutes en relisant 300 000 bougies à
chaque point.

**2. La simulation tourne toujours sur l'historique complet, le fenêtrage se fait
après, sur la date d'entrée.** Deux raisons : le warm-up des MM (200 bougies au
TF choisi) est absorbé d'office ; et `uniqueTrade` / `skipAfterTp` sont des états
**séquentiels** — redémarrer la simulation au bord d'une fenêtre remettrait leurs
compteurs à zéro et fabriquerait des trades que la règle n'aurait jamais pris.

**3. La résolution intra-bougie est un réglage, pas une fatalité** (`fills`).

- `bar` (défaut) — quand le stop et le TP sont touchés dans la même bougie du TF,
  le stop l'emporte. C'est ce que fait le graphe. C'est une **convention
  conservatrice**, pas une mesure.
- `m1` — la même bougie est re-parcourue minute par minute ; l'arbitraire ne
  subsiste que dans la minute de collision.

En live l'EA arbitre au **tick** : le mode bougie sous-estime donc le résultat
réel. `ambiguousExits`, renvoyé par chaque run, dit sur combien de positions la
convention a tranché — c'est la mesure de ce qu'elle coûte. Sur XAUUSD 5m à TP 8
pts : 1 position sur 141. Sur un TP serré ou un TF haut, ce sera davantage.

**Parité garantie par un test, pas par la relecture.** `scripts/rfvg-parity.mjs`
rejoue 13 configurations (chaque branche de la machine à états : les trois
break-even, leurs cumuls, le trade unique, le cooldown, les trois modes de
détection) et compare position par position `simulatePositions(fills:'bar')` à
`calcRFVGPositions`. Vérifié identique sur XAUUSD 5m et Volatility 75 15m. Le
jour où les deux divergeront, on le saura par ce script — pas six semaines plus
tard, par un écart de résultats inexpliqué.

## Ce que le simulateur ajoute à la règle en production

`maxBars` — plafond de durée de vie. Sans lui, une position qui n'atteint ni son
stop ni son TP reste ouverte jusqu'au bord des données (statut `open`) et ne
compte nulle part. Avec, elle est soldée à la clôture de la Nième bougie (statut
`timeout`). **C'est une évolution proposée, absente de l'EA MT5** : si un réglage
retenu l'utilise, l'EA doit être modifié avant de le trader.

## Méthode

Reprend celle du skill `backtest-optimizer` (`.claude/skills/`), adaptée au
comptage en points.

1. **Sonder** (`probe`) — le TP se raisonne en multiples du **risque structurel
   médian**, pas dans l'absolu. La sonde donne aussi le nombre de signaux (le
   budget de liberté : ~30 positions par paramètre réglé) et le **buy & hold** de
   la fenêtre, repère indispensable sur les indices synthétiques à dérive.
2. **Portillon** — moins de 30 positions : non concluant, on s'arrête.
   `⚠ CLAMPED` : on ne testait pas ce qu'on croyait. Trop de sorties `open` :
   les stops sont mal dimensionnés.
3. **Balayage 1D** (`sweep`) — trier les paramètres **influents** des plats. Un
   paramètre plat se laisse au défaut : le régler n'ajoute que du
   surapprentissage.
4. **Grille 2D** (`grid`) — seulement sur les 2–3 paramètres couplés. Le TP et le
   seuil de break-even en sont : le second n'a de sens qu'en fraction du premier.
   **Retenir un plateau, jamais un pic** — un candidat n'est gardé que si ses
   voisins immédiats gardent une espérance positive et un score ≥ ~60 % du sien.
5. **Validation** (`validate`) — IS/OOS, spread ×2 et ×3, TF voisins, les deux
   directions, les deux modes de fills, puis diagnostic. C'est la **seule**
   commande qui ouvre l'out-of-sample : `sweep` et `grid` le refusent.
6. **Enregistrer** (`save`, ou le bouton de la page) — la ligne en base porte les
   métriques IS **et** OOS qui ont justifié la décision. Sans elles, un statut
   « validé » n'est qu'une opinion.

Le score de classement est la **t-statistique** `espérance / écart-type × √n` :
l'espérance rapportée à sa volatilité *et* à la taille d'échantillon. Jamais le
winrate (un TP serré donne 80 % de réussite et une espérance négative), jamais le
total en points (dominé par les coups de chance et par la dérive de
l'instrument).

## Utilisation

```bash
# Serveur dev requis (npm run dev)
node scripts/rfvg-parity.mjs                     # d'abord : la parité tient-elle ?
node scripts/rfvg-opt.mjs symbols
node scripts/rfvg-opt.mjs probe    XAUUSD        # l'échelle, avant toute grille
node scripts/rfvg-opt.mjs run      XAUUSD --first 100
node scripts/rfvg-opt.mjs sweep    XAUUSD --param tpPts --values 3:24:3
node scripts/rfvg-opt.mjs grid     XAUUSD --param tpPts --values 4:20:4 \
                                          --param2 beTriggerPts --values2 0:6:2
node scripts/rfvg-opt.mjs validate XAUUSD -p tpPts=12 -p beTriggerPts=5
node scripts/rfvg-opt.mjs save     XAUUSD -p tpPts=12 --status validated
node scripts/rfvg-opt.mjs configs
```

La mission (timeframe, détection figée, spread et sorties de départ par symbole)
vit dans `backtests/rfvg-mission.json`. Chaque run est journalisé dans
`backtests/rfvg-ledger.jsonl`.

La page **/rfvg** (bouton « rFVG » du graphe) fait le même travail à l'unité :
sonder, simuler sur les trois fenêtres, lire les deux études, enregistrer. Les
balayages restent en ligne de commande — ils produisent des centaines de
configurations qu'aucun formulaire ne rend lisibles.

## Limites connues

- Les deux études (break-even, SL plafonné) sont des **bornes** construites sur
  les excursions globales de chaque position : l'ordre intra-vie est inconnu à la
  granularité bougie. Un seuil qui en sort doit être **rejoué en simulation
  complète** avant d'être retenu.
- Le spread est un coût fixe par position, pas un modèle bid/ask.
- Pas de sizing en capital : tout est en points, à lot fixe.
- La détection n'est pas balayée. C'est délibéré (budget de liberté), mais ça
  veut dire que l'optimiseur ne dira jamais « ton motif est mal réglé ».
- Le cache tient 2 symboles en mémoire (~200 Mo chacun). `DELETE /api/rfvg/cache`
  le vide sans redémarrer le serveur.
