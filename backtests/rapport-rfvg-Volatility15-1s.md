# rFVG — Volatility 15 (1s) Index, M1

Optimisation des sorties (marge du stop, TP, break-even). Détection figée par
l'utilisateur, ~130 configurations testées.

## Cadrage

| | |
|---|---|
| Symbole | Volatility 15 (1s) Index (id 37), 296 603 bougies M1 |
| Période | 2026-01-01 → 2026-07-25 (206 jours) |
| In-sample | 2026-01-01 → 2026-05-25 (70 %) |
| Out-of-sample | 2026-05-25 → 2026-07-25 |
| Détection | rFVG, MM 49/51, corps ≥ 1 × ATR(14), corps 3e bougie ≤ 0,3 × ATR |
| Signaux | 3 159 (15,3/jour) — 1 593 haussiers / 1 566 baissiers |
| Spread | **0,552 pt** — médiane réelle lue dans `bars_m1.spread` (552 points MT5 × 0,001) |
| Risque structurel | médiane **7,13 pts**, étendue 5,0 → 14,2 (marge 5) |

Deux remarques de cadrage :

- **MM 49 / 51 rend la double condition MM dégénérée.** Les deux moyennes sont
  quasi confondues : exiger que la bougie centrale soit entièrement du bon côté
  des *deux* revient à n'en avoir qu'une (~SMA 50). Ce n'est pas une erreur, mais
  le second filtre ne filtre rien.
- **Le TP de 66 vaut 9,1 × le risque médian.** Le seuil de rentabilité tombe donc
  à ~7,5 % de réussite. Toute la stratégie tient sur « est-ce que 1 signal sur 13
  parcourt 66 points avant d'en perdre 7 ».

## Verdict

**Les réglages d'origine n'ont aucun edge, et le motif rFVG n'apporte aucune
information directionnelle sur cet instrument.**

Deux résultats indépendants le disent :

1. Espérance **+0,058 pt/trade** sur 2 095 positions, t = 0,14. Le net (+121 pts)
   tient à **54 % dans un seul trade**.
2. **Contrôle par décalage circulaire, hors échantillon : p = 0,512.** On rejoue
   exactement les mêmes signaux — même nombre, même répartition horaire, même
   proportion haut/bas, mêmes sorties — mais à des dates décalées, donc décorrélées
   du prix qui les a produits. Le résultat réel tombe **pile sur la médiane** de
   ces contrôles. Autrement dit : entrer à des dates au hasard aurait donné la
   même chose.

## Ce qui a été mesuré

### Le break-even à 10 points coûte de l'argent

| beTriggerPts | n | espérance | t |
|---|---|---|---|
| **0 (coupé)** | 1 226 | **+0,305** | 0,48 |
| 5 | 1 635 | −0,426 | −1,12 |
| **10 (le tien)** | 1 451 | +0,056 | 0,11 |
| 15 → 40 | ~1 300 | −0,05 à −0,39 | — |
| 50 | 1 255 | +0,132 | 0,21 |

717 positions sur 2 095 sortent au BE. À niveau 0, une sortie BE rend
exactement 0 **brut** — donc **−0,552 net**, le spread. Le BE ne protège pas :
il transforme des trades en pertes de spread, gagnantes comprises. Coupé, il
rend 0,25 pt/trade. Les autres formes (BE sur retours, BE sur durée, niveau
positif) sont toutes négatives ou nulles.

### La marge du stop : 5 est un sommet, pas un plateau

Grille TP × marge (t-stat, in-sample). Seule la bande 5–6 est positive ;
elle s'effondre de part et d'autre.

| marge \ TP | 20 | 30 | 40 | 50 | 66 | 80 | 100 | 130 |
|---|---|---|---|---|---|---|---|---|
| 2 | −2,52 | −1,98 | −0,86 | −0,33 | −0,54 | −0,36 | 0,18 | 0,06 |
| 4 | −2,16 | −1,61 | −0,36 | −0,15 | −0,07 | 0,13 | 0,41 | 0,25 |
| **5** | −1,92 | −0,96 | 0,49 | 0,45 | 0,46 | 0,38 | 0,92 | **1,58** |
| 6 | −2,17 | −1,31 | 0,08 | 0,13 | 0,20 | 0,44 | 1,02 | 0,84 |
| 8 | −2,43 | −1,61 | −0,29 | −0,20 | −0,45 | −0,27 | 0,44 | 0,43 |
| 10 | −2,68 | −2,05 | −0,67 | −0,56 | −0,98 | −0,48 | −0,04 | −0,03 |
| 14 | −2,42 | −2,09 | −1,04 | −1,46 | −1,22 | −0,66 | 0,15 | 0,13 |

**Toute la colonne TP ≤ 30 est significativement négative** (t jusqu'à −2,7).
Ce n'est pas le motif qui échoue : à TP 20, le spread de 0,552 représente 2,8 %
de l'objectif pour un seuil de rentabilité de 26 %. C'est le coût qui mange tout.

### Ce qui n'apporte rien

| variante | espérance IS | vs référence |
|---|---|---|
| trade unique **coupé** | +0,054 | −0,26 — le garder |
| direction haussière seule | −0,584 | à écarter |
| direction baissière seule | +0,848 | t = 1,00, choisir après avoir vu = 1 chance sur 2 |
| mèche de rejet sur B3 (`wick3`) | −0,715 | à écarter |
| plafond de durée 5 → 120 bougies | −0,02 à −0,53 | tue toutes les gagnantes |
| résolution M1 au lieu de bougie | identique | 0 sortie ambiguë : TP et SL ne se croisent jamais |

Le plafond de durée mérite un mot : à TP 66, le **winrate tombe à 0 %** dès qu'on
borne à 120 bougies. Les gagnantes sont **lentes** — durée médiane 16 bougies pour
les perdantes, mais les gagnantes courent des centaines de bougies. C'est le
profil « beaucoup de petites pertes, une grosse gagnante de temps en temps ».

## Le meilleur réglage trouvé — et pourquoi il ne prouve rien

`slMarginPts 5 · tpPts 130 · BE coupé · trade unique`

| | in-sample | out-of-sample | complet |
|---|---|---|---|
| n | 795 | 375 | 1 172 |
| espérance | +2,03 | +2,74 | +2,24 |
| t | 1,60 | 1,44 | — |
| facteur de profit | — | 1,37 | — |
| net | — | +1 015 pts | +2 627 pts |

Sa **santé statistique est bonne** : meilleur trade = 4,9 % du net (contre 54 %
pour les réglages d'origine), 6 mois positifs sur 7, meilleur mois = 30 % du net,
survit au spread ×3 (+1,14). Sur des blocs de 100 trades consécutifs :
**9 blocs gagnants sur 11**, médiane **+298 pts**, pire bloc −391.

**Et pourtant le contrôle par décalage circulaire le tue :**

| fenêtre | réel | médiane des contrôles | p95 des contrôles | p empirique |
|---|---|---|---|---|
| in-sample | +2,03 | −0,22 | +2,02 | 0,058 |
| **out-of-sample** | **+2,69** | **+1,51** | +4,87 | **0,264** |

Hors échantillon, des entrées à des dates **aléatoires** avec la même géométrie
de sortie rapportent **+1,51 pt/trade** de médiane, et **26 % d'entre elles font
mieux que le vrai signal**. Le motif n'ajoute rien.

**D'où vient alors le +2 627 pts ?** De la mécanique du stop, pas du motif. Le
stop est posé à la clôture de B4 sous l'extrême B3-B4 — c'est-à-dire **sous un
plus-bas que le prix vient de ne pas franchir**, et pendant tout B4 la position
n'est pas protégée du tout. Contre un TP très lointain sur un indice synthétique,
cette géométrie a une espérance légèrement positive **quelle que soit la date
d'entrée**. C'est réel, c'est tradeable, mais ça n'a rien à voir avec le rFVG :
n'importe quel déclencheur donnerait le même résultat.

## Recommandations

1. **Coupe le break-even.** C'est le seul gain net, immédiat et sans ambiguïté :
   +0,25 pt/trade, et l'argument ne dépend d'aucune statistique subtile — un BE à
   niveau 0 fait sortir à −1 spread, par construction.
2. **Ne trade pas les réglages d'origine.** +0,058 pt/trade avec un drawdown de
   −830 pts et 55 pertes d'affilée : le ratio est intenable, et le contrôle dit
   que c'est du bruit.
3. **Si tu veux exploiter le TP 130**, sache que tu tradées la géométrie du stop,
   pas le motif. Deux conséquences : (a) tu peux relâcher la détection pour avoir
   plus de signaux sans rien perdre ; (b) le jour où l'instrument change de
   régime de volatilité, rien ne t'avertira, parce qu'il n'y a pas de motif à
   surveiller.
4. **Piste non testée qui mérite de l'être** : le filtre de la 3e bougie
   (`atrMult3 = 0,3`) et les MM 49/51 n'ont jamais été comparés à leurs
   alternatives — la détection était figée. Si le motif doit porter de
   l'information, c'est là qu'il faut chercher, pas dans les sorties.

## Méthode et limites

- 130 configurations testées. Le risque de surapprentissage croît avec ce nombre :
  un p de 0,05 trouvé après 130 essais est attendu ~6 fois par pur hasard.
- Un seul cycle de re-réglage après avoir vu l'out-of-sample (les candidats C/D/E),
  **déclaré ici**.
- La configuration « TP 100 + cooldown 3 » atteint p = 0,025 hors échantillon —
  mais son in-sample est *moins bon* que celui de TP 100 seul (0,618 vs 0,883), et
  son p in-sample est 0,240. Une significativité qui n'apparaît que dans la
  fenêtre où on l'a cherchée est un artefact de sélection, pas un edge. Écartée.
- Le contrôle par décalage circulaire ne casse **pas** la saisonnalité
  intra-journalière ni l'autocorrélation de volatilité — c'est voulu : ce sont
  précisément les effets qu'on refuse de confondre avec le motif.
