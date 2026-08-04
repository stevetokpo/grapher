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

Le simulateur, les statistiques, le cache et le schéma des sorties ne sont plus
propres au rFVG : ils sont **partagés** avec les autres motifs à stop structurel
(le KO — cf. `docs/ko-optimisation.md`). `lib/rfvg/*` ne garde que la détection et
les noms d'origine ; ce qu'il calcule n'a pas bougé d'un pouce, et
`scripts/rfvg-parity.mjs` le vérifie toujours cas par cas.

```
lib/signals/    NOYAU COMMUN
  engine.js     simulateur : signaux injectés, fills 'bar' ou 'm1', plafond de durée
  stats.js      statistiques et études BE / SL plafonné — SOURCE UNIQUE
                (utilisée aussi par pages/rapports.js et par la page /rfvg)
  data.js       chargement M1 + agrégation + détection, mis en cache
  params.js     schéma des SORTIES → formulaire UI ET validation API
  probe.js      échelle de l'instrument

lib/rfvg/
  simulate.js   détection rFVG + branchement sur le moteur commun
  params.js     schéma de DÉTECTION du rFVG
  data.js, stats.js   points d'entrée historiques (réexports)

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
rejoue 40 configurations (chaque branche de la machine à états : les quatre
break-even, leurs cumuls, le trade unique, le cooldown, le SL plafonné, le dû
sous ses deux modes, les trois modes de détection) et compare position par
position `simulatePositions(fills:'bar')` à `calcRFVGPositions`, compteurs de lot
compris. Vérifié identique sur XAUUSD 5m et Volatility 75 15m. Le
jour où les deux divergeront, on le saura par ce script — pas six semaines plus
tard, par un écart de résultats inexpliqué.

## Ce que le simulateur ajoute à la règle en production

`beSwingBars` — **break-even sur swing**. Les trois autres break-even posent le
stop à un niveau lié à l'**entrée** (entrée ± `beLevelPts`) ; celui-là le pose sur
la **structure**. Dès le premier swing formé pendant la position — swing bas en
BUY, swing haut en SELL, extrême strictement au-delà des `beSwingBars` bougies de
chaque côté (2 = « 2 avant, 2 après », la définition de l'indicateur SWING) — le
stop passe sous ce swing bas − `slMarginPts`, ou sur ce swing haut + `slMarginPts`
(la marge du stop structurel, pas `beLevelPts`).

Trois propriétés à garder en tête pour l'interpréter :

- **Le swing n'est connu qu'à la clôture de la `beSwingBars`-ième bougie qui suit
  le pivot** — c'est cette bougie-là qui arme le déplacement, jamais le pivot.
  Sans ce décalage, le réglage lirait l'avenir et tous ses résultats seraient
  faux. Corollaire utile : la bougie qui arme appartient à la fenêtre droite du
  swing, son extrême est donc au-delà du pivot — le stop déplacé ne peut pas être
  touché sur elle.
- **Un seul déplacement.** Profit, durée et swing partagent le même mouvement :
  le premier armé pose le stop, les autres ne le rejouent pas. Ce n'est pas un
  stop suiveur — le stop ne monte pas de swing en swing.
- **Il ne peut que resserrer.** Un swing plus lâche que le stop structurel arme
  le déclencheur (`beReason: 'swing'`) sans rien déplacer. Plus `beSwingBars` est
  grand, plus le swing est rare et tardif : à 4/4 une bonne partie des positions
  se résout avant qu'un seul pivot soit confirmé.

**Absent de l'EA MT5** (`superFVG-EA.mq5`, `rFVG-Full-EA.mq5`) : si un réglage
retenu l'utilise, l'EA doit être modifié avant de le trader.

`beTouchTrigger` — **coupe sur retours à l'entrée**. Le seul déclencheur qui ne
déplace rien : dès que le prix est revenu N fois sur l'entrée (une bougie dont
l'amplitude contient le niveau compte pour un retour, B4 exclue), la position est
**soldée au prix d'entrée** sur cette bougie — statut `be`, gain brut nul,
`cutAtEntry: true`. C'est un abandon, pas une protection : on constate que le
motif n'a pas travaillé et on rend la place, en payant le spread. Le compte se
fait à la clôture de la bougie du TF, **même en `fills: 'm1'`** (il compte des
bougies, pas des minutes), et après le stop et le TP : une bougie qui repasse par
l'entrée et atteint le TP part au TP. Conséquence sur les statistiques : ces
positions quittent la population TP/SL, donc le winrate et les deux études du bas
de page ne portent plus que sur celles qui sont allées au bout. **Absent de l'EA
MT5** lui aussi.

`dueAfterSl` / `dueMode` — **le dû : rembourser avant de gagner**. Toute position
clôturée dans le rouge laisse sa perte **nette** sur une ardoise ; tout gain la
rembourse en commençant par la plus **ancienne**, et ce qu'il ne couvre pas
entièrement reste dû à hauteur du reliquat. Dès que l'ardoise compte
`dueAfterSl` pertes, la position suivante vise le **remboursement** au lieu de son
vrai TP — même s'il tombe plus **près** que son objectif normal, parce que
rembourser passe avant. `dueMode: 'full'` vise l'ardoise entière (elle s'éloigne à
mesure qu'elle grossit, et un objectif hors d'atteinte ne rembourse rien) ;
`'step'` vise un bond de `dueAfterSl` × la perte moyenne encore due, soit la
taille exacte de ce qui a armé le dû — on rembourse alors en plusieurs fois,
chacune atteignable. L'arithmétique vit dans `lib/dueLedger.js`, partagée mot pour
mot avec la famille liq / rev / Twins Bars : « seuil 8 » veut dire la même chose
d'un motif à l'autre.

Quatre propriétés à garder en tête pour l'interpréter :

- **« Perte » se juge au net, pas au statut.** Une sortie au break-even qui finit
  sous zéro (le spread) compte dans le seuil comme un SL.
- **Avec un spread, rembourser ne solde jamais tout à fait** : le gain qui atteint
  le dû paie lui aussi son aller-retour, et il reste exactement un spread sur
  l'ardoise. C'est honnête — cet argent-là n'a pas été récupéré.
- **Anti-anticipation.** Une sortie ne pèse sur le dû d'une entrée que si elle a eu
  lieu avant la bougie de cette entrée. Sans `uniqueTrade` les positions se
  chevauchent, donc le dû lu peut être plus petit que l'ardoise réelle au même
  instant : c'est le prix de ne pas remonter le temps.
- **Le break-even n'est pas touché.** Ses quatre déclencheurs s'arment aux mêmes
  distances que sur une position ordinaire, et en unité `pct` le seuil et le
  niveau restent un pourcentage du **TP normal**, jamais de l'objectif de
  remboursement. Sinon une longue série de pertes désarmerait le break-even au
  moment précis où il sert le plus. Le dû déplace la cible, pas la protection.

`dueArmed`, `dueRemainingPts` et `dueRemainingSl` (méta de chaque run) disent
combien de positions sont parties rembourser et ce qui restait sur l'ardoise au
bord des données — un reste qui ne descend jamais dit que le seuil est trop haut,
ou que le motif ne rembourse pas. **Absent de l'EA MT5**.

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
- Le spread est un coût fixe par position, pas un modèle bid/ask : il est déduit
  du résultat, il ne décale pas les niveaux, donc il ne peut pas déclencher un
  stop qu'il aurait touché en réel. Il est appliqué par le **simulateur**, sur
  chaque position **clôturée** : `profitPoints` reste le brut, `netPoints` est ce
  qu'on encaisse, et c'est le net qui alimente les statistiques. Une position
  encore ouverte au bord des données ne le paie pas.
- Pas de sizing en capital : tout est en points, à lot fixe.
- La détection n'est pas balayée. C'est délibéré (budget de liberté), mais ça
  veut dire que l'optimiseur ne dira jamais « ton motif est mal réglé ». Le KO,
  lui, l'autorise, avec un budget de liberté compté et un contrôle par décalage
  obligatoire (`docs/ko-optimisation.md`).
- `minTrades` ne marque rien quand il n'est pas transmis : `/api/rfvg/optimize`
  fait `Number(b.minTrades) ?? 0`, or `Number(undefined)` vaut `NaN` et `n < NaN`
  est toujours faux. Le CLI le transmet toujours, donc le défaut n'a jamais
  mordu ; `/api/ko/optimize` utilise `|| 0`.
- Le cache tient 2 symboles en mémoire (~200 Mo chacun). Il est maintenant
  COMMUN à tous les motifs : `DELETE /api/rfvg/cache` (ou `/api/ko/cache`) le
  vide sans redémarrer le serveur.
