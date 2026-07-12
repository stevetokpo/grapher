import { useState, useEffect, useCallback, useRef } from 'react';

const BARS_PER_PAGE = 500;

export function useBars(symbolId, tfId) {
  const [allBars,     setAllBars]     = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore,     setHasMore]     = useState(true);

  // Refs give onLoadMore stable access to current state without stale closures
  const allBarsRef  = useRef([]);
  const hasMoreRef  = useRef(true);
  const symbolIdRef = useRef(null);
  const tfIdRef     = useRef('1h');
  const fetchingRef = useRef(false);
  // Bumped on every symbol/tf change — in-flight loadMore responses from a
  // previous generation are discarded (they would prepend bars of another tf).
  const genRef      = useRef(0);

  useEffect(() => { allBarsRef.current  = allBars;  }, [allBars]);
  useEffect(() => { hasMoreRef.current  = hasMore;  }, [hasMore]);
  useEffect(() => { symbolIdRef.current = symbolId; }, [symbolId]);
  useEffect(() => { tfIdRef.current     = tfId;     }, [tfId]);

  // Reset + initial fetch when symbol or timeframe changes
  useEffect(() => {
    genRef.current += 1;
    if (!symbolId) return;

    setAllBars([]);
    allBarsRef.current  = [];
    setHasMore(true);
    hasMoreRef.current  = true;
    fetchingRef.current = false;
    setLoading(true);
    setLoadingMore(false);

    const ctrl = new AbortController();
    fetch(`/api/bars?symbolId=${symbolId}&tf=${tfId}&limit=${BARS_PER_PAGE}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(data => {
        const bars = Array.isArray(data) ? data : [];
        setAllBars(bars);
        allBarsRef.current = bars;
        if (bars.length < BARS_PER_PAGE) {
          setHasMore(false);
          hasMoreRef.current = false;
        }
        setLoading(false);
      })
      .catch(e => { if (e.name !== 'AbortError') setLoading(false); });

    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolId, tfId]);

  // Stable callback — reads live values via refs, zero stale-closure risk
  const onLoadMore = useCallback(async () => {
    if (fetchingRef.current || !hasMoreRef.current) return;
    const bars = allBarsRef.current;
    if (!bars.length) return;

    const gen = genRef.current;
    fetchingRef.current = true;
    setLoadingMore(true);

    const cursor = bars[0].time;
    const url = `/api/bars?symbolId=${symbolIdRef.current}&tf=${tfIdRef.current}&limit=${BARS_PER_PAGE}&to=${cursor}`;

    try {
      const data  = await fetch(url).then(r => r.json());
      if (gen !== genRef.current) return; // symbol/tf changed mid-flight — discard
      const older = Array.isArray(data) ? data : [];

      if (older.length === 0) {
        setHasMore(false);
        hasMoreRef.current = false;
      } else {
        setAllBars(prev => [...older, ...prev]);
        if (older.length < BARS_PER_PAGE) {
          setHasMore(false);
          hasMoreRef.current = false;
        }
      }
    } catch (e) {
      console.error('loadMore', e);
    } finally {
      // A newer generation owns these flags now — don't clobber its state.
      if (gen === genRef.current) {
        fetchingRef.current = false;
        setLoadingMore(false);
      }
    }
  }, []); // empty deps intentional — all reads go through refs

  return { allBars, loading, loadingMore, hasMore, onLoadMore };
}
