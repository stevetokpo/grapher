import { fmtPrice } from '../../lib/format';
import styles from './TradeStats.module.css';

export default function TradeStats({ stats, openTrades, onReset }) {
  const openCount = openTrades?.length ?? 0;
  if (stats.total === 0 && openCount === 0) return null;

  const pnlPositive = stats.totalPoints >= 0;
  const rPositive   = stats.totalR >= 0;

  return (
    <div className={styles.bar}>
      {openCount > 0 && (
        <div className={styles.item}>
          <span className={styles.label}>EN COURS</span>
          <span className={styles.value} style={{ color: 'var(--blue)' }}>{openCount}</span>
        </div>
      )}

      {openCount > 0 && stats.total > 0 && (
        <div className={styles.sep} aria-hidden="true"/>
      )}

      {stats.total > 0 && (
        <>
          <div className={styles.item}>
            <span className={styles.label}>TRADES</span>
            <span className={styles.value}>{stats.total}</span>
          </div>
          <div className={styles.sep} aria-hidden="true"/>
          <div className={styles.item}>
            <span className={styles.label}>WIN RATE</span>
            <span
              className={styles.value}
              style={{ color: stats.winrate >= 50 ? 'var(--bull)' : 'var(--bear)' }}
            >
              {stats.winrate != null ? `${stats.winrate.toFixed(1)}%` : '—'}
            </span>
          </div>
          <div className={styles.sep} aria-hidden="true"/>
          <div className={styles.item}>
            <span className={styles.label}>W / L</span>
            <span className={styles.value}>
              <span style={{ color: 'var(--bull)' }}>{stats.wins}</span>
              <span style={{ color: 'var(--text-ghost)' }}> / </span>
              <span style={{ color: 'var(--bear)' }}>{stats.losses}</span>
            </span>
          </div>
          <div className={styles.sep} aria-hidden="true"/>
          <div className={styles.item}>
            <span className={styles.label}>PnL (points)</span>
            <span
              className={`${styles.value} ${styles.mono}`}
              style={{ color: pnlPositive ? 'var(--bull)' : 'var(--bear)' }}
            >
              {pnlPositive ? '+' : '-'}{fmtPrice(Math.abs(stats.totalPoints))}
            </span>
          </div>
          <div className={styles.sep} aria-hidden="true"/>
          <div className={styles.item}>
            <span className={styles.label}>R cumulé</span>
            <span
              className={`${styles.value} ${styles.mono}`}
              style={{ color: rPositive ? 'var(--bull)' : 'var(--bear)' }}
            >
              {rPositive ? '+' : ''}{stats.totalR.toFixed(2)}R
            </span>
          </div>
        </>
      )}

      {/* Open trade summary chips */}
      {openTrades.length > 0 && (
        <div className={styles.openList}>
          {openTrades.map(t => (
            <span
              key={t.id}
              className={styles.tradePill}
              style={{
                borderColor: t.direction === 'BUY' ? 'rgba(38,166,154,0.40)' : 'rgba(239,83,80,0.40)',
                color:       t.direction === 'BUY' ? '#26A69A' : '#EF5350',
              }}
            >
              {t.direction} @ {fmtPrice(t.entryPrice)}
            </span>
          ))}
        </div>
      )}

      <div className={styles.spacer}/>

      <button className={styles.resetBtn} onClick={onReset} title="Réinitialiser tous les trades">
        Réinitialiser
      </button>
    </div>
  );
}
