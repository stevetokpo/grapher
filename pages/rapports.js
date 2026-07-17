// /rapports — visionneuse des rapports JSON de positions rFVG (bouton
// « Rapports » du graphe). Tout se passe côté client : on dépose le fichier,
// la page recalcule stats, distributions et études BE / trailing à partir des
// positions qu'il contient.
//
// Les deux études s'appuient sur les excursions du rapport et affichent des
// BORNES, pas des vérités : l'ordre intra-vie des excursions est inconnu.
//   • Break-even (borne OPTIMISTE) : une perdante dont le pullup a atteint le
//     déclencheur est comptée sauvée (0 R au lieu de −1 R) — c'est certain,
//     le pullup des perdantes exclut la bougie du stop ; les gagnantes sont
//     supposées intactes, ce qui, lui, est optimiste.
//   • SL resserré (borne PESSIMISTE) : une gagnante dont le drawdown a atteint
//     la nouvelle distance de stop est comptée tuée — pessimiste, la chaleur
//     est supposée venir avant le TP.

import { useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import styles from '../styles/rapports.module.css';

const BULL   = '#26A69A';
const BEAR   = '#EF5350';
const ORANGE = '#FB923C';
const BLUE   = '#60A5FA';
const MUTED  = '#94A3B8';

const AMBER = '#F59E0B';

const STATUS_META = {
  tp:     { label: 'TP',      color: BULL },
  sl:     { label: 'SL',      color: BEAR },
  be:     { label: 'BE',      color: AMBER },
  missed: { label: 'Ratée',   color: MUTED },
  open:   { label: 'Ouverte', color: BLUE },
};

const fmtDate = iso => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
    + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
};
const fmtR   = v => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)} R`;
const fmtPct = v => v == null ? '—' : `${(v * 100).toFixed(1)} %`;
const fmtNum = (v, d = 2) => v == null ? '—' : v.toFixed(d);

// ── Tuile de stat ────────────────────────────────────────────────────────────
function Tile({ label, value, sub, color }) {
  return (
    <div className={styles.tile}>
      <span className={styles.tileKey}>{label}</span>
      <span className={styles.tileVal} style={color ? { color } : undefined}>{value}</span>
      {sub && <span className={styles.tileSub}>{sub}</span>}
    </div>
  );
}

// ── Courbe de R cumulé (positions résolues, dans l'ordre d'entrée) ──────────
function EquityChart({ points }) {
  const [hover, setHover] = useState(null);
  const W = 1080, H = 220, PL = 46, PR = 12, PT = 12, PB = 26;

  if (points.length < 2) return <p className={styles.cardSub}>Pas assez de positions résolues.</p>;

  const ys = points.map(p => p.cum);
  const yMin = Math.min(0, ...ys), yMax = Math.max(0, ...ys);
  const span = (yMax - yMin) || 1;
  const x = i => PL + (i / (points.length - 1)) * (W - PL - PR);
  const y = v => PT + (1 - (v - yMin) / span) * (H - PT - PB);

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.cum).toFixed(1)}`).join('');

  // Graduations y : 0 toujours, plus min/max arrondis
  const ticks = [...new Set([0, yMin, yMax].map(v => Math.round(v)))];

  const onMove = e => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.max(0, Math.min(points.length - 1,
      Math.round(((px - PL) / (W - PL - PR)) * (points.length - 1))));
    setHover({ i, left: `${(x(i) / W) * 100}%`, top: `${(y(points[i].cum) / H) * 100}%` });
  };

  return (
    <div className={styles.chartWrap}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)}
              stroke={t === 0 ? 'rgba(148,163,184,0.35)' : 'rgba(26,37,64,0.8)'}
              strokeWidth="1" strokeDasharray={t === 0 ? '' : '3,4'} />
            <text x={PL - 7} y={y(t) + 3} textAnchor="end" className={styles.axisLabel}>{t} R</text>
          </g>
        ))}
        <path d={`${path}L${x(points.length - 1)},${y(Math.max(0, yMin))}L${x(0)},${y(Math.max(0, yMin))}Z`}
          fill={BLUE} opacity="0.07" />
        <path d={path} fill="none" stroke={BLUE} strokeWidth="2" strokeLinejoin="round" />
        <text x={W - PR} y={H - 8} textAnchor="end" className={styles.axisLabel}>
          positions résolues, dans l'ordre d'entrée →
        </text>
        {hover && (
          <>
            <line x1={x(hover.i)} x2={x(hover.i)} y1={PT} y2={H - PB}
              stroke="rgba(148,163,184,0.4)" strokeWidth="1" />
            <circle cx={x(hover.i)} cy={y(points[hover.i].cum)} r="4"
              fill={BLUE} stroke="var(--surface)" strokeWidth="2" />
          </>
        )}
      </svg>
      {hover && (
        <div className={styles.chartTooltip} style={{ left: hover.left, top: hover.top }}>
          #{points[hover.i].id} · {fmtDate(points[hover.i].date)}<br />
          trade {fmtR(points[hover.i].r)} · cumul <b>{fmtR(points[hover.i].cum)}</b>
        </div>
      )}
    </div>
  );
}

// ── Histogramme d'excursions (une seule série, une seule teinte) ────────────
function Histogram({ values, color, maxX, unit = 'R' }) {
  const [hover, setHover] = useState(null);
  const W = 520, H = 190, PL = 34, PR = 8, PT = 14, PB = 28;

  if (!values.length) return <p className={styles.cardSub}>Aucune position dans ce groupe.</p>;

  const NB = 10;
  const bw = maxX / NB;
  const bins = Array.from({ length: NB }, () => 0);
  for (const v of values) bins[Math.min(NB - 1, Math.floor(v / bw))]++;
  const maxC = Math.max(...bins);

  const bx = i => PL + (i / NB) * (W - PL - PR);
  const bwPx = (W - PL - PR) / NB;
  const by = c => PT + (1 - c / maxC) * (H - PT - PB);

  return (
    <div className={styles.chartWrap}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}
        onMouseLeave={() => setHover(null)}>
        {[0, maxC].map(t => (
          <g key={t}>
            <line x1={PL} x2={W - PR} y1={by(t)} y2={by(t)}
              stroke="rgba(26,37,64,0.8)" strokeWidth="1" strokeDasharray="3,4" />
            <text x={PL - 6} y={by(t) + 3} textAnchor="end" className={styles.axisLabel}>{t}</text>
          </g>
        ))}
        {bins.map((c, i) => (
          <g key={i}>
            <rect
              x={bx(i) + 1} width={Math.max(1, bwPx - 2)}
              y={by(c)} height={Math.max(0, by(0) - by(c))}
              rx="3" fill={color} opacity={hover?.i === i ? 0.95 : 0.65}
              onMouseEnter={e => {
                setHover({ i, left: `${((bx(i) + bwPx / 2) / W) * 100}%`, top: `${(by(c) / H) * 100}%` });
              }}
            />
            {i % 2 === 0 && (
              <text x={bx(i)} y={H - 9} textAnchor="middle" className={styles.axisLabel}>
                {+(i * bw).toFixed(2)}
              </text>
            )}
          </g>
        ))}
        <text x={W - PR} y={H - 9} textAnchor="end" className={styles.axisLabel}>{unit}</text>
      </svg>
      {hover && (
        <div className={styles.chartTooltip} style={{ left: hover.left, top: hover.top }}>
          [{+(hover.i * bw).toFixed(2)} ; {+((hover.i + 1) * bw).toFixed(2)}] {unit} : <b>{bins[hover.i]}</b> position{bins[hover.i] > 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function RapportsPage() {
  const inputRef = useRef(null);
  const [report,   setReport]   = useState(null);
  const [fileName, setFileName] = useState('');
  const [error,    setError]    = useState(null);
  const [dragging, setDragging] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortKey,  setSortKey]  = useState({ key: 'entryTime', dir: 1 });
  const [maxRows,  setMaxRows]  = useState(200);

  const loadFile = file => {
    if (!file) return;
    file.text().then(txt => {
      try {
        const doc = JSON.parse(txt);
        if (!Array.isArray(doc.positions)) throw new Error('pas de tableau `positions`');
        setReport(doc);
        setFileName(file.name);
        setError(null);
        setStatusFilter('all');
        setMaxRows(200);
      } catch (e) {
        setError(`Fichier illisible : ${e.message}`);
      }
    });
  };

  // Tout est redérivé des positions — le rapport reste la seule source.
  const d = useMemo(() => {
    if (!report) return null;
    const pos    = report.positions;
    const params = report.params ?? {};
    const slPts  = params.slPts ?? 0;
    const tpPts  = params.tpPts ?? 0;
    const rr     = slPts > 0 ? tpPts / slPts : null;

    const byStatus = { tp: [], sl: [], be: [], missed: [], open: [] };
    for (const p of pos) (byStatus[p.status] ?? byStatus.open).push(p);
    const tp = byStatus.tp.length, sl = byStatus.sl.length, beN = byStatus.be.length;
    const beOn = (params.beTriggerPts ?? 0) > 0 || beN > 0;

    // Winrate et études : population TP/SL. Espérance et équité : toutes les
    // résolues, BE compris (leur profitR vient du rapport, niveau BE inclus).
    const resolved = tp + sl;
    const winrate  = resolved ? tp / resolved : null;
    const be       = rr != null ? 1 / (1 + rr) : null;

    const resolvedPos = [...byStatus.tp, ...byStatus.sl, ...byStatus.be]
      .sort((a, b) => a.entryTime - b.entryTime);
    const expR = resolvedPos.length
      ? resolvedPos.reduce((s, p) => s + (p.profitR ?? 0), 0) / resolvedPos.length
      : null;
    const expWL = resolved && rr != null ? (tp * rr - sl) / resolved : null;

    // Courbe de R cumulé sur les résolues, ordre chronologique d'entrée
    let cum = 0;
    const equity = resolvedPos
      .map(p => ({ id: p.id, date: p.entryDate, r: p.profitR ?? 0, cum: (cum += p.profitR ?? 0) }));

    const mfeLosers  = byStatus.sl.map(p => p.maxPullupR).filter(v => v != null);
    const maeWinners = byStatus.tp.map(p => p.maxDrawdownR).filter(v => v != null);

    // Étude break-even (borne optimiste) — sur la population TP/SL uniquement
    const beStudy = [];
    if (resolved && rr != null) {
      for (let i = 1; i <= 9; i++) {
        const t = +(rr * i / 10).toFixed(2);
        const saved = mfeLosers.filter(v => v >= t).length;
        beStudy.push({ t, saved, pct: sl ? saved / sl : 0, exp: (tp * rr - (sl - saved)) / resolved });
      }
    }

    // Étude SL resserré (borne pessimiste) — espérance en R du SL D'ORIGINE.
    // Les perdantes d'origine sont stoppées quelle que soit la distance (leur
    // MAE vaut 1 R) : elles coûtent d au lieu de 1. À d = 1 on retombe
    // exactement sur l'espérance de base.
    const slStudy = [];
    if (resolved && rr != null) {
      for (let i = 1; i <= 10; i++) {
        const dd = +(i / 10).toFixed(1);
        const wk = maeWinners.filter(v => v >= dd).length; // gagnantes tuées
        slStudy.push({
          d: dd, killed: wk,
          exp: ((tp - wk) * rr - (wk + sl) * dd) / resolved,
        });
      }
    }
    const bestBe = beStudy.reduce((m, r) => r.exp > (m?.exp ?? -Infinity) ? r : m, null);
    const bestSl = slStudy.reduce((m, r) => r.exp > (m?.exp ?? -Infinity) ? r : m, null);

    return { pos, params, rr, byStatus, tp, sl, beN, beOn, resolved, resolvedAll: resolvedPos.length, winrate, be, expR, expWL, equity, mfeLosers, maeWinners, beStudy, slStudy, bestBe, bestSl };
  }, [report]);

  const rows = useMemo(() => {
    if (!d) return [];
    const filtered = statusFilter === 'all' ? d.pos : d.pos.filter(p => p.status === statusFilter);
    const { key, dir } = sortKey;
    return [...filtered].sort((a, b) => {
      const va = a[key], vb = b[key];
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
    });
  }, [d, statusFilter, sortKey]);

  const sortBy = key => setSortKey(s => ({ key, dir: s.key === key ? -s.dir : -1 }));

  const COLS = [
    ['id', '#'], ['direction', 'Dir'], ['status', 'Statut'], ['entryTime', 'Entrée'],
    ['barsToFill', 'B. avant prise'], ['barsHeld', 'B. tenues'],
    ['entryPrice', 'Prix entrée'], ['exitPrice', 'Prix sortie'],
    ['profitR', 'Profit R'], ['maxPullupR', 'Pullup max R'], ['maxDrawdownR', 'Drawdown max R'],
  ];

  return (
    <div className={styles.page}>
      <Head><title>Rapports rFVG — Grapher</title></Head>

      <header className={styles.header}>
        <Link href="/" className={styles.logoLink}>
          <svg width="20" height="20" viewBox="0 0 22 22" fill="none" aria-hidden="true">
            <rect x="1" y="11" width="3" height="10" rx="1" fill="#F59E0B" />
            <rect x="7" y="6" width="3" height="15" rx="1" fill="#26A69A" />
            <rect x="13" y="3" width="3" height="18" rx="1" fill="#F59E0B" />
            <rect x="19" y="8" width="3" height="13" rx="1" fill="#26A69A" />
          </svg>
          <span className={styles.logoText}>GRAPHER</span>
        </Link>
        <span className={styles.headerTitle}>RAPPORTS rFVG</span>
        {report && (
          <div className={styles.headerFile}>
            <span>{fileName} · généré {fmtDate(report.generatedAt)}</span>
            <button className={styles.headerBtn} onClick={() => { setReport(null); setError(null); }}>
              Autre fichier
            </button>
          </div>
        )}
      </header>

      <input
        ref={inputRef} type="file" accept="application/json,.json" hidden
        onChange={e => { loadFile(e.target.files?.[0]); e.target.value = ''; }}
      />

      {!report ? (
        <div
          className={`${styles.dropzone}${dragging ? ` ${styles.dropzoneActive}` : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); loadFile(e.dataTransfer.files?.[0]); }}
        >
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke={ORANGE} strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="M17 8l-5-5-5 5" />
            <path d="M12 3v12" />
          </svg>
          <span className={styles.dropTitle}>Dépose un rapport rFVG</span>
          <span className={styles.dropBody}>
            Glisse ici le fichier JSON téléchargé avec le bouton « Rapports » du graphe,
            ou clique pour le choisir. Tout est analysé localement, rien n'est envoyé.
          </span>
          {error && <span className={styles.dropError}>{error}</span>}
        </div>
      ) : d && (
        <main className={styles.main}>
          {/* Paramètres du run */}
          <div className={styles.chips}>
            {Object.entries(d.params).map(([k, v]) => (
              <span key={k} className={styles.chip}>{k} <b>{String(v)}</b></span>
            ))}
          </div>

          {/* Tuiles */}
          <div className={styles.tiles}>
            <Tile label="Positions" value={d.pos.length}
              sub={`${d.byStatus.missed.length} ratée(s) · ${d.byStatus.open.length} ouverte(s)`} />
            <Tile label={d.beOn ? 'TP / BE / SL' : 'TP / SL'} color={undefined}
              value={
                <>
                  <span style={{ color: BULL }}>{d.tp}</span>
                  {d.beOn && (<><span style={{ color: 'var(--text-dim)' }}> / </span><span style={{ color: AMBER }}>{d.beN}</span></>)}
                  <span style={{ color: 'var(--text-dim)' }}> / </span>
                  <span style={{ color: BEAR }}>{d.sl}</span>
                </>
              }
              sub={`${d.resolvedAll} résolues${d.beOn ? ` dont ${d.beN} BE` : ''}`} />
            <Tile label="Winrate" value={fmtPct(d.winrate)}
              color={d.winrate != null && d.be != null ? (d.winrate >= d.be ? BULL : BEAR) : undefined}
              sub={d.be != null ? `TP/(TP+SL) · seuil BE du RR : ${fmtPct(d.be)}` : 'TP/(TP+SL)'} />
            <Tile label="RR" value={fmtNum(d.rr)} sub={`TP ${d.params.tpPts} / SL ${d.params.slPts} pts`} />
            <Tile label="Espérance" value={fmtR(d.expR)}
              color={d.expR != null ? (d.expR >= 0 ? BULL : BEAR) : undefined}
              sub={`par position résolue${d.beOn ? ', BE incl.' : ''}, spread 0`} />
          </div>

          {/* Courbe de R cumulé */}
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>R cumulé</h2>
            <p className={styles.cardSub}>Somme des profits en R des positions résolues, dans l'ordre chronologique d'entrée.</p>
            <EquityChart points={d.equity} />
          </section>

          {/* Distributions d'excursions */}
          <div className={styles.twoCol}>
            <section className={styles.card}>
              <h2 className={styles.cardTitle} style={{ color: BEAR }}>Pullup max des perdantes (SL)</h2>
              <p className={styles.cardSub}>
                Jusqu'où chaque perdante est allée dans le bon sens avant d'être stoppée —
                la matière première du break-even : une barre à droite est une perdante
                qu'un BE aurait pu neutraliser.
              </p>
              <Histogram values={d.mfeLosers} color={BEAR} maxX={Math.max(d.rr ?? 1, 0.1)} />
            </section>
            <section className={styles.card}>
              <h2 className={styles.cardTitle} style={{ color: BULL }}>Drawdown max des gagnantes (TP)</h2>
              <p className={styles.cardSub}>
                La chaleur que chaque gagnante a prise avant d'atteindre le TP —
                la limite du break-even : une barre à droite est une gagnante
                qu'un BE ou un stop resserré aurait tuée.
              </p>
              <Histogram values={d.maeWinners} color={BULL} maxX={1} />
            </section>
          </div>

          {/* Études BE / SL resserré */}
          <div className={styles.twoCol}>
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Étude break-even <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}>— borne optimiste</span></h2>
              <p className={styles.cardSub}>
                SL remonté à l'entrée dès que le profit atteint le déclencheur. Les perdantes
                sauvées sont certaines (leur pullup exclut la bougie du stop) ; les gagnantes
                sont supposées intactes, ce qui est optimiste.
                {d.beOn && (
                  <> <b style={{ color: AMBER }}>Ce rapport a déjà un BE appliqué</b> (seuil{' '}
                  {d.params.beTriggerPts} pts, niveau {d.params.beLevelPts} pts) : les études ne
                  portent que sur les positions TP/SL restantes, les sorties BE en sont exclues.</>
                )}
              </p>
              <table className={styles.studyTable}>
                <thead><tr><th>Déclencheur</th><th>Perdantes sauvées</th><th>%</th><th>Espérance</th></tr></thead>
                <tbody>
                  <tr className={styles.baseRow}>
                    <td>sans BE</td><td>—</td><td>—</td><td>{fmtR(d.expWL)}</td>
                  </tr>
                  {d.beStudy.map(r => (
                    <tr key={r.t} className={r === d.bestBe ? styles.bestRow : ''}>
                      <td>{fmtNum(r.t)} R</td>
                      <td>{r.saved} / {d.sl}</td>
                      <td>{fmtPct(r.pct)}</td>
                      <td>{fmtR(r.exp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Étude SL resserré <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}>— borne pessimiste</span></h2>
              <p className={styles.cardSub}>
                Et si le stop initial était à une fraction du SL actuel ? Une gagnante dont le
                drawdown atteint la nouvelle distance est comptée tuée (chaleur supposée venir
                avant le TP). Espérance en R du SL d'origine.
              </p>
              <table className={styles.studyTable}>
                <thead><tr><th>Distance</th><th>Gagnantes tuées</th><th>Espérance</th></tr></thead>
                <tbody>
                  {d.slStudy.map(r => (
                    <tr key={r.d} className={r === d.bestSl ? styles.bestRow : (r.d === 1 ? styles.baseRow : '')}>
                      <td>{fmtNum(r.d, 1)} × SL{r.d === 1 ? ' (actuel)' : ''}</td>
                      <td>{r.killed} / {d.tp}</td>
                      <td>{fmtR(r.exp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>

          <p className={styles.caveat}>
            Mesures en échantillon, à spread nul, avec remplissage limite optimiste et SL
            prioritaire dans la bougie. Les deux études sont des bornes construites sur des
            excursions globales par position — l'ordre intra-vie des excursions est inconnu à
            la granularité bougie. Une piste qui ressort ici doit être rejouée dans le module
            de backtest avec friction avant d'y croire.
          </p>

          {/* Table des positions */}
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Positions</h2>
            <div className={styles.filters}>
              {[['all', `Toutes (${d.pos.length})`],
                ['tp', `TP (${d.tp})`],
                ...(d.beOn ? [['be', `BE (${d.beN})`]] : []),
                ['sl', `SL (${d.sl})`],
                ['missed', `Ratées (${d.byStatus.missed.length})`],
                ['open', `Ouvertes (${d.byStatus.open.length})`]].map(([v, l]) => (
                <button key={v}
                  className={`${styles.filterChip}${statusFilter === v ? ` ${styles.filterChipOn}` : ''}`}
                  onClick={() => { setStatusFilter(v); setMaxRows(200); }}>
                  {l}
                </button>
              ))}
            </div>
            <div className={styles.posTableWrap}>
              <table className={styles.posTable}>
                <thead>
                  <tr>
                    {COLS.map(([key, label]) => (
                      <th key={key} onClick={() => sortBy(key)}
                        className={sortKey.key === key ? styles.sortedCol : ''}>
                        {label}{sortKey.key === key ? (sortKey.dir === 1 ? ' ↑' : ' ↓') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, maxRows).map(p => {
                    const meta = STATUS_META[p.status] ?? STATUS_META.open;
                    return (
                      <tr key={p.id}>
                        <td>{p.id}</td>
                        <td style={{ color: p.direction === 'BUY' ? BULL : BEAR }}>
                          {p.direction === 'BUY' ? '↑ BUY' : '↓ SELL'}
                        </td>
                        <td>
                          <span className={styles.statusBadge}
                            style={{ color: meta.color, background: `${meta.color}1A` }}>
                            <span className={styles.statusDot} style={{ background: meta.color }} />
                            {meta.label}
                          </span>
                        </td>
                        <td>{fmtDate(p.entryDate)}</td>
                        <td>{p.barsToFill ?? '—'}</td>
                        <td>{p.barsHeld ?? '—'}</td>
                        <td>{fmtNum(p.entryPrice, 2)}</td>
                        <td>{fmtNum(p.exitPrice, 2)}</td>
                        <td style={{ color: p.status === 'missed' ? 'var(--text-dim)' : p.status === 'be' ? AMBER : (p.profitR ?? 0) >= 0 ? BULL : BEAR }}>
                          {p.status === 'missed' ? '—' : fmtR(p.profitR)}
                        </td>
                        <td>{p.maxPullupR   != null ? fmtNum(p.maxPullupR)   : '—'}</td>
                        <td>{p.maxDrawdownR != null ? fmtNum(p.maxDrawdownR) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {rows.length > maxRows && (
              <button className={styles.moreBtn} onClick={() => setMaxRows(m => m + 500)}>
                Afficher plus ({rows.length - maxRows} restantes)
              </button>
            )}
          </section>
        </main>
      )}
    </div>
  );
}
