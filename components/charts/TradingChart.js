import { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, CrosshairMode, LineStyle } from 'lightweight-charts';
import { calcMA, calcRSI, calcBB, calcSwings } from '../../lib/indicators';
import DrawingCanvas from './DrawingCanvas';
import styles from './TradingChart.module.css';

const PREFETCH_THRESHOLD = 50;

// RSI pane sizing (fraction of total chart height)
const RSI_H_DEFAULT = 0.27;
const RSI_H_MIN     = 0.10;
const RSI_H_MAX     = 0.50;
const RSI_BOTTOM    = 0.01; // tiny bottom margin (time scale spacing)

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
  bullColor = '#26A69A', bearColor = '#EF5350',
  showVolume = true,
  cvdData = null,
  drawings = [], activeTool = null, selectedId = null,
  onDrawingAdd, onDrawingUpdate, onDrawingRemove, onDrawingSelect,
}) {
  const mainRef            = useRef(null);
  const mainWrapRef        = useRef(null);
  const drawingRedrawRef   = useRef(null);
  const registerDrawingRedraw = useCallback((fn) => { drawingRedrawRef.current = fn; }, []);
  const chartRef        = useRef(null);
  const candleSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const maSeriesMapRef    = useRef(new Map());
  const bbSeriesMapRef    = useRef(new Map());
  const swingSeriesMapRef = useRef(new Map());
  const rsiSeriesMapRef   = useRef(new Map());
  const onLoadMoreRef     = useRef(onLoadMore);
  useEffect(() => { onLoadMoreRef.current = onLoadMore; }, [onLoadMore]);

  const candlesByTimeRef = useRef(new Map());
  const maDataMapRef     = useRef(new Map());
  const bbDataMapRef     = useRef(new Map());
  const rsiDataMapRef    = useRef(new Map());
  const indicatorsRef    = useRef(indicators);
  useEffect(() => { indicatorsRef.current = indicators; }, [indicators]);

  const [tooltip, setTooltip] = useState(null);
  const tooltipRef = useRef(null);

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

  const hasRSI = indicators.some(i => i.type === 'RSI');

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
      candlesByTimeRef.current.clear();
      maDataMapRef.current.clear();
      bbDataMapRef.current.clear();
      rsiDataMapRef.current.clear();
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

  // ── Candle + volume data ──────────────────────────────────────────────────
  useEffect(() => {
    if (!candleSeriesRef.current || !candles?.length) return;
    const ts        = chartRef.current.timeScale();
    const prevRange = ts.getVisibleRange();
    candleSeriesRef.current.setData(
      candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })),
    );
    volumeSeriesRef.current.setData(
      candles.map(({ time, open, close, volume }) => ({
        time,
        value: volume,
        color: close >= open ? 'rgba(38,166,154,0.45)' : 'rgba(239,83,80,0.45)',
      })),
    );
    prevRange ? ts.setVisibleRange(prevRange) : ts.fitContent();
    candlesByTimeRef.current = new Map(candles.map(c => [c.time, c]));
  }, [candles]);

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
          // Fixed bounds with internal vertical margin so the line never touches edges.
          // Force a fixed scale -8 → 108 so the RSI line has ~7% breathing room
          // above RSI=100 and below RSI=0, and never clips against pane edges.
          autoscaleInfoProvider: () => ({
            priceRange: { minValue: -8, maxValue: 108 },
            margins: { above: 0, below: 0 },
          }),
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
              {tooltip.indValues.map((iv, i) => (
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
