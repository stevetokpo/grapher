// CARTE MONTE-CARLO de /rapports — la distribution de ce que ces trades
// auraient pu donner, à côté de ce qu'ils ont donné.
//
// Toute l'arithmétique est dans lib/monteCarlo.js, y compris les mises en garde
// qui vont avec : ce fichier ne fait que la montrer. Il reçoit une série de
// résultats par trade EN POINTS, à 1 lot, dans l'ordre réel des entrées, et
// convertit en dollars au prix du point de la page — comme tout le reste.
//
// LE CHIFFRE À LIRE EN PREMIER n'est pas le drawdown médian, c'est le RANG du
// drawdown réel dans la distribution. Médian, il dit que l'ordre réel n'a rien
// eu de particulier. Au-delà du p95, il dit que les pertes se suivent — et donc
// que la distribution affichée juste à côté sous-estime le risque au lieu de le
// décrire, parce qu'elle repose sur l'hypothèse qu'elle vient de démentir.

import { useEffect, useState } from 'react';
import { runMonteCarlo, ruinProbability } from '../../lib/monteCarlo';
import { fmtUsd, fmtAbs, fmtPct, fmtNum, fmtTick } from '../../lib/reportFormat';
import styles from '../../styles/rapports.module.css';

const BULL  = '#26A69A';
const BEAR  = '#EF5350';
const AMBER = '#F59E0B';
const BLUE  = '#60A5FA';
const MUTED = '#94A3B8';

const DRAW_CHOICES = [500, 2000, 10000];

// Arrondi « présentable » vers le haut, pour proposer un capital de départ :
// 1 480 → 2 000, 37 → 40. Un capital suggéré à 1 483.27 $ ne se lit pas comme
// une suggestion, il se lit comme un résultat.
const nice = v => {
  if (!(v > 0)) return 0;
  const e = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / e) * e;
};

const pct1 = v => v == null ? '—' : `${(v * 100).toFixed(v < 0.01 && v > 0 ? 2 : 1)} %`;

// ── Le faisceau : l'enveloppe des tirages, et la courbe réelle dessus ────────
function ConeChart({ mc, ppp, mode }) {
  const [hover, setHover] = useState(null);
  const W = 1080, H = 260, PL = 52, PR = 12, PT = 14, PB = 28;

  const { band, checkpoints, observed, n } = mc;
  const k = checkpoints.length;

  // Domaine : les deux bords du faisceau, la courbe réelle, et zéro — sans quoi
  // une stratégie qui n'est jamais repassée sous l'eau se dessinerait avec un
  // axe qui commence à son premier gain, ce qui écrase tout le reste.
  let lo = 0, hi = 0;
  for (let i = 0; i < k; i++) {
    if (band.p5[i]  < lo) lo = band.p5[i];
    if (band.p95[i] > hi) hi = band.p95[i];
    if (observed.path[i] < lo) lo = observed.path[i];
    if (observed.path[i] > hi) hi = observed.path[i];
  }
  lo *= ppp; hi *= ppp;
  // Les GRADUATIONS portent les bornes réelles ; l'ÉCHELLE, elle, s'offre 3 % de
  // souffle en haut et en bas. Sans ce souffle le bord du faisceau colle au cadre
  // et se lit comme une courbe coupée plutôt que comme un maximum.
  const ticks = [...new Set([0, lo, hi].map(v => Math.round(v)))];
  const marge = ((hi - lo) || 1) * 0.03;
  lo -= marge; hi += marge;
  const span = hi - lo;

  const x = i => PL + (k === 1 ? 0 : (i / (k - 1)) * (W - PL - PR));
  const y = v => PT + (1 - (v - lo) / span) * (H - PT - PB);

  const line = arr => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v * ppp).toFixed(1)}`).join('');
  // Une bande = l'aller sur le bord haut, puis le retour sur le bord bas.
  const area = (top, bot) =>
    line(top)
    + bot.map((_, i) => `L${x(k - 1 - i).toFixed(1)},${y(bot[k - 1 - i] * ppp).toFixed(1)}`).join('')
    + 'Z';

  const onMove = e => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.max(0, Math.min(k - 1, Math.round(((px - PL) / (W - PL - PR)) * (k - 1))));
    setHover({ i, left: `${(x(i) / W) * 100}%`, top: `${(y(band.p50[i] * ppp) / H) * 100}%` });
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
        <path d={area(band.p95, band.p5)}  fill={MUTED} opacity="0.12" />
        <path d={area(band.p75, band.p25)} fill={MUTED} opacity="0.26" />
        <path d={line(band.p50)} fill="none" stroke={AMBER} strokeWidth="1.5" strokeDasharray="5,4" />
        <path d={line(observed.path)} fill="none" stroke={BLUE} strokeWidth="2.2" strokeLinejoin="round" />
        <text x={PL - 7} y={H - PB + 12} textAnchor="end" className={styles.axisLabel}>$</text>
        <text x={W - PR} y={H - 8} textAnchor="end" className={styles.axisLabel}>
          {n} positions résolues →
        </text>
        {hover && (
          <>
            <line x1={x(hover.i)} x2={x(hover.i)} y1={PT} y2={H - PB}
              stroke="rgba(148,163,184,0.4)" strokeWidth="1" />
            <circle cx={x(hover.i)} cy={y(observed.path[hover.i] * ppp)} r="4"
              fill={BLUE} stroke="var(--surface)" strokeWidth="2" />
          </>
        )}
      </svg>
      {hover && (
        <div className={styles.chartTooltip} style={{ left: hover.left, top: hover.top }}>
          après {checkpoints[hover.i] + 1} positions<br />
          réel <b style={{ color: BLUE }}>{fmtUsd(observed.path[hover.i] * ppp)}</b><br />
          p95 {fmtUsd(band.p95[hover.i] * ppp)} · médiane {fmtUsd(band.p50[hover.i] * ppp)} · p5 {fmtUsd(band.p5[hover.i] * ppp)}
        </div>
      )}
      <div className={styles.mcLegend}>
        <span><i className={styles.mcSwatch} style={{ background: BLUE }} /> courbe réelle</span>
        <span><i className={styles.mcSwatch} style={{ background: AMBER }} /> médiane des tirages</span>
        <span><i className={styles.mcSwatch} style={{ background: MUTED, opacity: 0.45 }} /> 50 % central (p25–p75)</span>
        <span><i className={styles.mcSwatch} style={{ background: MUTED, opacity: 0.22 }} /> 90 % central (p5–p95)</span>
        {mode === 'shuffle' && <span className={styles.mcNote}>le faisceau se referme à la fin : le total ne dépend pas de l'ordre</span>}
      </div>
    </div>
  );
}

// ── Histogramme d'une distribution simulée, avec repère sur la valeur réelle ──
// `values` arrive TRIÉ (c'est ce que rend lib/monteCarlo.js) : les bornes se
// lisent aux deux bouts sans reparcourir 10 000 nombres.
function McHistogram({ values, observed, color, fmt, discrete = false }) {
  const [hover, setHover] = useState(null);
  const W = 520, H = 190, PL = 34, PR = 10, PT = 16, PB = 30;

  const lo = values[0], hi = values[values.length - 1];
  // Une distribution plate (tous les tirages au même chiffre) n'a pas
  // d'histogramme : le dire plutôt que dessiner une barre unique trompeuse.
  if (!(hi > lo)) {
    return <p className={styles.cardSub}>Tous les tirages donnent {fmt(lo)} — rien à distribuer.</p>;
  }

  // Sur des entiers de faible amplitude (une série de pertes, un temps sous
  // l'eau), une barre PAR VALEUR : des classes continues sur des entiers
  // fabriquent des trous et des doubles selon où tombent les bords.
  const NB = discrete && hi - lo <= 30 ? Math.round(hi - lo) + 1 : 24;
  const bw = discrete && hi - lo <= 30 ? 1 : (hi - lo) / NB;
  const base = discrete && hi - lo <= 30 ? lo - 0.5 : lo;
  const bins = Array.from({ length: NB }, () => 0);
  for (const v of values) bins[Math.max(0, Math.min(NB - 1, Math.floor((v - base) / bw)))]++;
  const maxC = bins.reduce((m, c) => c > m ? c : m, 0);

  const bx = i => PL + (i / NB) * (W - PL - PR);
  const bwPx = (W - PL - PR) / NB;
  const by = c => PT + (1 - c / maxC) * (H - PT - PB);
  const xOf = v => PL + ((v - base) / (NB * bw)) * (W - PL - PR);

  const obsX = Math.max(PL, Math.min(W - PR, xOf(observed)));

  return (
    <div className={styles.chartWrap}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}
        onMouseLeave={() => setHover(null)}>
        <line x1={PL} x2={W - PR} y1={by(0)} y2={by(0)} stroke="rgba(26,37,64,0.8)" strokeWidth="1" />
        <text x={PL - 6} y={by(maxC) + 3} textAnchor="end" className={styles.axisLabel}>{maxC}</text>
        {bins.map((c, i) => (
          <rect key={i}
            x={bx(i) + (bwPx > 4 ? 1 : 0)} width={Math.max(1, bwPx - (bwPx > 4 ? 2 : 0))}
            y={by(c)} height={Math.max(0, by(0) - by(c))}
            rx={bwPx > 6 ? 2 : 0} fill={color} opacity={hover?.i === i ? 0.95 : 0.6}
            onMouseEnter={() => setHover({ i, left: `${((bx(i) + bwPx / 2) / W) * 100}%`, top: `${(by(c) / H) * 100}%` })}
          />
        ))}
        {/* La valeur RÉELLE, celle du rapport, posée sur la distribution : c'est
            la seule chose que le lecteur cherche dans cet histogramme. */}
        <line x1={obsX} x2={obsX} y1={PT - 6} y2={by(0)} stroke={BLUE} strokeWidth="2" />
        <text x={obsX} y={PT - 9} textAnchor={obsX > W * 0.7 ? 'end' : 'middle'}
          className={styles.axisLabel} style={{ fill: BLUE, fontWeight: 700 }}>réel</text>
        <text x={PL} y={H - 9} textAnchor="start" className={styles.axisLabel}>{fmt(lo)}</text>
        <text x={W - PR} y={H - 9} textAnchor="end" className={styles.axisLabel}>{fmt(hi)}</text>
      </svg>
      {hover && (
        <div className={styles.chartTooltip} style={{ left: hover.left, top: hover.top }}>
          {discrete && bw === 1
            ? <>{fmt(base + hover.i * bw + 0.5)}</>
            : <>[{fmt(base + hover.i * bw)} ; {fmt(base + (hover.i + 1) * bw)}]</>}
          {' '}: <b>{bins[hover.i]}</b> tirage{bins[hover.i] > 1 ? 's' : ''}
          {' '}({pct1(bins[hover.i] / values.length)})
        </div>
      )}
    </div>
  );
}

// ── La carte ────────────────────────────────────────────────────────────────
export default function MonteCarloCard({ gains, ppp, maxSim = 1, lotsVarient = false }) {
  const [mode, setMode] = useState('shuffle');
  const [draws, setDraws] = useState(2000);
  const [capital, setCapital] = useState('');

  const [mc, setMc] = useState(null);
  const [busy, setBusy] = useState(true);

  // APRÈS LA PEINTURE, pas pendant. Sur un rapport 1m — 8 000 positions × 2 000
  // tirages — la simulation prend près d'une seconde : dans un useMemo elle
  // figerait toute la page à l'ouverture du fichier, y compris les tuiles du
  // haut qui n'ont rien à voir avec elle. Le détour par un timer laisse le
  // navigateur afficher le rapport, puis calcule.
  //
  // Le calcul ne dépend NI du prix du point NI du capital : tout ce qui sort de
  // la simulation est en points et linéaire, et la ruine se relit dans les creux
  // déjà simulés. Taper dans le champ « capital » ne rejoue donc rien.
  useEffect(() => {
    setBusy(true);
    const id = setTimeout(() => {
      setMc(runMonteCarlo(gains, { mode, draws }));
      setBusy(false);
    }, 0);
    return () => clearTimeout(id);
  }, [gains, mode, draws]);

  // Tant qu'un premier résultat n'existe pas, la carte est un message. ENSUITE,
  // un recalcul (changement de mode ou de nombre de tirages) garde à l'écran les
  // chiffres précédents : les faire disparaître une seconde ferait sauter la
  // moitié de la page à chaque clic sur « Tirage avec remise ».
  if (!mc) {
    return (
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Monte-Carlo</h2>
        <p className={styles.cardSub}>
          {busy
            ? `Rebattage de ${gains.length} positions en cours…`
            : 'Il faut au moins deux positions résolues pour rebattre quoi que ce soit.'}
        </p>
      </section>
    );
  }

  const usd = v => v == null ? null : v * ppp;
  const shuffle = mode === 'shuffle';

  // Capital de départ : en $, comme tout ce qui est un montant dans cette page.
  // Vide, on en propose un — deux fois le creux réellement subi, arrondi — parce
  // qu'un champ vide laisserait la tuile la plus parlante de la carte à « — ».
  const suggested = nice(usd(mc.observed.maxDD) * 2);
  const capitalUsd = Number(capital) > 0 ? Number(capital) : suggested;
  const ruin = ruinProbability(mc, capitalUsd / ppp);

  const ddRank = mc.maxDD.rank;
  const rankColor = ddRank >= 0.95 ? BEAR : ddRank >= 0.8 ? AMBER : undefined;

  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>
        Monte-Carlo <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}>— ce que le hasard aurait pu faire de ces trades</span>
      </h2>
      <p className={styles.cardSub}>
        {shuffle ? (
          <>Les <b>{mc.n}</b> mêmes positions rejouées <b>{mc.draws}</b> fois dans un <b>autre ordre</b>.
          Le total final est donc identique à chaque tirage — seul le <b>chemin</b> change, et avec lui
          le creux, les séries de pertes et le temps passé sous l'eau. C'est le mode qui répond à
          « mon drawdown est-il de la malchance ou la normale ? », et rien d'autre.</>
        ) : (
          <>Un nouvel échantillon de <b>{mc.n}</b> positions <b>tirées avec remise</b> dans le même
          chapeau, <b>{mc.draws}</b> fois. Le total varie alors : c'est le mode qui donne la dispersion
          du <b>résultat final</b> et la probabilité de finir dans le rouge. En échange il suppose les
          trades <b>indépendants et de même loi</b> — hypothèse forte, que le rang du drawdown réel
          ci-dessous permet justement de mettre en doute.</>
        )}
      </p>

      <div className={styles.pvBar} style={{ marginBottom: 14 }}>
        <span className={styles.pvLabel}>Mode</span>
        {[['shuffle', 'Rebattage'], ['bootstrap', 'Tirage avec remise']].map(([v, l]) => (
          <button key={v} className={`${styles.filterChip}${mode === v ? ` ${styles.filterChipOn}` : ''}`}
            onClick={() => setMode(v)}>{l}</button>
        ))}
        <span className={styles.pvLabel} style={{ marginLeft: 10 }}>Tirages</span>
        <select className={styles.mcSelect} value={draws} onChange={e => setDraws(Number(e.target.value))}>
          {DRAW_CHOICES.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <span className={styles.pvLabel} style={{ marginLeft: 10 }}>Capital</span>
        <input className={styles.pvInput} type="number" min="0" step="any" value={capital}
          placeholder={String(suggested)} onChange={e => setCapital(e.target.value)}
          aria-label="capital de départ en dollars" />
        <span className={styles.pvOp}>$</span>
        {!(Number(capital) > 0) && <span className={styles.pvOut}>suggéré : 2 × le creux réel</span>}
        {busy && <span className={styles.mcBusy}>recalcul…</span>}
      </div>

      {mc.draws < mc.drawsAsked && (
        <p className={styles.cardSub} style={{ marginTop: -6 }}>
          <b style={{ color: AMBER }}>{mc.drawsAsked} tirages ramenés à {mc.draws}</b> : {mc.n} positions
          × {mc.drawsAsked} tirages figeraient l'onglet plusieurs secondes. Les quantiles restent
          fiables, leur troisième décimale un peu moins.
        </p>
      )}

      <div className={styles.tiles}>
        <Tile label="Drawdown médian" value={fmtAbs(usd(mc.maxDD.p50))} color={BEAR}
          sub={`p5 ${fmtAbs(usd(mc.maxDD.p5))} · p95 ${fmtAbs(usd(mc.maxDD.p95))}`} />
        <Tile label="Pire drawdown simulé" value={fmtAbs(usd(mc.maxDD.max))} color={BEAR}
          sub={`sur ${mc.draws} tirages · réel ${fmtAbs(usd(mc.maxDD.observed))}`} />
        <Tile label="Rang du DD réel" value={`p${(ddRank * 100).toFixed(0)}`} color={rankColor}
          sub={`${(ddRank * 100).toFixed(0)} % des tirages ont creusé moins`} />
        <Tile label="Risque de ruine" value={pct1(ruin)}
          color={ruin > 0.05 ? BEAR : ruin > 0 ? AMBER : BULL}
          sub={`capital ${fmtAbs(capitalUsd)}${Number(capital) > 0 ? '' : ' (suggéré)'} · passage sous zéro`} />
        <Tile label="Pertes d'affilée" value={fmtNum(mc.lossStreak.p50, 0)}
          sub={`médiane · p95 ${fmtNum(mc.lossStreak.p95, 0)} · pire ${fmtNum(mc.lossStreak.max, 0)} · réel ${mc.lossStreak.observed}`} />
        <Tile label="Temps sous l'eau" value={`${fmtNum(mc.underwater.p50, 0)} pos.`}
          sub={`médiane · p95 ${fmtNum(mc.underwater.p95, 0)} · réel ${mc.underwater.observed}`} />
        {!shuffle && (
          <>
            <Tile label="Résultat final médian" value={fmtUsd(usd(mc.net.p50))}
              color={mc.net.p50 >= 0 ? BULL : BEAR}
              sub={`p5 ${fmtUsd(usd(mc.net.p5))} · p95 ${fmtUsd(usd(mc.net.p95))}`} />
            <Tile label="Finir dans le rouge" value={pct1(mc.pctLoss)}
              color={mc.pctLoss > 0.3 ? BEAR : mc.pctLoss > 0.1 ? AMBER : BULL}
              sub={`part des ${mc.draws} échantillons sous zéro · réel ${fmtUsd(usd(mc.net.observed))}`} />
          </>
        )}
      </div>

      {/* LA phrase de la carte : ce que le rang du drawdown réel raconte. */}
      <p className={styles.mcVerdict} style={{ borderColor: rankColor ?? 'var(--border-2)' }}>
        {ddRank >= 0.95 ? (
          <>
            <b style={{ color: BEAR }}>Les pertes se groupent.</b> Le creux réellement subi
            ({fmtAbs(usd(mc.maxDD.observed))}) est au <b>p{(ddRank * 100).toFixed(0)}</b> de la
            distribution : {pct1(1 - ddRank)} des {shuffle ? 'rebattages' : 'échantillons'} seulement
            font pire. Ce n'est pas de la malchance, c'est de la <b>mémoire</b> — les mauvaises
            positions se suivent au lieu d'être dispersées. Conséquence directe :{' '}
            <b>les quantiles ci-dessus sous-estiment le risque</b>, puisqu'ils reposent sur
            l'indépendance de l'ordre que ce rang vient de démentir. Le vrai creux à venir est à
            chercher au-dessus du pire tirage, pas au p95.
            {shuffle && <> Formellement : p = {pct1(1 - ddRank)} sur le test de permutation de l'ordre.</>}
          </>
        ) : ddRank <= 0.3 ? (
          <>
            <b style={{ color: BULL }}>L'ordre réel a été clément.</b> Le creux subi
            ({fmtAbs(usd(mc.maxDD.observed))}) n'est qu'au <b>p{(ddRank * 100).toFixed(0)}</b> :{' '}
            {pct1(1 - ddRank)} des tirages creusent davantage, et la moitié d'entre eux dépassent{' '}
            <b>{fmtAbs(usd(mc.maxDD.p50))}</b>. Le drawdown du backtest n'est donc <b>pas</b> le
            drawdown à prévoir — c'est le meilleur cas d'un tirage. Dimensionner le compte dessus,
            c'est se préparer au chemin le plus doux.
          </>
        ) : (
          <>
            <b>Rien d'anormal dans l'ordre réel.</b> Le creux subi ({fmtAbs(usd(mc.maxDD.observed))})
            tombe au <b>p{(ddRank * 100).toFixed(0)}</b> de la distribution : ni chanceux ni
            malchanceux. Le chiffre à retenir pour dimensionner un compte n'est donc pas lui mais le{' '}
            <b>p95, {fmtAbs(usd(mc.maxDD.p95))}</b> — et il faut pouvoir le traverser sans couper.
          </>
        )}
      </p>

      <ConeChart mc={mc} ppp={ppp} mode={mode} />

      <div className={styles.twoCol} style={{ marginTop: 18 }}>
        <div>
          <h3 className={styles.mcSubTitle}>Drawdown maximal</h3>
          <p className={styles.cardSub}>
            Le creux le plus profond de chaque chemin, en $. Le trait bleu est celui du rapport.
          </p>
          <McHistogram values={mc.ddsSorted} observed={mc.maxDD.observed} color={BEAR}
            fmt={v => fmtAbs(usd(v))} />
        </div>
        <div>
          <h3 className={styles.mcSubTitle}>
            {shuffle ? 'Plus longue série de pertes' : 'Résultat final'}
          </h3>
          <p className={styles.cardSub}>
            {shuffle
              ? 'Combien de perdantes d\'affilée chaque chemin a encaissé. C\'est ce nombre-là, pas le drawdown, qui fait couper une stratégie.'
              : 'Le total de chaque échantillon de ' + mc.n + ' positions. La part à gauche de zéro est la probabilité de finir dans le rouge.'}
          </p>
          {shuffle
            ? <McHistogram values={mc.streaksSorted} observed={mc.lossStreak.observed}
                color={AMBER} discrete fmt={v => fmtNum(v, 0)} />
            : <McHistogram values={mc.netsSorted} observed={mc.net.observed} color={BULL}
                fmt={v => fmtUsd(usd(v))} />}
        </div>
      </div>

      <p className={styles.caveat} style={{ marginTop: 18 }}>
        <b>Ce que ce bloc ne dit pas.</b> Il ne répare <b>aucun surapprentissage</b> : rebattre les
        trades de la meilleure configuration d'un balayage ne dit rien de sa validité hors
        échantillon, seulement de la variance de ce jeu de trades là — la porte de significativité
        reste le contrôle par décalage circulaire. Il suppose aussi que <b>l'ordre est sans
        mémoire</b>, hypothèse que le rang du drawdown réel teste et peut démentir. La ruine est
        comptée comme un <b>passage</b> sous le capital ; le chemin continue ensuite dans la
        simulation, alors qu'un vrai compte se serait arrêté là — le résultat final d'un chemin
        ruiné est donc fictif.
        {maxSim > 1 && (
          <> Enfin, <b style={{ color: AMBER }}>jusqu'à {maxSim} positions ont couru en même temps</b> :
          la série rebattue n'est déjà pas la suite des encaissements d'un compte, et le rebattage
          ne corrige pas ce biais — il le propage. Tous les drawdowns ci-dessus sont <b>optimistes</b>
          {' '}pour la même raison que celui de la courbe cumulée.</>
        )}
        {lotsVarient && (
          <> La taille de position varie dans ce rapport : la simulation porte sur les résultats{' '}
          <b>ramenés à 1 lot</b>. Rebattre des résultats déjà multipliés par un lot en escalier
          accrocherait le lot du dernier trade au résultat du premier — ce serait mesurer le
          calendrier des lots, pas la stratégie.</>
        )}
      </p>
    </section>
  );
}

// Même tuile que celle de la page — dupliquée ici plutôt qu'exportée pour ne pas
// faire d'un composant de présentation de trois lignes une dépendance entre
// deux fichiers.
function Tile({ label, value, sub, color }) {
  return (
    <div className={styles.tile}>
      <span className={styles.tileKey}>{label}</span>
      <span className={styles.tileVal} style={color ? { color } : undefined}>{value}</span>
      {sub && <span className={styles.tileSub}>{sub}</span>}
    </div>
  );
}
