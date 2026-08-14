// /rapports — visionneuse des rapports JSON de positions (boutons « Rapports »
// et « KO » du graphe). Tout se passe côté client : on dépose le fichier, la page
// recalcule stats, distributions et études BE / trailing à partir des positions
// qu'il contient. Elle ne connaît aucun motif en particulier — il lui faut un
// tableau `positions` et un `params.tpPts`, ce que produisent aussi bien le
// rapport rFVG que le rapport KO ou celui de la pince liq.
//
// L'ARGENT SE COMPTE EN DOLLARS, LES DISTANCES EN POINTS. Le rapport, lui, ne
// contient que des points : le PRIX DU POINT réglé en haut de page (« 20 pts =
// 100 $ », 1 pt = 1 $ par défaut) les convertit à l'affichage. Rien n'est
// recalculé — c'est un facteur, appliqué au rendu seulement, et le seul endroit
// où il vit est cette page.
//   • en $  : tout ce qui est un RÉSULTAT — espérance, résultat net, gain et
//     perte moyens, drawdown, courbe cumulée, profits des positions, et
//     l'espérance des deux études ;
//   • en pts : tout ce qui est une DISTANCE DE PRIX — risque, TP, excursions,
//     déclencheur de break-even, plafond de stop. Ces chiffres se reportent tels
//     quels dans les panneaux de réglage, les convertir les rendrait inutiles.
// Les ratios (winrate, facteur de profit, seuil de rentabilité, RR) ne changent
// pas : le prix du point les multiplie en haut comme en bas.
//
// Le stop de ces stratégies est STRUCTUREL — sous ou sur l'extrême de bougies du
// motif, que ce soit les deux dernières (rFVG, KO) ou toutes (liq) : le risque
// varie fortement d'une position à l'autre. Le lot, lui, est FIXE — c'est donc le
// gain en points, converti en $ à taux constant, qui est proportionnel au
// résultat réel. Compter en R supposerait qu'on redimensionne la position à
// chaque trade pour risquer le même montant, ce que la stratégie ne fait pas. Le
// seuil de rentabilité affiché est celui effectivement réalisé (perte moyenne /
// (gain moyen + perte moyenne)), pas un 1/(1+RR) qui n'a de sens qu'à risque
// constant.
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

import { useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import styles from '../styles/rapports.module.css';
import { computeStats } from '../lib/signals/stats';
import MonteCarloCard from '../components/rapports/MonteCarloCard';
import {
  fmtDate, fmtPct, fmtNum, fmtUsd, fmtAbs, fmtRate, fmtP, fmtTick, fmtPF,
} from '../lib/reportFormat';

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

// ── Argent ───────────────────────────────────────────────────────────────────
// Le rapport ne contient QUE des points ; le prix du point les convertit à
// l'affichage. Les FORMATEURS eux-mêmes vivent dans lib/reportFormat.js depuis
// que la carte Monte-Carlo a eu besoin des mêmes : deux jeux auraient fini par
// écrire deux nombres différents pour la même valeur, dans la même page.
const PV_KEY = 'grapher.rapports.pointValue';
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

// ── Courbe du résultat cumulé, en $ (positions résolues, ordre d'entrée) ────
// Les points arrivent DÉJÀ convertis : le prix du point est un facteur constant,
// la forme de la courbe ne change donc pas, seule l'échelle le fait.
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
            <text x={PL - 7} y={y(t) + 3} textAnchor="end" className={styles.axisLabel}>{fmtTick(t)}</text>
          </g>
        ))}
        <path d={`${path}L${x(points.length - 1)},${y(Math.max(0, yMin))}L${x(0)},${y(Math.max(0, yMin))}Z`}
          fill={BLUE} opacity="0.07" />
        <path d={path} fill="none" stroke={BLUE} strokeWidth="2" strokeLinejoin="round" />
        {/* L'unité est en bas à gauche : au-dessus de l'axe elle tomberait pile
            sur la graduation du maximum. */}
        <text x={PL - 7} y={H - PB + 12} textAnchor="end" className={styles.axisLabel}>$</text>
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
          trade {fmtUsd(points[hover.i].r)} · cumul <b>{fmtUsd(points[hover.i].cum)}</b>
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

// ── Prix du point ────────────────────────────────────────────────────────────
// « 20 pts = 100 $ » plutôt qu'un seul champ « $ par point » : c'est la forme
// dans laquelle un broker l'annonce, et 20 → 100 se lit sans diviser de tête.
// Les deux champs restent des CHAÎNES tant qu'on tape — un champ vidé doit
// pouvoir l'être, ce qu'un nombre contrôlé interdit.
function PointValueBar({ pv, onChange, ppp }) {
  const set = (k, v) => onChange({ ...pv, [k]: v });
  const dflt = ppp === 1;
  return (
    <div className={styles.pvBar}>
      <span className={styles.pvLabel}>Prix du point</span>
      <input className={styles.pvInput} type="number" min="0" step="any" value={pv.pts}
        onChange={e => set('pts', e.target.value)} aria-label="points" />
      <span className={styles.pvOp}>pts =</span>
      <input className={styles.pvInput} type="number" step="any" value={pv.usd}
        onChange={e => set('usd', e.target.value)} aria-label="dollars" />
      <span className={styles.pvOp}>$</span>
      <span className={styles.pvOut}>
        soit <b>{fmtRate(ppp)} $</b> le point{dflt && ' (défaut)'}
      </span>
      {!dflt && (
        <button className={styles.pvReset} onClick={() => onChange({ pts: '1', usd: '1' })}>
          1 pt = 1 $
        </button>
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
  // Prix du point : 1 pt = 1 $ par défaut, donc un rapport déposé sans y toucher
  // s'affiche avec les chiffres du rapport. Relu du stockage APRÈS le montage et
  // pas dans l'initialisation d'état : lu côté serveur, localStorage n'existe pas,
  // et une valeur enregistrée ferait diverger le premier rendu de l'hydratation.
  const [pv, setPv] = useState({ pts: '1', usd: '1' });
  useEffect(() => {
    try {
      const o = JSON.parse(localStorage.getItem(PV_KEY) ?? 'null');
      if (o && o.pts != null && o.usd != null) setPv({ pts: String(o.pts), usd: String(o.usd) });
    } catch { /* stockage illisible ou refusé : on garde 1 pt = 1 $ */ }
  }, []);
  const changePv = next => {
    setPv(next);
    try { localStorage.setItem(PV_KEY, JSON.stringify(next)); } catch { /* idem */ }
  };
  // Le facteur. Un champ vide ou absurde retombe sur 1 plutôt que sur NaN ou une
  // division par zéro : la page continue d'afficher des chiffres pendant la
  // frappe, et le champ vide se voit à l'écran.
  const ppp = useMemo(() => {
    const pts = Number(pv.pts), usd = Number(pv.usd);
    return pts > 0 && Number.isFinite(usd) ? usd / pts : 1;
  }, [pv]);
  // Points → dollars. Le seul endroit où la conversion se fait.
  const usd = v => v == null ? null : v * ppp;

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

    // L'OBJECTIF N'EST PAS LU DANS LES RÉGLAGES. Il l'était (`params.tpPts`), et
    // ça mentait dès qu'il variait : un TP réglé en ATR laisse `tpMode` sur
    // 'points' et un `tpPts` inutilisé dans les réglages, un dû armé remplace la
    // cible, le TP dynamique la repousse. computeStats prend donc la MÉDIANE de
    // ce que les positions ont réellement visé — c'est elle qui sert au RR médian
    // comme à la grille de l'étude break-even. `params.tpPts` ne reste qu'un
    // repli pour un rapport si ancien que ses positions n'ont pas de `tp`.
    const anyTp = pos.some(p => p.tp != null && p.entryPrice != null);
    const s = computeStats(pos, {
      tpPts: anyTp ? 0 : (params.tpPts ?? 0),
      riskFallback: params.slPts ?? 0,
    });
    const tpPts = s.tpPts;
    // Un BE est « actif » soit parce qu'un réglage l'annonce, soit parce que des
    // sorties BE existent. Les motifs n'ont pas le même réglage : seuil en points
    // (rFVG), en R (famille liq), ou distance de retour du BE du malsain ($$$).
    const beOn = (params.beTriggerPts ?? 0) > 0 || (params.beTriggerR ?? 0) > 0
      || (params.beUnhealthyPts ?? 0) > 0 || (params.beUnhealthyAtr ?? 0) > 0
      || s.be > 0;
    const byId = new Map(pos.map(p => [p.id, p]));

    // COMBIEN DE POSITIONS ONT COURU EN MÊME TEMPS. La courbe additionne des
    // résultats dans l'ordre des ENTRÉES ; tant que les positions ne se
    // chevauchent pas, c'est exactement la suite des encaissements d'un compte.
    // Dès qu'elles se chevauchent, ce n'en est plus une — et le creux maximal lu
    // dessus n'est plus celui qu'un compte aurait subi. Ce chiffre dit si la
    // réserve mord ou non, plutôt que de laisser le lecteur le deviner.
    const spans = pos
      .filter(p => p.entryTime != null && p.exitDate != null)
      .map(p => ({ e: p.entryTime, x: Date.parse(p.exitDate) / 1000 }))
      .sort((a, b) => a.e - b.e);
    let maxSim = 0;
    const ouvertes = [];
    for (const sp of spans) {
      while (ouvertes.length && ouvertes[0] < sp.e) ouvertes.shift();
      ouvertes.push(sp.x);
      ouvertes.sort((a, b) => a - b);
      if (ouvertes.length > maxSim) maxSim = ouvertes.length;
    }

    // LA TAILLE DE POSITION VARIE-T-ELLE ? Tant qu'elle ne varie pas, tout ce
    // qui suit se lit comme depuis toujours. Dès qu'elle varie, deux unités
    // cohabitent dans cette page — le résultat du COMPTE (avec le lot) et celui
    // de la STRATÉGIE (à 1 lot) — et il faut le dire, sans quoi on comparerait
    // des chiffres qui ne parlent pas de la même chose.
    const lots = pos.map(p => p.lot).filter(v => v != null);
    const lotsVarient = lots.length > 0 && new Set(lots).size > 1;
    const lotMax = lots.length ? Math.max(...lots) : 1;

    return {
      ...s, pos, params, tpPts, beOn, maxSim, lotsVarient, lotMax,
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

  // La courbe se trace en $. La conversion vit ICI, hors du calcul des stats :
  // changer le prix du point ne doit pas rejouer tout le rapport.
  const equityUsd = useMemo(
    () => d ? d.equity.map(pt => ({ ...pt, r: pt.r * ppp, cum: pt.cum * ppp })) : [],
    [d, ppp],
  );

  // LA SÉRIE DONNÉE AU MONTE-CARLO : les résultats nets par position résolue,
  // en POINTS et dans l'ordre d'entrée — le même ordre, les mêmes chiffres que
  // la courbe ci-dessus. En points et pas en dollars, exprès : la simulation est
  // linéaire en son entrée, donc convertir avant reviendrait à la rejouer
  // entièrement à chaque frappe dans le champ « prix du point ».
  //
  // À 1 LOT dès que les tailles varient. Rebattre des résultats déjà multipliés
  // par un lot en escalier accrocherait le lot du 300e trade au résultat du 12e :
  // ce serait mesurer le calendrier des lots, pas la stratégie. Tant que le lot
  // vaut 1 partout — c'est-à-dire partout sauf en escalier — les deux séries
  // sont le même tableau.
  const mcGains = useMemo(() => {
    if (!d) return [];
    if (!d.lotsVarient) return d.equity.map(pt => pt.r);
    const byId = new Map(d.pos.map(p => [p.id, p]));
    return d.equity.map(pt => byId.get(pt.id)?.netPoints1 ?? pt.r);
  }, [d]);

  const sortBy = key => setSortKey(s => ({ key, dir: s.key === key ? -s.dir : -1 }));

  const COLS = [
    ['id', '#'], ['direction', 'Dir'], ['status', 'Statut'], ['entryTime', 'Entrée'],
    // La colonne Lot n'apparaît que si les tailles VARIENT : à lot fixe elle ne
    // dirait que « 1 » sur toute la hauteur.
    ...(d?.lotsVarient ? [['lot', 'Lot']] : []),
    ['risk0', 'Risque (pts)'], ['rr', 'RR'], ['barsHeld', 'Durée (bougies)'], ['entryTouches', "Retours sur l'entrée"],
    ['entryPrice', 'Prix entrée'], ['exitPrice', 'Prix sortie'],
    ['profitPoints', 'Profit brut ($)'], ['netPoints', 'Profit net ($)'],
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
          <span className={styles.dropTitle}>Dépose un rapport de positions</span>
          <span className={styles.dropBody}>
            Glisse ici le fichier JSON téléchargé avec le bouton « Rapports » du graphe,
            ou clique pour le choisir. Tout est analysé localement, rien n'est envoyé.
          </span>
          {error && <span className={styles.dropError}>{error}</span>}
        </div>
      ) : d && (
        <main className={styles.main}>
          {/* Prix du point : il commande toute la colonne des $ ci-dessous, donc
              il est en HAUT — un facteur qu'on découvre après avoir lu les
              chiffres est un facteur qu'on n'a pas appliqué. */}
          <PointValueBar pv={pv} onChange={changePv} ppp={ppp} />

          {/* Paramètres du run */}
          <div className={styles.chips}>
            {Object.entries(d.params).map(([k, v]) => (
              <span key={k} className={styles.chip}>{k} <b>{String(v)}</b></span>
            ))}
          </div>

          {/* Taille de position variable : deux unités cohabitent alors dans la
              page, et la confusion serait silencieuse sans ce bandeau. */}
          {d.lotsVarient && (
            <p className={styles.cardSub} style={{ marginTop: -4 }}>
              <b style={{ color: AMBER }}>Taille de position variable</b> (jusqu'à <b>×{d.lotMax}</b>) :
              deux lectures cohabitent ci-dessous. Le <b>résultat net</b>, la <b>courbe cumulée</b> et le
              {' '}<b>drawdown max</b> sont ceux du <b>compte</b>, lot compris — c'est ce qui a été
              gagné. Le <b>gain moyen</b>, la <b>perte moyenne</b>, le <b>facteur de profit</b>,
              {' '}l'<b>espérance</b>, le <b>seuil de rentabilité</b> et les <b>deux études</b> sont
              ramenés à <b>1 lot</b> : ils jugent la stratégie, et les pondérer par le lot
              reviendrait à les régler sur l'ordre dans lequel les trades sont tombés. Le total net
              ne vaut donc plus l'espérance × le nombre de positions, et c'est normal.
            </p>
          )}

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
            {/* EN POINTS, et pas en $ : c'est une distance de prix, elle se
                reporte telle quelle dans un panneau de réglage. Sa contrepartie
                en argent est dite en sous-titre quand le point ne vaut pas 1 $.
                Le TP affiché est la MÉDIANE de ce que les positions ont visé, pas
                le réglage : les deux coïncident à objectif fixe et divergent dès
                qu'il varie (TP en ATR, dû armé, cible repoussée). */}
            <Tile label="Risque médian" value={d.riskMed != null ? `${fmtNum(d.riskMed, 1)} pts` : '—'}
              sub={(d.risks.length
                ? `TP médian ${fmtNum(d.tpPts, 1)} pts · risque de ${fmtNum(d.risks[0], 1)} à ${fmtNum(d.risks[d.risks.length - 1], 1)} pts`
                : `TP médian ${fmtNum(d.tpPts, 1)} pts`)
                + (ppp !== 1 && d.riskMed != null ? ` · soit ${fmtAbs(usd(d.riskMed))} de risque médian` : '')} />
            {/* Le spread n'est PAS supposé nul : le simulateur l'applique
                position par position et le rapport porte le net. La tuile disait
                « spread 0 » alors qu'elle affichait déjà du net — elle dit
                maintenant ce que le rapport contient. */}
            <Tile label="Espérance" value={fmtUsd(usd(d.expPts))}
              color={d.expPts != null ? (d.expPts >= 0 ? BULL : BEAR) : undefined}
              sub={`par position résolue${d.beOn ? ', BE incl.' : ''} · net`
                + ((d.params.spreadPts ?? 0) > 0 ? `, spread ${d.params.spreadPts} pts` : ', spread 0')
                + (ppp !== 1 && d.expPts != null ? ` · ${fmtP(d.expPts)}` : '')} />
          </div>

          {/* Performance — les RÉSULTATS en $, au prix du point réglé ci-dessus */}
          <div className={styles.tiles}>
            {/* Un RATIO : le prix du point multiplie le numérateur comme le
                dénominateur, il ne le bouge pas d'un iota. */}
            <Tile label="Facteur de profit" value={fmtPF(d.profitFactor)}
              color={d.profitFactor != null ? (d.profitFactor >= 1 ? BULL : BEAR) : undefined}
              sub="gains bruts / pertes brutes — inchangé par le prix du point" />
            <Tile label="Résultat net" value={fmtUsd(usd(d.netPts))}
              color={d.netPts >= 0 ? BULL : BEAR}
              sub={`${d.nWin} gagnante(s) · ${d.nLoss} perdante(s)`
                + (ppp !== 1 ? ` · ${fmtP(d.netPts)}` : '')} />
            <Tile label="Gain moyen" value={fmtUsd(usd(d.avgWin))} color={BULL}
              sub={d.avgLoss != null ? `perte moyenne ${fmtUsd(usd(-d.avgLoss))}` : 'aucune perte'} />
            <Tile label="Drawdown max" value={fmtUsd(usd(-d.maxDD))} color={BEAR}
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

          {/* Courbe du résultat cumulé, en $ */}
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Résultat cumulé <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}>— en $</span></h2>
            <p className={styles.cardSub}>
              Somme des profits <b>nets</b> des positions résolues (TP, SL, BE et sorties
              en durée), dans l'ordre chronologique d'<b>entrée</b>, convertie à
              {' '}<b>{fmtRate(ppp)} $ le point</b>. Le spread est déjà déduit :
              c'est le net qui est tracé, pas le brut. Lot fixe : chaque point pèse pareil, quel que
              soit le risque de la position.
              {d.maxSim > 1 ? (
                <> <b style={{ color: AMBER }}>Jusqu'à {d.maxSim} positions ont couru en même temps</b> :
                {' '}la courbe additionne donc des trades simultanés en les rangeant à leur date
                d'entrée, ce qui n'est pas la suite des encaissements d'un compte. Le
                {' '}<b>drawdown max</b> lu ici est à ce titre <b>optimiste</b> — un compte unique
                aurait porté ces pertes ensemble.</>
              ) : (
                <> Aucune position n'en a chevauché une autre : la courbe est bien la suite des
                encaissements d'un compte unique.</>
              )}
            </p>
            <EquityChart points={equityUsd} />
          </section>

          {/* Monte-Carlo — juste sous la courbe, parce qu'il ne parle que d'elle :
              ce que ce chemin-là aurait pu être si les trades étaient tombés
              dans un autre ordre. */}
          <MonteCarloCard gains={mcGains} ppp={ppp} maxSim={d.maxSim} lotsVarient={d.lotsVarient} />

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
                intactes, ce qui est optimiste. L'espérance de chaque palier est en <b>$</b> ;
                le déclencheur, lui, reste en points — sauver une grosse perdante rapporte plus
                que sauver une petite.
                {d.beOn && (
                  <> <b style={{ color: AMBER }}>Ce rapport a déjà un BE appliqué</b>
                  {' '}({[
                    (d.params.beTriggerPts ?? 0) > 0 && `profit ${d.params.beTriggerPts} pts, niveau ${d.params.beLevelPts ?? 0} pts`,
                    (d.params.beTriggerR ?? 0) > 0 && `profit ${d.params.beTriggerR} R, niveau ${d.params.beLevelR ?? 0} R`,
                    (d.params.beTouchTrigger ?? 0) > 0 && `coupe à ${d.params.beTouchTrigger} retour(s)`,
                    (d.params.beBarsTrigger ?? 0) > 0 && `${d.params.beBarsTrigger} bougies`,
                    // Le BE du malsain ($$$) n'est pas un stop remonté mais une
                    // cible abaissée : le nommer autrement le ferait passer pour
                    // ce que l'étude ci-dessous simule, ce qu'il n'est pas.
                    (d.params.beUnhealthyPts ?? 0) > 0 && `BE du malsain, sortie à +${d.params.beUnhealthyPts} pts`,
                    (d.params.beUnhealthyAtr ?? 0) > 0 && `BE du malsain, sortie à +${d.params.beUnhealthyAtr} × ATR`,
                  ].filter(Boolean).join(', ') || 'réglage non reconnu'}) :
                  les études ne portent que sur les positions TP/SL restantes, les sorties BE en
                  sont exclues.</>
                )}
              </p>
              <table className={styles.studyTable}>
                <thead><tr><th>Déclencheur</th><th>Perdantes sauvées</th><th>%</th><th>Espérance ($)</th></tr></thead>
                <tbody>
                  <tr className={styles.baseRow}>
                    <td>sans BE</td><td>—</td><td>—</td><td>{fmtUsd(usd(d.expWL))}</td>
                  </tr>
                  {d.beStudy.map(r => (
                    <tr key={r.t} className={r === d.bestBe ? styles.bestRow : ''}>
                      <td>{fmtNum(r.t, 1)} pts</td>
                      <td>{r.saved} / {d.sl}</td>
                      <td>{fmtPct(r.pct)}</td>
                      <td>{fmtUsd(usd(r.exp))}</td>
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
                risque observé — au dernier, plus rien n'est plafonné. Le plafond est une distance,
                donc en points ; l'espérance qu'il produit est en <b>$</b>.
              </p>
              <table className={styles.studyTable}>
                <thead><tr><th>Plafond</th><th>Positions rognées</th><th>Gagnantes tuées</th><th>Espérance ($)</th></tr></thead>
                <tbody>
                  {d.slStudy.map((r, i) => (
                    <tr key={r.d} className={r === d.bestSl ? styles.bestRow : (i === d.slStudy.length - 1 ? styles.baseRow : '')}>
                      <td>{fmtNum(r.d, 1)} pts{i === d.slStudy.length - 1 ? ' (aucun)' : ''}</td>
                      <td>{r.capped} / {d.resolved}</td>
                      <td>{r.killed} / {d.tp}</td>
                      <td>{fmtUsd(usd(r.exp))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>

          <p className={styles.caveat}>
            Mesures en échantillon, avec SL prioritaire dans la bougie. Le spread est celui du
            rapport, déjà déduit position par position : tout ce qui est affiché est du NET. Le
            rapport ne contient que des POINTS ; les <b>résultats</b> sont convertis à l'affichage
            au prix du point réglé en haut ({fmtRate(ppp)} $ le point), les <b>distances</b> — risque,
            TP, excursions, déclencheur de BE, plafond de stop — restent en points pour se reporter
            telles quelles dans les panneaux. Le lot étant fixe, le gain en points est
            proportionnel au gain réel : compter en R supposerait qu'on redimensionne la position à
            chaque trade pour risquer le même montant. Selon le motif, le risque est constant
            (stop en points) ou variable
            (stop structurel, stop en ATR) : la tuile « Risque médian » en donne l'étendue, et le
            seuil de rentabilité affiché est celui effectivement réalisé, tiré des gains et pertes
            moyens — jamais un 1/(1+RR), qui n'aurait de sens qu'à risque constant.
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
                        {d.lotsVarient && (
                          <td style={{ color: (p.lot ?? 1) > 1 ? AMBER : undefined, fontWeight: (p.lot ?? 1) > 1 ? 700 : undefined }}>
                            {p.lot == null ? '—' : `×${p.lot}`}
                          </td>
                        )}
                        <td>{p.risk0 != null ? fmtNum(p.risk0) : '—'}</td>
                        <td>{p.rr != null ? fmtNum(p.rr) : '—'}</td>
                        <td>{p.barsHeld ?? '—'}</td>
                        <td>{p.entryTouches ?? '—'}</td>
                        <td>{fmtNum(p.entryPrice, 2)}</td>
                        <td>{fmtNum(p.exitPrice, 2)}</td>
                        <td style={{ color: p.status === 'missed' ? 'var(--text-dim)' : p.status === 'be' ? AMBER : (p.profitPoints ?? 0) >= 0 ? BULL : BEAR }}>
                          {p.status === 'missed' ? '—' : fmtUsd(usd(p.profitPoints))}
                        </td>
                        {/* Net = brut − spread de CETTE position. Absent des
                            rapports antérieurs au champ : tiret, pas un faux zéro. */}
                        <td style={{ color: p.netPoints == null || p.status === 'missed' ? 'var(--text-dim)' : p.netPoints >= 0 ? BULL : BEAR }}>
                          {p.status === 'missed' || p.netPoints == null ? '—' : fmtUsd(usd(p.netPoints))}
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
