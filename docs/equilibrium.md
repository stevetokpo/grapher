# EQ — Point d'équilibre

`lib/equilibrium.js` · rendu `components/charts/EquilibriumPrimitive.js` · réglages dans le panneau Indicateurs

Où le marché est-il en équilibre, et y est-il **en ce moment** ?

La théorie des enchères dit que le prix annonce une opportunité et que le volume mesure
l'acceptation : le marché tourne autour d'un prix sur lequel les deux camps s'accordent — le
prix juste, le *point of control* — jusqu'à ce qu'un camp le refuse et que l'enchère reparte
ailleurs. Ce module en fait des nombres.

## Ce qui est calculé, à chaque bougie

Sur une fenêtre glissante des `lookback` dernières bougies :

1. **Profil.** Chaque barre étale son volume uniformément sur son propre range ; la somme sur
   la fenêtre donne un histogramme volume-par-prix, lissé par un noyau quasi-gaussien
   (trois passes de moyenne glissante) pour que le mode ne saute pas d'un bin à l'autre.
2. **Point.** Le mode de cette densité, raffiné en sous-bin par interpolation parabolique.
   C'est le point d'équilibre.
3. **Valeur.** La *value area* qui contient `valueArea`% du volume, étendue depuis le point
   deux bins à la fois (règle de Steidlmayer).
4. **Score 0-100.** Six mesures, combinées en **moyenne géométrique pondérée** — donc
   conjonctives : une seule composante morte effondre le score, les cinq autres ne peuvent pas
   la racheter.
5. **État.** Le franchissement du seuil ouvre une zone de balance, figée à cet instant. Elle ne
   meurt que lorsque le prix est *accepté* hors de la valeur **et** que le marché cesse de noter
   comme un équilibre. Le point abandonné survit en *naked POC* jusqu'à ce que le prix y revienne.

## Les six composantes

| | ce qu'elle teste | poids |
|---|---|---|
| `pull` | le point **rappelle** le prix vers lui | 0.34 |
| `uni`  | une seule valeur, pas deux distributions concurrentes | 0.16 |
| `conc` | valeur concentrée, pas étalée le long d'une tendance | 0.16 |
| `flat` | aucune dérive nette sur la fenêtre | 0.12 |
| `prox` | le prix traite au point **maintenant** | 0.12 |
| `sym`  | acceptation symétrique de part et d'autre | 0.10 |

Les cinq dernières décrivent la **forme** de l'enchère. Or une tendance, une marche aléatoire et
une distribution double produisent toutes un profil bien dessiné avec un POC. Seule `pull` teste
si le point est un équilibre au lieu d'en être l'image — c'est donc elle qui doit être la plus
difficile à truquer, et elle porte le poids le plus lourd.

## Pourquoi `pull` est mesurée hors échantillon

C'est le cœur de l'indicateur, et le piège dans lequel tombe la version naïve.

On veut le taux de rappel θ de `dp = θ·(point − p) + bruit`. Mais **le prix revient
mécaniquement vers le mode de sa propre distribution** : estimer le point et mesurer l'attraction
vers lui sur les mêmes barres est une tautologie, pas une mesure. Mesuré ainsi, θ est positif
même sur une marche aléatoire pure — et le premier prototype notait le bruit « en équilibre »
20 % du temps.

Donc : **le point de référence est le mode de la première moitié de la fenêtre, et l'attraction
est mesurée sur la seconde moitié seulement.** Le passé propose le point, le présent le confirme
ou non. Rien n'est lu au-delà de la barre courante : c'est strictement causal.

θ doit ensuite franchir deux barres indépendantes :

- **statistique** — le t-stat de régression `t = θ / SE(θ)`. Sous l'hypothèse nulle de marche
  aléatoire, le point n'attire pas et `t` est à peu près normal centré réduit. Le score est une
  **porte, pas une rampe** : rien en dessous de `t = 1` (que le bruit franchit une fois sur six),
  plein score seulement au-delà de `t = 2.5` (une fois sur 150). C'est la rampe linéaire depuis
  zéro qui laissait une marche aléatoire simuler l'équilibre.
- **économique** — l'attraction doit aussi être *matérielle* : un écart doit se réduire de moitié
  au moins deux fois sur le segment de test. Un θ minuscule peut être très significatif si l'on
  a assez de barres, et un point qui met 300 bougies à reprendre le prix n'est un équilibre pour
  personne.

Le score retenu est **le plus faible des deux**. Les deux, ou rien.

## Calibration

Une propriété structurelle : **sans attracteur significatif, le score plafonne à 38.** Toutes les
autres composantes parfaites, `pull` à zéro → 38. La balance ne peut pas être déclarée sur la
forme seule.

Mesuré sur les données du projet (2000 bougies, `lookback` 60, 6 rebattages par symbole) contre
un **contrôle par rebattage des rendements** — chaque barre garde son propre rendement, sa forme
et son volume, seul l'ordre temporel est détruit, ce qui produit une marche aléatoire de même
distribution marginale :

| | % de barres « en équilibre » |
|---|---|
| Ornstein-Uhlenbeck synthétique (vrai retour à la moyenne) | 39 % |
| Marche aléatoire / null rebattu | **5-8 %** |
| Tendance pure | 0 % |
| Distribution double | 0 % |

Le 95ᵉ centile du score sous l'hypothèse nulle tombe entre 62 et 74 selon l'instrument et la
fenêtre. **Le seuil par défaut de 70 correspond donc au ~95ᵉ centile du bruit : environ 5 % de
faux positifs par construction.** C'est ce qui donne un sens à un franchissement.

### Ce que ça dit du marché, et pas seulement du code

Sur BTCUSD, XAUUSD, US Oil et les synthétiques Deriv (15m, 1h, 4h), **le taux de balance réel ne
dépasse pas significativement celui de leur propre null rebattu** — les ratios se dispersent
autour de 1× sans direction, et allonger la fenêtre n'y change rien. Autrement dit : l'équilibre
*à un point*, au sens statistique strict, est rare sur ces marchés, et la plupart de ce qui
ressemble à une balance est une marche aléatoire qui traîne.

L'indicateur reste utile sur deux plans distincts :

- **descriptif** — le point, la value area, la forme du profil et les naked POC sont exploitables
  en permanence, comme n'importe quel volume profile ;
- **épistémique** — le score dit *quand faire confiance au point*. Sur ces données, la réponse
  honnête est : rarement.

Ne pas confondre les deux. Un POC tracé n'est pas une preuve d'équilibre.

## Réglages

| paramètre | défaut | rôle |
|---|---|---|
| `lookback` | 60 | bougies dans la fenêtre d'enchère |
| `threshold` | 70 | score à partir duquel la balance est déclarée (≈ p95 du bruit) |
| `valueArea` | 70 | % du volume dans la value area |
| `confirmBars` | 2 | clôtures acceptées hors valeur pour casser la balance |
| `exitScore` | seuil − 25 | score sous lequel une cassure peut être validée |
| `breakBuffer` | 0.25 | marge au-delà du bord de la VA, en largeurs de VA |
| `cooldown` | `lookback`/4 | bougies d'attente après une cassure avant une nouvelle zone |
| `levels` | 160 | lignes de prix du profil |
| `bandwidth` | 0.02 | sigma du lissage, en fraction du range de la fenêtre |
| `maxLen` | 0 | longueur maximale d'une zone (0 = illimitée) |

Le `breakBuffer` et l'`exitScore` existent parce que la valeur n'est pas rejetée dès que le prix
en sort : par construction un tiers du volume de l'enchère traite hors de la value area, et un
marché en balance en sort tout le temps. Sans eux, chaque zone cassait sur du bruit — dans le
scénario de test, la balance mourait 7 bougies avant le vrai changement de régime au lieu de 2
bougies après.

## Propriétés

- **Aucun repaint.** Tout ne lit que les barres ≤ i. Vérifié : masquer le futur ne change ni un
  score ni un point d'un seul bit.
- **Coût.** ~100 ms pour 5000 bougies (`lookback` 60). Le profil est reconstruit à chaque barre
  via un tableau de différences, donc chaque barre coûte O(1) au lieu de O(lignes traversées).
- **Réutilisable en backtest.** `calcEquilibrium(candles, params)` est pur et causal ; il peut
  alimenter une stratégie sans adaptation.
