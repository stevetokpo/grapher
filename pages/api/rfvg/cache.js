// GET/DELETE /api/rfvg/cache — état et purge du cache de l'optimiseur.
//
// Un symbole en cache, c'est son historique M1 complet en mémoire : ~200 Mo pour
// 300 000 bougies, agrégations comprises. Le cache est plafonné à 2 symboles
// (lib/signals/data.js), mais après une longue session d'optimisation
// multi-symboles on veut pouvoir rendre la mémoire au serveur dev sans le
// redémarrer. Le cache étant COMMUN à tous les motifs, purger ici purge aussi le
// KO — même route, même effet, que l'on passe par /api/rfvg/cache ou /api/ko/cache.

import { cacheInfo, clearCache } from '../../../lib/rfvg/data';

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
