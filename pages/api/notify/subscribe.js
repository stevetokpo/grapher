// POST   /api/notify/subscribe — enregistre l'abonnement push du navigateur
//   Corps : l'objet PushSubscription sérialisé (endpoint + keys.p256dh/auth).
// DELETE /api/notify/subscribe — { endpoint } : désabonne ce navigateur
// GET    /api/notify/subscribe — nombre de navigateurs abonnés

import { query, run } from '../../../lib/db';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const [row] = await query('SELECT count(*)::INTEGER AS n FROM push_subscriptions');
      return res.json({ count: row?.n ?? 0 });
    }

    if (req.method === 'POST') {
      const { endpoint, keys, label } = req.body ?? {};
      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        return res.status(400).json({ error: 'abonnement push invalide' });
      }

      // Ré-abonnement du même navigateur → même endpoint : on écrase.
      await run('DELETE FROM push_subscriptions WHERE endpoint = ?', endpoint);
      await run(
        'INSERT INTO push_subscriptions (endpoint, p256dh, auth, label) VALUES (?, ?, ?, ?)',
        endpoint, keys.p256dh, keys.auth, String(label ?? '').slice(0, 64) || null,
      );
      return res.status(201).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const { endpoint } = req.body ?? {};
      if (!endpoint) return res.status(400).json({ error: 'endpoint requis' });
      await run('DELETE FROM push_subscriptions WHERE endpoint = ?', endpoint);
      return res.status(204).end();
    }

    res.status(405).end();
  } catch (err) {
    console.error('[notify/subscribe]', err);
    res.status(500).json({ error: err.message });
  }
}
