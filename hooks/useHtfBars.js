import { useState, useEffect, useMemo } from 'react';
import { htfRequests } from '../lib/harmony';

// Charge les séries des unités de temps supérieures dont les indicateurs TRENDER
// ont besoin — l'équivalent du request.security de Pine.
//
// Les bougies du graphe sont paginées (500 par page) et une Bollinger 50 en H16
// réclame ~34 jours d'historique : reconstruire la série HTF depuis ce qui est
// affiché la laisserait vide. On va donc la chercher directement, et elle est
// minuscule (quelques dizaines de bougies).
//
// Causalité : chaque requête est bornée au début du bucket HTF courant, donc à
// des bougies HTF déjà CLÔTURÉES et antérieures à la dernière bougie du graphe.
// En replay, où `candles` s'arrête au curseur, aucune bougie future ne peut
// remonter dans le calcul. Cette borne ne bouge qu'au passage d'un bucket, ce
// qui évite de recharger à chaque avancée du curseur.
//
// Renvoie { H1: [{ time, close }], H4: [...] } — ou null si rien à charger.
export function useHtfBars(symbolId, indicators, candles) {
  const [series, setSeries] = useState(null);

  const reqs = useMemo(
    () => htfRequests(indicators, candles),
    [indicators, candles],
  );
  // Une clé stable : sans elle, le tableau `reqs` étant recréé à chaque rendu,
  // l'effet se relancerait en boucle.
  const key = useMemo(
    () => reqs.map(r => `${r.key}:${r.sec}:${r.off}:${r.to}:${r.limit}`).join('|'),
    [reqs],
  );

  useEffect(() => {
    if (!symbolId || reqs.length === 0) { setSeries(null); return; }

    const ctrl = new AbortController();

    Promise.all(
      reqs.map(r =>
        fetch(
          `/api/htf?symbolId=${symbolId}&sec=${r.sec}&off=${r.off}&to=${r.to}&limit=${r.limit}`,
          { signal: ctrl.signal },
        )
          .then(res => res.json())
          .then(rows => [r.key, Array.isArray(rows) ? rows : []]),
      ),
    )
      .then(pairs => setSeries(Object.fromEntries(pairs)))
      .catch(err => { if (err.name !== 'AbortError') setSeries(null); });

    return () => ctrl.abort();
    // `key` résume reqs ; symbolId change de série.
  }, [symbolId, key]);

  return series;
}
