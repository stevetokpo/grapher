import { fmtPrice, fmtVol, fmtCount } from '../../lib/format';
import styles from './StatsBar.module.css';

function StatItem({ label, value, variant }) {
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div className={`${styles.statValue}${variant ? ` ${styles[variant]}` : ''}`}>{value}</div>
    </div>
  );
}

function Divider() {
  return <div className={styles.divider} aria-hidden="true" />;
}

export default function StatsBar({ allBars, currentSym, loading }) {
  const last  = allBars[allBars.length - 1];
  const first = allBars[0];
  const price = last?.close ?? null;

  const changeAbs = last && first ? last.close - first.open : null;
  const changePct = changeAbs != null && first?.open ? (changeAbs / first.open) * 100 : null;
  const isPos     = changePct != null ? changePct >= 0 : true;
  const variant   = isPos ? 'bull' : 'bear';

  const high = allBars.length ? allBars.reduce((m, b) => b.high > m ? b.high : m, -Infinity) : null;
  const low  = allBars.length ? allBars.reduce((m, b) => b.low  < m ? b.low  : m,  Infinity) : null;
  const vol  = allBars.reduce((s, b) => s + (b.volume || 0), 0) || null;

  return (
    <div className={styles.bar} role="status" aria-label="Market statistics">
      {price != null ? (
        <>
          <div className={styles.priceBlock}>
            <span className={`${styles.price} ${styles[variant]}`}>{fmtPrice(price)}</span>
            {changePct != null && (
              <span className={`${styles.badge} ${styles[variant]}`}>
                {isPos ? '+' : ''}{changePct.toFixed(2)}%
              </span>
            )}
          </div>

          <Divider />
          <StatItem label="Open"   value={fmtPrice(first?.open)} />
          <StatItem label="High"   value={fmtPrice(high)} variant="bull" />
          <StatItem label="Low"    value={fmtPrice(low)}  variant="bear" />
          <StatItem label="Volume" value={fmtVol(vol)} />

          {currentSym && (
            <>
              <Divider />
              <StatItem label="Loaded"     value={fmtCount(allBars.length)} />
              <StatItem label="Total M1"   value={fmtCount(currentSym.bar_count)} />
              {currentSym.tick_count > 0 && (
                <StatItem label="Ticks in DB" value={fmtCount(currentSym.tick_count)} />
              )}
            </>
          )}
        </>
      ) : (
        <p className={styles.placeholder}>{loading ? 'Loading bars…' : 'No data'}</p>
      )}
    </div>
  );
}
