# Gabarit du rapport final

À écrire dans `backtests/rapport-<strategie>-<symbole>.md`, puis à résumer à
l'oral (verdict + paramètres + défaut principal).

Principes : **les chiffres mis en avant sont ceux de l'OOS**, jamais ceux de
l'optimisation. Le nombre de configurations testées est annoncé (il conditionne
le risque de surapprentissage). Un verdict négatif s'assume.

---

## 1. Verdict (3 lignes max, en tête)

Une des trois formulations, sans enrobage :

- **Edge validé** — l'espérance reste positive hors échantillon et résiste aux
  coûts. Utilisable, avec les réserves listées.
- **Edge fragile** — positif en IS, dégradé ou instable en OOS. Ne pas exploiter
  en l'état ; voici ce qu'il faudrait corriger.
- **Pas d'edge** — l'espérance n'est pas positive, ou tient à un seul mois / un
  seul réglage. Ne pas exploiter.

## 2. Paramètres recommandés

| Paramètre | Défaut | Recommandé | Pourquoi |
|---|---|---|---|
| … | … | … | plateau stable entre X et Y, centre retenu |
| … | … | *(inchangé)* | balayage plat → aucun gain, laissé au défaut |

Préciser : quels paramètres ont été **réglés** (comptent dans le budget de
surapprentissage) et lesquels sont **restés au défaut**. Donner la **plage
stable** autour de chaque valeur retenue, pas seulement le point — c'est elle
qui dit à quel point le réglage est robuste.

## 3. Résultats

| | trades | winrate | avgR | totalR | PF | maxDD (R) | tStat |
|---|---|---|---|---|---|---|---|
| Baseline (défauts), IS | | | | | | | |
| Optimisé, IS | | | | | | | |
| **Optimisé, OOS** | | | | | | | |

Contexte indispensable sous le tableau :

- période, timeframe, **spread appliqué**, warm-up ;
- **benchmark buy & hold** sur la période (surtout sur les indices à dérive :
  si la stratégie fait moins que la dérive, elle ne sert à rien) ;
- **nombre de configurations testées** et budget de paramètres (`n / 30`).

## 4. Robustesse

Sortie de `validate`, commentée :

| Test | Résultat | Lecture |
|---|---|---|
| OOS | | l'edge survit-il hors échantillon ? |
| Spread ×2 / ×3 | | marge face aux coûts réels |
| Concentration mensuelle | | un seul mois porte-t-il tout ? |
| Timeframes voisins | | réglage sur-spécifique ou robuste ? |
| Direction long / short | | edge symétrique, ou simple capture de dérive ? |

## 5. Défauts de la stratégie

Ce qui est **cassé ou faux** dans la logique (audit du code, cf.
`engine-contract.md`), classé par gravité, avec le fichier et la ligne :
lookahead, warm-up non gardé, absence de SL, stop non ré-armé, flips en série,
paramètres redondants, paramètres en points non portables…

Pour chacun : le symptôme observé dans les résultats (« 62 % de sorties
`signal`, durée moyenne 2 bougies »), la cause dans le code, la correction.

## 6. Manques

Ce qui **n'existe pas** et qui plafonne la stratégie — distinguer clairement :

- **manques de la stratégie** : filtre de tendance, filtre de volatilité,
  gestion de sortie (trailing), asymétrie long/short non exploitée… ;
- **manques de la plateforme** (moteur) : pas de filtre de session, pas de
  sizing, pas d'ordre limite, pas de slippage… — donc certaines idées ne sont
  **pas testables en l'état** ; le dire au lieu de les créditer d'un gain.

Toute piste issue d'une ventilation a posteriori (heures, jours de la semaine)
est une **hypothèse à tester**, pas un gain acquis : la présenter comme telle.

## 7. Prochaines expériences

Trois maximum, ordonnées par rapport gain/effort, chacune formulée comme une
**hypothèse falsifiable** (« un SL en multiple d'ATR au lieu de points fixes
devrait rendre le réglage portable d'un symbole à l'autre — testable en
modifiant `<fichier>` »).
