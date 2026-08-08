# Ticker — la vue au tick

Le ticker est le troisième type de graphe de la plateforme, après le graphe
principal (bougies M1 et au-delà) et le footprint. Il répond à une question que
les autres ne peuvent pas traiter : **que s'est-il passé À L'INTÉRIEUR de la
minute** — chaque tick, chaque niveau, chaque écartement du spread.

Page : [`/ticker`](../pages/ticker.js) · bouton **Ticker** dans l'entête.

---

## La chaîne, de bout en bout

```
MT5 ─ GrapherTicker.mq5 ─POST /api/live/ticks─▶ table ticks ─GET /api/ticks─▶ /ticker
       (chaque clôture M1)                       (DuckDB)      (brut ou agrégé)
```

Une seule table, `ticks`, alimente toute la page. Les bougies de 1 s à 1 min ne
sont **pas** stockées : elles sont agrégées à la volée, exactement comme
`/api/bars` agrège les timeframes longs depuis `bars_m1`. Changer de pas de
temps ne reconstruit donc rien, et aucune vue ne peut diverger d'une autre.

## Ce que l'EA fait, et ce qu'il ne fait pas

[`code/mql5/GrapherTicker.mq5`](../code/mql5/GrapherTicker.mq5)

**Il fait** : relever le cache de ticks du terminal toutes les secondes, et
poster le lot de la minute à chaque clôture M1.

**Il ne fait pas** : remonter l'historique. L'expert n'envoie que ce qu'il voit
passer. Ce qui précède son attache n'existera jamais dans la base — c'est un
choix assumé, pas une limite technique (MT5 sait rendre des ticks anciens via
`CopyTicksRange`). Laisser l'EA tourner en permanence est donc la seule façon
d'avoir une couverture continue ; un trou reste un trou.

Deux points méritent d'être connus avant de toucher au code :

**Les ticks ne sont pas lus dans `OnTick()`.** Le terminal regroupe les arrivées
quand l'EA est occupé : `OnTick()` en manquerait, et un graphe qui prétend
montrer chaque tick ne peut pas se le permettre. On lit le cache avec
`CopyTicks()` depuis un curseur en millisecondes, qui rend tout, y compris ce
qui est arrivé pendant que l'EA travaillait.

**Le curseur retient combien de ticks ont été pris à sa milliseconde.**
`CopyTicks(from_msc)` rend les ticks dont `time_msc >= from_msc`, borne
comprise. Sans cette mémoire, les ticks de la frontière reviendraient en double
à chaque relève. Et on ne peut pas simplement avancer le curseur d'une
milliseconde : on sauterait les ticks suivants de cette même milliseconde, qui
sont précisément ce que ce graphe existe pour montrer.

Rien n'est libéré du tampon tant que le serveur n'a pas **recompté** le lot :
serveur injoignable, coupure réseau, recompte court — le lot reste en mémoire et
repart au cycle suivant. Seul un tampon saturé (`InpMaxBuffer`, 2 M de ticks par
défaut) jette des ticks, et il le dit dans le journal.

### Installation

1. Copier le `.mq5` dans `MQL5/Experts` du terminal, compiler (F7).
2. *Outils › Options › Expert Advisors* → cocher « Autoriser WebRequest pour les
   URL listées », y ajouter l'URL du serveur.
3. Attacher l'expert au graphe du symbole, trading algorithmique autorisé.
4. Le premier envoi part à la clôture de la minute en cours (≤ 60 s).

Il peut tourner en même temps que `GrapherFeeder` sur le même symbole (dans un
autre graphe) : les deux alimentent des tables différentes.

## La microseconde qui départage

La clé primaire de `ticks` est `(symbol_id, ts)`. Or plusieurs ticks tombent
couramment dans la même milliseconde sur un symbole liquide. Stockés tels quels,
tous sauf un seraient jetés par le `INSERT OR IGNORE` — et le graphe en perdrait
la moitié **sans le dire**.

DuckDB stocke les `TIMESTAMP` à la microseconde. On se sert de ces trois
chiffres libres comme rang du tick dans sa milliseconde (0…999) :

```
ts = make_timestamp(time_msc × 1000 + rang)
```

L'attribution est déterministe — l'ordre d'arrivée dans le lot — donc un renvoi
à l'identique retombe sur les mêmes horodatages et reste idempotent. Au-delà de
1000 ticks dans une même milliseconde, les surnuméraires sont comptés et
renvoyés dans `collapsed` plutôt que perdus en silence.

Conséquence utile : rien n'a changé pour le reste de la plateforme. Le footprint
et le CVD lisent la même table, leurs `time_bucket` par minute ne voient pas la
différence.

## L'axe du temps en mode tick

`lightweight-charts` veut des abscisses strictement croissantes **en secondes**.
Deux ticks de la même milliseconde ne peuvent donc pas porter leur vraie date.

Le graphe leur attribue un **rang**, et réécrit les étiquettes d'axe et du
curseur depuis l'horodatage réel (`tickMarkFormatter`, `localization.timeFormatter`).
C'est aussi ce qui rend la vue lisible : une seconde agitée peut porter des
centaines de ticks, qui à l'échelle du temps se tasseraient sur une colonne d'un
pixel.

Ce rang est **ancré** : le point d'ancrage garde le rang 0, et les pages plus
anciennes reçoivent des rangs négatifs. Renuméroter à partir de zéro à chaque
page chargée ferait changer d'abscisse tous les points d'un coup, et la vue
sauterait à chaque remontée dans l'histoire.

En mode agrégé (1 s → 1 min), l'abscisse est un vrai epoch : rien de tout cela
ne s'applique.

## Pas de temps et seaux

`tick · 1s · 2s · 5s · 10s · 15s · 20s · 30s · 45s · M1`
([`lib/ticker/resolutions.js`](../lib/ticker/resolutions.js))

Tous les pas divisent 86 400 s, donc les seaux retombent exactement sur minuit
quel que soit le pas — d'où l'arithmétique directe côté SQL, sans avoir à
discuter l'origine de `time_bucket` :

```sql
((epoch_ms(ts) // (N × 1000)) * N)   -- division ENTIÈRE, exacte sur BIGINT
```

## Sources de prix

`Bid · Ask · Mid · Last`. La source choisie décide de ce qui est agrégé en O/H/L/C.

- **Mid** `(bid+ask)/2` est le défaut : c'est la seule source qui ne saute pas
  d'un côté à l'autre du spread, donc la plus honnête pour lire un mouvement.
- **Last** n'existe que sur les instruments qui publient des transactions. Sur
  un indice synthétique, MT5 n'envoie que des cotations : le bouton reste
  visible mais inerte, plutôt que de produire un graphe vide sans explication.
  C'est `/api/ticks/coverage` qui tranche (`hasLast`).

Les lignes dont la source est vide sortent **avant** l'agrégation : sinon elles
créeraient des bougies vides aux mêmes horodatages que les vraies.

## Indicateurs : SMA et swings

Les deux viennent de [`lib/indicators.js`](../lib/indicators.js), le module du
graphe principal — `calcMA` et `calcSwings`, sans copie ni variante. Un swing
doit vouloir dire la même chose partout, sinon deux vues du même marché se
contredisent.

Ces fonctions parlent **bougies** : `{ time, open, high, low, close }`. En mode
agrégé, les lignes en sont déjà. En mode tick, l'effet de données leur en
fabrique dans le même parcours que le tracé : **un tick est une bougie sans
durée**, donc `open = high = low = close = son prix`, et l'abscisse est le rang.

Ce n'est pas un habillage — c'est ce qui leur donne le sens attendu au tick :

- **SMA(20) = moyenne des 20 derniers TICKS**, pas des 20 dernières secondes.
  Sa portée en temps se dilate quand le marché s'endort. C'est la lecture juste
  sur un graphe dont l'abscisse est l'activité et non l'horloge — mais c'est à
  savoir avant de comparer une SMA au tick et une SMA en M1.
- **Swing = tick strictement plus haut (ou plus bas) que ses N voisins de chaque
  côté.** Sur un palier de prix identiques il n'y a aucun pivot, et il n'en est
  signalé aucun. Au tick, 5/5 marque beaucoup ; 8 à 15 se lit mieux.

Les deux se règlent dans le panneau **Indicateurs** de la barre d'outils : les
périodes des moyennes en une ligne (« 20, 50, 200 »), quatre au plus. Ce sont
des réglages qu'on pose puis qu'on oublie — les garder en ligne, c'était six
contrôles à enjamber pour atteindre le seul qu'on touche sans arrêt, le pas de
temps. Rien n'est caché pour autant : le bouton porte le compte de ce qui est
actif, et les courbes s'annoncent elles-mêmes sur l'échelle des prix.

### Le piège qui a coûté une heure

Les séries d'indicateurs sont tenues dans des refs (`maMapRef`, `swingRef`).
React remonte le composant en développement, et **ces refs survivaient au
remontage** : la table croyait ses séries encore vivantes, ne les recréait donc
pas sur le nouveau graphe, et continuait de les alimenter dans le vide. Aucune
erreur, aucune trace dans la console — juste des indicateurs qui ne s'affichent
jamais. Le nettoyage du graphe vide désormais cette comptabilité ; toute
nouvelle série mémorisée dans une ref doit y être ajoutée.

## Zones de support et de résistance

Bouton **Zones** dans la barre : le glissement vertical sur le graphe trace une
bande. Clic sur une zone (hors mode tracé) pour la sélectionner ; `Suppr`
l'efface, `Échap` désélectionne.

### Une bande de prix, pas une boîte

Une zone n'a que deux nombres : `top` et `bottom`. Pas de bornes temporelles, et
c'est délibéré.

Un support est un **prix** auquel le marché a réagi. Sa largeur à l'écran n'est
pas une donnée — elle ne dit rien de plus que « je l'ai tracé ici ». Ce qui
compte est de le revoir quand le prix y revient, donc à **droite**, précisément
là où une boîte fermée s'arrêterait.

Le mode tick tranche définitivement : son abscisse est un rang, pas une date. Un
rang ne survit ni au changement de pas de temps ni au rechargement. Une zone
bornée dans le temps serait donc soit fausse, soit invisible dès qu'on change de
vue — deux façons de perdre le repère qu'on avait pris la peine de poser.

Conséquence directe et vérifiée : une zone tracée au tick reste en place en 5 s,
en M1, et après rechargement.

### Support ou résistance

Ce n'est pas une propriété de la zone, c'est sa position **par rapport au
prix** : sous le marché elle porte, au-dessus elle plafonne. Le sens est donc
deviné à la création (et l'aperçu se colore déjà pendant le tracé), puis
l'utilisateur peut le retourner — un support cassé devient une résistance, et
c'est à lui de dire quand, pas au programme de le redevenir en continu.

Rangées par symbole (`grapher.ticker.zones.<symbolId>`) : un support de l'or n'a
aucun sens sur le BTC.

### Le piège : l'effet de bord dans un updater d'état

La création se faisait d'abord dans le `setDraft(d => …)` du relâchement. React
peut **rejouer un updater** — il le fait systématiquement en développement — et
l'effet de bord partait alors deux fois : deux zones identiques superposées,
invisibles à l'œil, avec un compteur qui affichait le double. Un updater doit
rester une fonction pure ; la création vit maintenant en dehors, et lit le tracé
dans une ref tenue à jour de façon synchrone par les gestionnaires de pointeur.

## FVG et iFVG

Panneau **Indicateurs › Imbalances**. Détection dans
[`lib/ticker/fvg.js`](../lib/ticker/fvg.js), rendu par la même primitive que les
zones tracées mais dans une instance séparée — ce que la machine trouve ne doit
pas se confondre avec ce qu'on a décidé soi-même (cadre en pointillés,
étiquette, et pas de sélection).

**FVG** — trois bougies `a · b · c`. L'impulsion `b` va si vite que les mèches
de `a` et de `c` ne se recouvrent pas :

```
haussier : c.low  > a.high   →  boîte [a.high, c.low]
baissier : c.high < a.low    →  boîte [c.high, a.low]
```

Même inégalité que `lib/xfvg/detect.js` (le gap haussier y vaut `c.low - a.high`) :
deux vues du même marché ne doivent pas se contredire sur la définition du motif.

**iFVG** — un FVG traversé change de camp. Un FVG haussier dont une bougie
**CLÔTURE** sous son bord bas devient une zone de résistance. La clôture et pas
la mèche : une mèche qui dépasse est un test, une clôture est une décision —
prendre la mèche ferait basculer le motif au premier balayage de liquidité,
c'est-à-dire exactement quand il ne faut pas.

Un motif inversé produit **deux boîtes** : le FVG coupé à l'instant de
l'inversion, puis l'iFVG qui prend la suite avec son propre étirement. C'est son
histoire qui se lit sur le graphe.

### Pas au tick

Un FVG est un trou entre deux mèches. Au tick, `open = high = low = close` : la
règle dégénère en « le prix a monté depuis deux ticks », vrai une fois sur deux
et sans aucun sens. La détection ne tourne donc que sur les pas agrégés, et le
panneau le dit au lieu d'afficher zéro motif sans raison apparente.

### Deux plafonds, tous deux pour la LECTURE

- **étirement** (10 bougies par défaut) — au-delà, la zone barre le graphe et
  prétend valoir encore alors que le marché est passé à autre chose. Même
  intention que l'`extLen` du xFVG.
- **garder** (12 motifs) — sans plafond, une centaine de boîtes se recouvrent et
  le graphe ne montre plus rien. On garde les plus récents.

L'étiquette ne s'écrit que si la boîte a la place de la porter : forcée dans un
rectangle trop petit, elle déborde sur ses voisines.

## Volumétrie

Aucune purge : les ticks sont gardés indéfiniment (décision du 04/08/2026).
Compter ~10 à 20 Mo par jour et par symbole liquide, beaucoup moins pour un
synthétique. Si la base devient un problème, le point d'entrée d'une purge
serait un simple `DELETE FROM ticks WHERE ts < …` — `bars_m1` n'en dépend pas.

## Routes

| Route | Rôle |
|---|---|
| `POST /api/live/ticks` | Ingestion depuis l'EA. Acquitte en recomptant la plage du lot. |
| `GET /api/ticks` | Lecture, brute (`res=tick`) ou agrégée. Pagination arrière par curseur. |
| `GET /api/ticks/coverage` | Plage disponible, volumétrie, jours couverts, présence d'un prix de transaction. |

Le curseur de pagination existe en deux unités : `to` en millisecondes, `toUs`
en microsecondes. `toUs` prime, et le mode tick s'en sert : plusieurs points
partagent la même milliseconde, un curseur moins précis rejetterait ou
dupliquerait les voisins de la frontière de page.

## La date épinglée

Le sélecteur « Aller à » du pied de page fige la vue sur un jour. Tant qu'une
date est épinglée, **le suivi en direct est suspendu** — sans cela, chaque
relève ramènerait la vue au présent et rendrait toute exploration du passé
impossible. Le témoin passe de `DIRECT` à `Figé`, un clic rebranche le direct.

## Fraîcheur

Le témoin `DIRECT` mesure l'**arrivée** des données, pas l'écart entre deux
horloges : les horodatages sont en heure broker, dont on ignore le décalage.
« Reçu il y a 12 s » est vrai sans rien supposer. Vert sous 90 s (l'EA poste à
chaque clôture M1), ambre jusqu'à 5 min, rouge au-delà.
