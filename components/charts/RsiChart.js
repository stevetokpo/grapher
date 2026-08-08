// Le graphe du laboratoire de la corne.
//
// Il ne fait que trois choses de plus qu'un tracé de RSI, mais ce sont les trois
// qui comptent pour comprendre un motif qu'on ne sait pas encore décrire :
//
//   • SURVOL — passer sur une jambe affiche les mesures de la pointe concernée
//     (durées, pentes, rapport de pointe, rembobinage). C'est l'outil de lecture :
//     on regarde une corne, on voit ses chiffres.
//   • TRACÉ DE LA CORNE — les deux jambes de la pointe survolée sont surlignées,
//     ce qui montre NOIR SUR BLANC ce que la mesure a découpé. Si le découpage
//     est faux, ça se voit immédiatement au lieu de polluer les chiffres.
//   • MARQUAGE — en mode « marquer », un clic aimante sur la pointe la plus
//     proche et l'envoie au cahier d'échantillons, exemple ou contre-exemple.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, LineStyle } from 'lightweight-charts';
import { RULE_LABELS } from '../../lib/rsi/features';

const BG = '#0B0E17';
const PREFETCH_THRESHOLD = 50;
const FIRST_VIEW_BARS = 180;   // densité d'ouverture — voir l'effet des données

const MONTHS = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
function fmtTime(t) {
  const d = new Date(t * 1000);
  return `${String(d.getUTCDate()).padStart(2,'0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}  ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
}

export default function RsiChart({
  series,                 // [{ time, value }] — le RSI, prêt pour setData
  horns = [],             // mesures de chaque pointe (retenues ET refusées)
  samples = [],           // échantillons déjà marqués, pour les pastilles
  onLoadMore,
  overbought, oversold, color,
  mode = 'explore',       // 'explore' | 'mark'
  markLabel = 'oui',
  showCandidates = true,
  focusTime = null,       // recentrer le graphe sur cette pointe
  onMarkClick,            // (time) => void
}) {
  const containerRef  = useRef(null);
  const chartRef      = useRef(null);
  const seriesRef     = useRef(null);
  const legRef        = useRef(null);      // surlignage des deux jambes
  const obLineRef     = useRef(null);
  const osLineRef     = useRef(null);
  const midLineRef    = useRef(null);
  const onLoadMoreRef = useRef(onLoadMore);
  const onMarkRef     = useRef(onMarkClick);
  const modeRef       = useRef(mode);
  const hornsRef      = useRef(horns);

  useEffect(() => { onLoadMoreRef.current = onLoadMore; }, [onLoadMore]);
  useEffect(() => { onMarkRef.current     = onMarkClick; }, [onMarkClick]);
  useEffect(() => { modeRef.current       = mode; }, [mode]);
  useEffect(() => { hornsRef.current      = horns; }, [horns]);

  const [tooltip, setTooltip] = useState(null);
  const [hovered, setHovered] = useState(null);   // la corne sous le curseur

  // Index temps → corne : on retient la pointe dont le tracé (jambe lente +
  // jambe brutale) couvre l'instant survolé, la plus courte d'abord — deux
  // cornes qui se chevauchent, c'est la plus serrée qu'on veut lire.
  const hornAt = useMemo(() => {
    const list = [...horns].sort((a, b) =>
      (a.timeEnd - a.timeStart) - (b.timeEnd - b.timeStart));
    return t => list.find(h => t >= h.timeStart && t <= h.timeEnd) ?? null;
  }, [horns]);

  // Le handler de survol est posé une fois pour toutes au montage : il lit
  // l'index des cornes par une ref, sinon il resterait collé au premier jeu.
  const hornAtRef = useRef(hornAt);
  useEffect(() => { hornAtRef.current = hornAt; }, [hornAt]);

  // ── Montage du graphe ───────────────────────────────────────────────────
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

    const rsiSeries = chart.addLineSeries({
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

    // Surlignage des jambes de la corne survolée — trois points : départ de la
    // montée, pointe, fin de la chute.
    const legSeries = chart.addLineSeries({
      color:                  '#FBBF24',
      lineWidth:              2,
      lineStyle:              LineStyle.Dotted,
      priceLineVisible:       false,
      lastValueVisible:       false,
      crosshairMarkerVisible: false,
      pointMarkersVisible:    true,
      autoscaleInfoProvider:  () => null,
    });

    chartRef.current  = chart;
    seriesRef.current = rsiSeries;
    legRef.current    = legSeries;

    chart.subscribeCrosshairMove(param => {
      if (!param.point || !param.time || !containerRef.current) {
        setTooltip(null); setHovered(null);
        return;
      }
      const dataPoint = param.seriesData.get(rsiSeries);
      if (dataPoint == null) { setTooltip(null); setHovered(null); return; }

      const w     = containerRef.current.offsetWidth;
      const flipX = param.point.x > w * 0.62;

      setTooltip({ x: param.point.x, y: param.point.y, value: dataPoint.value, time: param.time, flipX });
      setHovered(hornAtRef.current(param.time));
    });

    // Marquage : le clic remonte tel quel, c'est la page qui décide quoi en faire.
    chart.subscribeClick(param => {
      if (modeRef.current !== 'mark' || !param.time) return;
      onMarkRef.current?.(param.time);
    });

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
      chartRef.current = seriesRef.current = legRef.current = null;
    };
  }, []);

  useEffect(() => { seriesRef.current?.applyOptions({ color }); }, [color]);

  // ── Niveaux surachat / survente / 50 ────────────────────────────────────
  useEffect(() => {
    const s = seriesRef.current;
    if (!s) return;

    for (const ref of [obLineRef, osLineRef, midLineRef]) {
      if (ref.current) { try { s.removePriceLine(ref.current); } catch {} ref.current = null; }
    }

    obLineRef.current = s.createPriceLine({
      price: overbought, color: 'rgba(239,83,80,0.55)',
      lineStyle: LineStyle.Dashed, lineWidth: 1,
      axisLabelVisible: true, title: String(overbought),
    });
    osLineRef.current = s.createPriceLine({
      price: oversold, color: 'rgba(38,166,154,0.55)',
      lineStyle: LineStyle.Dashed, lineWidth: 1,
      axisLabelVisible: true, title: String(oversold),
    });
    midLineRef.current = s.createPriceLine({
      price: 50, color: 'rgba(100,116,139,0.28)',
      lineStyle: LineStyle.Dashed, lineWidth: 1,
      axisLabelVisible: false, title: '',
    });
  }, [overbought, oversold]);

  // ── Données ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const s = seriesRef.current, chart = chartRef.current;
    if (!s || !chart) return;

    const ts = chart.timeScale();
    const prevRange = ts.getVisibleRange();
    s.setData(series ?? []);

    if (prevRange && series?.length) { ts.setVisibleRange(prevRange); return; }

    // Première ouverture : surtout PAS fitContent. Un RSI 7 sur mille bougies est
    // une pelote — or ce qu'on vient lire ici, c'est la FORME d'une pointe. On
    // ouvre donc sur les dernières bougies, à une densité où une corne se voit.
    const n = series?.length ?? 0;
    if (!n) return;
    if (n > FIRST_VIEW_BARS) ts.setVisibleLogicalRange({ from: n - FIRST_VIEW_BARS, to: n });
    else ts.fitContent();
  }, [series]);

  // ── Pastilles : échantillons marqués + candidats du détecteur ───────────
  useEffect(() => {
    const s = seriesRef.current;
    if (!s) return;

    const marks = [];

    if (showCandidates) {
      for (const h of horns) {
        if (!h.ok) continue;
        marks.push({
          time:     h.timePeak,
          position: h.side === 'bear' ? 'aboveBar' : 'belowBar',
          color:    '#FBBF24',
          shape:    h.side === 'bear' ? 'arrowDown' : 'arrowUp',
          text:     '',
        });
      }
    }

    for (const smp of samples) {
      marks.push({
        time:     smp.time,
        position: smp.side === 'bear' ? 'aboveBar' : 'belowBar',
        color:    smp.label === 'oui' ? '#34D399' : '#EF5350',
        shape:    'circle',
        text:     smp.label === 'oui' ? 'C' : '×',
      });
    }

    marks.sort((a, b) => a.time - b.time);
    s.setMarkers(marks);
  }, [horns, samples, showCandidates]);

  // ── Tracé des jambes de la corne survolée ───────────────────────────────
  useEffect(() => {
    const leg = legRef.current;
    if (!leg) return;
    if (!hovered) { leg.setData([]); return; }
    leg.setData([
      { time: hovered.timeStart, value: hovered.levelStart },
      { time: hovered.timePeak,  value: hovered.level },
      { time: hovered.timeEnd,   value: hovered.levelEnd },
    ]);
    leg.applyOptions({ color: hovered.ok ? '#FBBF24' : '#64748B' });
  }, [hovered]);

  // ── Recentrage sur un échantillon choisi dans le panneau ────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !focusTime || !series?.length) return;
    const i = series.findIndex(p => p.time >= focusTime);
    if (i < 0) return;
    const half = 60;
    chart.timeScale().setVisibleRange({
      from: series[Math.max(0, i - half)].time,
      to:   series[Math.min(series.length - 1, i + half)].time,
    });
  }, [focusTime, series]);

  const ttColor = tooltip == null ? color
    : tooltip.value >= overbought ? '#EF5350'
    : tooltip.value <= oversold   ? '#26A69A'
    : color;

  return (
    <div style={{
      position: 'relative', width: '100%', height: '100%', background: BG,
      cursor: mode === 'mark' ? 'crosshair' : 'default',
    }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {mode === 'mark' && (
        <div style={{
          position: 'absolute', top: 10, left: 12, zIndex: 11,
          padding: '4px 10px', borderRadius: 999, pointerEvents: 'none',
          fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
          background: markLabel === 'oui' ? 'rgba(52,211,153,0.14)' : 'rgba(239,83,80,0.14)',
          border: `1px solid ${markLabel === 'oui' ? 'rgba(52,211,153,0.45)' : 'rgba(239,83,80,0.45)'}`,
          color: markLabel === 'oui' ? '#34D399' : '#EF5350',
        }}>
          {markLabel === 'oui' ? 'CLIC = CORNE' : 'CLIC = CONTRE-EXEMPLE'}
        </div>
      )}

      {tooltip && (
        <div style={{
          position:      'absolute',
          left:          tooltip.flipX ? tooltip.x - 10 : tooltip.x + 14,
          top:           Math.max(6, tooltip.y - 38),
          transform:     tooltip.flipX ? 'translateX(-100%)' : 'none',
          pointerEvents: 'none',
          zIndex:        10,
          background:    'rgba(9,12,22,0.94)',
          border:        `1px solid ${ttColor}40`,
          borderRadius:  8,
          padding:       '6px 12px',
          backdropFilter:'blur(8px)',
          boxShadow:     `0 4px 16px rgba(0,0,0,0.55), 0 0 0 1px ${ttColor}18`,
          minWidth:      hovered ? 210 : 90,
        }}>
          <div style={{
            fontFamily: 'var(--font-mono, monospace)', fontSize: 20, fontWeight: 800,
            color: ttColor, letterSpacing: '0.02em', lineHeight: 1,
            textShadow: `0 0 12px ${ttColor}80`,
          }}>
            {tooltip.value.toFixed(2)}
          </div>
          <div style={{ fontSize: 10, color: '#475569', marginTop: 5, letterSpacing: '0.03em' }}>
            {fmtTime(tooltip.time)}
          </div>

          {hovered && <HornReadout h={hovered} />}
        </div>
      )}
    </div>
  );
}

// Les mesures de la pointe survolée, dans l'ordre où on les lit : la montée
// lente, la chute brutale, puis les rapports qui font la corne.
function HornReadout({ h }) {
  const accent = h.ok ? '#FBBF24' : '#64748B';
  return (
    <div style={{ marginTop: 8, borderTop: '1px solid #1A2540', paddingTop: 7, fontSize: 10.5 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6,
        color: accent, fontWeight: 700, letterSpacing: '0.05em', fontSize: 9.5,
      }}>
        {h.side === 'bear' ? 'CORNE' : 'CORNE INVERSÉE'}
        {h.ok && <span style={{ color: '#FBBF24' }}>· RETENUE</span>}
        {/* Le premier critère qui a sauté, nommé comme dans la barre d'outils :
            « hors seuils » ne dit pas lequel resserrer. */}
        {!h.ok && (
          <span style={{ color: '#475569' }}>
            · recalée : {RULE_LABELS[h.fails?.[0]] ?? h.fails?.[0] ?? 'hors seuils'}
          </span>
        )}
      </div>
      <Row k="montée"        v={`${h.riseBars} b · ${h.riseAmp} pts`} />
      <Row k="chute"         v={`${h.dropBars} b · ${h.dropAmp} pts`} />
      <Row k="pointe ×"      v={fmtNum(h.sharpness)} hi />
      <Row k="rembobinage"   v={`${h.rewindBars} b · ${fmtNum(h.rewindPerBar)}/b`} hi />
      <Row k="retour"        v={`${Math.round(h.retrace * 100)} %`} />
      <Row k="régularité"    v={`${fmtNum(h.riseEff)} ↗ / ${fmtNum(h.dropEff)} ↘`} />
      <Row k="1re bougie"    v={`${Math.round(h.firstShare * 100)} % de la chute`} />
    </div>
  );
}

function Row({ k, v, hi }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, lineHeight: 1.7 }}>
      <span style={{ color: '#475569' }}>{k}</span>
      <span style={{
        color: hi ? '#E2E8F0' : '#94A3B8',
        fontFamily: 'var(--font-mono, monospace)',
        fontWeight: hi ? 700 : 500,
      }}>{v}</span>
    </div>
  );
}

function fmtNum(v) {
  if (v == null || !Number.isFinite(v)) return '∞';
  return v.toFixed(2);
}
