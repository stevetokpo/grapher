// Canal Web Push — service worker + VAPID.
//
// Portée : le navigateur du PC qui fait tourner Grapher. `localhost` est un
// contexte sécurisé, donc aucun HTTPS ni certificat n'est nécessaire. La notif
// arrive même si l'onglet Grapher est fermé, tant que le navigateur tourne —
// c'est tout l'intérêt du service worker par rapport à l'API Notification.
//
// Clés : npx web-push generate-vapid-keys
import webpush from 'web-push';
import { query, run } from '../../db';
import { formatSignal } from '../format';

let _configured = false;

function configure() {
  if (_configured) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:grapher@localhost',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
  _configured = true;
}

export default {
  id:    'push',
  label: 'Push (navigateur)',
  desc:  'Notification système via le service worker, onglet fermé accepté',
  envKeys: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'NEXT_PUBLIC_VAPID_PUBLIC_KEY'],

  ready() {
    return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  },

  async send(signal) {
    configure();

    const subs = await query('SELECT endpoint, p256dh, auth FROM push_subscriptions');
    if (subs.length === 0) throw new Error('aucun navigateur abonné au push');

    const { title, lines } = formatSignal(signal);
    const payload = JSON.stringify({
      title,
      body: lines.slice(2).join(' · '),   // saute « Alerte » et « Stratégie », déjà dans le titre
      tag:  `alert-${signal.alertId}`,    // remplace la notif précédente de la même alerte
      data: { url: '/', candleTs: signal.candleTs },
    });

    const results = await Promise.allSettled(subs.map(s =>
      webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      )
    ));

    const dead = [];
    let sent = 0;
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') return sent++;
      // 404/410 = abonnement révoqué côté navigateur → on le purge.
      const code = r.reason?.statusCode;
      if (code === 404 || code === 410) dead.push(subs[i].endpoint);
    });

    for (const endpoint of dead) {
      await run('DELETE FROM push_subscriptions WHERE endpoint = ?', endpoint);
    }

    if (sent === 0) throw new Error(`aucun envoi abouti (${dead.length} abonnement(s) périmé(s) purgé(s))`);
  },
};
