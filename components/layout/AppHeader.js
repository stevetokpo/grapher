import { fmtCount } from '../../lib/format';
import styles from './AppHeader.module.css';

export default function AppHeader({ symbols, symbolId, onSymbolChange, onImport, onManage, onSettings }) {
  return (
    <header className={styles.header}>
      <div className={styles.logo}>
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
          <rect x="1"  y="11" width="3" height="10" rx="1" fill="#F59E0B"/>
          <rect x="7"  y="6"  width="3" height="15" rx="1" fill="#26A69A"/>
          <rect x="13" y="3"  width="3" height="18" rx="1" fill="#F59E0B"/>
          <rect x="19" y="8"  width="3" height="13" rx="1" fill="#26A69A"/>
        </svg>
        <span className={styles.logoText}>GRAPHER</span>
      </div>

      <select
        className={styles.symbolSelect}
        value={symbolId ?? ''}
        onChange={e => onSymbolChange(Number(e.target.value))}
        aria-label="Select symbol"
      >
        {symbols.map(s => (
          <option key={s.id} value={s.id}>
            {s.name} ({fmtCount(s.bar_count)} bars)
          </option>
        ))}
      </select>

      <div className={styles.spacer} />

      <button className={styles.manageBtn} onClick={onManage} aria-label="Gérer les symboles">
        Gérer
      </button>

      <button className={styles.importBtn} onClick={onImport} aria-label="Import MT5 file">
        + Import
      </button>

      <button className={styles.settingsBtn} onClick={onSettings} aria-label="Réglages">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>

      <div className={styles.live} aria-label="Live data">
        <span className={styles.liveDot} />
        <span className={styles.liveLabel}>LIVE</span>
      </div>
    </header>
  );
}
