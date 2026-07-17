// Évaluation des alertes en live.
//
// CONTRAT — l'alerte doit rejouer EXACTEMENT le chemin du backtest, sinon les
// notifications live ne correspondent pas au signal mesuré et l'edge « disparaît
// mystérieusement » en réel. Concrètement :
//
//   1. On agrège les M1 avec `aggregateWithRanges` du moteur (pas une copie).
//   2. On JETTE la dernière bougie : elle est en train de se former. La règle 1
//      du contrat du moteur (docs/backtesting.md) dit que la stratégie décide à
//      la CLÔTURE de la bougie i — décider sur une bougie ouverte, c'est lire
//      une information que le backtest n'a jamais eue.
//   3. On appelle `strategy.onBar` — la même fonction que runBacktest.
//
// LIMITE ASSUMÉE — `position: null` est passé à chaque évaluation : une alerte
// notifie des SIGNAUX D'ENTRÉE, elle ne simule pas de position ouverte. Une
// stratégie dont les signaux dépendent de `position` (filtrage d'un signal déjà
// en position, break-even, retournement) notifiera donc PLUS souvent que le
// backtest n'aurait pris de trades. C'est le rôle de `dedupSignal` (ne notifier
// qu'au changement de sens) et du cooldown de ramener ça à un débit utile.

import { query, run } from '../db';
import { aggregateWithRanges } from '../backtest/engine';
import { getStrategy } from '../backtest/strategies';
import { TF_SECONDS } from '../replayUtils';
import { activeAlertsForSymbol } from './alerts';
import { dispatch, notifsLastHour, notificationsEnabled, MAX_NOTIFS_PER_HOUR } from './dispatch';

// Historique chargé pour amorcer les indicateurs de la stratégie.
const WARMUP_TF_CANDLES = 300;
const MAX_M1_BARS       = 150_000;

// Une évaluation par symbole à la fois : l'EA poste toutes les 2 s, les appels
// se chevaucheraient sinon. (La PK de notif_log garantit déjà l'absence de
// double envoi ; ce verrou évite juste de recharger les bougies pour rien.)
const inFlight = new Set();

// Actions d'entrée du contrat de stratégie → sens du signal.
// 'close' et 'modify' pilotent une position : sans position simulée, ils n'ont
// pas de sens en alerte et sont ignorés.
const SIGNAL_OF = { buy: 'buy', buyStop: 'buy', sell: 'sell', sellStop: 'sell' };

async function loadM1(symbolId, tfSec) {
  const need = Math.min(WARMUP_TF_CANDLES * Math.ceil(tfSec / 60), MAX_M1_BARS);
  const rows = await query(`
    SELECT
      epoch(ts)::INTEGER AS time,
      open::DOUBLE       AS open,
      high::DOUBLE       AS high,
      low::DOUBLE        AS low,
      close::DOUBLE      AS close,
      tick_vol::INTEGER  AS volume
    FROM bars_m1
    WHERE symbol_id = ${Number(symbolId)}
    ORDER BY ts DESC
    LIMIT ${Number(need)}
  `);
  return rows.reverse();   // le moteur veut l'ordre chronologique
}

// Évalue une alerte. Renvoie une raison de non-déclenchement (debug) ou le signal émis.
async function evaluateOne(alert, lastTs) {
  const strategy = getStrategy(alert.strategyId);
  if (!strategy) return { skipped: `stratégie inconnue : ${alert.strategyId}` };

  const tfSec = TF_SECONDS[alert.tf];
  if (!tfSec) return { skipped: `tf inconnu : ${alert.tf}` };

  // Bougie TF en cours de formation d'après la dernière M1 en base.
  const formingBucket = Math.floor(lastTs / tfSec) * tfSec;

  // Première évaluation : on enregistre le bucket sans déclencher. Sans ça,
  // toute alerte nouvellement créée tirerait aussitôt sur la dernière bougie
  // close de l'historique — une notif pour un signal parfois vieux de plusieurs jours.
  if (alert.lastBucket == null) {
    await run('UPDATE alerts SET last_bucket = ? WHERE id = ?', formingBucket, alert.id);
    return { skipped: 'amorçage' };
  }

  // Pas de nouveau bucket ⇒ aucune bougie n'a clôturé depuis la dernière passe.
  // C'est le garde-fou bon marché : il évite de charger les bougies à chaque
  // POST de l'EA (toutes les 2 s) alors qu'on ne travaille qu'aux clôtures TF.
  if (formingBucket <= alert.lastBucket) return { skipped: 'pas de nouvelle clôture' };

  const m1 = await loadM1(alert.symbolId, tfSec);
  if (m1.length === 0) return { skipped: 'aucune bougie M1' };

  const { candles } = aggregateWithRanges(m1, alert.tf);

  // ── Le point qui compte ── on jette la bougie en cours de formation.
  if (candles.length && candles[candles.length - 1].time === formingBucket) candles.pop();
  if (candles.length === 0) return { skipped: 'pas de bougie close' };

  const i      = candles.length - 1;   // dernière bougie CLOSE
  const closed = candles[i];

  // Le bucket avance toujours, même si la stratégie ne dit rien : sinon on
  // rechargerait les bougies à chaque POST jusqu'à la prochaine clôture.
  await run('UPDATE alerts SET last_bucket = ? WHERE id = ?', formingBucket, alert.id);

  const ind   = strategy.setup ? strategy.setup(candles, alert.params) : {};
  const order = strategy.onBar({
    candles, i, ind,
    position:  null,          // cf. LIMITE ASSUMÉE en tête de fichier
    params:    alert.params,
    lastTrade: null,
  });

  const signal = order?.action ? SIGNAL_OF[order.action] : null;
  if (!signal) return { skipped: 'aucun signal' };

  // Anti-répétition : une stratégie qui ré-arme son ordre stop à chaque clôture
  // (trenderHarmony…) émet le même signal bougie après bougie. On ne notifie
  // qu'au CHANGEMENT de sens ; l'absence de signal ne réarme pas.
  if (alert.dedupSignal && signal === alert.lastSignal) {
    return { skipped: `signal ${signal} déjà notifié` };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (alert.cooldownSec > 0 && alert.lastFiredTs != null
      && nowSec - alert.lastFiredTs < alert.cooldownSec) {
    return { skipped: 'cooldown' };
  }

  const hourly = await notifsLastHour();
  if (hourly >= MAX_NOTIFS_PER_HOUR) {
    console.warn(`[notify] plafond horaire atteint (${hourly}/${MAX_NOTIFS_PER_HOUR}) — alerte ${alert.id} étouffée`);
    return { skipped: 'plafond horaire' };
  }

  const payload = {
    alertId:       alert.id,
    alertName:     alert.name,
    symbol:        alert.symbol,
    tf:            alert.tf,
    strategyLabel: strategy.label,
    signal,
    action:        order.action,
    price:         Number.isFinite(order.price) ? order.price : closed.close,
    sl:            order.sl ?? null,
    tp:            order.tp ?? null,
    reason:        order.reason ?? null,
    candleTs:      closed.time,
  };

  // Réservation atomique : la PK (alert_id, candle_ts) fait office de verrou.
  // Si la bougie a déjà été notifiée (l'EA renvoie des plages qui se recouvrent),
  // l'INSERT viole la contrainte et on sort sans rien envoyer.
  try {
    await run(
      'INSERT INTO notif_log (alert_id, candle_ts, signal, payload) VALUES (?, ?, ?, ?)',
      alert.id, closed.time, signal, JSON.stringify(payload),
    );
  } catch {
    return { skipped: 'bougie déjà notifiée' };
  }

  const results = await dispatch(payload, alert.channels);

  await run('UPDATE notif_log SET results = ? WHERE alert_id = ? AND candle_ts = ?',
    JSON.stringify(results), alert.id, closed.time);
  await run('UPDATE alerts SET last_signal = ?, last_fired_ts = ? WHERE id = ?',
    signal, nowSec, alert.id);

  const sent  = results.filter(r => r.ok).length;
  const muted = results.filter(r => r.muted).length;
  console.log(
    `[notify] ${payload.symbol} ${payload.tf} ${signal} — ${sent}/${results.length - muted} canal(aux) OK`
    + (muted ? ` (${muted} coupé[s])` : '')
  );

  return { fired: payload, results };
}

// Point d'entrée appelé (sans await) par /api/live/bars après l'insertion.
// Ne throw jamais : une notif qui échoue ne doit pas casser l'ingestion.
export async function evaluateAlerts(symbolId, lastTs) {
  if (!notificationsEnabled()) return;
  if (!Number.isFinite(lastTs)) return;
  if (inFlight.has(symbolId)) return;
  inFlight.add(symbolId);

  try {
    const alerts = await activeAlertsForSymbol(symbolId);
    for (const alert of alerts) {
      try {
        await evaluateOne(alert, lastTs);
      } catch (err) {
        console.error(`[notify] alerte ${alert.id} (${alert.name}) :`, err.message);
      }
    }
  } catch (err) {
    console.error('[notify] évaluation :', err.message);
  } finally {
    inFlight.delete(symbolId);
  }
}

// Rejoue une alerte sur la dernière bougie close SANS les garde-fous
// (dedup, cooldown, plafond, journal) — sert au bouton « Tester » de l'UI.
export async function previewAlert(alert) {
  const strategy = getStrategy(alert.strategyId);
  const tfSec    = TF_SECONDS[alert.tf];
  if (!strategy || !tfSec) return null;

  const m1 = await loadM1(alert.symbolId, tfSec);
  if (m1.length === 0) return null;

  const lastTs        = m1[m1.length - 1].time;
  const formingBucket = Math.floor(lastTs / tfSec) * tfSec;

  const { candles } = aggregateWithRanges(m1, alert.tf);
  if (candles.length && candles[candles.length - 1].time === formingBucket) candles.pop();
  if (candles.length === 0) return null;

  const i     = candles.length - 1;
  const ind   = strategy.setup ? strategy.setup(candles, alert.params) : {};
  const order = strategy.onBar({ candles, i, ind, position: null, params: alert.params, lastTrade: null });

  const signal = order?.action ? SIGNAL_OF[order.action] : null;
  return {
    candleTs:  candles[i].time,
    close:     candles[i].close,
    signal,
    action:    order?.action ?? null,
    tfBarCount: candles.length,
  };
}
