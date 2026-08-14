# $$$ — le motif, ses termes, ses règles

Taillé dans le rFVG le 06/08/2026. Glossaire et logique, sans détour.
Code : `lib/dollars/` · gestion partagée : `lib/patternPositions.js` ·
auto-contrôle : `npm run dollars-test`.

---

## 1. La figure

**DEUX imbalances 3 bougies, de sens contraires et emboîtées** : la 3e bougie de
la première est la 1re de la seconde. Les centrales sont à deux barres d'écart,
la figure tient sur cinq bougies.

```
    i-1     i     i+1     i+2     i+3
     └── motif 1 ──┘       │       │
                   └──── motif 2 ──┘
                    ▲
              bougie PARTAGÉE
```

L'appariement **est** la définition — un motif seul n'est jamais un $$$.

| terme | sens |
|---|---|
| **motif** | une imbalance 3 bougies : centrale directionnelle, vide franc entre la 1re et la 3e |
| **centrale** | la 2e bougie d'un motif, celle qui creuse le gap |
| **bougie partagée** | la bougie commune aux deux motifs (3e du premier, 1re du second) |
| **paire** | les deux motifs ensemble = la figure complète |
| **pointe haute** | paire qui commence **haussière** : gap ↑ puis gap ↓ → structure **baissière** |
| **pointe basse** | paire qui commence **baissière** → structure **haussière** |
| **pivot** | l'arête que les deux boîtes PARTAGENT (bas de la partagée si pointe haute, haut si pointe basse) |
| **bord libre** | l'autre arête de la 2e boîte, celle qui fait face au prix. C'est le niveau d'entrée ET de santé |
| **similitude** | recouvrement des deux boîtes (Jaccard) = rapport de leurs hauteurs, 0–100, sans unité |
| **impulsion** | la centrale du **second** motif — celle que le filtre de RSI prend pour repère |

**La figure est purement géométrique** : ni moyenne mobile, ni taille, ni forme.
Le vide est exigé franc (gap > 0) et ce n'est pas réglable. Conséquence : le
motif ne trie rien et il en sort beaucoup — d'où les deux filtres ci-dessous.

### Le filtre de similitude

`similarity` (0–100, 0 = off) : recouvrement des deux boîtes. Sans unité, donc
transposable d'un symbole à l'autre. 100 = égalité stricte des hauteurs, quasi
rien sur données réelles ; viser 95–98 pour « indistinguables à l'œil ».

### La 3ᵉ bougie du 2ᵉ FVG, inversée

`reverseThird` (éteint par défaut) : la bougie qui **referme le second gap** doit
clôturer à **contre-sens** de l'impulsion qui vient de le creuser.

| paire | 2ᵉ impulsion | 3ᵉ bougie exigée |
|---|---|---|
| haussière → baissière | baissière | **haussière** |
| baissière → haussière | haussière | **baissière** |

Le marché ne se contente pas de s'arrêter : il **rend déjà du terrain**. C'est le
premier signe que la pointe est finie plutôt qu'en pause — la même idée que
l'ancien `superFVG` du rFVG, appliquée au seul motif qu'on joue.

Cette bougie est aussi la **5ᵉ de la figure**, celle qui la rend connue : la
condition ne coûte donc **aucune bougie d'attente** supplémentaire. Un doji est
refusé (il ne rend rien).

C'est une **condition de la paire** : elle vaut pour les **cinq dessins** et pour
les **positions**.

### Le filtre de RSI — l'extrême avant l'impulsion

`rsiPeriod` (0 = off, mettre **7**), `rsiOversold` (**≤ 20**), `rsiOverbought`
(**≥ 80**). **Le seul filtre du motif qui regarde autre chose que les cinq
bougies.**

> La dernière bougie de sens **contraire** juste avant l'impulsion du **second**
> motif doit avoir clôturé en zone extrême.

| paire | 2ᵉ impulsion | bougie cherchée | exigence |
|---|---|---|---|
| haussière → baissière | baissière | dernière **haussière** avant elle | RSI **≥ 80** (surachat) |
| baissière → haussière | haussière | dernière **baissière** avant elle | RSI **≤ 20** (survente) |

L'idée : le dernier sursaut avant la cassure était déjà à bout de souffle.

**La recherche est bornée par construction, sans réglage** : le premier motif
étant de sens contraire au second, sa centrale — deux barres avant l'impulsion —
va forcément dans le sens cherché. La boucle s'arrête donc au pire à la deuxième
bougie testée. Un doji est sauté (il ne va nulle part) ; un RSI pas encore chaud
ne conclut pas et la paire est écartée.

Chaque paire porte `rsiIdx` et `rsiValue` — la bougie jugée et sa valeur —, pour
relire la décision sans refaire le calcul.

### Le filtre de distance à la MM

`maDistPeriod` (200, 0 = off) : de combien la **pointe** s'est écartée d'une
moyenne mobile, mesurée au départ du trait extrême.

> **Signée dans le sens de la POINTE**, pas dans celui des prix. Une pointe haute
> qui dépasse la MM de 12 et une pointe basse qui la creuse de 12 rendent toutes
> deux **+12** — sans quoi il faudrait retourner le chiffre de tête à chaque
> figure. Négatif veut donc dire : la pointe n'a pas atteint la moyenne.

`maDistMode` choisit **un seul** seuil — `off` / `min` / `max` —, appliqué à la
**valeur absolue** de l'écart. Un plancher et un plafond ne se règlent pas
ensemble : le choix unique rend l'état incohérent impossible à écrire, et les
deux valeurs restent mémorisées séparément.

**C'est une condition, pas un affichage** : le seuil retire la figure partout —
zones, tous les dessins, et **positions**. Sans mesure possible (moyenne pas
encore chaude), une figure ne peut pas passer un seuil : elle est écartée plutôt
que devinée.

Le dessin, lui, ne montre la mesure que là où le trait extrême existe (`extreme`
et `nuage`) : un **trait gris fin** relie les deux prix, **coupé en son milieu**
pour y loger le chiffre — la cote d'un plan technique. Gris exprès : il ne dit
rien du sens de la figure, seulement une distance. Le nom du motif disparaît
alors de l'étiquette. En fractal, c'est la MM du **HTF**.

`showMaDist` masque le trait et son chiffre. **Masquer n'éteint pas le filtre** —
la mesure continue de retirer des figures ; seul `maDistMode: off` l'arrête.
Quand le trait est masqué, l'étiquette du motif reprend sa place.

**Piège de vocabulaire** : `direction: 'bull'` garde les paires qui *commencent*
haussières = les pointes hautes = uniquement des **ventes**.

### Les deux dessins

`zoneStyle` — purement visuel, la détection ne change pas d'un iota.

| valeur | ce qu'on voit |
|---|---|
| `boites` | les **deux FVG**, chacun sa couleur de sens |
| `seconde` | le **2ᵉ FVG seul** — la zone qu'on joue |
| `trait` | un **segment épais** sur le **pivot** — l'arête que les deux boîtes partagent |
| `extreme` | le même segment, mais sur la **pointe** — l'autre bout de la bougie partagée |
| `nuage` | la **bande entre les deux**, en carte de chaleur |

Les deux boîtes ne diffèrent que par leur **profondeur** sous (ou sur) le pivot :
les dessiner toutes les deux revient à tracer deux fois le même niveau. Les modes
trait ne gardent que le niveau ; `seconde` garde la boîte qui compte.

**`seconde`** ne montre que le **second** motif — celui qui donne le sens du
trade et porte le bord d'entrée. Une paire haussière→baissière n'affiche que sa
zone **baissière**, une paire baissière→haussière que sa zone **haussière**. Le
premier motif ne sert qu'à faire la pointe. Aucun doublon possible : un motif ne
peut être le second que d'une seule paire, donc dans une chaîne il apparaît une
fois (3 boîtes en vue complète → 2 en vue seconde).

**Les deux niveaux sont sur la MÊME bougie — la partagée, celle de la pointe —
et l'encadrent, un de chaque côté :**

| paire | boîtes | `trait` (pivot) | `extreme` (pointe) |
|---|---|---|---|
| **haussière → baissière** | partagent leur borne **supérieure**, pendent dessous | plus **bas** de la partagée | plus **haut** de la partagée |
| **baissière → haussière** | partagent leur borne **inférieure**, tiennent dessus | plus **haut** de la partagée | plus **bas** de la partagée |

Le pivot est l'arête d'où pendent les gaps ; l'extrême est le plus loin où le
marché est allé avant de se retourner.

- Le trait porte le **sens du TRADE** (donc du 2ᵉ motif) : une pointe basse
  s'achète → trait haussier. Pas le sens de la paire, qui vient du 1ᵉʳ motif.
- Il court de la bougie **partagée** (le niveau n'existe pas avant elle) au bord
  droit de la 2ᵉ boîte : les vues se superposent exactement.
- Épaisseur réglable (`pivotWidth`, 3 px).
- Chaque paire porte `pivotPrice` **et** `extremePrice`, quel que soit le mode.

Techniquement c'est une zone **plate** (top = bottom) : `FvgPrimitive` sait
qu'une bande sans hauteur se dessine en segment épais, à pleine opacité. Aucune
seconde primitive à entretenir.

### Le nuage de liquidité

`nuage` couvre la bande **pivot ↔ extrême**, c'est-à-dire exactement l'amplitude
de la bougie partagée. Ses deux bords n'ont pas le même statut, et le dessin le
dit — un rectangle uniforme l'aurait tu :

- **Bord chaud = l'extrême**, la butée que le marché n'a pas dépassée : une
  arête lumineuse, puis la densité s'effondre vers le pivot.
- **Une seule couleur, deux couches.** Le corps, puis la **même** teinte
  repassée en additif sur le tiers proche du mur : elle se sature et rayonne,
  sans jamais se délaver. Aucun mélange vers le blanc, aucun empilement de
  traits — le mur est **un** filet.
- **Une courbe en S**, jamais une droite ni une puissance nue : la première donne
  un dégradé de tableur, la seconde écrase tout contre le bord.
- **Stries fines et jointives** (2 px, jusqu'à 72) : assez petites pour qu'on ne
  les compte pas, assez présentes pour donner l'échelle de prix.
- **Aucune variation aléatoire.** Sur une bande de cette taille, le hasard ne
  fait pas « données », il fait sale. Toute la matière vient des courbes.
- **Amorce** : une verticale claire sur la bougie d'origine, qui s'éteint
  aussitôt. Elle ancre le nuage sans déborder à gauche du départ.
- **Étiquette hors de la bande**, du côté du mur : posée dedans, elle se bat
  avec la lueur.
- Le curseur **Opacité** pilote l'intensité générale, comme pour les boîtes.

#### Le mode fractal

`fractal` + `fractalHtf` (M15 par défaut) : la figure est détectée sur des
bougies de l'**unité supérieure**, reconstruites depuis celles du graphe, puis
dessinée sur l'échelle de temps courante. On voit le motif tel qu'il est en M15 —
mêmes prix, extension comptée en bougies M15 donc **15 fois plus large** — sans
quitter le détail M1. C'est un **zoom sur une figure du HTF**, pas une figure du
LTF.

> **C'est un affichage, et rien d'autre.** Les positions restent calculées sur
> les bougies du graphe. Voir une figure M15 en tradant en M1 est l'intérêt du
> mode ; croire que la gestion a suivi serait coûteux.

**La bougie qui confirme** (`confirmTime`) est marquée d'un **cran vertical** sur
le nuage : c'est le premier instant où l'on avait le droit de voir cette zone. À
gauche du cran, le nuage est dessiné sur des bougies qui l'ont **précédé**. En
fractal l'écart vaut tout un bucket HTF — sans le repère on croirait la figure
connue quinze bougies trop tôt. Hors fractal, c'est simplement la 5ᵉ bougie de la
figure.

Deux précautions, non décoratives :

- **La bougie HTF en cours est écartée.** Un motif détecté sur un bucket non
  clôturé se déformerait à chaque tick puis disparaîtrait — du repaint pur.
- **Les temps sont ramenés sur des bougies qui existent.** Un début de bucket
  n'a pas toujours de bougie sur le LTF (week-end, séance fermée, trou de
  données) ; la primitive rendrait `null` et la zone disparaîtrait sans un mot.

Code : `lib/dollars/fractal.js` (générique — il rejoue n'importe lequel des
détecteurs de dessin) et `htfOhlcFromCandles` dans `lib/htf.js`.

Rendu par `components/charts/CloudPrimitive.js` : un dégradé horizontal construit
une fois par zone (le vieillissement), repeint en N bandes à opacité décroissante
(la densité). Le croisement des deux donne un champ 2D pour le prix d'un seul
objet de dégradé — c'est ce qui permet d'en afficher des dizaines sans ramer.
C'est la **seule** vue qui a besoin de sa propre primitive ; le graphe détache
l'ancienne avant d'attacher l'autre quand on change de mode.

---

## 2. La position

**Le sens est celui du SECOND motif** — le dernier FVG de la paire. Pointe basse
→ achat, pointe haute → vente.

**Entrée** : ordre à cours limité sur un niveau ± une marge signée.

`entryLevel` choisit lequel — les deux existent déjà dans la figure :

| valeur | niveau | conséquence |
|---|---|---|
| `bord` | le **bord libre** de la 2ᵉ boîte (= extrémité de la 5ᵉ bougie) | l'entrée d'origine |
| `extreme` | la **pointe** — l'autre bout de la bougie partagée | de l'autre côté de toute la figure : servi **bien plus rarement**, bien mieux placé |

> **Le niveau de santé suit l'entrée**, et ce n'est pas cosmétique : atteindre
> l'extrême suppose d'avoir traversé le bord du gap. Garder ce bord comme
> référence ferait naître **toute** position malsaine — le BE du malsain
> s'armerait dès la première bougie et le trade unique ne bloquerait plus rien.

`entryEdge` porte le niveau retenu, marge exclue.

| terme | sens |
|---|---|
| **marge d'entrée** | signée, comptée du côté d'où le prix revient. **Positive = pré-entrée** (servi plus tôt, moins bien) · négative = plus loin dans la boîte |
| **niveau déjà dépassé** | si le prix est au-delà quand l'ordre est posé, il part au marché à l'ouverture suivante — comme une vraie limite |
| **`missed`** | ordre jamais servi. Listé, sans prix ni résultat, hors statistiques |
| **`readyIdx`** | la 5e bougie : la figure n'est connue qu'à sa clôture. L'ordre est armé après |

**Sortie** : SL et TP fixes depuis l'entrée, **indépendants** — le RR est leur
rapport, pas un réglage.

**Unités** : `distUnit` bascule **toutes** les distances (marge, SL, TP, niveau
de BE) entre points et ATR. Clés séparées par unité. En ATR, l'ATR est lu sur la
dernière bougie de la figure et **figé** — un stop qui suit l'ATR se déplace tout
seul.

---

## 3. La santé

> **Une position est SAINE tant qu'aucune bougie n'a CLÔTURÉ au-delà du bord
> libre du gap qui l'a fait entrer.**

- Achat → aucune clôture **sous** le bord haut. Vente → aucune **au-dessus** du bord bas.
- **Clôture, pas mèche** : une traversée qui revient ne casse rien. On veut un rejet, pas une visite.
- **Le bord, pas le prix d'entrée** : la marge n'entre pas dans le calcul.
- **Sans retour** : une fois cassée, elle le reste.

Trois règles s'en servent, avec deux portées différentes :

| règle | santé | + entrée du bon côté d'une MM |
|---|---|---|
| TP dynamique 2 | oui | **oui** |
| BE du malsain | oui | non |
| Trade unique | oui | non |

Champs : `stayedHealthy`, `healthyBars`.

---

## 4. Le TP dynamique

La cible peut être **repoussée UNE fois**, décidée à l'instant où le TP de base
est touché, à `mult` × la distance **de départ** (jamais × la cible courante).

| règle | armée par |
|---|---|
| **TP dyn 1 — position rapide** | TP de base atteint en ≤ N bougies |
| **TP dyn 2 — position saine** | entrée du bon côté d'une MM **et** position saine |

Si les deux valent → **le plus grand** multiplicateur, pas le produit (les deux
disent la même chose).

**Garde-fous** : une seule extension · la nouvelle cible n'est pas touchable sur
la bougie qui l'arme · interdit sous un dû.

**Ce que ça coûte** : **le stop ne bouge pas**. Un gain acquis peut redevenir une
perte pleine. `tpBoostedNet` (dans stats) est le seul chiffre qui dit si la règle
paie : ce que les positions étendues ont rendu **moins** ce qu'elles auraient
rendu à leur cible de départ.

La MM du TP dyn 2 est la **seule** du motif et **ne touche pas la détection**.

---

## 5. Les deux BE — un seul niveau

Le break-even de la famille (stop remonté sur seuil en R) est **éteint de
force** : le stop d'une position $$$ ne bouge jamais. Les deux BE d'ici visent le
même petit gain au-dessus de l'entrée (distance partagée) et ne diffèrent que par
ce qui les arme et le côté d'où ils agissent.

| | armé par | agit |
|---|---|---|
| **BE du malsain** | une **avarie** : la position cesse d'être saine | d'un côté : il **attend** que le prix revienne au niveau |
| **BE existentiel** | le **temps** : passé N bougies | des **deux** côtés |

**BE existentiel, les deux côtés :**
- **au-delà du niveau** → *protection*, on ne redescend plus dessous. Testé
  **avant le stop** — pure géométrie : venant d'au-dessus, le prix croise le
  niveau avant le stop, plus bas. Le TP reste jouable tant qu'on reste au-dessus.
  Remplissage au **pire** du niveau et de l'ouverture → un gap dessous rend une
  petite **perte**.
- **en deçà** → *cible*, on coupe au niveau exact.

Le côté se juge sur la clôture de la bougie **précédente**.

**Conséquence commune** : une position dont un BE est armé ne peut plus atteindre
son TP **par le bas** — le niveau est plus près. Seule une position protégée,
restée au-delà, peut encore y aller.

`beReason` : `'unhealthy'` · `'existential'` (`'profit'` n'apparaît jamais ici).
Compteurs : `beUnhealthyArmed` / `Saved` / `Lost`, `beExistExits`.
Sans distance de BE réglée, **aucune** des deux règles n'a de niveau.

---

## 6. Le trade unique

Une position ne réserve la place que **tant qu'elle est saine**. Dès qu'elle
cesse de l'être, le motif suivant est jouable même si elle court toujours.

- Aucune MM ici : la santé ne dépend que du motif.
- La bougie qui rend malsaine **bloque encore** (sa clôture n'est pas connue).
- **« Trade unique » ne veut donc plus dire « un seul trade à la fois »** : deux
  positions peuvent se chevaucher dès que la première est malsaine.
- Ce n'est pas un filtre neutre — il écarte selon ce que le marché a fait
  entre-temps. `skippedByUnique` les compte.

---

## 7. Le lot

Le lot **ne touche à rien** de la simulation : entrée, stop, cible, excursions
sont des **prix** et ne bougent pas. Il multiplie le **résultat** — brut, spread
et net **ensemble** (deux lots paient deux spreads, donc net = brut − spread
reste vrai).

| type | progression |
|---|---|
| **Classique** | 1 lot, toujours |
| **Pas à pas** | +P tous les N trades → 1, 2, 3, 4… |
| **Exponentiel** | ×F tous les N trades → 1, 2, 4, 8… |

Compteur sur les trades **pris**, ordre d'entrée ; un `missed` ne fait pas monter
la marche. `lotMax` plafonne — en exponentiel c'est une **nécessité
arithmétique** : F^k déborde et rendrait tous les résultats NaN. Le dû ignore le
lot (il vise une distance de prix).

### Ce qu'un escalier fait, et ne fait pas

Il multiplie l'espérance de chaque trade, il n'en crée aucune. **Mais le total
réalisé peut changer de signe** : ce n'est plus une moyenne, c'est une somme
pondérée dont les poids croissent avec le temps, donc dictée par le dernier bloc.

Mesuré sur les bougies du self-test, **même stratégie, mêmes trades** :

```
fixe  +20 pts   ·   pas à pas  −70   ·   exponentiel  −240
```

Le pas à pas déforme beaucoup moins (poids en n, pas en 2^n) : des deux
escaliers, c'est le seul dont un backtest garde du sens.

---

## 8. Lot et statistiques — la frontière

Chaque position porte `netPoints1` (résultat **à 1 lot**) à côté de `netPoints`
(compte).

| se lit **à 1 lot** — juge la STRATÉGIE | se lit **avec le lot** — décrit le COMPTE |
|---|---|
| espérance, gain/perte moyens, seuil de rentabilité, facteur de profit, t-stat, **les deux études BE / SL** | points nets, courbe cumulée, **drawdown max** |

Sans cette séparation, l'étude du SL plafonné comparait une perte de **compte**
(−40 à 4 lots) à un plafond de **prix** (12), et le seuil de rentabilité variait
selon le seul calendrier des lots. Inerte à lot 1.

---

## 9. Ce que /rapports mesure vraiment

- **Résultat cumulé** = somme des profits **nets** des positions résolues (TP, SL,
  BE, durée), triée par heure d'**entrée**.
- **On parle en $.** Le rapport ne contient que des points ; le **prix du point**
  réglé en haut de page (« 20 pts = 100 $ », **1 pt = 1 $ par défaut**, retenu
  dans le stockage local) les convertit **à l'affichage seulement** — rien n'est
  recalculé, c'est un facteur. En **$** : espérance, résultat net, gain et perte
  moyens, drawdown, courbe, profits des positions, espérance des deux études. En
  **points** : tout ce qui est une distance de prix — risque, TP, excursions,
  déclencheur de BE, plafond de stop —, parce que ces chiffres se reportent tels
  quels dans les panneaux. Les **ratios** (winrate, facteur de profit, seuil de
  rentabilité, RR) ne bougent pas : le facteur est en haut comme en bas.
- Tant que rien ne se chevauche, c'est la suite des encaissements d'un compte.
  Dès qu'il y a chevauchement — **la page l'affiche** —, le **drawdown max est
  optimiste** : un compte unique aurait porté ces pertes ensemble.
- L'objectif affiché est la **médiane des distances réellement visées**, pas le
  réglage (il varie en ATR, sous un dû, ou après une extension).
- La colonne **Lot** et son bandeau n'apparaissent que si les tailles varient.

---

## 10. Où est quoi

| fichier | rôle |
|---|---|
| `lib/dollars/detect.js` | la figure, les paires, la similitude, le filtre de RSI |
| `lib/rsi/features.js` | `rsiOf` — le RSI de la maison, partagé avec la corne et /rsi |
| `lib/dollars/positions.js` | sens, niveau d'entrée, distances, compteurs |
| `lib/dollars/params.js` | réglages + formulaire (titres et champs, aucun texte) |
| `lib/patternPositions.js` | entrée `'limit'`, TP dynamique, les deux BE, trade unique `'healthy'`, lot |
| `lib/signals/stats.js` | la frontière lot / stratégie |
| `scripts/dollars-selftest.mjs` | 72 assertions — fige les priorités entre règles |

**Toute règle ajoutée doit figer sa priorité dans le self-test** : prises une à
une elles sont simples, c'est leur ordre qui ne se vérifie pas à l'œil.
