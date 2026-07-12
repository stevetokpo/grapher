import { useState, useEffect, useCallback, useRef } from 'react';

const PAGE = 200;

function groupRows(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.time)) {
      map.set(row.time, {
        time:  row.time,
        open:  row.open,
        high:  row.high,
        low:   row.low,
        close: row.close,
        levels: [],
      });
    }
    map.get(row.time).levels.push({
      price:      row.price,
      upTicks:    row.up_ticks,
      downTicks:  row.down_ticks,
      delta:      row.delta,
      totalTicks: row.total_ticks ?? (row.up_ticks + row.down_ticks),
    });
  }

  return Array.from(map.values())
    .sort((a, b) => a.time - b.time)
    .map(bar => {
      const levels = bar.levels.sort((a, b) => a.price - b.price);

      let barDelta = 0;
      let barTotal = 0;
      let pocPrice = null;
      let pocMax   = -1;

      for (const lv of levels) {
        barDelta += lv.delta;
        barTotal += lv.totalTicks;
        if (lv.totalTicks > pocMax) { pocMax = lv.totalTicks; pocPrice = lv.price; }
      }

      return { ...bar, levels, barDelta, barTotal, pocPrice };
    });
}

export function useFootprint(symbolId, tickSize = 5) {
  const [bars,        setBars]        = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error,       setError]       = useState(null);
  const [hasMore,     setHasMore]     = useState(false);
  const cursorRef     = useRef(null); // epoch of the oldest bar loaded
  // Bumped on every symbol/tickSize change — in-flight loadMore responses from
  // a previous generation are discarded (they belong to another dataset).
  const genRef        = useRef(0);

  // Reset + initial fetch when symbolId or tickSize changes
  useEffect(() => {
    genRef.current += 1;
    if (!symbolId) {
      setBars([]); setHasMore(false); cursorRef.current = null;
      return;
    }

    setLoading(true);
    setError(null);
    setBars([]);
    setHasMore(false);
    setLoadingMore(false);
    cursorRef.current = null;

    const ctrl = new AbortController();
    fetch(`/api/footprint?symbolId=${symbolId}&tickSize=${tickSize}&limit=${PAGE}`, {
      signal: ctrl.signal,
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        const grouped = groupRows(data.rows ?? []);
        setBars(grouped);
        setHasMore(grouped.length >= PAGE);
        if (grouped.length > 0) cursorRef.current = grouped[0].time;
        setLoading(false);
      })
      .catch(err => {
        if (err.name !== 'AbortError') { setError(err.message); setLoading(false); }
      });

    return () => ctrl.abort();
  }, [symbolId, tickSize]);

  // Fetch older bars before the current cursor
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !symbolId || cursorRef.current === null) return;

    const gen = genRef.current;
    setLoadingMore(true);
    try {
      const res  = await fetch(
        `/api/footprint?symbolId=${symbolId}&tickSize=${tickSize}&limit=${PAGE}&to=${cursorRef.current}`,
      );
      const data = await res.json();
      if (gen !== genRef.current) return; // symbol/tickSize changed mid-flight — discard
      if (data.error) throw new Error(data.error);

      const older = groupRows(data.rows ?? []);
      if (older.length === 0) { setHasMore(false); return; }
      if (older.length < PAGE) setHasMore(false);

      cursorRef.current = older[0].time;
      setBars(prev => [...older, ...prev]);
    } catch (e) {
      console.error('[footprint] loadMore', e);
    } finally {
      // A newer generation owns this flag now — don't clobber its state.
      if (gen === genRef.current) setLoadingMore(false);
    }
  }, [symbolId, tickSize, loadingMore, hasMore]);

  return { bars, loading, loadingMore, hasMore, loadMore, error };
}
