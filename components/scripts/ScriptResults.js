// Le relevé de compte d'un run — « alors, j'ai fait combien ? ».
//
// Trois blocs, dans l'ordre où on se pose les questions : ce que le compte a
// fait, ce qu'il a traversé (marge, liquidations), puis le détail des trades.
//
// La courbe est celle de l'ÉQUITÉ relevée à chaque bougie, avec le capital de
// départ en ligne de base : c'est la seule façon de voir les creux VÉCUS en
// position, ceux qu'une courbe de trades fermés lisse et qui déclenchent
// pourtant les appels de marge.

import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtUsd, fmtPct, fmtCount, fmtPrice } from '../../lib/format';
import styles from './ScriptResults.module.css';

const utcStamp = t => (t != null ? new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ') : '—');

const REASON_LABEL = {
  sl: 'Stop', tp: 'Objectif', be: 'Break-even',
  close: 'Signal', signal: 'Signal', stopout: 'Stop out', end: 'Fin des données',
};
// Le tableau est étroit : les mêmes causes, en court.
const REASON_SHORT = {
  sl: 'SL', tp: 'TP', be: 'BE',
  close: 'Sig.', signal: 'Sig.', stopout: 'Liq.', end: 'Fin',
};

// ── Courbe d'équité ──────────────────────────────────────────────────────────
// Une seule série : pas de légende, le titre la nomme. Ligne de 2 px, grille
// muette, valeur finale étiquetée en clair — et le survol donne la valeur exacte
// à la bougie, plutôt qu'un nombre posé sur chaque point.
function EquityChart({ curve, capital }) {
  const wrapRef = useRef(null);
  const [w, setW] = useState(360);
  const [hover, setHover] = useState(null);
  const h = 128, padT = 10, padB = 18, padR = 54;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(160, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const plotW = Math.max(40, w - padR);

  // Réduction par colonne de pixels, en gardant le MIN et le MAX de chaque
  // colonne : un creux d'une bougie reste visible même sur 20 000 bougies.
  const pts = useMemo(() => {
    if (!curve.length) return [];
    const cols = Math.max(2, Math.floor(plotW / 2));
    if (curve.length <= cols) return curve.map((p, i) => ({ ...p, i }));
    const per = curve.length / cols;
    const out = [];
    for (let c = 0; c < cols; c++) {
      const from = Math.floor(c * per);
      const to   = Math.min(curve.length, Math.floor((c + 1) * per));
      let lo = curve[from], hi = curve[from], loI = from, hiI = from;
      for (let i = from; i < to; i++) {
        if (curve[i].equity < lo.equity) { lo = curve[i]; loI = i; }
        if (curve[i].equity > hi.equity) { hi = curve[i]; hiI = i; }
      }
      if (loI <= hiI) out.push({ ...lo, i: loI }, { ...hi, i: hiI });
      else            out.push({ ...hi, i: hiI }, { ...lo, i: loI });
    }
    const last = curve.length - 1;
    if (out[out.length - 1].i !== last) out.push({ ...curve[last], i: last });
    return out;
  }, [curve, plotW]);

  if (pts.length < 2) return null;

  const values = pts.map(p => p.equity).concat(capital);
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const x = i => (i / (pts.length - 1)) * plotW;
  const y = v => padT + (1 - (v - min) / span) * (h - padT - padB);

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.equity).toFixed(1)}`).join(' ');
  const area = `${line} L${plotW.toFixed(1)},${(h - padB).toFixed(1)} L0,${(h - padB).toFixed(1)} Z`;
  const last = pts[pts.length - 1];
  const up   = last.equity >= capital;
  const tint = up ? 'var(--bull)' : 'var(--bear)';

  const onMove = e => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px   = e.clientX - rect.left;
    const k    = Math.round((px / plotW) * (pts.length - 1));
    if (k >= 0 && k < pts.length) setHover({ k, px: x(k) });
  };

  return (
    <div className={styles.chartWrap} ref={wrapRef}>
      <div className={styles.chartHead}>
        <span className={styles.chartTitle}>Équité, bougie par bougie</span>
        <span className={styles.chartScale}>{fmtUsd(min, { decimals: 0 })} → {fmtUsd(max, { decimals: 0 })}</span>
      </div>

      <svg
        width={w} height={h} className={styles.chart}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        role="img" aria-label={`Équité du compte, de ${fmtUsd(capital)} à ${fmtUsd(last.equity)}`}
      >
        <defs>
          <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={tint} stopOpacity="0.22" />
            <stop offset="100%" stopColor={tint} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Capital de départ — la seule référence qui compte */}
        <line x1="0" y1={y(capital)} x2={plotW} y2={y(capital)}
              stroke="var(--text-ghost)" strokeWidth="1" strokeDasharray="3 3" />
        <text x={plotW + 6} y={y(capital) + 3} className={styles.axisText}>
          {fmtUsd(capital, { decimals: 0 })}
        </text>

        <path d={area} fill="url(#eqFill)" />
        <path d={line} fill="none" stroke={tint} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        <circle cx={x(pts.length - 1)} cy={y(last.equity)} r="3" fill={tint} />
        <text x={plotW + 6} y={y(last.equity) + 3} className={styles.axisValue} style={{ fill: tint }}>
          {fmtUsd(last.equity, { decimals: 0 })}
        </text>

        {hover && (
          <g>
            <line x1={hover.px} y1={padT} x2={hover.px} y2={h - padB}
                  stroke="var(--border-2)" strokeWidth="1" />
            <circle cx={hover.px} cy={y(pts[hover.k].equity)} r="3.5"
                    fill={tint} stroke="var(--surface)" strokeWidth="2" />
          </g>
        )}
      </svg>

      {hover && (
        <div className={styles.tip} style={{ left: Math.min(hover.px, plotW - 90) }}>
          <span className={styles.tipTime}>{utcStamp(pts[hover.k].time)}</span>
          <span className={styles.tipVal}>Équité {fmtUsd(pts[hover.k].equity)}</span>
          <span className={styles.tipSub}>Solde {fmtUsd(pts[hover.k].balance)}</span>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, tone, hint }) {
  return (
    <div className={styles.kpi} title={hint}>
      <span className={styles.kpiLabel}>{label}</span>
      <span className={`${styles.kpiValue}${tone ? ` ${styles[tone]}` : ''}`}>{value}</span>
    </div>
  );
}

// Les événements de compte portent toujours une ICÔNE et un LIBELLÉ : la couleur
// seule ne dirait rien à qui ne la distingue pas, et « 3 » sans mot ne dit rien
// du tout.
function Flag({ icon, label, count, tone, hint }) {
  return (
    <div className={`${styles.flag} ${styles[tone]}${count > 0 ? ` ${styles.flagOn}` : ''}`} title={hint}>
      <span className={styles.flagIcon} aria-hidden="true">{icon}</span>
      <span className={styles.flagCount}>{fmtCount(count)}</span>
      <span className={styles.flagLabel}>{label}</span>
    </div>
  );
}

export default function ScriptResults({
  summary: s, run, onDownload,
  onChart = false, onToggleChart, onSelectTrade, selectedTradeId = null,
}) {
  const [tab, setTab] = useState('trades');
  const [showAll, setShowAll] = useState(false);

  const trades = run.trades;
  const shown  = showAll ? trades : trades.slice(-40);
  const win    = s.netProfit >= 0;

  return (
    <div className={styles.results}>
      {/* ── Le chiffre ────────────────────────────────────────────────── */}
      <div className={styles.hero}>
        <span className={styles.heroLabel}>Profit net</span>
        <span className={`${styles.heroValue}${win ? ` ${styles.pos}` : ` ${styles.neg}`}`}>
          {fmtUsd(s.netProfit, { sign: true })}
        </span>
        <span className={styles.heroSub}>
          {fmtPct(s.netProfitPct, { sign: true })} · solde final {fmtUsd(s.finalBalance)} ·{' '}
          {fmtCount(s.total)} trade{s.total > 1 ? 's' : ''}
        </span>
        {s.ruined && (
          <span className={styles.ruin}>
            ⚠ Compte ruiné le {utcStamp(s.ruinTime)} — le script s&apos;est arrêté là.
          </span>
        )}
      </div>

      <EquityChart curve={run.equityCurve} capital={s.capital} />

      {/* ── Ce que le compte a traversé ───────────────────────────────── */}
      <div className={styles.flags}>
        <Flag icon="!" label="Appels de marge" count={s.marginCalls} tone="warn"
              hint={`Un épisode par appel — ${fmtCount(s.marginCallBars)} bougies passées sous le seuil`} />
        <Flag icon="✕" label="Stop outs" count={s.stopOuts} tone="bad"
              hint="Positions liquidées d'office par le broker" />
        <Flag icon="⊘" label="Ordres refusés" count={s.rejected} tone="mute"
              hint="Ordres non pris faute de marge libre" />
      </div>

      {/* ── Les chiffres ──────────────────────────────────────────────── */}
      <div className={styles.kpis}>
        <Kpi label="Capital"        value={fmtUsd(s.capital, { decimals: 0 })} />
        <Kpi label="Solde final"    value={fmtUsd(s.finalBalance)} tone={win ? 'pos' : 'neg'} />
        <Kpi label="Pic d'équité"   value={fmtUsd(s.peakEquity, { decimals: 0 })} />
        <Kpi label="Drawdown max"   value={`${fmtUsd(s.maxDrawdown, { decimals: 0 })} · ${fmtPct(s.maxDrawdownPct)}`}
             tone="neg" hint="Sur l'équité relevée à chaque bougie, creux traversés en position compris" />
        <Kpi label="Winrate"        value={fmtPct(s.winrate)} hint={`${s.wins} gagnants / ${s.losses} perdants`} />
        <Kpi label="Facteur profit" value={Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '—'}
             tone={s.profitFactor > 1 ? 'pos' : 'neg'} />
        <Kpi label="Espérance"      value={fmtUsd(s.expectancy, { sign: true })} hint="Gain moyen par trade" />
        <Kpi label="Gain moyen"     value={fmtUsd(s.avgWin, { decimals: 0 })} tone="pos" />
        <Kpi label="Perte moyenne"  value={fmtUsd(s.avgLoss, { decimals: 0 })} tone="neg" />
        <Kpi label="Meilleur / pire" value={`${fmtUsd(s.bestTrade, { decimals: 0 })} / ${fmtUsd(s.worstTrade, { decimals: 0 })}`} />
        <Kpi label="Séries G / P"   value={`${s.maxConsecWins} / ${s.maxConsecLosses}`} hint="Gains et pertes consécutifs" />
        <Kpi label="Facteur récup." value={s.recoveryFactor != null ? s.recoveryFactor.toFixed(2) : '—'}
             hint="Profit net rapporté au drawdown max" />
        <Kpi label="Marge max"      value={fmtUsd(s.maxUsedMargin, { decimals: 0 })} />
        <Kpi label="Niveau marge min"
             value={s.minMarginLevel == null ? '—'
                  : s.minMarginLevel > 9999 ? '> 9999 %'
                  : `${s.minMarginLevel.toFixed(0)} %`}
             tone={s.minMarginLevel != null && s.minMarginLevel < 200 ? 'warn' : undefined}
             hint="Le pire rapport équité / marge utilisée traversé — sous le seuil de stop out, le broker liquide" />
        <Kpi label="Exposition"     value={fmtPct(s.exposurePct)} hint="Part des bougies avec au moins une position ouverte" />
        <Kpi label="Coûts payés"    value={fmtUsd(s.totalCosts, { decimals: 0 })} hint="Spread + commissions" />
        <Kpi label="Lots cumulés"   value={s.totalLots.toFixed(2)} />
        <Kpi label="Achats / ventes" value={`${s.longs} / ${s.shorts}`}
             hint={`${s.longsWon} et ${s.shortsWon} gagnants`} />
      </div>

      <p className={styles.period}>
        {fmtCount(s.range.bars)} bougies · {utcStamp(s.range.startTime)} → {utcStamp(s.range.endTime)}
        {Object.keys(s.byReason).length > 0 && (
          <> · sorties : {Object.entries(s.byReason)
            .map(([k, v]) => `${REASON_LABEL[k] ?? k} ${v}`).join(', ')}</>
        )}
      </p>

      {/* ── Le détail ─────────────────────────────────────────────────── */}
      <div className={styles.tabs}>
        <button className={`${styles.tab}${tab === 'trades' ? ` ${styles.tabActive}` : ''}`}
                onClick={() => setTab('trades')}>Trades ({fmtCount(trades.length)})</button>
        <button className={`${styles.tab}${tab === 'log' ? ` ${styles.tabActive}` : ''}`}
                onClick={() => setTab('log')}>Journal ({fmtCount(run.logs.length)})</button>
        <div className={styles.spacer} />
        {onToggleChart && (
          <button
            className={`${styles.chartBtn}${onChart ? ` ${styles.chartBtnOn}` : ''}`}
            onClick={onToggleChart}
            aria-pressed={onChart}
            title="Peindre les positions sur le graphe"
          >
            {onChart ? '◨ Sur le graphe' : '◫ Sur le graphe'}
          </button>
        )}
        <button className={styles.dlBtn} onClick={onDownload} title="Rapport JSON complet">↓ JSON</button>
      </div>

      {tab === 'trades' ? (
        trades.length === 0 ? (
          <p className={styles.empty}>Aucun trade — le script n&apos;a rien pris sur cette période.</p>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>#</th><th>Sens</th><th>Lots</th><th>Entrée</th><th>Sortie</th>
                    <th>Cause</th><th className={styles.num}>Points</th><th className={styles.num}>USD</th>
                    <th className={styles.num}>Solde</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(t => (
                    <tr
                      key={t.id}
                      className={`${onSelectTrade ? styles.rowClickable : ''}${t.id === selectedTradeId ? ` ${styles.rowSelected}` : ''}`}
                      onClick={onSelectTrade ? () => onSelectTrade(t) : undefined}
                      title={onSelectTrade ? 'Montrer cette position sur le graphe' : undefined}
                    >
                      <td className={styles.dim}>{t.id}</td>
                      <td className={t.side === 'BUY' ? styles.pos : styles.neg}>
                        {t.side === 'BUY' ? '▲' : '▼'}
                      </td>
                      <td className={styles.dim}>{t.lots.toFixed(2)}</td>
                      <td className={styles.dim}>{fmtPrice(t.entryPrice)}</td>
                      <td className={styles.dim}>{fmtPrice(t.exitPrice)}</td>
                      <td className={styles.dim} title={REASON_LABEL[t.reason] ?? t.reason}>
                        {REASON_SHORT[t.reason] ?? t.reason}
                      </td>
                      <td className={`${styles.num} ${t.profitPoints >= 0 ? styles.pos : styles.neg}`}>
                        {t.profitPoints >= 0 ? '+' : '−'}{Math.abs(t.profitPoints).toFixed(1)}
                      </td>
                      <td className={`${styles.num} ${t.profitUsd >= 0 ? styles.pos : styles.neg}`}>
                        {fmtUsd(t.profitUsd, { sign: true })}
                      </td>
                      <td className={`${styles.num} ${styles.dim}`}>{fmtUsd(t.balanceAfter, { decimals: 0 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {trades.length > 40 && (
              <button className={styles.moreBtn} onClick={() => setShowAll(v => !v)}>
                {showAll ? 'Ne montrer que les 40 derniers' : `Tout afficher (${fmtCount(trades.length)})`}
              </button>
            )}
          </>
        )
      ) : (
        run.logs.length === 0 ? (
          <p className={styles.empty}>Journal vide — ni refus, ni liquidation, ni message du script.</p>
        ) : (
          <ul className={styles.log}>
            {run.logs.slice(-200).map((l, k) => (
              <li key={k} className={`${styles.logLine} ${styles[`log_${l.kind}`] ?? ''}`}>
                <span className={styles.logTime}>{utcStamp(l.time)}</span>
                <span className={styles.logText}>{l.text}</span>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
