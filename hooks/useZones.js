import { useState, useEffect, useCallback, useRef } from 'react';

// Zones de support et de résistance du ticker : des rectangles.
//
// Une zone porte quatre nombres — deux prix (top, bottom) et deux dates
// (fromMs, toMs, en millisecondes epoch, heure broker).
//
// Les DATES sont stockées en millisecondes réelles, jamais en abscisse de
// graphe : en mode tick l'abscisse est un RANG (voir TickerChart.js), et un
// rang ne survit ni au changement de pas de temps ni au rechargement. La
// milliseconde, elle, veut dire la même chose partout — c'est le seul ancrage
// qui laisse un rectangle tracé au tick retomber au bon endroit en M1.
//
// Une zone sans dates (fromMs absent) est une bande qui traverse toute la vue.
// C'est le cas des zones enregistrées avant l'ajout des bornes : elles restent
// lisibles au lieu de disparaître.
//
// Les zones sont rangées PAR SYMBOLE : un support de l'or n'a aucun sens sur
// le BTC, et les mélanger reviendrait à dessiner au hasard.

const KEY_PREFIX = 'grapher.ticker.zones.';
const uid = () => Math.random().toString(36).slice(2, 10);

function keyFor(symbolId) {
  return `${KEY_PREFIX}${symbolId}`;
}

function read(symbolId) {
  if (typeof window === 'undefined' || symbolId == null) return [];
  try {
    const raw = localStorage.getItem(keyFor(symbolId));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(isValid) : [];
  } catch {
    return [];   // stockage corrompu : on repart à vide plutôt que de casser la page
  }
}

function isValid(z) {
  return z && typeof z.id === 'string'
    && Number.isFinite(z.top) && Number.isFinite(z.bottom)
    && z.top >= z.bottom;
}

export function useZones(symbolId) {
  const [zones, setZones] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  // Le premier rendu après un changement de symbole ne doit RIEN écrire : il
  // écraserait les zones du nouveau symbole avec celles de l'ancien, encore en
  // mémoire le temps d'un battement.
  const loadedFor = useRef(null);

  useEffect(() => {
    setSelectedId(null);
    if (symbolId == null) { setZones([]); loadedFor.current = null; return; }
    setZones(read(symbolId));
    loadedFor.current = symbolId;
  }, [symbolId]);

  useEffect(() => {
    if (symbolId == null || loadedFor.current !== symbolId) return;
    try {
      localStorage.setItem(keyFor(symbolId), JSON.stringify(zones));
    } catch {
      /* quota plein : la zone reste en mémoire pour la session */
    }
  }, [zones, symbolId]);

  // Le sens est CHOISI, pas deviné : c'est une lecture du marché, elle
  // appartient à celui qui trace.
  const addZone = useCallback(({ top, bottom, fromMs, toMs, kind }) => {
    const zone = {
      id: uid(),
      top:    Math.max(top, bottom),
      bottom: Math.min(top, bottom),
      fromMs: fromMs == null ? null : Math.min(fromMs, toMs),
      toMs:   toMs   == null ? null : Math.max(fromMs, toMs),
      kind:   kind === 'resistance' ? 'resistance' : 'support',
    };
    setZones(prev => [...prev, zone]);
    setSelectedId(zone.id);
    return zone;
  }, []);

  const updateZone = useCallback((id, patch) => {
    setZones(prev => prev.map(z => (z.id === id ? { ...z, ...patch } : z)));
  }, []);

  const removeZone = useCallback((id) => {
    setZones(prev => prev.filter(z => z.id !== id));
    setSelectedId(prev => (prev === id ? null : prev));
  }, []);

  const clearZones = useCallback(() => {
    setZones([]);
    setSelectedId(null);
  }, []);

  return { zones, selectedId, setSelectedId, addZone, updateZone, removeZone, clearZones };
}
