# Rapport — `eq-balance` (EQ, Point d'équilibre) · BTCUSD / XAUUSD / V75 · M5

Période : 2026-01-04 → 2026-07-12 · IS 2026-01-04 → 05-15, OOS 05-15 → 07-12
Spread : 0 (test théorique, demandé) · **106 runs, 84 configurations distinctes**
Trois thèses testées en parallèle (`revert`, `breakout`, `failed`) : la
multiplicité est réelle et elle est prise en compte dans le verdict.

---

## 1. Verdict

**Pas d'edge.** Les deux configurations qui paraissaient rentables s'expliquent
chacune par un artefact identifié et reproductible — la dérive du marché sur
BTCUSD, le séquencement des positions sur le V75. Aucune ne survit à un contrôle
sérieux. **Ne pas exploiter.**

L'OOS *passe* pourtant sur les deux marchés (BTCUSD avgR +0,379 ; V75 +0,230).
C'est précisément ce qui rend ce cas intéressant : **un OOS positif ne suffit
pas** quand la fenêtre OOS rejoue le même régime que l'IS.

---

## 2. Ce qui a été testé

| Thèse | Baseline IS (défauts) | Après balayage |
|---|---|---|
| `revert` — fade du bord de la valeur vers le point | n=92, avgR **−0,122** | meilleur plateau : seuil 60, avgR +0,153 |
| `breakout` — sens de la cassure | n=256, avgR **−0,029** | plateau faible 50-60, avgR ≈ +0,05 (tStat 0,7) |
| `failed` — retour dans la valeur | n=135, avgR **0,000** | échantillon s'effondre (n=35 → 9 → 2) |

Signature de départ, très parlante : avec un R:R de 1,5 le winrate d'équilibre
est exactement 40 %. Les trois modes atterrissent à 34,8 %, 38,7 % et **40,0 %**
— sur ou sous la ligne du pile-ou-face. C'est le profil d'entrées sans
information.

### Le score EQ n'améliore pas les entrées

Balayage de `entryScore` (0 → 85), zones ouvertes dès 40 :

- `revert` : +0,018 → +0,042 → −0,009 → −0,083 → +0,056 → −0,015. **Aucune
  monotonie.** Exiger un score élevé au moment d'entrer ne rend pas les entrées
  meilleures.
- `breakout` / `failed` : l'échantillon fond avant qu'une tendance n'émerge.

C'est un résultat en soi, et il est cohérent avec la calibration de l'indicateur
(cf. `docs/equilibrium.md`) : le score dit quand un point est un attracteur
statistiquement crédible, pas quand le prix va tourner.

---

## 3. Les deux faux edges, disséqués

### a) BTCUSD — c'est la dérive, pas le signal

Meilleure configuration IS : `revert`, seuil 60, lookback 60, slMult 1, tpRR 2.

| | n | win% | avgR | PF | tStat |
|---|---|---|---|---|---|
| IS | 205 | 42,0 | +0,263 | 1,50 | 2,54 |
| **OOS** | 87 | 46,0 | **+0,379** | 1,55 | 2,35 |
| spread ×3 | 205 | 42,0 | +0,258 | 1,49 | 2,49 |
| `direction=long` | 157 | 30,6 | **−0,078** | 0,88 | −0,70 |
| `direction=short` | 144 | 43,1 | **+0,292** | 1,54 | 2,35 |

Tout l'edge est du côté **vendeur**. Or BTCUSD a chuté de **9 547 points sur
l'IS** et de **17 266 points de plus sur l'OOS** : les deux fenêtres sont
baissières. L'OOS ne teste donc pas la thèse, il rejoue le même régime — un
simple biais short le franchit sans rien savoir du marché.

### b) Volatility 75 — c'est le séquencement, pas le signal

Le V75 est une marche aléatoire par construction : la dérive ne peut rien
expliquer ici. Les mêmes paramètres figés :

| | n | win% | avgR | tStat |
|---|---|---|---|---|
| IS | 249 | 37,8 | +0,133 | 1,44 |
| **OOS** | 101 | 41,6 | **+0,230** | 1,57 |
| `direction=long` seul | 184 | 34,2 | **+0,027** | 0,26 |
| `direction=short` seul | 162 | 32,7 | **−0,019** | −0,17 |

**Aucune des deux directions n'a d'edge, mais leur entrelacement en produit un.**
Ce n'est arithmétiquement possible que parce qu'une position ouverte bloque les
signaux suivants : en mode `both`, le sous-ensemble de trades réellement pris
est une sous-suite filtrée par l'occupation de la position. C'est ce filtrage —
pas le signal — qui fabrique la performance. Un edge qui n'existe dans aucune
direction prise isolément n'est pas un edge.

Rappel théorique qui aurait dû alerter plus tôt : sur une martingale, le théorème
d'arrêt impose un taux de réussite de 1/(1+R:R) = **33,3 %** pour un SL de 1R et
un TP de 2R, *quelle que soit* la règle d'entrée. Toute règle qui affiche
durablement mieux sur un V75 mesure un artefact, pas une compétence.

### c) Les autres marchés : rien

| marché | dérive (full) | avgR | tStat |
|---|---|---|---|
| XAUUSD | −245 | +0,096 | 0,97 |
| Trek Up | +228 | +0,013 | 0,16 |
| Step Index 500 | −3 124 | −0,029 | −0,38 |

Le contrôle par **inversion des signaux** confirme le diagnostic : sur BTCUSD
(+0,295 → −0,072) et V75 (+0,161 → −0,046) inverser tue l'edge — il y a bien un
contenu directionnel, mais on vient de voir d'où il vient. Sur XAUUSD, inverser
donne **+0,026 : positif dans les deux sens**, donc rien du tout.

---

## 4. Fragilités structurelles

- **`lookback` est un pic isolé.** 30 → −0,043 · 45 → +0,014 · **60 → +0,153** ·
  80 → −0,135 · 100 → −0,176 · 140 → −0,305. Le seul réglage qui marche est
  entouré de valeurs franchement perdantes. La règle du plateau l'interdit.
- **Sur-spécificité au timeframe.** 5m : +0,263 · 3m : +0,077 · 10m : −0,171.
  Aucun timeframe voisin n'est rentable.
- **`tpRR` monte de façon monotone** (0,5 → −0,002 jusqu'à 3,0 → +0,299), sans
  retournement. Avec un SL de 1 vaW, un TP à 2-3 R vise **très au-delà du
  point** : la configuration « gagnante » a cessé d'être la thèse de l'équilibre.
  Ce n'est plus « le prix revient au point juste », c'est « fade l'extrême et
  laisse courir ». Le trade a changé de nature en cours d'optimisation.
- **84 configurations distinctes.** Un tStat de 2 à 3 quelque part dans ce lot est
  attendu par pur hasard.

---

## 5. Défauts et manques de la stratégie

**Défauts corrigés en cours de mission** (signalés pour la traçabilité) :

1. `entryScore` n'était appliqué qu'en mode `revert` — silencieusement mort dans
   les deux autres. Corrigé : en `breakout`/`failed` le score à la cassure est
   effondré par construction, le filtre porte donc désormais sur la **qualité de
   la balance qui vient d'être cassée** (son score à la reconnaissance).
2. Le filtre `direction` s'appliquait avant l'inversion, rendant le contrôle
   asymétrique. Corrigé.

**Manques, par ordre d'importance :**

1. **Aucune gestion de l'occupation de position.** `if (position) return null` :
   les signaux émis pendant un trade ouvert sont perdus. C'est ce qui fabrique
   l'artefact du V75. Il faudrait soit une file d'attente, soit autoriser le flip,
   soit — le plus propre — **évaluer chaque direction indépendamment** pour que
   l'espérance mesurée soit celle du signal et non celle du séquencement.
2. **Pas de filtre de volatilité ni de session.** Le moteur ne sait pas filtrer
   les heures : les ventilations `byHour` sont diagnostiques uniquement. « Ne
   trader que la session européenne » serait une **évolution du moteur**, pas un
   réglage — et l'annoncer comme un gain acquis serait du surapprentissage sur le
   passé.
3. **Pas de trailing ni de sortie sur invalidation.** Une position ouverte en
   `revert` ne se ferme pas quand la balance qui la justifiait est cassée. C'est
   incohérent : la thèse est morte, le trade continue.
4. **Le mode `failed` est sous-échantillonné** (n=35 au mieux). Il faudrait une
   période bien plus longue ou un TF plus bas pour le juger.
5. Le biais de remplissage du moteur (SL rempli *au niveau du stop* même sur un
   gap) est optimiste, et il flatte toutes les stratégies à stop serré. Il ne crée
   pas l'artefact décrit ici mais il gonfle légèrement tous les chiffres.

---

## 6. Ce qu'il faudrait faire avant de réessayer

- **Un contrôle par rebattage** intégré au backtest (importer une série à
  rendements rebattus comme symbole synthétique et y rejouer la stratégie). C'est
  le seul juge fiable, et c'est déjà la méthode qui a servi à calibrer
  l'indicateur.
- **Tester chaque direction séparément**, systématiquement — l'artefact du V75
  serait apparu tout de suite.
- **Exiger une fenêtre OOS de régime différent.** Ici les deux fenêtres BTCUSD
  sont baissières : l'OOS n'était pas un test.
- Ne pas ré-optimiser après avoir vu l'OOS. Il ne l'a pas été.
