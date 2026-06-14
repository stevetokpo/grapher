import { useRef, useState, useCallback } from 'react';
import styles from './ImportPanel.module.css';

function fmtSize(bytes) {
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(0) + ' KB';
  return bytes + ' B';
}

export default function ImportPanel({ onClose, onImported }) {
  const inputRef              = useRef(null);
  const [drag, setDrag]       = useState(false);
  const [file, setFile]       = useState(null);
  const [status, setStatus]   = useState(null); // { ok, message, data }
  const [loading, setLoading] = useState(false);

  const handleFiles = useCallback((fileList) => {
    const f = fileList?.[0];
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.csv')) {
      setStatus({ ok: false, message: 'Only .csv files are supported.' });
      return;
    }
    setFile(f);
    setStatus(null);
  }, []);

  const onDrop = (e) => {
    e.preventDefault();
    setDrag(false);
    handleFiles(e.dataTransfer.files);
  };

  const doImport = async () => {
    if (!file || loading) return;
    setLoading(true);
    setStatus(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const res  = await fetch('/api/import', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setStatus({ ok: false, message: data.error || 'Import failed.' });
      } else {
        setStatus({ ok: true, data });
        onImported?.(data);
      }
    } catch (err) {
      setStatus({ ok: false, message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const isBtnDisabled = !file || loading || !!status?.ok;

  return (
    <div
      className={styles.overlay}
      onClick={e => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-title"
    >
      <div className={styles.panel}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close import panel">
          ×
        </button>

        <h2 id="import-title" className={styles.title}>Import MT5 Data</h2>
        <p className={styles.subtitle}>
          Drop a MT5 export CSV — bars (M1) or ticks. Re-imports are safe: duplicates are silently skipped.
        </p>

        {/* Drop zone */}
        <div
          className={`${styles.dropZone}${drag ? ` ${styles.dragging}` : ''}`}
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          role="button"
          tabIndex={0}
          aria-label="Drop CSV file here or click to browse"
          onKeyDown={e => e.key === 'Enter' && inputRef.current?.click()}
        >
          <svg className={styles.dropIcon} viewBox="0 0 48 48" fill="none" aria-hidden="true">
            <rect x="6" y="8" width="36" height="32" rx="3" stroke="currentColor" strokeWidth="2"/>
            <path d="M16 28l8-8 8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            <path d="M24 20v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <p className={styles.dropLabel}>
            Drag &amp; drop your <strong>.csv</strong> here, or{' '}
            <span className={styles.dropAccent} onClick={() => inputRef.current?.click()}>
              browse
            </span>
          </p>
          <input
            ref={inputRef}
            type="file"
            accept=".csv"
            className={styles.fileInput}
            onChange={e => handleFiles(e.target.files)}
            aria-hidden="true"
            tabIndex={-1}
          />
        </div>

        {/* Selected file */}
        {file && (
          <div className={styles.fileCard}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="4" y="2" width="16" height="20" rx="2" stroke="#60A5FA" strokeWidth="1.5"/>
              <path d="M8 7h8M8 11h8M8 15h5" stroke="#60A5FA" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <span className={styles.fileName}>{file.name}</span>
            <span className={styles.fileSize}>{fmtSize(file.size)}</span>
          </div>
        )}

        {/* Status */}
        {status && (
          <div className={`${styles.statusBox} ${status.ok ? styles.ok : styles.error}`} role="status">
            {status.ok ? <ImportStats data={status.data} /> : status.message}
          </div>
        )}

        {/* Primary action */}
        <button
          className={styles.primaryBtn}
          disabled={isBtnDisabled}
          onClick={doImport}
        >
          {loading ? 'Importing…' : status?.ok ? 'Imported ✓' : 'Import'}
        </button>

        {status?.ok && (
          <button
            className={styles.secondaryBtn}
            onClick={() => { setFile(null); setStatus(null); }}
          >
            Import another file
          </button>
        )}
      </div>
    </div>
  );
}

function ImportStats({ data }) {
  const isBars  = data.dataType === 'bars';
  const isTicks = data.dataType === 'ticks';

  return (
    <>
      <div className={styles.statRow}>
        <span>Symbol</span>
        <strong>{data.symbol}</strong>
      </div>
      <div className={styles.statRow}>
        <span>Type</span>
        <strong>
          <span className={`${styles.typeBadge} ${isBars ? styles.bars : styles.ticks}`}>
            {isBars ? `Bars · ${data.timeframe}` : 'Ticks'}
          </span>
        </strong>
      </div>
      <div className={styles.statRow}>
        <span>{isTicks ? 'Ticks imported' : 'Bars imported'}</span>
        <strong>{data.imported.toLocaleString()}</strong>
      </div>
      {data.duplicates != null && (
        <div className={styles.statRow}>
          <span>Duplicates skipped</span>
          <strong>{data.duplicates.toLocaleString()}</strong>
        </div>
      )}
      <div className={styles.statRow}>
        <span>Total in DB</span>
        <strong>{data.total.toLocaleString()}</strong>
      </div>
    </>
  );
}
