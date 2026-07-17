import { fmtCount } from '../../lib/format';
import styles from './AppHeader.module.css';

export default function AppHeader({
  symbols, symbolId, onSymbolChange,
  onImport, onManage, onSettings, onReplay, onRsi, onChat, onBacktest, onAlerts,
  isReplayMode = false,
  replaySymbolName = '',
  isRsiMode = false,
  isBacktestMode = false,
  onBack,
}) {
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

      {isReplayMode || isBacktestMode ? (
        <span className={styles.replaySymbol}>{replaySymbolName}</span>
      ) : (
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
      )}

      <div className={styles.spacer} />

      {isReplayMode || isRsiMode || isBacktestMode ? (
        <button className={styles.backBtn} onClick={onBack} aria-label="Retour au graphique">
          ← Retour
        </button>
      ) : (
        <>
          <button className={styles.manageBtn} onClick={onManage} aria-label="Gérer les symboles">
            Gérer
          </button>
          {onReplay && (
            <button className={styles.replayBtn} onClick={onReplay} aria-label="Mode Replay">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ marginRight: 5 }}>
                <polygon points="5,3 19,12 5,21"/>
              </svg>
              Replay
            </button>
          )}
          {onRsi && (
            <button className={styles.rsiBtn} onClick={onRsi} aria-label="Analyse RSI">
              RSI
            </button>
          )}
          {onBacktest && (
            <button className={styles.backtestBtn} onClick={onBacktest} aria-label="Backtest de stratégies">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginRight: 5 }}>
                <polyline points="3,17 9,11 13,15 21,7"/>
                <polyline points="15,7 21,7 21,13"/>
              </svg>
              Backtest
            </button>
          )}
          {onChat && (
            <button className={styles.aiBtn} onClick={onChat} aria-label="Assistant IA">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginRight: 5 }}>
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              IA
            </button>
          )}
          {onAlerts && (
            <button className={styles.alertsBtn} onClick={onAlerts} aria-label="Alertes">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginRight: 5 }}>
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              Alertes
            </button>
          )}
          <button className={styles.importBtn} onClick={onImport} aria-label="Import MT5 file">
            + Import
          </button>
        </>
      )}

      <button className={styles.settingsBtn} onClick={onSettings} aria-label="Réglages">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>

      {isReplayMode ? (
        <div className={styles.replayBadge} aria-label="Mode Replay actif">
          <span className={styles.replayDot} aria-hidden="true"/>
          <span className={styles.replayLabel}>REPLAY</span>
        </div>
      ) : isRsiMode ? (
        <div className={styles.rsiBadge} aria-label="Mode RSI actif">
          <span className={styles.rsiDot} aria-hidden="true"/>
          <span className={styles.rsiLabel}>RSI</span>
        </div>
      ) : isBacktestMode ? (
        <div className={styles.backtestBadge} aria-label="Mode Backtest actif">
          <span className={styles.backtestDot} aria-hidden="true"/>
          <span className={styles.backtestLabel}>BACKTEST</span>
        </div>
      ) : (
        <div className={styles.live} aria-label="Live data">
          <span className={styles.liveDot} />
          <span className={styles.liveLabel}>LIVE</span>
        </div>
      )}
    </header>
  );
}
