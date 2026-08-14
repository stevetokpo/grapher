# Boom · RSIER — vendre la survente d'un Boom, et ce que ça vaut vraiment

Script `lib/scripts/library/boomRsier.js`, écrit pour **Boom 1000 Index en M1** et
pour lui seul. Il joue les surventes du motif RSIER du panneau Patterns, à la
vente, avec une gestion de compte qui ressemble à celle qu'on tient vraiment sur
un instrument à spikes.

Auto-contrôle : `npm run boom-test` (assertions), `npm run boom-test -- --data
bougies.json` (run réel sur un export M1).

---

## Ce que l'instrument est, mesuré et non supposé

Sur 323 849 bougies M1 de Boom 1000 (1er janvier → 13 août 2026) :

| Mesure | Valeur |
|---|---|
| Prix | 13 000 → 17 300 |
| Bougie M1 médiane | 0,87 point d'amplitude |
| Descente médiane par minute | 0,86 point |
| **Spread écrit par le broker** | **1,45 point** (médiane), 1,58 au p90 |
| Spikes (> 17,33 pts de hausse en une minute) | 6 617, soit 2,0 % des bougies |
| Taille médiane d'un spike | 24,2 points |
| Minutes entre deux spikes | 34 (médiane), 6 au p10 |
| Ticks d'une bougie de spike | **59 — comme une bougie normale** |
| Part du spike rendue avant la fin de la minute | **2 %** (médiane) |

Les deux dernières lignes sont celles qui décident de tout. Une minute de Boom
porte 59 ticks, spike ou pas : **le bond est un tick unique**. Et le prix ne
redescend pas dans la minute — il saute et reste. Un stop posé au-dessus d'une
vente n'est donc jamais servi au prix demandé : il est servi au premier prix
traité **après** le saut, c'est-à-dire tout en haut.

Le spread, lui, vaut 1,45 point : **plus qu'une bougie M1 médiane entière**. Un
backtest à spread nul offre gratuitement une minute et demie de dérive à chaque
position.

---

## Le montage : poche et réserve

Un stop ne borne pas une perte sur cet instrument. La seule borne dure, c'est ce
qu'il y a sur le compte — le broker ne peut pas prendre plus.

```
RÉSERVE (hors du broker)          POCHE (chez le broker)
capital − poche au départ    ───► exactement `poche` avant CHAQUE position
         ▲                        │
         └──── tout le surplus ───┘   (retiré dès la position fermée)
```

- avant chaque entrée, le solde est remis à `poche` : on complète depuis la
  réserve, ou on retire le surplus vers elle ;
- ce qui est en réserve n'est exposé à rien — ni à la marge, ni au stop out, ni
  au spike ;
- une poche vidée ne ruine pas le joueur : elle est rechargée à la position
  suivante (`onRuin`), et le script ne s'arrête que quand la RÉSERVE ne suit
  plus.

**Ce montage n'a de sens que si la poche est un vrai solde séparé.** Si tout
l'argent dort sur le même compte, rien n'est borné à la poche : une perte
mord sur le capital entier, et les chiffres ci-dessous s'inversent.

Côté moteur, trois choses ont été ajoutées pour que ça se simule honnêtement
(`lib/scripts/account.js`, `engine.js`) :

| Ajout | Ce qu'il fait |
|---|---|
| `api.withdraw` / `api.deposit` | l'argent sort du compte et n'est plus exposé ; le **patrimoine** (= équité + argent sorti) devient la grandeur suivie pour le pic et le drawdown |
| `negProtect` | une perte plus grosse que le solde le laisse à ZÉRO — et ce qui a été effacé est compté (`pertesEffacees`) |
| `slipPct` | part du chemin parcouru **au-delà** du stop réellement payée : 0 % = servi au niveau, 100 % = servi au pire prix de la bougie |
| `onRuin` | le script a la parole avant que la ruine soit déclarée : s'il recharge, la partie continue |

Sans mouvement de caisse, tous les scripts existants gardent exactement leurs
chiffres d'avant.

---

## Le résultat, et il tient dans une colonne

Capital 500 $, poche 7,50 $, risque 5 $, SL 17,33 pts, TP au RR 1,5 (26 pts),
spread 1,45, lot minimum 0,2 (Deriv) → **0,28 lot**, soit 4,85 $ de risque réel
et 7,28 $ d'objectif. RSIER : RSI 7 en M1, survente ≤ 20. 4 265 positions,
50,4 % de réussite dans tous les cas — le glissement ne change pas QUI gagne,
seulement COMBIEN coûte une perte.

| Glissement | Patrimoine final | Profit net | Drawdown max | **Pertes effacées** | Poches cramées |
|---|---|---|---|---|---|
| 0 % | 4 084 $ | +3 584 $ | 113 $ | 35 $ | 17 |
| 25 % | 2 805 $ | +2 305 $ | 203 $ | 49 $ | 38 |
| 50 % | 1 795 $ | +1 295 $ | 288 $ | 333 $ | 356 |
| 75 % | 1 202 $ | +702 $ | 437 $ | 1 034 $ | 686 |
| **100 % — le cas réel** | **827 $** | **+327 $** | **561 $** | **1 952 $** | **920** |

À 100 %, le profit de 327 $ n'est pas gagné sur le marché : la stratégie a perdu
**1 625 $** (327 − 1 952) et le broker en a effacé 1 952 en floorant 920 poches à
zéro. Le « gain » est un transfert, pas un edge. Et il suppose de recharger la
poche **quatre à cinq fois par jour ouvré** — ce qu'aucun compte réel ne laisse
faire sans friction.

---

## Le motif n'y est pour rien

Contrôle par décalage circulaire : les mêmes entrées, décalées de 500 à 233 000
bougies dans le temps, jouées avec les mêmes règles.

```
RSIER                      espérance +2,973 pts / position
mêmes règles, décalées     espérance +2,875 pts  (écart-type 0,223 sur 12 décalages)
                                            → z = 0,44
```

Une entrée prise **n'importe quand** rapporte autant. Ce que mesure ce backtest
n'est pas « le RSI en survente prédit une baisse », c'est « vendre un Boom avec
un stop à 17 points et un objectif à 26 gagne 60 % du temps, parce que
l'instrument descend par petits pas et monte par bonds ». Le RSI ne fait que
choisir des instants, et n'importe quel autre choix ferait pareil.

Régler les seuils du RSI, la période ou l'unité de temps ne changera donc rien
d'autre que le nombre de positions. Ce qui déplacerait vraiment le résultat, dans
l'ordre :

1. **la distance du stop** vis-à-vis de la taille des spikes (24 pts médians) ;
2. **la poche**, qui est le vrai stop ;
3. le spread et le glissement, qui sont des coûts, pas des choix.

---

## Réglages du script

| Réglage | Défaut | Ce qu'il fait |
|---|---|---|
| `poche` | 7,50 | le solde remis à niveau chez le broker avant chaque position |
| `minPoche` | 0 | sous ce solde, plus d'entrée |
| `stopSiReserve` | oui | arrêt net quand la réserve ne peut plus recharger |
| `lotMode` / `risqueUsd` | risque / 5 $ | lots = risque ÷ (stop × valeur du point), arrondi au pas du compte |
| `slPts` | 17,33 | distance du stop |
| `tpMode` / `rr` | rr / 1,5 | objectif ; `usd` convertit un objectif en dollars en points au moment de l'ordre |
| `maxBarsHeld` | 0 | sortie en temps — une vente qui n'atteint pas sa cible attend un spike |

Le sens n'est pas réglable : le script ne joue que les **surventes**, et il les
**vend**. La détection (RSI, unité de temps, seuils) vient du panneau Patterns —
un seul endroit, visible sur le graphe.

Dans la section **Compte** : mettre `slipPct` à **100** et `spreadPts` à **1,45**
avant de lire quoi que ce soit. Le script écrit un avertissement dans le journal
si l'un des deux est laissé à zéro.
