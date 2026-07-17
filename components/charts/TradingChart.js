import { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, CrosshairMode, LineStyle } from 'lightweight-charts';
import { calcMA, calcRSI, calcBB, calcSwings } from '../../lib/indicators';
import { calcEquilibrium } from '../../lib/equilibrium';
import { calcHarmony } from '../../lib/harmony';
import { createHarmonyPrimitive } from './HarmonyPrimitive';
import { calcTwinsBars, calcFVG, calcRFVG, calcRFVGPositions, calcHBHBHB, calcCompression, calcHBHB } from '../../lib/patterns';
import { createFvgPrimitive } from './FvgPrimitive';
import { createHbhPrimitive } from './HbhPrimitive';
import { createHbhbPrimitive } from './HbhbPrimitive';
import { createCompressionPrimitive } from './CompressionPrimitive';
import { createEquilibriumPrimitive } from './EquilibriumPrimitive';
import { createTradesPrimitive } from './TradesPrimitive';
import DrawingCanvas from './DrawingCanvas';
import TradeSetup    from '../replay/TradeSetup';
import styles from './TradingChart.module.css';

const PREFETCH_THRESHOLD = 50;

// Bottom oscillator pane sizing (fraction of total chart height). Shared by any
// 0-100 indicator that asks for it — RSI, and the EQ balance score.
const RSI_H_DEFAULT = 0.27;
const RSI_H_MIN     = 0.10;
const RSI_H_MAX     = 0.50;
const RSI_BOTTOM    = 0.01; // tiny bottom margin (time scale spacing)

// Fixed -8 → 108 pane scale: ~7% breathing room so a 0-100 line never clips
// against the pane edges.
const OSC_SCALE = () => ({
  priceRange: { minValue: -8, maxValue: 108 },
  margins: { above: 0, below: 0 },
});

const BG_MAIN = '#0B0E17';

function resolveMarker(rawShape, labelText, showLabel) {
  if (rawShape === 'cross') {
    return { shape: 'circle', size: 0, text: showLabel ? `${labelText} ✕` : '✕' };
  }
  return { shape: rawShape, size: null, text: showLabel ? labelText : '' };
}

const MONTHS = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
function fmtTime(t) {
  const d = new Date(t * 1000);
  return `${String(d.getUTCDate()).padStart(2,'0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}  ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
}
function fmtP(v) {
  return v == null ? '—' : parseFloat(v.toFixed(5)).toString();
}
function fmtVol(v) {
  if (!v) return '—';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + ' M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + ' K';
  return Math.round(v).toLocaleString();
}

// ── EQ tooltip block ─────────────────────────────────────────────────────────
// The score is a product of six conditions, so showing it alone would hide the
// only interesting question: which one is failing.
const EQ_COMPS = {
  pull: 'Le point rappelle le prix (retour à la moyenne, hors échantillon)',
  uni:  'Une seule valeur — pas deux distributions concurrentes',
  conc: 'Valeur concentrée — pas étalée le long d\'une tendance',
  flat: 'Aucune dérive nette sur la fenêtre',
  sym:  'Acceptation symétrique de part et d\'autre du point',
  prox: 'Le prix traite au point en ce moment',
};

function EqTooltip({ iv }) {
  const balanced = iv.score >= iv.threshold;
  return (
    <div className={styles.eqBlock}>
      <div className={styles.indRow}>
        <span className={styles.indDot} style={{ background: iv.color }} />
        <span className={styles.indLabel}>{iv.label}</span>
        <span className={styles.indVal}>{fmtP(iv.value)}</span>
      </div>

      <div className={styles.eqScoreRow}>
        <span className={styles.eqScoreVal} style={{ color: balanced ? iv.color : '#64748B' }}>
          {iv.score.toFixed(0)}
        </span>
        <span className={styles.eqTrack}>
          <span
            className={styles.eqFill}
            style={{ width: `${Math.max(0, Math.min(100, iv.score))}%`, background: iv.color, opacity: balanced ? 1 : 0.45 }}
          />
        </span>
        <span className={styles.eqState} style={{ color: balanced ? iv.color : 'rgba(100,116,139,0.7)' }}>
          {balanced ? 'équilibre' : 'hors équilibre'}
        </span>
      </div>

      <div className={styles.eqComps}>
        {Object.entries(iv.comps).map(([k, v]) => (
          <span key={k} className={styles.eqComp} title={EQ_COMPS[k]}>
            <span className={styles.eqCompKey}>{k}</span>
            <span className={styles.eqCompTrack}>
              <span
                className={styles.eqCompFill}
                style={{ width: `${Math.round(v * 100)}%`, background: iv.color, opacity: 0.35 + 0.65 * v }}
              />
            </span>
          </span>
        ))}
      </div>

      <div className={styles.eqVa}>valeur {fmtP(iv.val)} — {fmtP(iv.vah)}</div>
    </div>
  );
}

// Compute LWC scale margins from the RSI height fraction.
// rsi.top = 1 - rsiH so the LWC plot area starts exactly where the drag handle
// sits, keeping the backdrop-filter div and the LWC scale perfectly in sync.
function rsiMargins(rsiH) {
  return {
    rsi:    { top: 1 - rsiH,    bottom: RSI_BOTTOM },
    candle: { top: 0.06,        bottom: rsiH + 0.02 },
  };
}

export default function TradingChart({
  candles, onLoadMore,
  indicators = [],
  htfBars = null,
  patterns = [],
  chartMode = 'candle',
  bullColor = '#26A69A', bearColor = '#EF5350',
  showVolume = true,
  cvdData = null,
  drawings = [], activeTool = null, selectedId = null,
  onDrawingAdd, onDrawingUpdate, onDrawingRemove, onDrawingSelect,
  replayPlaying = false,
  openTrades = [],
  backtestTrades = [],          // trades fermés d'un backtest — dessinés comme des positions
  selectedTradeId = null,
  focusRange = null,            // { from, to } en temps — recadre le graphe (nouvel objet = nouveau recadrage)
  tradeSetupActive = false,
  tradeSetupEntry  = null,
  onTradeSetupConfirm,
  onTradeSetupCancel,
}) {
  const mainRef            = useRef(null);
  const mainWrapRef        = useRef(null);
  const drawingRedrawRef   = useRef(null);
  const registerDrawingRedraw = useCallback((fn) => { drawingRedrawRef.current = fn; }, []);
  const chartRef        = useRef(null);
  const candleSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const maSeriesMapRef      = useRef(new Map());
  const bbSeriesMapRef      = useRef(new Map());
  const swingSeriesMapRef   = useRef(new Map());
  const rsiSeriesMapRef     = useRef(new Map());
  const eqSeriesMapRef      = useRef(new Map());
  const trenderMapRef       = useRef(new Map());
  const patternSeriesMapRef = useRef(new Map());
  const fvgPrimitiveRef         = useRef(null);
  const rfvgPrimitiveRef        = useRef(null);
  const rfvgPosPrimitiveRef     = useRef(null);
  const hbhPrimitiveRef         = useRef(null);
  const hbhbPrimitiveRef        = useRef(null);
  const compressionPrimitiveRef = useRef(null);
  const tradesPrimitiveRef      = useRef(null);
  const appliedFocusRef         = useRef(null);
  const onLoadMoreRef      = useRef(onLoadMore);
  const replayPlayingRef   = useRef(replayPlaying);
  useEffect(() => { onLoadMoreRef.current    = onLoadMore;    }, [onLoadMore]);
  useEffect(() => { replayPlayingRef.current = replayPlaying; }, [replayPlaying]);

  const tradePriceLinesRef = useRef([]);
  const candlesByTimeRef = useRef(new Map());
  const prevCandlesRef   = useRef(null);
  const maDataMapRef     = useRef(new Map());
  const bbDataMapRef     = useRef(new Map());
  const rsiDataMapRef    = useRef(new Map());
  const eqDataMapRef     = useRef(new Map());
  const indicatorsRef    = useRef(indicators);
  useEffect(() => { indicatorsRef.current = indicators; }, [indicators]);

  const [tooltip, setTooltip] = useState(null);
  const tooltipRef = useRef(null);

  // TRENDER : l'HTF le plus lent manque d'historique dans la fenêtre chargée.
  // Sans ça l'indicateur reste muet et l'utilisateur croit à un bug.
  const [trenderWarmup, setTrenderWarmup] = useState(null);

  // ── Screenshot → presse-papier ────────────────────────────────────────────
  const [shotState, setShotState] = useState(null); // null | 'copied' | 'error'
  // Moniteur rFVG : stats des positions simulées (mode « position »), null
  // quand le pattern est éteint ou en représentation zone seule.
  const [rfvgStats, setRfvgStats] = useState(null);
  // Rapport rFVG : mêmes positions que le dessin et le moniteur, gardées pour
  // le téléchargement JSON. Ref et non state : rien à re-rendre, le clic lit
  // simplement la dernière valeur — donc toujours à jour au dernier chargement.
  const rfvgReportRef = useRef(null);
  const shotTimerRef = useRef(null);

  const takeScreenshot = useCallback(async () => {
    const chart = chartRef.current;
    if (!chart) return;
    clearTimeout(shotTimerRef.current);
    try {
      const shot = chart.takeScreenshot(); // canvas LWC (fond transparent)
      const out = document.createElement('canvas');
      out.width  = shot.width;
      out.height = shot.height;
      const ctx = out.getContext('2d');
      ctx.fillStyle = BG_MAIN;            // fond opaque sous le graphe
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(shot, 0, 0);

      // Superpose le calque de dessins s'il existe.
      const overlay = mainWrapRef.current?.querySelector('canvas[data-drawing-layer]');
      if (overlay && overlay.width && overlay.height) {
        ctx.drawImage(overlay, 0, 0, out.width, out.height);
      }

      const blob = await new Promise(res => out.toBlob(res, 'image/png'));
      if (!blob) throw new Error('toBlob a échoué');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setShotState('copied');
    } catch (err) {
      console.error('[screenshot]', err);
      setShotState('error');
    }
    shotTimerRef.current = setTimeout(() => setShotState(null), 1900);
  }, []);

  useEffect(() => () => clearTimeout(shotTimerRef.current), []);

  // RSI pane height as a fraction of total chart height
  const [rsiH, setRsiH]   = useState(RSI_H_DEFAULT);
  const rsiHRef            = useRef(RSI_H_DEFAULT);

  useEffect(() => {
    if (!tooltip) return;
    const handler = (e) => {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target)) setTooltip(null);
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [tooltip]);

  // Anything that wants the bottom 0-100 pane opens it.
  const hasRSI = indicators.some(
    i => i.type === 'RSI' || (i.type === 'EQ' && i.showScore !== false),
  );

  // ── Drag handle: resize RSI pane ─────────────────────────────────────────
  const onHandlePointerDown = useCallback((e) => {
    e.preventDefault();
    const startY  = e.clientY;
    const chartPx = mainWrapRef.current?.offsetHeight ?? 600;
    const startH  = rsiHRef.current;

    const onMove = (ev) => {
      // dragging UP increases RSI height
      const delta = (startY - ev.clientY) / chartPx;
      const newH  = Math.max(RSI_H_MIN, Math.min(RSI_H_MAX, startH + delta));
      rsiHRef.current = newH;
      setRsiH(newH);
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup',   onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup',   onUp);
  }, []);

  // ── Mount chart once ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!mainRef.current) return;

    // Transparent background so DOM background divs show through the canvas.
    const chart = createChart(mainRef.current, {
      width:  mainRef.current.offsetWidth,
      height: mainRef.current.offsetHeight,
      layout: {
        background: { type: 'solid', color: 'rgba(0,0,0,0)' },
        textColor:  '#64748B',
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize:   12,
      },
      grid: {
        vertLines: { color: '#1A2540' },
        horzLines: { color: '#1A2540' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderColor:  '#243155',
        textColor:    '#64748B',
        scaleMargins: { top: 0.06, bottom: 0.22 },
      },
      leftPriceScale: {
        visible:     false,
        borderColor: '#243155',
        textColor:   '#64748B',
      },
      timeScale: {
        borderColor:    '#243155',
        timeVisible:    true,
        secondsVisible: false,
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor:         bullColor,
      downColor:       bearColor,
      borderUpColor:   bullColor,
      borderDownColor: bearColor,
      wickUpColor:     bullColor,
      wickDownColor:   bearColor,
    });

    const volumeSeries = chart.addHistogramSeries({
      priceFormat:  { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    chartRef.current        = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      drawingRedrawRef.current?.();
    });

    let fetchLock = false;
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range || fetchLock || !onLoadMoreRef.current) return;
      if (range.from < PREFETCH_THRESHOLD) {
        fetchLock = true;
        Promise.resolve(onLoadMoreRef.current()).finally(() => {
          setTimeout(() => { fetchLock = false; }, 400);
        });
      }
    });

    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (entry.target === mainWrapRef.current && width && height) {
          chart.applyOptions({ width, height });
        }
      }
    });
    ro.observe(mainWrapRef.current);

    const mainEl = mainRef.current;
    const contextHandler = (e) => {
      e.preventDefault();
      const rect = mainEl.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const time = chart.timeScale().coordinateToTime(x);
      if (!time) { setTooltip(null); return; }

      const candle = candlesByTimeRef.current.get(time);
      if (!candle) { setTooltip(null); return; }

      const flipX = x > (mainEl.offsetWidth ?? 800) * 0.55;

      const indValues = [];
      for (const ind of indicatorsRef.current) {
        if (['SMA','EMA','WMA'].includes(ind.type)) {
          const val = maDataMapRef.current.get(ind.id)?.get(time);
          if (val != null) indValues.push({ type: ind.type, label: `${ind.type}(${ind.period})`, color: ind.color, value: val });
        } else if (ind.type === 'BB') {
          const entry = bbDataMapRef.current.get(ind.id)?.get(time);
          if (entry) indValues.push({ type: 'BB', label: `BB(${ind.period})`, color: ind.color, ...entry });
        } else if (ind.type === 'RSI') {
          const val = rsiDataMapRef.current.get(ind.id)?.get(time);
          if (val != null) indValues.push({ type: 'RSI', label: `RSI(${ind.period})`, color: ind.color, value: val, overbought: ind.overbought ?? 70, oversold: ind.oversold ?? 30 });
        } else if (ind.type === 'EQ') {
          const eq = eqDataMapRef.current.get(ind.id)?.get(time);
          if (eq) indValues.push({
            type: 'EQ', label: `EQ(${ind.lookback ?? 60})`, color: ind.color,
            value: eq.poc, score: eq.score, val: eq.val, vah: eq.vah,
            threshold: ind.threshold ?? 70,
            comps: { pull: eq.pull, uni: eq.uni, conc: eq.conc, flat: eq.flat, sym: eq.sym, prox: eq.prox },
          });
        }
      }
      setTooltip({ x, y, flipX, time, candle, indValues });
    };
    mainEl.addEventListener('contextmenu', contextHandler);

    return () => {
      mainEl.removeEventListener('contextmenu', contextHandler);
      ro.disconnect();
      maSeriesMapRef.current.clear();
      bbSeriesMapRef.current.clear();
      swingSeriesMapRef.current.clear();
      rsiSeriesMapRef.current.clear();
      eqSeriesMapRef.current.clear();
      trenderMapRef.current.clear();
      patternSeriesMapRef.current.clear();
      fvgPrimitiveRef.current  = null;
      rfvgPrimitiveRef.current = null;
      rfvgPosPrimitiveRef.current = null;
      hbhPrimitiveRef.current  = null;
      hbhbPrimitiveRef.current = null;
      compressionPrimitiveRef.current = null;
      tradesPrimitiveRef.current      = null;
      appliedFocusRef.current         = null;
      // Le graphe vient d'être détruit : sans cette remise à zéro, un remontage
      // (StrictMode, ou tout parent qui remonte le composant avec ses bougies
      // déjà chargées) verrait `candles === prevCandles`, croirait à un simple
      // ajout live et n'injecterait que la DERNIÈRE bougie dans un graphe vide.
      prevCandlesRef.current          = null;
      candlesByTimeRef.current.clear();
      maDataMapRef.current.clear();
      bbDataMapRef.current.clear();
      rsiDataMapRef.current.clear();
      eqDataMapRef.current.clear();
      tradePriceLinesRef.current = [];
      chart.remove();
    };
  }, []);

  // ── RSI pane: scale margins + left axis visibility ────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (hasRSI) {
      const m = rsiMargins(rsiH);
      chart.priceScale('right').applyOptions({ scaleMargins: m.candle });
      chart.priceScale('left').applyOptions({
        visible:      true,
        borderColor:  '#243155',
        textColor:    '#64748B',
        scaleMargins: m.rsi,
      });
    } else {
      chart.priceScale('left').applyOptions({ visible: false });
      chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.06, bottom: 0.22 } });
    }
  }, [hasRSI, rsiH]);

  // ── Apply candle colors ───────────────────────────────────────────────────
  useEffect(() => {
    if (!candleSeriesRef.current) return;
    candleSeriesRef.current.applyOptions({
      upColor:         bullColor,
      downColor:       bearColor,
      borderUpColor:   bullColor,
      borderDownColor: bearColor,
      wickUpColor:     bullColor,
      wickDownColor:   bearColor,
    });
  }, [bullColor, bearColor]);

  // ── Show / hide volume ────────────────────────────────────────────────────
  useEffect(() => {
    if (!volumeSeriesRef.current) return;
    volumeSeriesRef.current.applyOptions({ visible: showVolume });
  }, [showVolume]);

  // ── Trade price lines (entry / TP / SL for open trades) ──────────────────
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    // Remove previous lines
    for (const pl of tradePriceLinesRef.current) {
      try { series.removePriceLine(pl); } catch {}
    }
    tradePriceLinesRef.current = [];

    for (const trade of openTrades) {
      const isBuy   = trade.direction === 'BUY';
      const clrBase = isBuy ? '#26A69A' : '#EF5350';

      tradePriceLinesRef.current.push(
        series.createPriceLine({
          price: trade.entryPrice,
          color: clrBase + '80',
          lineStyle: LineStyle.Dashed,
          lineWidth: 1,
          axisLabelVisible: true,
          title: `${trade.direction}`,
        }),
        series.createPriceLine({
          price: trade.tp,
          color: '#26A69A',
          lineStyle: LineStyle.Solid,
          lineWidth: 1,
          axisLabelVisible: true,
          title: 'TP',
        }),
        series.createPriceLine({
          price: trade.sl,
          color: '#EF5350',
          lineStyle: LineStyle.Solid,
          lineWidth: 1,
          axisLabelVisible: true,
          title: 'SL',
        }),
      );
    }
  }, [openTrades]);

  // ── Candle + volume data ──────────────────────────────────────────────────
  const volBar = (c) => ({
    time:  c.time,
    value: c.volume,
    color: c.close >= c.open ? 'rgba(38,166,154,0.45)' : 'rgba(239,83,80,0.45)',
  });

  useEffect(() => {
    if (!candleSeriesRef.current || !candles?.length) return;
    const ts   = chartRef.current.timeScale();
    const prev = prevCandlesRef.current;

    // Mise à jour live (polling) : seul le dernier bucket a changé et/ou des
    // bougies se sont ajoutées à droite → series.update() incrémental.
    // La vue N'EST JAMAIS déplacée : LWC ne décale que si l'utilisateur est
    // déjà collé au bord droit (comportement natif), sinon rien ne bouge.
    const isLiveAppend =
      prev && prev.length > 1 &&
      candles.length >= prev.length &&
      candles[0].time === prev[0].time &&
      candles[prev.length - 1].time === prev[prev.length - 1].time &&
      candles[prev.length - 2].time === prev[prev.length - 2].time;

    if (isLiveAppend) {
      for (let i = prev.length - 1; i < candles.length; i++) {
        const c = candles[i];
        candleSeriesRef.current.update({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close });
        volumeSeriesRef.current.update(volBar(c));
      }
      if (replayPlayingRef.current) ts.scrollToRealTime();
    } else {
      // Rechargement structurel (symbole/TF, prepend d'historique, bascule
      // grouped/candle) : setData complet en préservant la vue courante.
      const prevRange = ts.getVisibleRange();
      candleSeriesRef.current.setData(
        candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })),
      );
      volumeSeriesRef.current.setData(candles.map(volBar));
      if (replayPlayingRef.current) {
        ts.scrollToRealTime();
      } else {
        prevRange ? ts.setVisibleRange(prevRange) : ts.fitContent();
      }
    }

    prevCandlesRef.current   = candles;
    candlesByTimeRef.current = new Map(candles.map(c => [c.time, c]));
  }, [candles]);

  // ── Trades de backtest : positions + marqueurs d'entrée / sortie ──────────
  // Les temps d'un trade ne tombent pas sur des temps de bougie : l'entrée est
  // à l'open d'une bougie TF, mais la sortie est datée à la MINUTE (SL/TP
  // vérifiés M1 par M1). Or le graphe ne sait placer que des temps présents
  // dans ses données — chaque temps est donc ramené à la bougie qui le
  // contient (dernière bougie dont le temps <= t), sans quoi marqueurs et
  // rectangles seraient silencieusement ignorés.
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    const hasTrades = backtestTrades.length > 0 && candles?.length > 0;

    if (!hasTrades) {
      if (tradesPrimitiveRef.current) {
        try { series.detachPrimitive(tradesPrimitiveRef.current); } catch {}
        tradesPrimitiveRef.current = null;
      }
      series.setMarkers([]);
      return;
    }

    const times = candles.map(c => c.time);
    const snap = (t) => {
      if (t <= times[0]) return times[0];
      if (t >= times[times.length - 1]) return times[times.length - 1];
      let lo = 0, hi = times.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (times[mid] <= t) lo = mid; else hi = mid - 1;
      }
      return times[lo];
    };

    const first = times[0];
    const last  = times[times.length - 1];

    const visible = [];
    const markers = [];

    for (const t of backtestTrades) {
      if (t.exitTime < first || t.entryTime > last) continue;   // hors fenêtre chargée
      const entryTime = snap(t.entryTime);
      const exitTime  = snap(t.exitTime);
      visible.push({ ...t, entryTime, exitTime });

      const isBuy = t.direction === 'BUY';
      const win   = (t.profitPoints ?? 0) >= 0;
      markers.push({
        time: entryTime,
        position: isBuy ? 'belowBar' : 'aboveBar',
        shape:    isBuy ? 'arrowUp'  : 'arrowDown',
        color:    isBuy ? '#26A69A'  : '#EF5350',
        text:     `#${t.id}`,
        size:     t.id === selectedTradeId ? 2 : 1,
      });
      markers.push({
        time: exitTime,
        position: isBuy ? 'aboveBar' : 'belowBar',
        shape:    'circle',
        color:    win ? '#26A69A' : '#EF5350',
        text:     t.profitR != null ? `${t.profitR >= 0 ? '+' : ''}${t.profitR.toFixed(1)}R` : '',
        size:     t.id === selectedTradeId ? 2 : 1,
      });
    }

    markers.sort((a, b) => a.time - b.time);   // LWC exige des marqueurs ordonnés

    if (!tradesPrimitiveRef.current) {
      tradesPrimitiveRef.current = createTradesPrimitive();
      series.attachPrimitive(tradesPrimitiveRef.current);
    }
    tradesPrimitiveRef.current.update(visible, selectedTradeId);
    series.setMarkers(markers);
  }, [backtestTrades, selectedTradeId, candles]);

  // ── Recadrage sur demande (un trade choisi dans la liste) ─────────────────
  // focusRange est comparé par IDENTITÉ : un prepend d'historique change
  // `candles` mais ne doit pas re-recadrer, sinon la vue sauterait sous les
  // doigts de l'utilisateur en train de remonter le temps.
  // Application SYNCHRONE : l'effet des bougies, déclaré plus haut, a déjà posé
  // les données de la série sur ce même commit. Différer (requestAnimationFrame)
  // exposait le recadrage à une course — le préchargement d'historique déclenché
  // par fitContent() faisait changer `candles`, le nettoyage annulait l'image
  // différée, et le garde-fou d'identité interdisait toute nouvelle tentative :
  // le recadrage ne se produisait jamais.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !focusRange || !candles?.length) return;
    if (appliedFocusRef.current === focusRange) return;
    try {
      chart.timeScale().setVisibleRange(focusRange);
      appliedFocusRef.current = focusRange;
    } catch {
      /* plage hors données — on retentera au prochain rendu */
    }
  }, [focusRange, candles]);

  // ── MA series ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const maIndicators = indicators.filter(i => ['SMA','EMA','WMA'].includes(i.type));
    const map          = maSeriesMapRef.current;
    const active       = new Set(maIndicators.map(i => i.id));
    for (const [id, series] of map) {
      if (!active.has(id)) { chart.removeSeries(series); map.delete(id); maDataMapRef.current.delete(id); }
    }
    for (const ind of maIndicators) {
      if (!map.has(ind.id)) {
        map.set(ind.id, chart.addLineSeries({
          color: ind.color, lineWidth: 1.5,
          priceLineVisible: false, lastValueVisible: true,
          crosshairMarkerVisible: true, crosshairMarkerRadius: 3,
          title: `${ind.type}(${ind.period})`,
        }));
      } else {
        map.get(ind.id).applyOptions({ color: ind.color, title: `${ind.type}(${ind.period})` });
      }
      const data = candles?.length >= ind.period ? calcMA(candles, ind) : [];
      map.get(ind.id).setData(data);
      maDataMapRef.current.set(ind.id, new Map(data.map(d => [d.time, d.value])));
    }
  }, [candles, indicators]);

  // ── Bollinger Bands ───────────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const bbIndicators = indicators.filter(i => i.type === 'BB');
    const map          = bbSeriesMapRef.current;
    const active       = new Set(bbIndicators.map(i => i.id));
    for (const [id, entry] of map) {
      if (!active.has(id)) {
        chart.removeSeries(entry.upper);
        chart.removeSeries(entry.middle);
        chart.removeSeries(entry.lower);
        map.delete(id);
        bbDataMapRef.current.delete(id);
      }
    }
    for (const ind of bbIndicators) {
      const bandColor = ind.color + 'A0';
      if (!map.has(ind.id)) {
        map.set(ind.id, {
          upper:  chart.addLineSeries({ color: bandColor, lineWidth: 1, lineStyle: LineStyle.Solid,  priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: '' }),
          middle: chart.addLineSeries({ color: ind.color, lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: true,  crosshairMarkerVisible: true, crosshairMarkerRadius: 3, title: `BB(${ind.period})` }),
          lower:  chart.addLineSeries({ color: bandColor, lineWidth: 1, lineStyle: LineStyle.Solid,  priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: '' }),
        });
      } else {
        const entry = map.get(ind.id);
        entry.upper.applyOptions({ color: bandColor });
        entry.middle.applyOptions({ color: ind.color, title: `BB(${ind.period})` });
        entry.lower.applyOptions({ color: bandColor });
      }
      const entry = map.get(ind.id);
      if (candles?.length >= ind.period) {
        const { upper, middle, lower } = calcBB(candles, ind);
        entry.upper.setData(upper);
        entry.middle.setData(middle);
        entry.lower.setData(lower);
        const bbMap = new Map();
        for (let i = 0; i < upper.length; i++) {
          bbMap.set(upper[i].time, { upper: upper[i].value, middle: middle[i].value, lower: lower[i].value });
        }
        bbDataMapRef.current.set(ind.id, bbMap);
      } else {
        entry.upper.setData([]); entry.middle.setData([]); entry.lower.setData([]);
        bbDataMapRef.current.delete(ind.id);
      }
    }
  }, [candles, indicators]);

  // ── Swing High / Low markers ──────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const swingInds = indicators.filter(i => i.type === 'SWING');
    const map       = swingSeriesMapRef.current;
    const active    = new Set(swingInds.map(i => i.id));
    for (const [id, { highSeries, lowSeries }] of map) {
      if (!active.has(id)) { chart.removeSeries(highSeries); chart.removeSeries(lowSeries); map.delete(id); }
    }
    for (const ind of swingInds) {
      if (!map.has(ind.id)) {
        const ghost = { color: 'rgba(0,0,0,0)', lineWidth: 0, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: '' };
        map.set(ind.id, { highSeries: chart.addLineSeries(ghost), lowSeries: chart.addLineSeries(ghost) });
      }
      const { highSeries, lowSeries } = map.get(ind.id);
      const left  = Math.max(1, ind.leftBars  ?? 5);
      const right = Math.max(1, ind.rightBars ?? 5);
      if (!candles?.length || candles.length < left + right + 1) {
        highSeries.setData([]); highSeries.setMarkers([]);
        lowSeries.setData([]);  lowSeries.setMarkers([]);
        continue;
      }
      const { highs, lows } = calcSwings(candles, { leftBars: left, rightBars: right });
      const size  = ind.markerSize ?? 1;
      const label = ind.showLabel !== false;
      const hm = resolveMarker(ind.shapeHigh ?? 'arrowDown', 'SH', label);
      const lm = resolveMarker(ind.shapeLow  ?? 'arrowUp',   'SL', label);
      highSeries.setData(highs);
      highSeries.setMarkers(highs.map(({ time }) => ({ time, position: 'aboveBar', color: ind.highColor ?? '#F59E0B', shape: hm.shape, text: hm.text, size: hm.size !== null ? hm.size : size })));
      lowSeries.setData(lows);
      lowSeries.setMarkers(lows.map(({ time }) => ({ time, position: 'belowBar', color: ind.lowColor ?? '#60A5FA', shape: lm.shape, text: lm.text, size: lm.size !== null ? lm.size : size })));
    }
  }, [candles, indicators]);

  // ── RSI series (left price scale, bottom area of the same chart) ──────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const rsiIndicators = indicators.filter(i => i.type === 'RSI');
    const map           = rsiSeriesMapRef.current;
    const active        = new Set(rsiIndicators.map(i => i.id));
    for (const [id, entry] of map) {
      if (!active.has(id)) { chart.removeSeries(entry.series); map.delete(id); rsiDataMapRef.current.delete(id); }
    }
    for (const ind of rsiIndicators) {
      if (!map.has(ind.id)) {
        const series = chart.addLineSeries({
          priceScaleId:           'left',
          color:                  ind.color,
          lineWidth:              1.5,
          priceLineVisible:       false,
          lastValueVisible:       true,
          crosshairMarkerVisible: true,
          crosshairMarkerRadius:  3,
          title:                  `RSI(${ind.period})`,
          autoscaleInfoProvider:  OSC_SCALE,
        });
        const ob = ind.overbought ?? 70;
        const os = ind.oversold   ?? 30;
        const obLine = series.createPriceLine({ price: ob, color: 'rgba(239,83,80,0.50)',  lineStyle: LineStyle.Dashed, lineWidth: 1, title: String(ob) });
        const osLine = series.createPriceLine({ price: os, color: 'rgba(38,166,154,0.50)', lineStyle: LineStyle.Dashed, lineWidth: 1, title: String(os) });
        series.createPriceLine({ price: 50,  color: 'rgba(100,116,139,0.28)', lineStyle: LineStyle.Dashed, lineWidth: 1, title: '' });
        map.set(ind.id, { series, obLine, osLine });
      } else {
        const entry = map.get(ind.id);
        entry.series.applyOptions({ color: ind.color, title: `RSI(${ind.period})` });
        entry.obLine.applyOptions({ price: ind.overbought ?? 70, title: String(ind.overbought ?? 70) });
        entry.osLine.applyOptions({ price: ind.oversold   ?? 30, title: String(ind.oversold   ?? 30) });
      }
      const data = candles?.length > ind.period ? calcRSI(candles, ind) : [];
      map.get(ind.id).series.setData(data);
      rsiDataMapRef.current.set(ind.id, new Map(data.map(d => [d.time, d.value])));
    }
  }, [candles, indicators]);

  // ── EQ — Equilibrium Point ────────────────────────────────────────────────
  // Three layers per indicator: the point itself as a line whose opacity tracks
  // the balance score, the balance zones / naked POCs as a primitive, and the
  // score as an optional 0-100 line in the bottom pane.
  useEffect(() => {
    const chart  = chartRef.current;
    const series = candleSeriesRef.current;
    if (!chart || !series) return;

    const eqInds = indicators.filter(i => i.type === 'EQ');
    const map    = eqSeriesMapRef.current;
    const active = new Set(eqInds.map(i => i.id));

    for (const [id, entry] of map) {
      if (!active.has(id)) {
        chart.removeSeries(entry.line);
        if (entry.score) chart.removeSeries(entry.score);
        try { series.detachPrimitive(entry.prim); } catch {}
        map.delete(id);
        eqDataMapRef.current.delete(id);
      }
    }

    for (const ind of eqInds) {
      const lookback  = ind.lookback ?? 60;
      const showScore = ind.showScore !== false;
      const title     = `EQ(${lookback})`;

      if (!map.has(ind.id)) {
        const prim = createEquilibriumPrimitive();
        series.attachPrimitive(prim);
        map.set(ind.id, {
          prim,
          // Per-point colour carries the score, so the series colour is only a
          // fallback for the crosshair marker and the price-axis label.
          line: chart.addLineSeries({
            color: ind.color, lineWidth: 2,
            priceLineVisible: false, lastValueVisible: true,
            crosshairMarkerVisible: true, crosshairMarkerRadius: 3,
            title,
          }),
          score: null,
        });
      }
      const entry = map.get(ind.id);
      entry.line.applyOptions({ color: ind.color, title });

      // Score sub-series appears / disappears with the toggle.
      if (showScore && !entry.score) {
        entry.score = chart.addLineSeries({
          priceScaleId: 'left',
          color: ind.color, lineWidth: 1.5,
          priceLineVisible: false, lastValueVisible: true,
          crosshairMarkerVisible: true, crosshairMarkerRadius: 3,
          title: `${title} score`,
          autoscaleInfoProvider: OSC_SCALE,
        });
        entry.thLine = entry.score.createPriceLine({
          price: ind.threshold ?? 70,
          color: 'rgba(167,139,250,0.55)',
          lineStyle: LineStyle.Dashed, lineWidth: 1,
          title: String(ind.threshold ?? 70),
        });
      } else if (!showScore && entry.score) {
        chart.removeSeries(entry.score);
        entry.score = null;
        entry.thLine = null;
      } else if (entry.score) {
        entry.score.applyOptions({ color: ind.color, title: `${title} score` });
        entry.thLine?.applyOptions({
          price: ind.threshold ?? 70,
          title: String(ind.threshold ?? 70),
        });
      }

      if (!candles?.length || candles.length < lookback + 1) {
        entry.line.setData([]);
        entry.score?.setData([]);
        entry.prim.update({ zones: [], nakedPOCs: [] }, {});
        eqDataMapRef.current.delete(ind.id);
        continue;
      }

      const eq = calcEquilibrium(candles, ind);

      entry.line.setData(eq.line);
      entry.score?.setData(eq.score);
      entry.prim.update(
        { zones: eq.zones, nakedPOCs: eq.nakedPOCs },
        {
          color:       ind.color,
          upColor:     ind.upColor    ?? bullColor,
          downColor:   ind.downColor  ?? bearColor,
          nakedColor:  ind.nakedColor ?? '#94A3B8',
          opacity:     ind.opacity    ?? 0.14,
          showProfile: ind.showProfile !== false,
          showNaked:   ind.showNaked   !== false,
          showBreak:   ind.showBreak   !== false,
          showLabel:   ind.showLabel   !== false,
        },
      );
      eqDataMapRef.current.set(ind.id, eq.points);
    }
  }, [candles, indicators, bullColor, bearColor]);

  // ── TRENDER — Harmonie Multi-HTF ──────────────────────────────────────────
  // Fond des zones + trait « ≈ SL » par la primitive ; triangles de début et
  // étiquette du HTF confirmateur par les marqueurs d'une série fantôme ; BB du
  // timeframe courant en trois lignes optionnelles.
  useEffect(() => {
    const chart  = chartRef.current;
    const series = candleSeriesRef.current;
    if (!chart || !series) return;

    const trInds = indicators.filter(i => i.type === 'TRENDER');
    const map    = trenderMapRef.current;
    const active = new Set(trInds.map(i => i.id));
    let warn = null;

    for (const [id, e] of map) {
      if (!active.has(id)) {
        chart.removeSeries(e.marks);
        if (e.bb) { chart.removeSeries(e.bb.upper); chart.removeSeries(e.bb.middle); chart.removeSeries(e.bb.lower); }
        try { series.detachPrimitive(e.prim); } catch {}
        map.delete(id);
      }
    }

    for (const ind of trInds) {
      if (!map.has(ind.id)) {
        const prim = createHarmonyPrimitive();
        series.attachPrimitive(prim);
        map.set(ind.id, {
          prim,
          marks: chart.addLineSeries({
            color: 'rgba(0,0,0,0)', lineWidth: 0,
            priceLineVisible: false, lastValueVisible: false,
            crosshairMarkerVisible: false, title: '',
          }),
          bb: null,
        });
      }
      const e = map.get(ind.id);

      const bull = ind.bullColor ?? '#26A69A';
      const bear = ind.bearColor ?? '#EF5350';

      // Bandes de Bollinger du timeframe courant (réglages séparés du biais HTF)
      const showBbCur = ind.showBbCur !== false;
      if (showBbCur && !e.bb) {
        const c = ind.bbCurColor ?? '#60A5FA';
        e.bb = {
          upper:  chart.addLineSeries({ color: c, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: '' }),
          middle: chart.addLineSeries({ color: c + '70', lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: '' }),
          lower:  chart.addLineSeries({ color: c, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: '' }),
        };
      } else if (!showBbCur && e.bb) {
        chart.removeSeries(e.bb.upper); chart.removeSeries(e.bb.middle); chart.removeSeries(e.bb.lower);
        e.bb = null;
      } else if (e.bb) {
        const c = ind.bbCurColor ?? '#60A5FA';
        e.bb.upper.applyOptions({ color: c });
        e.bb.middle.applyOptions({ color: c + '70' });
        e.bb.lower.applyOptions({ color: c });
      }

      if (!candles?.length) {
        e.prim.update([], {});
        e.marks.setData([]); e.marks.setMarkers([]);
        e.bb?.upper.setData([]); e.bb?.middle.setData([]); e.bb?.lower.setData([]);
        continue;
      }

      const { zones, warmup } = calcHarmony(candles, ind, htfBars);
      warn = warn ?? (warmup?.ok === false ? warmup : null);

      e.prim.update(zones, {
        bullColor: bull,
        bearColor: bear,
        slColor:   ind.slColor  ?? '#EF5350',
        bgTransp:  ind.bgTransp ?? 80,
        showBg:    ind.showBg   !== false,
        showSlLn:  ind.showSlLn !== false,
      });

      // Triangle au début de chaque zone, texte = le ou les HTF confirmateurs
      // (ceux qui ont basculé sur cette bougie et complété l'harmonie).
      if (ind.showMark !== false) {
        const showConf = ind.showConf !== false;
        e.marks.setData(zones.map(z => ({ time: z.startTime, value: z.side === 'bull' ? candles[z.startIdx].low : candles[z.startIdx].high })));
        e.marks.setMarkers(zones.map(z => ({
          time:     z.startTime,
          position: z.side === 'bull' ? 'belowBar' : 'aboveBar',
          color:    z.side === 'bull' ? bull : bear,
          shape:    z.side === 'bull' ? 'arrowUp' : 'arrowDown',
          text:     showConf ? (z.confirm.join(' + ') || '—') : '',
          size:     1,
        })));
      } else {
        e.marks.setData([]); e.marks.setMarkers([]);
      }

      if (e.bb) {
        const { upper, middle, lower } = calcBB(candles, {
          period: ind.bbCurLen ?? 50,
          stdDev: ind.bbCurMult ?? 0.369,
          offset: 0,
          source: 'close',
        });
        e.bb.upper.setData(upper);
        e.bb.middle.setData(middle);
        e.bb.lower.setData(lower);
      }
    }

    setTrenderWarmup(trInds.length ? warn : null);
  }, [candles, indicators, htfBars]);

  // ── Pattern markers ───────────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Zone patterns (FVG, rFVG, HBH/BHB, HBHB/BHBH, COMPRESSION) draw rectangles
    // through their own primitive effects below — only marker patterns land here.
    const active = patterns.filter(p => p.enabled && p.render !== 'zone');
    const map    = patternSeriesMapRef.current;
    const activeTypes = new Set(active.map(p => p.type));

    for (const [type, entry] of map) {
      if (!activeTypes.has(type)) {
        chart.removeSeries(entry.bullSeries);
        chart.removeSeries(entry.bearSeries);
        map.delete(type);
      }
    }

    const ghost = {
      color: 'rgba(0,0,0,0)', lineWidth: 0,
      priceLineVisible: false, lastValueVisible: false,
      crosshairMarkerVisible: false, title: '',
    };

    for (const pat of active) {
      if (!map.has(pat.type)) {
        map.set(pat.type, {
          bullSeries: chart.addLineSeries(ghost),
          bearSeries: chart.addLineSeries(ghost),
        });
      }

      const { bullSeries, bearSeries } = map.get(pat.type);

      if (!candles?.length) {
        bullSeries.setData([]); bullSeries.setMarkers([]);
        bearSeries.setData([]); bearSeries.setMarkers([]);
        continue;
      }

      let detected = [];
      if (pat.type === 'TWINS_BARS') {
        detected = calcTwinsBars(candles, {
          direction:       pat.direction       ?? 'both',
          atrPeriod:       pat.atrPeriod       ?? 7,
          atrMult:         pat.atrMult         ?? 1.6,
          similarityRatio: pat.similarityRatio ?? 0.7,
        });
      }

      const bulls     = detected.filter(d => d.side === 'bull');
      const bears     = detected.filter(d => d.side === 'bear');
      const bullColor = pat.bullColor  ?? '#26A69A';
      const bearColor = pat.bearColor  ?? '#EF5350';
      const size      = pat.markerSize ?? 1;
      const label     = pat.showLabel !== false ? 'TB' : '';

      bullSeries.setData(bulls);
      bullSeries.setMarkers(bulls.map(({ time }) => ({
        time, position: 'belowBar', color: bullColor, shape: 'arrowUp', text: label, size,
      })));

      bearSeries.setData(bears);
      bearSeries.setMarkers(bears.map(({ time }) => ({
        time, position: 'aboveBar', color: bearColor, shape: 'arrowDown', text: label, size,
      })));
    }
  }, [candles, patterns]);

  // ── FVG / iFVG zones (rectangles via series primitive) ─────────────────────
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    const fvg = patterns.find(p => p.type === 'FVG' && p.enabled);

    if (!fvg || !candles?.length) {
      if (fvgPrimitiveRef.current) {
        try { series.detachPrimitive(fvgPrimitiveRef.current); } catch {}
        fvgPrimitiveRef.current = null;
      }
      return;
    }

    if (!fvgPrimitiveRef.current) {
      fvgPrimitiveRef.current = createFvgPrimitive();
      series.attachPrimitive(fvgPrimitiveRef.current);
    }

    const zones = calcFVG(candles, {
      direction:     fvg.direction ?? 'both',
      showMitigated: fvg.showMitigated !== false,
      showInverse:   fvg.showInverse   !== false,
      maxLen:        fvg.maxLen ?? 0,
      minPts:        fvg.minPts    ?? 0,
      atrPeriod:     fvg.atrPeriod ?? 14,
      atrMin:        fvg.atrMin    ?? 0,
      atrMax:        fvg.atrMax    ?? 0,
    });

    fvgPrimitiveRef.current.update(zones, {
      bullColor: fvg.bullColor ?? '#26A69A',
      bearColor: fvg.bearColor ?? '#EF5350',
      opacity:   fvg.opacity   ?? 0.18,
      showLabel: fvg.showLabel !== false,
      labelText: 'FVG',
    });
  }, [candles, patterns]);

  // ── rFVG zones (même primitive que le FVG, autre détection) ────────────────
  // Deux habits, cumulables : la zone classique, et/ou la position simulée
  // (pré-entrée à la clôture de la 3e bougie, SL/TP en points, expiration avec
  // la zone) rendue par la même primitive que les trades du backtest.
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    const rfvg = patterns.find(p => p.type === 'RFVG' && p.enabled);

    const dropZones = () => {
      if (rfvgPrimitiveRef.current) {
        try { series.detachPrimitive(rfvgPrimitiveRef.current); } catch {}
        rfvgPrimitiveRef.current = null;
      }
    };
    const dropPositions = () => {
      if (rfvgPosPrimitiveRef.current) {
        try { series.detachPrimitive(rfvgPosPrimitiveRef.current); } catch {}
        rfvgPosPrimitiveRef.current = null;
      }
    };

    if (!rfvg || !candles?.length) { dropZones(); dropPositions(); setRfvgStats(null); rfvgReportRef.current = null; return; }

    const display = rfvg.display ?? 'zone';
    const detectOpts = {
      mode:      rfvg.mode      ?? 'rfvg',
      direction: rfvg.direction ?? 'both',
      minPts:    rfvg.minPts    ?? 0,
      maPeriod:  rfvg.maPeriod  ?? 50,
      atrPeriod: rfvg.atrPeriod ?? 14,
      atrMult:   rfvg.atrMult   ?? 1.5,
      sizeMode:  rfvg.sizeMode  ?? 'range',
      extLen:    rfvg.extLen    ?? 20,
    };

    if (display === 'position') {
      dropZones();
    } else {
      if (!rfvgPrimitiveRef.current) {
        rfvgPrimitiveRef.current = createFvgPrimitive();
        series.attachPrimitive(rfvgPrimitiveRef.current);
      }
      rfvgPrimitiveRef.current.update(calcRFVG(candles, detectOpts), {
        bullColor: rfvg.bullColor ?? '#26A69A',
        bearColor: rfvg.bearColor ?? '#EF5350',
        opacity:   rfvg.opacity   ?? 0.18,
        showLabel: rfvg.showLabel !== false,
        labelText: 'rFVG',
      });
    }

    if (display === 'zone') {
      dropPositions();
      setRfvgStats(null);
      rfvgReportRef.current = null;
    } else {
      if (!rfvgPosPrimitiveRef.current) {
        rfvgPosPrimitiveRef.current = createTradesPrimitive();
        series.attachPrimitive(rfvgPosPrimitiveRef.current);
      }
      const slPts        = rfvg.slPts        ?? 10;
      const tpPts        = rfvg.tpPts        ?? 10;
      const beTriggerPts = rfvg.beTriggerPts ?? 0;
      const beLevelPts   = rfvg.beLevelPts   ?? 0;
      const posOpts = {
        ...detectOpts,
        slPts, tpPts,
        expiry: rfvg.expiry ?? 20,
        beTriggerPts, beLevelPts,
      };
      const positions = calcRFVGPositions(candles, posOpts);
      rfvgPosPrimitiveRef.current.update(positions, null);

      // Le moniteur suit le même calcul que le dessin : il se met à jour tout
      // seul à chaque chargement de bougies (préchargement d'historique inclus).
      let tp = 0, sl = 0, be = 0, missed = 0, open = 0;
      for (const p of positions) {
        if      (p.status === 'tp')     tp++;
        else if (p.status === 'sl')     sl++;
        else if (p.status === 'be')     be++;
        else if (p.status === 'missed') missed++;
        else                            open++;
      }
      setRfvgStats({ total: positions.length, tp, sl, be, missed, open, slPts, tpPts, beOn: beTriggerPts > 0 });
      rfvgReportRef.current = {
        params: posOpts,
        stats:  { total: positions.length, tp, sl, be, missed, open },
        positions,
      };
    }
  }, [candles, patterns]);

  // Rapport JSON des positions rFVG : recap + excursions (max pullup / max
  // drawdown) par position, pour étudier où placer trailing et break-even.
  const downloadRfvgReport = useCallback(() => {
    const rep = rfvgReportRef.current;
    if (!rep) return;
    const { params, stats, positions } = rep;
    const iso = t => t != null ? new Date(t * 1000).toISOString() : null;
    const r   = pts => pts != null && params.slPts > 0 ? +(pts / params.slPts).toFixed(4) : null;

    const resolved = stats.tp + stats.sl;
    const doc = {
      pattern:     'rFVG — positions simulées (pré-entrée limite à la clôture de la 3e bougie)',
      generatedAt: new Date().toISOString(),
      params,
      stats: {
        ...stats,
        winrate: resolved > 0 ? +(stats.tp / resolved).toFixed(4) : null,
        rr:      params.slPts > 0 ? +(params.tpPts / params.slPts).toFixed(4) : null,
      },
      conventions: {
        unites:        'excursions en points et en R (points / SL)',
        maxPullupPts:  "MFE — plus forte avancée dans le sens de la position, du remplissage à la sortie ; bougie de sortie EXCLUE pour une sortie sur stop ('sl' ou 'be') ; plafonnée au TP",
        maxDrawdownPts:'MAE — plus forte avancée contre la position, bougie de sortie incluse (pessimiste), plafonnée au SL',
        remplissage:   "l'ordre limite n'est pris que si une bougie revient toucher le niveau avant l'expiration ; status 'missed' = jamais pris",
        ambiguite:     'stop et TP touchés dans la même bougie : le stop gagne (pessimiste)',
        breakEven:     "beTriggerPts > 0 : dès que le profit atteint le seuil, stop déplacé à entrée ± beLevelPts ; status 'be' = sortie sur ce stop ; stop et TP testés avant l'activation, sortie au BE si la bougie d'activation a aussi traversé le niveau ; un stop traversé en gap est rempli au pire de l'open",
      },
      positions: positions.map(p => ({
        id:             p.id,
        label:          p.label,
        direction:      p.direction,
        status:         p.status,
        beActivated:    p.beActivated ?? false,
        beDate:         iso(p.beTime),
        entryTime:      p.entryTime,
        entryDate:      iso(p.entryTime),
        fillDate:       iso(p.fillTime),
        exitDate:       iso(p.exitTime),
        barsToFill:     p.barsToFill,
        barsHeld:       p.barsHeld,
        entryPrice:     p.entryPrice,
        exitPrice:      p.exitPrice,
        sl:             p.sl,
        tp:             p.tp,
        profitPoints:   +p.profitPoints.toFixed(6),
        profitR:        r(p.profitPoints),
        maxPullupPts:   p.maxPullupPts   != null ? +p.maxPullupPts.toFixed(6)   : null,
        maxPullupR:     r(p.maxPullupPts),
        maxDrawdownPts: p.maxDrawdownPts != null ? +p.maxDrawdownPts.toFixed(6) : null,
        maxDrawdownR:   r(p.maxDrawdownPts),
      })),
    };

    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `rfvg-rapport-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // ── HBH / BHB zones (rectangles via series primitive) ──────────────────────
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    const hbh = patterns.find(p => p.type === 'HBH_BHB' && p.enabled);

    if (!hbh || !candles?.length) {
      if (hbhPrimitiveRef.current) {
        try { series.detachPrimitive(hbhPrimitiveRef.current); } catch {}
        hbhPrimitiveRef.current = null;
      }
      return;
    }

    if (!hbhPrimitiveRef.current) {
      hbhPrimitiveRef.current = createHbhPrimitive();
      series.attachPrimitive(hbhPrimitiveRef.current);
    }

    const zones = calcHBHBHB(candles, {
      direction: hbh.direction ?? 'both',
      engMult:   hbh.engMult   ?? 1.5,
      extLen:    hbh.extLen    ?? 20,
    });

    hbhPrimitiveRef.current.update(zones, {
      bullColor: hbh.bullColor ?? '#26A69A',
      bearColor: hbh.bearColor ?? '#EF5350',
      opacity:   hbh.opacity   ?? 0.18,
      showMid:   hbh.showMid   !== false,
      showLabel: hbh.showLabel !== false,
    });
  }, [candles, patterns]);

  // ── HBHB / BHBH zones — only rendered in 'grouped' chart mode ──────────────
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    const hbhb = patterns.find(p => p.type === 'HBHB_BHBH' && p.enabled);

    if (!hbhb || !candles?.length || chartMode !== 'grouped') {
      if (hbhbPrimitiveRef.current) {
        try { series.detachPrimitive(hbhbPrimitiveRef.current); } catch {}
        hbhbPrimitiveRef.current = null;
      }
      return;
    }

    if (!hbhbPrimitiveRef.current) {
      hbhbPrimitiveRef.current = createHbhbPrimitive();
      series.attachPrimitive(hbhbPrimitiveRef.current);
    }

    const zones = calcHBHB(candles, {
      direction: hbhb.direction ?? 'both',
      bodyMult:  hbhb.bodyMult  ?? 1.5,
      extLen:    hbhb.extLen    ?? 20,
    });

    hbhbPrimitiveRef.current.update(zones, {
      bullColor: hbhb.bullColor ?? '#26A69A',
      bearColor: hbhb.bearColor ?? '#EF5350',
      opacity:   hbhb.opacity   ?? 0.18,
      showLabel: hbhb.showLabel !== false,
    });
  }, [candles, patterns, chartMode]);

  // ── Compression / Squeeze zones (rectangles + breakout arrow via primitive) ─
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    const sqz = patterns.find(p => p.type === 'COMPRESSION' && p.enabled);

    if (!sqz || !candles?.length) {
      if (compressionPrimitiveRef.current) {
        try { series.detachPrimitive(compressionPrimitiveRef.current); } catch {}
        compressionPrimitiveRef.current = null;
      }
      return;
    }

    if (!compressionPrimitiveRef.current) {
      compressionPrimitiveRef.current = createCompressionPrimitive();
      series.attachPrimitive(compressionPrimitiveRef.current);
    }

    const zones = calcCompression(candles, {
      mode:          sqz.mode          ?? 'atr',
      // ATR-flat method
      atrPeriod:     sqz.atrPeriod     ?? 14,
      flatTol:       sqz.flatTol       ?? 0.12,
      breakMult:     sqz.breakMult     ?? 1.8,
      // TTM Squeeze method
      length:        sqz.length        ?? 20,
      bbMult:        sqz.bbMult        ?? 2,
      kcMult:        sqz.kcMult         ?? 1.5,
      // shared
      minLength:     sqz.minLength     ?? 6,
      extendToBreak: sqz.extendToBreak !== false,
    });

    compressionPrimitiveRef.current.update(zones, {
      upColor:      sqz.upColor      ?? '#26A69A',
      downColor:    sqz.downColor    ?? '#EF5350',
      neutralColor: sqz.neutralColor ?? '#64748B',
      opacity:      sqz.opacity      ?? 0.18,
      showLabel:    sqz.showLabel    !== false,
      showArrow:    sqz.showArrow    !== false,
    });
  }, [candles, patterns]);

  // ── Shared style for the drag-handle dots ─────────────────────────────────
  const dotStyle = { width: 3, height: 3, borderRadius: '50%', background: '#4A5568' };

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      <div
        ref={mainWrapRef}
        style={{ position: 'relative', flex: 1, minHeight: 0, background: BG_MAIN }}
      >
        {/* LWC chart canvas (transparent background — mainWrapRef background shows through) */}
        <div ref={mainRef} style={{ position: 'absolute', inset: 0 }} />

        {/* Bouton capture d'écran → presse-papier */}
        <button
          onClick={takeScreenshot}
          title="Capturer le graphe (copié dans le presse-papier)"
          aria-label="Capturer le graphe"
          style={{
            position: 'absolute', top: 10, right: 14, zIndex: 11,
            display: 'flex', alignItems: 'center', gap: 6,
            height: 30, padding: shotState ? '0 11px' : '0 9px',
            borderRadius: 999,
            border: `1px solid ${shotState === 'error' ? 'rgba(239,83,80,0.5)' : 'rgba(167,139,250,0.35)'}`,
            background: shotState === 'copied'
              ? 'rgba(38,166,154,0.16)'
              : shotState === 'error'
                ? 'rgba(239,83,80,0.14)'
                : 'rgba(13,18,32,0.72)',
            color: shotState === 'copied' ? '#34D399' : shotState === 'error' ? '#EF5350' : '#C4B5FD',
            cursor: 'pointer',
            fontSize: 11, fontWeight: 700, fontFamily: 'Inter, system-ui, sans-serif',
            letterSpacing: '0.03em',
            backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
            transition: 'background 150ms, color 150ms, border-color 150ms',
          }}
        >
          {shotState === 'copied' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          )}
          {shotState === 'copied' ? 'Copié' : shotState === 'error' ? 'Échec' : 'Capture'}
        </button>

        {/* Rapport JSON des positions rFVG — le clic lit rfvgReportRef, mis à
            jour par l'effet à chaque chargement de bougies : toujours à jour. */}
        {rfvgStats && (
          <button
            onClick={downloadRfvgReport}
            title="Télécharger le rapport JSON des positions rFVG (recap, max pullup, max drawdown)"
            aria-label="Télécharger le rapport des positions rFVG"
            style={{
              position: 'absolute', top: 10, right: 118, zIndex: 11,
              display: 'flex', alignItems: 'center', gap: 6,
              height: 30, padding: '0 11px',
              borderRadius: 999,
              border: '1px solid rgba(251,146,60,0.4)',
              background: 'rgba(13,18,32,0.72)',
              color: '#FB923C',
              cursor: 'pointer',
              fontSize: 11, fontWeight: 700, fontFamily: 'Inter, system-ui, sans-serif',
              letterSpacing: '0.03em',
              backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
              boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="M7 10l5 5 5-5" />
              <path d="M12 15V3" />
            </svg>
            Rapports
          </button>
        )}

        {/* Moniteur rFVG : stats des positions simulées sur les bougies
            chargées. Alimenté par l'effet rFVG, donc recalculé automatiquement
            à chaque chargement. Winrate sur les positions résolues (TP + SL),
            comparé au seuil de rentabilité du RR : au-dessus vert, en dessous
            rouge. */}
        {rfvgStats && (() => {
          const { total, tp, sl, be = 0, missed, open, slPts, tpPts, beOn = false } = rfvgStats;
          const showBe = beOn || be > 0;
          const rr       = slPts > 0 ? tpPts / slPts : null;
          const resolved = tp + sl;
          const wr       = resolved > 0 ? tp / resolved : null;
          const beThresh = rr != null ? 1 / (1 + rr) : null;
          const wrColor  = wr == null || beThresh == null ? '#94A3B8' : wr >= beThresh ? '#26A69A' : '#EF5350';
          const row = { display: 'flex', justifyContent: 'space-between', gap: 14, fontSize: 11, lineHeight: '15px' };
          const key = { color: 'rgba(148,163,184,0.85)', fontWeight: 500 };
          return (
            <div
              style={{
                position: 'absolute', top: 10, left: 14, zIndex: 11,
                display: 'flex', flexDirection: 'column', gap: 3,
                minWidth: 172, padding: '9px 12px 10px', borderRadius: 10,
                border: '1px solid rgba(251,146,60,0.35)',
                background: 'rgba(13,18,32,0.78)',
                backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
                color: '#E2E8F0', fontFamily: 'Inter, system-ui, sans-serif',
                boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
                pointerEvents: 'none',
              }}
            >
              <div style={{ ...row, marginBottom: 3 }}>
                <span style={{ color: '#FB923C', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em' }}>
                  rFVG — POSITIONS
                </span>
                <span style={{ color: 'rgba(148,163,184,0.85)', fontWeight: 600 }}>{total}</span>
              </div>
              <div style={row}>
                <span style={key}>{showBe ? 'TP / BE / SL' : 'TP / SL'}</span>
                <span style={{ fontWeight: 700 }}>
                  <span style={{ color: '#26A69A' }}>{tp}</span>
                  {showBe && (
                    <>
                      <span style={{ color: 'rgba(148,163,184,0.6)' }}> / </span>
                      <span style={{ color: '#F59E0B' }}>{be}</span>
                    </>
                  )}
                  <span style={{ color: 'rgba(148,163,184,0.6)' }}> / </span>
                  <span style={{ color: '#EF5350' }}>{sl}</span>
                </span>
              </div>
              <div style={row}>
                <span style={key}>Winrate</span>
                <span style={{ color: wrColor, fontWeight: 700 }}>
                  {wr == null ? '—' : `${(wr * 100).toFixed(1)} %`}
                </span>
              </div>
              <div style={row}>
                <span style={key}>RR (seuil BE)</span>
                <span style={{ fontWeight: 600 }}>
                  {rr == null ? '—' : rr.toFixed(2)}
                  {beThresh != null && (
                    <span style={{ color: 'rgba(148,163,184,0.7)', fontWeight: 500 }}> ({(beThresh * 100).toFixed(0)} %)</span>
                  )}
                </span>
              </div>
              {(missed > 0 || open > 0) && (
                <div style={row}>
                  <span style={key}>Ratées / ouvertes</span>
                  <span style={{ color: '#94A3B8', fontWeight: 600 }}>{missed} / {open}</span>
                </div>
              )}
            </div>
          );
        })()}

        {/* TRENDER : historique HTF insuffisant. L'harmonie stricte exige les 3
            HTF alignés ; tant que la Bollinger du plus lent n'a pas démarré, sa
            tendance vaut 0 et AUCUNE zone ne peut exister. Sans ce message, le
            graphe reste vide sans raison apparente. */}
        {trenderWarmup && (
          <div
            style={{
              position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
              zIndex: 12, display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 13px', borderRadius: 999,
              border: '1px solid rgba(245,158,11,0.4)',
              background: 'rgba(20,15,5,0.88)',
              backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
              color: '#FCD34D', fontSize: 11.5, fontWeight: 600,
              fontFamily: 'Inter, system-ui, sans-serif',
              boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
            }}
          >
            <span style={{ fontSize: 13 }}>⚠</span>
            <span>
              TRENDER — historique insuffisant en {trenderWarmup.htf} :{' '}
              <strong>{trenderWarmup.have}</strong> bougies chargées sur{' '}
              <strong>{trenderWarmup.need}</strong>. Fais défiler vers la gauche pour en charger,
              ou choisis une unité de temps plus courte.
            </span>
          </div>
        )}

        {/* RSI area overlay: darkens + suppresses grid lines via backdrop-filter.
            Placed ABOVE canvas (z-index 1) with pointer-events off.
            brightness(0.38) makes grid lines nearly invisible on the dark bg. */}
        {hasRSI && (
          <div
            style={{
              position:            'absolute',
              left:                0,
              right:               0,
              bottom:              0,
              height:              `${rsiH * 100}%`,
              backdropFilter:      'brightness(0.38)',
              WebkitBackdropFilter:'brightness(0.38)',
              pointerEvents:       'none',
              zIndex:              1,
            }}
          />
        )}

        {/* Drag handle between candle area and RSI area */}
        {hasRSI && (
          <div
            onPointerDown={onHandlePointerDown}
            style={{
              position:       'absolute',
              left:           0,
              right:          0,
              bottom:         `${rsiH * 100}%`,
              height:         6,
              cursor:         'ns-resize',
              background:     '#1A2540',
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'center',
              zIndex:         2,
              userSelect:     'none',
              transition:     'background 120ms',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#243155'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#1A2540'; }}
          >
            {[0,1,2,3,4].map(i => (
              <div key={i} style={{ ...dotStyle, marginLeft: i ? 3 : 0 }} />
            ))}
          </div>
        )}

        {onDrawingAdd && (
          <DrawingCanvas
            chartRef={chartRef}
            seriesRef={candleSeriesRef}
            containerRef={mainWrapRef}
            drawings={drawings}
            activeTool={activeTool}
            selectedId={selectedId}
            onDrawingAdd={onDrawingAdd}
            onDrawingUpdate={onDrawingUpdate}
            onDrawingRemove={onDrawingRemove}
            onDrawingSelect={onDrawingSelect}
            candles={candles}
            onRedrawTrigger={registerDrawingRedraw}
          />
        )}

        {tradeSetupActive && tradeSetupEntry != null && (
          <TradeSetup
            chartRef={chartRef}
            seriesRef={candleSeriesRef}
            containerRef={mainWrapRef}
            entryPrice={tradeSetupEntry}
            onConfirm={onTradeSetupConfirm}
            onCancel={onTradeSetupCancel}
          />
        )}
      </div>

      {/* ── Candle tooltip ──────────────────────────────────────────────── */}
      {tooltip && (
        <div
          ref={tooltipRef}
          className={styles.tooltip}
          style={{
            left:      tooltip.flipX ? tooltip.x - 8  : tooltip.x + 14,
            top:       Math.max(4, tooltip.y - 20),
            transform: tooltip.flipX ? 'translateX(-100%)' : 'none',
          }}
        >
          <div className={styles.ttHeader}>
            <span className={styles.ttDate}>{fmtTime(tooltip.time)}</span>
            <button className={styles.ttClose} onClick={() => setTooltip(null)}>×</button>
          </div>
          <div className={styles.ohlcGrid}>
            {[['O', fmtP(tooltip.candle.open)],['H', fmtP(tooltip.candle.high)],['L', fmtP(tooltip.candle.low)],['C', fmtP(tooltip.candle.close)]].map(([k, v]) => (
              <div key={k} className={styles.ohlcRow}>
                <span className={styles.ohlcKey}>{k}</span>
                <span className={styles.ohlcVal} style={k === 'H' ? { color: '#26A69A' } : k === 'L' ? { color: '#EF5350' } : k === 'C' ? { color: tooltip.candle.close >= tooltip.candle.open ? '#26A69A' : '#EF5350' } : undefined}>{v}</span>
              </div>
            ))}
          </div>
          {tooltip.candle.volume != null && (
            <div className={styles.volRow}>Vol  {fmtVol(tooltip.candle.volume)}</div>
          )}
          {(() => {
            const cv = cvdData?.get(tooltip.time);
            if (!cv) return null;
            const fmtD = (n) => (n >= 0 ? '+' : '') + n.toLocaleString();
            return (
              <>
                <hr className={styles.ttDivider} />
                <div className={styles.cvdGrid}>
                  {[['Ask ↑', cv.upTicks.toLocaleString(), '#26A69A'],['Bid ↓', cv.downTicks.toLocaleString(), '#EF5350'],['Δ bar', fmtD(cv.delta), cv.delta >= 0 ? '#26A69A' : '#EF5350'],['CVD', fmtD(cv.cvd), cv.cvd >= 0 ? '#26A69A' : '#EF5350']].map(([k, v, c]) => (
                    <div key={k} className={styles.cvdRow}>
                      <span className={styles.cvdKey}>{k}</span>
                      <span className={styles.cvdVal} style={{ color: c }}>{v}</span>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
          {tooltip.indValues.length > 0 && (
            <>
              <hr className={styles.ttDivider} />
              {tooltip.indValues.map((iv, i) => iv.type === 'EQ' ? (
                <EqTooltip key={i} iv={iv} />
              ) : (
                <div key={i} className={styles.indRow}>
                  <span className={styles.indDot} style={{ background: iv.color }} />
                  <span className={styles.indLabel}>{iv.label}</span>
                  {iv.type === 'BB' ? (
                    <span className={styles.bbVals}>
                      <span>↑{fmtP(iv.upper)}</span>
                      <span className={styles.bbSep}>─</span>
                      <span>{fmtP(iv.middle)}</span>
                      <span className={styles.bbSep}>─</span>
                      <span>↓{fmtP(iv.lower)}</span>
                    </span>
                  ) : (
                    <span
                      className={styles.indVal}
                      style={iv.type === 'RSI' ? {
                        color: iv.value >= iv.overbought ? '#EF5350' : iv.value <= iv.oversold ? '#26A69A' : undefined,
                      } : undefined}
                    >
                      {iv.type === 'RSI' ? iv.value.toFixed(2) : fmtP(iv.value)}
                    </span>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
