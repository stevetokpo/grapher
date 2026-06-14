import { useState } from 'react';
import { useLocalStorage } from './useLocalStorage';

const uid = () => Math.random().toString(36).slice(2, 11);

export function useDrawings() {
  const [drawings, setDrawings] = useLocalStorage('grapher.drawings', []);
  const [activeTool, setActiveTool] = useState(null); // null = curseur
  const [selectedId, setSelectedId] = useState(null);

  const addDrawing = (type, points, style = {}) => {
    const d = {
      id: uid(),
      type,
      points,
      style: {
        color:     style.color     ?? '#2196F3',
        lineWidth: style.lineWidth ?? 1,
        lineStyle: style.lineStyle ?? 'solid',
        ...style,
      },
    };
    setDrawings(prev => [...prev, d]);
    return d.id;
  };

  const updateDrawing = (id, updates) => {
    setDrawings(prev => prev.map(d => d.id === id ? { ...d, ...updates } : d));
  };

  const removeDrawing = (id) => {
    setDrawings(prev => prev.filter(d => d.id !== id));
    setSelectedId(prev => prev === id ? null : prev);
  };

  const clearAll = () => {
    setDrawings([]);
    setSelectedId(null);
  };

  return {
    drawings,
    activeTool, setActiveTool,
    selectedId, setSelectedId,
    addDrawing, updateDrawing, removeDrawing, clearAll,
  };
}
