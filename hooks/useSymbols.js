import { useState, useEffect, useCallback } from 'react';

const KEY = 'grapher.symbolId';

function savedId() {
  if (typeof window === 'undefined') return null;
  const n = Number(localStorage.getItem(KEY));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function useSymbols() {
  const [symbols,  setSymbols]  = useState([]);
  const [symbolId, setSymbolId] = useState(null);

  const loadSymbols = useCallback(async (selectId) => {
    try {
      const data = await fetch('/api/symbols').then(r => r.json());
      const list = Array.isArray(data) ? data : [];
      setSymbols(list);
      if (list.length > 0) {
        setSymbolId(prev => {
          const target = selectId ?? prev;
          // Si le symbole cible n'existe plus (supprimé), on prend le premier
          return list.some(s => s.id === target) ? target : list[0].id;
        });
      }
    } catch (e) {
      console.error('symbols fetch', e);
    }
  }, []);

  // Chargement initial : restaure le dernier symbole sélectionné
  useEffect(() => { loadSymbols(savedId()); }, [loadSymbols]);

  // Persistance du symbolId courant
  useEffect(() => {
    if (symbolId != null) localStorage.setItem(KEY, symbolId);
  }, [symbolId]);

  const currentSym = symbols.find(s => s.id === symbolId) ?? null;

  return { symbols, symbolId, setSymbolId, loadSymbols, currentSym };
}
