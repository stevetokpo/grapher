// Réception par canal — interrupteur global, indépendant des alertes.
//
// Trois niveaux de coupure, du plus large au plus fin :
//   NOTIFY_ENABLED=false   → rien ne part, aucun canal (env, lib/notify/dispatch)
//   channel_prefs          → ce canal est muet pour TOUTES les alertes (ici)
//   alert.channels         → cette alerte n'utilise pas ce canal (lib/notify/alerts)
//
// Une alerte reste « armée » quand son canal est coupé : elle continue d'être
// évaluée et journalisée, l'envoi seul est supprimé. C'est voulu — l'état de
// déduplication (last_signal) reste à jour, donc réactiver un canal ne provoque
// pas une rafale de rattrapage.

import { query, run } from '../db';
import { getChannel, CHANNELS } from './channels';

// { telegram: true, email: false, … } — un canal sans ligne est actif.
export async function channelPrefs() {
  const rows = await query('SELECT channel_id, enabled FROM channel_prefs');
  const prefs = Object.fromEntries(CHANNELS.map(c => [c.id, true]));
  for (const r of rows) prefs[r.channel_id] = Boolean(r.enabled);
  return prefs;
}

export async function setChannelPref(id, enabled) {
  if (!getChannel(id)) throw new Error(`canal inconnu : ${id}`);
  // DuckDB n'a pas d'UPSERT sur toutes les versions — DELETE puis INSERT est
  // sûr ici (table minuscule, un seul process).
  await run('DELETE FROM channel_prefs WHERE channel_id = ?', id);
  await run('INSERT INTO channel_prefs (channel_id, enabled) VALUES (?, ?)', id, Boolean(enabled));
  return channelPrefs();
}
