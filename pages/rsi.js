import { useMemo } from 'react';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { useSymbols }      from '../hooks/useSymbols';
import { useBars }         from '../hooks/useBars';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { calcRSI }         from '../lib/indicators';
import AppHeader           from '../components/layout/AppHeader';
import styles              from '../styles/rsi.module.css';

const RsiChart = dynamic(() => import('../components/charts/RsiChart'), { ssr: false });

const TIMEFRAMES = [
  '1m','3m','5m','10m','15m','20m','30m','1h','2h','4h','1D',
];

const RSI_COLORS = [
  { c: '#F472B6', label: 'Rose'   },
  { c: '#60A5FA', label: 'Bleu'   },
  { c: '#A78BFA', label: 'Violet' },
  { c: '#34D399', label: 'Vert'   },
  { c: '#F59E0B', label: 'Ambre'  },
  { c: '#FB923C', label: 'Orange' },
];

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

export default function RsiPage() {
  const router = useRouter();
  const { symbols, symbolId, setSymbolId } = useSymbols();

  const [tfId,       setTfId]       = useLocalStorage('grapher.rsi.tf',         '1h');
  const [period,     setPeriod]     = useLocalStorage('grapher.rsi.period',      14);
  const [overbought, setOverbought] = useLocalStorage('grapher.rsi.overbought',  70);
  const [oversold,   setOversold]   = useLocalStorage('grapher.rsi.oversold',    30);
  const [color,      setColor]      = useLocalStorage('grapher.rsi.color',       '#F472B6');

  const { allBars, loading, loadingMore, hasMore, onLoadMore } = useBars(symbolId, tfId);

  // Current RSI value for the badge
  const currentRsi = useMemo(() => {
    if (!allBars.length || allBars.length <= period) return null;
    const data = calcRSI(allBars, { period, source: 'close' });
    return data.length ? data[data.length - 1].value : null;
  }, [allBars, period]);

  const badgeClass = currentRsi == null
    ? ''
    : currentRsi >= overbought
      ? styles.rsiBadgeOb
      : currentRsi <= oversold
        ? styles.rsiBadgeOs
        : styles.rsiBadgeNeutral;

  const onPeriodChange = e => {
    const v = parseInt(e.target.value, 10);
    if (!isNaN(v)) setPeriod(clamp(v, 2, 500));
  };

  const onObChange = e => {
    const v = parseInt(e.target.value, 10);
    if (!isNaN(v)) setOverbought(clamp(v, oversold + 1, 99));
  };

  const onOsChange = e => {
    const v = parseInt(e.target.value, 10);
    if (!isNaN(v)) setOversold(clamp(v, 1, overbought - 1));
  };

  return (
    <div className={styles.shell}>
      <AppHeader
        symbols={symbols}
        symbolId={symbolId}
        onSymbolChange={setSymbolId}
        onImport={() => {}}
        onManage={() => {}}
        onSettings={() => {}}
        isRsiMode
        onBack={() => router.push('/')}
      />

      {/* ── Config bar ──────────────────────────────────────────── */}
      <div className={styles.configBar} role="toolbar" aria-label="RSI controls">
        <span className={styles.intervalLabel}>INTERVAL</span>

        {TIMEFRAMES.map(tf => (
          <button
            key={tf}
            className={`${styles.tfBtn}${tf === tfId ? ` ${styles.tfBtnActive}` : ''}`}
            onClick={() => setTfId(tf)}
            aria-pressed={tf === tfId}
          >
            {tf}
          </button>
        ))}

        <div className={styles.spacer} />

        {/* RSI value badge */}
        {currentRsi != null && (
          <span className={`${styles.rsiBadge} ${badgeClass}`}>
            {currentRsi.toFixed(1)}
          </span>
        )}

        <div className={styles.sep} />

        {/* Period */}
        <div className={styles.configGroup}>
          <span className={styles.configLabel}>Période</span>
          <input
            type="number"
            className={styles.numInput}
            value={period}
            min={2} max={500}
            onChange={onPeriodChange}
            aria-label="Période RSI"
          />
        </div>

        <div className={styles.sep} />

        {/* Overbought */}
        <div className={styles.configGroup}>
          <span className={styles.configLabel} style={{ color: 'rgba(239,83,80,0.75)' }}>Surachat</span>
          <input
            type="number"
            className={styles.numInput}
            value={overbought}
            min={oversold + 1} max={99}
            onChange={onObChange}
            aria-label="Niveau de surachat"
          />
        </div>

        <div className={styles.sep} />

        {/* Oversold */}
        <div className={styles.configGroup}>
          <span className={styles.configLabel} style={{ color: 'rgba(38,166,154,0.75)' }}>Survente</span>
          <input
            type="number"
            className={styles.numInput}
            value={oversold}
            min={1} max={overbought - 1}
            onChange={onOsChange}
            aria-label="Niveau de survente"
          />
        </div>

        <div className={styles.sep} />

        {/* Color swatches */}
        <div className={styles.swatches} role="group" aria-label="Couleur RSI">
          {RSI_COLORS.map(({ c, label }) => (
            <button
              key={c}
              className={`${styles.swatch}${c === color ? ` ${styles.swatchActive}` : ''}`}
              style={{ '--sw': c }}
              onClick={() => setColor(c)}
              aria-pressed={c === color}
              aria-label={label}
              title={label}
            />
          ))}
        </div>
      </div>

      {/* ── Chart ───────────────────────────────────────────────── */}
      <div className={styles.chartArea}>
        {loading && (
          <p className={styles.chartEmpty}>Chargement…</p>
        )}
        {!loading && allBars.length > 0 && (
          <RsiChart
            candles={allBars}
            onLoadMore={onLoadMore}
            period={period}
            overbought={overbought}
            oversold={oversold}
            color={color}
          />
        )}
        {!loading && allBars.length === 0 && symbolId && (
          <p className={styles.chartEmpty}>Pas de données pour ce symbole / timeframe.</p>
        )}
      </div>
    </div>
  );
}
