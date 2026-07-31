// /rapports — visionneuse des rapports JSON de positions (boutons « Rapports »
// et « KO » du graphe). Tout se passe côté client : on dépose le fichier, la page
// recalcule stats, distributions et études BE / trailing à partir des positions
// qu'il contient. Elle ne connaît aucun motif en particulier — il lui faut un
// tableau `positions` et un `params.tpPts`, ce que produisent aussi bien le
// rapport rFVG que le rapport KO ou celui de la pince liq.
//
// TOUT SE COMPTE EN POINTS. Le stop de ces stratégies est STRUCTUREL — sous ou
// sur l'extrême de bougies du motif, que ce soit les deux dernières (rFVG, KO) ou
// toutes (liq) : le risque varie fortement d'une position à
// l'autre. Le lot, lui, est FIXE — c'est donc le gain en points qui est
// proportionnel au résultat réel. Compter en R supposerait qu'on redimensionne
// la position à chaque trade pour risquer le même montant, ce que la stratégie
// ne fait pas. Le seuil de rentabilité affiché est celui effectivement réalisé
// (perte moyenne / (gain moyen + perte moyenne)), pas un 1/(1+RR) qui n'a de
// sens qu'à risque constant.
//
// Les deux études s'appuient sur les excursions du rapport et affichent des
// BORNES, pas des vérités : l'ordre intra-vie des excursions est inconnu.
//   • Break-even (borne OPTIMISTE) : une perdante dont le pullup a atteint le
//     déclencheur est comptée sauvée (elle ne coûte plus rien) — c'est certain,
//     le pullup des perdantes exclut la bougie du stop ; les gagnantes sont
//     supposées intactes, ce qui, lui, est optimiste.
//   • SL plafonné (borne PESSIMISTE) : une gagnante dont le drawdown a atteint
//     le plafond est comptée tuée — pessimiste, la chaleur est supposée venir
//     avant le TP ; une perdante ne coûte plus que le plafond.

import { useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import styles from '../styles/rapports.module.css';
import { computeStats } from '../lib/signals/stats';

const BULL   = '#26A69A';
const BEAR   = '#EF5350';
const ORANGE = '#FB923C';
const BLUE   = '#60A5FA';
const MUTED  = '#94A3B8';

const AMBER = '#F59E0B';

const STATUS_META = {
  tp:      { label: 'TP',      color: BULL },
  sl:      { label: 'SL',      color: BEAR },
  be:      { label: 'BE',      color: AMBER },
  // Sortie sur plafond de durée (maxBars) : elle n'existe que dans les rapports
  // produits par l'optimiseur, pas dans ceux du graphe. Sans cette entrée elle
  // s'afficherait « Ouverte », c'est-à-dire l'inverse de ce qu'elle est.
  timeout: { label: 'Durée',   color: ORANGE },
  missed:  { label: 'Ratée',   color: MUTED },
  open:    { label: 'Ouverte', color: BLUE },
};

const fmtDate = iso => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
    + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
};
// Le P&L se compte en POINTS : le lot est fixe, c'est lui qui est
// proportionnel au gain réel. Le R supposerait une position redimensionnée
// à chaque trade pour risquer le même montant.
const fmtP   = v => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)} pts`;
const fmtPct = v => v == null ? '—' : `${(v * 100).toFixed(1)} %`;
const fmtNum = (v, d = 2) => v == null ? '—' : v.toFixed(d);
// Facteur de profit : ∞ quand il n'y a aucune perte — le dire plutôt que le taire.
const fmtPF  = v => v == null ? '—' : (Number.isFinite(v) ? v.toFixed(2) : '∞');
// Max par réduction : Math.max(...tableau) fait sauter la pile d'appel dès
// quelques dizaines de milliers d'éléments, ce qu'un rapport 1m atteint.
const maxOf  = (floor, a) => a.reduce((m, v) => v > m ? v : m, floor);

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

// ── Courbe de points cumulés (positions résolues, dans l'ordre d'entrée) ────
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
            <text x={PL - 7} y={y(t) + 3} textAnchor="end" className={styles.axisLabel}>{t}</text>
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
          trade {fmtP(points[hover.i].r)} · cumul <b>{fmtP(points[hover.i].cum)}</b>
        </div>
      )}
    </div>
  );
}

// ── Histogramme d'excursions (une seule série, une seule teinte) ────────────
function Histogram({ values, color, maxX, unit = 'pts' }) {
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

  // Tout est redérivé des positions — le rapport reste la seule source. Le calcul
  // lui-même vit dans lib/signals/stats.js, partagé avec les pages /rfvg et /ko
  // deux implémentations finiraient par donner deux chiffres pour le même
  // rapport, et il n'y aurait aucun moyen de savoir lequel croire.
  const d = useMemo(() => {
    if (!report) return null;
    const pos    = report.positions;
    const params = report.params ?? {};
    const tpPts  = params.tpPts ?? 0;

    const s = computeStats(pos, { tpPts, riskFallback: params.slPts ?? 0 });
    const beOn = (params.beTriggerPts ?? 0) > 0 || s.be > 0;
    const byId = new Map(pos.map(p => [p.id, p]));

    return {
      ...s, pos, params, tpPts, beOn,
      // La page nommait ces champs autrement avant l'extraction ; on garde ses
      // noms côté rendu plutôt que de réécrire tout le JSX.
      beN: s.be, be: s.beThresh,
      durMed: s.barsHeldMedian, durMean: s.barsHeldMean, durMax: s.barsHeldMax,
      touchMean: s.entryTouchesMean, touchMax: s.entryTouchesMax,
      // La courbe affiche une date lisible : le rapport porte l'ISO (entryDate),
      // le simulateur seulement l'epoch — on retombe sur l'un ou l'autre.
      equity: s.equity.map(pt => ({
        id: pt.id, r: pt.pts, cum: pt.cum,
        date: byId.get(pt.id)?.entryDate ?? new Date(pt.time * 1000).toISOString(),
      })),
    };
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
    ['risk0', 'Risque (pts)'], ['rr', 'RR'], ['barsHeld', 'Durée (bougies)'], ['entryTouches', "Retours sur l'entrée"],
    ['entryPrice', 'Prix entrée'], ['exitPrice', 'Prix sortie'],
    ['profitPoints', 'Profit brut (pts)'], ['netPoints', 'Profit net (pts)'],
    ['maxPullupPts', 'Pullup max (pts)'], ['maxDrawdownPts', 'Drawdown max (pts)'],
  ];

  return (
    <div className={styles.page}>
      <Head><title>Rapports de positions — Grapher</title></Head>

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
        <span className={styles.headerTitle}>RAPPORTS DE POSITIONS</span>
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
          <span className={styles.dropTitle}>Dépose un rapport rFVG, KO ou liq</span>
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

          {/* Cooldown : signaux sautés (hors rapport, juste comptés au calcul) */}
          {(report.stats?.skippedByCooldown ?? 0) > 0 && (
            <p className={styles.cardSub} style={{ marginTop: -4 }}>
              Cooldown actif : <b>{report.stats.skippedByCooldown}</b> signal(aux) sauté(s) après un TP,
              dont <b>{report.stats.skippedWon}</b> auraient gagné. Ces trades ne sont pas dans le rapport
              ci-dessous — seulement les <b>{d.pos.length}</b> réellement pris.
            </p>
          )}

          {/* Tuiles */}
          <div className={styles.tiles}>
            <Tile label="Positions" value={d.pos.length}
              sub={d.byStatus.missed.length
                ? `${d.byStatus.missed.length} ratée(s) · ${d.byStatus.open.length} ouverte(s)`
                : `${d.byStatus.open.length} ouverte(s)`} />
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
              sub={d.be != null ? `TP/(TP+SL) · seuil de rentabilité réalisé : ${fmtPct(d.be)}` : 'TP/(TP+SL)'} />
            <Tile label="Risque médian" value={d.riskMed != null ? `${fmtNum(d.riskMed, 1)} pts` : '—'}
              sub={d.risks.length
                ? `TP ${d.tpPts} pts · étendue ${fmtNum(d.risks[0], 1)} → ${fmtNum(d.risks[d.risks.length - 1], 1)} pts`
                : `TP ${d.tpPts} pts · SL structurel`} />
            <Tile label="Espérance" value={fmtP(d.expPts)}
              color={d.expPts != null ? (d.expPts >= 0 ? BULL : BEAR) : undefined}
              sub={`par position résolue${d.beOn ? ', BE incl.' : ''}, spread 0`} />
          </div>

          {/* Performance — tout en points : le lot est fixe */}
          <div className={styles.tiles}>
            <Tile label="Facteur de profit" value={fmtPF(d.profitFactor)}
              color={d.profitFactor != null ? (d.profitFactor >= 1 ? BULL : BEAR) : undefined}
              sub="gains bruts / pertes brutes, en points" />
            <Tile label="Points nets" value={fmtP(d.netPts)}
              color={d.netPts >= 0 ? BULL : BEAR}
              sub={`${d.nWin} gagnante(s) · ${d.nLoss} perdante(s)`} />
            <Tile label="Gain moyen" value={fmtP(d.avgWin)} color={BULL}
              sub={d.avgLoss != null ? `perte moyenne ${fmtP(-d.avgLoss)}` : 'aucune perte'} />
            <Tile label="Drawdown max" value={fmtP(-d.maxDD)} color={BEAR}
              sub="creux maximal de la courbe cumulée" />
            <Tile label="Pertes d'affilée" value={d.maxLossStreak}
              sub="plus longue série, ordre d'entrée" />
            {/* Combien de SL il faut encaisser avant de retrouver un TP. La
                moyenne ne porte que sur les intervalles REFERMÉS par un TP ;
                ceux qui traînent après le dernier gain sont dits à part, sinon
                ils tireraient le chiffre vers le bas sans qu'on sache de combien. */}
            <Tile label="SL entre deux TP"
              value={d.slPerTpMean != null ? fmtNum(d.slPerTpMean, 2) : '—'}
              color={d.slPerTpMean != null && d.slPerTpMean >= 3 ? AMBER : undefined}
              sub={d.slGaps.length
                ? `en moyenne · pire ${d.slPerTpMax} · ${d.slGaps.length} intervalle${d.slGaps.length > 1 ? 's' : ''}`
                  + (d.slTrailing > 0 ? ` · ${d.slTrailing} SL depuis le dernier TP` : '')
                : d.slTrailing > 0
                  ? `aucun TP — ${d.slTrailing} SL depuis le début`
                  : 'aucune position résolue'} />
            <Tile label="Durée médiane" value={d.durMed != null ? `${fmtNum(d.durMed, 1)} b.` : '—'}
              sub={d.durations.length
                ? `moyenne ${fmtNum(d.durMean, 1)} · max ${d.durMax} bougies`
                : 'aucune position résolue'} />
            <Tile label="Résolues dans B4" value={`${d.onEntryBar} / ${d.resolvedAll}`}
              color={d.onEntryBar > 0 ? AMBER : undefined}
              sub="ouvertes et fermées dans la bougie d'entrée, donc sans stop actif" />
            <Tile label="Retours sur l'entrée" value={d.touchMean != null ? fmtNum(d.touchMean, 2) : '—'}
              sub={d.touches.length
                ? `en moyenne · max ${d.touchMax} · ${d.neverReturned} sans retour`
                : 'aucune position résolue'} />
          </div>

          {/* Courbe de points cumulés */}
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Points cumulés</h2>
            <p className={styles.cardSub}>Somme des profits en points des positions résolues, dans l'ordre chronologique d'entrée. Lot fixe : chaque point pèse pareil, quel que soit le risque de la position.</p>
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
                {' '}Moyenne : <b style={{ color: BEAR }}>{fmtNum(d.avgMfeLosers, 1)} pts</b>.
              </p>
              <Histogram values={d.mfeLosers} color={BEAR} maxX={maxOf(0.1, d.mfeLosers)} unit="pts" />
            </section>
            <section className={styles.card}>
              <h2 className={styles.cardTitle} style={{ color: BULL }}>Drawdown max des gagnantes (TP)</h2>
              <p className={styles.cardSub}>
                La chaleur que chaque gagnante a prise avant d'atteindre le TP —
                la limite du break-even : une barre à droite est une gagnante
                qu'un BE ou un stop resserré aurait tuée.
                {' '}Moyenne : <b style={{ color: BULL }}>{fmtNum(d.avgMaeWinners, 1)} pts</b>.
              </p>
              <Histogram values={d.maeWinners} color={BULL} maxX={maxOf(0.1, d.maeWinners)} unit="pts" />
            </section>
          </div>

          {/* Études BE / SL resserré */}
          <div className={styles.twoCol}>
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Étude break-even <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}>— borne optimiste</span></h2>
              <p className={styles.cardSub}>
                SL remonté à l'entrée dès que le profit atteint le déclencheur, exprimé en
                points — reportable tel quel dans le panneau. Les perdantes sauvées sont
                certaines (leur pullup exclut la bougie du stop) ; les gagnantes sont supposées
                intactes, ce qui est optimiste. Compté en points, sauver une grosse perdante
                rapporte plus que sauver une petite.
                {d.beOn && (
                  <> <b style={{ color: AMBER }}>Ce rapport a déjà un BE appliqué</b>
                  {' '}({[
                    (d.params.beTriggerPts ?? 0) > 0 && `profit ${d.params.beTriggerPts} pts`,
                    (d.params.beTouchTrigger ?? 0) > 0 && `coupe à ${d.params.beTouchTrigger} retour(s)`,
                    (d.params.beBarsTrigger ?? 0) > 0 && `${d.params.beBarsTrigger} bougies`,
                  ].filter(Boolean).join(', ') || 'seuil inconnu'}, niveau {d.params.beLevelPts ?? 0} pts) :
                  les études ne portent que sur les positions TP/SL restantes, les sorties BE en
                  sont exclues.</>
                )}
              </p>
              <table className={styles.studyTable}>
                <thead><tr><th>Déclencheur</th><th>Perdantes sauvées</th><th>%</th><th>Espérance</th></tr></thead>
                <tbody>
                  <tr className={styles.baseRow}>
                    <td>sans BE</td><td>—</td><td>—</td><td>{fmtP(d.expWL)}</td>
                  </tr>
                  {d.beStudy.map(r => (
                    <tr key={r.t} className={r === d.bestBe ? styles.bestRow : ''}>
                      <td>{fmtNum(r.t, 1)} pts</td>
                      <td>{r.saved} / {d.sl}</td>
                      <td>{fmtPct(r.pct)}</td>
                      <td>{fmtP(r.exp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Étude SL plafonné <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}>— borne pessimiste</span></h2>
              <p className={styles.cardSub}>
                Et si le stop structurel était BORNÉ à une distance maximale ? Une gagnante dont
                le drawdown atteint le plafond est comptée tuée (chaleur supposée venir avant le
                TP) ; une perdante ne coûte plus que le plafond. La chaleur lue est celle de la
                fenêtre où le stop existe (B5 → sortie) : pendant B4 la position n'est pas
                protégée, aucun plafond ne s'y déclencherait. Les paliers suivent les déciles du
                risque observé — au dernier, plus rien n'est plafonné.
              </p>
              <table className={styles.studyTable}>
                <thead><tr><th>Plafond</th><th>Positions rognées</th><th>Gagnantes tuées</th><th>Espérance</th></tr></thead>
                <tbody>
                  {d.slStudy.map((r, i) => (
                    <tr key={r.d} className={r === d.bestSl ? styles.bestRow : (i === d.slStudy.length - 1 ? styles.baseRow : '')}>
                      <td>{fmtNum(r.d, 1)} pts{i === d.slStudy.length - 1 ? ' (aucun)' : ''}</td>
                      <td>{r.capped} / {d.resolved}</td>
                      <td>{r.killed} / {d.tp}</td>
                      <td>{fmtP(r.exp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>

          <p className={styles.caveat}>
            Mesures en échantillon, à spread nul, avec SL prioritaire dans la bougie. Tout est
            compté en POINTS : le lot étant fixe, c'est lui qui est proportionnel au gain réel —
            compter en R supposerait qu'on redimensionne la position à chaque trade pour risquer
            le même montant. Le risque en points varie fortement d'une position à l'autre (stop
            structurel) : la tuile « Risque médian » en donne l'étendue, et le seuil de
            rentabilité affiché est celui effectivement réalisé, tiré des gains et pertes moyens.
            Les deux études sont des bornes construites sur des
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
                ...(d.byStatus.missed.length ? [['missed', `Ratées (${d.byStatus.missed.length})`]] : []),
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
                        <td>{p.risk0 != null ? fmtNum(p.risk0) : '—'}</td>
                        <td>{p.rr != null ? fmtNum(p.rr) : '—'}</td>
                        <td>{p.barsHeld ?? '—'}</td>
                        <td>{p.entryTouches ?? '—'}</td>
                        <td>{fmtNum(p.entryPrice, 2)}</td>
                        <td>{fmtNum(p.exitPrice, 2)}</td>
                        <td style={{ color: p.status === 'missed' ? 'var(--text-dim)' : p.status === 'be' ? AMBER : (p.profitPoints ?? 0) >= 0 ? BULL : BEAR }}>
                          {p.status === 'missed' ? '—' : fmtP(p.profitPoints)}
                        </td>
                        {/* Net = brut − spread de CETTE position. Absent des
                            rapports antérieurs au champ : tiret, pas un faux zéro. */}
                        <td style={{ color: p.netPoints == null || p.status === 'missed' ? 'var(--text-dim)' : p.netPoints >= 0 ? BULL : BEAR }}>
                          {p.status === 'missed' || p.netPoints == null ? '—' : fmtP(p.netPoints)}
                        </td>
                        <td>{p.maxPullupPts   != null ? fmtNum(p.maxPullupPts, 1)   : '—'}</td>
                        <td>{p.maxDrawdownPts != null ? fmtNum(p.maxDrawdownPts, 1) : '—'}</td>
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
