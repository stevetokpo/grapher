import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useDrawings }     from '../hooks/useDrawings';
import { useReplay }       from '../hooks/useReplay';
import { useTrades }       from '../hooks/useTrades';
import AppHeader    from '../components/layout/AppHeader';
import TimeframeBar from '../components/layout/TimeframeBar';
import styles       from '../styles/app.module.css';
import { DEFAULT_SETTINGS } from '../components/SettingsPanel';
import { DEFAULT_PATTERNS } from '../components/PatternPanel';

const TradingChart   = dynamic(() => import('../components/charts/TradingChart'),   { ssr: false });
const DrawingToolbar = dynamic(() => import('../components/charts/DrawingToolbar'),  { ssr: false });
const ReplayControls = dynamic(() => import('../components/replay/ReplayControls'),  { ssr: false });
const TradeStats     = dynamic(() => import('../components/replay/TradeStats'),       { ssr: false });
const IndicatorPanel = dynamic(() => import('../components/IndicatorPanel'),          { ssr: false });
const PatternPanel   = dynamic(() => import('../components/PatternPanel'),            { ssr: false });
const SettingsPanel  = dynamic(() => import('../components/SettingsPanel'),           { ssr: false });

export default function ReplayPage() {
  const router = useRouter();
  const { symbolId: symIdStr, from: fromStr, to: toStr } = router.query;

  const [allM1Bars,  setAllM1Bars]  = useState([]);
  const [fetchState, setFetchState] = useState('idle');
  const [fetchError, setFetchError] = useState(null);
  const [capped,     setCapped]     = useState(false);
  const [symbolName, setSymbolName] = useState('');

  const [tfId,           setTfId]           = useLocalStorage('grapher.replay.tf', '1m');
  const [indicators,     setIndicators]     = useLocalStorage('grapher.indicators', []);
  const [patterns,       setPatterns]       = useLocalStorage('grapher.patterns',   DEFAULT_PATTERNS);
  const [settings,       setSettings]       = useLocalStorage('grapher.settings',   DEFAULT_SETTINGS);
  const [showIndicators,   setShowIndicators]   = useState(false);
  const [showPatterns,     setShowPatterns]     = useState(false);
  const [showSettings,     setShowSettings]     = useState(false);
  const [tradeSetupActive, setTradeSetupActive] = useState(false);

  const {
    drawings, activeTool, setActiveTool,
    selectedId, setSelectedId,
    addDrawing, updateDrawing, removeDrawing, clearAll,
  } = useDrawings();

  const {
    visibleBars, cursor, total,
    isPlaying, speed, setSpeed,
    stepSize, setStepSize,
    play, pause, stepForward, stepBack, seekToPercent,
  } = useReplay(allM1Bars, tfId);

  const {
    openTrades, closedTrades, stats,
    placeTrade, checkTrades, resetTrades,
  } = useTrades();

  // ── Track cursor advances to check trades ──────────────────────────────
  const allM1BarsRef    = useRef(allM1Bars);
  const prevCursorRef   = useRef(0);

  useEffect(() => {
    allM1BarsRef.current  = allM1Bars;
    prevCursorRef.current = 0;
    resetTrades();
  }, [allM1Bars]);

  useEffect(() => {
    const prev = prevCursorRef.current;
    prevCursorRef.current = cursor;
    if (cursor <= prev || allM1BarsRef.current.length === 0) return;
    checkTrades(allM1BarsRef.current.slice(prev, cursor));
  }, [cursor, checkTrades]);

  // ── Fetch data ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!router.isReady || !symIdStr || !fromStr || !toStr) return;

    setFetchState('loading');
    setAllM1Bars([]);
    setCapped(false);
    setFetchError(null);

    fetch('/api/symbols')
      .then(r => r.json())
      .then(syms => {
        const sym = syms.find(s => s.id === Number(symIdStr));
        if (sym) setSymbolName(sym.name);
      })
      .catch(() => {});

    fetch(`/api/replay/bars?symbolId=${symIdStr}&from=${fromStr}&to=${toStr}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setAllM1Bars(data.bars ?? []);
        setCapped(Boolean(data.capped));
        setFetchState('done');
      })
      .catch(err => {
        setFetchError(err.message);
        setFetchState('error');
      });
  }, [router.isReady, symIdStr, fromStr, toStr]);

  // ── Derived values ─────────────────────────────────────────────────────
  const lastVisible  = visibleBars[visibleBars.length - 1];
  const currentTime  = lastVisible
    ? new Date(lastVisible.time * 1000).toISOString().replace('T', ' ').slice(0, 16)
    : null;
  const currentPrice = lastVisible?.close ?? null;
  const isLoading    = fetchState === 'loading';
  const hasCurrentBar = visibleBars.length > 0;
  const hasTradeData  = stats.total > 0 || openTrades.length > 0;

  return (
    <div className={styles.shell}>
      <AppHeader
        symbols={[]}
        symbolId={null}
        onSymbolChange={() => {}}
        onImport={() => {}}
        onManage={() => {}}
        onSettings={() => setShowSettings(true)}
        isReplayMode
        replaySymbolName={symbolName}
        onBack={() => router.push('/')}
      />

      <TimeframeBar
        tfId={tfId}
        onTfChange={setTfId}
        loading={isLoading}
        loadingMore={false}
        hasMore={cursor < total}
        barCount={visibleBars.length}
        chartMode="candle"
        onChartModeChange={() => {}}
        hasTicks={false}
        tickSize={5}
        onTickSizeChange={() => {}}
        indicatorCount={indicators.length}
        onIndicators={() => setShowIndicators(true)}
        patternCount={patterns.filter(p => p.enabled).length}
        onPatterns={() => setShowPatterns(true)}
      />

      <ReplayControls
        isPlaying={isPlaying}
        onPlay={play}
        onPause={pause}
        onStepBack={stepBack}
        onStepForward={stepForward}
        speed={speed}
        onSpeedChange={setSpeed}
        stepSize={stepSize}
        onStepSizeChange={setStepSize}
        cursor={cursor}
        total={total}
        currentTime={currentTime}
        onSeek={seekToPercent}
        onTrade={() => { pause(); setTradeSetupActive(true); }}
        hasCurrentBar={hasCurrentBar && !tradeSetupActive}
      />

      {/* Stats bar — only visible once trades exist */}
      {hasTradeData && (
        <TradeStats
          stats={stats}
          openTrades={openTrades}
          onReset={resetTrades}
        />
      )}

      <div className={styles.chartArea} style={{ position: 'relative' }}>
        <DrawingToolbar
          activeTool={activeTool}
          onToolChange={setActiveTool}
          onClearAll={clearAll}
        />

        {isLoading && (
          <p className={styles.chartEmpty}>Chargement des données de replay…</p>
        )}

        {fetchState === 'error' && (
          <p className={styles.chartEmpty}>Erreur : {fetchError}</p>
        )}

        {fetchState === 'done' && total === 0 && (
          <p className={styles.chartEmpty}>Aucune donnée M1 pour cette période.</p>
        )}

        {capped && fetchState === 'done' && (
          <div style={{
            position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(245,158,11,0.14)', border: '1px solid rgba(245,158,11,0.38)',
            color: '#F59E0B', fontSize: 11, fontWeight: 600,
            padding: '4px 16px', borderRadius: 999,
            zIndex: 20, whiteSpace: 'nowrap', letterSpacing: '0.03em',
          }}>
            Limité à 100 000 bougies M1 — réduisez la plage de dates
          </div>
        )}

        {fetchState === 'done' && visibleBars.length > 0 && (
          <TradingChart
            candles={visibleBars}
            onLoadMore={null}
            indicators={indicators}
            patterns={patterns}
            bullColor={settings?.bullColor ?? '#26A69A'}
            bearColor={settings?.bearColor ?? '#EF5350'}
            showVolume={settings?.showVolume ?? true}
            cvdData={null}
            drawings={drawings}
            activeTool={activeTool}
            selectedId={selectedId}
            onDrawingAdd={(type, points, style) => {
              addDrawing(type, points, style);
              setActiveTool(null);
            }}
            onDrawingUpdate={updateDrawing}
            onDrawingRemove={removeDrawing}
            onDrawingSelect={setSelectedId}
            replayPlaying={isPlaying}
            openTrades={openTrades}
            tradeSetupActive={tradeSetupActive}
            tradeSetupEntry={currentPrice}
            onTradeSetupConfirm={(dir, entry, tp, sl) => {
              placeTrade(dir, entry, lastVisible?.time ?? 0, tp, sl);
              setTradeSetupActive(false);
            }}
            onTradeSetupCancel={() => setTradeSetupActive(false)}
          />
        )}
      </div>

      {showIndicators && (
        <IndicatorPanel
          onClose={() => setShowIndicators(false)}
          indicators={indicators}
          onChange={setIndicators}
        />
      )}
      {showPatterns && (
        <PatternPanel
          onClose={() => setShowPatterns(false)}
          patterns={patterns}
          onChange={setPatterns}
        />
      )}
      {showSettings && (
        <SettingsPanel
          onClose={() => setShowSettings(false)}
          settings={settings}
          onChange={setSettings}
        />
      )}
    </div>
  );
}
