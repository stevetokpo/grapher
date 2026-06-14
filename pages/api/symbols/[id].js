import { run } from '../../../lib/db';

export default async function handler(req, res) {
  const id = parseInt(req.query.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid symbol id' });

  if (req.method !== 'DELETE') return res.status(405).end();

  try {
    await run('DELETE FROM ticks   WHERE symbol_id = ?', id);
    await run('DELETE FROM bars_m1 WHERE symbol_id = ?', id);
    await run('DELETE FROM symbols WHERE id = ?', id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[symbols/delete]', err);
    res.status(500).json({ error: err.message });
  }
}
