// Envoi multi-canaux + garde-fous.
//
// Un bug de stratégie ne doit pas pouvoir vider ta batterie : le plafond
// horaire est global (toutes alertes confondues) et se lit dans notif_log,
// donc il survit à un redémarrage du serveur.

import { query } from '../db';
import { getChannel } from './channels';
import { channelPrefs } from './prefs';

export const MAX_NOTIFS_PER_HOUR = 30;

// Coupe-circuit global : NOTIFY_ENABLED=false désarme tout sans toucher aux alertes.
export function notificationsEnabled() {
  return process.env.NOTIFY_ENABLED !== 'false';
}

// Nombre de notifications déjà émises sur la dernière heure.
// current_timestamp de DuckDB, comparé à notif_log.ts posé par la même horloge —
// pas de piège de fuseau ici (contrairement aux ts de bougies, en heure broker).
export async function notifsLastHour() {
  const [row] = await query(
    "SELECT count(*)::INTEGER AS n FROM notif_log WHERE ts > current_timestamp - INTERVAL 1 HOUR"
  );
  return row?.n ?? 0;
}

// Envoie le signal sur chaque canal. N'échoue jamais : un canal HS n'empêche
// pas les autres, et le résultat détaillé part dans notif_log.
//
// Un canal coupé (channel_prefs) renvoie { muted: true } — ce n'est PAS une
// erreur : le journal doit distinguer « tu l'as éteint » de « ça a planté ».
export async function dispatch(signal, channelIds) {
  const prefs = await channelPrefs();

  const results = await Promise.all(channelIds.map(async id => {
    const ch = getChannel(id);
    if (!ch)              return { channel: id, ok: false, error: 'canal inconnu' };
    if (prefs[id] === false) return { channel: id, ok: false, muted: true };
    if (!ch.ready())      return { channel: id, ok: false, error: `config incomplète (${ch.envKeys.filter(k => !process.env[k]).join(', ')})` };

    try {
      await ch.send(signal);
      return { channel: id, ok: true };
    } catch (err) {
      console.error(`[notify:${id}]`, err.message);
      return { channel: id, ok: false, error: String(err.message).slice(0, 300) };
    }
  }));

  return results;
}
