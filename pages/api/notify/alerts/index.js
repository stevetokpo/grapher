// GET  /api/notify/alerts — liste des alertes
// POST /api/notify/alerts — crée une alerte
//   { name, symbolId, tf, strategyId, params, channels, enabled, cooldownSec, dedupSignal }
//   Les params sont clampés au schéma de la stratégie (sanitizeParams), comme
//   pour un backtest : une valeur hors bornes ne fait jamais échouer la requête.

import { listAlerts, createAlert, validateAlert } from '../../../../lib/notify/alerts';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      return res.json(await listAlerts());
    }

    if (req.method === 'POST') {
      const { error, value } = validateAlert(req.body ?? {});
      if (error) return res.status(400).json({ error });
      return res.status(201).json(await createAlert(value));
    }

    res.status(405).end();
  } catch (err) {
    console.error('[notify/alerts]', err);
    res.status(500).json({ error: err.message });
  }
}
