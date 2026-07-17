// PUT    /api/notify/alerts/:id — remplace l'alerte (remet l'état d'évaluation à zéro)
// PATCH  /api/notify/alerts/:id — { enabled } : arme/désarme
// DELETE /api/notify/alerts/:id
// POST   /api/notify/alerts/:id — rejoue la stratégie sur la dernière bougie close
//                                 (aperçu : ni journal, ni envoi, ni garde-fou)

import {
  getAlert, updateAlert, deleteAlert, setEnabled, validateAlert,
} from '../../../../lib/notify/alerts';
import { previewAlert } from '../../../../lib/notify/evaluate';

export default async function handler(req, res) {
  const id = parseInt(req.query.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id invalide' });

  try {
    const alert = await getAlert(id);
    if (!alert) return res.status(404).json({ error: 'alerte inconnue' });

    switch (req.method) {
      case 'PUT': {
        const { error, value } = validateAlert(req.body ?? {});
        if (error) return res.status(400).json({ error });
        return res.json(await updateAlert(id, value));
      }
      case 'PATCH':
        return res.json(await setEnabled(id, req.body?.enabled !== false));

      case 'DELETE':
        await deleteAlert(id);
        return res.status(204).end();

      case 'POST': {
        const preview = await previewAlert(alert);
        if (!preview) return res.status(404).json({ error: 'aucune bougie close sur ce symbole' });
        return res.json(preview);
      }
      default:
        return res.status(405).end();
    }
  } catch (err) {
    console.error('[notify/alerts/:id]', err);
    res.status(500).json({ error: err.message });
  }
}
