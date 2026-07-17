// GET   /api/notify/channels — état des canaux + clé publique VAPID.
//   Deux booléens distincts par canal :
//     ready   : les variables d'environnement sont là (config)
//     enabled : la réception n'est pas coupée (préférence, table channel_prefs)
//   Un canal peut être ready et coupé — c'est le cas d'usage « je mets l'e-mail
//   en sourdine ce week-end » sans toucher aux alertes.
// PATCH /api/notify/channels — { channel, enabled } : coupe/rétablit un canal
// POST  /api/notify/channels — { channels: [id] } : envoie une notif de test

import { describeChannels, sanitizeChannels, getChannel } from '../../../lib/notify/channels';
import { channelPrefs, setChannelPref } from '../../../lib/notify/prefs';
import { dispatch, notificationsEnabled, notifsLastHour, MAX_NOTIFS_PER_HOUR } from '../../../lib/notify/dispatch';

async function payload() {
  const prefs = await channelPrefs();
  return {
    channels:       describeChannels().map(c => ({ ...c, enabled: prefs[c.id] !== false })),
    enabled:        notificationsEnabled(),   // coupe-circuit global (NOTIFY_ENABLED)
    vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null,
    lastHour:       await notifsLastHour(),
    maxPerHour:     MAX_NOTIFS_PER_HOUR,
  };
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      return res.json(await payload());
    }

    if (req.method === 'PATCH') {
      const { channel, enabled } = req.body ?? {};
      if (!getChannel(channel)) return res.status(400).json({ error: `canal inconnu : ${channel}` });
      await setChannelPref(channel, enabled !== false);
      return res.json(await payload());
    }

    if (req.method === 'POST') {
      const channels = sanitizeChannels(req.body?.channels);
      if (channels.length === 0) return res.status(400).json({ error: 'aucun canal valide' });

      // Signal factice : même forme que celui produit par evaluate.js, donc le
      // test exerce le vrai chemin de rendu de chaque canal — et respecte les
      // coupures, sinon il mentirait sur ce que tu recevras vraiment.
      const results = await dispatch({
        alertId:       0,
        alertName:     'Test',
        symbol:        'XAUUSD',
        tf:            '1h',
        strategyLabel: 'Notification de test',
        signal:        'buy',
        action:        'buy',
        price:         2385.42,
        sl:            2379.10,
        tp:            2398.06,
        reason:        'test manuel depuis Grapher',
        candleTs:      Math.floor(Date.now() / 1000),
      }, channels);

      return res.json({ results });
    }

    res.status(405).end();
  } catch (err) {
    console.error('[notify/channels]', err);
    res.status(500).json({ error: err.message });
  }
}
