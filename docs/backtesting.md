# Backtesting de stratégies

Module de backtest intégré : des stratégies configurables tournent sur les
bougies M1 stockées dans DuckDB, le moteur simule l'exécution et produit des
métriques complètes (R, points, drawdown, ventilations).

## Architecture

```
lib/backtest/
  engine.js            moteur : agrégation M1→TF, boucle d'exécution, fills
  metrics.js           statistiques calculées sur les trades fermés
  ta.js                indicateurs vectorisés ALIGNÉS (ind[i] ↔ candles[i])
  strategies/
    index.js           registre STRATEGIES + sanitizeParams (validation/clamp)
    maCross.js         exemple : croisement de moyennes mobiles
    rsiReversion.js    exemple : retour à la moyenne RSI
    twinsBars.js       exemple : pattern Twins Bars (réutilise lib/patterns.js)
    trenderHarmony.js  portage de pines/trender-strategy.pine (harmonie multi-HTF,
                       break-even, Revenger — ordres stop + modify)
    rfvgZone.js        zones rFVG/aFVG (lib/patterns.js) : retest ou détection,
                       SL/TP fixes (points ou ATR), break-even en R

pages/api/backtest.js  GET  → liste des stratégies + schémas de params
                       POST → exécute un backtest, renvoie métriques + trades
pages/backtest.js      page UI (accessible via le bouton « Backtest » du header)
components/backtest/   BacktestConfig (formulaire auto-généré), BacktestResults,
                       EquityChart (SVG), TradesChartModal (fenêtre graphe)
components/charts/TradesPrimitive.js
                       positions peintes sur le graphe : bandes SL/TP, trajet
                       entrée → sortie, SL initial si déplacé par un break-even
```

## Sémantique d'exécution (contrat du moteur)

Ces règles garantissent des résultats honnêtes — ne pas les affaiblir :

1. **Anti-lookahead** — la stratégie décide à la **clôture** de la bougie `i`
   (au timeframe choisi) ; l'ordre est exécuté à l'**ouverture** de la bougie
   `i+1`. `onBar` reçoit le tableau complet des bougies mais ne doit **jamais
   lire au-delà de l'index `i`** (même discipline que `lib/patterns.js`).
2. **Fills à la minute** — les SL/TP sont vérifiés bougie **M1 par M1** à
   l'intérieur de chaque bougie TF (le moteur garde la plage d'indices M1 de
   chaque bougie agrégée). L'ordre chronologique intra-bougie est donc réel,
   pas deviné sur l'OHLC agrégé.
3. **Règle conservatrice** — si SL et TP sont touchés dans la **même bougie
   M1**, le SL gagne (identique à `useTrades` du replay). Le SL est rempli au
   **pire du niveau du stop et de l'open M1** : si le marché ouvre au-delà du
   stop (gap), le fill est à l'open. Un stop ne rend donc jamais un prix
   meilleur que le marché — y compris s'il a été déplacé du **mauvais côté** du
   prix par un break-even mal réglé, cas qui fabriquait auparavant du profit pur
   (stop rempli à un niveau où le marché n'a jamais traité). Le TP reste rempli
   à son niveau exact, hypothèse conservatrice symétrique.
4. **Une position à la fois** — un signal opposé ferme puis retourne la
   position (flip) au prochain open ; un signal dans le même sens est ignoré.
5. **Spread** — coût fixe en points déduit une fois par trade
   (`profitPoints = brut − spreadPoints`).
6. **Fin de données** — une position encore ouverte est fermée au dernier
   close avec `exitReason: 'end'`.
7. **Ordres stop d'entrée** — `buyStop`/`sellStop` avec `price` : déclenchés
   M1 par M1 (fill au niveau du stop, ou à l'open M1 si gap au-delà). Actifs
   pendant **une bougie** seulement — la stratégie les ré-émet à chaque clôture
   tant qu'ils doivent rester armés (comme les ordres re-placés en Pine).
8. **Modification en position** — `{ action: 'modify', sl?, tp? }` met à jour
   les stops de la position ouverte (break-even, trailing…), effectif à partir
   de la bougie suivante. Le **R d'un trade reste mesuré sur le risque
   INITIAL** (distance entrée→SL à l'ouverture, `risk0`) — déplacer le SL ne
   regonfle pas le R.
9. **Stops relatifs** — les entrées acceptent `slPoints`/`tpPoints` (distance
   en points depuis le prix d'entrée **réellement obtenu**), équivalent Pine
   `strategy.exit(loss=…, profit=…)` — à préférer aux prix absolus calculés
   sur le close du signal quand la stratégie raisonne en points fixes.

Unités : **points** = unités brutes de prix du symbole (pas de pips, l'échelle
varie selon l'instrument) ; **R** = profit / risque initial (distance
entrée→SL). Les trades sans SL ont `profitR: null` et sont exclus des stats en R.

## Ajouter une stratégie

1. Créer `lib/backtest/strategies/maStrategie.js` :

```js
import { sourceArr, emaArr, atrArr } from '../ta';

export default {
  id:    'ma-strategie',          // unique, kebab-case
  label: 'Ma Stratégie',
  desc:  'Une phrase de description (affichée dans l’UI)',

  // Le schéma génère le formulaire UI ET la validation API (clamp aux bornes).
  // types : 'int' | 'float' (min/max/step) | 'select' (options) | 'bool'
  params: [
    { key: 'period', label: 'Période', type: 'int',   def: 14,  min: 2, max: 200 },
    { key: 'tpRR',   label: 'TP (×R)', type: 'float', def: 2,   min: 0.2, max: 20, step: 0.1 },
    { key: 'mode',   label: 'Mode',    type: 'select', def: 'strict', options: ['strict', 'souple'] },
    { key: 'filter', label: 'Filtre',  type: 'bool',  def: true, hint: 'texte d’aide optionnel' },
  ],

  // Optionnel : précalcul vectorisé des indicateurs (appelé une fois).
  // Utiliser lib/backtest/ta.js (tableaux alignés, null avant warm-up) ou
  // n'importe quel détecteur de lib/patterns.js (cf. twinsBars.js).
  setup(candles, p) {
    return { ema: emaArr(sourceArr(candles, 'close'), p.period), atr: atrArr(candles, 14) };
  },

  // Appelée à chaque clôture de bougie. Retourne UNE action (ou null) :
  //   { action: 'buy'|'sell', sl?, tp?, slPoints?, tpPoints?, reason? }  entrée/flip
  //   { action: 'close', reason? }                     sortie au prochain open
  //   { action: 'modify', sl?, tp? }                   déplace les stops (break-even…)
  //   { action: 'buyStop'|'sellStop', price, sl?, tp?, reason? }
  //       ordre stop d'entrée, actif la bougie suivante — ré-émettre pour maintenir
  // lastTrade = dernier trade fermé (détecter une sortie SL, compter, etc.)
  onBar({ candles, i, ind, position, params: p, lastTrade }) {
    if (position || ind.ema[i] == null) return null;
    // … logique — ne lire que candles[0..i] et ind.*[0..i]
    return null;
  },
};
```

Pour une stratégie à état séquentiel (revanche en attente, break-even déjà
appliqué…), stocker un objet mutable dans le retour de `setup()`
(`state: { … }`) et le muter dans `onBar` — les bougies sont visitées dans
l'ordre, une seule fois (voir `trenderHarmony.js`).

2. L'enregistrer dans `lib/backtest/strategies/index.js` (import + ajout au
   tableau `STRATEGIES`). **C'est tout** : l'API l'expose et le formulaire UI
   se génère depuis le schéma.

Conseils :
- Toujours définir un SL (sinon pas de mesure en R, la moitié des métriques
  devient muette).
- `reason` (motif d'entrée) apparaît dans la liste des trades — utile pour
  déboguer une stratégie multi-conditions.
- Pour un pattern existant : précalculer dans `setup()` via `lib/patterns.js`
  et indexer par `time` (voir `twinsBars.js`) — les détecteurs de patterns ne
  lisent que le passé à chaque index, donc pas de lookahead.

## API

`POST /api/backtest`

```json
{
  "symbolId": 1,
  "from": 1735689600, "to": 1738368000,
  "tf": "15m",
  "strategyId": "ma-cross",
  "params": { "fastPeriod": 9, "slowPeriod": 21 },
  "execution": { "spreadPoints": 0.5, "maxBarsInTrade": 0 }
}
```

Réponse :

- `meta` — récap complet (params nettoyés, nb bougies M1/TF, durée de calcul,
  `capped` si la plage dépasse 500 000 M1)
- `summary` — total, winrate, totalPoints, totalR, avgR (espérance/trade),
  profitFactor, maxDrawdownR/Points, sharpe (par trade), stdR, bestR/worstR,
  séries consécutives max, durée moyenne, `exitReasons`
- `equity` — courbe cumulée `[{ time, points, r }]` (un point par trade fermé)
- `trades` — liste détaillée (plafonnée à 5 000, `tradesCapped` si tronquée ;
  les métriques sont toujours calculées sur TOUS les trades)
- `byDirection`, `monthly`, `byHour`, `byDayOfWeek` — ventilations
  (trades, winrate, points, R)

`GET /api/backtest` → `[{ id, label, desc, params }]` (découverte des
stratégies pour l'UI).

## Fenêtre graphe (revoir les trades)

Depuis les résultats, « Voir sur le graphe » (ou un clic sur n'importe quelle
ligne de la liste des trades) ouvre le graphe du symbole testé avec les
positions dessinées : zone de gain (entrée → TP), zone de risque (entrée → SL
final), trajet entrée → sortie coloré par le résultat, marqueurs d'entrée et de
sortie. Quand un break-even a déplacé le stop, le **SL initial** est rappelé en
pointillé — sans lui, la zone de risque affichée serait celle d'après coup et le
R du trade (mesuré sur le risque initial) deviendrait illisible.

Deux détails qui piègent :

- Les temps d'un trade ne tombent pas sur des temps de bougie : l'entrée est à
  l'open d'une bougie TF, mais la sortie est datée à la **minute** (SL/TP
  vérifiés M1 par M1). Le graphe ne sait placer que des temps présents dans ses
  données — chaque temps est donc ramené à la bougie qui le contient, sinon
  marqueurs et rectangles sont silencieusement ignorés.
- Un backtest couvre bien plus de bougies que le graphe n'en charge d'un coup.
  La fenêtre est **ancrée sur un trade** (le bloc de bougies qui l'entoure) et
  remonte le temps à la demande ; naviguer d'un trade à l'autre ne recharge que
  si le trade visé sort du bloc déjà chargé.

## Note sur la stratégie rFVG (rfvgZone)

Le motif (cf. `pines/rFVG.pine`) a besoin de la bougie **suivante** pour exister :
il n'est connu qu'à la clôture de celle-ci. Une zone dont la bougie centrale est
en `i` n'est donc armée qu'à partir de `i+1` — c'est la seule façon d'éviter le
lookahead.

Conséquence non évidente : le **bord proche** de la zone (celui que le prix
rencontre en revenant) *est* l'extrême exact de cette bougie de confirmation
(`bottom = high` de la suivante pour une zone baissière). Une règle de retest
naïve serait donc déclenchée par la bougie de confirmation elle-même — touche
triviale par égalité — et le mode « retest » se réduirait silencieusement au mode
« entrée immédiate ». La zone n'est testée qu'à partir de la bougie d'après.

La marge d'entrée (`entryAtr` × ATR) enfonce le niveau dans la zone ; elle est
**bornée au bord opposé**, si bien qu'une marge plus large que la zone revient à
en attendre la traversée complète, jamais à rendre le déclenchement inatteignable
(sinon un réglage produirait zéro trade sans qu'on comprenne pourquoi).

Le moteur n'a pas d'ordre limite d'entrée : le toucher est constaté à la clôture
et l'entrée se fait au marché à l'open suivant. Le fill peut donc être moins bon
que le niveau visé — jamais meilleur.

## Note sur le portage Pine (trenderHarmony)

Le biais HTF reproduit la sémantique non-repaint du Pine
(`request.security(expr[1], lookahead_on)`) : chaque bougie chart lit la
tendance Bollinger de la **dernière bougie HTF clôturée**, les bougies HTF
étant reconstruites par bucket de temps depuis les bougies chart. Écart-type
**population** comme `ta.stdev`. Warm-up : il faut `bbLen` bougies du plus
grand HTF avant les premiers signaux (50 × 16h ≈ 33 jours) — prévoir la plage
en conséquence. Déviation assumée : le Pine ré-armait la revanche en boucle
quand elle s'exécutait et sortait en SL dans la même bougie (faille vs son
intention déclarée « une seule tentative par SL ») — le portage applique
l'intention : une revanche consommée n'est jamais ré-armée.

## Limites connues / pistes

- Pas de sizing en capital : tout est mesuré en points et en R (cohérent avec
  le replay). Un sizing % de capital pourrait s'ajouter dans `execution`.
- Le spread est un coût fixe par trade, pas un modèle bid/ask par tick.
- Pas d'ordres limites d'entrée (marché et stop uniquement).
- Mono-position ; pas de pyramidage. Un trailing stop est faisable dès
  maintenant via `{ action: 'modify' }` à chaque bougie.
- Pas de persistance des runs : à terme, une table DuckDB `backtest_runs`
  permettrait de comparer les runs entre eux.
