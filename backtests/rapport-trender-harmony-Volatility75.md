# trender-harmony · Volatility 75 Index · M1 — rapport d'optimisation

Période demandée : mai → juillet 2026 · TF de décision **1m** · spread **2 points** · warm-up 35 j
IS : 2026-05-01 → 2026-06-20 · OOS : 2026-06-20 → 2026-07-12
**~420 configurations évaluées** sur ce symbole (2 campagnes, voir §8).

> **Deuxième campagne (HTF M15/H1/H4 imposés, réglage de SL/TP/BE demandé).**
> Elle constitue **l'unique cycle de re-réglage après consultation de l'OOS**
> toléré par la méthode — il est déclaré ici, et il n'y en aura pas d'autre. Les
> chiffres OOS de cette seconde campagne ont donc **moins de force probante** que
> ceux de la première. Résultats et conclusions : **§8, §9 et §10** — dont un
> **bug du moteur** (§9) et la réponse mesurée à « entrée trop tôt ou trop
> tard ? » (§10).

---

## 1. Verdict

**Pas d'edge.** Les deux jeux de paramètres retenus — figés avant tout regard sur
l'OOS — ont une **espérance négative hors échantillon** (−0,013 R et −0,104 R).

Le fait décisif : sur la fenêtre OOS, Volatility 75 **monte de +36 %** (+14 117
points) et la stratégie y prend **24 trades, tous longs, aucun short** — tous les
HTF sont alignés haussiers. Elle est donc *long-only dans un melt-up*… **et elle
perd −18 points**. Une stratégie incapable de gagner quand elle est
structurellement du bon côté d'un marché qui grimpe de 36 % n'a pas d'edge : elle
a du bruit. Ne pas exploiter.

---

## 2. Paramètres

Deux pistes, décidées **a priori** (avant tout balayage) et déclarées comme deux
hypothèses distinctes, parce que la piste demandée ne pouvait pas produire un OOS
concluant :

| | HTF | slPoints | tpPoints | reste | n (IS) | budget honnête (n/30) |
|---|---|---|---|---|---|---|
| **Piste A** — la demande littérale | H1/H4/H16 (défaut) | **60** | **150** | défauts | 44 | **1,5 param** — j'en ai réglé 2 |
| **Piste B** — HTF mis à l'échelle du M1 | **M15/H1/H4** | **40** | **100** | défauts | 148 | 5 params — j'en ai réglé 3 |

Détail des réglages :

| Paramètre | Défaut | Retenu (A) | Pourquoi |
|---|---|---|---|
| `slPoints` | 50 | **60** | plateau 40–140 ; ≈ 1,1× l'ATR M1 (55 pts) |
| `tpPoints` | 100 | **150** | plateau 100–200, **falaise nette dès 250** ; R:R 2,5 |
| `bbLen` | 50 | *(inchangé)* | balayage bruité et non monotone (50 → tStat 1,42 ; 60 → 0,33 ; 70 → −0,87). Le défaut tombe déjà sur le meilleur point : le régler n'ajouterait que du surapprentissage |
| `bbMult` | 0,369 | *(inchangé)* | idem : pics à 0,4 et 0,6, trou à 0,7 → bruit. Le défaut est déjà dans la bonne zone |
| `confFlt`, `beOn`, `rvOn`, `direction` | défauts | *(inchangés)* | **budget épuisé** (voir ci-dessous) |

**Le budget de liberté est le problème central de cette mission.** Avec 44 trades
en IS sur la piste A, le budget honnête est de 44/30 ≈ **1,5 paramètre**. J'en ai
réglé 2 (`slPoints`, `tpPoints`) — déjà au-delà. C'est en soi un motif de
défiance envers les chiffres IS, et cela **interdit** de toucher aux ~8
paramètres restants (`beOn`, `rvOn`/`rvRR`/`rvMaxBars`, `confFlt`, les 3 HTF) :
sur cet échantillon, les activer ne mesurerait rien, cela mémoriserait
l'historique.

### Pourquoi le M1 n'a pas donné plus de signaux

Contre-intuitif, et important : les signaux ne naissent qu'aux **bascules des
HTF** (`startBull = bull && !prevBull`, [trenderHarmony.js:137-138](lib/backtest/strategies/trenderHarmony.js#L137-L138)).
Or la tendance HTF ne change qu'aux frontières de bucket H1/H4/H16. Descendre le
chart de 15m à 1m ne crée donc **aucun signal supplémentaire** — il rend
seulement l'entrée plus précise. D'où n=44 seulement, sur 50 jours de M1.

C'est ce qui a motivé la piste B : sur un chart M1, l'échelle HTF cohérente est
M15/H1/H4, pas H1/H4/H16. Elle donne n=148 en IS et **n=74 en OOS** — le seul
hors-échantillon de cette mission qui soit statistiquement concluant.

---

## 3. Résultats

| | trades | winrate | avgR | totalR | PF | maxDD (R) | tStat |
|---|---|---|---|---|---|---|---|
| Baseline (défauts), IS | 44 | 45,5 % | +0,324 | +14,2 | 1,57 | 5,4 | 1,42 |
| Piste A optimisée, IS | 44 | 40,9 % | +0,398 | +17,5 | 1,65 | 5,2 | 1,52 |
| **Piste A optimisée, OOS** | **24** | **29,2 %** | **−0,013** | **−0,3** | **0,98** | **6,2** | **−0,04** |
| Piste B optimisée, IS | 148 | 34,5 % | +0,156 | +23,1 | 1,23 | 17,5 | 1,14 |
| **Piste B optimisée, OOS** | **74** | **27,0 %** | **−0,104** | **−7,7** | **0,86** | **11,2** | **−0,57** |

Contexte :

- spread **2 points** partout ; ATR14 médian M1 = **55 pts** (IS) → **78 pts**
  (OOS), soit **+42 % de volatilité** entre les deux fenêtres ;
- **aucun tStat n'atteint 2**, même en IS, même sur le meilleur de 237
  configurations. Rien n'est prouvé nulle part ;
- winrate OOS piste A = **29,2 %** pour un R:R de 2,5, dont le seuil d'équilibre
  est **28,6 %**. La stratégie est *exactement* sur sa ligne de flottaison : un
  pile ou face qui paie le spread.

### Le chiffre qui tranche

| | stratégie | buy & hold (aucun signal) |
|---|---|---|
| IS (50 j) | +1 052 pts (44 trades) | **+5 224 pts** |
| **OOS (22 j)** | **−18 pts** (24 trades) | **+14 117 pts** |

En OOS, la stratégie est **long à 100 %** (24 longs, 0 short — vérifié :
`direction=short` ne produit aucun trade sur la fenêtre) dans un marché qui gagne
14 117 points, et elle finit **négative**. *(Nuance honnête : le buy & hold est
exposé en permanence et sans stop, la comparaison n'est pas à risque égal. Elle
suffit néanmoins à établir que le signal d'harmonie ne bat pas — ni même
n'approche — la dérive qu'il chevauche.)*

---

## 4. Robustesse

Sortie de `validate` sur la piste A (jeu retenu), commentée :

| Test | Résultat | Lecture |
|---|---|---|
| **OOS** | avgR **−0,013** · n=24 | ✖ **échec**. Et n=24 < 30 → même l'échec est peu concluant |
| **OOS piste B** | avgR **−0,104** · **n=74** | ✖ **échec sur un échantillon concluant**. C'est le test qui ferme le dossier |
| Spread ×2 / ×3 | +0,365 / +0,332 (IS) | ✔ résiste aux coûts — mais résister à un coût sur un edge inexistant ne vaut rien |
| Concentration mensuelle | **75 %** du R sur un seul mois (IS) | ⚠ au-delà du seuil de rejet (60 %) |
| TF voisin (3m) | +0,239 (IS) ; piste B : **−0,033** | ⚠ la piste B n'est rentable sur **aucun** TF voisin |
| Direction (IS, piste A) | short +0,467 (n=28) · long +0,279 (n=16) | l'edge IS penche **short** |
| Direction (IS, piste B) | **long +0,314** (n=77) · short −0,015 (n=71) | …et ici il penche **long**. Les deux pistes se contredisent sur le même symbole et la même fenêtre |
| Direction (OOS) | **100 % long, 0 short** — et perdant | capture de dérive ratée |

**La contradiction directionnelle entre les deux pistes est le tell le plus
clair.** Un edge réel ne change pas de sens quand on change l'échelle des HTF sur
la même fenêtre de données. Du bruit, si.

### Le test qui aurait dû sauver la stratégie — et qui l'enterre

L'ATR passe de 55 (IS) à 78 (OOS) : les SL/TP fixes en points sont mécaniquement
devenus trop serrés. J'ai donc renormalisé (post-hoc, **diagnostic uniquement,
aucun gain revendiqué**) : `slPoints=85, tpPoints=213` — même R:R 2,5, même
multiple d'ATR qu'en IS.

| Piste A · OOS | avgR | PF |
|---|---|---|
| sl=60 / tp=150 (retenu) | −0,013 | 0,98 |
| sl=85 / tp=213 (renormalisé ATR) | **−0,001** | **1,00** |

**Zéro.** Corriger le changement de régime ne ramène pas l'espérance au-dessus de
zéro, elle la ramène *exactement* à zéro. C'est une information précieuse : elle
**disculpe** le défaut « SL/TP en points fixes » comme *cause* de l'échec, et
**inculpe le signal lui-même**. Le problème n'est pas la calibration. C'est qu'il
n'y a rien à calibrer.

---

## 5. Défauts de la stratégie

*(audit de [lib/backtest/strategies/trenderHarmony.js](lib/backtest/strategies/trenderHarmony.js))*

**Ce qui est sain, et qu'il faut dire :** **aucun lookahead.** `htfTrendPerBar`
renvoie `trend[j-1]`, la dernière bougie HTF **clôturée**
([trenderHarmony.js:78](lib/backtest/strategies/trenderHarmony.js#L78)) — l'idiome
non-repeint du Pine (`request.security(expr[1], lookahead_on)`) est correctement
porté. Le warm-up est implicitement gardé : `trend` vaut 0 avant `bbLen` bougies,
donc pas d'harmonie, donc pas de signal. Le moteur n'est pas en cause non plus
(cf. `engine-contract.md`). **Le défaut est dans la stratégie.**

1. **Le signal ne porte aucune information directionnelle — défaut de fond.**
   Symptôme : en OOS, 24 trades tous longs dans un marché à +36 %, résultat −18
   points ; winrate 29,2 % contre un seuil d'équilibre de 28,6 %. Et la
   renormalisation ATR (§4) donne exactement 0,000. L'alignement multi-HTF
   sélectionne des moments où la tendance *a déjà eu lieu* (Bollinger sur closes
   HTF, sur la bougie HTF **précédente**) : c'est un indicateur **retardé**, et
   entrer au *début* d'une zone d'harmonie revient à entrer **après** le mouvement
   qui l'a créée. *Correction : il n'y en a pas de paramétrique. Le signal est à
   repenser, pas à régler.*

2. **La fréquence d'entrée est structurellement plafonnée** — et c'est un défaut
   de conception, pas un réglage.
   ([trenderHarmony.js:137-138](lib/backtest/strategies/trenderHarmony.js#L137-L138)).
   Les signaux ne naissent qu'aux bascules HTF, donc **descendre le TF de décision
   n'apporte rien** : 44 trades en 50 jours de M1, exactement ce qu'on aurait eu
   en 15m. Toute optimisation sur cette configuration est condamnée à un budget de
   ~1,5 paramètre. *Correction : découpler la fréquence d'entrée du HTF (p. ex.
   entrer sur un pullback à l'intérieur d'une zone d'harmonie active, pas
   seulement à son démarrage) — c'est aussi ce qui rendrait le M1 pertinent.*

3. **SL/TP en points fixes — non portable, et silencieusement dérivant.**
   ([trenderHarmony.js:100-101](lib/backtest/strategies/trenderHarmony.js#L100-L101)).
   L'ATR est passé de 55 à 78 pts entre l'IS et l'OOS : le SL retenu a glissé de
   1,09×ATR à 0,77×ATR **sans que rien ne le signale**. Ici le défaut n'a pas causé
   l'échec (§4), mais il rend tout réglage non transposable d'un régime ou d'un
   instrument à l'autre. *Correction : `slAtrMult` / `tpRR` au lieu de
   `slPoints` / `tpPoints`.* **C'est le même défaut que sur XAUUSD — il est
   désormais confirmé sur deux instruments.**

4. **Le piège XAUUSD ne se reproduit PAS ici — à noter.** Sur XAUUSD, le SL
   pilotait la fréquence d'entrée (19 trades à SL=50, 65 à SL=10) parce qu'une
   position ouverte avale les signaux de même sens
   ([trenderHarmony.js:219](lib/backtest/strategies/trenderHarmony.js#L219)). Sur
   V75/M1, **n reste bloqué à 44 pour tout SL de 20 à 275** : les zones alternent
   haussier/baissier, chaque signal opposé retourne la position, et aucun signal
   n'est avalé. Le couplage existe donc bien dans le code, mais il est **latent**
   ici. À garder en tête : il se réveillera sur tout instrument aux zones moins
   alternées.

5. **Surface de réglage inexploitable.** `beOn`/`beTrigger`/`beOffset`,
   `rvOn`/`rvRR`/`rvMaxBars`, `confFlt`, `htf1/2/3` = ~10 paramètres libres pour un
   budget de 1,5. Ce ne sont pas des leviers, c'est de la surface de
   surapprentissage. *Simplification recommandée : les retirer ou les figer tant
   que la stratégie ne produit pas ≥ 300 trades.*

6. **`st.beAppliedId` n'est jamais remis à zéro**
   ([trenderHarmony.js:160](lib/backtest/strategies/trenderHarmony.js#L160),
   [:229](lib/backtest/strategies/trenderHarmony.js#L229)). Comparé à
   `position.id`, il fonctionne, mais conserve indéfiniment l'id de la dernière
   position passée au break-even. Bénin aujourd'hui, fragile si la gestion d'id
   change. (Inchangé depuis l'audit XAUUSD.)

---

## 6. Manques

**De la stratégie :**

- **entrée trop tardive et trop rare** (défauts 1 et 2) — le manque principal ;
- **aucun filtre de volatilité** : l'ATR a bondi de 42 % entre IS et OOS sans que
  la stratégie ne s'adapte ;
- **aucune gestion de sortie dynamique** : tout repose sur un TP fixe. Un
  **trailing ATR** laisserait courir les gagnants — avec un R:R de 2,5 et 29 % de
  réussite, c'est le levier le plus évident, et il est absent ;
- **asymétrie long/short non exploitée** : la stratégie est symétrique, V75 ne
  l'est pas (il dérive violemment à la hausse).

**Du moteur (donc non testable en l'état — à ne créditer d'aucun gain) :**

- pas de **filtre de session/heure** : `byHour`/`byDayOfWeek` sont *diagnostiques*.
  « Ne trader que telle plage » serait une **hypothèse à tester**, pas un réglage
  disponible — et sur 44 trades, ce serait du surapprentissage pur ;
- pas de **sizing en capital**, pas d'**ordres limites**, pas de **pyramidage** ;
- pas de **slippage** ni de spread variable : **la réalité sera pire** que ces
  chiffres, déjà négatifs.

---

## 7. Prochaines expériences

1. **Contrôle par entrée aléatoire** *(le plus rentable — il tranche
   définitivement)*. Stratégie témoin prenant le **même nombre** de trades, avec
   les **mêmes** SL/TP, à des dates aléatoires sur V75/M1. *Hypothèse
   falsifiable :* si le témoin égale trender-harmony, le signal d'harmonie ne porte
   **aucune** information — ce que ce rapport et celui sur XAUUSD suggèrent déjà
   tous les deux. Deux instruments, deux échecs : c'est le test qui doit être fait
   avant toute autre chose.

2. **Découpler l'entrée de la bascule HTF** dans `trenderHarmony.js` : entrer sur
   un **pullback** (p. ex. retour à la basis de Bollinger du TF de décision) *à
   l'intérieur* d'une zone d'harmonie active, au lieu d'entrer à son démarrage.
   *Hypothèse falsifiable :* la fréquence d'entrée devient pilotée par le TF de
   décision (donc le M1 sert enfin à quelque chose), n passe de 44 à plusieurs
   centaines, et le budget de paramètres devient honnête. Si l'espérance reste
   nulle avec n=300+, le dossier est clos pour de bon.

3. **Passer SL/TP en multiples d'ATR** (`slAtrMult`, `tpRR`). *Hypothèse
   falsifiable :* le réglage devient portable d'un régime à l'autre (ici l'ATR a
   varié de 42 % entre IS et OOS). **Prérequis d'hygiène, pas une amélioration de
   performance** — le §4 montre que cela ne sauvera pas l'espérance.

---

## Note d'environnement

Le disque est plein à **98 % (2,7 Go libres)**, ce qui a provoqué une erreur HTTP
500 transitoire pendant un balayage (relancé sans incident). Même symptôme que
lors de la mission XAUUSD — cela mérite d'être traité avant la prochaine campagne.

---
---

# ANNEXE — 2ᵉ campagne : HTF M15/H1/H4, réglage SL / TP / BE

Demande : HTF fixés à **M15/H1/H4**, analyse en M1, ajuster **SL, TP et
break-even**, objectif « **SL le plus serré possible, TP le plus large
possible** ». ~180 configurations supplémentaires.

## 8. Ce que le réglage donne — et pourquoi il ne vaut rien

### 8.1 « SL serré + TP large » ne produit pas un edge, mais une loterie

Grille SL(10→80) × TP(100→800), n=148 en IS : **une mer de négatifs.** Toute la
colonne TP ≥ 200 est négative sauf accidents isolés. Le coin demandé (SL 10 /
TP 500-800) plafonne à tStat 0,69 — et son voisin immédiat (SL 20 / TP 500) est
**négatif** : aucun plateau, donc rien à retenir.

La raison est arithmétique. Décomposition du R total (IS, n=148) :

| config | totalR | les 3 meilleurs trades | **sans ces 3 trades** |
|---|---|---|---|
| sl=10 / tp=500 + BE 25→+20 | +119,4 R | +49,8 · +49,8 · +49,8 R | **−30,0 R** |
| sl=10 / tp=500, sans BE | +77,4 R | idem | **−72,0 R** |
| sl=40 / tp=100 (le mieux classé) | +23,1 R | +2,5 · +2,5 · +2,5 R | +15,8 R |

Un R:R de 50 transforme chaque TP touché en **+49,8 R**. Trois jackpots sur 148
portent la totalité du résultat ; les 145 autres trades saignent. **Ce n'est pas
un edge, c'est une transformation de la variance** — et le tStat n'y signifie
plus rien (sa formule suppose une distribution à peu près normale, or elle est
ici écrasée par des valeurs extrêmes).

### 8.2 Le hors-échantillon confirme : 2 trades sur 75

Le meilleur jeu honnête de cette famille (`sl=10, tp=500, beOn, beTrigger=25,
beOffset=20`) ressort **positif** en OOS : avgR +0,624 · PF 1,63 · n=74. C'est
exactement le moment où un optimiseur naïf crie victoire. Décomposition :

| OOS (n=75, totalR **+45,0**) | totalR restant | avgR |
|---|---|---|
| sans **le seul** meilleur trade | **−4,8 R** | −0,065 |
| sans les 2 meilleurs | **−54,6 R** | −0,748 |
| sans les 5 meilleurs | −60,0 R | −0,857 |

**Deux trades sur 75** (deux TP à +49,8 R) portent tout. **62 trades sur 75 sont
perdants.** Retirer un seul jackpot suffit à faire basculer la stratégie dans le
rouge. Un edge ne tient pas à deux tirages.

### 8.3 Le SL serré est, en plus, une fiction d'exécution

- SL = 10 points, **spread = 2 points** → le spread mange **20 % du risque**.
- ATR M1 = 55 pts (IS) et **78 pts (OOS)** → un SL de 10 pts vaut **0,13× le
  mouvement d'une seule minute**.
- Mesuré sur les 148 trades : **99 % d'entre eux voient le prix s'écarter de plus
  de 10 points contre eux** dans les 8 h qui suivent l'entrée (98 % pour 20 pts,
  95 % pour 40 pts). Un SL de 10 points n'est pas un stop, c'est un péage.
- Le moteur remplit **exactement au niveau du stop, sans slippage**
  (`engine-contract.md` l'assume). Sur un stop de 10 pts avec des bougies M1 de
  78 pts, **chaque stop serait traversé par un gap intra-bougie dans la réalité** :
  les 62 perdants, tous modélisés à −1,00 R, coûteraient en vrai bien davantage.
  **Le résultat n'est pas seulement fragile, il est irréaliste.**

### 8.4 Le break-even : testé, il dégrade

Grille `beTrigger`(20→90) × `beOffset`(0→30) sur la base saine sl=40/tp=100 :

| | tStat |
|---|---|
| **sans BE** | **1,14** |
| meilleur BE *valide* (beTrigger 90, beOffset 30) | 1,07 |

**Toute la zone valide du break-even est en dessous du « sans BE ».** Le BE coupe
les rares gagnants qui auraient couru et ne sauve pas les perdants (qui sont
stoppés avant même d'atteindre le seuil). *Recommandation : laisser `beOn=false`.*

---

## 9. ⚠ BUG DU MOTEUR — un break-even mal réglé fabrique de l'argent

**Trouvé en poussant `beOffset` au-delà de `beTrigger`.** Ce n'est pas un défaut
de la stratégie : c'est un **bug du moteur de backtest**, et il invalide
silencieusement toute optimisation qui explore cette zone.

**Mécanisme :**

1. [trenderHarmony.js:230](lib/backtest/strategies/trenderHarmony.js#L230) place le
   stop de break-even à `entrée + beOffset`. Rien ne garantit `beOffset <
   beTrigger` : le stop peut donc atterrir **au-dessus du prix courant**.
2. [engine.js:75](lib/backtest/engine.js#L75) teste `m1.low <= sl` pour un achat.
   Si le stop est au-dessus du marché, la condition est **trivialement vraie**.
3. [engine.js:189](lib/backtest/engine.js#L189) clôture **au prix du stop** :
   `closePosition(hit === 'sl' ? position.sl : position.tp, …)` — donc **à un prix
   où le marché n'a jamais traité**.

**Preuve empirique** (sl=10, tp=500, beTrigger=25 — le BE s'arme dès +25 points) :

| beOffset | avgR | totalR | PF | tStat |
|---|---|---|---|---|
| 20 *(valide : < beTrigger)* | +0,807 | 119,4 | 1,88 | 1,18 |
| 100 | +1,401 | 207,4 | 2,53 | 3,63 |
| 200 | +3,766 | 557,4 | 5,11 | 5,12 |
| 500 | +10,861 | 1607,4 | 12,85 | 6,08 |
| **1000** | **+22,685** | **3357,4** | **25,76** | **6,41** |

L'espérance croît **linéairement avec l'absurdité du réglage** : le moteur clôture
des trades à +1000 points alors que le prix n'a jamais dépassé +25. Le tStat 6,41
aurait été, de loin, **le meilleur score de toute la mission** — un optimiseur
automatique l'aurait sélectionné et rapporté comme un edge spectaculaire.

**Correctifs (les deux sont souhaitables) :**

- **Moteur** — un stop placé du mauvais côté du marché doit être rejeté ou exécuté
  au prix du marché, pas au niveau du stop. Dans `checkStops`, ignorer un `sl`
  au-dessus (BUY) / en dessous (SELL) du prix courant ; ou, dans `closePosition`,
  remplir au pire de `sl` et `m1.open`, symétriquement au traitement déjà correct
  des ordres stop d'entrée ([engine.js:178-180](lib/backtest/engine.js#L178-L180),
  qui gère bien le gap avec `Math.max(pendingStop.price, m1.open)`).
- **Stratégie** — borner `beOffset < beTrigger` dans le schéma de paramètres.

**Portée :** ce chemin (`action: 'modify'`) n'avait **jamais été audité** —
la vérification empirique du moteur (`engine-contract.md`, 2026-07-13) portait sur
`ma-cross`, **sans break-even ni trailing**. L'affirmation « le moteur est fiable,
inutile de le suspecter » **ne couvre donc pas `modify`**. Toute stratégie
utilisant break-even ou trailing doit être re-vérifiée.

*Nota : le jeu retenu au §8.2 (`beOffset=20 < beTrigger=25`) est **hors zone de
bug**. Son OOS positif n'est pas dû à ce bug — il est dû aux 2 jackpots.*

---

## 10. « Entrée trop tôt ou trop tard ? » — la mesure

Diagnostic mené hors moteur : pour chacune des 148 entrées (IS), on suit le prix
réel minute par minute après l'entrée, **indépendamment de tout SL/TP**.

**Rendement moyen après l'entrée, dans le sens du trade (hors spread) :**

| horizon | 1 min | 5 min | 15 min | 30 min | 60 min | 120 min | 240 min | 480 min |
|---|---|---|---|---|---|---|---|---|
| moyenne (pts) | −1,8 | −3,0 | −7,4 | −4,3 | −1,2 | +8,5 | +57,4 | −5,6 |
| moyenne (ATR) | −0,04 | −0,07 | −0,17 | −0,10 | −0,03 | +0,20 | +1,34 | −0,13 |
| **% de trades en profit** | **47 %** | **52 %** | **51 %** | **47 %** | **50 %** | **51 %** | **53 %** | **48 %** |

**Réponse : ni trop tôt, ni trop tard — l'entrée ne porte aucune information.**

À **aucun** horizon, de la minute à huit heures, l'entrée ne bat le pile ou face.
Le taux de trades en profit reste collé à 50 % partout (47–53 %). Les rendements
moyens oscillent autour de zéro et changent de signe sans structure.

**Le test de symétrie le confirme :**

| | valeur | ce qu'une vraie entrée « trop tard » donnerait |
|---|---|---|
| meilleur point atteint **avant** le pire | **52 %** des trades | ≫ 50 % (le prix part en notre faveur puis se retourne) |
| délai médian jusqu'au **pire** point | 265 min | — |
| délai médian jusqu'au **meilleur** point | 249 min | ≪ le délai jusqu'au pire |
| MAE médiane / MFE médiane | −10,1 / +13,3 (× range M1) | asymétrie marquée |

52 % contre 48 %, 249 min contre 265 min : c'est une **marche aléatoire**. Une
entrée systématiquement trop tardive produirait une asymétrie franche (le prix
donne d'abord, puis reprend) ; une entrée trop précoce produirait l'inverse (le
prix prend d'abord, puis donne). **On n'observe ni l'une ni l'autre.**

**Conséquence directe, et c'est le point le plus important de ce rapport :**
*aucun réglage de SL, de TP ou de break-even ne peut créer une espérance positive
à partir d'une entrée sans information.* On ne peut que déplacer la variance
(loterie à R:R 50) ou payer le spread plus vite. Le problème n'est pas la sortie.
**Le problème est l'entrée.**

---

## 11. Défaut de conception ajouté (2ᵉ campagne)

*(complète le §5)*

7. **Le signal d'harmonie est un indicateur retardé appliqué à un actif sans
   mémoire.** L'alignement multi-HTF est construit sur des **Bollinger de closes
   HTF déjà clôturées** ([trenderHarmony.js:70](lib/backtest/strategies/trenderHarmony.js#L70),
   `out[i] = trend[j-1]`). Le code est **correct et non-repeint** — c'est
   justement le problème : au moment où l'harmonie est *confirmée*, le mouvement
   qui l'a créée **a déjà eu lieu**. Sur un instrument à trajectoire quasi
   markovienne (V75 est un indice synthétique de volatilité), il ne reste **rien**
   à exploiter — ce que le §10 mesure noir sur blanc : 50 % de réussite à tous les
   horizons. *Correction : aucune correction paramétrique n'existe. Il faut un
   signal qui anticipe l'alignement (p. ex. entrer sur pullback à l'intérieur
   d'une zone déjà active) plutôt qu'un signal qui le constate.*

---

## 12. Verdict de la 2ᵉ campagne

**Pas d'edge — confirmé, et pour une raison désormais mesurée.** Les HTF
M15/H1/H4 et le réglage SL/TP/BE demandé ne changent rien, parce que le défaut
n'est pas dans la sortie : **l'entrée est un pile ou face** (§10). Le seul jeu de
paramètres à OOS positif ne doit sa performance qu'à **2 trades sur 75** (§8.2),
avec un SL de 10 points **irréaliste à l'exécution** (§8.3). Le break-even
**dégrade** l'espérance (§8.4). Ne pas exploiter.

**À faire avant toute autre chose :** corriger le **bug du moteur** (§9) — il rend
non fiable toute optimisation impliquant un break-even ou un trailing, sur
n'importe quelle stratégie.

---
---

# ANNEXE 2 — HTF **M3/H1/H4** : le verdict change

Demande : refaire l'analyse avec **htf1=M3, htf2=H1, htf3=H4**.
**Ce jeu de HTF renverse la conclusion des deux premières campagnes.** Il ne
donne pas un edge exploitable, mais il donne — pour la première fois — un signal
**mesurablement différent du hasard**.

> **Avertissement méthodologique, à lire avant les chiffres.** L'OOS mai→juillet
> a été consulté **trois fois** au total. Il ne fonctionne plus comme un test hors
> échantillon. Pour compenser, cette campagne s'appuie sur une **fenêtre vierge —
> janvier→avril 2026 — jamais optimisée ni même regardée jusqu'ici**, et sur un
> **contrôle par entrée aléatoire** qui ne dépend d'aucun réglage.

## 13. Résultats

Paramètres : `htf1=M3, htf2=H1, htf3=H4, slPoints=40, tpPoints=100` (R:R 2,5),
tout le reste aux défauts. `beOn=false` (le BE dégrade, cf. §8.4).
n=564 en IS → budget honnête de **18 paramètres**, j'en règle **2**. Pour la
première fois de la mission, le budget n'est pas le facteur limitant.

| fenêtre | n | winrate | avgR | PF | maxDD (R) | tStat |
|---|---|---|---|---|---|---|
| **janv→avril (vierge)** | 1160 | 31,8 % | **+0,063** | 1,09 | 47,2 | 1,32 |
| IS mai→juin | 578 | 32,6 % | **+0,088** | 1,13 | 24,8 | 1,29 |
| OOS juin→juil | 296 | 33,2 % | **+0,109** | 1,16 | 27,0 | 1,17 |
| **période complète (6 mois)** | **2025** | **32,2 %** | **+0,079** | **1,11** | **47,2** | **2,16** |

**Trois fenêtres indépendantes, toutes positives, ~2000 trades.** Aucune
dépendance à une poignée de trades : le meilleur trade vaut **2,45 R** (le TP), et
retirer les 10 meilleurs laisse l'IS positif. C'est structurellement l'inverse de
la loterie du §8.

## 14. Le test décisif — le signal bat-il le hasard ?

Deux contrôles, tous deux par **décalage circulaire** du bloc d'entrées (conserve
le nombre, le groupement temporel et la séquence long/short ; détruit
l'alignement avec le marché — la dérive et le biais directionnel sont donc
neutralisés).

**Contrôle n°1 — rendement moyen après l'entrée : RIEN.**
Aux horizons 5, 15, 30, 60, 240 et 480 min, tous les |z| < 1,5, tous les p > 0,12.
L'entrée n'a **aucun pouvoir de prédiction directionnelle**.

**Contrôle n°2 — probabilité de barrière : c'est là qu'est le signal.**
Le backtest ne gagne pas sur le rendement moyen : il gagne si le prix touche
**+100 avant −40**. On mesure donc exactement cette probabilité (convention du
moteur reproduite : M1 par M1, SL prioritaire).

| fenêtre | entrées | winrate **signal** | winrate **hasard** | z | p |
|---|---|---|---|---|---|
| janv→avril (vierge) | 1160 | **31,8 %** | 29,6 % ± 1,4 | 1,58 | 0,120 |
| IS mai→juin | 570 | **32,6 %** | 29,7 % ± 2,0 | 1,49 | 0,142 |
| OOS juin→juil | 295 | **33,2 %** | 30,3 % ± 2,7 | 1,06 | 0,302 |

Le winrate d'équilibre d'une marche aléatoire à R:R 2,5 est de **28,6 %**. Le
hasard *avec le même biais directionnel* fait déjà 29,6–30,3 % (la dérive
haussière de V75 le porte). **Le signal ajoute +2,2 à +2,9 points de winrate
par-dessus.**

Aucune fenêtre n'est significative isolément. Mais les trois convergent, avec la
même amplitude. **Combinaison de Stouffer : z = 2,39, p ≈ 0,017.**

**Correction pour tests multiples :** ~7 jeux de HTF ont été examinés au cours de
la mission. Une correction de Bonferroni ramène p à **≈ 0,12**. Verdict statistique
honnête : **présomption d'un edge faible, pas une preuve.**

## 15. L'économie du réglage — c'est le spread qui décide

Sur les 2025 trades de la période complète :

| spread (pts) | 0 | 1 | **2** | 3 | 4 | 6 | 8 |
|---|---|---|---|---|---|---|---|
| avgR | +0,129 | +0,104 | **+0,079** | +0,054 | +0,029 | **−0,021** | −0,071 |
| tStat | 3,54 | 2,85 | **2,16** | 1,48 | 0,79 | −0,59 | −1,96 |

- L'edge **brut** vaut **+0,129 R = 5,2 points par trade** (1 R = 40 pts = le SL).
- Le **seuil de rentabilité est à ~5,2 points de friction totale**.
- Au spread de **2 points** (valeur que tu m'as donnée), il reste **+3,2 pts/trade**
  — soit **3,2 points de marge pour absorber le slippage**.
- **Le moteur ne modélise AUCUN slippage** (`engine-contract.md`). La stratégie
  prend **~11 trades par jour**. À cette fréquence, la qualité d'exécution *est* la
  stratégie.

**Conséquence : le chiffre le plus important de ce rapport n'est pas dans ce
rapport — c'est ta friction réelle tout compris.** Si elle dépasse ~5 points, il
n'y a rien. Si elle est vraiment de 2 points, il y a un edge mince mais réel.

## 16. Réponse actualisée : « entrée trop tôt ou trop tard ? »

Avec M3/H1/H4, **ni l'un ni l'autre — l'entrée est simplement faible**.

Elle est **correctement timée** (elle bat le hasard de +2,5 points de winrate sur
la barrière) mais **ne porte quasiment pas d'information directionnelle** (le
rendement moyen après l'entrée est indiscernable du hasard à tout horizon).
Autrement dit : elle ne dit pas *où va le prix*, elle dit seulement que *toucher
+100 avant −40 est un peu plus probable qu'au hasard*. C'est un edge de **chemin**,
pas de **direction**.

*(À noter, sans le surinterpréter : le pire point du trade arrive avant le
meilleur dans 59 % des cas — le prix tend à partir contre l'entrée avant de
revenir. Cela suggère une marge d'amélioration en entrant **plus tard**, sur un
repli. Hypothèse à tester, pas un gain acquis.)*

## 17. Verdict de la 3ᵉ campagne

**Edge fragile — pas « pas d'edge ».** Je corrige le verdict des §1 et §12 pour ce
jeu de HTF.

`trender-harmony` en **M3/H1/H4, SL 40, TP 100** sur V75 M1 produit un signal
**réel mais mince** : +2,5 points de winrate au-dessus d'une entrée aléatoire
appariée, confirmé sur trois fenêtres indépendantes dont une vierge, sur ~2000
trades. Ce n'est pas du bruit — mais ce n'est pas non plus statistiquement prouvé
après correction pour tests multiples (p ≈ 0,12).

**Ne pas exploiter en l'état**, pour une raison économique et non statistique :
l'edge brut ne vaut que **5,2 points par trade** et **aucun slippage n'est
modélisé**, à 11 trades/jour.

**Ce qu'il faut faire, dans l'ordre :**
1. **Obtenir la friction réelle** (spread moyen + slippage constaté) auprès du
   broker sur V75. C'est le seul chiffre qui décide. Au-delà de ~5 pts : abandonner.
2. **Corriger le bug du moteur** (§9) — indépendamment de cette stratégie.
3. Si la friction est < 3 pts : **test en avant** (forward test) sur données
   fraîches, seul juge restant, l'OOS étant brûlé.
