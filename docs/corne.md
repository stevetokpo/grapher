# La corne — une figure du RSI, et l'atelier pour la décrire

La corne est le premier motif de la plateforme qui ne se lit **pas** dans les
bougies. C'est une forme du RSI (période 7) :

> le trait met beaucoup de temps à monter — une courbe lente, qui traîne —, fait
> une **pointe**, puis s'effondre en une ou deux bougies jusqu'à repasser sous
> des valeurs qu'il avait des dizaines de bougies plus tôt.

La **corne inversée** est l'image miroir : descente lente, creux pointu,
remontée brutale.

```
RSI      ╱‾╲                    ← la pointe
        ╱   ╲
     ╱‾╯     ╲
   ╱‾         ╲__________       ← une bougie efface vingt bougies de montée
 ╱
```

Le problème que pose ce motif : on le reconnaît à l'œil bien avant de savoir
l'écrire. Toute la chaîne ci-dessous existe pour transformer « ça ressemble à
une corne » en seuils défendables — et pour qu'on puisse montrer POURQUOI une
figure est retenue ou non.

---

## Les deux moitiés

```
   /rsi  —  LE LABORATOIRE                      graphe principal — LE MOTIF
   ┌──────────────────────────┐                 ┌──────────────────────────┐
   │ survoler → lire          │                 │ Patterns → corne         │
   │ marquer  → data/…json    │  les mêmes      │ repère « CO » sur la     │
   │ comparer → quels ratios  │──mesures───────▶│ bougie où la chute est   │
   │ régler   → seuils        │                 │ accomplie                │
   └──────────────────────────┘                 └──────────────────────────┘
              lib/rsi/features.js  ←── une seule implémentation des mesures
```

Une seule implémentation des mesures, dans
[`lib/rsi/features.js`](../lib/rsi/features.js). Ce que le laboratoire affiche
et ce que le graphe marque ne peuvent donc pas dire deux choses différentes.

---

## Ce qu'on mesure

Le RSI est d'abord découpé en **jambes** par un zigzag : une pointe n'existe que
si le trait s'en écarte ensuite d'au moins `minAmp` points (8 par défaut — sur un
RSI 7, un repli de 4 points est la respiration ordinaire du trait). Chaque pointe
donne alors une fiche :

| mesure | ce qu'elle dit |
|---|---|
| `riseBars` / `riseAmp` | la jambe lente : sa durée, sa hauteur |
| `riseEff` | régularité de la montée : 1 = trait droit, 0,5 = le trait a hésité |
| `dropBars` / `dropAmp` | la jambe brutale |
| `sharpness` | **la pointe** : pente de chute ÷ pente de montée |
| `rewindBars` | **le rembobinage** : combien de bougies passées la chute efface |
| `rewindPerBar` | … rapporté à chaque bougie de chute |
| `retrace` | part de la montée rendue (1 = tout, > 1 = la chute va plus bas que le creux de départ) |
| `firstShare` | part de la chute faite dès la première bougie |
| `tipFlat` | bougies collées au sommet — une pointe en a peu, un plateau beaucoup |

`sharpness` et `rewindPerBar` sont les deux qui traduisent le mieux la
description d'origine. Les seuils par défaut sont dans `HORN_RULES`
(`lib/rsi/features.js`) et `DETECT_DEFAULTS`
([`lib/corne/params.js`](../lib/corne/params.js)) — **ce sont des valeurs de
départ**, pas un verdict.

---

## Le laboratoire — page `/rsi`

Bouton **RSI** dans l'entête. La boucle de travail :

1. **régler** le RSI (7) et le zigzag ;
2. **survoler** une pointe : ses mesures s'affichent et ses deux jambes se
   surlignent — si le découpage est faux, ça se voit tout de suite ;
3. **marquer** (mode *Marquer*) les vraies cornes d'un clic, et surtout des
   **contre-exemples** : sans eux, n'importe quel jeu de seuils qui attrape les
   exemples semble parfait ;
4. lire la **Comparaison** dans le panneau : une mesure dont les colonnes
   *corne* / *non* / *toutes* se ressemblent ne reconnaît rien ;
5. poser les seuils dans la barre et regarder les candidats s'allumer.

Le clic est **aimanté** sur la pointe la plus proche : on marque une pointe, pas
une bougie. Et il ne fait pas confiance au navigateur — le serveur recharge
l'historique complet, recalcule RSI et zigzag, et c'est cette mesure-là qui est
écrite.

### Le cahier d'échantillons

`data/rsi-samples.json`. Chaque échantillon est **autonome** : il embarque la
fenêtre de bougies (90 avant, 45 après) et les valeurs du RSI en face. On peut
donc rejouer une mesure, en inventer une nouvelle, ou tout recalculer six mois
plus tard sans la base.

```json
{ "id": "9-15m-7-1784016000", "label": "oui", "side": "bull",
  "symbolId": 9, "tf": "15m", "period": 7, "minAmp": 8,
  "peak": 90, "features": { "riseBars": 11, "dropBars": 2, "sharpness": 4.3, … },
  "bars": [ { "t": …, "o": …, "h": …, "l": …, "c": … } ],
  "rsi":  [ 62.44, 49.86, … ] }
```

---

## Le rapport hors ligne

```
npm run rsi-lab              # rapport complet
npm run rsi-lab -- --json    # même chose, pour un autre outil
```

[`scripts/rsi-lab.mjs`](../scripts/rsi-lab.mjs) répond à la seule question qui
compte : **quelle mesure sépare vraiment les cornes du reste des pointes ?**

Une mesure ne vaut que par ce qu'elle élimine. Le tableau du **pouvoir de coupe**
pose, pour chaque mesure, le seuil qui garde 90 % des exemples marqués, et
regarde combien de pointes ordinaires ce seuil élimine au passage :

```
  │ mesure                     seuil     élimine  des contre-ex.
  │ POINTE (× pente)          ≥ 4.30     97% ██████████
  │ montée (bougies)         ≥ 11.00     97% ██████████
  │ rembobinage / bougie      ≥ 5.00     70% ███████
  │ plateau au sommet         ≤ 2.00      1%
```

Ce qui coupe beaucoup est un critère ; ce qui coupe peu est un ornement. Le
script termine par un jeu de seuils proposé, et par ce qu'il donne : cornes
retrouvées, contre-exemples rejetés, et **fréquence** (une corne toutes les N
bougies) — le chiffre qui dit tout de suite si les seuils décrivent une figure
rare ou une banalité.

Serveur dev requis pour la population témoin ; sans lui le rapport tourne quand
même, amputé de sa colonne « toutes les pointes », et le dit.

---

## Le motif sur le graphe principal

**Patterns → corne**. Repère `CO` sur la bougie, flèche vers le bas pour une
corne (signal baissier), vers le haut pour une inversée. Un repère, pas de zone
ni de position — tant qu'on n'a pas dit ce que la figure désigne comme prix à
jouer, en inventer un serait inventer le motif.

### Où se pose le repère, et pourquoi pas sur la pointe

Au sommet, il n'y a qu'une montée qui s'arrête ; rien ne dit qu'elle va
s'effondrer plutôt que continuer. La corne n'existe qu'une fois la chute
accomplie, et c'est là que le repère se pose : à la première bougie où les
mesures franchissent les seuils, au plus tard `maxDropBars` bougies après la
pointe. Un repère posé sur la pointe serait un repère qui apparaît **dans le
passé** — joli sur l'historique, invisible en direct.

`maxDropBars` est donc aussi le **délai de détection** : à 2, la figure est
signalée au plus tard deux bougies après la pointe, ou pas du tout.

Le détecteur ne consulte jamais l'avenir : la pointe doit être acquise
(`confirmIdx ≤ bougie courante`) et la chute est mesurée à la bougie où elle en
est, sans attendre le pivot suivant du zigzag — qui, lui, n'existe qu'après.
C'est ce que fait `measureLegs`, et c'est pour ça que la fonction existe.

---

## Les routes

| route | ce qu'elle rend |
|---|---|
| `GET /api/rsi/series?symbolId=&tf=&period=&limit=&format=csv` | la série RSI + les bougies, sur tout l'historique ou une fenêtre |
| `GET /api/rsi/scan?symbolId=&tf=&period=&…seuils` | toutes les pointes **mesurées après coup** — retenues ET refusées, avec les critères qui ont sauté |
| `GET/POST/DELETE /api/rsi/samples` | le cahier d'échantillons |
| `GET /api/rsi/corne?symbolId=&tf=&…réglages` | le motif **tel que le graphe le marque**, joué sur tout l'historique |

`scan` et `corne` ne rendent pas le même compte, et c'est normal : `scan` est la
vue du laboratoire (rétrospective, appuyée sur le pivot suivant), `corne` est la
détection en direct. **La seule qui ait le droit d'être tradée est `corne`.**

---

## Ce qui reste à faire

Les seuils par défaut n'ont encore été confrontés à **aucun** exemple marqué :
ils viennent de la description du motif et d'un coup d'œil aux mesures sur
BTCUSD 15m (1 corne toutes les ~300 bougies). Tant que le cahier est vide, ce
sont des paramètres, pas une connaissance.

La marche à suivre : marquer une trentaine de cornes et autant de
contre-exemples sur le symbole et l'unité de temps qui comptent, lancer
`npm run rsi-lab`, reporter les seuils. Et seulement après, se demander si la
figure annonce quelque chose — ce que ni le laboratoire ni le repère ne
prétendent pour l'instant.
