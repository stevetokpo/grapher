import { useEffect, useRef, useCallback } from 'react';
import { fmtTimeHM } from '../../lib/format';

// ── Layout constants ───────────────────────────────────────────────────────
const BAR_W_DEFAULT      = 130;
const BAR_W_MIN          = 40;
const BAR_W_MAX          = 380;
const PRICE_W            = 80;
const TIME_H             = 26;
const HEADER_H           = 20;   // per-bar info strip at top of each column
const PAD                = 3;
const PREFETCH_THRESHOLD = 4;
const ZOOM_FACTOR        = 0.88;
const imbalanceRatio_DEFAULT = 3;

const C = {
  bg:      '#0B0E17',
  surface: '#0D1220',
  border:  '#1A2540',
  border2: '#243155',
  bull:    '#26A69A',
  bear:    '#EF5350',
  amber:   '#F59E0B',
  text:    '#E2E8F0',
  muted:   '#64748B',
  dim:     '#475569',
  ghost:   '#374151',
  blue:    '#60A5FA',
};

const FONT    = '10px Inter, system-ui, sans-serif';
const FONT_SM = '9px Inter, system-ui, sans-serif';
const FONT_XS = '8px Inter, system-ui, sans-serif';

function fmtPx(n) {
  if (n == null) return '';
  return n >= 1000 ? n.toFixed(2) : n >= 1 ? n.toFixed(3) : n.toFixed(5);
}

function niceTick(range, count) {
  const rough = range / count;
  const exp   = Math.floor(Math.log10(rough));
  const frac  = rough / 10 ** exp;
  const nice  = frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10;
  return nice * 10 ** exp;
}

// ── Component ──────────────────────────────────────────────────────────────
export default function FootprintChart({
  bars,
  tickSize        = 5,
  onLoadMore,
  loadingMore     = false,
  hasMore         = true,
  imbalanceRatio  = imbalanceRatio_DEFAULT,
}) {
  const canvasRef = useRef(null);
  const dprRef    = useRef(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  const dimsRef   = useRef({ w: 0, h: 0 });

  // ── View state ─────────────────────────────────────────────────────────
  const scrollRef      = useRef(null);
  const barWidthRef    = useRef(BAR_W_DEFAULT);
  const priceOffsetRef = useRef(0);
  const priceZoomRef   = useRef(1);
  const pricePerPxRef  = useRef(0);

  // ── Prop refs ──────────────────────────────────────────────────────────
  const barsRef            = useRef(bars);
  const tickSizeRef        = useRef(tickSize);
  const imbalanceRatioRef  = useRef(imbalanceRatio);
  const loadingMoreRef     = useRef(loadingMore);
  const onLoadMoreRef      = useRef(onLoadMore);
  const hasMoreRef       = useRef(hasMore);
  barsRef.current           = bars;
  tickSizeRef.current       = tickSize;
  imbalanceRatioRef.current = imbalanceRatio;
  loadingMoreRef.current    = loadingMore;
  onLoadMoreRef.current     = onLoadMore;
  hasMoreRef.current        = hasMore;

  const prevFirstTimeRef = useRef(null);
  const fetchLockRef     = useRef(false);

  // ── Stable draw ────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx      = canvas.getContext('2d');
    const dpr      = dprRef.current;
    const { w: W, h: H } = dimsRef.current;
    const bars            = barsRef.current;
    const tickSize        = tickSizeRef.current;
    const imbalanceRatio  = imbalanceRatioRef.current;
    const barW            = barWidthRef.current;

    if (!W || !H) return;

    const drawW = W - PRICE_W;
    const drawH = H - TIME_H;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    if (!bars?.length) {
      ctx.fillStyle    = C.ghost;
      ctx.font         = FONT;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No tick data for this symbol', drawW / 2, drawH / 2);
      ctx.restore();
      return;
    }

    // ── Horizontal scroll clamping ────────────────────────────────────
    const totalW    = bars.length * barW;
    const maxScroll = Math.max(0, totalW - drawW);
    if (scrollRef.current === null) scrollRef.current = maxScroll;
    scrollRef.current = Math.max(0, Math.min(scrollRef.current, maxScroll));
    const sx = scrollRef.current;

    // ── Visible bars ──────────────────────────────────────────────────
    const startIdx = Math.max(0, Math.floor(sx / barW));
    const endIdx   = Math.min(bars.length, startIdx + Math.ceil(drawW / barW) + 2);
    const visible  = bars.slice(startIdx, endIdx);

    // ── Auto price range ──────────────────────────────────────────────
    let rawMin = Infinity, rawMax = -Infinity, maxAbsDelta = 1;
    for (const bar of visible) {
      rawMin = Math.min(rawMin, bar.low);
      rawMax = Math.max(rawMax, bar.high);
      for (const lv of bar.levels) maxAbsDelta = Math.max(maxAbsDelta, Math.abs(lv.delta));
    }
    if (rawMin === Infinity) { ctx.restore(); return; }

    const autoPad    = Math.max(tickSize, (rawMax - rawMin) * 0.04);
    const autoCenter = (rawMax + rawMin) / 2;
    const autoHalf   = (rawMax - rawMin) / 2 + autoPad;

    const center = autoCenter + priceOffsetRef.current;
    const half   = autoHalf   / priceZoomRef.current;
    const pMin   = center - half;
    const pMax   = center + half;

    pricePerPxRef.current = (pMax - pMin) / drawH;

    const priceToY = (p) => ((pMax - p) / (pMax - pMin)) * drawH;

    // ── Grid lines ────────────────────────────────────────────────────
    const step      = niceTick(pMax - pMin, 8);
    const gridStart = Math.ceil(pMin / step) * step;

    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, drawW, drawH); ctx.clip();
    ctx.strokeStyle = C.border;
    ctx.lineWidth   = 1;
    for (let p = gridStart; p <= pMax; p += step) {
      const y = Math.round(priceToY(p)) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(drawW, y); ctx.stroke();
    }
    ctx.restore();

    // ── Footprint bars ────────────────────────────────────────────────
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, drawW, drawH); ctx.clip();

    visible.forEach((bar, i) => {
      const bx = startIdx * barW + i * barW - sx;
      if (bx + barW < 0 || bx > drawW) return;

      const cx        = bx + barW / 2;
      const isUp      = bar.close >= bar.open;
      const bodyColor = isUp ? C.bull : C.bear;

      // Column separator
      ctx.strokeStyle = C.border;
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.moveTo(bx, HEADER_H); ctx.lineTo(bx, drawH); ctx.stroke();

      // ── Price-level cells ─────────────────────────────────────────
      for (const lv of bar.levels) {
        const cellTop = Math.max(HEADER_H, priceToY(lv.price + tickSize));
        const cellBot = Math.min(drawH, priceToY(lv.price));
        const cellH   = Math.max(1, cellBot - cellTop);
        const ty      = cellTop + cellH / 2;

        // sells = downTicks (left), buys = upTicks (right) — standard footprint convention
        const sellVal = lv.downTicks;
        const buyVal  = lv.upTicks;
        const isPOC   = lv.price === bar.pocPrice;

        // Background fill — delta direction + intensity
        const t = Math.min(1, Math.abs(lv.delta) / maxAbsDelta);
        const baseAlpha = isPOC ? 0.22 : 0.06;
        ctx.fillStyle = lv.delta > 0
          ? `rgba(38,166,154,${baseAlpha + t * 0.38})`
          : lv.delta < 0
            ? `rgba(239,83,80,${baseAlpha + t * 0.38})`
            : 'rgba(255,255,255,0.02)';
        ctx.fillRect(bx + 1, cellTop, barW - 2, cellH);

        // Cell border (POC gets amber border)
        ctx.strokeStyle = isPOC ? 'rgba(245,158,11,0.55)' : 'rgba(255,255,255,0.04)';
        ctx.lineWidth   = isPOC ? 1.0 : 0.5;
        ctx.strokeRect(bx + 1, cellTop, barW - 2, cellH);

        if (cellH >= 10) {
          ctx.textBaseline = 'middle';

          // LEFT = sells (down_ticks)
          ctx.font      = FONT;
          ctx.fillStyle = sellVal > buyVal ? C.bear : C.muted;
          ctx.textAlign = 'left';
          ctx.fillText(sellVal, bx + PAD + 2, ty);

          // RIGHT = buys (up_ticks)
          ctx.fillStyle = buyVal > sellVal ? C.bull : C.muted;
          ctx.textAlign = 'right';
          ctx.fillText(buyVal, bx + barW - PAD - 2, ty);

          // CENTER = delta (when bar wide enough)
          if (barW >= 100) {
            ctx.fillStyle = lv.delta > 0 ? C.bull : lv.delta < 0 ? C.bear : C.ghost;
            ctx.textAlign = 'center';
            ctx.fillText(lv.delta > 0 ? `+${lv.delta}` : String(lv.delta), cx, ty);
          }

          // Imbalance markers — when one side ≥ RATIO × the other
          if (cellH >= 12 && barW >= 60) {
            if (sellVal > 0 && buyVal / sellVal >= imbalanceRatio) {
              // Buyers overwhelm — draw green marker on right
              ctx.font      = FONT_XS;
              ctx.fillStyle = 'rgba(38,166,154,0.90)';
              ctx.textAlign = 'right';
              ctx.fillText('▲', bx + barW - 1, ty);
            } else if (buyVal > 0 && sellVal / buyVal >= imbalanceRatio) {
              // Sellers overwhelm — draw red marker on left
              ctx.font      = FONT_XS;
              ctx.fillStyle = 'rgba(239,83,80,0.90)';
              ctx.textAlign = 'left';
              ctx.fillText('▼', bx, ty);
            }
            ctx.font = FONT;
          }
        }
      }

      // POC amber border on top (drawn after all cells to overlay cell borders)
      if (bar.pocPrice != null) {
        const pocTop = Math.max(HEADER_H, priceToY(bar.pocPrice + tickSize));
        const pocBot = Math.min(drawH, priceToY(bar.pocPrice));
        const pocH   = Math.max(1, pocBot - pocTop);
        ctx.strokeStyle = C.amber;
        ctx.lineWidth   = 1.5;
        ctx.strokeRect(bx + 1, pocTop, barW - 2, pocH);

        // POC label dot (inside cell, right-aligned)
        if (pocH >= 10 && barW >= 80) {
          ctx.font         = FONT_XS;
          ctx.fillStyle    = C.amber;
          ctx.textAlign    = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText('◆', bx + barW - 3, pocTop + Math.min(pocH / 2, 6));
        }
      }

      // Wick + body outline
      ctx.strokeStyle = bodyColor;
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(cx, priceToY(bar.high));
      ctx.lineTo(cx, priceToY(bar.low));
      ctx.stroke();

      const y1 = Math.min(priceToY(bar.open), priceToY(bar.close));
      const y2 = Math.max(priceToY(bar.open), priceToY(bar.close));
      ctx.strokeRect(bx + barW * 0.3, y1, barW * 0.4, Math.max(1, y2 - y1));

      // ── Per-bar header strip (time + cumulative delta) ─────────────
      const bd = bar.barDelta ?? bar.levels.reduce((s, l) => s + l.delta, 0);
      if (barW >= 60) {
        // Dark background strip
        ctx.fillStyle = 'rgba(11,14,23,0.84)';
        ctx.fillRect(bx + 1, 0, barW - 2, HEADER_H);

        ctx.font         = FONT_SM;
        ctx.textBaseline = 'middle';
        const hMid = HEADER_H / 2;

        // Time label
        ctx.fillStyle = C.dim;
        ctx.textAlign = 'left';
        ctx.fillText(fmtTimeHM(bar.time), bx + 4, hMid);

        // Cumulative delta
        ctx.fillStyle = bd > 0 ? C.bull : bd < 0 ? C.bear : C.ghost;
        ctx.textAlign = 'right';
        ctx.fillText(bd > 0 ? `Δ+${bd}` : `Δ${bd}`, bx + barW - 4, hMid);

        // Total ticks (when barW is wide enough)
        if (barW >= 160 && bar.barTotal != null) {
          ctx.fillStyle = C.ghost;
          ctx.textAlign = 'center';
          ctx.fillText(`${bar.barTotal}T`, cx, hMid);
        }

        // Separator line
        ctx.strokeStyle = C.border2;
        ctx.lineWidth   = 0.5;
        ctx.beginPath();
        ctx.moveTo(bx + 1, HEADER_H);
        ctx.lineTo(bx + barW - 1, HEADER_H);
        ctx.stroke();
      }
    });

    // Rightmost bar separator
    const lastBx = startIdx * barW + visible.length * barW - sx;
    if (lastBx <= drawW) {
      ctx.strokeStyle = C.border;
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.moveTo(lastBx, HEADER_H); ctx.lineTo(lastBx, drawH); ctx.stroke();
    }

    ctx.restore();

    // ── Left-edge overlays ────────────────────────────────────────────
    if (loadingMoreRef.current) {
      ctx.save();
      ctx.fillStyle    = 'rgba(96,165,250,0.80)';
      ctx.font         = '11px Inter, system-ui, sans-serif';
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('Chargement…', 10, HEADER_H + 6);
      ctx.restore();
    } else if (!hasMoreRef.current && bars.length > 0 && sx < barW) {
      ctx.save();
      ctx.strokeStyle = 'rgba(96,165,250,0.30)';
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(2, HEADER_H); ctx.lineTo(2, drawH); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle    = 'rgba(96,165,250,0.55)';
      ctx.font         = '10px Inter, system-ui, sans-serif';
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText("← Début de l'historique", 8, HEADER_H + 6);
      ctx.restore();
    }

    // ── Zoom/reset hint ───────────────────────────────────────────────
    const isModified = priceOffsetRef.current !== 0 || priceZoomRef.current !== 1;
    if (isModified) {
      ctx.save();
      ctx.fillStyle    = 'rgba(148,163,184,0.40)';
      ctx.font         = '10px Inter, system-ui, sans-serif';
      ctx.textAlign    = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText('Double-clic : réinitialiser la vue', drawW - 8, HEADER_H + 6);
      ctx.restore();
    }

    // ── Legend (bottom-left, subtle) ──────────────────────────────────
    if (bars.length > 0 && drawW > 300) {
      ctx.save();
      ctx.font         = FONT_XS;
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle    = C.ghost;
      ctx.fillText('gauche: ventes · droite: achats · ◆: POC · ▲▼: déséquilibre 3:1', 8, drawH - 4);
      ctx.restore();
    }

    // ── Price axis ────────────────────────────────────────────────────
    ctx.fillStyle   = C.surface;
    ctx.fillRect(drawW, 0, PRICE_W, drawH);
    ctx.strokeStyle = C.border2;
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(drawW + 0.5, 0); ctx.lineTo(drawW + 0.5, drawH); ctx.stroke();

    ctx.font         = FONT;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = C.dim;
    for (let p = gridStart; p <= pMax; p += step) {
      const y = priceToY(p);
      if (y < 2 || y > drawH - 2) continue;
      ctx.fillText(fmtPx(p), drawW + 6, Math.round(y));
    }

    // ── Time axis ─────────────────────────────────────────────────────
    ctx.fillStyle   = C.surface;
    ctx.fillRect(0, drawH, W, TIME_H);
    ctx.strokeStyle = C.border2;
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(0, drawH + 0.5); ctx.lineTo(W, drawH + 0.5); ctx.stroke();

    ctx.font         = FONT;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = C.dim;
    visible.forEach((bar, i) => {
      const bx = startIdx * barW + i * barW - sx;
      if (bx + barW / 2 < 0 || bx + barW / 2 > drawW) return;
      ctx.fillText(fmtTimeHM(bar.time), bx + barW / 2, drawH + TIME_H / 2);
    });

    ctx.restore();
  }, []);

  // ── Load-more trigger ──────────────────────────────────────────────────
  const maybeLoadMore = useCallback(() => {
    if (fetchLockRef.current || loadingMoreRef.current || !hasMoreRef.current) return;
    if (!onLoadMoreRef.current) return;
    if (scrollRef.current !== null && scrollRef.current < PREFETCH_THRESHOLD * barWidthRef.current) {
      fetchLockRef.current = true;
      Promise.resolve(onLoadMoreRef.current()).finally(() => {
        setTimeout(() => { fetchLockRef.current = false; }, 600);
      });
    }
  }, []);

  // ── Mouse wheel ────────────────────────────────────────────────────────
  const onWheel = useCallback((e) => {
    e.preventDefault();
    const { w: W } = dimsRef.current;
    const drawW    = W - PRICE_W;

    if (e.ctrlKey) {
      const factor  = e.deltaY > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
      const oldBarW = barWidthRef.current;
      const newBarW = Math.max(BAR_W_MIN, Math.min(BAR_W_MAX, oldBarW * factor));
      const centerPx  = (scrollRef.current ?? 0) + drawW / 2;
      const centerBar = centerPx / oldBarW;
      scrollRef.current = centerBar * newBarW - drawW / 2;
      barWidthRef.current = newBarW;
      draw();
      return;
    }

    if (e.shiftKey) {
      priceOffsetRef.current -= pricePerPxRef.current * e.deltaY * 1.2;
      draw();
      return;
    }

    if (e.altKey) {
      const factor = e.deltaY > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
      priceZoomRef.current = Math.max(0.15, Math.min(50, priceZoomRef.current * factor));
      draw();
      return;
    }

    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (scrollRef.current === null) scrollRef.current = 0;
    scrollRef.current += delta * 1.8;
    draw();
    maybeLoadMore();
  }, [draw, maybeLoadMore]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  // ── Arrow keys ─────────────────────────────────────────────────────────
  const onKeyDown = useCallback((e) => {
    const barW = barWidthRef.current;
    switch (e.key) {
      case 'ArrowLeft':
        if (scrollRef.current !== null) scrollRef.current -= barW;
        draw(); maybeLoadMore(); break;
      case 'ArrowRight':
        if (scrollRef.current !== null) scrollRef.current += barW;
        draw(); break;
      case 'ArrowUp':
        priceOffsetRef.current += pricePerPxRef.current * 40;
        draw(); break;
      case 'ArrowDown':
        priceOffsetRef.current -= pricePerPxRef.current * 40;
        draw(); break;
      case '+': case '=': {
        const factor  = 1 / ZOOM_FACTOR;
        const oldBarW = barW;
        const { w: W } = dimsRef.current;
        const newBarW = Math.max(BAR_W_MIN, Math.min(BAR_W_MAX, oldBarW * factor));
        const cx = (scrollRef.current ?? 0) + (W - PRICE_W) / 2;
        scrollRef.current = (cx / oldBarW) * newBarW - (W - PRICE_W) / 2;
        barWidthRef.current = newBarW;
        draw(); break;
      }
      case '-': {
        const factor  = ZOOM_FACTOR;
        const oldBarW = barW;
        const { w: W } = dimsRef.current;
        const newBarW = Math.max(BAR_W_MIN, Math.min(BAR_W_MAX, oldBarW * factor));
        const cx = (scrollRef.current ?? 0) + (W - PRICE_W) / 2;
        scrollRef.current = (cx / oldBarW) * newBarW - (W - PRICE_W) / 2;
        barWidthRef.current = newBarW;
        draw(); break;
      }
      default: return;
    }
    e.preventDefault();
  }, [draw, maybeLoadMore]);

  // ── Double-click → reset vertical view ────────────────────────────────
  const onDblClick = useCallback(() => {
    priceOffsetRef.current = 0;
    priceZoomRef.current   = 1;
    draw();
  }, [draw]);

  // ── Bars update: initial load vs. prepend ──────────────────────────────
  useEffect(() => {
    if (!bars?.length) {
      scrollRef.current        = null;
      prevFirstTimeRef.current = null;
      priceOffsetRef.current   = 0;
      priceZoomRef.current     = 1;
      draw();
      return;
    }

    const firstTime = bars[0].time;
    const prevFirst = prevFirstTimeRef.current;

    if (prevFirst !== null && firstTime !== prevFirst) {
      const added = bars.findIndex(b => b.time === prevFirst);
      if (added > 0 && scrollRef.current !== null) {
        scrollRef.current += added * barWidthRef.current;
      }
    }

    prevFirstTimeRef.current = firstTime;
    draw();
  }, [bars, draw]);

  // ── tickSize change: reset view ────────────────────────────────────────
  useEffect(() => {
    scrollRef.current        = null;
    prevFirstTimeRef.current = null;
    priceOffsetRef.current   = 0;
    priceZoomRef.current     = 1;
  }, [tickSize]);

  // ── Redraw on loadingMore change ───────────────────────────────────────
  useEffect(() => { draw(); }, [loadingMore, draw]);

  // ── Responsive canvas ─────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;

    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      dimsRef.current = { w: width, h: height };
      canvas.width    = Math.round(width  * dpr);
      canvas.height   = Math.round(height * dpr);
      draw();
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', display: 'block', outline: 'none' }}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onDoubleClick={onDblClick}
      aria-label="Footprint chart — scroll: pan · Ctrl+scroll: zoom horiz · Shift+scroll: pan prix · Alt+scroll: zoom prix · double-clic: reset vue"
    />
  );
}
