import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { groupCandles } from '../lib/candleData';
import dynamic from 'next/dynamic';
import { useSymbols }     from '../hooks/useSymbols';
import { useBars }        from '../hooks/useBars';
import { useFootprint }   from '../hooks/useFootprint';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useCVD }         from '../hooks/useCVD';
import { useHtfBars }     from '../hooks/useHtfBars';
import { useDrawings }    from '../hooks/useDrawings';
import AppHeader        from '../components/layout/AppHeader';
import StatsBar         from '../components/layout/StatsBar';
import TimeframeBar     from '../components/layout/TimeframeBar';
import styles           from '../styles/app.module.css';
import { DEFAULT_SETTINGS } from '../components/SettingsPanel';
import { DEFAULT_PATTERNS, PATTERN_TYPES } from '../components/PatternPanel';

const DrawingToolbar  = dynamic(() => import('../components/charts/DrawingToolbar'),  { ssr: false });
const DrawingStyleBar = dynamic(() => import('../components/charts/DrawingStyleBar'), { ssr: false });

const TradingChart   = dynamic(() => import('../components/charts/TradingChart'),   { ssr: false });
const FootprintChart = dynamic(() => import('../components/charts/FootprintChart'), { ssr: false });
const ImportPanel    = dynamic(() => import('../components/ImportPanel'),             { ssr: false });
const ManagePanel    = dynamic(() => import('../components/ManagePanel'),             { ssr: false });
const IndicatorPanel = dynamic(() => import('../components/IndicatorPanel'),          { ssr: false });
const SettingsPanel  = dynamic(() => import('../components/SettingsPanel'),           { ssr: false });
const ReplayModal    = dynamic(() => import('../components/replay/ReplayModal'),      { ssr: false });
const PatternPanel   = dynamic(() => import('../components/PatternPanel'),             { ssr: false });
const ChatPanel      = dynamic(() => import('../components/chat/ChatPanel'),           { ssr: false });
const AlertsPanel    = dynamic(() => import('../components/AlertsPanel'),              { ssr: false });

export default function Home() {
  const router = useRouter();
  const { symbols, symbolId, setSymbolId, loadSymbols, currentSym } = useSymbols();
  const [tfId,      setTfId]      = useLocalStorage('grapher.tfId',      '1h');
  const [chartMode, setChartMode] = useLocalStorage('grapher.chartMode', 'candle');
  const [tickSize,  setTickSize]  = useState(5);
  const [indicators,      setIndicators]      = useLocalStorage('grapher.indicators', []);
  const [patterns,        setPatterns]        = useLocalStorage('grapher.patterns',   DEFAULT_PATTERNS);
  const [settings,        setSettings]        = useLocalStorage('grapher.settings',   DEFAULT_SETTINGS);
  const [showImport,      setShowImport]      = useState(false);
  const [showManage,      setShowManage]      = useState(false);
  const [showIndicators,  setShowIndicators]  = useState(false);
  const [showPatterns,    setShowPatterns]    = useState(false);
  const [showSettings,    setShowSettings]    = useState(false);
  const [showReplay,      setShowReplay]      = useState(false);
  const [showChat,        setShowChat]        = useState(false);
  const [showAlerts,      setShowAlerts]      = useState(false);

  const {
    drawings, activeTool, setActiveTool,
    selectedId, setSelectedId,
    addDrawing, updateDrawing, removeDrawing, clearAll,
  } = useDrawings();

  const { allBars, loading, loadingMore, hasMore, onLoadMore } = useBars(symbolId, tfId);

  const hasTicks       = (currentSym?.tick_count ?? 0) > 0;
  const inFootprint    = chartMode === 'footprint' && hasTicks;

  // In "grouped" mode, merge consecutive same-direction candles into trend bars.
  const displayBars = useMemo(
    () => (chartMode === 'grouped' ? groupCandles(allBars) : allBars),
    [chartMode, allBars],
  );

  // Merge stored patterns with PATTERN_TYPES so newly-added patterns render even
  // when the user's localStorage predates them. Stored values win over defaults.
  const effectivePatterns = useMemo(
    () => PATTERN_TYPES.map(pt => {
      const stored = patterns.find(p => p.type === pt.type);
      return stored ? { ...pt, ...stored } : { ...pt, enabled: true };
    }),
    [patterns],
  );

  const cvdData = useCVD(inFootprint ? null : symbolId, tfId);

  // Séries HTF pour l'indicateur TRENDER — chargées indépendamment des bougies
  // du graphe, qui n'en contiennent jamais assez (cf. hooks/useHtfBars).
  const htfBars = useHtfBars(symbolId, indicators, displayBars);

  // Footprint data — only fetched when footprint mode is active for a symbol with ticks
  const {
    bars: fpBars, loading: fpLoading, loadingMore: fpLoadingMore,
    hasMore: fpHasMore, loadMore: fpLoadMore, error: fpError,
  } = useFootprint(inFootprint ? symbolId : null, tickSize);

  // Auto-fallback to candle when switching to a symbol without tick data
  useEffect(() => {
    if (chartMode === 'footprint' && !hasTicks) setChartMode('candle');
  }, [hasTicks, chartMode]);

  const onImported = (data) => {
    setShowImport(false);
    loadSymbols(data.symbolId);
  };

  const onDeleted = (deletedId) => {
    // Si le symbole supprimé est celui actif, on recharge la liste (useSymbols se repositionne)
    if (deletedId === symbolId) loadSymbols();
    else loadSymbols(symbolId);
  };

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (symbols.length === 0) {
    return (
      <main className={styles.empty}>
        <svg className={styles.emptyIcon} width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
          <rect x="6"  y="28" width="8"  height="14" rx="2" fill="#F59E0B" opacity="0.6"/>
          <rect x="20" y="16" width="8"  height="26" rx="2" fill="#26A69A" opacity="0.6"/>
          <rect x="34" y="8"  width="8"  height="34" rx="2" fill="#F59E0B" opacity="0.6"/>
        </svg>
        <h1 className={styles.emptyTitle}>No data yet</h1>
        <p className={styles.emptyBody}>
          Import an MT5 export file to get started. M1 bars are stored and instantly available at all timeframes.
        </p>
        <button className={styles.emptyBtn} onClick={() => setShowImport(true)}>
          Import MT5 File
        </button>
        {showImport && <ImportPanel onClose={() => setShowImport(false)} onImported={onImported} />}
      </main>
    );
  }

  // ── Main layout ─────────────────────────────────────────────────────────────
  return (
    <div className={styles.shell}>
      <AppHeader
        symbols={symbols}
        symbolId={symbolId}
        onSymbolChange={setSymbolId}
        onImport={() => setShowImport(true)}
        onManage={() => setShowManage(true)}
        onSettings={() => setShowSettings(true)}
        onReplay={() => setShowReplay(true)}
        onRsi={() => router.push('/rsi')}
        onBacktest={() => router.push('/backtest')}
        onChat={() => setShowChat(true)}
        onAlerts={() => setShowAlerts(true)}
      />
      <StatsBar allBars={allBars} currentSym={currentSym} loading={loading} />
      <TimeframeBar
        tfId={tfId}          onTfChange={setTfId}
        loading={loading}    loadingMore={loadingMore}
        hasMore={hasMore}    barCount={allBars.length}
        chartMode={chartMode} onChartModeChange={setChartMode}
        hasTicks={hasTicks}
        tickSize={tickSize}  onTickSizeChange={setTickSize}
        indicatorCount={indicators.length}
        onIndicators={() => setShowIndicators(true)}
        patternCount={effectivePatterns.filter(p => p.enabled).length}
        onPatterns={() => setShowPatterns(true)}
      />

      {/* ── Chart area ───────────────────────────────────────────── */}
      <div className={styles.chartArea} style={{ position: 'relative' }}>
        <DrawingToolbar
          activeTool={activeTool}
          onToolChange={setActiveTool}
          onClearAll={clearAll}
        />
        <DrawingStyleBar
          drawing={activeTool === null ? (drawings.find(d => d.id === selectedId) ?? null) : null}
          onUpdate={updateDrawing}
          onRemove={removeDrawing}
        />
        {inFootprint ? (
          fpLoading ? (
            <p className={styles.chartEmpty}>Loading footprint data…</p>
          ) : fpError ? (
            <p className={styles.chartEmpty}>Error: {fpError}</p>
          ) : (
            <FootprintChart
              bars={fpBars}
              tickSize={tickSize}
              onLoadMore={fpLoadMore}
              loadingMore={fpLoadingMore}
              hasMore={fpHasMore}
              imbalanceRatio={settings?.fpImbalanceRatio ?? 3}
            />
          )
        ) : (
          allBars.length > 0 ? (
            <TradingChart
                candles={displayBars}
                onLoadMore={onLoadMore}
                indicators={indicators}
                htfBars={htfBars}
                patterns={effectivePatterns}
                chartMode={chartMode}
                bullColor={settings?.bullColor ?? '#26A69A'}
                bearColor={settings?.bearColor ?? '#EF5350'}
                showVolume={settings?.showVolume ?? true}
                cvdData={chartMode === 'candle' ? cvdData : null}
                drawings={drawings}
                activeTool={activeTool}
                selectedId={selectedId}
                onDrawingAdd={(type, points, style) => {
                  addDrawing(type, points, style);
                  setActiveTool(null); // retour curseur après chaque tracé
                }}
                onDrawingUpdate={updateDrawing}
                onDrawingRemove={removeDrawing}
                onDrawingSelect={setSelectedId}
              />
          ) : !loading && symbolId ? (
            <p className={styles.chartEmpty}>No bars for this symbol / timeframe.</p>
          ) : null
        )}
      </div>

      {showImport      && <ImportPanel    onClose={() => setShowImport(false)}     onImported={onImported} />}
      {showManage      && <ManagePanel    onClose={() => setShowManage(false)}     onDeleted={onDeleted} />}
      {showIndicators  && <IndicatorPanel onClose={() => setShowIndicators(false)} indicators={indicators} onChange={setIndicators} />}
      {showPatterns    && <PatternPanel   onClose={() => setShowPatterns(false)}   patterns={patterns}     onChange={setPatterns} />}
      {showSettings    && <SettingsPanel  onClose={() => setShowSettings(false)}   settings={settings}     onChange={setSettings} />}
      {showReplay      && <ReplayModal    onClose={() => setShowReplay(false)} />}
      {showChat        && <ChatPanel      onClose={() => setShowChat(false)} />}
      {showAlerts      && <AlertsPanel    onClose={() => setShowAlerts(false)}     symbols={symbols} symbolId={symbolId} />}
    </div>
  );
}
