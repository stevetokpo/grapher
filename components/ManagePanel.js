import { useState, useEffect, useCallback } from 'react';
import { fmtCount } from '../lib/format';
import styles from './ManagePanel.module.css';

export default function ManagePanel({ onClose, onDeleted }) {
  const [symbols,    setSymbols]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [confirming, setConfirming] = useState(null); // id being confirmed
  const [deleting,   setDeleting]   = useState(null); // id being deleted

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch('/api/symbols');
      const data = await res.json();
      setSymbols(Array.isArray(data) ? data : []);
    } catch {
      setError('Impossible de charger les symboles.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const doDelete = async (id) => {
    setDeleting(id);
    try {
      const res = await fetch(`/api/symbols/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Suppression échouée');
      setSymbols(prev => prev.filter(s => s.id !== id));
      onDeleted?.(id);
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(null);
      setConfirming(null);
    }
  };

  return (
    <div
      className={styles.overlay}
      onClick={e => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="manage-title"
    >
      <div className={styles.panel}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Fermer">×</button>

        <h2 id="manage-title" className={styles.title}>Gérer les symboles</h2>
        <p className={styles.subtitle}>
          La suppression efface définitivement toutes les barres et tous les ticks associés au symbole.
        </p>

        {error && <div className={styles.errorBanner} role="alert">{error}</div>}

        {loading ? (
          <div className={styles.state}>Chargement…</div>
        ) : symbols.length === 0 ? (
          <div className={styles.state}>Aucun symbole importé.</div>
        ) : (
          <ul className={styles.list} role="list">
            {symbols.map(sym => (
              <SymbolRow
                key={sym.id}
                sym={sym}
                confirming={confirming === sym.id}
                deleting={deleting === sym.id}
                onRequestDelete={() => setConfirming(sym.id)}
                onCancel={() => setConfirming(null)}
                onConfirm={() => doDelete(sym.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SymbolRow({ sym, confirming, deleting, onRequestDelete, onCancel, onConfirm }) {
  const hasBars  = sym.bar_count  > 0;
  const hasTicks = sym.tick_count > 0;

  return (
    <li className={`${styles.row} ${confirming ? styles.rowConfirming : ''}`}>
      <div className={styles.rowMain}>
        <span className={styles.symName}>{sym.name}</span>
        <div className={styles.badges}>
          {hasBars && (
            <span className={`${styles.badge} ${styles.bars}`}>
              <BarIcon />
              {fmtCount(sym.bar_count)} barres
            </span>
          )}
          {hasTicks && (
            <span className={`${styles.badge} ${styles.ticks}`}>
              <TickIcon />
              {fmtCount(sym.tick_count)} ticks
            </span>
          )}
          {!hasBars && !hasTicks && (
            <span className={styles.badgeEmpty}>vide</span>
          )}
        </div>
      </div>

      {confirming ? (
        <div className={styles.confirmRow}>
          <span className={styles.confirmLabel}>Supprimer définitivement ?</span>
          <button
            className={styles.btnCancel}
            onClick={onCancel}
            disabled={deleting}
          >
            Annuler
          </button>
          <button
            className={styles.btnDelete}
            onClick={onConfirm}
            disabled={deleting}
            aria-busy={deleting}
          >
            {deleting ? 'Suppression…' : 'Supprimer'}
          </button>
        </div>
      ) : (
        <button
          className={styles.trashBtn}
          onClick={onRequestDelete}
          aria-label={`Supprimer ${sym.name}`}
          title="Supprimer ce symbole"
        >
          <TrashIcon />
        </button>
      )}
    </li>
  );
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M10 11v5M14 11v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  );
}

function BarIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <rect x="0" y="5" width="2.5" height="7" rx="0.5"/>
      <rect x="4" y="2" width="2.5" height="10" rx="0.5"/>
      <rect x="8" y="0" width="2.5" height="12" rx="0.5"/>
    </svg>
  );
}

function TickIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <polyline points="0,6 3,3 5,8 8,4 12,6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
