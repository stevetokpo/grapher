import { useState, useEffect, useCallback, useRef } from 'react';
import { isTickResolution } from '../lib/ticker/resolutions';

const POLL_MS  = 3000;    // l'EA poste à chaque clôture M1 ; on relève un peu plus vite
const MAX_ROWS = 300_000; // garde-fou mémoire : au-delà, on arrête de remonter

// Données du ticker : chargement initial, suivi en direct, pagination arrière,
// et saut à une date.
//
// Le hook renvoie les lignes TELLES QUE l'API les rend — points bruts en mode
// tick, bougies agrégées sinon. Il ne les transforme pas : c'est le graphe qui
// sait quoi en faire, et lui seul.
//
// `pinnedTo` (millisecondes) fige la vue à une date : le suivi en direct est
// alors suspendu, sans quoi chaque relève ramènerait la vue au présent et
// rendrait toute exploration du passé impossible. Le remettre à null rebranche
// le direct.
export function useTicks(symbolId, resId, src, { limit = 0, pinnedTo = null } = {}) {
  const [rows,        setRows]        = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore,     setHasMore]     = useState(true);
  const [error,       setError]       = useState(null);
  // Incrémenté du nombre de lignes ajoutées EN TÊTE : le graphe s'en sert pour
  // rattraper sa fenêtre visible, qui sinon sauterait en arrière à chaque page.
  const [prepended,   setPrepended]   = useState({ n: 0, at: 0 });

  const rowsRef     = useRef([]);
  const hasMoreRef  = useRef(true);
  const fetchingRef = useRef(false);
  const genRef      = useRef(0);      // invalide les réponses d'une vue précédente
  const argsRef     = useRef({ symbolId, resId, src, limit, pinnedTo });

  useEffect(() => { rowsRef.current    = rows;    }, [rows]);
  useEffect(() => { hasMoreRef.current = hasMore; }, [hasMore]);
  useEffect(() => { argsRef.current = { symbolId, resId, src, limit, pinnedTo }; },
            [symbolId, resId, src, limit, pinnedTo]);

  const isTick = isTickResolution(resId);

  // ── Purge SYNCHRONE au changement de vue ────────────────────────────────
  // Vider les lignes dans un effet ne suffit pas : l'effet ne tourne qu'APRÈS
  // le rendu, et ce rendu-là associe déjà le nouveau pas de temps aux lignes de
  // l'ANCIEN. Le graphe reçoit alors des ticks bruts en croyant tenir des
  // bougies, cherche un champ `time` absent, et lightweight-charts échoue sur
  // « Cannot read properties of undefined (reading 'year') » — il tentait de
  // lire un undefined comme une date.
  //
  // Corriger côté graphe ne ferait que déplacer le problème : la page lit les
  // mêmes lignes pour son prix et ses décimales, et afficherait NaN. La seule
  // réponse juste est que ce rendu n'existe pas. React le permet : une mise à
  // jour d'état PENDANT le rendu du même composant relance le rendu avant tout
  // affichage, donc aucune image incohérente n'est jamais montrée.
  const viewKey = `${symbolId}|${resId}|${src}|${limit}|${pinnedTo ?? 'live'}`;
  const [renderedKey, setRenderedKey] = useState(viewKey);
  if (renderedKey !== viewKey) {
    setRenderedKey(viewKey);
    setRows([]);
    rowsRef.current = [];
    setHasMore(true);
    hasMoreRef.current = true;
    setError(null);
    // Le chargement commence ICI, pas dans l'effet : sans ça, l'image qui suit
    // montre zéro ligne sans chargement en cours, c'est-à-dire l'écran « aucun
    // tick, installez l'expert » — un conseil faux, le temps d'un battement.
    setLoading(symbolId != null);
  }

  const baseUrl = useCallback((over = {}) => {
    const a = { ...argsRef.current, ...over };
    const p = new URLSearchParams({ symbolId: String(a.symbolId), res: a.resId, src: a.src });
    if (a.limit) p.set('limit', String(a.limit));
    if (a.toUs   != null) p.set('toUs',   String(a.toUs));
    if (a.to     != null) p.set('to',     String(a.to));
    if (a.fromUs != null) p.set('fromUs', String(a.fromUs));
    if (a.from   != null) p.set('from',   String(a.from));
    return `/api/ticks?${p.toString()}`;
  }, []);

  // ── Chargement initial / remise à zéro ──────────────────────────────────
  useEffect(() => {
    genRef.current += 1;
    const gen = genRef.current;

    setRows([]);
    rowsRef.current = [];
    setHasMore(true);
    hasMoreRef.current = true;
    fetchingRef.current = false;
    setLoadingMore(false);
    setError(null);
    if (!symbolId) { setLoading(false); return; }
    setLoading(true);

    const ctrl = new AbortController();
    fetch(baseUrl({ to: pinnedTo ?? undefined }), { signal: ctrl.signal })
      .then(r => r.json())
      .then(data => {
        if (gen !== genRef.current) return;
        if (data?.error) throw new Error(data.error);
        const list = Array.isArray(data?.rows) ? data.rows : [];
        setRows(list);
        rowsRef.current = list;
        setLoading(false);
      })
      .catch(e => {
        if (e.name === 'AbortError' || gen !== genRef.current) return;
        setError(e.message);
        setLoading(false);
      });

    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolId, resId, src, limit, pinnedTo]);

  // ── Direct ──────────────────────────────────────────────────────────────
  // Mode tick : on redemande STRICTEMENT après le dernier point (les
  // horodatages en microsecondes sont uniques), et on ajoute à la fin.
  // Mode agrégé : on redemande DEPUIS le dernier seau, qui revient recalculé —
  // la bougie en cours se remplit au fil des ticks — puis on recolle.
  useEffect(() => {
    if (!symbolId || pinnedTo != null) return;
    const gen = genRef.current;
    let stopped = false;

    const tick = async () => {
      if (document.hidden || fetchingRef.current) return;
      const cur = rowsRef.current;
      if (!cur.length) return;

      const last = cur[cur.length - 1];
      const url = isTick
        ? baseUrl({ fromUs: last.us + 1 })
        : baseUrl({ from: last.time * 1000 });

      try {
        const data = await fetch(url).then(r => r.json());
        if (stopped || gen !== genRef.current || data?.error) return;
        const fresh = Array.isArray(data?.rows) ? data.rows : [];
        if (!fresh.length) return;

        setRows(prev => {
          let next;
          if (isTick) {
            next = [...prev, ...fresh];
          } else {
            // Rien de neuf : même seau, mêmes valeurs → on rend le MÊME
            // tableau, donc aucun rendu, aucun redessin.
            const tail = prev[prev.length - 1];
            const f0   = fresh[0];
            if (fresh.length === 1 && tail && tail.time === f0.time &&
                tail.close === f0.close && tail.high === f0.high &&
                tail.low === f0.low && tail.ticks === f0.ticks) {
              return prev;
            }
            next = [...prev.filter(b => b.time < f0.time), ...fresh];
          }
          rowsRef.current = next;
          return next;
        });
      } catch {
        /* serveur injoignable — nouvel essai au prochain cycle */
      }
    };

    const id = setInterval(tick, POLL_MS);
    return () => { stopped = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolId, resId, src, isTick, pinnedTo]);

  // ── Pagination arrière ──────────────────────────────────────────────────
  const onLoadMore = useCallback(async () => {
    if (fetchingRef.current || !hasMoreRef.current) return;
    const cur = rowsRef.current;
    if (!cur.length) return;
    if (cur.length >= MAX_ROWS) { setHasMore(false); hasMoreRef.current = false; return; }

    const gen = genRef.current;
    fetchingRef.current = true;
    setLoadingMore(true);

    const head = cur[0];
    const url = isTickResolution(argsRef.current.resId)
      ? baseUrl({ toUs: head.us })          // borne haute EXCLUSIVE : pas de doublon
      : baseUrl({ to: head.time * 1000 });

    try {
      const data = await fetch(url).then(r => r.json());
      if (gen !== genRef.current) return;
      const older = Array.isArray(data?.rows) ? data.rows : [];

      if (older.length === 0) {
        setHasMore(false);
        hasMoreRef.current = false;
      } else {
        setRows(prev => {
          const next = [...older, ...prev];
          rowsRef.current = next;
          return next;
        });
        setPrepended({ n: older.length, at: Date.now() });
      }
    } catch (e) {
      console.error('[useTicks] loadMore', e);
    } finally {
      if (gen === genRef.current) {
        fetchingRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [baseUrl]);

  return { rows, loading, loadingMore, hasMore, error, onLoadMore, prepended };
}

// Couverture des ticks du symbole — plage disponible, volumétrie, présence
// d'un prix de transaction. Relue périodiquement : l'EA fait grandir la plage
// pendant qu'on regarde.
export function useTickCoverage(symbolId, refreshMs = 30_000) {
  const [coverage, setCoverage] = useState(null);

  useEffect(() => {
    if (!symbolId) { setCoverage(null); return; }
    let stopped = false;

    const load = async () => {
      try {
        const data = await fetch(`/api/ticks/coverage?symbolId=${symbolId}`).then(r => r.json());
        if (!stopped && !data?.error) setCoverage(data);
      } catch {
        /* sans conséquence : la page fonctionne sans le relevé */
      }
    };

    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, refreshMs);
    return () => { stopped = true; clearInterval(id); };
  }, [symbolId, refreshMs]);

  return coverage;
}
