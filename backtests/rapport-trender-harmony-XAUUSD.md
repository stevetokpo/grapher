# trender-harmony · XAUUSD · 15m — rapport d'optimisation

Période demandée : janvier → juillet 2026 · spread 0,3 · warm-up 35 j
IS : 2026-02-05 → 2026-05-22 · OOS : 2026-05-22 → 2026-07-12 (jamais optimisé)
≈ 210 configurations évaluées.

> Janvier est intégralement consommé par le warm-up : le plus lent des
> indicateurs (Bollinger 50 sur H16) exige ~33 jours de bougies avant le premier
> signal valide, et les données XAUUSD commencent au 2026-01-01. La fenêtre
> réellement exploitable démarre donc au 5 février.

---

## 1. Verdict

**Pas d'edge.** L'espérance hors échantillon reste positive (avgR +0,220) mais
elle provient **entièrement du côté short dans un marché qui baisse**, et la
stratégie capture moins d'un sixième de cette baisse : un short passif, sans
aucun signal, aurait rapporté **+424 points** là où la stratégie optimisée en
rend **+62**. Le signal d'harmonie multi-HTF n'apporte pas d'information
directionnelle démontrable sur cet instrument. Ne pas exploiter en l'état.

---

## 2. Paramètres

Le jeu retenu à l'issue de l'optimisation in-sample (figé **avant** de regarder
l'OOS) :

| Paramètre | Défaut | Retenu | Pourquoi |
|---|---|---|---|
| `slPoints` | 50 | **10** | plateau 8–12 ; le défaut vaut 4,7× l'ATR 15m (10,7 pts) — hors d'échelle |
| `tpPoints` | 100 | **40** | plateau 40–50 (R:R ≈ 4) ; le défaut vaut 9,3× l'ATR |
| `bbLen` | 50 | **20** | le défaut ne produit que 19 trades sur 3,5 mois — échantillon non concluant |
| `bbMult` | 0,369 | *(inchangé)* | balayage plat et non monotone → bruit, aucun gain |
| `direction` | both | *(inchangé)* | voir §4 : la « symétrie » long/short est un artefact de fenêtre |
| `confFlt`, `beOn`, `rvOn`, HTF | défauts | *(inchangés)* | budget de liberté épuisé (voir ci-dessous) |

**Budget de surapprentissage dépassé.** 3 paramètres réglés (`bbLen`,
`slPoints`, `tpPoints`) pour n=65 trades IS, soit un budget honnête de
65/30 ≈ 2,2. Nous sommes déjà au-delà — et c'est en soi un motif de méfiance
envers les chiffres IS.

---

## 3. Résultats

| | trades | winrate | avgR | totalR | PF | maxDD (R) | tStat |
|---|---|---|---|---|---|---|---|
| Baseline (défauts), IS | 19 | 26,3 % | −0,312 | −5,9 | 0,58 | 9,1 | −1,09 |
| Optimisé, IS | 65 | 29,2 % | +0,432 | +28,0 | 1,59 | 10,5 | 1,52 |
| **Optimisé, OOS** | **28** | **25,0 %** | **+0,220** | **+6,2** | **1,28** | **7,2** | **0,53** |

Contexte :

- spread 0,3 appliqué partout ; ATR14 médian 15m = **10,7 pts** (IS), 8,6 pts (OOS) ;
- **benchmark** : XAUUSD **baisse sur les deux fenêtres** (IS −477 pts, OOS
  −424 pts). L'OOS n'est donc pas un régime indépendant, c'est la **continuation
  du même marché baissier** — un test de robustesse bien plus faible qu'il n'y paraît ;
- OOS : n=28 < 30 → **sous le seuil de conclusion** fixé par la méthode ;
- tStat IS = 1,52, soit en dessous du seuil de présomption (~2) — et il s'agit du
  **meilleur de ~210 configurations**, ce qui gonfle mécaniquement le score.

### Le chiffre qui tranche

| | stratégie optimisée | short passif (aucun signal) |
|---|---|---|
| IS | +280 pts (65 trades) | **+477 pts** |
| OOS | +62 pts (28 trades) | **+424 pts** |

La stratégie sous-performe le benchmark trivial d'un facteur 1,7 en IS et **6,8
en OOS**, tout en payant le spread et en encaissant 10,5 R de drawdown. *(Nuance
honnête : le short passif est exposé en permanence et sans stop, son risque n'est
pas borné — la comparaison n'est pas à risque égal. Mais elle suffit à établir que
le signal ne bat pas la dérive qu'il chevauche.)*

---

## 4. Robustesse

| Test | Résultat | Lecture |
|---|---|---|
| OOS | avgR +0,220 · n=28 | positif mais **n < 30** → non concluant ; dégradation IS→OOS de **−49 %** |
| Spread ×2 / ×3 | avgR +0,402 / +0,372 | ✔ résiste aux coûts (SL serré, spread marginal) |
| Concentration mensuelle | **59 %** du R total sur avril (IS) | à la limite du seuil de rejet (60 %) |
| TF voisins | 10m : +0,053 · 20m : +0,201 | s'effondre à 10m → réglage sur-spécifique au TF |
| Direction (IS) | long +0,470 (n=30) · short +0,399 (n=35) | *semble* symétrique → rassurant… |
| **Direction (OOS)** | **long −1,030 (n=4, 0 % de réussite)** · short +0,428 (n=24) | **…démenti hors échantillon** |

**C'est la ligne décisive.** En IS, les deux sens étaient rentables et
équilibrés — ce qui plaidait contre une simple capture de dérive. Hors
échantillon, le côté long se réduit à 4 trades, **tous perdants**, et la totalité
du profit vient des 24 shorts pris dans un marché en baisse. La symétrie
in-sample était elle-même un artefact de la fenêtre. Ce qui reste, c'est :
« être short quand ça baisse » — mal, et pour 15 % de la baisse disponible.

---

## 5. Défauts de la stratégie

*(audit de `lib/backtest/strategies/trenderHarmony.js`)*

**Ce qui est sain** — à dire aussi : **aucun lookahead**. `htfTrendPerBar`
(l. 73-80) renvoie `trend[j-1]`, la dernière bougie HTF *clôturée*, ce qui
reproduit correctement l'idiome non-repeint du Pine
(`request.security(expr[1], lookahead_on)`). Le warm-up est implicitement géré :
`trend` vaut 0 avant `bbLen` bougies, donc aucune harmonie, donc aucun signal.

1. **SL/TP en points fixes — le défaut de conception principal** (l. 100-101).
   Les défauts `slPoints=50` / `tpPoints=100` valent **4,7× et 9,3× l'ATR 15m**
   de XAUUSD : hors d'échelle. Symptôme mesuré : 19 trades en 3,5 mois et une
   espérance de −0,31 R. Un SL/TP en **multiple d'ATR** serait portable d'un
   instrument et d'un régime à l'autre ; ici l'ATR est passé de 10,7 (IS) à 8,6
   (OOS), si bien que le SL=10 retenu a **silencieusement glissé** de 0,93×ATR à
   1,16×ATR entre les deux fenêtres. *Correction : remplacer `slPoints`/`tpPoints`
   par `slAtrMult`/`tpRR`.*

2. **La distance du stop agit comme un filtre de signal — couplage non voulu.**
   La stratégie n'ouvre qu'au *début* d'une zone d'harmonie, et tout signal
   survenant alors qu'une position de **même sens** est déjà ouverte est
   **silencieusement ignoré** (l. 219). Conséquence : un SL large maintient les
   positions ouvertes longtemps et **avale les signaux suivants**. C'est pourquoi
   le nombre de trades passe de **19 (SL=50) à 65 (SL=10) à signal identique**.
   Régler le SL, c'est donc aussi régler la fréquence d'entrée — un couplage qui
   rend l'espace de paramètres trompeur, et qui explique la surface de score
   incohérente (deux « optima » contradictoires : SL minuscule/TP large *et* SL
   large/TP serré).

3. **Aucun filtre de régime ni de volatilité.** Le côté long perd −1,03 R par
   trade hors échantillon parce que rien n'empêche la stratégie d'acheter dans une
   tendance de fond baissière. L'alignement HTF est censé jouer ce rôle — il ne le
   joue pas.

4. **`st.beAppliedId` n'est jamais remis à zéro** (l. 160, 224). Comparé à
   `position.id`, il fonctionne, mais conserve indéfiniment l'id de la dernière
   position passée au break-even. Bénin aujourd'hui, fragile si la gestion d'id
   change.

5. **Surface de réglage inexploitable.** `beOn`, `rvOn`/`rvRR`/`rvMaxBars`,
   `confFlt`, `htf1/2/3` ajoutent ~8 paramètres libres. Avec 65 trades, le budget
   honnête est de 2, déjà dépassé. Ces options ne sont pas *testables* sur cet
   échantillon : les activer ne produirait que du surapprentissage. (`confFlt`
   l'illustre : le filtre « HTF 3 » affiche avgR +0,315… sur **9 trades**.)

---

## 6. Manques

**De la stratégie :**

- **exits** : avec un R:R de 4 et 29 % de réussite, tout repose sur un TP fixe.
  Il manque un **trailing** (ATR) pour laisser courir les gagnants — c'est le
  levier le plus évident et il est absent ;
- **filtre de volatilité** et **filtre de régime** (voir défaut 3) ;
- **asymétrie long/short non exploitée** : la stratégie est structurellement
  symétrique alors que le marché ne l'est pas.

**Du moteur (donc non testable en l'état — à ne créditer d'aucun gain) :**

- pas de **filtre de session/heure** : les ventilations `byHour`/`byDayOfWeek`
  sont *diagnostiques*, aucun paramètre ne les exploite. « Ne trader que
  8h–16h » serait une **hypothèse à tester**, pas un réglage disponible ;
- pas de **sizing en capital**, pas d'**ordres limites**, pas de **pyramidage** ;
- pas de **slippage** ni de spread variable : **la réalité sera pire** que ces
  chiffres, déjà négatifs contre le benchmark.

---

## 7. Prochaines expériences

1. **Passer SL/TP en multiples d'ATR** (`slAtrMult`, `tpRR`) dans
   `trenderHarmony.js`. *Hypothèse falsifiable :* le réglage devient portable
   d'un instrument et d'un régime à l'autre, et la fréquence d'entrée cesse de
   dépendre de la distance du stop (défaut 2). C'est un prérequis à toute
   optimisation sérieuse, pas une amélioration de performance.

2. **Contrôle par entrée aléatoire.** Construire une stratégie témoin qui prend
   le *même nombre* de trades, avec les *mêmes* SL/TP, à des dates aléatoires.
   *Hypothèse falsifiable :* si le témoin égale trender-harmony, le signal
   d'harmonie ne porte aucune information — ce que ce rapport suggère déjà. C'est
   le test le plus rentable : il tranche définitivement.

3. **Tester sur un instrument sans dérive** (p. ex. Range Break 200 Index).
   *Hypothèse falsifiable :* si la stratégie n'est rentable que sur les
   instruments qui dérivent, c'est un proxy de dérive et non un edge de tendance.

---

## Incident à signaler

En cours de mission, le répertoire **`backtests/` a été supprimé par un processus
externe** (vers 00:09), emportant le `ledger.jsonl` **préexistant** — il ne se
trouve pas dans la corbeille. Ni le runner (`bt.mjs`, qui ne fait que créer et
ajouter), ni un hook, ni un script du dépôt n'expliquent cette suppression. Le
`ledger.jsonl` actuel a été reconstruit à partir de ce point et ne contient que
136 des ~210 runs de la mission. Par ailleurs, le **disque est plein à 98 %**
(2,7 Go libres), ce qui a probablement causé les deux erreurs HTTP 500
transitoires observées pendant les balayages.
