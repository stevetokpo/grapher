import { useState } from 'react';
import { fmtPrice, fmtCount } from '../../lib/format';
import EquityChart from './EquityChart';
import styles from './BacktestResults.module.css';

const DOW_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

const EXIT_LABELS = {
  tp:      'Take profit',
  sl:      'Stop loss',
  signal:  'Signal',
  timeout: 'Sortie forcée',
  end:     'Fin des données',
};

function fmtDT(epoch) {
  return new Date(epoch * 1000).toISOString().replace('T', ' ').slice(0, 16);
}

function fmtDuration(min) {
  if (min == null) return '—';
  if (min < 60)    return `${min}m`;
  if (min < 1440)  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
  return `${Math.floor(min / 1440)}j ${Math.floor((min % 1440) / 60)}h`;
}

function signColor(v) {
  if (v == null) return 'var(--text-muted)';
  return v >= 0 ? 'var(--bull)' : 'var(--bear)';
}

function fmtR(v, digits = 2) {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}R`;
}

function fmtPts(v) {
  if (v == null) return '—';
  const sign = v > 0 ? '+' : v < 0 ? '-' : '';
  return sign + fmtPrice(Math.abs(v));
}

function Card({ label, value, color, sub }) {
  return (
    <div className={styles.card}>
      <span className={styles.cardLabel}>{label}</span>
      <span className={styles.cardValue} style={color ? { color } : undefined}>{value}</span>
      {sub && <span className={styles.cardSub}>{sub}</span>}
    </div>
  );
}

// Tableau de ventilation générique (direction / mois / heure / jour)
function BreakdownTable({ title, rows, keyLabel, keyFmt = k => k }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div className={styles.block}>
      <h3 className={styles.blockTitle}>{title}</h3>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{keyLabel}</th>
              <th>Trades</th>
              <th>Winrate</th>
              <th>Points</th>
              <th>R</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key}>
                <td className={styles.mono}>{keyFmt(r.key)}</td>
                <td className={styles.mono}>{r.trades}</td>
                <td className={styles.mono} style={{ color: r.winrate >= 50 ? 'var(--bull)' : 'var(--bear)' }}>
                  {r.winrate != null ? `${r.winrate.toFixed(0)}%` : '—'}
                </td>
                <td className={styles.mono} style={{ color: signColor(r.totalPoints) }}>{fmtPts(r.totalPoints)}</td>
                <td className={styles.mono} style={{ color: signColor(r.totalR) }}>{fmtR(r.totalR, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function BacktestResults({ results, onOpenChart }) {
  const [equityUnit, setEquityUnit] = useState('r');
  const [showTrades, setShowTrades] = useState(false);

  const { meta, summary: s, equity, trades, byDirection, monthly, byHour, byDayOfWeek, tradesCapped } = results;

  const pf = s.profitFactor == null ? '—'
    : s.profitFactor === Infinity ? '∞'
    : s.profitFactor.toFixed(2);

  return (
    <div className={styles.results}>

      {/* ── Méta ─────────────────────────────────────────────────── */}
      <div className={styles.metaBar}>
        <span>{fmtCount(meta.m1Count)} bougies M1 → {fmtCount(meta.tfBarCount)} bougies {meta.tf}</span>
        <span className={styles.metaSep}>·</span>
        <span>calculé en {meta.elapsedMs} ms</span>
        {meta.capped && <span className={styles.metaWarn}>⚠ données plafonnées à 500k M1</span>}
      </div>

      {s.total === 0 ? (
        <p className={styles.empty}>Aucun trade généré sur cette période avec ces paramètres.</p>
      ) : (
        <>
          {/* ── Cartes de synthèse ───────────────────────────────── */}
          <div className={styles.cards}>
            <Card label="Trades" value={s.total} sub={`${s.wins}W / ${s.losses}L`} />
            <Card
              label="Winrate"
              value={s.winrate != null ? `${s.winrate.toFixed(1)}%` : '—'}
              color={s.winrate >= 50 ? 'var(--bull)' : 'var(--bear)'}
            />
            <Card label="R cumulé" value={fmtR(s.totalR)} color={signColor(s.totalR)}
                  sub={s.avgR != null ? `espérance ${fmtR(s.avgR)} / trade` : null} />
            <Card label="PnL (points)" value={fmtPts(s.totalPoints)} color={signColor(s.totalPoints)} />
            <Card label="Profit factor" value={pf}
                  color={s.profitFactor != null && s.profitFactor >= 1 ? 'var(--bull)' : 'var(--bear)'} />
            <Card label="Max drawdown" value={`-${s.maxDrawdownR.toFixed(2)}R`} color="var(--bear)"
                  sub={`${fmtPts(-s.maxDrawdownPoints)} points`} />
            <Card label="Sharpe (par trade)" value={s.sharpe != null ? s.sharpe.toFixed(2) : '—'}
                  color={s.sharpe != null ? signColor(s.sharpe) : undefined}
                  sub={s.stdR != null ? `σ ${s.stdR.toFixed(2)}R` : null} />
            <Card label="Meilleur / pire" value={`${fmtR(s.bestR, 1)} / ${fmtR(s.worstR, 1)}`} />
            <Card label="Séries max" value={`${s.maxConsecWins}W / ${s.maxConsecLosses}L`} />
            <Card label="Durée moyenne" value={fmtDuration(Math.round(s.avgDurationMin ?? 0))}
                  sub={s.avgBars != null ? `${s.avgBars.toFixed(1)} bougies ${meta.tf}` : null} />
          </div>

          {/* ── Courbe d'équité ──────────────────────────────────── */}
          <div className={styles.block}>
            <div className={styles.blockHeader}>
              <h3 className={styles.blockTitle}>Courbe d'équité</h3>
              <div className={styles.segmented}>
                {[['r', 'R'], ['points', 'Points']].map(([u, label]) => (
                  <button
                    key={u}
                    className={`${styles.segBtn}${equityUnit === u ? ` ${styles.segBtnActive}` : ''}`}
                    onClick={() => setEquityUnit(u)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <EquityChart points={equity} unit={equityUnit} />
          </div>

          {/* ── Ventilations ─────────────────────────────────────── */}
          <div className={styles.breakdowns}>
            <BreakdownTable title="Par direction" rows={byDirection} keyLabel="Sens" />
            <BreakdownTable title="Par mois" rows={monthly} keyLabel="Mois" />
            <BreakdownTable
              title="Par heure d'entrée (UTC broker)" rows={byHour} keyLabel="Heure"
              keyFmt={h => `${String(h).padStart(2, '0')}h`}
            />
            <BreakdownTable
              title="Par jour de semaine" rows={byDayOfWeek} keyLabel="Jour"
              keyFmt={d => DOW_LABELS[d] ?? d}
            />
          </div>

          {/* ── Sorties ──────────────────────────────────────────── */}
          <div className={styles.block}>
            <h3 className={styles.blockTitle}>Types de sortie</h3>
            <div className={styles.exitPills}>
              {Object.entries(s.exitReasons).map(([reason, count]) => (
                <span key={reason} className={styles.exitPill}>
                  {EXIT_LABELS[reason] ?? reason} <b>{count}</b>
                </span>
              ))}
            </div>
          </div>

          {/* ── Liste des trades ─────────────────────────────────── */}
          <div className={styles.block}>
            <div className={styles.blockHeader}>
              <h3 className={styles.blockTitle}>
                Trades {tradesCapped && <span className={styles.metaWarn}>(5000 derniers)</span>}
              </h3>
              <div className={styles.blockActions}>
                {onOpenChart && trades.length > 0 && (
                  <button className={styles.segBtn} onClick={() => onOpenChart(trades[0])}>
                    Voir sur le graphe
                  </button>
                )}
                <button className={styles.segBtn} onClick={() => setShowTrades(v => !v)}>
                  {showTrades ? 'Masquer' : `Afficher (${trades.length})`}
                </button>
              </div>
            </div>

            {showTrades && (
              <div className={`${styles.tableWrap} ${styles.tradesWrap}`}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>#</th><th>Sens</th><th>Signal</th><th>Entrée</th><th>Prix</th>
                      <th>Sortie</th><th>Prix</th><th>Durée</th><th>Motif</th>
                      <th>Points</th><th>R</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map(t => (
                      <tr
                        key={t.id}
                        className={onOpenChart ? styles.rowClickable : undefined}
                        onClick={onOpenChart ? () => onOpenChart(t) : undefined}
                        title={onOpenChart ? 'Voir ce trade sur le graphe' : undefined}
                      >
                        <td className={styles.mono}>{t.id}</td>
                        <td style={{ color: t.direction === 'BUY' ? 'var(--bull)' : 'var(--bear)', fontWeight: 700 }}>
                          {t.direction}
                        </td>
                        <td>{t.reason ?? '—'}</td>
                        <td className={styles.mono}>{fmtDT(t.entryTime)}</td>
                        <td className={styles.mono}>{fmtPrice(t.entryPrice)}</td>
                        <td className={styles.mono}>{fmtDT(t.exitTime)}</td>
                        <td className={styles.mono}>{fmtPrice(t.exitPrice)}</td>
                        <td className={styles.mono}>{fmtDuration(t.durationMin)}</td>
                        <td>{EXIT_LABELS[t.exitReason] ?? t.exitReason}</td>
                        <td className={styles.mono} style={{ color: signColor(t.profitPoints) }}>{fmtPts(t.profitPoints)}</td>
                        <td className={styles.mono} style={{ color: signColor(t.profitR) }}>{fmtR(t.profitR)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
