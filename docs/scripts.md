# Scripts — simulation de compte

Un **script** est la troisième famille de la plateforme, à côté des indicateurs et
des patterns. Ce qu'il a de plus qu'eux : un **capital**.

Un pattern répond à « ce motif gagne-t-il ? », en points et en R, avec un lot
implicite et infini. Un script répond à « **qu'est-ce que ce capital serait
devenu ?** » — donc à des questions qu'aucune mesure en points ne peut trancher :
combien de lots, combien de positions tenables à la fois, combien d'appels de
marge, et s'il reste quelque chose à la fin.

Bouton **Scripts** dans la barre des timeframes → tiroir latéral droit. Le tiroir
ne recouvre pas le graphe et ne bloque rien : on règle en voyant les bougies.

---

## Unités : tout est en points, l'affichage dit USD

Le capital est fourni **en points de prix**. Le gain d'une position vaut :

```
gain = points gagnés × lots × pointValue
```

Avec `pointValue = 1` (défaut), un point et un lot font un dollar : le capital
« en points » **est** le solde en USD affiché. C'est un mensonge assumé, et il
n'a qu'un seul endroit — `fmtUsd()` dans `lib/format.js`, alimenté par
`lib/scripts/account.js`.

---

## Les fichiers

| Fichier | Rôle |
|---|---|
| `lib/scripts/account.js` | Le compte : solde, équité, marge, appels de marge, stop outs, ruine, dimensionnement des lots |
| `lib/scripts/engine.js` | Le déroulé bougie par bougie, les remplissages, les SL/TP, l'API remise au script |
| `lib/scripts/report.js` | Les statistiques du run et le document JSON téléchargeable |
| `lib/scripts/registry.js` | Le registre — un script s'y ajoute en une ligne |
| `lib/scripts/lotLadder.js` | L'escalier des lots — la taille qui monte avec le compte, et son formulaire |
| `lib/scripts/library/*.js` | Les scripts eux-mêmes |
| `lib/scripts/library/boomRsier.js` | Vend les surventes RSIER sur Boom 1000 M1, poche chez le broker et gains en réserve — voir `docs/boom-rsier.md` |
| `lib/scripts/library/ringble.js` | Joue le motif ringble **du graphe** — voir « Un script qui joue un motif » |
| `lib/scripts/library/rfvgPaliers.js` | Joue le rFVG **du graphe**, sorties du moteur commun, taille par escalier |
| `components/ScriptPanel.js` | Le tiroir : choix du script, compte, date de départ, réglages, lancement |
| `components/scripts/ScriptResults.js` | Le relevé de compte |

---

## Écrire un script

Copier `lib/scripts/library/demoCross.js`, puis l'ajouter à `SCRIPTS` dans
`registry.js`. Rien d'autre : le formulaire se dessine tout seul depuis `fields`.

```js
export default {
  id:    'mon-script',            // unique
  label: 'Mon script',
  desc:  'Une phrase',
  color: '#60A5FA',

  defaults: { period: 20, riskPct: 1 },     // valeurs par défaut des réglages

  fields: [                                  // le formulaire (voir plus bas)
    { kind: 'number', key: 'period',  label: 'Période', min: 1, max: 500, step: 1 },
    { kind: 'number', key: 'riskPct', label: 'Risque (%)', min: 0, max: 100, step: 0.1 },
  ],

  // Précalculs — appelé une fois, avant la première bougie (optionnel)
  // `context` porte ce que le graphe sait : { patterns, symbol, tf }
  setup({ candles, params, account, startIdx, context }) {
    return { ma: maArr(sourceArr(candles, 'close'), params.period) };
  },

  // À la CLÔTURE de chaque bougie. Ne retourne rien : il AGIT, via `api`.
  onBar({ candles, bar, i, state, params, account, api, context }) {
    if (api.positions.length === 0 && state.ma[i] != null && bar.close > state.ma[i]) {
      api.buy({ riskPct: params.riskPct, slPts: 50, rr: 2 });
    }
  },
};
```

`onBar` ne retourne rien, contrairement aux stratégies de backtest
(`lib/backtest/strategies/`) qui rendent une action. C'est délibéré : un script
doit pouvoir ouvrir trois positions et en fermer une quatrième dans la même
bougie, ce qu'un `return { action }` ne sait pas dire.

### Un script qui joue un motif

`context` porte ce que le **graphe** sait, et `context.patterns` les motifs tels
qu'ils sont réglés dans le panneau Patterns. Un script peut donc jouer un motif
**sans recopier ses réglages** :

```js
import { calcRingble }  from '../../ringble/detect';
import { detectOptions } from '../../ringble/params';

setup({ candles, context }) {
  const pat = (context.patterns ?? []).find(p => p.type === 'RINGBLE');
  const signals = calcRingble(candles, detectOptions(pat ?? {}));
  return { byIdx: new Map(signals.map(s => [s.idx, s])) };
}
```

C'est le principe du script `ringble` : la détection se règle à **un** endroit,
on la voit dessinée sur le graphe, et le script joue exactement ces figures-là.
Le script ne décide que de la **gestion de position** — entrée, stop, objectif,
taille, break-even, sortie en temps.

Un script qui emprunte des réglages au graphe **doit** exposer `summary({ params,
context })` : la chaîne rendue s'affiche dans le panneau sous la carte du script,
et est figée dans le rapport JSON (champ `detection`). Sans elle, on ne saurait
pas ce qui a été joué — et le panneau Patterns peut changer après le run.

### Grammaire des champs

Même que `lib/xfvg/params.js` — `kind` : `number`, `text` (chaîne libre, avec
`placeholder`), `toggle`, `segmented`, `row` (deux champs côte à côte),
`divider` (titre de section), `hint` (paragraphe d'explication). Tout champ
accepte `when: p => …` pour n'apparaître que sous condition.

Un champ `text` n'est validé nulle part : le registre le recopie tel quel, et
c'est au script de savoir lire sa propre chaîne (une table de paliers, par
exemple). Ce qu'il n'arrive pas à lire, il doit le **dire** — `api.log` est là
pour ça, une ligne illisible avalée en silence est un run qui ment.

---

## L'escalier des lots

`lib/scripts/lotLadder.js` répond à une seule question : **combien de lots, vu où
en est le compte ?** Il ne touche à rien, ne connaît aucune stratégie, et
s'ajoute à un script en deux lignes — `...ladderFields()` dans son `fields`,
`createLotLadder(params, capital)` dans son `setup`.

```js
const ladder = createLotLadder(params, account.capital);
const ref    = params.ladderRef === 'equite' ? account.equity : account.balance;
api.buy({ lots: api.normalizeLots(ladder.lots(ref)), tpPts: 100 });
```

**Un escalier multiplie l'espérance, il ne la crée pas.** Sur une stratégie qui
perd un demi-point par trade, il fait perdre plus vite, et l'accélération est
exactement la même que dans l'autre sens. Il se branche donc **après** avoir
montré qu'on gagne à lot fixe, jamais pour y arriver.

| Mode | Le lot | La courbe |
|---|---|---|
| `fixe` | constant | droite — le seul mode qui se **lit** |
| `proportionnel` | base × compte / capital | exponentielle, drawdown en % inchangé |
| `paliers` + `plus` | +N lots tous les X USD | escalier arithmétique |
| `table` | paliers écrits à la main (`2000:0.2, 5000:0.5`) | ce qu'on a décidé |
| `paliers` + `fois` | ×F lots tous les X USD | **super-exponentielle — c'est celle qui ruine** |

Deux réglages pèsent plus lourd que le mode lui-même :

- **`ladderRef`** — `solde` ne compte que les positions fermées, `equite` inclut
  le flottant. En équité, une position ouverte en gain monte le lot de la
  suivante, et un retournement les emporte ensemble.
- **`ladderDown`** — en `cliquet`, le lot ne redescend jamais. Le compte monte à
  3000, prend le lot de ce palier, retombe à 2000, et continue d'y perdre à la
  taille du palier 3000. C'est le réglage qui fabrique les plus beaux chiffres
  et les plus mauvaises fins.

Mesuré sur 7 900 positions, capital 1 000 USD, marge 100 USD/lot, **à stratégie
gagnante identique** : lot fixe → ×11 avec 18 % de creux ; paliers `+0,05 / 1000`
→ ×20 avec 67 % ; le même en cliquet → ×70 avec 91 % de creux et 6 stop outs ;
et `×2 / 1000` en cliquet → **−92 %**, 45 stop outs et 7 236 ordres refusés faute
de marge. Le dernier cas est le plus instructif : la stratégie n'a pas changé,
c'est la taille qui a mangé le compte, et le refus d'ordre a fini par choisir les
trades à sa place.

---

## L'API du script

```js
// Ordres — un ordre au marché est rempli à l'OUVERTURE de la bougie suivante
api.buy ({ lots, riskPct, sl, tp, slPts, tpPts, rr, type, price, expireBars, tag })
api.sell({ … })                       // mêmes options
api.order({ side: 'buy'|'sell', … })

// type: 'market' (défaut) | 'stop' | 'limit' — 'stop'/'limit' exigent `price`
// lots omis + riskPct fourni → la taille est calculée au remplissage, sur la
//   distance réelle entrée→stop
// tp : absolu (`tp`), en points (`tpPts`), ou en multiple du risque (`rr`)
// expireBars : nombre de bougies pendant lesquelles l'ordre reste offert (0 = toujours)

// Positions — des COPIES : on ne modifie jamais une position à la main
api.positions          // [{ id, side, lots, entryPrice, sl, sl0, tp, maxFavorPts, maxAdversePts, beMoved, … }]
api.pending            // ordres non encore remplis
api.close(pos, reason) // ferme à la CLÔTURE de la bougie courante
api.closeAll(reason)
api.modify(pos, { sl, tp })   // un stop porté au-delà de l'entrée marque `beMoved`
api.cancel(orderId) / api.cancelAll()

// Compte et dimensionnement
api.account            // { balance, equity, wealth, usedMargin, freeMargin, marginLevel,
                       //   floating, openCount, external, deposits, withdrawals, absorbed,
                       //   cfg: { pointValue, marginPerLot, spreadPts, slipPct, minLot, … } }
api.lotsForRisk(riskPct, stopPoints)
api.normalizeLots(lots) / api.canAfford(lots)

// Caisse — l'argent qui SORT du compte n'est plus exposé : ni au flottant, ni à
// la marge, ni au stop out. C'est la différence entre « j'ai 500 $ » et « j'ai
// 500 $ dont 7,50 chez le broker ». `withdraw` rend ce qui est vraiment sorti,
// borné à la marge libre.
api.withdraw(usd, raison) / api.deposit(usd, raison)

api.log('message')     // apparaît dans l'onglet Journal du résultat
```

---

## Les règles du moteur

Les bougies sont **celles chargées sur le graphe**, au timeframe affiché. Il n'y
a donc pas de sous-résolution M1 comme dans `lib/backtest/engine.js` : à
l'intérieur d'une bougie, l'ordre réel des prix est inconnu. Trois règles
tranchent, toutes pessimistes :

- **SL et TP touchés dans la même bougie → le SL gagne.**
- Une position remplie pendant une bougie est **exposée au SL/TP de cette
  bougie-là**, sur toute son amplitude.
- La marge est surveillée **au pire prix de la bougie** (équité évaluée au plus
  bas et au plus haut, le minimum compte).

### L'ordre des événements dans la bougie `i`

1. les ordres au marché posés à la clôture de `i−1` sont remplis à l'**ouverture**
   de `i` — c'est là qu'est l'anti-lookahead ;
2. les ordres en attente (stop / limite) sont remplis s'ils sont touchés, **au
   niveau demandé ou à l'ouverture si la bougie a ouvert au-delà** — jamais à un
   prix meilleur que le marché ;
3. SL / TP des positions ouvertes, SL prioritaire ;
4. MFE / MAE de chaque position ;
5. marge : appel de marge, puis stop out ;
6. valorisation à la clôture, puis appel du script — qui décide pour `i+1`.

### Le compte

```
margeUtilisée = Σ lots × margeParLot          (immobilisée, pas dépensée)
équité        = solde + flottant des positions ouvertes
niveau        = équité / margeUtilisée × 100
```

- **niveau < appel de marge** (défaut 100 %) → compté, **rien n'est fermé**. Un
  appel compte un **épisode**, pas une bougie : dix bougies sous le seuil sans
  remonter, c'est un appel. Le nombre de bougies est compté à part.
- **niveau < stop out** (défaut 50 %) → la position **la plus perdante** est
  liquidée, et on recommence tant qu'on reste sous le seuil. C'est pourquoi un
  stop out en emporte parfois plusieurs d'affilée.
- **équité ≤ 0** → **ruine**, le script s'arrête là.
- Un ordre que la marge libre ne permet pas est **refusé et compté** — jamais
  ignoré en silence.

### Le stop qu'on demande et celui qu'on obtient

Un stop est demandé à un prix et servi au premier prix **traité** au-delà. Les
deux ne se confondent que sur un marché continu. Le réglage de compte
**« Glissement du stop »** (`slipPct`) dit quelle part du chemin parcouru au-delà
du stop, dans la bougie qui l'a touché, a réellement été payée : 0 % le niveau
demandé, 100 % le pire prix de la bougie.

Sur un instrument qui bondit, ce n'est pas un détail de deuxième ordre. Sur Boom
1000 M1, une bougie de spike porte 59 ticks comme toutes les autres — le bond est
**un tick** — et clôture à 2 % de son sommet : un stop posé dedans est servi
après le saut. La même stratégie y rend +3 584 $ à 0 % et +327 $ à 100 %
(`docs/boom-rsier.md`).

La **protection du solde négatif** (`negProtect`, active par défaut) est celle des
comptes de détail : une position qui coûte plus que le solde le laisse à zéro,
pas en dessous. Ce qui a été effacé est compté à part (`pertesEffacees`) — un
profit net qui n'existe que parce que cette colonne est énorme est un transfert,
pas un edge.

Le **spread** (aller-retour, en points) et la **commission** (USD par lot) sont
portés par la position **dès son ouverture** et comptés dans le flottant : une
position vaut son coût en moins à la seconde où elle s'ouvre. Sans ça, l'équité
mentirait juste assez pour repousser un stop out.

À la dernière bougie, les positions encore ouvertes sont **soldées à sa clôture**
(cause `end`) : elles comptent dans le solde final et dans les statistiques.

---

## Lire le résultat

Le **drawdown** est celui de l'équité relevée **à chaque bougie**, pas celui de
la courbe des trades fermés. La seconde lisse les creux traversés en position —
c'est-à-dire précisément ceux qui déclenchent les appels de marge.

Le bouton **↓ JSON** télécharge le rapport complet (`buildScriptReport`) :
paramètres, conventions, statistiques et la liste des trades. Même esprit que les
rapports de motifs — relisible dans six mois sans avoir à deviner les règles.

---

## Ce qui n'y est pas encore

- **Pas de sous-résolution M1.** Le moteur de backtest sait le faire
  (`aggregateWithRanges`) ; l'y brancher rendrait les fills intra-bougie exacts au
  lieu de pessimistes.
- **Pas de balayage de paramètres.** Un script se lance à la main, un jeu de
  réglages à la fois.

---

## Les positions sur le graphe

À la fin d'un run, les positions sont peintes sur le graphe : bande rouge du
risque (entrée→stop), bande verte du gain visé (entrée→objectif), trajet
entrée→sortie coloré par le résultat NET, pointillé rouge sur le stop d'origine
quand il a été déplacé, et un marqueur `#id` à l'entrée / `±R` à la sortie.

C'est la primitive du backtest (`components/charts/TradesPrimitive.js`) qui
dessine, sans rien savoir des scripts : `lib/scripts/chartTrades.js` traduit les
trades vers sa forme. Deux traductions ont un fond — le résultat repasse des USD
aux points **nets** (un gain brut qui ne couvre pas ses frais est une perte, et
doit être rouge), et les causes de sortie qu'elle ne connaît pas (signal, temps,
liquidation, fin de données) deviennent `other`, en gris.

Les positions sont tenues par la **page**, pas par le tiroir : on referme le
tiroir justement pour les regarder. Elles s'effacent au changement de symbole ou
d'unité de temps — elles appartiennent aux bougies sur lesquelles le script a
tourné. Le bouton **◨ Sur le graphe** les masque sans relancer, et cliquer une
ligne du tableau recadre le graphe dessus en atténuant les autres.
