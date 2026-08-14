# Monte-Carlo — ce que le hasard aurait pu faire de ces trades

Un backtest rend **une** courbe : 400 trades dans un ordre précis, un creux de
−12 %. Cet ordre est un accident de l'histoire. Le Monte-Carlo rejoue les mêmes
résultats des milliers de fois et rend la **distribution** de ce que le compte
aurait vécu.

- Code : `lib/monteCarlo.js` (pur, sans React, sans DOM)
- Vue : `components/rapports/MonteCarloCard.js`, sous la courbe cumulée de `/rapports`
- Auto-contrôle : `npm run mc-test`

---

## Les deux modes

Ils ne répondent pas à la même question, et les confondre est l'erreur classique.

### Rebattage (`shuffle`) — le mode par défaut

Exactement les mêmes trades, un autre ordre. Le total final est donc
**identique** à chaque tirage : seul le **chemin** change, et avec lui le creux,
les séries de pertes, le temps sous l'eau.

C'est le mode qui répond à « mon drawdown est-il de la malchance ou la
normale ? » sans rien supposer de plus que l'indépendance de l'ordre. C'est
aussi, mot pour mot, un **test de permutation** : le rang de l'observé dans la
distribution **est** une p-valeur.

### Tirage avec remise (`bootstrap`)

`n` trades retirés au hasard dans le même chapeau, doublons permis. Le total
varie alors, ce qui donne la dispersion du **résultat final** et la probabilité
de finir dans le rouge.

En échange, ce mode suppose les trades **i.i.d.** — tirés d'une même loi,
indépendants. Hypothèse forte, et souvent fausse.

---

## Le chiffre à lire en premier

Ce n'est pas le drawdown médian, c'est le **rang du drawdown réel**.

| Rang | Lecture |
|---|---|
| ≈ p50 | L'ordre réel n'a rien eu de particulier. Le p95 de la distribution est le chiffre à retenir pour dimensionner un compte. |
| ≤ p30 | L'ordre réel a été **clément**. Le creux du backtest est le meilleur cas d'un tirage, pas le creux à prévoir. |
| ≥ p95 | **Les pertes se groupent.** Ce n'est pas de la malchance, c'est de la mémoire. |

Le dernier cas est le seul qui demande une décision, et il se retourne contre la
carte elle-même : si le rang est extrême, c'est que les trades ne sont **pas**
indépendants — donc les quantiles affichés juste à côté, qui reposent sur cette
indépendance, **sous-estiment le risque** au lieu de le décrire. Le vrai creux à
venir est alors à chercher au-dessus du pire tirage, pas au p95.

C'est vérifié par l'auto-contrôle sur deux séries construites exprès : les mêmes
120 gains et 60 pertes, groupés (rang 1) puis alternés (rang 0), avec la **même**
distribution simulée dans les deux cas — seul l'observé les sépare.

---

## Ce que ça ne fait pas

- **Aucune réparation du surapprentissage.** Rebattre les trades de la meilleure
  configuration d'un balayage de 112 configs ne dit rien de sa validité hors
  échantillon, seulement de la variance de ce jeu de trades là. La porte de
  significativité reste le **contrôle par décalage circulaire**, qui rebat des
  données réelles et garde la structure du marché.
- **Aucune correction du chevauchement.** Si des positions ont couru en même
  temps, la courbe n'est déjà pas la suite des encaissements d'un compte et son
  creux est optimiste avant le premier tirage. Le rebattage propage ce biais, il
  ne le corrige pas. La carte le dit quand `maxSim > 1`.
- **Aucune idée du plan de taille.** Rebattre des résultats déjà multipliés par
  un lot en escalier accrocherait le lot du 300e trade au résultat du 12e : ce
  serait mesurer le calendrier des lots. La page donne donc la série **à 1 lot**
  (`netPoints1`) dès que les tailles varient.
- **La ruine est un passage, pas un arrêt.** Elle compte les chemins passés sous
  −capital au moins une fois ; le chemin continue ensuite dans la simulation,
  alors qu'un vrai compte se serait arrêté là. Le résultat final d'un chemin
  ruiné est donc fictif.

---

## Contrat du module

```js
import { runMonteCarlo, ruinProbability } from '../lib/monteCarlo';

const mc = runMonteCarlo(gains, { mode: 'shuffle', draws: 2000 });
```

`gains` : les résultats **nets par trade, en POINTS**, dans l'ordre réel des
entrées, à 1 lot. `null` en retour s'il y a moins de deux trades.

Tout ce qui sort est en points et **linéaire en l'entrée** : la conversion en
dollars est un facteur d'affichage, elle ne demande jamais de rejouer la
simulation.

| Champ | Contenu |
|---|---|
| `observed` | `{ net, maxDD, lossStreak, underwater, minCum, path }` sur l'ordre réel |
| `net`, `maxDD`, `lossStreak`, `underwater` | `{ min, p5, p25, p50, p75, p95, max, mean, observed, rank }` |
| `pctLoss` | part des tirages finissant sous zéro |
| `band` | enveloppe `{ p5, p25, p50, p75, p95 }` du faisceau, aux `checkpoints` |
| `minCums` | creux absolu de chaque chemin, **trié** — de quoi relire la ruine à n'importe quel capital |
| `netsSorted`, `ddsSorted`, `streaksSorted`, `uwsSorted` | échantillons triés, pour les histogrammes |
| `draws` / `drawsAsked` | tirages réellement joués / demandés (cf. garde-fou) |

`rank` = part des tirages qui font **au plus** aussi bien que l'observé. Pour un
drawdown, où « plus » est pire, un rang de 0,97 dit que 97 % des chemins ont
creusé moins.

### Décisions qui ont l'air de détails

- **Graine fixe.** Un même rapport doit rendre deux fois les mêmes quantiles,
  sinon changer le prix du point donne l'impression d'avoir découvert quelque
  chose.
- **Le pic part de zéro**, comme dans `lib/signals/stats.js` : le drawdown se
  mesure depuis le capital de départ, pas depuis le premier sommet. Deux
  conventions donneraient deux « drawdown max » pour le même rapport.
- **Un seul parcours** (`walk`) sert au vrai ordre comme aux tirages. Deux
  boucles finiraient par diverger d'un détail, et le rang de l'observé ne
  comparerait plus la même chose que ce qu'il prétend.
- **La ruine est découplée des tirages.** Elle se relit par dichotomie dans
  `minCums`, donc taper dans le champ « capital » ne rejoue rien.
- **Garde-fou de coût** : `tirages × trades ≤ 2·10⁷`, plancher à 200 tirages. Un
  rapport 1m de 8 000 positions prend ~1 s à 2 000 tirages ; 10 000 tirages
  figeraient l'onglet. Le nombre réellement joué est rendu, et la carte le dit.
- **Le calcul est fait après la peinture** (un `setTimeout` dans un effet), pas
  pendant le rendu : sinon toute la page attend la simulation à l'ouverture du
  fichier, y compris les tuiles qui n'ont rien à voir avec elle.

---

## Lecture d'un cas réel

`backtests/rapports/rfvg-rapport-2026-08-05-23-44-06.json`, 7 943 positions
résolues, net +2 496 pts, creux réel 1 126 pts.

```
rebattage   DD p5/p50/p95 :  756 / 1 109 / 1 768   pire 2 472   rang p52
bootstrap   DD p5/p50/p95 :  692 / 1 126 / 2 080   pire 4 326   rang p50
            net p5/p50/p95 : −187 / 2 482 / 5 120  · 6,3 % des échantillons dans le rouge
```

Rang p52 : l'ordre réel n'a rien eu de particulier, les pertes ne se groupent
pas. Le creux à provisionner n'est donc pas les 1 126 pts du rapport mais les
**1 768 pts du p95** — et le tirage avec remise, qui relâche l'hypothèse du
total fixe, monte à 2 080. Accessoirement : 6,3 % des échantillons de 7 943
trades finissent négatifs, alors que celui-ci finit à +2 496.
