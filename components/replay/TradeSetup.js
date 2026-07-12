import { useState, useEffect, useRef } from 'react';
import { fmtPrice } from '../../lib/format';
import styles from './TradeSetup.module.css';

// Défauts TP/SL en % du prix d'entrée : indépendant de l'échelle de
// l'instrument (forex ~1.0 comme indice synthétique ~300 000).
// 0,20 % / 0,10 % ≈ l'ancien 20/10 pips sur une paire cotée autour de 1.0.
const DEFAULT_TP_PCT = 0.002;
const DEFAULT_SL_PCT = 0.001;

export default function TradeSetup({
  chartRef,
  seriesRef,
  containerRef,
  entryPrice,
  onConfirm,
  onCancel,
}) {
  const [direction, setDirection] = useState('BUY');
  const [panelTp,   setPanelTp]   = useState(() => entryPrice * (1 + DEFAULT_TP_PCT));
  const [panelSl,   setPanelSl]   = useState(() => entryPrice * (1 - DEFAULT_SL_PCT));
  const [error,     setError]     = useState(null);

  // Prices tracked in refs so drag handlers don't go stale
  const tpRef = useRef(entryPrice * (1 + DEFAULT_TP_PCT));
  const slRef = useRef(entryPrice * (1 - DEFAULT_SL_PCT));

  // DOM refs for direct manipulation (avoids re-renders during drag)
  const tpLineRef    = useRef(null);
  const slLineRef    = useRef(null);
  const entryLineRef = useRef(null);
  const tpFillRef    = useRef(null);
  const slFillRef    = useRef(null);
  const tpPriceRef   = useRef(null);
  const slPriceRef   = useRef(null);

  // rAF loop: sync line y-positions to chart price scale without triggering React renders
  useEffect(() => {
    let rafId;
    const tick = () => {
      const series = seriesRef.current;
      if (series) {
        const ye = series.priceToCoordinate(entryPrice)    ?? 0;
        const yt = series.priceToCoordinate(tpRef.current) ?? 0;
        const ys = series.priceToCoordinate(slRef.current) ?? 0;

        if (tpLineRef.current)    tpLineRef.current.style.top    = `${yt}px`;
        if (slLineRef.current)    slLineRef.current.style.top    = `${ys}px`;
        if (entryLineRef.current) entryLineRef.current.style.top = `${ye}px`;

        if (tpFillRef.current) {
          tpFillRef.current.style.top    = `${Math.min(ye, yt)}px`;
          tpFillRef.current.style.height = `${Math.abs(ye - yt)}px`;
        }
        if (slFillRef.current) {
          slFillRef.current.style.top    = `${Math.min(ye, ys)}px`;
          slFillRef.current.style.height = `${Math.abs(ye - ys)}px`;
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [entryPrice, seriesRef]);

  const handleTpMouseDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const container = containerRef.current;
    const series    = seriesRef.current;
    if (!container || !series) return;

    const onMove = (ev) => {
      const rect  = container.getBoundingClientRect();
      const price = series.coordinateToPrice(ev.clientY - rect.top);
      if (price == null) return;
      tpRef.current = price;
      if (tpPriceRef.current) tpPriceRef.current.textContent = fmtPrice(price);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      setPanelTp(tpRef.current);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  };

  const handleSlMouseDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const container = containerRef.current;
    const series    = seriesRef.current;
    if (!container || !series) return;

    const onMove = (ev) => {
      const rect  = container.getBoundingClientRect();
      const price = series.coordinateToPrice(ev.clientY - rect.top);
      if (price == null) return;
      slRef.current = price;
      if (slPriceRef.current) slPriceRef.current.textContent = fmtPrice(price);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      setPanelSl(slRef.current);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  };

  const switchDirection = (newDir) => {
    if (newDir === direction) return;
    const newTp = entryPrice - (tpRef.current - entryPrice);
    const newSl = entryPrice - (slRef.current - entryPrice);
    tpRef.current = newTp;
    slRef.current = newSl;
    if (tpPriceRef.current) tpPriceRef.current.textContent = fmtPrice(newTp);
    if (slPriceRef.current) slPriceRef.current.textContent = fmtPrice(newSl);
    setPanelTp(newTp);
    setPanelSl(newSl);
    setDirection(newDir);
    setError(null);
  };

  // Distances en points de prix bruts — pas de conversion pips (cf. useTrades)
  const tpDist = Math.abs(panelTp - entryPrice);
  const slDist = Math.abs(panelSl - entryPrice);
  const rr     = slDist > 0 ? (tpDist / slDist).toFixed(1) : '∞';

  const handleConfirm = () => {
    const isBuy  = direction === 'BUY';
    const validTp = isBuy ? tpRef.current > entryPrice : tpRef.current < entryPrice;
    const validSl = isBuy ? slRef.current < entryPrice : slRef.current > entryPrice;
    if (!validTp || !validSl) {
      setError(
        isBuy
          ? "BUY : TP au-dessus · SL en-dessous de l'entrée"
          : "SELL : TP en-dessous · SL au-dessus de l'entrée",
      );
      return;
    }
    setError(null);
    onConfirm(direction, entryPrice, tpRef.current, slRef.current);
  };

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 10, pointerEvents: 'none' }}>

      {/* ── Fill zones ────────────────────────────────────────────── */}
      <div ref={tpFillRef} style={{
        position: 'absolute', left: 0, right: 0,
        background: 'rgba(38,166,154,0.07)',
        pointerEvents: 'none',
      }} />
      <div ref={slFillRef} style={{
        position: 'absolute', left: 0, right: 0,
        background: 'rgba(239,83,80,0.07)',
        pointerEvents: 'none',
      }} />

      {/* ── TP line (draggable) ───────────────────────────────────── */}
      <div
        ref={tpLineRef}
        className={styles.line}
        style={{ pointerEvents: 'all' }}
        onMouseDown={handleTpMouseDown}
      >
        <div className={styles.lineBody} style={{ background: '#26A69A' }} />
        <div className={styles.lineTag} style={{ color: '#26A69A', borderColor: 'rgba(38,166,154,0.40)' }}>
          TP · <span ref={tpPriceRef}>{fmtPrice(panelTp)}</span>
        </div>
        <div className={styles.handle} style={{ borderColor: '#26A69A', color: '#26A69A' }} />
      </div>

      {/* ── Entry line (fixed) ───────────────────────────────────── */}
      <div
        ref={entryLineRef}
        className={styles.line}
        style={{ pointerEvents: 'none' }}
      >
        <div className={styles.lineBody} style={{ background: 'rgba(226,232,240,0.45)' }} />
        <div className={styles.lineTag} style={{ color: 'rgba(226,232,240,0.65)', borderColor: 'rgba(255,255,255,0.12)' }}>
          {direction} · {fmtPrice(entryPrice)}
        </div>
      </div>

      {/* ── SL line (draggable) ───────────────────────────────────── */}
      <div
        ref={slLineRef}
        className={styles.line}
        style={{ pointerEvents: 'all' }}
        onMouseDown={handleSlMouseDown}
      >
        <div className={styles.lineBody} style={{ background: '#EF5350' }} />
        <div className={styles.lineTag} style={{ color: '#EF5350', borderColor: 'rgba(239,83,80,0.40)' }}>
          SL · <span ref={slPriceRef}>{fmtPrice(panelSl)}</span>
        </div>
        <div className={styles.handle} style={{ borderColor: '#EF5350', color: '#EF5350' }} />
      </div>

      {/* ── Confirmation panel ───────────────────────────────────── */}
      <div className={styles.panel} style={{ pointerEvents: 'all' }}>

        <div className={styles.dirToggle}>
          <button
            className={`${styles.dirBtn}${direction === 'BUY' ? ` ${styles.buyActive}` : ''}`}
            onClick={() => switchDirection('BUY')}
          >
            ↑ BUY
          </button>
          <button
            className={`${styles.dirBtn}${direction === 'SELL' ? ` ${styles.sellActive}` : ''}`}
            onClick={() => switchDirection('SELL')}
          >
            ↓ SELL
          </button>
        </div>

        <div className={styles.levelRow}>
          <span className={styles.ll}>Entrée</span>
          <span className={`${styles.lv} ${styles.mono}`}>{fmtPrice(entryPrice)}</span>
        </div>
        <div className={styles.levelRow}>
          <span className={styles.ll} style={{ color: '#26A69A' }}>TP</span>
          <span className={`${styles.lv} ${styles.mono}`} style={{ color: '#26A69A' }}>
            {fmtPrice(panelTp)}<em className={styles.pips}>&ensp;+{fmtPrice(tpDist)} pts</em>
          </span>
        </div>
        <div className={styles.levelRow}>
          <span className={styles.ll} style={{ color: '#EF5350' }}>SL</span>
          <span className={`${styles.lv} ${styles.mono}`} style={{ color: '#EF5350' }}>
            {fmtPrice(panelSl)}<em className={styles.pips}>&ensp;-{fmtPrice(slDist)} pts</em>
          </span>
        </div>

        <div className={styles.rrRow}>
          <span className={styles.rrLabel}>R:R</span>
          <span className={styles.rrValue}>1 : {rr}</span>
        </div>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onCancel}>Annuler</button>
          <button className={styles.confirmBtn} onClick={handleConfirm}>Confirmer</button>
        </div>
      </div>
    </div>
  );
}
