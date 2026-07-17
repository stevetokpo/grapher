# Notifications

Une **alerte** évalue une stratégie du registre `lib/backtest/strategies` à la
clôture de chaque bougie du timeframe choisi, et notifie sur les canaux voulus :
Telegram, e-mail (SMTP) et push navigateur.

## Architecture

```
lib/notify/
  channels/
    index.js      registre CHANNELS + sanitizeChannels (même motif que les stratégies)
    telegram.js   Bot API — texte libre, aucun template
    email.js      SMTP via nodemailer
    push.js       Web Push (VAPID) — lit push_subscriptions, purge les abonnements morts
  evaluate.js     ← LE fichier important (voir « Contrat » ci-dessous)
  dispatch.js     envoi multi-canaux, plafond horaire, coupe-circuit
  alerts.js       CRUD + journal
  format.js       rendu commun d'un signal (les 3 canaux disent la même chose)

lib/notifyClient.js       abonnement push côté navigateur
public/sw.js              service worker (réception push)
components/AlertsPanel.js panneau « Alertes » du header

pages/api/notify/
  alerts/index.js   GET liste · POST création
  alerts/[id].js    PUT · PATCH (armer) · DELETE · POST (aperçu sans envoi)
  channels.js       GET état des canaux · POST notif de test
  subscribe.js      abonnement push
  log.js            journal
```

Trois tables dans `lib/db.js` : `alerts`, `notif_log`, `push_subscriptions`.

## Contrat : une alerte rejoue le chemin du backtest

C'est la seule règle qui compte. Si l'alerte live n'évalue pas exactement ce que
le backtest a évalué, les notifications ne correspondent pas au signal mesuré et
l'edge « disparaît » en réel sans qu'on comprenne pourquoi.

1. **Même agrégation** — `aggregateWithRanges()` du moteur, pas une copie.
2. **On jette la bougie en cours de formation.** La règle 1 du contrat du moteur
   (`docs/backtesting.md`) dit que la stratégie décide à la **clôture** de la
   bougie `i`. Évaluer une bougie ouverte, c'est lire une information que le
   backtest n'a jamais eue.
3. **Même fonction** — `strategy.onBar()`, celle que `runBacktest` appelle.

### Quand l'évaluation se déclenche

L'EA MT5 poste des M1 toutes les 2 s sur `/api/live/bars`. Après l'INSERT, la
route appelle `evaluateAlerts()` **sans `await`** (l'ingestion ne doit pas
attendre un SMTP). La promesse flottante aboutit parce que Next tourne en
process long-vivant — en serverless il faudrait un `waitUntil`.

Le garde-fou bon marché est le **bucket** : `last_bucket` mémorise la bougie TF
en cours lors de la dernière passe. Tant qu'aucun bucket plus récent n'apparaît,
aucune bougie n'a clôturé et on ne charge même pas les bougies. Une alerte 4h ne
travaille donc que 6 fois par jour, quel que soit le débit de l'EA.

`last_bucket = NULL` (alerte neuve, modifiée ou ré-armée) ⇒ la première passe
**enregistre le bucket sans déclencher**. Sans ça, toute alerte créée tirerait
aussitôt sur la dernière bougie close de l'historique.

### Limite assumée : pas de position simulée

`evaluate.js` passe `position: null` à chaque appel. Une alerte notifie des
**signaux d'entrée**, elle ne simule pas de position ouverte. Conséquence : une
stratégie dont les signaux dépendent de `position` (trenderHarmony ré-arme son
ordre stop à chaque clôture) notifierait à **chaque bougie**. Deux garde-fous :

- **Anti-répétition** (`dedupSignal`, activé par défaut) — ne notifie qu'au
  **changement de sens**. Un `buy` répété 40 bougies d'affilée ne notifie qu'une
  fois ; il faut un `sell` pour réarmer. Une absence de signal ne réarme pas.
- **Cooldown** — délai minimal entre deux notifs d'une même alerte.

## Déduplication et garde-fous

| Mécanisme | Où | Effet |
|---|---|---|
| PK `(alert_id, candle_ts)` de `notif_log` | `evaluate.js` | L'INSERT **est** le verrou : l'EA renvoie des plages qui se recouvrent, une bougie n'est notifiée qu'une fois. |
| Plafond horaire (30) | `dispatch.js` | Compté dans `notif_log`, donc survit à un redémarrage. Un bug de stratégie ne peut pas vider ta batterie. |
| `NOTIFY_ENABLED=false` | `dispatch.js` | Coupe-circuit global, sans toucher aux alertes. |
| Verrou par symbole | `evaluate.js` | Une seule évaluation à la fois par symbole (l'EA poste toutes les 2 s). |

## Couper la réception d'un canal

Trois niveaux de coupure, du plus large au plus fin :

| Niveau | Où | Portée |
|---|---|---|
| `NOTIFY_ENABLED=false` | `.env.local` | Rien ne part, aucun canal, aucune évaluation. |
| **Réception par canal** | panneau Alertes (table `channel_prefs`) | Ce canal est muet pour **toutes** les alertes. |
| `alert.channels` | par alerte | Cette alerte n'utilise pas ce canal. |

Le niveau du milieu est celui du quotidien : l'interrupteur à droite de chaque
canal dans le panneau coupe l'e-mail (ou le push, ou Telegram) d'un geste, sans
toucher aux alertes. Une ligne n'est écrite en base **que** pour une coupure —
un canal sans ligne est actif, donc l'état par défaut reste « tout passe ».

Deux propriétés voulues :

- **Une alerte coupée reste évaluée et journalisée**, seul l'envoi est supprimé.
  L'état de déduplication (`last_signal`) continue donc d'avancer, et rétablir un
  canal ne déclenche **pas** de rafale de rattrapage.
- **Coupé ≠ échoué.** Le résultat porte `{ muted: true }` et non une erreur :
  le journal doit distinguer une mise en sourdine volontaire d'une panne SMTP.

`ready` (les variables d'environnement sont là) et `enabled` (la réception n'est
pas coupée) sont deux booléens distincts — un canal peut être parfaitement
configuré et volontairement muet.

Il n'y a **pas** de garde « marché fermé » basé sur l'horloge, et c'est
volontaire : les `ts` des bougies sont des timestamps **naïfs en heure broker**,
les comparer à `Date.now()` serait faux. De toute façon le pipeline est piloté
par l'arrivée des bougies — marché fermé ⇒ aucune bougie ⇒ aucune évaluation.

## Configuration

Tout est dans `.env.local` (voir `.env.example`). Un canal dont les variables
manquent s'affiche « non configuré » dans le panneau, il ne casse rien.

**Telegram** — crée le bot avec `@BotFather` → token. Pour le `chat_id` : écris
un message au bot, puis ouvre `https://api.telegram.org/bot<TOKEN>/getUpdates` et
lis `result[0].message.chat.id`.

**E-mail** — `SMTP_HOST/PORT/USER/PASS` + `NOTIFY_EMAIL_FROM/TO`.
`SMTP_SECURE=true` ⇒ TLS implicite (465), sinon STARTTLS (587).

**Push** — `npx web-push generate-vapid-keys`. La clé publique doit figurer deux
fois : `VAPID_PUBLIC_KEY` (serveur) et `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (le seul
préfixe que Next expose au navigateur). Puis « Abonner ce navigateur » dans le
panneau Alertes.

> Le push exige un **contexte sécurisé** : `http://localhost` en est un, une IP
> de LAN (`192.168.x.x`) **non**. Pour recevoir sur un téléphone il faudrait
> servir Grapher en HTTPS avec un vrai certificat — dans ce cas, Telegram est le
> chemin court.

## Ajouter un canal (ex. WhatsApp)

Créer `lib/notify/channels/whatsapp.js` sur le contrat du registre
(`id`, `label`, `desc`, `envKeys`, `ready()`, `send(signal)`), l'ajouter à
`CHANNELS` — rien d'autre : le panneau et la validation de l'API se génèrent
depuis le registre.

Pour WhatsApp Cloud API, attention : une notif est un message *business-initiated*,
donc hors fenêtre de 24 h ⇒ **template pré-approuvé obligatoire** (texte figé à
variables `{{1}}`, validation Meta de quelques heures à quelques jours). C'est la
raison pour laquelle Telegram a été livré en premier.

## Attention en dev

`lib/db.js` met le schéma en cache dans `global.__duckdb_ready` pour survivre au
hot-reload. **Ajouter une table impose un vrai redémarrage** du serveur : un
hot-reload rechargera le code mais ne rejouera jamais `SCHEMA_SQL`, et tu verras
`Table with name … does not exist`.
