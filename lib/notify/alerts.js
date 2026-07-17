// CRUD des alertes. Les colonnes JSON (params, channels) sont stockées en
// VARCHAR et (dé)sérialisées ici — le reste du code ne voit que des objets.

import { query, run } from '../db';
import { getStrategy, sanitizeParams } from '../backtest/strategies';
import { sanitizeChannels } from './channels';
import { TF_SECONDS } from '../replayUtils';

const parse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

function hydrate(row) {
  return {
    id:          row.id,
    name:        row.name,
    symbolId:    row.symbol_id,
    symbol:      row.symbol ?? null,
    tf:          row.tf,
    strategyId:  row.strategy_id,
    params:      parse(row.params, {}),
    channels:    parse(row.channels, []),
    enabled:     Boolean(row.enabled),
    cooldownSec: row.cooldown_sec,
    dedupSignal: Boolean(row.dedup_signal),
    lastBucket:  row.last_bucket  == null ? null : Number(row.last_bucket),
    lastSignal:  row.last_signal,
    lastFiredTs: row.last_fired_ts == null ? null : Number(row.last_fired_ts),
  };
}

const SELECT = `
  SELECT a.*, s.name AS symbol
  FROM alerts a LEFT JOIN symbols s ON s.id = a.symbol_id
`;

export async function listAlerts() {
  const rows = await query(`${SELECT} ORDER BY a.id`);
  return rows.map(hydrate);
}

export async function getAlert(id) {
  const [row] = await query(`${SELECT} WHERE a.id = ?`, Number(id));
  return row ? hydrate(row) : null;
}

// Alertes armées sur un symbole — chemin chaud, appelé à chaque POST de l'EA.
export async function activeAlertsForSymbol(symbolId) {
  const rows = await query(`${SELECT} WHERE a.symbol_id = ? AND a.enabled`, Number(symbolId));
  return rows.map(hydrate);
}

// Valide et normalise une alerte reçue de l'UI. Renvoie { error } ou { value }.
export function validateAlert(raw = {}) {
  const strategy = getStrategy(raw.strategyId);
  if (!strategy)                            return { error: `stratégie inconnue : ${raw.strategyId}` };
  if (!TF_SECONDS.hasOwnProperty(raw.tf))   return { error: `tf inconnu : ${raw.tf}` };

  const symbolId = parseInt(raw.symbolId, 10);
  if (!Number.isFinite(symbolId))           return { error: 'symbolId invalide' };

  const channels = sanitizeChannels(raw.channels);
  if (channels.length === 0)                return { error: 'au moins un canal est requis' };

  const name = String(raw.name ?? '').trim() || `${strategy.label} ${raw.tf}`;

  return {
    value: {
      name:        name.slice(0, 64),
      symbolId,
      tf:          raw.tf,
      strategyId:  strategy.id,
      params:      sanitizeParams(strategy, raw.params),   // clampe aux bornes du schéma
      channels,
      enabled:     raw.enabled !== false,
      cooldownSec: Math.max(0, Math.min(86400, parseInt(raw.cooldownSec, 10) || 0)),
      dedupSignal: raw.dedupSignal !== false,
    },
  };
}

export async function createAlert(v) {
  await run(
    `INSERT INTO alerts (id, name, symbol_id, tf, strategy_id, params, channels, enabled, cooldown_sec, dedup_signal)
     VALUES (nextval('seq_alerts'), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    v.name, v.symbolId, v.tf, v.strategyId,
    JSON.stringify(v.params), JSON.stringify(v.channels),
    v.enabled, v.cooldownSec, v.dedupSignal,
  );
  const [row] = await query('SELECT max(id) AS id FROM alerts');
  return getAlert(row.id);
}

export async function updateAlert(id, v) {
  // Changer de stratégie/TF/params invalide l'état d'évaluation : on le remet à
  // zéro pour que l'alerte ne tire pas immédiatement sur une bougie déjà passée.
  await run(
    `UPDATE alerts SET name = ?, symbol_id = ?, tf = ?, strategy_id = ?, params = ?,
       channels = ?, enabled = ?, cooldown_sec = ?, dedup_signal = ?,
       last_bucket = NULL, last_signal = NULL
     WHERE id = ?`,
    v.name, v.symbolId, v.tf, v.strategyId,
    JSON.stringify(v.params), JSON.stringify(v.channels),
    v.enabled, v.cooldownSec, v.dedupSignal,
    Number(id),
  );
  return getAlert(id);
}

export async function deleteAlert(id) {
  await run('DELETE FROM alerts WHERE id = ?', Number(id));
  await run('DELETE FROM notif_log WHERE alert_id = ?', Number(id));
}

export async function setEnabled(id, enabled) {
  // Réarmer une alerte repart d'un état neuf (pas de tir sur l'historique).
  await run(
    'UPDATE alerts SET enabled = ?, last_bucket = NULL, last_signal = NULL WHERE id = ?',
    Boolean(enabled), Number(id),
  );
  return getAlert(id);
}

// Journal récent, pour l'UI.
export async function recentNotifs(limit = 30) {
  const rows = await query(`
    SELECT n.alert_id, n.candle_ts, n.ts, n.signal, n.payload, n.results, a.name
    FROM notif_log n LEFT JOIN alerts a ON a.id = n.alert_id
    ORDER BY n.ts DESC LIMIT ?
  `, Math.max(1, Math.min(200, limit)));

  return rows.map(r => ({
    alertId:  r.alert_id,
    name:     r.name,
    candleTs: Number(r.candle_ts),
    ts:       r.ts,
    signal:   r.signal,
    payload:  parse(r.payload, null),
    results:  parse(r.results, []),
  }));
}
