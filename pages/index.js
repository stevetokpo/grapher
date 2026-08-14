import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { groupCandles, heikinAshi } from '../lib/candleData';
import { TF_SECONDS }   from '../lib/replayUtils';
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
import { DEFAULT_SCRIPT_CONFIG } from '../components/ScriptPanel';

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
const ScriptPanel    = dynamic(() => import('../components/ScriptPanel'),              { ssr: false });
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
  const [scriptConfig,    setScriptConfig]    = useLocalStorage('grapher.scripts',    DEFAULT_SCRIPT_CONFIG);
  const [showImport,      setShowImport]      = useState(false);
  const [showManage,      setShowManage]      = useState(false);
  const [showIndicators,  setShowIndicators]  = useState(false);
  const [showPatterns,    setShowPatterns]    = useState(false);
  const [showScripts,     setShowScripts]     = useState(false);
  // Positions du dernier run de script. Tenues ICI et non dans le tiroir : on
  // referme le tiroir justement pour les regarder sur le graphe.
  const [scriptTrades,    setScriptTrades]    = useState([]);
  const [scriptTradeId,   setScriptTradeId]   = useState(null);
  const [scriptFocus,     setScriptFocus]     = useState(null);
  const [showSettings,    setShowSettings]    = useState(false);
  const [showReplay,      setShowReplay]      = useState(false);
  const [showChat,        setShowChat]        = useState(false);
  const [showAlerts,      setShowAlerts]      = useState(false);

  const {
    drawings, activeTool, setActiveTool,
    selectedId, setSelectedId,
    addDrawing, updateDrawing, removeDrawing, clearAll,
  } = useDrawings();

  const { allBars, loading, loadingMore, hasMore, onLoadMore } = useBars(
    symbolId, tfId,
    settings?.initialBars   ?? 500,
    settings?.barsPerScroll ?? 500,
  );

  const hasTicks       = (currentSym?.tick_count ?? 0) > 0;
  const inFootprint    = chartMode === 'footprint' && hasTicks;

  // LE MODE CHOISIT LA SÉRIE, et la série est la source de tout le reste :
  // indicateurs, motifs, scripts et infobulle lisent ces bougies-là.
  //   • grouped — les bougies consécutives de même sens fusionnent en une barre
  //     de tendance ; la série n'est plus régulière dans le temps ;
  //   • heikin  — mêmes temps, prix LISSÉS (des moyennes, pas des prix traités) ;
  //   • candle / line — les bougies brutes, la ligne n'étant qu'un autre rendu
  //     de la même série (les clôtures), tracé côté TradingChart.
  const displayBars = useMemo(() => {
    if (chartMode === 'grouped') return groupCandles(allBars);
    if (chartMode === 'heikin')  return heikinAshi(allBars);
    return allBars;
  }, [chartMode, allBars]);

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

  // Séries HTF pour l'indicateur TRENDER et le motif RSIER — chargées
  // indépendamment des bougies du graphe, qui n'en contiennent jamais assez
  // (cf. hooks/useHtfBars).
  const htfBars = useHtfBars(symbolId, indicators, effectivePatterns, displayBars);

  // Footprint data — only fetched when footprint mode is active for a symbol with ticks
  const {
    bars: fpBars, loading: fpLoading, loadingMore: fpLoadingMore,
    hasMore: fpHasMore, loadMore: fpLoadMore, error: fpError,
  } = useFootprint(inFootprint ? symbolId : null, tickSize);

  // Auto-fallback to candle when switching to a symbol without tick data
  useEffect(() => {
    if (chartMode === 'footprint' && !hasTicks) setChartMode('candle');
  }, [hasTicks, chartMode]);

  // Les positions d'un script appartiennent aux bougies sur lesquelles il a
  // tourné. Changer de symbole ou d'unité de temps les rend caduques : les
  // laisser peindrait des trades d'un marché sur les bougies d'un autre.
  useEffect(() => {
    setScriptTrades([]);
    setScriptTradeId(null);
    setScriptFocus(null);
  }, [symbolId, tfId]);

  // Recadrer sur une position choisie dans le tableau. Objet neuf à chaque fois :
  // TradingChart compare `focusRange` par identité, donc re-cliquer la même
  // ligne recadre quand même.
  const focusScriptTrade = (t) => {
    setScriptTradeId(t.id);
    const pad = (TF_SECONDS[tfId] ?? 3600) * 12;
    setScriptFocus({ from: t.entryTime - pad, to: t.exitTime + pad });
  };

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
        onTicker={() => router.push('/ticker')}
        onBacktest={() => router.push('/backtest')}
        onRfvg={() => router.push('/rfvg')}
        onKo={() => router.push('/ko')}
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
        onScripts={() => setShowScripts(v => !v)}
        scriptsOpen={showScripts}
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
                settings={settings}
                backtestTrades={scriptTrades}
                selectedTradeId={scriptTradeId}
                focusRange={scriptFocus}
                watermarkText={currentSym ? `${currentSym.name} · ${tfId.toUpperCase()}` : ''}
                cvdData={chartMode === 'grouped'
                  /* Le CVD est daté à la bougie : il ne vaut que sur une série
                     régulière dans le temps, ce que 'grouped' n'est pas. */
                  ? null : cvdData}
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
      {showScripts     && (
        <ScriptPanel
          onClose={() => setShowScripts(false)}
          candles={displayBars}
          symbolName={currentSym?.name ?? ''}
          tfId={tfId}
          patterns={effectivePatterns}
          htfBars={htfBars}
          config={scriptConfig}
          onChange={setScriptConfig}
          onTradesChange={setScriptTrades}
          onSelectTrade={focusScriptTrade}
          selectedTradeId={scriptTradeId}
        />
      )}
      {showSettings    && <SettingsPanel  onClose={() => setShowSettings(false)}   settings={settings}     onChange={setSettings} />}
      {showReplay      && <ReplayModal    onClose={() => setShowReplay(false)} />}
      {showChat        && <ChatPanel      onClose={() => setShowChat(false)} />}
      {showAlerts      && <AlertsPanel    onClose={() => setShowAlerts(false)}     symbols={symbols} symbolId={symbolId} />}
    </div>
  );
}
