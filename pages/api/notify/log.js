// GET /api/notify/log?limit=30 — journal des notifications émises.
import { recentNotifs } from '../../../lib/notify/alerts';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  try {
    res.json(await recentNotifs(parseInt(req.query.limit, 10) || 30));
  } catch (err) {
    console.error('[notify/log]', err);
    res.status(500).json({ error: err.message });
  }
}
