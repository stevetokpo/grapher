// Fenêtre « graphe » d'un backtest : les bougies du symbole testé, avec les
// positions dessinées dessus (bandes SL/TP, trajet entrée → sortie, marqueurs).
//
// Le backtest peut couvrir des mois — bien plus de bougies que le graphe n'en
// charge d'un coup. La fenêtre est donc ANCRÉE sur un trade : on charge le bloc
// de bougies qui l'entoure, et on remonte le temps à la demande (comme le
// graphe principal). Passer d'un trade à l'autre ne recharge que si le trade
// visé sort du bloc déjà chargé.

import { useState, useEffect, useCallback, useRef } from 'react';
import { TF_SECONDS } from '../../lib/replayUtils';
import { fmtPrice } from '../../lib/format';
import TradingChart from '../charts/TradingChart';
import styles from './TradesChartModal.module.css';

const WINDOW_BARS = 900;   // bougies chargées autour du trade ancré
const PAGE_BARS   = 500;   // bougies ajoutées à chaque remontée dans le temps
const PAD_AFTER   = 40;    // bougies de contexte après la sortie
const PAD_FOCUS   = 25;    // marge de part et d'autre du trade, au recadrage

const EXIT_LABELS = {
  tp: 'Take profit', sl: 'Stop loss', signal: 'Signal',
  timeout: 'Sortie forcée', end: 'Fin des données',
};

export default function TradesChartModal({ symbol, tf, trades, initialTradeId, onClose }) {
  const tfSec = TF_SECONDS[tf] ?? 60;

  const startIdx = Math.max(0, trades.findIndex(t => t.id === initialTradeId));
  const [idx, setIdx] = useState(startIdx);

  const [bars,    setBars]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [focus,   setFocus]   = useState(null);

  const barsRef     = useRef([]);
  const hasMoreRef  = useRef(true);
  const fetchingRef = useRef(false);
  const genRef      = useRef(0);
  useEffect(() => { barsRef.current    = bars;    }, [bars]);
  useEffect(() => { hasMoreRef.current = hasMore; }, [hasMore]);

  const trade = trades[idx] ?? null;

  // Recadrer sur le trade courant. Objet neuf à chaque fois : TradingChart
  // compare par identité, donc un même trade re-sélectionné recadre quand même.
  const focusOn = useCallback((t) => {
    setFocus({
      from: t.entryTime - PAD_FOCUS * tfSec,
      to:   t.exitTime  + PAD_FOCUS * tfSec,
    });
  }, [tfSec]);

  // ── Chargement du bloc de bougies ancré sur un trade ─────────────────────
  const loadAround = useCallback(async (t) => {
    const gen = ++genRef.current;
    setLoading(true);
    // `to` est une borne SUPÉRIEURE EXCLUSIVE : on demande les WINDOW_BARS
    // bougies qui la précèdent, en laissant du contexte après la sortie.
    const to = t.exitTime + PAD_AFTER * tfSec;
    try {
      const data = await fetch(
        `/api/bars?symbolId=${symbol.id}&tf=${tf}&limit=${WINDOW_BARS}&to=${to}`,
      ).then(r => r.json());
      if (gen !== genRef.current) return;              // un autre trade a été demandé entre-temps
      const fresh = Array.isArray(data) ? data : [];
      setBars(fresh);
      barsRef.current = fresh;
      setHasMore(fresh.length >= WINDOW_BARS);
      focusOn(t);
    } catch {
      if (gen === genRef.current) setBars([]);
    } finally {
      if (gen === genRef.current) setLoading(false);
    }
  }, [symbol.id, tf, tfSec, focusOn]);

  // Premier rendu : on charge autour du trade d'ouverture.
  useEffect(() => {
    if (trades.length) loadAround(trades[startIdx]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Navigation entre trades ──────────────────────────────────────────────
  const goto = useCallback((next) => {
    if (next < 0 || next >= trades.length) return;
    setIdx(next);
    const t   = trades[next];
    const cur = barsRef.current;
    const inWindow = cur.length > 0 &&
      t.entryTime >= cur[0].time &&
      t.exitTime  <= cur[cur.length - 1].time;
    if (inWindow) focusOn(t);          // déjà chargé → simple recadrage
    else loadAround(t);
  }, [trades, focusOn, loadAround]);

  // ── Remontée dans le temps (scroll vers la gauche) ────────────────────────
  const onLoadMore = useCallback(async () => {
    if (fetchingRef.current || !hasMoreRef.current) return;
    const cur = barsRef.current;
    if (!cur.length) return;

    const gen = genRef.current;
    fetchingRef.current = true;
    try {
      const data = await fetch(
        `/api/bars?symbolId=${symbol.id}&tf=${tf}&limit=${PAGE_BARS}&to=${cur[0].time}`,
      ).then(r => r.json());
      if (gen !== genRef.current) return;             // fenêtre re-ancrée entre-temps
      const older = Array.isArray(data) ? data : [];
      if (!older.length) { setHasMore(false); hasMoreRef.current = false; return; }
      setBars(prev => {
        const next = [...older, ...prev];
        barsRef.current = next;
        return next;
      });
      if (older.length < PAGE_BARS) { setHasMore(false); hasMoreRef.current = false; }
    } catch {
      /* silencieux — l'utilisateur peut re-scroller */
    } finally {
      if (gen === genRef.current) fetchingRef.current = false;
    }
  }, [symbol.id, tf]);

  // ── Raccourcis clavier ───────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape')     { e.preventDefault(); onClose(); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); goto(idx - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); goto(idx + 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [idx, goto, onClose]);

  const win = trade && (trade.profitPoints ?? 0) >= 0;

  return (
    <div className={styles.backdrop} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.modal}>

        <header className={styles.header}>
          <div className={styles.title}>
            <span className={styles.symbol}>{symbol.name}</span>
            <span className={styles.tf}>{tf}</span>
            <span className={styles.count}>{trades.length} trades</span>
          </div>

          {trade && (
            <div className={styles.nav}>
              <button className={styles.navBtn} onClick={() => goto(idx - 1)} disabled={idx === 0} title="Trade précédent (←)">‹</button>
              <span className={styles.navPos}>{idx + 1} / {trades.length}</span>
              <button className={styles.navBtn} onClick={() => goto(idx + 1)} disabled={idx >= trades.length - 1} title="Trade suivant (→)">›</button>

              <span className={styles.tradeInfo}>
                <b style={{ color: trade.direction === 'BUY' ? 'var(--bull)' : 'var(--bear)' }}>
                  #{trade.id} {trade.direction}
                </b>
                <span className={styles.sep}>·</span>
                {fmtPrice(trade.entryPrice)} → {fmtPrice(trade.exitPrice)}
                <span className={styles.sep}>·</span>
                {EXIT_LABELS[trade.exitReason] ?? trade.exitReason}
                <span className={styles.sep}>·</span>
                <b style={{ color: win ? 'var(--bull)' : 'var(--bear)' }}>
                  {trade.profitR != null
                    ? `${trade.profitR >= 0 ? '+' : ''}${trade.profitR.toFixed(2)}R`
                    : `${trade.profitPoints >= 0 ? '+' : ''}${fmtPrice(trade.profitPoints)} pts`}
                </b>
              </span>
            </div>
          )}

          <button className={styles.close} onClick={onClose} title="Fermer (Échap)">✕</button>
        </header>

        <div className={styles.chart}>
          {loading && <div className={styles.loading}>Chargement des bougies…</div>}
          {!loading && bars.length === 0 && (
            <div className={styles.loading}>Aucune bougie sur cette fenêtre.</div>
          )}
          {bars.length > 0 && (
            <TradingChart
              candles={bars}
              onLoadMore={onLoadMore}
              backtestTrades={trades}
              selectedTradeId={trade?.id ?? null}
              focusRange={focus}
              showVolume={false}
            />
          )}
        </div>

        <footer className={styles.legend}>
          <span><i className={styles.swatchTp} /> zone de gain (entrée → TP)</span>
          <span><i className={styles.swatchSl} /> zone de risque (entrée → SL final)</span>
          <span><i className={styles.swatchSl0} /> SL initial, si déplacé par le break-even</span>
          <span className={styles.hint}>← → pour naviguer, Échap pour fermer</span>
        </footer>

      </div>
    </div>
  );
}
