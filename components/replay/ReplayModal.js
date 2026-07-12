import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import styles from './ReplayModal.module.css';

function toDateInput(tsStr) {
  if (!tsStr) return '';
  return String(tsStr).slice(0, 10);
}

function toEpoch(dateStr, endOfDay = false) {
  const base = Math.floor(new Date(dateStr + 'T00:00:00Z').getTime() / 1000);
  return endOfDay ? base + 86399 : base;
}

export default function ReplayModal({ onClose }) {
  const router = useRouter();

  const [symbols,    setSymbols]    = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [dateFrom,   setDateFrom]   = useState('');
  const [dateTo,     setDateTo]     = useState('');
  const [loading,    setLoading]    = useState(true);

  useEffect(() => {
    fetch('/api/symbols')
      .then(r => r.json())
      .then(data => {
        setSymbols(data);
        if (data.length > 0) setSelectedId(data[0].id);
      })
      .finally(() => setLoading(false));
  }, []);

  const currentSym = symbols.find(s => s.id === selectedId) ?? null;
  const minDate    = currentSym ? toDateInput(currentSym.ts_min) : '';
  const maxDate    = currentSym ? toDateInput(currentSym.ts_max) : '';

  // Pre-fill dates when symbol changes
  useEffect(() => {
    if (!currentSym) return;
    setDateFrom(toDateInput(currentSym.ts_min));
    setDateTo(toDateInput(currentSym.ts_max));
  }, [selectedId]);

  const canStart = Boolean(selectedId && dateFrom && dateTo && dateFrom <= dateTo);

  const handleStart = () => {
    if (!canStart) return;
    const from = toEpoch(dateFrom, false);
    const to   = toEpoch(dateTo,   true);
    onClose();
    router.push(`/replay?symbolId=${selectedId}&from=${from}&to=${to}`);
  };

  return (
    <div
      className={styles.overlay}
      onClick={e => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="replay-modal-title"
    >
      <div className={styles.panel}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Fermer">×</button>

        <div className={styles.header}>
          <div className={styles.iconWrap} aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5,3 19,12 5,21"/>
            </svg>
          </div>
          <div>
            <h2 id="replay-modal-title" className={styles.title}>Replay</h2>
            <p className={styles.subtitle}>Sélectionnez un symbole et la plage de dates à rejouer.</p>
          </div>
        </div>

        {loading ? (
          <p className={styles.hint}>Chargement des symboles…</p>
        ) : symbols.length === 0 ? (
          <p className={styles.empty}>Aucun symbole importé.</p>
        ) : (
          <>
            {/* Symbol selector */}
            <div className={styles.field}>
              <label className={styles.label} htmlFor="rm-symbol">Symbole</label>
              <select
                id="rm-symbol"
                className={styles.select}
                value={selectedId ?? ''}
                onChange={e => setSelectedId(Number(e.target.value))}
              >
                {symbols.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              {currentSym && (
                <span className={styles.hint}>
                  Disponible : {toDateInput(currentSym.ts_min)} → {toDateInput(currentSym.ts_max)}
                </span>
              )}
            </div>

            {/* Date range */}
            <div className={styles.dateRow}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="rm-from">Début</label>
                <input
                  id="rm-from"
                  type="date"
                  className={styles.dateInput}
                  value={dateFrom}
                  min={minDate}
                  max={dateTo || maxDate}
                  onChange={e => setDateFrom(e.target.value)}
                />
              </div>
              <span className={styles.dateSep} aria-hidden="true">→</span>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="rm-to">Fin</label>
                <input
                  id="rm-to"
                  type="date"
                  className={styles.dateInput}
                  value={dateTo}
                  min={dateFrom || minDate}
                  max={maxDate}
                  onChange={e => setDateTo(e.target.value)}
                />
              </div>
            </div>

            <button
              className={styles.startBtn}
              disabled={!canStart}
              onClick={handleStart}
            >
              Lancer le Replay
            </button>
          </>
        )}
      </div>
    </div>
  );
}
