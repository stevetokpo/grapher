---
name: backtest-optimizer
description: Backteste, optimise et audite une stratégie de trading sur la plateforme Grapher. À utiliser dès qu'on demande de backtester une stratégie, de trouver les meilleurs paramètres, d'optimiser/régler/tuner une stratégie sur un symbole et une période, de valider un edge, ou de critiquer une stratégie existante. Pilote lib/backtest via l'API, mène une optimisation anti-surapprentissage (in-sample / out-of-sample, plateaux, stress des coûts) et rend un rapport final : paramètres recommandés, verdict, défauts et manques de la stratégie.
---

# Backtest Optimizer

Mission : partir d'un **symbole + période + stratégie**, trouver le réglage le
plus performant **qui survit hors échantillon**, puis rendre un verdict critique
sur la stratégie elle-même.

Le résultat attendu n'est pas « la meilleure courbe d'équité ». C'est une
réponse honnête à : *cette stratégie a-t-elle un edge réel, avec quels
paramètres, et où est-elle défaillante ?* Un verdict « pas d'edge, voici
pourquoi » est un livrable réussi. Un verdict « +300 R » obtenu en surajustant
50 paramètres sur 40 trades est un échec, même si le graphique est beau.

## L'outil

Un seul runner, `scripts/bt.mjs`. Le serveur dev doit tourner (`npm run dev`,
port 3000 — sinon `GRAPHER_URL`). Un run ≈ 0,5–0,8 s ; la parallélisation
n'apporte rien (serveur mono-thread), donc les balayages sont séquentiels :
budget réaliste **150–300 runs** pour une mission, soit 2–4 minutes de calcul.

```bash
BT=".claude/skills/backtest-optimizer/scripts/bt.mjs"
node $BT symbols                  # symboles + plages de données réelles
node $BT strategies [id]          # schéma des paramètres (bornes !)
node $BT probe      --cfg m.json  # échelle de l'instrument + benchmark buy&hold
node $BT run        --cfg m.json  # un backtest, métriques détaillées
node $BT sweep      --cfg m.json --param slPoints --values 20:200:20
node $BT grid       --cfg m.json --param slPoints --values 20:100:20 --param2 tpPoints --values2 40:300:40
node $BT validate   --cfg m.json  # batterie IS/OOS + coûts + TF + direction → diagnostic
node $BT top        --cfg m.json  # classement de tous les runs journalisés
```

Chaque run est journalisé dans `backtests/ledger.jsonl` (comparable, rejouable).
`--help` pour toutes les options.

## Score : t-statistique, pas profit

Le classement (`tStat`) est `avgR / stdR × √n` : l'espérance par trade,
rapportée à sa volatilité **et à la taille d'échantillon**. Un `avgR` flatteur
sur 12 trades ne remonte pas au classement — c'est voulu.

Ne classe **jamais** sur le winrate (un TP serré donne 80 % de réussite et une
espérance négative), ni sur le total en points (dominé par les trades chanceux
et par la dérive de l'instrument). `avgR`, `PF`, `maxDD` et `n` sont affichés à
côté : le score ordonne, c'est toi qui juges.

## État vérifié des stratégies (audit du 2026-07-13)

Les 4 stratégies sont enregistrées et tournent sur tous les symboles. Le moteur
a été validé indépendamment (cf. `references/engine-contract.md`) : **inutile de
le remettre en cause**, concentre l'audit sur la stratégie.

| Stratégie | Signaux | À savoir avant de l'optimiser |
|---|---|---|
| `ma-cross` | abondants (~400–600 / 4 mois en 15m) | échantillon confortable ; espérance négative aux défauts sur tous les symboles testés |
| `rsi-reversion` | abondants (~200–300) | idem ; winrate ~37 % pour un R:R de 1,5 → sous le seuil d'équilibre (40 %) |
| `trender-harmony` | **rares** (15 en 15m/XAUUSD, 70 sur BTCUSD) | les zones d'harmonie sont peu fréquentes. Pour atteindre n ≥ 30 : période plus longue, TF plus bas, ou HTF/`bbLen` plus courts. Seule stratégie à stops **relatifs** (R:R exact) |
| `twins-bars` | **rares aux défauts** | le filtre de compression a été retiré du détecteur ; il ne reste que le **filtre ATR** (`atrMult` 1,6 : les deux corps doivent dépasser 1,6 × ATR7), qui reste le principal étrangleur de signaux. `atrPeriod: 0` le désactive et fait exploser le nombre de trades. **Vérifie le nombre de signaux avant toute optimisation**, sinon le run est non concluant |

## Déroulé

### 0. Cadrage — écris `backtests/mission.json`

Résous le symbole et vérifie la plage de données (`node $BT symbols` — toutes
les séries démarrent au **2026-01-01**). Consulte le schéma de la stratégie
(`node $BT strategies <id>`) : bornes, types, valeurs par défaut.

Il manque presque toujours deux informations que l'utilisateur n'a pas données —
**demande-les, ne les invente pas** :

- **le spread** en points de l'instrument (avec `spread: 0`, tout paraît
  rentable ; c'est le mensonge le plus courant d'un backtest) ;
- **le timeframe de décision**, s'il n'est pas dicté par la stratégie.

Puis découpe la période en **in-sample (≈70 %)** et **out-of-sample (≈30 %,
la partie la plus récente)**, en laissant devant l'IS une marge de warm-up
suffisante (voir ci-dessous) :

```json
{
  "symbol": "XAUUSD", "tf": "15m", "strategy": "trender-harmony",
  "spread": 0.3, "warmupDays": 35, "minTrades": 30,
  "params": {},
  "is":   { "from": "2026-02-05", "to": "2026-05-15" },
  "oos":  { "from": "2026-05-15", "to": "2026-07-12" },
  "full": { "from": "2026-02-05", "to": "2026-07-12" }
}
```

**Warm-up** : les indicateurs démarrent à la première bougie chargée. Sans
marge, les premiers signaux de la fenêtre sont perdus (testé : 6 trades → 11
avec 35 jours de marge). `warmupDays` charge des bougies *avant* la fenêtre et
exclut des métriques les trades entrés pendant cette marge. Dimensionne-le sur
l'indicateur le plus lent : pour `trender-harmony`, `bbLen × plus grand HTF`
(50 × H16 ≈ 33 jours). Les données commençant au 2026-01-01, **l'IS ne peut pas
commencer au 2026-01-01** si la stratégie a besoin de warm-up.

### 1. Reconnaissance — avant de lancer quoi que ce soit

- `node $BT probe --cfg …` → l'échelle de l'instrument (**ATR médian**) et le
  **benchmark buy & hold**. Deux usages :
  - les paramètres en **points** (`slPoints`, `tpPoints`, `beTrigger`) n'ont
    aucun sens dans l'absolu : un SL de 50 points vaut 4×ATR sur XAUUSD 15m et
    une poussière sur Volatility 75. Calibre les plages de balayage en
    multiples de l'ATR médian (typiquement 0,5× à 5×) ;
  - plusieurs symboles de cette base sont des **indices synthétiques à dérive**
    (Trek Up, Spot Up, Exponential Growth, Boom). Sur eux, n'importe quel biais
    long imprime des points : compare toujours le `totalPoints` de la stratégie
    au buy & hold, et teste `direction=long` contre `direction=short`.
- **Lis le code de la stratégie** (`lib/backtest/strategies/<id>.js`) et sa
  source Pine si elle existe (`pines/`). Tu ne peux pas critiquer ce que tu n'as
  pas lu, et la logique explique quels paramètres comptent.
- **Run baseline** avec les valeurs par défaut, sur l'IS.

### 2. Portillon de validité — ne pas optimiser du vide

Avant tout balayage, sur la baseline :

| Symptôme | Signification | Action |
|---|---|---|
| `n` < 30 | échantillon non concluant | élargir la période/TF, assouplir les filtres, sinon **arrêter** |
| `⚠ CLAMPED` | valeur hors bornes **silencieusement** remplacée par le défaut | corriger : tu ne testais pas ce que tu croyais |
| `⚠ NO_SL` | aucun stop → `profitR` null, toutes les stats en R muettes | mettre un SL, sinon aucune optimisation n'est mesurable |
| sorties `end`/`timeout` majoritaires | SL/TP jamais touchés — mal dimensionnés vs l'ATR | recalibrer avant de balayer |
| `⚠ CAPPED` | plage tronquée à 500 000 bougies M1 | réduire la fenêtre |

### 3. Screening 1D — quels paramètres comptent vraiment

`sweep` sur **chaque** paramètre, un par un, les autres figés aux défauts
(descente par coordonnées). Objectif : trier les paramètres **influents** de
ceux qui sont plats. Un paramètre plat se laisse au défaut — le régler, c'est
n'ajouter que du surapprentissage.

Balaye large et grossier d'abord (`--values 20:200:20`), puis resserre autour
de la zone qui tient. Ne raffine jamais un pic isolé.

### 4. Raffinement 2D — les paramètres couplés

Seulement sur les 2–3 paramètres influents, en `grid`, car ils interagissent :
`slPoints × tpPoints` (le R:R est un ratio, pas deux réglages indépendants),
`bbLen × bbMult`, `fastPeriod × slowPeriod`, `slAtrMult × tpRR`.

**Règle du plateau — la plus importante de ce skill.** Retiens le **centre
d'une zone stable**, jamais le maximum global. Un candidat n'est retenu que si
ses voisins immédiats (±1 pas sur chaque axe) gardent une espérance positive et
un score ≥ ~60 % du sien. Un pic entouré de scores médiocres est un artefact du
bruit : il ne survivra pas hors échantillon. Un plateau un peu moins haut mais
large est un meilleur choix — dis-le explicitement dans le rapport.

**Budget de liberté** : compte ~**30 trades par paramètre réglé**. Avec 120
trades, tu peux honnêtement en régler 3 ou 4, pas 12. Au-delà, tu ne mesures
plus une stratégie, tu mémorises un historique.

### 5. Robustesse — `validate`

Sur le jeu de paramètres retenu (`-p cle=valeur …`). La commande lance IS, OOS,
spread ×2 et ×3, timeframes voisins, directions, puis un diagnostic automatique.
Critères de rejet :

- **espérance OOS ≤ 0** → surapprentissage, le réglage est mort ;
- **l'edge meurt avec un spread doublé** → aucune marge face aux coûts réels ;
- **> 60 % du R total sur un seul mois** → un coup de chance, pas un edge ;
- **aucun timeframe voisin rentable** → réglage sur-spécifique au TF ;
- dégradation IS→OOS > 50 % → edge fragile, à signaler.

**Discipline de l'OOS** : `sweep` et `grid` refusent de tourner sur l'OOS (et
sur `full`, qui le contient). Ce n'est pas une gêne, c'est le cœur de la
méthode. Si l'OOS échoue, **ne re-règle pas jusqu'à ce qu'il passe** : chaque
re-réglage après avoir vu l'OOS le brûle et te ramène au surapprentissage.
Réduis plutôt le nombre de paramètres libres, élargis les données, ou conclus à
l'absence d'edge. Un seul cycle de re-réglage est tolérable — il doit être
**déclaré dans le rapport**.

### 6. Critique de la stratégie

C'est la moitié de la mission : l'utilisateur veut savoir si sa stratégie a un
**défaut** ou un **manque**. Audite le code avec `references/engine-contract.md`
(sémantique du moteur, définitions des métriques, pièges connus) :

- **lookahead** : `onBar` ne doit lire que `candles[0..i]` / `ind.*[0..i]` ;
- **warm-up** : les `null` des indicateurs sont-ils gérés ?
- gestion des sorties : sorties `signal`/`end` massives, flips en série ;
- ordres stop d'entrée : actifs **une seule bougie**, à ré-émettre à chaque
  clôture ;
- break-even / trailing : le R reste mesuré sur le risque **initial** ;
- ce que le moteur **ne sait pas** faire et qui manque à la stratégie : filtre
  de session ou d'heure, filtre de volatilité, sizing en capital, ordres
  limites, pyramidage, trailing ATR. Les ventilations `byHour` / `byDayOfWeek`
  de l'API sont **diagnostiques uniquement** : aucun paramètre du moteur ne
  filtre les heures, donc « ne trader que 8h–16h » est une **recommandation
  d'évolution**, pas un réglage — et l'annoncer comme un gain acquis serait
  malhonnête (ce serait, en plus, du surapprentissage sur le passé).

### 7. Rapport final

Écris `backtests/rapport-<strategie>-<symbole>.md` en suivant
`references/report-template.md`, et résume-le à l'utilisateur : verdict,
paramètres recommandés, preuves IS/OOS, défauts, manques.

Règles de restitution : donne les chiffres **hors échantillon**, pas les
chiffres d'optimisation (ce sont les seuls qui vaillent quelque chose) ; dis
combien de configurations ont été testées (le risque de surapprentissage croît
avec ce nombre) ; et si le verdict est « pas d'edge », dis-le franchement plutôt
que d'habiller un réglage médiocre.

## Interdits

- Optimiser sur l'OOS, ou le regarder avant d'avoir figé les paramètres.
- Classer sur le winrate ou le total en points.
- Retenir un pic isolé plutôt qu'un plateau.
- Conclure sur moins de 30 trades.
- Régler plus de paramètres que `n / 30`.
- Présenter un résultat sans spread réaliste, ou sans le comparer au buy & hold
  sur les instruments à dérive.
