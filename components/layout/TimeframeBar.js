import { fmtCount } from '../../lib/format';
import styles from './TimeframeBar.module.css';

const TIMEFRAMES = [
  { id: '1m',  label: '1m'  }, { id: '3m',  label: '3m'  },
  { id: '5m',  label: '5m'  }, { id: '10m', label: '10m' },
  { id: '15m', label: '15m' }, { id: '20m', label: '20m' },
  { id: '30m', label: '30m' }, { id: '1h',  label: '1H'  },
  { id: '2h',  label: '2H'  }, { id: '4h',  label: '4H'  },
  { id: '1D',  label: '1D'  },
];

const TICK_SIZES = [0.5, 1, 2, 5, 10, 20, 50];

// SVG icons for chart mode buttons
function CandleIcon() {
  return (
    <svg width="12" height="13" viewBox="0 0 12 13" fill="none" aria-hidden="true">
      <rect x="2" y="4" width="3" height="6" rx="0.5" fill="currentColor" opacity="0.9"/>
      <rect x="7" y="2" width="3" height="9" rx="0.5" fill="currentColor" opacity="0.9"/>
      <line x1="3.5" y1="1" x2="3.5" y2="4"  stroke="currentColor" strokeWidth="1"/>
      <line x1="3.5" y1="10" x2="3.5" y2="12" stroke="currentColor" strokeWidth="1"/>
      <line x1="8.5" y1="1" x2="8.5" y2="2"  stroke="currentColor" strokeWidth="1"/>
      <line x1="8.5" y1="11" x2="8.5" y2="12" stroke="currentColor" strokeWidth="1"/>
    </svg>
  );
}

function GroupedIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <rect x="2"   y="2" width="3.5" height="9" rx="0.5" fill="currentColor" opacity="0.9"/>
      <rect x="7.5" y="4" width="3.5" height="6" rx="0.5" fill="currentColor" opacity="0.5"/>
      <line x1="3.75" y1="0.5" x2="3.75" y2="2"  stroke="currentColor" strokeWidth="1" opacity="0.9"/>
      <line x1="3.75" y1="11"  x2="3.75" y2="12.5" stroke="currentColor" strokeWidth="1" opacity="0.9"/>
    </svg>
  );
}

function FootprintIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="5" height="5" rx="0.5" fill="currentColor" opacity="0.3"/>
      <rect x="7" y="1" width="5" height="5" rx="0.5" fill="currentColor" opacity="0.7"/>
      <rect x="1" y="7" width="5" height="5" rx="0.5" fill="currentColor" opacity="0.5"/>
      <rect x="7" y="7" width="5" height="5" rx="0.5" fill="currentColor" opacity="0.9"/>
    </svg>
  );
}

function IndicatorsIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M1 9 L4 5 L7 7 L11 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="4" cy="5" r="1.2" fill="currentColor"/>
      <circle cx="7" cy="7" r="1.2" fill="currentColor"/>
    </svg>
  );
}

function PatternsIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="1" y="5" width="3" height="5" rx="0.5" fill="currentColor" opacity="0.5"/>
      <line x1="2.5" y1="3" x2="2.5" y2="5" stroke="currentColor" strokeWidth="1" opacity="0.5"/>
      <line x1="2.5" y1="10" x2="2.5" y2="11.5" stroke="currentColor" strokeWidth="1" opacity="0.5"/>
      <rect x="4.5" y="2.5" width="3" height="7" rx="0.5" fill="currentColor" opacity="0.8"/>
      <line x1="6" y1="0.5" x2="6" y2="2.5" stroke="currentColor" strokeWidth="1" opacity="0.8"/>
      <line x1="6" y1="9.5" x2="6" y2="11.5" stroke="currentColor" strokeWidth="1" opacity="0.8"/>
      <rect x="8" y="4" width="3" height="4" rx="0.5" fill="currentColor"/>
      <line x1="9.5" y1="2" x2="9.5" y2="4" stroke="currentColor" strokeWidth="1"/>
      <line x1="9.5" y1="8" x2="9.5" y2="10" stroke="currentColor" strokeWidth="1"/>
    </svg>
  );
}

export default function TimeframeBar({
  tfId, onTfChange,
  loading, loadingMore, hasMore, barCount,
  chartMode, onChartModeChange,
  hasTicks,
  tickSize, onTickSizeChange,
  indicatorCount, onIndicators,
  patternCount, onPatterns,
}) {
  const inFootprint = chartMode === 'footprint';

  return (
    <div className={styles.bar} role="toolbar" aria-label="Chart controls">
      {/* Interval buttons — hidden in footprint mode (footprint is always M1) */}
      {!inFootprint && (
        <>
          <span className={styles.intervalLabel}>INTERVAL</span>
          {TIMEFRAMES.map(t => (
            <button
              key={t.id}
              className={`${styles.tfBtn}${t.id === tfId ? ` ${styles.active}` : ''}`}
              onClick={() => onTfChange(t.id)}
              aria-pressed={t.id === tfId}
            >
              {t.label}
            </button>
          ))}
        </>
      )}

      {inFootprint && (
        <span className={styles.intervalLabel}>FOOTPRINT · M1</span>
      )}

      {/* Status indicators */}
      {loading && !inFootprint && (
        <span className={styles.status} aria-live="polite">Loading…</span>
      )}
      {loadingMore && !loading && !inFootprint && (
        <span className={styles.loadingMore} aria-live="polite">
          <span className={styles.loadingDot} aria-hidden="true" />
          Loading older bars…
        </span>
      )}
      {!hasMore && barCount > 0 && !loading && !inFootprint && (
        <span className={styles.allLoaded}>
          ← All history loaded ({fmtCount(barCount)} bars)
        </span>
      )}

      <div className={styles.spacer} />

      {/* Indicators + Patterns buttons — only in candle mode */}
      {!inFootprint && (
        <>
          <button
            className={`${styles.indBtn}${indicatorCount > 0 ? ` ${styles.indBtnActive}` : ''}`}
            onClick={onIndicators}
            aria-label="Indicateurs"
            title="Indicateurs"
          >
            <IndicatorsIcon />
            Indicateurs
            {indicatorCount > 0 && (
              <span className={styles.indCount}>{indicatorCount}</span>
            )}
          </button>
          <button
            className={`${styles.patBtn}${patternCount > 0 ? ` ${styles.patBtnActive}` : ''}`}
            onClick={onPatterns}
            aria-label="Patterns"
            title="Patterns"
          >
            <PatternsIcon />
            Patterns
            {patternCount > 0 && (
              <span className={styles.patCount}>{patternCount}</span>
            )}
          </button>
        </>
      )}

      {/* Tick size selector — only when in footprint mode */}
      {inFootprint && (
        <div className={styles.tickControl}>
          <span className={styles.tickLabel}>TICK SIZE</span>
          <select
            className={styles.tickSelect}
            value={tickSize}
            onChange={e => onTickSizeChange(Number(e.target.value))}
            aria-label="Footprint tick size"
          >
            {TICK_SIZES.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      )}

      {/* Chart mode toggle — Candle/Grouped always available, Footprint needs ticks */}
      <div className={styles.viewToggle} role="group" aria-label="Chart type">
        <button
          className={`${styles.viewBtn}${chartMode === 'candle' ? ` ${styles.viewActive}` : ''}`}
          onClick={() => onChartModeChange('candle')}
          aria-pressed={chartMode === 'candle'}
          title="Candlestick chart"
        >
          <CandleIcon />
          Candle
        </button>
        <button
          className={`${styles.viewBtn}${chartMode === 'grouped' ? ` ${styles.viewActive}` : ''}`}
          onClick={() => onChartModeChange('grouped')}
          aria-pressed={chartMode === 'grouped'}
          title="Grouped trend candles — merges consecutive same-direction bars"
        >
          <GroupedIcon />
          Grouped
        </button>
        {hasTicks && (
          <button
            className={`${styles.viewBtn}${chartMode === 'footprint' ? ` ${styles.viewActive}` : ''}`}
            onClick={() => onChartModeChange('footprint')}
            aria-pressed={chartMode === 'footprint'}
            title="Footprint order-flow chart"
          >
            <FootprintIcon />
            Footprint
          </button>
        )}
      </div>
    </div>
  );
}
