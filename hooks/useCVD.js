import { useState, useEffect } from 'react';

// Returns a Map<time, {upTicks, downTicks, delta, cvd}> or null if no tick data.
export function useCVD(symbolId, tfId) {
  const [cvdData, setCvdData] = useState(null);

  useEffect(() => {
    if (!symbolId || !tfId) { setCvdData(null); return; }

    const ctrl = new AbortController();
    fetch(`/api/cvd?symbolId=${symbolId}&tf=${tfId}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(rows => {
        if (!Array.isArray(rows) || rows.length === 0) { setCvdData(null); return; }
        const map = new Map();
        let cum = 0;
        for (const row of rows) {
          cum += row.delta ?? 0;
          map.set(row.time, {
            upTicks:   row.up_ticks   ?? 0,
            downTicks: row.down_ticks ?? 0,
            delta:     row.delta      ?? 0,
            cvd:       cum,
          });
        }
        setCvdData(map);
      })
      .catch(err => { if (err.name !== 'AbortError') setCvdData(null); });

    return () => ctrl.abort();
  }, [symbolId, tfId]);

  return cvdData;
}
