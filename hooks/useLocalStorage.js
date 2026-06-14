import { useState, useEffect } from 'react';

// useState qui persiste dans localStorage. Hydration-safe : démarre avec
// defaultValue côté serveur, lit localStorage après montage côté client.
export function useLocalStorage(key, defaultValue) {
  const [value, setValue] = useState(defaultValue);

  // Lecture initiale après montage (évite le mismatch SSR/client)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw));
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Écriture à chaque changement
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }, [key, value]);

  return [value, setValue];
}
