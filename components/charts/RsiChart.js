import { useEffect, useRef, useState } from 'react';
import { createChart, LineStyle } from 'lightweight-charts';
import { calcRSI } from '../../lib/indicators';

const BG = '#0B0E17';
const PREFETCH_THRESHOLD = 50;

const MONTHS = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
function fmtTime(t) {
  const d = new Date(t * 1000);
  return `${String(d.getUTCDate()).padStart(2,'0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}  ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
}

export default function RsiChart({ candles, onLoadMore, period, overbought, oversold, color }) {
  const containerRef    = useRef(null);
  const wrapRef         = useRef(null);
  const chartRef        = useRef(null);
  const seriesRef       = useRef(null);
  const obLineRef       = useRef(null);
  const osLineRef       = useRef(null);
  const midLineRef      = useRef(null);
  const onLoadMoreRef   = useRef(onLoadMore);
  const overboughtRef   = useRef(overbought);
  const oversoldRef     = useRef(oversold);

  useEffect(() => { onLoadMoreRef.current = onLoadMore; }, [onLoadMore]);
  useEffect(() => { overboughtRef.current = overbought; }, [overbought]);
  useEffect(() => { oversoldRef.current   = oversold;   }, [oversold]);

  const [tooltip, setTooltip] = useState(null);

  // ── Mount chart once ────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width:  containerRef.current.offsetWidth,
      height: containerRef.current.offsetHeight,
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
      crosshair: { mode: 1 },
      rightPriceScale: {
        borderColor:  '#243155',
        textColor:    '#64748B',
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor:    '#243155',
        timeVisible:    true,
        secondsVisible: false,
      },
    });

    const series = chart.addLineSeries({
      lineWidth:              1.5,
      priceLineVisible:       false,
      lastValueVisible:       true,
      pointMarkersVisible:    true,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius:  4,
      autoscaleInfoProvider: () => ({
        priceRange: { minValue: -2, maxValue: 102 },
        margins: { above: 0, below: 0 },
      }),
    });

    chartRef.current  = chart;
    seriesRef.current = series;

    // ── Crosshair tooltip ───────────────────────────────────────
    chart.subscribeCrosshairMove(param => {
      if (!param.point || !param.time || !containerRef.current) {
        setTooltip(null);
        return;
      }
      const dataPoint = param.seriesData.get(series);
      if (dataPoint == null) { setTooltip(null); return; }

      const w    = containerRef.current.offsetWidth;
      const flipX = param.point.x > w * 0.65;

      setTooltip({
        x:     param.point.x,
        y:     param.point.y,
        value: dataPoint.value,
        time:  param.time,
        flipX,
      });
    });

    // ── Load more on scroll left ────────────────────────────────
    let fetchLock = false;
    chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
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
        if (width && height) chart.applyOptions({ width, height });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, []);

  // ── Update line color ───────────────────────────────────────────
  useEffect(() => {
    seriesRef.current?.applyOptions({ color });
  }, [color]);

  // ── Update OB / OS / mid price lines ───────────────────────────
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    if (obLineRef.current)  { try { series.removePriceLine(obLineRef.current);  } catch {} }
    if (osLineRef.current)  { try { series.removePriceLine(osLineRef.current);  } catch {} }
    if (midLineRef.current) { try { series.removePriceLine(midLineRef.current); } catch {} }

    obLineRef.current = series.createPriceLine({
      price: overbought, color: 'rgba(239,83,80,0.55)',
      lineStyle: LineStyle.Dashed, lineWidth: 1,
      axisLabelVisible: true, title: String(overbought),
    });
    osLineRef.current = series.createPriceLine({
      price: oversold, color: 'rgba(38,166,154,0.55)',
      lineStyle: LineStyle.Dashed, lineWidth: 1,
      axisLabelVisible: true, title: String(oversold),
    });
    midLineRef.current = series.createPriceLine({
      price: 50, color: 'rgba(100,116,139,0.28)',
      lineStyle: LineStyle.Dashed, lineWidth: 1,
      axisLabelVisible: false, title: '',
    });
  }, [overbought, oversold]);

  // ── Update RSI data when candles or period change ───────────────
  useEffect(() => {
    const series = seriesRef.current;
    const chart  = chartRef.current;
    if (!series || !chart) return;

    if (!candles?.length || candles.length <= period) {
      series.setData([]);
      return;
    }

    const ts        = chart.timeScale();
    const prevRange = ts.getVisibleRange();
    series.setData(calcRSI(candles, { period, source: 'close' }));
    prevRange ? ts.setVisibleRange(prevRange) : ts.fitContent();
  }, [candles, period]);

  // ── Derive tooltip color from OB/OS levels ──────────────────────
  const ttColor = tooltip == null ? color
    : tooltip.value >= overbought ? '#EF5350'
    : tooltip.value <= oversold   ? '#26A69A'
    : color;

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', height: '100%', background: BG }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {tooltip && (
        <div style={{
          position:      'absolute',
          left:          tooltip.flipX ? tooltip.x - 10 : tooltip.x + 14,
          top:           Math.max(6, tooltip.y - 38),
          transform:     tooltip.flipX ? 'translateX(-100%)' : 'none',
          pointerEvents: 'none',
          zIndex:        10,
          background:    'rgba(9,12,22,0.92)',
          border:        `1px solid ${ttColor}40`,
          borderRadius:  8,
          padding:       '6px 12px',
          backdropFilter:'blur(8px)',
          boxShadow:     `0 4px 16px rgba(0,0,0,0.55), 0 0 0 1px ${ttColor}18`,
          minWidth:      90,
        }}>
          <div style={{
            fontFamily:    'var(--font-mono, monospace)',
            fontSize:      20,
            fontWeight:    800,
            color:         ttColor,
            letterSpacing: '0.02em',
            lineHeight:    1,
            textShadow:    `0 0 12px ${ttColor}80`,
          }}>
            {tooltip.value.toFixed(2)}
          </div>
          <div style={{
            fontSize:      10,
            color:         '#475569',
            marginTop:     5,
            letterSpacing: '0.03em',
            fontFamily:    'var(--font, sans-serif)',
          }}>
            {fmtTime(tooltip.time)}
          </div>
        </div>
      )}
    </div>
  );
}
