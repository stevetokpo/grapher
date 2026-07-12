import { useState } from 'react';
import styles from './TradingModal.module.css';

const PIP = 0.0001;

const TP_PRESETS = [10, 20, 30, 50];
const SL_PRESETS = [5, 10, 15, 20];

function fmtPrice(price) {
  if (!price && price !== 0) return '—';
  return price.toFixed(5);
}

export default function TradingModal({ onClose, currentPrice, currentTime, onTrade }) {
  const [tpPips, setTpPips] = useState(20);
  const [slPips, setSlPips] = useState(10);

  const tpBuy  = currentPrice + tpPips * PIP;
  const slBuy  = currentPrice - slPips * PIP;
  const tpSell = currentPrice - tpPips * PIP;
  const slSell = currentPrice + slPips * PIP;

  const rr = (tpPips / slPips).toFixed(1);

  const handleTrade = (direction) => {
    const tp = direction === 'BUY' ? tpBuy : tpSell;
    const sl = direction === 'BUY' ? slBuy : slSell;
    onTrade(direction, currentPrice, currentTime, tp, sl);
    onClose();
  };

  return (
    <div
      className={styles.overlay}
      onClick={e => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="trade-modal-title"
    >
      <div className={styles.panel}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Fermer">×</button>

        <h2 id="trade-modal-title" className={styles.title}>Passer un trade</h2>

        {/* Entry price */}
        <div className={styles.entryRow}>
          <span className={styles.entryLabel}>Entrée</span>
          <span className={styles.entryPrice}>{fmtPrice(currentPrice)}</span>
        </div>

        {/* TP / SL pips inputs */}
        <div className={styles.inputRow}>
          <div className={styles.inputGroup}>
            <label className={styles.label} htmlFor="tp-pips">TP (pips)</label>
            <input
              id="tp-pips"
              type="number"
              className={styles.input}
              value={tpPips}
              min={1}
              onChange={e => setTpPips(Math.max(1, Math.round(Number(e.target.value))))}
            />
            <div className={styles.presets}>
              {TP_PRESETS.map(p => (
                <button
                  key={p}
                  className={`${styles.preset}${tpPips === p ? ` ${styles.presetActive}` : ''}`}
                  onClick={() => setTpPips(p)}
                >{p}</button>
              ))}
            </div>
          </div>

          <div className={styles.inputGroup}>
            <label className={styles.label} htmlFor="sl-pips">SL (pips)</label>
            <input
              id="sl-pips"
              type="number"
              className={styles.input}
              value={slPips}
              min={1}
              onChange={e => setSlPips(Math.max(1, Math.round(Number(e.target.value))))}
            />
            <div className={styles.presets}>
              {SL_PRESETS.map(p => (
                <button
                  key={p}
                  className={`${styles.preset}${slPips === p ? ` ${styles.presetActive}` : ''}`}
                  onClick={() => setSlPips(p)}
                >{p}</button>
              ))}
            </div>
          </div>
        </div>

        {/* R:R */}
        <div className={styles.rrRow}>
          <span className={styles.rrLabel}>Ratio R:R</span>
          <span className={styles.rrValue}>1 : {rr}</span>
        </div>

        {/* Preview table */}
        <div className={styles.preview}>
          <div className={styles.previewCol}>
            <div className={styles.previewHeader} style={{ color: '#26A69A' }}>↑ BUY</div>
            <div className={styles.previewLine}>
              <span className={styles.plLabel}>Entrée</span>
              <span className={styles.plValue}>{fmtPrice(currentPrice)}</span>
            </div>
            <div className={styles.previewLine}>
              <span className={styles.plLabel} style={{ color: '#26A69A' }}>TP</span>
              <span className={styles.plValue} style={{ color: '#26A69A' }}>{fmtPrice(tpBuy)}</span>
            </div>
            <div className={styles.previewLine}>
              <span className={styles.plLabel} style={{ color: '#EF5350' }}>SL</span>
              <span className={styles.plValue} style={{ color: '#EF5350' }}>{fmtPrice(slBuy)}</span>
            </div>
          </div>
          <div className={styles.previewDivider}/>
          <div className={styles.previewCol}>
            <div className={styles.previewHeader} style={{ color: '#EF5350' }}>↓ SELL</div>
            <div className={styles.previewLine}>
              <span className={styles.plLabel}>Entrée</span>
              <span className={styles.plValue}>{fmtPrice(currentPrice)}</span>
            </div>
            <div className={styles.previewLine}>
              <span className={styles.plLabel} style={{ color: '#26A69A' }}>TP</span>
              <span className={styles.plValue} style={{ color: '#26A69A' }}>{fmtPrice(tpSell)}</span>
            </div>
            <div className={styles.previewLine}>
              <span className={styles.plLabel} style={{ color: '#EF5350' }}>SL</span>
              <span className={styles.plValue} style={{ color: '#EF5350' }}>{fmtPrice(slSell)}</span>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className={styles.actions}>
          <button className={styles.buyBtn} onClick={() => handleTrade('BUY')}>
            ↑ BUY
          </button>
          <button className={styles.sellBtn} onClick={() => handleTrade('SELL')}>
            ↓ SELL
          </button>
        </div>

        <p className={styles.note}>Pips calculés avec 0.0001 (forex standard)</p>
      </div>
    </div>
  );
}
