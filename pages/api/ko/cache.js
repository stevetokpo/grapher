// GET/DELETE /api/ko/cache — état et purge du cache des optimiseurs.
//
// Le cache est COMMUN à tous les motifs (lib/signals/data.js) : les bougies M1 et
// leurs agrégations ne dépendent pas du motif, seuls les signaux sont
// compartimentés. Purger ici purge donc aussi le rFVG, et c'est voulu — un
// symbole en cache, c'est son historique M1 complet en mémoire, ~200 Mo pour
// 300 000 bougies. Après une longue session d'optimisation multi-symboles, on
// veut pouvoir rendre la mémoire au serveur dev sans le redémarrer.

import { cacheInfo, clearCache } from '../../../lib/signals/data';

export default function handler(req, res) {
  if (req.method === 'DELETE') {
    clearCache();
    if (global.gc) global.gc();   // seulement si node tourne avec --expose-gc
    return res.json({ ok: true, ...cacheInfo() });
  }
  if (req.method === 'GET') {
    const m = process.memoryUsage();
    return res.json({
      ...cacheInfo(),
      heapUsedMB: +(m.heapUsed / 1048576).toFixed(1),
      rssMB:      +(m.rss / 1048576).toFixed(1),
    });
  }
  res.status(405).end();
}
