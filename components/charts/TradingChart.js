import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createChart, CrosshairMode, LineStyle, PriceScaleMode } from 'lightweight-charts';
import { resolveChartTheme, DEFAULT_CHART_SETTINGS } from '../../lib/chartTheme';
import { calcMA, calcRSI, calcBB, calcSwings } from '../../lib/indicators';
import { calcEquilibrium } from '../../lib/equilibrium';
import { calcHarmony } from '../../lib/harmony';
import { createHarmonyPrimitive } from './HarmonyPrimitive';
import { calcRangeZones } from '../../lib/periodZones';
import { createRangeZonePrimitive } from './RangeZonePrimitive';
import { calcFVG, calcRFVG, calcRFVGPositions, calcKO, calcKOPositions, calcHBHBHB, calcCompression, calcHBHB, calcHMBM, calcHMBMPositions } from '../../lib/patterns';
import { calcTwinsBars } from '../../lib/twins/detect';
import { calcTwinsPositions } from '../../lib/twins/positions';
import {
  detectOptions   as twinsDetectOptions,
  positionOptions as twinsPositionOptions,
} from '../../lib/twins/params';
import { calcXFVG } from '../../lib/xfvg/detect';
import { detectOptions as xfvgDetectOptions, styleOptions as xfvgStyleOptions } from '../../lib/xfvg/params';
import { calcXfvgExtra } from '../../lib/xfvgx/detect';
import { calcXfvgxPositions } from '../../lib/xfvgx/positions';
import {
  detectOptions   as xfvgxDetectOptions,
  positionOptions as xfvgxPositionOptions,
  styleOptions    as xfvgxStyleOptions,
} from '../../lib/xfvgx/params';
import { calcLiq } from '../../lib/liq/detect';
import { calcRingble } from '../../lib/ringble/detect';
import { detectOptions as ringbleOptions } from '../../lib/ringble/params';
import { calcSuperAval } from '../../lib/superAval/detect';
import { detectOptions as superAvalOptions } from '../../lib/superAval/params';
import { calcRsier } from '../../lib/rsier/detect';
import { calcRsierPositions } from '../../lib/rsier/positions';
import {
  detectOptions   as rsierDetectOptions,
  positionOptions as rsierPositionOptions,
  styleOptions    as rsierStyleOptions,
} from '../../lib/rsier/params';
import { calcTrenderZones } from '../../lib/trender/detect';
import { calcTrenderPositions } from '../../lib/trender/positions';
import {
  detectOptions   as trenderDetectOptions,
  positionOptions as trenderPositionOptions,
  styleOptions    as trenderStyleOptions,
} from '../../lib/trender/params';
import { calcRev } from '../../lib/rev/detect';
import { calcRevPositions } from '../../lib/rev/positions';
import {
  detectOptions   as revDetectOptions,
  positionOptions as revPositionOptions,
  styleOptions    as revStyleOptions,
} from '../../lib/rev/params';
import { buildPatternReport } from '../../lib/patternReport';
import { calcLiqPositions } from '../../lib/liq/positions';
import { createLevelPrimitive } from './LevelPrimitive';
import {
  detectOptions   as liqDetectOptions,
  positionOptions as liqPositionOptions,
  styleOptions    as liqStyleOptions,
} from '../../lib/liq/params';
import { computeStats } from '../../lib/signals/stats';
import { createFvgPrimitive } from './FvgPrimitive';
import { createHbhPrimitive } from './HbhPrimitive';
import { createHmbmPrimitive } from './HmbmPrimitive';
import { createHbhbPrimitive } from './HbhbPrimitive';
import { createCompressionPrimitive } from './CompressionPrimitive';
import { createEquilibriumPrimitive } from './EquilibriumPrimitive';
import { createTradesPrimitive } from './TradesPrimitive';
import DrawingCanvas from './DrawingCanvas';
import TradeSetup    from '../replay/TradeSetup';
import styles from './TradingChart.module.css';

const PREFETCH_THRESHOLD = 50;

// Étiquette portée par le repère des motifs à MARQUEUR (ceux qui ne dessinent pas
// de zone). Un motif absent d'ici ne perd que son texte, pas son repère.
const MARKER_TEXT = {
  TWINS_BARS: 'TB',
  RINGBLE:    'RB',
  SUPER_AVAL: 'SA',
};

// Bottom oscillator pane sizing (fraction of total chart height). Shared by any
// 0-100 indicator that asks for it — RSI, and the EQ balance score.
const RSI_H_DEFAULT = 0.27;
const RSI_H_MIN     = 0.10;
const RSI_H_MAX     = 0.50;
const RSI_BOTTOM    = 0.01; // tiny bottom margin (time scale spacing)

// Fixed -8 → 108 pane scale: ~7% breathing room so a 0-100 line never clips
// against the pane edges.
const OSC_SCALE = () => ({
  priceRange: { minValue: -8, maxValue: 108 },
  margins: { above: 0, below: 0 },
});

// Traduction des valeurs sémantiques du thème (lib/chartTheme) vers les
// énumérations de lightweight-charts. Le thème reste ainsi une donnée pure,
// réutilisable par l'aperçu SVG du panneau de réglages.
const LWC_LINE_STYLE = {
  solid:       LineStyle.Solid,
  dotted:      LineStyle.Dotted,
  dashed:      LineStyle.Dashed,
  largeDashed: LineStyle.LargeDashed,
};
const LWC_CROSSHAIR = {
  normal: CrosshairMode.Normal,
  magnet: CrosshairMode.Magnet,
  hidden: CrosshairMode.Hidden,
};
const LWC_SCALE_MODE = {
  normal:  PriceScaleMode.Normal,
  log:     PriceScaleMode.Logarithmic,
  percent: PriceScaleMode.Percentage,
};

function resolveMarker(rawShape, labelText, showLabel) {
  if (rawShape === 'cross') {
    return { shape: 'circle', size: 0, text: showLabel ? `${labelText} ✕` : '✕' };
  }
  return { shape: rawShape, size: null, text: showLabel ? labelText : '' };
}

const MONTHS = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
function fmtTime(t) {
  const d = new Date(t * 1000);
  return `${String(d.getUTCDate()).padStart(2,'0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}  ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
}
function fmtP(v) {
  return v == null ? '—' : parseFloat(v.toFixed(5)).toString();
}
function fmtVol(v) {
  if (!v) return '—';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + ' M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + ' K';
  return Math.round(v).toLocaleString();
}

// ── EQ tooltip block ─────────────────────────────────────────────────────────
// The score is a product of six conditions, so showing it alone would hide the
// only interesting question: which one is failing.
const EQ_COMPS = {
  pull: 'Le point rappelle le prix (retour à la moyenne, hors échantillon)',
  uni:  'Une seule valeur — pas deux distributions concurrentes',
  conc: 'Valeur concentrée — pas étalée le long d\'une tendance',
  flat: 'Aucune dérive nette sur la fenêtre',
  sym:  'Acceptation symétrique de part et d\'autre du point',
  prox: 'Le prix traite au point en ce moment',
};

function EqTooltip({ iv }) {
  const balanced = iv.score >= iv.threshold;
  return (
    <div className={styles.eqBlock}>
      <div className={styles.indRow}>
        <span className={styles.indDot} style={{ background: iv.color }} />
        <span className={styles.indLabel}>{iv.label}</span>
        <span className={styles.indVal}>{fmtP(iv.value)}</span>
      </div>

      <div className={styles.eqScoreRow}>
        <span className={styles.eqScoreVal} style={{ color: balanced ? iv.color : '#64748B' }}>
          {iv.score.toFixed(0)}
        </span>
        <span className={styles.eqTrack}>
          <span
            className={styles.eqFill}
            style={{ width: `${Math.max(0, Math.min(100, iv.score))}%`, background: iv.color, opacity: balanced ? 1 : 0.45 }}
          />
        </span>
        <span className={styles.eqState} style={{ color: balanced ? iv.color : 'rgba(100,116,139,0.7)' }}>
          {balanced ? 'équilibre' : 'hors équilibre'}
        </span>
      </div>

      <div className={styles.eqComps}>
        {Object.entries(iv.comps).map(([k, v]) => (
          <span key={k} className={styles.eqComp} title={EQ_COMPS[k]}>
            <span className={styles.eqCompKey}>{k}</span>
            <span className={styles.eqCompTrack}>
              <span
                className={styles.eqCompFill}
                style={{ width: `${Math.round(v * 100)}%`, background: iv.color, opacity: 0.35 + 0.65 * v }}
              />
            </span>
          </span>
        ))}
      </div>

      <div className={styles.eqVa}>valeur {fmtP(iv.val)} — {fmtP(iv.vah)}</div>
    </div>
  );
}

// Répartition verticale des trois panneaux, en fractions de la hauteur totale.
// De bas en haut : RSI (si présent), volume, bougies. rsi.top = 1 - rsiH pour
// que la zone de tracé LWC commence exactement là où se trouve la poignée de
// redimensionnement, gardant le div backdrop-filter et l'échelle LWC alignés.
function paneMargins(hasRSI, rsiH, volH) {
  const rsi = hasRSI ? rsiH : 0;
  // Garde-fou : volume + RSI ne peuvent pas étouffer les bougies.
  const vol = Math.min(volH, Math.max(0, 0.72 - rsi));
  return {
    rsi:    { top: 1 - rsiH,        bottom: RSI_BOTTOM },
    volume: { top: 1 - rsi - vol,   bottom: rsi },
    main:   { top: 0.06,            bottom: 0.02 + rsi + vol },
  };
}

// Moniteur des motifs de la famille liq/rev : mêmes indicateurs pour les deux,
// afin qu'ils se comparent d'un coup d'œil. Deux lignes lui sont propres — le
// nombre d'ordres jamais remplis, et l'avertissement d'échantillon — parce que
// ces motifs sont rares et que leurs pourcentages ont l'air de résultats sans en
// être.
// Bouton de téléchargement d'un rapport de la famille : seule la couleur et le
// nom changent d'un motif à l'autre.
function ReportButton({ nom, couleur, bord, onClick, right }) {
  return (
    <button
      onClick={onClick}
      title={`Télécharger le rapport JSON des positions ${nom} (recap, RR, max pullup, max drawdown)`}
      aria-label={`Télécharger le rapport des positions ${nom}`}
      style={{
        position: 'absolute', top: 10, right, zIndex: 11,
        display: 'flex', alignItems: 'center', gap: 6,
        height: 30, padding: '0 11px',
        borderRadius: 999,
        border: `1px solid ${bord}`,
        background: 'rgba(13,18,32,0.72)',
        color: couleur,
        cursor: 'pointer',
        fontSize: 11, fontWeight: 700, fontFamily: 'Inter, system-ui, sans-serif',
        letterSpacing: '0.03em',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <path d="M7 10l5 5 5-5" />
        <path d="M12 15V3" />
      </svg>
      {nom}
    </button>
  );
}

// `rr` — l'objectif, tel qu'il a été RÉGLÉ. Un motif dont le TP se règle en
// points n'en vise aucun : il passe alors le RR MÉDIAN réalisé et lève
// `rrMedian`, pour que la parenthèse ne fasse pas passer une conséquence pour
// une cible. `null` = rien à dire, la parenthèse disparaît.
function PatternMonitor({ nom, couleur, stats, rr, rrMedian = false, top }) {
  const { total, tp, sl, be = 0, open, expPts, beThresh, profitFactor,
            skippedByUnique = 0, skippedByCooldown = 0, skippedWon = 0,
            missed = 0, dueArmed = 0, dueRemainingPts = 0, dueRemainingSl = 0 } = stats;
    const resolved = tp + sl;
    const wr       = resolved > 0 ? tp / resolved : null;
    const wrColor  = wr == null || beThresh == null ? '#94A3B8' : wr >= beThresh ? '#26A69A' : '#EF5350';
    const row = { display: 'flex', justifyContent: 'space-between', gap: 14, fontSize: 11, lineHeight: '15px' };
    const key = { color: 'rgba(148,163,184,0.85)', fontWeight: 500 };

    return (
      <div
        style={{
          position: 'absolute', left: 14, zIndex: 11,
          top,
          display: 'flex', flexDirection: 'column', gap: 3,
          minWidth: 172, padding: '9px 12px 10px', borderRadius: 10,
          border: `1px solid ${couleur}59`,
          background: 'rgba(13,18,32,0.78)',
          backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
          color: '#E2E8F0', fontFamily: 'Inter, system-ui, sans-serif',
          boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
          pointerEvents: 'none',
        }}
      >
        <div style={{ ...row, marginBottom: 3 }}>
          <span style={{ color: couleur, fontSize: 11, fontWeight: 700, letterSpacing: '0.04em' }}>
            {nom} — POSITIONS
          </span>
          <span style={{ color: 'rgba(148,163,184,0.85)', fontWeight: 600 }}>{total}</span>
        </div>
        <div style={row}>
          <span style={key}>{be > 0 ? 'TP / BE / SL' : 'TP / SL'}</span>
          <span style={{ fontWeight: 700 }}>
            <span style={{ color: '#26A69A' }}>{tp}</span>
            {be > 0 && (
              <>
                <span style={{ color: 'rgba(148,163,184,0.6)' }}> / </span>
                <span style={{ color: '#F59E0B' }}>{be}</span>
              </>
            )}
            <span style={{ color: 'rgba(148,163,184,0.6)' }}> / </span>
            <span style={{ color: '#EF5350' }}>{sl}</span>
          </span>
        </div>
        <div style={row}>
          <span style={key}>Winrate</span>
          <span style={{ color: wrColor, fontWeight: 700 }}>
            {wr == null ? '—' : `${(wr * 100).toFixed(1)} %`}
            {rr != null && (
              <span style={{ color: 'rgba(148,163,184,0.7)', fontWeight: 500 }}>
                {' '}({rrMedian ? 'RR méd.' : 'RR'} {rr})
              </span>
            )}
          </span>
        </div>
        <div style={row}>
          <span style={key}>Espérance</span>
          <span style={{ color: expPts == null ? '#94A3B8' : expPts >= 0 ? '#26A69A' : '#EF5350', fontWeight: 700 }}>
            {expPts == null ? '—' : `${expPts >= 0 ? '+' : ''}${expPts.toFixed(1)} pts`}
          </span>
        </div>
        <div style={row}>
          <span style={key}>Facteur de profit</span>
          <span style={{ fontWeight: 600 }}>
            {profitFactor == null ? '—' : Number.isFinite(profitFactor) ? profitFactor.toFixed(2) : '∞'}
            {beThresh != null && (
              <span style={{ color: 'rgba(148,163,184,0.7)', fontWeight: 500 }}> (seuil {(beThresh * 100).toFixed(0)} %)</span>
            )}
          </span>
        </div>
        {open > 0 && (
          <div style={row}>
            <span style={key}>Ouvertes</span>
            <span style={{ color: '#94A3B8', fontWeight: 600 }}>{open}</span>
          </div>
        )}
        {/* Ordres jamais servis. En entrée « retour dans la zone » ce
            chiffre est la première chose à regarder : un motif dont la
            moitié des signaux n'est jamais remplie ne se juge pas sur le
            winrate de l'autre moitié. */}
        {missed > 0 && (
          <div style={row}>
            <span style={key}>Ratés (jamais remplis)</span>
            <span style={{ color: '#94A3B8', fontWeight: 600 }}>{missed}</span>
          </div>
        )}
        {/* Combien le trade unique a écarté : sans ce chiffre, on ne voit
            pas que la moitié des signaux a pu disparaître du décompte. */}
        {skippedByUnique > 0 && (
          <div style={row}>
            <span style={key}>Écartés (trade unique)</span>
            <span style={{ color: '#F59E0B', fontWeight: 600 }}>{skippedByUnique}</span>
          </div>
        )}
        {/* Le repos ne se juge pas au nombre de sautés mais à ce qu'il a
            jeté : d'où les gagnants entre parenthèses. */}
        {skippedByCooldown > 0 && (
          <div style={row}>
            <span style={key}>Sautés (repos)</span>
            <span style={{ color: '#F59E0B', fontWeight: 600 }}>
              {skippedByCooldown}
              <span style={{ color: 'rgba(148,163,184,0.7)', fontWeight: 500 }}> · {skippedWon} gagnant(s)</span>
            </span>
          </div>
        )}
        {/* Le dû — visible seulement quand il a servi. Deux chiffres : combien
            de positions sont parties rembourser, et ce qui reste sur l'ardoise
            au bord des données. Un reste qui ne descend jamais dit que le seuil
            est trop haut ou que le motif ne rembourse pas. */}
        {(dueArmed > 0 || dueRemainingSl > 0) && (
          <div style={row}>
            <span style={key}>Dû (armés · reste)</span>
            <span style={{ fontWeight: 600 }}>
              <span style={{ color: '#F59E0B' }}>{dueArmed}</span>
              <span style={{ color: 'rgba(148,163,184,0.6)' }}> · </span>
              <span style={{ color: dueRemainingSl > 0 ? '#EF5350' : '#26A69A' }}>
                {dueRemainingPts.toFixed(1)} pts
              </span>
              <span style={{ color: 'rgba(148,163,184,0.7)', fontWeight: 500 }}> ({dueRemainingSl})</span>
            </span>
          </div>
        )}
        {/* Un échantillon minuscule donne des pourcentages qui ont l'air
            d'un résultat sans en être un. Le moniteur le dit lui-même. */}
        {resolved > 0 && resolved < 30 && (
          <div style={{ ...row, marginTop: 2 }}>
            <span style={{ color: '#F59E0B', fontSize: 10, fontWeight: 600 }}>
              échantillon trop petit
            </span>
            <span style={{ color: 'rgba(148,163,184,0.7)', fontSize: 10 }}>{resolved} clôturées</span>
          </div>
        )}
      </div>
    );
}

export default function TradingChart({
  candles, onLoadMore,
  indicators = [],
  htfBars = null,
  patterns = [],
  chartMode = 'candle',
  // Apparence : un seul objet de réglages (cf. lib/chartTheme). Les trois props
  // historiques restent acceptées et l'emportent — TradesChartModal s'en sert
  // pour forcer showVolume={false} sans toucher aux réglages de l'utilisateur.
  settings = null,
  bullColor, bearColor, showVolume,
  watermarkText = '',
  cvdData = null,
  drawings = [], activeTool = null, selectedId = null,
  onDrawingAdd, onDrawingUpdate, onDrawingRemove, onDrawingSelect,
  replayPlaying = false,
  openTrades = [],
  // Trades fermés — d'un backtest ou d'un SCRIPT (cf. lib/scripts/chartTrades.js,
  // qui traduit les positions d'un script vers cette forme) — dessinés comme des
  // positions : bande de risque, bande de gain, trajet parcouru.
  backtestTrades = [],
  selectedTradeId = null,
  focusRange = null,            // { from, to } en temps — recadre le graphe (nouvel objet = nouveau recadrage)
  tradeSetupActive = false,
  tradeSetupEntry  = null,
  onTradeSetupConfirm,
  onTradeSetupCancel,
}) {
  // Thème résolu une fois par changement de réglage : couleurs, grille, axes,
  // fond DOM et options de série en découlent tous.
  const theme = useMemo(() => {
    const merged = { ...DEFAULT_CHART_SETTINGS, ...(settings || {}) };
    if (bullColor  !== undefined) merged.bullColor  = bullColor;
    if (bearColor  !== undefined) merged.bearColor  = bearColor;
    if (showVolume !== undefined) merged.showVolume = showVolume;
    return resolveChartTheme(merged);
  }, [settings, bullColor, bearColor, showVolume]);
  const themeRef = useRef(theme);
  useEffect(() => { themeRef.current = theme; }, [theme]);

  const mainRef            = useRef(null);
  const mainWrapRef        = useRef(null);
  const drawingRedrawRef   = useRef(null);
  const registerDrawingRedraw = useCallback((fn) => { drawingRedrawRef.current = fn; }, []);
  const chartRef        = useRef(null);
  const candleSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const maSeriesMapRef      = useRef(new Map());
  const bbSeriesMapRef      = useRef(new Map());
  const swingSeriesMapRef   = useRef(new Map());
  const rsiSeriesMapRef     = useRef(new Map());
  const eqSeriesMapRef      = useRef(new Map());
  const trenderMapRef       = useRef(new Map());
  const rangeMapRef         = useRef(new Map());
  const patternSeriesMapRef = useRef(new Map());
  const fvgPrimitiveRef         = useRef(null);
  const xfvgPrimitiveRef        = useRef(null);
  const xfvgxPrimitiveRef       = useRef(null);
  const xfvgxPosPrimitiveRef    = useRef(null);
  // RSIER : la bande verticale (même primitive que les zones d'harmonie du
  // TRENDER) et la série fantôme qui porte le triangle de début de zone.
  const rsierPrimitiveRef       = useRef(null);
  const rsierMarksRef           = useRef(null);
  const rsierPosPrimitiveRef    = useRef(null);
  // Motif TRENDER : les mêmes trois pièces que le RSIER — la bande (primitive
  // d'harmonie), la série fantôme des triangles, et les trades.
  const harmoPrimitiveRef       = useRef(null);
  const harmoMarksRef           = useRef(null);
  const harmoPosPrimitiveRef    = useRef(null);
  const liqPrimitiveRef         = useRef(null);
  const liqPosPrimitiveRef      = useRef(null);
  const revPrimitiveRef         = useRef(null);
  const revPosPrimitiveRef      = useRef(null);
  // Twins Bars n'a pas de primitive de NIVEAU : son repère reste la flèche, et
  // seules ses positions sont dessinées.
  const twinsPosPrimitiveRef    = useRef(null);
  const rfvgPrimitiveRef        = useRef(null);
  const rfvgPosPrimitiveRef     = useRef(null);
  const koPrimitiveRef          = useRef(null);
  const koPosPrimitiveRef       = useRef(null);
  const hbhPrimitiveRef         = useRef(null);
  const hmbmPrimitiveRef        = useRef(null);
  const hmbmPosPrimitiveRef     = useRef(null);
  const hbhbPrimitiveRef        = useRef(null);
  const compressionPrimitiveRef = useRef(null);
  const tradesPrimitiveRef      = useRef(null);
  const appliedFocusRef         = useRef(null);
  const onLoadMoreRef      = useRef(onLoadMore);
  const replayPlayingRef   = useRef(replayPlaying);
  useEffect(() => { onLoadMoreRef.current    = onLoadMore;    }, [onLoadMore]);
  useEffect(() => { replayPlayingRef.current = replayPlaying; }, [replayPlaying]);

  const tradePriceLinesRef = useRef([]);
  // Couleurs courantes des barres de volume — lues par volBar(), qui tourne
  // aussi bien au premier setData qu'à chaque update live.
  const volColorsRef       = useRef({ up: theme.volume.upColor, down: theme.volume.downColor });
  const prevBarSpacingRef  = useRef(null);
  const candlesByTimeRef = useRef(new Map());
  const prevCandlesRef   = useRef(null);
  const maDataMapRef     = useRef(new Map());
  const bbDataMapRef     = useRef(new Map());
  const rsiDataMapRef    = useRef(new Map());
  const eqDataMapRef     = useRef(new Map());
  const indicatorsRef    = useRef(indicators);
  useEffect(() => { indicatorsRef.current = indicators; }, [indicators]);

  const [tooltip, setTooltip] = useState(null);
  const tooltipRef = useRef(null);

  // TRENDER : l'HTF le plus lent manque d'historique dans la fenêtre chargée.
  // Sans ça l'indicateur reste muet et l'utilisateur croit à un bug.
  const [trenderWarmup, setTrenderWarmup] = useState(null);
  // RSIER : même piège, même message — le HTF choisi n'a pas assez de bougies
  // pour que son RSI existe, et sans ça le motif reste muet.
  const [rsierWarmup, setRsierWarmup] = useState(null);
  // Motif TRENDER : le même piège encore, et pour cause — c'est le même calcul
  // que l'indicateur. Le message est séparé pour dire lequel des deux se tait.
  const [harmoWarmup, setHarmoWarmup] = useState(null);

  // ── Screenshot → presse-papier ────────────────────────────────────────────
  const [shotState, setShotState] = useState(null); // null | 'copied' | 'error'
  // Moniteur rFVG : stats des positions simulées (mode « position »), null
  // quand le pattern est éteint ou en représentation zone seule.
  const [rfvgStats, setRfvgStats] = useState(null);
  // Positions de la pince liq : stats du moniteur et rapport téléchargeable.
  const [liqStats, setLiqStats] = useState(null);
  const [revStats, setRevStats] = useState(null);
  const [twinsStats, setTwinsStats] = useState(null);
  const [xfvgxStats, setXfvgxStats] = useState(null);
  const [rsierStats, setRsierStats] = useState(null);
  const [harmoStats, setHarmoStats] = useState(null);
  // Rapport rFVG : mêmes positions que le dessin et le moniteur, gardées pour
  // le téléchargement JSON. Ref et non state : rien à re-rendre, le clic lit
  // simplement la dernière valeur — donc toujours à jour au dernier chargement.
  const rfvgReportRef = useRef(null);
  const liqReportRef  = useRef(null);
  const revReportRef  = useRef(null);
  const twinsReportRef = useRef(null);
  const xfvgxReportRef = useRef(null);
  const rsierReportRef = useRef(null);
  const harmoReportRef = useRef(null);
  // Moniteur / rapport KO (mode « position »), même logique que le rFVG — à ceci
  // près que les statistiques viennent de lib/signals/stats.js, la MÊME fonction
  // que la page /ko et l'optimiseur : le moniteur du graphe et le rapport de la
  // page ne peuvent donc pas raconter deux histoires différentes.
  const [koStats, setKoStats] = useState(null);
  const koReportRef = useRef(null);
  // Moniteur / rapport HM-BM (mode « position »), même logique que le rFVG.
  const [hmbmStats, setHmbmStats] = useState(null);
  const hmbmReportRef = useRef(null);
  const shotTimerRef = useRef(null);

  const takeScreenshot = useCallback(async () => {
    const chart = chartRef.current;
    if (!chart) return;
    clearTimeout(shotTimerRef.current);
    try {
      const shot = chart.takeScreenshot(); // canvas LWC (fond transparent)
      const out = document.createElement('canvas');
      out.width  = shot.width;
      out.height = shot.height;
      const ctx = out.getContext('2d');
      // Fond opaque sous le graphe : le dégradé du thème, reproduit à
      // l'identique — sans quoi la capture sortirait sur fond transparent.
      const th   = themeRef.current;
      const grad = ctx.createLinearGradient(0, 0, 0, out.height);
      grad.addColorStop(0, th.bg.top);
      grad.addColorStop(1, th.bg.bottom);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(shot, 0, 0);

      // Superpose le calque de dessins s'il existe.
      const overlay = mainWrapRef.current?.querySelector('canvas[data-drawing-layer]');
      if (overlay && overlay.width && overlay.height) {
        ctx.drawImage(overlay, 0, 0, out.width, out.height);
      }

      const blob = await new Promise(res => out.toBlob(res, 'image/png'));
      if (!blob) throw new Error('toBlob a échoué');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setShotState('copied');
    } catch (err) {
      console.error('[screenshot]', err);
      setShotState('error');
    }
    shotTimerRef.current = setTimeout(() => setShotState(null), 1900);
  }, []);

  useEffect(() => () => clearTimeout(shotTimerRef.current), []);

  // RSI pane height as a fraction of total chart height
  const [rsiH, setRsiH]   = useState(RSI_H_DEFAULT);
  const rsiHRef            = useRef(RSI_H_DEFAULT);

  useEffect(() => {
    if (!tooltip) return;
    const handler = (e) => {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target)) setTooltip(null);
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [tooltip]);

  // Anything that wants the bottom 0-100 pane opens it.
  const hasRSI = indicators.some(
    i => i.type === 'RSI' || (i.type === 'EQ' && i.showScore !== false),
  );

  // ── Drag handle: resize RSI pane ─────────────────────────────────────────
  const onHandlePointerDown = useCallback((e) => {
    e.preventDefault();
    const startY  = e.clientY;
    const chartPx = mainWrapRef.current?.offsetHeight ?? 600;
    const startH  = rsiHRef.current;

    const onMove = (ev) => {
      // dragging UP increases RSI height
      const delta = (startY - ev.clientY) / chartPx;
      const newH  = Math.max(RSI_H_MIN, Math.min(RSI_H_MAX, startH + delta));
      rsiHRef.current = newH;
      setRsiH(newH);
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup',   onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup',   onUp);
  }, []);

  // ── Mount chart once ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!mainRef.current) return;

    // Fond transparent : ce sont les divs DOM sous le canvas qui portent le
    // dégradé et la vignette — LWC ne sait peindre qu'un aplat.
    // Tout le reste de l'habillage est posé par l'effet « thème » juste après.
    const chart = createChart(mainRef.current, {
      width:  mainRef.current.offsetWidth,
      height: mainRef.current.offsetHeight,
      layout: {
        background: { type: 'solid', color: 'rgba(0,0,0,0)' },
      },
      timeScale: {
        timeVisible: true,
      },
    });

    const candleSeries   = chart.addCandlestickSeries();
    const volumeSeries   = chart.addHistogramSeries({
      priceFormat:  { type: 'volume' },
      priceScaleId: 'volume',
    });

    chartRef.current        = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      drawingRedrawRef.current?.();
    });

    let fetchLock = false;
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range || fetchLock || !onLoadMoreRef.current) return;
      if (range.from < PREFETCH_THRESHOLD) {
        fetchLock = true;
        Promise.resolve(onLoadMoreRef.current()).finally(() => {
          setTimeout(() => { fetchLock = false; }, 400);
        });
      }
    });

    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (entry.target === mainWrapRef.current && width && height) {
          chart.applyOptions({ width, height });
        }
      }
    });
    ro.observe(mainWrapRef.current);

    const mainEl = mainRef.current;
    const contextHandler = (e) => {
      e.preventDefault();
      const rect = mainEl.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const time = chart.timeScale().coordinateToTime(x);
      if (!time) { setTooltip(null); return; }

      const candle = candlesByTimeRef.current.get(time);
      if (!candle) { setTooltip(null); return; }

      const flipX = x > (mainEl.offsetWidth ?? 800) * 0.55;

      const indValues = [];
      for (const ind of indicatorsRef.current) {
        if (['SMA','EMA','WMA'].includes(ind.type)) {
          const val = maDataMapRef.current.get(ind.id)?.get(time);
          if (val != null) indValues.push({ type: ind.type, label: `${ind.type}(${ind.period})`, color: ind.color, value: val });
        } else if (ind.type === 'BB') {
          const entry = bbDataMapRef.current.get(ind.id)?.get(time);
          if (entry) indValues.push({ type: 'BB', label: `BB(${ind.period})`, color: ind.color, ...entry });
        } else if (ind.type === 'RSI') {
          const val = rsiDataMapRef.current.get(ind.id)?.get(time);
          if (val != null) indValues.push({ type: 'RSI', label: `RSI(${ind.period})`, color: ind.color, value: val, overbought: ind.overbought ?? 70, oversold: ind.oversold ?? 30 });
        } else if (ind.type === 'EQ') {
          const eq = eqDataMapRef.current.get(ind.id)?.get(time);
          if (eq) indValues.push({
            type: 'EQ', label: `EQ(${ind.lookback ?? 60})`, color: ind.color,
            value: eq.poc, score: eq.score, val: eq.val, vah: eq.vah,
            threshold: ind.threshold ?? 70,
            comps: { pull: eq.pull, uni: eq.uni, conc: eq.conc, flat: eq.flat, sym: eq.sym, prox: eq.prox },
          });
        }
      }
      setTooltip({ x, y, flipX, time, candle, indValues });
    };
    mainEl.addEventListener('contextmenu', contextHandler);

    return () => {
      mainEl.removeEventListener('contextmenu', contextHandler);
      ro.disconnect();
      maSeriesMapRef.current.clear();
      bbSeriesMapRef.current.clear();
      swingSeriesMapRef.current.clear();
      rsiSeriesMapRef.current.clear();
      eqSeriesMapRef.current.clear();
      trenderMapRef.current.clear();
      rangeMapRef.current.clear();
      patternSeriesMapRef.current.clear();
      fvgPrimitiveRef.current  = null;
      xfvgPrimitiveRef.current = null;
      xfvgxPrimitiveRef.current    = null;
      xfvgxPosPrimitiveRef.current = null;
      rsierPrimitiveRef.current = null;
      rsierMarksRef.current     = null;
      rsierPosPrimitiveRef.current = null;
      harmoPrimitiveRef.current    = null;
      harmoMarksRef.current        = null;
      harmoPosPrimitiveRef.current = null;
      liqPrimitiveRef.current  = null;
      liqPosPrimitiveRef.current = null;
      revPrimitiveRef.current    = null;
      revPosPrimitiveRef.current = null;
      twinsPosPrimitiveRef.current = null;
      rfvgPrimitiveRef.current = null;
      rfvgPosPrimitiveRef.current = null;
      koPrimitiveRef.current   = null;
      koPosPrimitiveRef.current = null;
      hbhPrimitiveRef.current  = null;
      hmbmPrimitiveRef.current = null;
      hmbmPosPrimitiveRef.current = null;
      hbhbPrimitiveRef.current = null;
      compressionPrimitiveRef.current = null;
      tradesPrimitiveRef.current      = null;
      appliedFocusRef.current         = null;
      // Le graphe vient d'être détruit : sans cette remise à zéro, un remontage
      // (StrictMode, ou tout parent qui remonte le composant avec ses bougies
      // déjà chargées) verrait `candles === prevCandles`, croirait à un simple
      // ajout live et n'injecterait que la DERNIÈRE bougie dans un graphe vide.
      prevCandlesRef.current          = null;
      candlesByTimeRef.current.clear();
      maDataMapRef.current.clear();
      bbDataMapRef.current.clear();
      rsiDataMapRef.current.clear();
      eqDataMapRef.current.clear();
      tradePriceLinesRef.current = [];
      chart.remove();
    };
  }, []);

  // ── Application du thème ──────────────────────────────────────────────────
  // Un seul endroit décide de l'apparence : réglages → thème → options LWC.
  useEffect(() => {
    const chart  = chartRef.current;
    const candle = candleSeriesRef.current;
    const volume = volumeSeriesRef.current;
    if (!chart || !candle || !volume) return;

    const crossLine = {
      color:  theme.crosshair.color,
      width:  1,
      style:  LWC_LINE_STYLE[theme.crosshair.style] ?? LineStyle.Dashed,
      labelBackgroundColor: theme.crosshair.labelBg,
    };

    chart.applyOptions({
      layout: {
        background: { type: 'solid', color: 'rgba(0,0,0,0)' },
        textColor:  theme.layout.textColor,
        fontSize:   theme.layout.fontSize,
        fontFamily: theme.layout.fontFamily,
      },
      grid: {
        vertLines: {
          visible: theme.grid.vert,
          color:   theme.grid.color,
          style:   LWC_LINE_STYLE[theme.grid.style] ?? LineStyle.Solid,
        },
        horzLines: {
          visible: theme.grid.horz,
          color:   theme.grid.color,
          style:   LWC_LINE_STYLE[theme.grid.style] ?? LineStyle.Solid,
        },
      },
      crosshair: {
        mode:     LWC_CROSSHAIR[theme.crosshair.mode] ?? CrosshairMode.Normal,
        vertLine: crossLine,
        horzLine: crossLine,
      },
      rightPriceScale: {
        visible:       theme.axis.visible,
        borderVisible: theme.axis.borderVisible,
        borderColor:   theme.axis.borderColor,
        textColor:     theme.axis.textColor,
        mode:          LWC_SCALE_MODE[theme.axis.mode] ?? PriceScaleMode.Normal,
      },
      timeScale: {
        borderVisible:  theme.axis.borderVisible,
        borderColor:    theme.axis.borderColor,
        timeVisible:    true,
        secondsVisible: theme.axis.secondsVisible,
        rightOffset:    theme.axis.rightOffset,
      },
      watermark: {
        visible:   theme.watermark.visible && !!watermarkText,
        text:      watermarkText,
        color:     theme.watermark.color,
        fontSize:  theme.watermark.fontSize,
        fontFamily: theme.layout.fontFamily,
        horzAlign: 'center',
        vertAlign: 'center',
      },
    });

    // Le zoom appartient à l'utilisateur : on ne repositionne l'espacement des
    // bougies que lorsque le réglage lui-même change, pas à chaque re-rendu.
    if (prevBarSpacingRef.current !== theme.axis.barSpacing) {
      prevBarSpacingRef.current = theme.axis.barSpacing;
      chart.timeScale().applyOptions({ barSpacing: theme.axis.barSpacing });
    }

    candle.applyOptions({
      upColor:          theme.candle.upColor,
      downColor:        theme.candle.downColor,
      borderVisible:    theme.candle.borderVisible,
      borderUpColor:    theme.candle.borderUpColor,
      borderDownColor:  theme.candle.borderDownColor,
      wickVisible:      theme.candle.wickVisible,
      wickUpColor:      theme.candle.wickUpColor,
      wickDownColor:    theme.candle.wickDownColor,
      priceLineVisible: theme.candle.priceLineVisible,
      lastValueVisible: theme.candle.lastValueVisible,
    });

    volume.applyOptions({ visible: theme.volume.visible });

    // Les barres de volume portent leur couleur point par point : changer la
    // teinte ou l'opacité demande de réécrire les données déjà posées.
    const prevVol = volColorsRef.current;
    volColorsRef.current = { up: theme.volume.upColor, down: theme.volume.downColor };
    if (
      prevCandlesRef.current?.length &&
      (prevVol.up !== theme.volume.upColor || prevVol.down !== theme.volume.downColor)
    ) {
      volume.setData(prevCandlesRef.current.map(volBar));
    }
  }, [theme, watermarkText]);

  // ── Répartition verticale des panneaux (bougies / volume / RSI) ───────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const volH = theme.volume.visible ? theme.volume.height : 0;
    const m    = paneMargins(hasRSI, rsiH, volH);

    chart.priceScale('right').applyOptions({ scaleMargins: m.main });
    chart.priceScale('volume').applyOptions({ scaleMargins: m.volume });

    if (hasRSI) {
      chart.priceScale('left').applyOptions({
        visible:       true,
        borderVisible: theme.axis.borderVisible,
        borderColor:   theme.axis.borderColor,
        textColor:     theme.axis.textColor,
        scaleMargins:  m.rsi,
      });
    } else {
      chart.priceScale('left').applyOptions({ visible: false });
    }
  }, [hasRSI, rsiH, theme]);

  // ── Trade price lines (entry / TP / SL for open trades) ──────────────────
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    // Remove previous lines
    for (const pl of tradePriceLinesRef.current) {
      try { series.removePriceLine(pl); } catch {}
    }
    tradePriceLinesRef.current = [];

    for (const trade of openTrades) {
      const isBuy   = trade.direction === 'BUY';
      const clrBase = isBuy ? '#26A69A' : '#EF5350';

      tradePriceLinesRef.current.push(
        series.createPriceLine({
          price: trade.entryPrice,
          color: clrBase + '80',
          lineStyle: LineStyle.Dashed,
          lineWidth: 1,
          axisLabelVisible: true,
          title: `${trade.direction}`,
        }),
        series.createPriceLine({
          price: trade.tp,
          color: '#26A69A',
          lineStyle: LineStyle.Solid,
          lineWidth: 1,
          axisLabelVisible: true,
          title: 'TP',
        }),
        series.createPriceLine({
          price: trade.sl,
          color: '#EF5350',
          lineStyle: LineStyle.Solid,
          lineWidth: 1,
          axisLabelVisible: true,
          title: 'SL',
        }),
      );
    }
  }, [openTrades]);

  // ── Candle + volume data ──────────────────────────────────────────────────
  const volBar = (c) => ({
    time:  c.time,
    value: c.volume,
    color: c.close >= c.open ? volColorsRef.current.up : volColorsRef.current.down,
  });

  useEffect(() => {
    if (!candleSeriesRef.current || !candles?.length) return;
    const ts   = chartRef.current.timeScale();
    const prev = prevCandlesRef.current;

    // Mise à jour live (polling) : seul le dernier bucket a changé et/ou des
    // bougies se sont ajoutées à droite → series.update() incrémental.
    // La vue N'EST JAMAIS déplacée : LWC ne décale que si l'utilisateur est
    // déjà collé au bord droit (comportement natif), sinon rien ne bouge.
    const isLiveAppend =
      prev && prev.length > 1 &&
      candles.length >= prev.length &&
      candles[0].time === prev[0].time &&
      candles[prev.length - 1].time === prev[prev.length - 1].time &&
      candles[prev.length - 2].time === prev[prev.length - 2].time;

    if (isLiveAppend) {
      for (let i = prev.length - 1; i < candles.length; i++) {
        const c = candles[i];
        candleSeriesRef.current.update({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close });
        volumeSeriesRef.current.update(volBar(c));
      }
      if (replayPlayingRef.current) ts.scrollToRealTime();
    } else {
      // Rechargement structurel (symbole/TF, prepend d'historique, bascule
      // grouped/candle) : setData complet en préservant la vue courante.
      const prevRange = ts.getVisibleRange();
      candleSeriesRef.current.setData(
        candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })),
      );
      volumeSeriesRef.current.setData(candles.map(volBar));
      if (replayPlayingRef.current) {
        ts.scrollToRealTime();
      } else {
        prevRange ? ts.setVisibleRange(prevRange) : ts.fitContent();
      }
    }

    prevCandlesRef.current   = candles;
    candlesByTimeRef.current = new Map(candles.map(c => [c.time, c]));
  }, [candles]);

  // ── Trades de backtest : positions + marqueurs d'entrée / sortie ──────────
  // Les temps d'un trade ne tombent pas sur des temps de bougie : l'entrée est
  // à l'open d'une bougie TF, mais la sortie est datée à la MINUTE (SL/TP
  // vérifiés M1 par M1). Or le graphe ne sait placer que des temps présents
  // dans ses données — chaque temps est donc ramené à la bougie qui le
  // contient (dernière bougie dont le temps <= t), sans quoi marqueurs et
  // rectangles seraient silencieusement ignorés.
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    const hasTrades = backtestTrades.length > 0 && candles?.length > 0;

    if (!hasTrades) {
      if (tradesPrimitiveRef.current) {
        try { series.detachPrimitive(tradesPrimitiveRef.current); } catch {}
        tradesPrimitiveRef.current = null;
      }
      series.setMarkers([]);
      return;
    }

    const times = candles.map(c => c.time);
    const snap = (t) => {
      if (t <= times[0]) return times[0];
      if (t >= times[times.length - 1]) return times[times.length - 1];
      let lo = 0, hi = times.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (times[mid] <= t) lo = mid; else hi = mid - 1;
      }
      return times[lo];
    };

    const first = times[0];
    const last  = times[times.length - 1];

    const visible = [];
    const markers = [];

    for (const t of backtestTrades) {
      if (t.exitTime < first || t.entryTime > last) continue;   // hors fenêtre chargée
      const entryTime = snap(t.entryTime);
      const exitTime  = snap(t.exitTime);
      visible.push({ ...t, entryTime, exitTime });

      const isBuy = t.direction === 'BUY';
      const win   = (t.profitPoints ?? 0) >= 0;
      markers.push({
        time: entryTime,
        position: isBuy ? 'belowBar' : 'aboveBar',
        shape:    isBuy ? 'arrowUp'  : 'arrowDown',
        color:    isBuy ? '#26A69A'  : '#EF5350',
        text:     `#${t.id}`,
        size:     t.id === selectedTradeId ? 2 : 1,
      });
      markers.push({
        time: exitTime,
        position: isBuy ? 'aboveBar' : 'belowBar',
        shape:    'circle',
        color:    win ? '#26A69A' : '#EF5350',
        text:     t.profitR != null ? `${t.profitR >= 0 ? '+' : ''}${t.profitR.toFixed(1)}R` : '',
        size:     t.id === selectedTradeId ? 2 : 1,
      });
    }

    markers.sort((a, b) => a.time - b.time);   // LWC exige des marqueurs ordonnés

    if (!tradesPrimitiveRef.current) {
      tradesPrimitiveRef.current = createTradesPrimitive();
      series.attachPrimitive(tradesPrimitiveRef.current);
    }
    tradesPrimitiveRef.current.update(visible, selectedTradeId);
    series.setMarkers(markers);
  }, [backtestTrades, selectedTradeId, candles]);

  // ── Recadrage sur demande (un trade choisi dans la liste) ─────────────────
  // focusRange est comparé par IDENTITÉ : un prepend d'historique change
  // `candles` mais ne doit pas re-recadrer, sinon la vue sauterait sous les
  // doigts de l'utilisateur en train de remonter le temps.
  // Application SYNCHRONE : l'effet des bougies, déclaré plus haut, a déjà posé
  // les données de la série sur ce même commit. Différer (requestAnimationFrame)
  // exposait le recadrage à une course — le préchargement d'historique déclenché
  // par fitContent() faisait changer `candles`, le nettoyage annulait l'image
  // différée, et le garde-fou d'identité interdisait toute nouvelle tentative :
  // le recadrage ne se produisait jamais.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !focusRange || !candles?.length) return;
    if (appliedFocusRef.current === focusRange) return;
    try {
      chart.timeScale().setVisibleRange(focusRange);
      appliedFocusRef.current = focusRange;
    } catch {
      /* plage hors données — on retentera au prochain rendu */
    }
  }, [focusRange, candles]);

  // ── MA series ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const maIndicators = indicators.filter(i => ['SMA','EMA','WMA'].includes(i.type));
    const map          = maSeriesMapRef.current;
    const active       = new Set(maIndicators.map(i => i.id));
    for (const [id, series] of map) {
      if (!active.has(id)) { chart.removeSeries(series); map.delete(id); maDataMapRef.current.delete(id); }
    }
    for (const ind of maIndicators) {
      if (!map.has(ind.id)) {
        map.set(ind.id, chart.addLineSeries({
          color: ind.color, lineWidth: 1.5,
          priceLineVisible: false, lastValueVisible: true,
          crosshairMarkerVisible: true, crosshairMarkerRadius: 3,
          title: `${ind.type}(${ind.period})`,
        }));
      } else {
        map.get(ind.id).applyOptions({ color: ind.color, title: `${ind.type}(${ind.period})` });
      }
      const data = candles?.length >= ind.period ? calcMA(candles, ind) : [];
      map.get(ind.id).setData(data);
      maDataMapRef.current.set(ind.id, new Map(data.map(d => [d.time, d.value])));
    }
  }, [candles, indicators]);

  // ── Bollinger Bands ───────────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const bbIndicators = indicators.filter(i => i.type === 'BB');
    const map          = bbSeriesMapRef.current;
    const active       = new Set(bbIndicators.map(i => i.id));
    for (const [id, entry] of map) {
      if (!active.has(id)) {
        chart.removeSeries(entry.upper);
        chart.removeSeries(entry.middle);
        chart.removeSeries(entry.lower);
        map.delete(id);
        bbDataMapRef.current.delete(id);
      }
    }
    for (const ind of bbIndicators) {
      const bandColor = ind.color + 'A0';
      if (!map.has(ind.id)) {
        map.set(ind.id, {
          upper:  chart.addLineSeries({ color: bandColor, lineWidth: 1, lineStyle: LineStyle.Solid,  priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: '' }),
          middle: chart.addLineSeries({ color: ind.color, lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: true,  crosshairMarkerVisible: true, crosshairMarkerRadius: 3, title: `BB(${ind.period})` }),
          lower:  chart.addLineSeries({ color: bandColor, lineWidth: 1, lineStyle: LineStyle.Solid,  priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: '' }),
        });
      } else {
        const entry = map.get(ind.id);
        entry.upper.applyOptions({ color: bandColor });
        entry.middle.applyOptions({ color: ind.color, title: `BB(${ind.period})` });
        entry.lower.applyOptions({ color: bandColor });
      }
      const entry = map.get(ind.id);
      if (candles?.length >= ind.period) {
        const { upper, middle, lower } = calcBB(candles, ind);
        entry.upper.setData(upper);
        entry.middle.setData(middle);
        entry.lower.setData(lower);
        const bbMap = new Map();
        for (let i = 0; i < upper.length; i++) {
          bbMap.set(upper[i].time, { upper: upper[i].value, middle: middle[i].value, lower: lower[i].value });
        }
        bbDataMapRef.current.set(ind.id, bbMap);
      } else {
        entry.upper.setData([]); entry.middle.setData([]); entry.lower.setData([]);
        bbDataMapRef.current.delete(ind.id);
      }
    }
  }, [candles, indicators]);

  // ── Swing High / Low markers ──────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const swingInds = indicators.filter(i => i.type === 'SWING');
    const map       = swingSeriesMapRef.current;
    const active    = new Set(swingInds.map(i => i.id));
    for (const [id, { highSeries, lowSeries }] of map) {
      if (!active.has(id)) { chart.removeSeries(highSeries); chart.removeSeries(lowSeries); map.delete(id); }
    }
    for (const ind of swingInds) {
      if (!map.has(ind.id)) {
        const ghost = { color: 'rgba(0,0,0,0)', lineWidth: 0, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: '' };
        map.set(ind.id, { highSeries: chart.addLineSeries(ghost), lowSeries: chart.addLineSeries(ghost) });
      }
      const { highSeries, lowSeries } = map.get(ind.id);
      const left  = Math.max(1, ind.leftBars  ?? 5);
      const right = Math.max(1, ind.rightBars ?? 5);
      if (!candles?.length || candles.length < left + right + 1) {
        highSeries.setData([]); highSeries.setMarkers([]);
        lowSeries.setData([]);  lowSeries.setMarkers([]);
        continue;
      }
      const { highs, lows } = calcSwings(candles, { leftBars: left, rightBars: right });
      const size  = ind.markerSize ?? 1;
      const label = ind.showLabel !== false;
      const hm = resolveMarker(ind.shapeHigh ?? 'arrowDown', 'SH', label);
      const lm = resolveMarker(ind.shapeLow  ?? 'arrowUp',   'SL', label);
      highSeries.setData(highs);
      highSeries.setMarkers(highs.map(({ time }) => ({ time, position: 'aboveBar', color: ind.highColor ?? '#F59E0B', shape: hm.shape, text: hm.text, size: hm.size !== null ? hm.size : size })));
      lowSeries.setData(lows);
      lowSeries.setMarkers(lows.map(({ time }) => ({ time, position: 'belowBar', color: ind.lowColor ?? '#60A5FA', shape: lm.shape, text: lm.text, size: lm.size !== null ? lm.size : size })));
    }
  }, [candles, indicators]);

  // ── RSI series (left price scale, bottom area of the same chart) ──────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const rsiIndicators = indicators.filter(i => i.type === 'RSI');
    const map           = rsiSeriesMapRef.current;
    const active        = new Set(rsiIndicators.map(i => i.id));
    for (const [id, entry] of map) {
      if (!active.has(id)) { chart.removeSeries(entry.series); map.delete(id); rsiDataMapRef.current.delete(id); }
    }
    for (const ind of rsiIndicators) {
      if (!map.has(ind.id)) {
        const series = chart.addLineSeries({
          priceScaleId:           'left',
          color:                  ind.color,
          lineWidth:              1.5,
          priceLineVisible:       false,
          lastValueVisible:       true,
          crosshairMarkerVisible: true,
          crosshairMarkerRadius:  3,
          title:                  `RSI(${ind.period})`,
          autoscaleInfoProvider:  OSC_SCALE,
        });
        const ob = ind.overbought ?? 70;
        const os = ind.oversold   ?? 30;
        const obLine = series.createPriceLine({ price: ob, color: 'rgba(239,83,80,0.50)',  lineStyle: LineStyle.Dashed, lineWidth: 1, title: String(ob) });
        const osLine = series.createPriceLine({ price: os, color: 'rgba(38,166,154,0.50)', lineStyle: LineStyle.Dashed, lineWidth: 1, title: String(os) });
        series.createPriceLine({ price: 50,  color: 'rgba(100,116,139,0.28)', lineStyle: LineStyle.Dashed, lineWidth: 1, title: '' });
        map.set(ind.id, { series, obLine, osLine });
      } else {
        const entry = map.get(ind.id);
        entry.series.applyOptions({ color: ind.color, title: `RSI(${ind.period})` });
        entry.obLine.applyOptions({ price: ind.overbought ?? 70, title: String(ind.overbought ?? 70) });
        entry.osLine.applyOptions({ price: ind.oversold   ?? 30, title: String(ind.oversold   ?? 30) });
      }
      const data = candles?.length > ind.period ? calcRSI(candles, ind) : [];
      map.get(ind.id).series.setData(data);
      rsiDataMapRef.current.set(ind.id, new Map(data.map(d => [d.time, d.value])));
    }
  }, [candles, indicators]);

  // ── EQ — Equilibrium Point ────────────────────────────────────────────────
  // Three layers per indicator: the point itself as a line whose opacity tracks
  // the balance score, the balance zones / naked POCs as a primitive, and the
  // score as an optional 0-100 line in the bottom pane.
  useEffect(() => {
    const chart  = chartRef.current;
    const series = candleSeriesRef.current;
    if (!chart || !series) return;

    const eqInds = indicators.filter(i => i.type === 'EQ');
    const map    = eqSeriesMapRef.current;
    const active = new Set(eqInds.map(i => i.id));

    for (const [id, entry] of map) {
      if (!active.has(id)) {
        chart.removeSeries(entry.line);
        if (entry.score) chart.removeSeries(entry.score);
        try { series.detachPrimitive(entry.prim); } catch {}
        map.delete(id);
        eqDataMapRef.current.delete(id);
      }
    }

    for (const ind of eqInds) {
      const lookback  = ind.lookback ?? 60;
      const showScore = ind.showScore !== false;
      const title     = `EQ(${lookback})`;

      if (!map.has(ind.id)) {
        const prim = createEquilibriumPrimitive();
        series.attachPrimitive(prim);
        map.set(ind.id, {
          prim,
          // Per-point colour carries the score, so the series colour is only a
          // fallback for the crosshair marker and the price-axis label.
          line: chart.addLineSeries({
            color: ind.color, lineWidth: 2,
            priceLineVisible: false, lastValueVisible: true,
            crosshairMarkerVisible: true, crosshairMarkerRadius: 3,
            title,
          }),
          score: null,
        });
      }
      const entry = map.get(ind.id);
      entry.line.applyOptions({ color: ind.color, title });

      // Score sub-series appears / disappears with the toggle.
      if (showScore && !entry.score) {
        entry.score = chart.addLineSeries({
          priceScaleId: 'left',
          color: ind.color, lineWidth: 1.5,
          priceLineVisible: false, lastValueVisible: true,
          crosshairMarkerVisible: true, crosshairMarkerRadius: 3,
          title: `${title} score`,
          autoscaleInfoProvider: OSC_SCALE,
        });
        entry.thLine = entry.score.createPriceLine({
          price: ind.threshold ?? 70,
          color: 'rgba(167,139,250,0.55)',
          lineStyle: LineStyle.Dashed, lineWidth: 1,
          title: String(ind.threshold ?? 70),
        });
      } else if (!showScore && entry.score) {
        chart.removeSeries(entry.score);
        entry.score = null;
        entry.thLine = null;
      } else if (entry.score) {
        entry.score.applyOptions({ color: ind.color, title: `${title} score` });
        entry.thLine?.applyOptions({
          price: ind.threshold ?? 70,
          title: String(ind.threshold ?? 70),
        });
      }

      if (!candles?.length || candles.length < lookback + 1) {
        entry.line.setData([]);
        entry.score?.setData([]);
        entry.prim.update({ zones: [], nakedPOCs: [] }, {});
        eqDataMapRef.current.delete(ind.id);
        continue;
      }

      const eq = calcEquilibrium(candles, ind);

      entry.line.setData(eq.line);
      entry.score?.setData(eq.score);
      entry.prim.update(
        { zones: eq.zones, nakedPOCs: eq.nakedPOCs },
        {
          color:       ind.color,
          upColor:     ind.upColor    ?? theme.candle.bull,
          downColor:   ind.downColor  ?? theme.candle.bear,
          nakedColor:  ind.nakedColor ?? '#94A3B8',
          opacity:     ind.opacity    ?? 0.14,
          showProfile: ind.showProfile !== false,
          showNaked:   ind.showNaked   !== false,
          showBreak:   ind.showBreak   !== false,
          showLabel:   ind.showLabel   !== false,
        },
      );
      eqDataMapRef.current.set(ind.id, eq.points);
    }
  }, [candles, indicators, theme]);

  // ── TRENDER — Harmonie Multi-HTF ──────────────────────────────────────────
  // Fond des zones + trait « ≈ SL » par la primitive ; triangles de début et
  // étiquette du HTF confirmateur par les marqueurs d'une série fantôme ; BB du
  // timeframe courant en trois lignes optionnelles.
  useEffect(() => {
    const chart  = chartRef.current;
    const series = candleSeriesRef.current;
    if (!chart || !series) return;

    const trInds = indicators.filter(i => i.type === 'TRENDER');
    const map    = trenderMapRef.current;
    const active = new Set(trInds.map(i => i.id));
    let warn = null;

    for (const [id, e] of map) {
      if (!active.has(id)) {
        chart.removeSeries(e.marks);
        if (e.bb) { chart.removeSeries(e.bb.upper); chart.removeSeries(e.bb.middle); chart.removeSeries(e.bb.lower); }
        try { series.detachPrimitive(e.prim); } catch {}
        map.delete(id);
      }
    }

    for (const ind of trInds) {
      if (!map.has(ind.id)) {
        const prim = createHarmonyPrimitive();
        series.attachPrimitive(prim);
        map.set(ind.id, {
          prim,
          marks: chart.addLineSeries({
            color: 'rgba(0,0,0,0)', lineWidth: 0,
            priceLineVisible: false, lastValueVisible: false,
            crosshairMarkerVisible: false, title: '',
          }),
          bb: null,
        });
      }
      const e = map.get(ind.id);

      const bull = ind.bullColor ?? '#26A69A';
      const bear = ind.bearColor ?? '#EF5350';

      // Bandes de Bollinger du timeframe courant (réglages séparés du biais HTF)
      const showBbCur = ind.showBbCur !== false;
      if (showBbCur && !e.bb) {
        const c = ind.bbCurColor ?? '#60A5FA';
        e.bb = {
          upper:  chart.addLineSeries({ color: c, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: '' }),
          middle: chart.addLineSeries({ color: c + '70', lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: '' }),
          lower:  chart.addLineSeries({ color: c, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: '' }),
        };
      } else if (!showBbCur && e.bb) {
        chart.removeSeries(e.bb.upper); chart.removeSeries(e.bb.middle); chart.removeSeries(e.bb.lower);
        e.bb = null;
      } else if (e.bb) {
        const c = ind.bbCurColor ?? '#60A5FA';
        e.bb.upper.applyOptions({ color: c });
        e.bb.middle.applyOptions({ color: c + '70' });
        e.bb.lower.applyOptions({ color: c });
      }

      if (!candles?.length) {
        e.prim.update([], {});
        e.marks.setData([]); e.marks.setMarkers([]);
        e.bb?.upper.setData([]); e.bb?.middle.setData([]); e.bb?.lower.setData([]);
        continue;
      }

      const { zones, warmup } = calcHarmony(candles, ind, htfBars);
      warn = warn ?? (warmup?.ok === false ? warmup : null);

      e.prim.update(zones, {
        bullColor: bull,
        bearColor: bear,
        slColor:   ind.slColor  ?? '#EF5350',
        bgTransp:  ind.bgTransp ?? 80,
        showBg:    ind.showBg   !== false,
        showSlLn:  ind.showSlLn !== false,
      });

      // Triangle au début de chaque zone, texte = le ou les HTF confirmateurs
      // (ceux qui ont basculé sur cette bougie et complété l'harmonie).
      if (ind.showMark !== false) {
        const showConf = ind.showConf !== false;
        e.marks.setData(zones.map(z => ({ time: z.startTime, value: z.side === 'bull' ? candles[z.startIdx].low : candles[z.startIdx].high })));
        e.marks.setMarkers(zones.map(z => ({
          time:     z.startTime,
          position: z.side === 'bull' ? 'belowBar' : 'aboveBar',
          color:    z.side === 'bull' ? bull : bear,
          shape:    z.side === 'bull' ? 'arrowUp' : 'arrowDown',
          text:     showConf ? (z.confirm.join(' + ') || '—') : '',
          size:     1,
        })));
      } else {
        e.marks.setData([]); e.marks.setMarkers([]);
      }

      if (e.bb) {
        const { upper, middle, lower } = calcBB(candles, {
          period: ind.bbCurLen ?? 50,
          stdDev: ind.bbCurMult ?? 0.369,
          offset: 0,
          source: 'close',
        });
        e.bb.upper.setData(upper);
        e.bb.middle.setData(middle);
        e.bb.lower.setData(lower);
      }
    }

    setTrenderWarmup(trInds.length ? warn : null);
  }, [candles, indicators, htfBars]);

  // ── RANGE — l'intervalle d'une période ────────────────────────────────────
  // Une primitive par indicateur : le découpage du temps (cycle marquage/esquive
  // ou plage horaire) est fait dans lib/periodZones.js, ici on ne fait que
  // créer, mettre à jour et détacher.
  useEffect(() => {
    const chart  = chartRef.current;
    const series = candleSeriesRef.current;
    if (!chart || !series) return;

    const rgInds = indicators.filter(i => i.type === 'RANGE');
    const map    = rangeMapRef.current;
    const active = new Set(rgInds.map(i => i.id));

    for (const [id, prim] of map) {
      if (!active.has(id)) {
        try { series.detachPrimitive(prim); } catch {}
        map.delete(id);
      }
    }

    for (const ind of rgInds) {
      if (!map.has(ind.id)) {
        const prim = createRangeZonePrimitive();
        series.attachPrimitive(prim);
        map.set(ind.id, prim);
      }
      const prim = map.get(ind.id);

      const { zones } = candles?.length ? calcRangeZones(candles, ind) : { zones: [] };
      prim.update(zones, {
        color:     ind.color     ?? '#60A5FA',
        bullColor: ind.bullColor ?? theme.candle.bull,
        bearColor: ind.bearColor ?? theme.candle.bear,
        skipColor: ind.skipColor ?? '#94A3B8',
        dirColor:  ind.dirColor === true,
        opacity:   Math.max(0, Math.min(100, ind.zoneOpacity ?? 12)) / 100,
        showMid:   ind.showMid   !== false,
        showLabel: ind.showLabel !== false,
      });
    }
  }, [candles, indicators, theme]);

  // ── Pattern markers ───────────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Zone patterns (FVG, rFVG, HBH/BHB, HBHB/BHBH, COMPRESSION) draw rectangles
    // through their own primitive effects below — only marker patterns land here.
    //
    // Twins Bars a en plus une représentation « Position » : ses flèches se
    // taisent alors, et l'effet dédié plus bas dessine les trades à leur place.
    // Le filtre est ici et pas dans l'effet des positions parce que c'est la
    // même liste qui décide de créer ou de retirer les séries de marqueurs — un
    // motif absent d'`active` voit les siennes supprimées, ce qui est
    // exactement ce qu'on veut.
    const active = patterns.filter(p =>
      p.enabled && p.render !== 'zone'
      && !(p.type === 'TWINS_BARS' && (p.display ?? 'both') === 'position'));
    const map    = patternSeriesMapRef.current;
    const activeTypes = new Set(active.map(p => p.type));

    for (const [type, entry] of map) {
      if (!activeTypes.has(type)) {
        chart.removeSeries(entry.bullSeries);
        chart.removeSeries(entry.bearSeries);
        map.delete(type);
      }
    }

    const ghost = {
      color: 'rgba(0,0,0,0)', lineWidth: 0,
      priceLineVisible: false, lastValueVisible: false,
      crosshairMarkerVisible: false, title: '',
    };

    for (const pat of active) {
      if (!map.has(pat.type)) {
        map.set(pat.type, {
          bullSeries: chart.addLineSeries(ghost),
          bearSeries: chart.addLineSeries(ghost),
        });
      }

      const { bullSeries, bearSeries } = map.get(pat.type);

      if (!candles?.length) {
        bullSeries.setData([]); bullSeries.setMarkers([]);
        bearSeries.setData([]); bearSeries.setMarkers([]);
        continue;
      }

      let detected = [];
      if (pat.type === 'TWINS_BARS') {
        // Les options ne sont pas recopiées champ par champ : elles sortent de
        // lib/twins/params.js, qui sépare ce qui crée un motif de ce qui le
        // colorie. Ajouter une condition ne touche donc pas ce fichier.
        detected = calcTwinsBars(candles, twinsDetectOptions(pat));
      } else if (pat.type === 'RINGBLE') {
        // Les options ne sont pas recopiées champ par champ : elles sortent de
        // lib/ringble/params.js, qui sépare ce qui crée un motif de ce qui le
        // colorie. Ajouter une condition au ringble ne touche donc pas ce fichier.
        detected = calcRingble(candles, ringbleOptions(pat));
      } else if (pat.type === 'SUPER_AVAL') {
        // Même contrat : les options sortent de lib/superAval/params.js, pas
        // d'une recopie champ par champ. Ajouter une condition au motif ne
        // touche donc pas ce fichier.
        detected = calcSuperAval(candles, superAvalOptions(pat));
      }

      const bulls     = detected.filter(d => d.side === 'bull');
      const bears     = detected.filter(d => d.side === 'bear');
      const bullColor = pat.bullColor  ?? '#26A69A';
      const bearColor = pat.bearColor  ?? '#EF5350';
      const size      = pat.markerSize ?? 1;
      const label     = pat.showLabel !== false ? (MARKER_TEXT[pat.type] ?? '') : '';

      bullSeries.setData(bulls);
      bullSeries.setMarkers(bulls.map(({ time }) => ({
        time, position: 'belowBar', color: bullColor, shape: 'arrowUp', text: label, size,
      })));

      bearSeries.setData(bears);
      bearSeries.setMarkers(bears.map(({ time }) => ({
        time, position: 'aboveBar', color: bearColor, shape: 'arrowDown', text: label, size,
      })));
    }
  }, [candles, patterns]);

  // ── FVG / iFVG zones (rectangles via series primitive) ─────────────────────
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    const fvg = patterns.find(p => p.type === 'FVG' && p.enabled);

    if (!fvg || !candles?.length) {
      if (fvgPrimitiveRef.current) {
        try { series.detachPrimitive(fvgPrimitiveRef.current); } catch {}
        fvgPrimitiveRef.current = null;
      }
      return;
    }

    if (!fvgPrimitiveRef.current) {
      fvgPrimitiveRef.current = createFvgPrimitive();
      series.attachPrimitive(fvgPrimitiveRef.current);
    }

    const zones = calcFVG(candles, {
      direction:     fvg.direction ?? 'both',
      showMitigated: fvg.showMitigated !== false,
      showInverse:   fvg.showInverse   !== false,
      maxLen:        fvg.maxLen ?? 0,
      minPts:        fvg.minPts    ?? 0,
      atrPeriod:     fvg.atrPeriod ?? 14,
      atrMin:        fvg.atrMin    ?? 0,
      atrMax:        fvg.atrMax    ?? 0,
    });

    fvgPrimitiveRef.current.update(zones, {
      bullColor: fvg.bullColor ?? '#26A69A',
      bearColor: fvg.bearColor ?? '#EF5350',
      opacity:   fvg.opacity   ?? 0.18,
      showLabel: fvg.showLabel !== false,
      labelText: 'FVG',
    });
  }, [candles, patterns]);

  // ── xFVG : des zones, rien d'autre ─────────────────────────────────────────
  // Le plus court des effets de motif, et il doit le rester : le xFVG n'a pas
  // de mode « position », donc pas de simulation, pas de moniteur, pas de
  // rapport. Les options ne sont pas recopiées champ par champ ici — elles
  // sortent de lib/xfvg/params.js, qui sépare ce qui déplace une zone (détection)
  // de ce qui la colorie (style). Ajouter un réglage au motif ne touche donc
  // pas ce fichier.
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    const xfvg = patterns.find(p => p.type === 'XFVG' && p.enabled);

    if (!xfvg || !candles?.length) {
      if (xfvgPrimitiveRef.current) {
        try { series.detachPrimitive(xfvgPrimitiveRef.current); } catch {}
        xfvgPrimitiveRef.current = null;
      }
      return;
    }

    if (!xfvgPrimitiveRef.current) {
      xfvgPrimitiveRef.current = createFvgPrimitive();
      series.attachPrimitive(xfvgPrimitiveRef.current);
    }
    xfvgPrimitiveRef.current.update(
      calcXFVG(candles, xfvgDetectOptions(xfvg)),
      xfvgStyleOptions(xfvg),
    );
  }, [candles, patterns]);

  // ── xFVG+ : les extras, et leurs positions ─────────────────────────────────
  // MÊME détecteur que l'effet ci-dessus — calcXFVG, avec `swing` forcé sur
  // 'extra' (lib/xfvgx/detect.js) : les deux patterns dessinent donc la même
  // boîte quand ils sont réglés pareil, et c'est le signe que rien n'a divergé.
  // Ce qui est propre à celui-ci vient après la zone : un ORDRE EN ATTENTE sur le
  // trait blanc du swing (± une marge en points), SL et TP fixes en points. Le
  // câblage est celui de la famille — primitive de trades, moniteur, rapport.
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    const xfvgx = patterns.find(p => p.type === 'XFVGX' && p.enabled);

    const dropZones = () => {
      if (xfvgxPrimitiveRef.current) {
        try { series.detachPrimitive(xfvgxPrimitiveRef.current); } catch {}
        xfvgxPrimitiveRef.current = null;
      }
    };
    const dropPositions = () => {
      if (xfvgxPosPrimitiveRef.current) {
        try { series.detachPrimitive(xfvgxPosPrimitiveRef.current); } catch {}
        xfvgxPosPrimitiveRef.current = null;
      }
    };

    if (!xfvgx || !candles?.length) {
      dropZones(); dropPositions();
      setXfvgxStats(null); xfvgxReportRef.current = null;
      return;
    }

    const display = xfvgx.display ?? 'both';

    if (display === 'position') {
      dropZones();
    } else {
      if (!xfvgxPrimitiveRef.current) {
        xfvgxPrimitiveRef.current = createFvgPrimitive();
        series.attachPrimitive(xfvgxPrimitiveRef.current);
      }
      xfvgxPrimitiveRef.current.update(
        calcXfvgExtra(candles, xfvgxDetectOptions(xfvgx)),
        xfvgxStyleOptions(xfvgx),
      );
    }

    if (display === 'zone') {
      dropPositions();
      setXfvgxStats(null);
      xfvgxReportRef.current = null;
      return;
    }

    if (!xfvgxPosPrimitiveRef.current) {
      xfvgxPosPrimitiveRef.current = createTradesPrimitive();
      series.attachPrimitive(xfvgxPosPrimitiveRef.current);
    }
    const posOpts   = xfvgxPositionOptions(xfvgx);
    const positions = calcXfvgxPositions(candles, posOpts);
    // Les signaux jamais remplis restent dans `positions` — le rapport et les
    // statistiques les comptent — mais il n'y a rien à en dessiner : ni entrée,
    // ni sortie, ni prix. L'ordre en attente rend le cas COURANT ici, plus que
    // sur tout autre motif de la famille.
    xfvgxPosPrimitiveRef.current.update(positions.filter(p => p.status !== 'missed'), null);

    // Le TP est toujours réglé en points sur ce motif : l'objectif est constant,
    // on le donne aux statistiques plutôt que de leur faire deviner une médiane.
    const stats = computeStats(positions, { tpPts: posOpts.tpPts });
    setXfvgxStats({
      ...stats,
      skippedByUnique:   positions.skippedByUnique ?? 0,
      skippedByCooldown: positions.skippedByCooldown ?? 0,
      skippedWon:        positions.skippedWon ?? 0,
      dueArmed:          positions.dueArmed ?? 0,
      dueRemainingPts:   positions.dueRemainingPts ?? 0,
      dueRemainingSl:    positions.dueRemainingSl ?? 0,
    });
    xfvgxReportRef.current = {
      params: posOpts,
      stats,
      positions,
      // Combien de motifs la détection a trouvés en tout : sans ce compte, le
      // rapport aurait moins de positions que de zones sans dire pourquoi.
      extraStats: { zonesTotal: positions.zonesTotal ?? null },
    };
  }, [candles, patterns]);

  // ── RSIER : surzones du RSI d'un HTF ───────────────────────────────────────
  // Le motif ne dessine pas une boîte de PRIX mais une bande de TEMPS : le RSI
  // d'une unité supérieure dit « ici, le marché est en surachat », ce qui ne
  // désigne aucun niveau. D'où la primitive du TRENDER (fond pleine hauteur) et
  // non celle des FVG — le trait « ≈ SL » y reste éteint, faute de niveau à
  // tracer. Le triangle de début de zone passe par une série fantôme, comme
  // l'harmonie et les swings.
  //
  // `htfBars` porte la série HTF servie par /api/htf (cf. hooks/useHtfBars) :
  // sans elle le RSI n'aurait que ce que le graphe a chargé, très loin du compte
  // dès que le HTF est long. Le motif s'affiche quand même dans ce cas si
  // l'historique suffit, et le bandeau de préchauffage explique le silence sinon.
  useEffect(() => {
    const chart  = chartRef.current;
    const series = candleSeriesRef.current;
    if (!chart || !series) return;

    const rsier = patterns.find(p => p.type === 'RSIER' && p.enabled);

    const dropZones = () => {
      if (rsierPrimitiveRef.current) {
        try { series.detachPrimitive(rsierPrimitiveRef.current); } catch {}
        rsierPrimitiveRef.current = null;
      }
      if (rsierMarksRef.current) {
        chart.removeSeries(rsierMarksRef.current);
        rsierMarksRef.current = null;
      }
    };

    // En représentation « Position », la bande et son triangle se taisent : les
    // trades de l'effet suivant les remplacent. Le bandeau de préchauffage, lui,
    // ne dépend pas de la représentation — sans RSI il n'y a ni zone ni position.
    if (!rsier || !candles?.length || (rsier.display ?? 'both') === 'position') {
      dropZones();
      if (!rsier || !candles?.length) { setRsierWarmup(null); return; }
      const { warmup } = calcRsier(candles, rsierDetectOptions(rsier), htfBars);
      setRsierWarmup(warmup?.ok === false ? warmup : null);
      return;
    }

    if (!rsierPrimitiveRef.current) {
      rsierPrimitiveRef.current = createHarmonyPrimitive();
      series.attachPrimitive(rsierPrimitiveRef.current);
    }
    if (!rsierMarksRef.current) {
      rsierMarksRef.current = chart.addLineSeries({
        color: 'rgba(0,0,0,0)', lineWidth: 0,
        priceLineVisible: false, lastValueVisible: false,
        crosshairMarkerVisible: false, title: '',
      });
    }

    const { zones, warmup } = calcRsier(candles, rsierDetectOptions(rsier), htfBars);
    const style = rsierStyleOptions(rsier);

    rsierPrimitiveRef.current.update(zones, {
      bullColor: style.bullColor,
      bearColor: style.bearColor,
      bgTransp:  style.bgTransp,
      showBg:    style.showBg,
      showSlLn:  false,
    });

    // Triangle sur la bougie qui OUVRE la zone — celle où le motif est connu.
    // Le texte nomme le HTF lu et le RSI qui a ouvert la zone : sans lui, deux
    // RSIER réglés sur des unités différentes seraient indiscernables à l'œil.
    if (style.showMark) {
      const marks = zones.map(z => ({
        time:     z.startTime,
        value:    z.side === 'bull' ? candles[z.startIdx].low : candles[z.startIdx].high,
      }));
      rsierMarksRef.current.setData(marks);
      rsierMarksRef.current.setMarkers(zones.map(z => ({
        time:     z.startTime,
        position: z.side === 'bull' ? 'belowBar' : 'aboveBar',
        color:    z.side === 'bull' ? style.bullColor : style.bearColor,
        shape:    z.side === 'bull' ? 'arrowUp' : 'arrowDown',
        text:     style.showLabel ? `${z.htfLabel} · ${Math.round(z.rsiStart)}` : '',
        size:     1,
      })));
    } else {
      rsierMarksRef.current.setData([]);
      rsierMarksRef.current.setMarkers([]);
    }

    setRsierWarmup(warmup?.ok === false ? warmup : null);
  }, [candles, patterns, htfBars]);

  // ── RSIER : les positions ──────────────────────────────────────────────────
  // Même famille que Twins Bars, liq et rev — même simulateur
  // (lib/patternPositions.js), même moniteur, même rapport. Une position par
  // ENTRÉE en surzone, au marché, à l'ouverture de la bougie qui ouvre la bande :
  // le RSI HTF y est déjà connu, sa bougie s'étant clôturée avant. Le détail de
  // ce qui est propre au motif (cet instant d'entrée, et le stop qui s'appuie sur
  // les bougies PRÉCÉDENTES faute de structure) vit dans lib/rsier/positions.js.
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    const rsier = patterns.find(p => p.type === 'RSIER' && p.enabled);

    const dropPositions = () => {
      if (rsierPosPrimitiveRef.current) {
        try { series.detachPrimitive(rsierPosPrimitiveRef.current); } catch {}
        rsierPosPrimitiveRef.current = null;
      }
    };

    // Éteint, sans bougies, ou en zone seule : rien à simuler, et le moniteur
    // comme le bouton de rapport doivent disparaître avec.
    if (!rsier || !candles?.length || (rsier.display ?? 'both') === 'zone') {
      dropPositions();
      setRsierStats(null); rsierReportRef.current = null;
      return;
    }

    if (!rsierPosPrimitiveRef.current) {
      rsierPosPrimitiveRef.current = createTradesPrimitive();
      series.attachPrimitive(rsierPosPrimitiveRef.current);
    }
    const posOpts   = rsierPositionOptions(rsier);
    const positions = calcRsierPositions(candles, posOpts, htfBars);
    // L'entrée étant au marché, aucun signal n'est 'missed' — le filtre reste,
    // pour que ce câblage se lise comme celui des trois autres motifs.
    rsierPosPrimitiveRef.current.update(positions.filter(p => p.status !== 'missed'), null);

    // TP réglé en points = objectif CONSTANT : on le donne aux statistiques, qui
    // sinon le déduiraient de la médiane des distances observées. En RR, il varie
    // d'une position à l'autre et n'a pas de valeur unique.
    const stats = computeStats(positions, {
      tpPts: posOpts.tpMode === 'points' ? posOpts.tpPts : 0,
    });
    setRsierStats({
      ...stats,
      skippedByUnique:   positions.skippedByUnique ?? 0,
      skippedByCooldown: positions.skippedByCooldown ?? 0,
      skippedWon:        positions.skippedWon ?? 0,
      dueArmed:          positions.dueArmed ?? 0,
      dueRemainingPts:   positions.dueRemainingPts ?? 0,
      dueRemainingSl:    positions.dueRemainingSl ?? 0,
    });
    rsierReportRef.current = {
      params: posOpts,
      stats,
      positions,
      // Ce que la simulation n'a pas pu jouer : les zones ouvertes trop tôt dans
      // les données pour ancrer un stop. Sans ce compte, le rapport aurait moins
      // de positions que de zones sans jamais dire pourquoi.
      extraStats: {
        zonesTotal:       positions.zonesTotal ?? null,
        skippedByHistory: positions.skippedByHistory ?? 0,
      },
    };
  }, [candles, patterns, htfBars]);

  // ── Motif TRENDER : les zones d'harmonie ───────────────────────────────────
  // MÊME calcul que l'indicateur TRENDER plus haut — littéralement la même
  // fonction (lib/harmony.js, appelée par lib/trender/detect.js) —, et même
  // primitive pour le dessin. Ce qui change tient en deux points : le motif
  // filtre les zones par sens, et il n'affiche pas les Bollinger du timeframe
  // courant (seule leur BASE l'intéresse, et c'est le trait « ≈ SL »).
  //
  // Les deux peuvent être allumés en même temps et se superposeront exactement :
  // c'est le signe que rien n'a divergé.
  useEffect(() => {
    const chart  = chartRef.current;
    const series = candleSeriesRef.current;
    if (!chart || !series) return;

    const harmo = patterns.find(p => p.type === 'HARMONY' && p.enabled);

    const dropZones = () => {
      if (harmoPrimitiveRef.current) {
        try { series.detachPrimitive(harmoPrimitiveRef.current); } catch {}
        harmoPrimitiveRef.current = null;
      }
      if (harmoMarksRef.current) {
        chart.removeSeries(harmoMarksRef.current);
        harmoMarksRef.current = null;
      }
    };

    if (!harmo || !candles?.length || (harmo.display ?? 'both') === 'position') {
      dropZones();
      if (!harmo || !candles?.length) { setHarmoWarmup(null); return; }
      const { warmup } = calcTrenderZones(candles, trenderDetectOptions(harmo), htfBars);
      setHarmoWarmup(warmup?.ok === false ? warmup : null);
      return;
    }

    if (!harmoPrimitiveRef.current) {
      harmoPrimitiveRef.current = createHarmonyPrimitive();
      series.attachPrimitive(harmoPrimitiveRef.current);
    }
    if (!harmoMarksRef.current) {
      harmoMarksRef.current = chart.addLineSeries({
        color: 'rgba(0,0,0,0)', lineWidth: 0,
        priceLineVisible: false, lastValueVisible: false,
        crosshairMarkerVisible: false, title: '',
      });
    }

    const { zones, warmup } = calcTrenderZones(candles, trenderDetectOptions(harmo), htfBars);
    const style = trenderStyleOptions(harmo);

    harmoPrimitiveRef.current.update(zones, {
      bullColor: style.bullColor,
      bearColor: style.bearColor,
      slColor:   style.slColor,
      bgTransp:  style.bgTransp,
      showBg:    style.showBg,
      showSlLn:  style.showSlLn,
    });

    // Triangle au début de chaque zone, texte = le ou les HTF confirmateurs —
    // ceux qui ont basculé sur cette bougie et complété l'harmonie.
    if (style.showMark) {
      harmoMarksRef.current.setData(zones.map(z => ({
        time:  z.startTime,
        value: z.side === 'bull' ? candles[z.startIdx].low : candles[z.startIdx].high,
      })));
      harmoMarksRef.current.setMarkers(zones.map(z => ({
        time:     z.startTime,
        position: z.side === 'bull' ? 'belowBar' : 'aboveBar',
        color:    z.side === 'bull' ? style.bullColor : style.bearColor,
        shape:    z.side === 'bull' ? 'arrowUp' : 'arrowDown',
        text:     style.showConf ? (z.confirm.join(' + ') || '—') : '',
        size:     1,
      })));
    } else {
      harmoMarksRef.current.setData([]);
      harmoMarksRef.current.setMarkers([]);
    }

    setHarmoWarmup(warmup?.ok === false ? warmup : null);
  }, [candles, patterns, htfBars]);

  // ── Motif TRENDER : les positions ──────────────────────────────────────────
  // Une position par OUVERTURE de zone, au marché, à l'ouverture de la bougie qui
  // SUIT celle où la zone s'ouvre — le stop étant le trait « ≈ SL », qui contient
  // la clôture de la bougie de détection. Le pourquoi vit dans
  // lib/trender/positions.js ; la gestion, elle, est celle de toute la famille.
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    const harmo = patterns.find(p => p.type === 'HARMONY' && p.enabled);

    const dropPositions = () => {
      if (harmoPosPrimitiveRef.current) {
        try { series.detachPrimitive(harmoPosPrimitiveRef.current); } catch {}
        harmoPosPrimitiveRef.current = null;
      }
    };

    if (!harmo || !candles?.length || (harmo.display ?? 'both') === 'zone') {
      dropPositions();
      setHarmoStats(null); harmoReportRef.current = null;
      return;
    }

    if (!harmoPosPrimitiveRef.current) {
      harmoPosPrimitiveRef.current = createTradesPrimitive();
      series.attachPrimitive(harmoPosPrimitiveRef.current);
    }
    const posOpts   = trenderPositionOptions(harmo);
    const positions = calcTrenderPositions(candles, posOpts, htfBars);
    harmoPosPrimitiveRef.current.update(positions.filter(p => p.status !== 'missed'), null);

    const stats = computeStats(positions, {
      tpPts: posOpts.tpMode === 'points' ? posOpts.tpPts : 0,
    });
    setHarmoStats({
      ...stats,
      skippedByUnique:   positions.skippedByUnique ?? 0,
      skippedByCooldown: positions.skippedByCooldown ?? 0,
      skippedWon:        positions.skippedWon ?? 0,
      dueArmed:          positions.dueArmed ?? 0,
      dueRemainingPts:   positions.dueRemainingPts ?? 0,
      dueRemainingSl:    positions.dueRemainingSl ?? 0,
    });
    harmoReportRef.current = {
      params: posOpts,
      stats,
      positions,
      // Combien de zones l'harmonie a produites, et combien n'étaient pas
      // jouables — faute d'ATR (zone trop proche du début des données) ou de stop
      // posable. Sans ces comptes, le rapport aurait moins de positions que de
      // zones sans jamais dire pourquoi.
      extraStats: {
        zonesTotal:    positions.zonesTotal ?? null,
        skippedByAtr:  positions.skippedByAtr ?? 0,
        skippedByStop: positions.skippedByStop ?? 0,
      },
    };
  }, [candles, patterns, htfBars]);

  // ── liq : la pince, motif autonome ─────────────────────────────────────────
  // Motif entièrement séparé du xFVG : ses réglages, ses couleurs, son
  // interrupteur. Il ne partage avec lui que les prédicats de bougie de
  // lib/candleRules.js. Et il ne se dessine PAS comme lui — un trait sur un
  // prix, pas une boîte sur une zone —, d'où sa propre primitive.
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    const liq = patterns.find(p => p.type === 'LIQ' && p.enabled);

    const dropLevels = () => {
      if (liqPrimitiveRef.current) {
        try { series.detachPrimitive(liqPrimitiveRef.current); } catch {}
        liqPrimitiveRef.current = null;
      }
    };
    const dropPositions = () => {
      if (liqPosPrimitiveRef.current) {
        try { series.detachPrimitive(liqPosPrimitiveRef.current); } catch {}
        liqPosPrimitiveRef.current = null;
      }
    };

    if (!liq || !candles?.length) {
      dropLevels(); dropPositions();
      setLiqStats(null); liqReportRef.current = null;
      return;
    }

    const display = liq.display ?? 'level';

    if (display === 'position') {
      dropLevels();
    } else {
      if (!liqPrimitiveRef.current) {
        liqPrimitiveRef.current = createLevelPrimitive();
        series.attachPrimitive(liqPrimitiveRef.current);
      }
      liqPrimitiveRef.current.update(
        calcLiq(candles, liqDetectOptions(liq)),
        liqStyleOptions(liq),
      );
    }

    if (display === 'level') {
      dropPositions();
      setLiqStats(null);
      liqReportRef.current = null;
      return;
    }

    if (!liqPosPrimitiveRef.current) {
      liqPosPrimitiveRef.current = createTradesPrimitive();
      series.attachPrimitive(liqPosPrimitiveRef.current);
    }
    const posOpts   = liqPositionOptions(liq);
    const positions = calcLiqPositions(candles, posOpts);
    // Les signaux jamais remplis restent dans `positions` — le rapport et les
    // statistiques les comptent — mais il n'y a rien à en dessiner : ni entrée,
    // ni sortie, ni prix.
    liqPosPrimitiveRef.current.update(positions.filter(p => p.status !== 'missed'), null);

    // Les statistiques viennent du MÊME code que le rFVG et le KO
    // (lib/signals/stats.js) : deux motifs doivent être mesurés pareil, sinon on
    // ne sait pas si un écart vient de la stratégie ou du compteur. Le TP variant
    // d'une position à l'autre (c'est un RR), on ne peut pas fournir le `tpPts`
    // global qu'attend l'étude break-even — le risque, lui, est dans chaque
    // position.
    const stats = computeStats(positions, { tpPts: 0 });
    setLiqStats({
      ...stats,
      skippedByUnique:   positions.skippedByUnique ?? 0,
      skippedByCooldown: positions.skippedByCooldown ?? 0,
      skippedWon:        positions.skippedWon ?? 0,
    });
    liqReportRef.current = { params: posOpts, stats, positions };
  }, [candles, patterns]);

  // ── rev : pause puis retournement, motif autonome ──────────────────────────
  // Même câblage que le liq, à l'identique : c'est la même famille, et ils
  // partagent détection de bougies, simulation de positions et construction de
  // rapport. Seuls la détection propre au motif et ses réglages diffèrent.
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    const rev = patterns.find(p => p.type === 'REV' && p.enabled);

    const dropLevels = () => {
      if (revPrimitiveRef.current) {
        try { series.detachPrimitive(revPrimitiveRef.current); } catch {}
        revPrimitiveRef.current = null;
      }
    };
    const dropPositions = () => {
      if (revPosPrimitiveRef.current) {
        try { series.detachPrimitive(revPosPrimitiveRef.current); } catch {}
        revPosPrimitiveRef.current = null;
      }
    };

    if (!rev || !candles?.length) {
      dropLevels(); dropPositions();
      setRevStats(null); revReportRef.current = null;
      return;
    }

    const display = rev.display ?? 'both';

    if (display === 'position') {
      dropLevels();
    } else {
      if (!revPrimitiveRef.current) {
        revPrimitiveRef.current = createLevelPrimitive();
        series.attachPrimitive(revPrimitiveRef.current);
      }
      revPrimitiveRef.current.update(
        calcRev(candles, revDetectOptions(rev)),
        revStyleOptions(rev),
      );
    }

    if (display === 'level') {
      dropPositions();
      setRevStats(null);
      revReportRef.current = null;
      return;
    }

    if (!revPosPrimitiveRef.current) {
      revPosPrimitiveRef.current = createTradesPrimitive();
      series.attachPrimitive(revPosPrimitiveRef.current);
    }
    const posOpts   = revPositionOptions(rev);
    const positions = calcRevPositions(candles, posOpts);
    revPosPrimitiveRef.current.update(positions.filter(p => p.status !== 'missed'), null);

    const stats = computeStats(positions, { tpPts: 0 });
    setRevStats({
      ...stats,
      skippedByUnique:   positions.skippedByUnique ?? 0,
      skippedByCooldown: positions.skippedByCooldown ?? 0,
      skippedWon:        positions.skippedWon ?? 0,
    });
    revReportRef.current = { params: posOpts, stats, positions };
  }, [candles, patterns]);

  // ── Twins Bars : les positions ─────────────────────────────────────────────
  // Même famille que le liq et le rev — même simulateur, même rapport, même
  // moniteur —, à une chose près : PAS de primitive de niveau. Le motif se
  // repère à sa flèche, dessinée par l'effet des marqueurs plus haut ; il n'y a
  // donc ici que les trades à attacher ou à retirer. L'entrée est au marché et
  // rien d'autre : aucun signal 'missed' n'est possible, mais le filtre reste,
  // pour que ce câblage se lise comme celui des deux autres.
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    const twins = patterns.find(p => p.type === 'TWINS_BARS' && p.enabled);

    const dropPositions = () => {
      if (twinsPosPrimitiveRef.current) {
        try { series.detachPrimitive(twinsPosPrimitiveRef.current); } catch {}
        twinsPosPrimitiveRef.current = null;
      }
    };

    // Éteint, sans bougies, ou en repère seul : rien à simuler, et le moniteur
    // comme le bouton de rapport doivent disparaître avec.
    if (!twins || !candles?.length || (twins.display ?? 'both') === 'marker') {
      dropPositions();
      setTwinsStats(null); twinsReportRef.current = null;
      return;
    }

    if (!twinsPosPrimitiveRef.current) {
      twinsPosPrimitiveRef.current = createTradesPrimitive();
      series.attachPrimitive(twinsPosPrimitiveRef.current);
    }
    const posOpts   = twinsPositionOptions(twins);
    const positions = calcTwinsPositions(candles, posOpts);
    twinsPosPrimitiveRef.current.update(positions.filter(p => p.status !== 'missed'), null);

    // TP réglé en points = objectif CONSTANT : on le donne aux statistiques, qui
    // sinon le déduiraient de la médiane des distances observées. En RR, il varie
    // d'une position à l'autre et n'a pas de valeur unique — la médiane reste la
    // seule réponse honnête.
    const stats = computeStats(positions, {
      tpPts: posOpts.tpMode === 'points' ? posOpts.tpPts : 0,
    });
    setTwinsStats({
      ...stats,
      skippedByUnique:   positions.skippedByUnique ?? 0,
      skippedByCooldown: positions.skippedByCooldown ?? 0,
      skippedWon:        positions.skippedWon ?? 0,
      dueArmed:          positions.dueArmed ?? 0,
      dueRemainingPts:   positions.dueRemainingPts ?? 0,
      dueRemainingSl:    positions.dueRemainingSl ?? 0,
    });
    twinsReportRef.current = { params: posOpts, stats, positions };
  }, [candles, patterns]);

  // Rapport JSON des positions liq — même forme que ceux du rFVG et du KO, donc
  // /rapports le lit sans rien savoir de ce motif.
  // Téléchargement des rapports de la famille (liq, rev) : la construction du
  // document est partagée (lib/patternReport.js), seul le titre change.
  const downloadFamilyReport = useCallback((ref, titre, nom, conventions) => {
    const rep = ref.current;
    if (!rep) return;
    const doc  = buildPatternReport({ titre, ...rep, conventions });
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `${nom}-positions-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const downloadLiqReport = useCallback(
    () => downloadFamilyReport(liqReportRef, 'liq — positions simulées (pause entre deux impulsions opposées ; stop sur tout le motif, TP en RR)', 'liq'),
    [downloadFamilyReport]);
  const downloadRevReport = useCallback(
    () => downloadFamilyReport(revReportRef, 'rev — positions simulées (pause puis deux impulsions opposées ; stop sur tout le motif, TP en RR)', 'rev'),
    [downloadFamilyReport]);
  // Twins Bars : mêmes conventions que la famille, SAUF celles qui décrivent
  // l'ordre en attente au bord d'une bande. Ce motif n'en a pas — les laisser
  // ferait décrire au rapport une mécanique que le motif n'a jamais eue.
  const downloadTwinsReport = useCallback(
    () => downloadFamilyReport(
      twinsReportRef,
      'Twins Bars — positions simulées (deux bougies opposées à corps plein ; entrée au marché, stop sur la paire, TP en RR ou en points)',
      'twins-bars',
      {
        entree: "AU MARCHÉ, et rien d'autre : à l'ouverture de la bougie qui suit la seconde jumelle. Le motif n'est connu qu'à la clôture de celle-ci, c'est donc le premier prix disponible ensuite. Il n'existe pas de mode 'zone' pour ce motif — il désigne une bougie, pas une bande où poser un ordre en attente : une position est toujours prise, et entryMode est forcé à 'market' même si un réglage enregistré disait autre chose",
        signauxRates: "aucun : l'entrée étant au marché, tout signal donne une position. Le statut 'missed' et le champ waitedBars n'apparaissent jamais dans ce rapport — ils restent dans la forme du document pour que les motifs de la famille se comparent champ à champ",
        stop: "slMode = 'structure' : sous le PLUS BAS des DEUX bougies du motif, moins slMarginPts ; au-dessus du PLUS HAUT plus la marge en vente — le risque suit alors la taille de la paire et VARIE d'une position à l'autre. slMode = 'points' : à slPts de l'entrée, le risque devient CONSTANT et le seuil de rentabilité redevient 1/(1+RR). Dans les deux cas le stop est connu avant l'entrée, donc actif dès la bougie d'entrée",
      },
    ),
    [downloadFamilyReport]);

  // xFVG+ : mêmes conventions que la famille, sauf celles que ce motif prend
  // autrement — l'entrée (un ordre sur un NIVEAU, pas au bord d'une bande), le
  // stop et le TP (deux distances fixes en points). Les laisser telles quelles
  // ferait décrire au rapport une mécanique que le motif n'a pas.
  const downloadXfvgxReport = useCallback(
    () => downloadFamilyReport(
      xfvgxReportRef,
      'xFVG+ — positions simulées (xFVG dont la zone contient le swing cassé ; ordre en attente sur ce trait, SL et TP fixes en points)',
      'xfvg-extra',
      {
        detection: "le xFVG EXTRA, et lui seul : un xFVG dont la boîte contient le dernier swing d'EN FACE — swing HAUT pour un motif haussier, swing BAS pour un baissier —, celui-ci étant cherché hors du motif (on part de la bougie qui OUVRE la figure et on remonte) et seulement s'il était déjà CONFIRMÉ à la clôture du motif, sinon on lirait l'avenir. C'est le MÊME détecteur que le pattern xFVG (lib/xfvg/detect.js, calcXFVG) avec swing = 'extra' : les deux modes de figure ('x3', l'imbalance 3 bougies ; 'x2', le retournement contra-MM en 2 bougies) et tous leurs filtres s'appliquent ici à l'identique",
        entree: "ORDRE EN ATTENTE SUR LE TRAIT, jamais au marché. Le niveau visé est le swing cassé ± entryMarginPts POINTS — marge SIGNÉE comptée par rapport au côté d'où le prix REVIENT : POSITIVE, l'ordre est EN DEÇÀ du trait (au-dessus pour un motif haussier, en dessous pour un baissier) et sera servi plus tôt, à un prix moins bon ; NÉGATIVE, il est AU-DELÀ et exige que le prix dépasse le trait. Le niveau est porté par le champ `level` de chaque position. L'ordre est armé à partir de la bougie qui SUIT la figure (le motif n'est connu qu'à la clôture de sa dernière bougie) et il faut que le prix soit HORS du niveau pour qu'il y « revienne » : s'il est du bon côté à la clôture du motif l'ordre est armé aussitôt, sinon on attend qu'il en sorte — c'est le côté de sortie qui fixe alors le sens d'approche. Remplissage au niveau exact, ou à l'ouverture de la bougie si elle a ouvert au-delà : un ordre réel aurait été servi mieux. Passé entryWaitBars bougies l'ordre est annulé (statut 'missed'). Techniquement, le simulateur joue ça comme une bande de HAUTEUR NULLE (top = bottom = le niveau) : un ordre au bord d'une bande sans hauteur EST un ordre au niveau",
        signauxRates: "les 'missed' sont des signaux dont l'ordre n'a jamais été rempli, et ils sont COURANTS ici — c'est un motif où l'on attend un retour. Ils sont listés exprès, sans prix ni résultat, et n'entrent dans aucune statistique : les omettre donnerait un taux de réussite calculé sur les seuls trades que le marché a bien voulu servir. waitedBars dit, pour les autres, combien de bougies l'ordre a attendu. zonesTotal (dans stats) dit combien de motifs la détection a trouvés en tout — l'écart avec `total` tient aux figures trop près du bord des données pour qu'on ait une bougie où poser l'ordre",
        stop: "slMode est figé sur 'points' : une DISTANCE FIXE de slPts depuis l'entrée, et rien d'autre. Le motif n'a pas de stop structurel qui lui soit propre — la boîte est déjà l'objet qu'on joue, s'en servir de stop attacherait le risque au hasard de la taille de l'impulsion. Le risque est donc CONSTANT d'une position à l'autre : points et R disent la même chose. Le stop est connu avant l'entrée, donc posé avec l'ordre et actif dès la bougie de remplissage",
        tp: "tpMode est figé sur 'points' lui aussi : tpPts depuis l'entrée, INDÉPENDANT du stop. Aucun RR n'est visé — il est un rapport entre deux réglages fixes (tpPts ÷ slPts), et le seuil de rentabilité redevient le 1/(1+RR) des manuels. Le champ `rr` de chaque position vaut null, `tpPts` porte la distance réellement visée (celle du dû quand il a pris la place de l'objectif)",
        breakEven: "inchangé et toujours en R — mais le risque étant constant ici (SL en points), 1 R vaut exactement slPts : le seuil et le blocage se lisent donc aussi bien dans l'une ou l'autre unité, contrairement aux motifs à stop structurel",
      },
    ),
    [downloadFamilyReport]);

  // RSIER : mêmes conventions que la famille, sauf les trois que ce motif prend
  // autrement — l'entrée (au marché, à l'ouverture de la bougie qui ouvre la
  // bande), les signaux ratés (aucun) et le stop (qui ne s'appuie sur aucune
  // structure du motif, faute de structure). Les laisser telles quelles ferait
  // décrire au rapport une mécanique que le motif n'a jamais eue.
  const downloadRsierReport = useCallback(
    () => downloadFamilyReport(
      rsierReportRef,
      'RSIER — positions simulées (surzone du RSI d’un HTF ; entrée au marché à l’ouverture de la zone, stop sur l’extrême précédent ou en points, TP en RR ou en points)',
      'rsier',
      {
        entree: "AU MARCHÉ, et rien d'autre : à l'OUVERTURE de la bougie qui ouvre la zone — une position par ENTRÉE en surzone, pas une par bougie de zone. La bougie HTF qui a fait basculer le RSI s'est clôturée AVANT que cette bougie ne s'ouvre : son RSI est donc déjà connu à cet instant et rien n'est anticipé. Il n'existe pas de mode 'zone' pour ce motif — la bande est faite de TEMPS et non de prix, il n'y a aucun bord où poser un ordre en attente : entryMode est forcé à 'market' même si un réglage enregistré disait autre chose",
        signauxRates: "aucun : l'entrée étant au marché, toute zone jouable donne une position. Le statut 'missed' et le champ waitedBars n'apparaissent jamais dans ce rapport — ils restent dans la forme du document pour que les motifs de la famille se comparent champ à champ. En revanche skippedByHistory compte les zones ÉCARTÉES : celles qui s'ouvrent avant qu'on dispose des slLookback bougies où ancrer le stop. zonesTotal dit combien de zones la détection a trouvé en tout",
        stop: "le motif ne désigne AUCUNE structure de prix — seulement un instant. slMode = 'structure' : sous le plus BAS des slLookback bougies qui PRÉCÈDENT l'entrée (au-dessus du plus HAUT en vente), moins slMarginPts — le dernier extrême laissé par le marché avant qu'on entre ; le risque varie alors d'une position à l'autre. slMode = 'points' : à slPts de l'entrée, risque CONSTANT — le seul stop vraiment natif du motif. Dans les deux cas le stop est connu avant l'entrée, donc actif dès la bougie d'entrée",
        sensJoue: "tradeSide = 'reversion' (défaut) : on ACHÈTE la survente et on VEND le surachat, le pari étant que l'excès se corrige. tradeSide = 'continuation' : exactement l'inverse, la surzone étant lue comme une tendance qui continue. Le sens de la ZONE ne change pas pour autant — une zone de survente reste une survente, même quand on la vend",
        nonRepaint: "chaque bougie du graphe lit le RSI de la dernière bougie HTF CLÔTURÉE (équivalent de request.security(expr[1], lookahead_on) en Pine). Une zone n'ouvre donc jamais dans le bucket HTF où le RSI est entré en surzone, mais sur la PREMIÈRE bougie du bucket suivant : c'est le décalage qu'on paie pour que l'historique ne mente pas sur ce qu'on aurait vu en direct",
      },
    ),
    [downloadFamilyReport]);

  // Motif TRENDER : conventions d'entrée et de stop refaites, le reste étant
  // celui de la famille.
  const downloadHarmoReport = useCallback(
    () => downloadFamilyReport(
      harmoReportRef,
      'TRENDER — positions simulées (harmonie multi-HTF ; entrée au marché à l’ouverture de la zone, SL et TP fixes et indépendants, en points ou en ATR)',
      'trender',
      {
        detection: "IDENTIQUE À L'INDICATEUR TRENDER : c'est la même fonction qui calcule les deux (lib/harmony.js). Sur chacun des 3 HTF actifs, une Bollinger(bbLen, bbMult) sur les clôtures HTF donne un biais (+1 / −1 / 0) ; la zone s'ouvre quand TOUS les HTF actifs pointent dans le même sens et court tant qu'ils y restent. Le seul ajout du motif est le filtre `direction`, qui retient des zones sans en créer aucune",
        entree: "AU MARCHÉ, à l'OUVERTURE de la bougie qui ouvre la zone — une position par OUVERTURE DE ZONE, pas une par bougie de zone. L'harmonie y est déjà connue (elle ne lit que des bougies HTF CLÔTURÉES, donc la valeur portée par cette bougie était figée avant même qu'elle ne s'ouvre) et l'ATR qui dimensionne les distances est lu sur la bougie PRÉCÉDENTE : rien de ce qui décide de la position ne vient de la bougie où l'on entre. Il n'existe pas de mode 'zone' : la bande est faite de TEMPS, il n'y a aucun bord de prix où attendre un retour",
        signauxRates: "aucun : l'entrée étant au marché, toute zone jouable donne une position. Deux comptes disent ce qui a été ÉCARTÉ — skippedByAtr : zones ouvertes avant que l'ATR n'existe (ou sur la toute première bougie chargée, qui n'a pas de bougie précédente où le lire) ; skippedByStop : stop non posable, distance nulle ou du mauvais côté. zonesTotal dit combien de zones l'harmonie a produites en tout",
        stop: "une DISTANCE FIXE depuis l'entrée, indépendante du TP. slMode = 'points' : slPts points, risque CONSTANT. slMode = 'atr' : slAtrMult × ATR(atrPeriod), l'ATR de Wilder étant lu sur la bougie qui PRÉCÈDE l'entrée — le risque suit alors la volatilité du moment et varie d'une position à l'autre. Le trait « ≈ SL » que l'indicateur dessine n'est PAS le stop : il est reporté dans le champ `level` de chaque position pour qu'on puisse le relire, et c'est tout. Le stop est connu avant l'entrée, donc actif dès la bougie d'entrée",
        tp: "une DISTANCE FIXE depuis l'entrée, elle aussi, et réglée SÉPARÉMENT du stop : tpMode = 'points' (tpPts points) ou 'atr' (tpAtrMult × le MÊME ATR que le stop, lu au même endroit). Aucun RR n'est visé — il est un RÉSULTAT : le champ `rr` de chaque position vaut null, `tpPts` porte la distance réellement visée, et profitR donne le R réalisé. Le seuil de rentabilité affiché est donc celui qui a été RÉALISÉ, pas celui d'un objectif théorique",
        sensJoue: "celui de la zone, et il n'y a rien à régler : une harmonie haussière s'achète, une baissière se vend. Le TRENDER est un indicateur de TENDANCE — le prendre à contre-pied serait un autre motif, pas un réglage",
        nonRepaint: "chaque bougie du graphe lit le biais de la dernière bougie HTF CLÔTURÉE (équivalent de request.security(expr[1], lookahead_on) en Pine) : ce qui est affiché sur une bougie ne changera plus jamais. Le confirmateur (champ `confirm` de la zone) est le HTF qui a basculé sur la bougie d'ouverture — les autres étaient déjà alignés",
        sortieDeZone: "AUCUNE : la position vit sa vie de SL / TP / BE et ne se referme pas quand l'harmonie se rompt. La fin de zone n'est donc pas une sortie, et une position peut survivre à la zone qui l'a ouverte",
      },
    ),
    [downloadFamilyReport]);

  // ── rFVG zones (même primitive que le FVG, autre détection) ────────────────
  // Deux habits, cumulables : la zone classique, et/ou la position simulée
  // (pré-entrée à la clôture de la 3e bougie, SL/TP en points, expiration avec
  // la zone) rendue par la même primitive que les trades du backtest.
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    const rfvg = patterns.find(p => p.type === 'RFVG' && p.enabled);

    const dropZones = () => {
      if (rfvgPrimitiveRef.current) {
        try { series.detachPrimitive(rfvgPrimitiveRef.current); } catch {}
        rfvgPrimitiveRef.current = null;
      }
    };
    const dropPositions = () => {
      if (rfvgPosPrimitiveRef.current) {
        try { series.detachPrimitive(rfvgPosPrimitiveRef.current); } catch {}
        rfvgPosPrimitiveRef.current = null;
      }
    };

    if (!rfvg || !candles?.length) { dropZones(); dropPositions(); setRfvgStats(null); rfvgReportRef.current = null; return; }

    const display = rfvg.display ?? 'zone';
    const detectOpts = {
      mode:      rfvg.mode      ?? 'rfvg',
      direction: rfvg.direction ?? 'both',
      minPts:       rfvg.minPts       ?? 0,
      maxPts:       rfvg.maxPts       ?? 0,   // hauteur max de la zone (0 = off)
      maPeriodFast: rfvg.maPeriodFast ?? 15,
      maPeriodSlow: rfvg.maPeriodSlow ?? 200,
      slowOpenOnly: rfvg.slowOpenOnly === true,
      firstSlowSide: rfvg.firstSlowSide === true,
      slowStraddle:  rfvg.slowStraddle  === true,
      pairOpposite:  rfvg.pairOpposite  === true,
      atrPeriod: rfvg.atrPeriod ?? 14,
      atrMult:   rfvg.atrMult   ?? 1.5,
      atrMult3:  rfvg.atrMult3  ?? 0,
      wick3:     rfvg.wick3     === true,
      sizeMode:  rfvg.sizeMode  ?? 'range',
      extLen:    rfvg.extLen    ?? 20,
    };

    if (display === 'position') {
      dropZones();
    } else {
      if (!rfvgPrimitiveRef.current) {
        rfvgPrimitiveRef.current = createFvgPrimitive();
        series.attachPrimitive(rfvgPrimitiveRef.current);
      }
      rfvgPrimitiveRef.current.update(calcRFVG(candles, detectOpts), {
        bullColor: rfvg.bullColor ?? '#26A69A',
        bearColor: rfvg.bearColor ?? '#EF5350',
        opacity:   rfvg.opacity   ?? 0.18,
        showLabel: rfvg.showLabel !== false,
        labelText: 'rFVG',
      });
    }

    if (display === 'zone') {
      dropPositions();
      setRfvgStats(null);
      rfvgReportRef.current = null;
    } else {
      if (!rfvgPosPrimitiveRef.current) {
        rfvgPosPrimitiveRef.current = createTradesPrimitive();
        series.attachPrimitive(rfvgPosPrimitiveRef.current);
      }
      const slMarginPts   = rfvg.slMarginPts   ?? 2;
      const tpPts         = rfvg.tpPts         ?? 10;
      const beTriggerPts  = rfvg.beTriggerPts  ?? 0;
      const beTouchTrigger = rfvg.beTouchTrigger ?? 0;
      const beBarsTrigger = rfvg.beBarsTrigger ?? 0;
      const beSwingBars   = rfvg.beSwingBars   ?? 0;
      const beLevelPts    = rfvg.beLevelPts    ?? 0;
      const posOpts = {
        ...detectOpts,
        slMarginPts, tpPts,
        slCapPts:  rfvg.slCapPts  ?? 0,
        spreadPts: rfvg.spreadPts ?? 0,
        beTriggerPts, beTouchTrigger, beBarsTrigger, beSwingBars, beLevelPts,
        uniqueTrade: rfvg.uniqueTrade === true,
        skipAfterTp: rfvg.skipAfterTp ?? 0,
        // Le dû (lib/dueLedger.js) : 0 = éteint, le motif joue son vrai TP.
        dueAfterSl:  rfvg.dueAfterSl ?? 0,
        dueMode:     rfvg.dueMode    ?? 'full',
      };
      const positions = calcRFVGPositions(candles, posOpts);
      rfvgPosPrimitiveRef.current.update(positions, null);

      // Le moniteur suit le même calcul que le dessin : il se met à jour tout
      // seul à chaque chargement de bougies (préchargement d'historique inclus).
      // Le P&L se compte en POINTS : le lot est fixe, c'est lui qui est
      // proportionnel au gain réel. Le seuil de rentabilité affiché est celui
      // RÉALISÉ (perte moyenne / (gain + perte moyens)) — le 1/(1+RR) n'a de
      // sens qu'à risque constant, ce que le stop structurel interdit.
      let tp = 0, sl = 0, be = 0, open = 0;
      let grossWin = 0, grossLoss = 0, nWin = 0, nLoss = 0, sumPts = 0, nRes = 0;
      const durations = [];   // durée de vie en bougies, positions résolues
      const touches   = [];   // retours sur le niveau d'entrée, positions résolues
      for (const p of positions) {
        if      (p.status === 'tp') tp++;
        else if (p.status === 'sl') sl++;
        else if (p.status === 'be') be++;
        else                      { open++; continue; }
        const g = p.profitPoints;
        sumPts += g; nRes++;
        durations.push(p.barsHeld);
        touches.push(p.entryTouches);
        if (g > 0)      { grossWin  += g; nWin++; }
        else if (g < 0) { grossLoss += -g; nLoss++; }
      }
      durations.sort((a, b) => a - b);
      const dMid = durations.length >> 1;
      const avgWin  = nWin  ? grossWin  / nWin  : null;
      const avgLoss = nLoss ? grossLoss / nLoss : null;
      const expPts  = nRes  ? sumPts / nRes : null;
      const beThresh = avgWin != null && avgLoss != null && avgWin + avgLoss > 0
        ? avgLoss / (avgWin + avgLoss) : null;
      const stats = { total: positions.length, tp, sl, be, open, expPts, beThresh,
                      netPts: grossWin - grossLoss,
                      profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : null),
                      // Durée de vie, en bougies. `onEntryBar` compte celles qui
                      // se résolvent dans B4 même — la fenêtre sans stop.
                      barsHeldMedian: durations.length === 0 ? null
                        : durations.length % 2 ? durations[dMid] : (durations[dMid - 1] + durations[dMid]) / 2,
                      barsHeldMean: durations.length ? durations.reduce((s, v) => s + v, 0) / durations.length : null,
                      barsHeldMax:  durations.length ? durations[durations.length - 1] : null,
                      onEntryBar:   durations.filter(v => v === 0).length,
                      // Retours sur le niveau d'entrée. `neverReturned` = les
                      // positions parties droit à leur sort, sans repasser par là.
                      entryTouchesMean: touches.length ? touches.reduce((s, v) => s + v, 0) / touches.length : null,
                      entryTouchesMax:  touches.length ? Math.max(...touches) : null,
                      neverReturned:    touches.filter(v => v === 0).length,
                      // Signaux sautés par le cooldown (hors rapport, juste comptés)
                      // et combien auraient gagné.
                      skippedByCooldown: positions.skippedByCooldown ?? 0,
                      skippedWon:        positions.skippedWon ?? 0,
                      // Le dû : positions parties rembourser, et ce qui reste
                      // sur l'ardoise au bord des données.
                      dueArmed:          positions.dueArmed ?? 0,
                      dueRemainingPts:   positions.dueRemainingPts ?? 0,
                      dueRemainingSl:    positions.dueRemainingSl ?? 0 };
      setRfvgStats({ ...stats, beOn: beTriggerPts > 0 || beTouchTrigger > 0 || beBarsTrigger > 0 });
      rfvgReportRef.current = { params: posOpts, stats, positions };
    }
  }, [candles, patterns]);

  // Rapport JSON des positions rFVG : recap + excursions (max pullup / max
  // drawdown) par position, pour étudier où placer trailing et break-even.
  const downloadRfvgReport = useCallback(() => {
    const rep = rfvgReportRef.current;
    if (!rep) return;
    const { params, stats, positions } = rep;
    const iso = t => t != null ? new Date(t * 1000).toISOString() : null;
    // Le stop est structurel : chaque position a SON risque. Le R se normalise
    // donc position par position, il n'existe plus de SL global.
    const rOf = (pts, risk0) => pts != null && risk0 > 0 ? +(pts / risk0).toFixed(4) : null;

    const resolved = stats.tp + stats.sl;
    const doc = {
      pattern:     'rFVG — positions simulées (entrée au marché à l\'ouverture de B4, stop structurel sous/sur l\'extrême B3-B4)',
      generatedAt: new Date().toISOString(),
      params,
      // Champs listés un par un : un spread laisserait passer les valeurs
      // brutes à côté de leurs versions arrondies. Tout est en POINTS.
      stats: {
        total:        stats.total,
        tp:           stats.tp,
        sl:           stats.sl,
        be:           stats.be,
        open:         stats.open,
        winrate:      resolved > 0 ? +(stats.tp / resolved).toFixed(4) : null,
        // Seuil de rentabilité réalisé, pas un 1/(1+RR) : le risque varie.
        breakevenWinrate: stats.beThresh != null ? +stats.beThresh.toFixed(4) : null,
        expectancyPts:    stats.expPts != null ? +stats.expPts.toFixed(4) : null,
        netPts:           +stats.netPts.toFixed(4),
        // JSON n'a pas d'infini : null quand il n'y a aucune perte.
        profitFactor: stats.profitFactor != null && Number.isFinite(stats.profitFactor)
          ? +stats.profitFactor.toFixed(4) : null,
        barsHeldMedian: stats.barsHeldMedian,
        barsHeldMean:   stats.barsHeldMean != null ? +stats.barsHeldMean.toFixed(2) : null,
        barsHeldMax:    stats.barsHeldMax,
        onEntryBar:     stats.onEntryBar,
        entryTouchesMean: stats.entryTouchesMean != null ? +stats.entryTouchesMean.toFixed(2) : null,
        entryTouchesMax:  stats.entryTouchesMax,
        neverReturned:    stats.neverReturned,
        // Cooldown : signaux sautés (hors rapport) et combien auraient gagné.
        skippedByCooldown: stats.skippedByCooldown ?? 0,
        skippedWon:        stats.skippedWon ?? 0,
        // Le dû : combien de positions ont visé un remboursement plutôt que leur
        // vrai TP, et ce qui reste sur l'ardoise au bord des données.
        dueArmed:         stats.dueArmed ?? 0,
        dueRemainingPts:  stats.dueRemainingPts != null ? +stats.dueRemainingPts.toFixed(4) : 0,
        dueRemainingSl:   stats.dueRemainingSl ?? 0,
      },
      conventions: {
        unites:        "P&L en POINTS : le lot est fixe, c'est lui qui est proportionnel au gain réel — compter en R supposerait qu'on redimensionne la position à chaque trade pour risquer le même montant. Les champs en R restent fournis à titre indicatif (points / risk0), le risque variant d'une position à l'autre",
        spread:        "spreadPts > 0 : coût de l'aller-retour, en points, déduit de CHAQUE POSITION CLÔTURÉE — profitPoints reste le BRUT (celui qui se relit sur le graphe), netPoints = brut − spreadPts est ce qu'on encaisse, et c'est le net qui alimente toutes les statistiques. Une position encore ouverte au bord des données ne l'a pas payé (spreadPts = 0). Un BE coupé au prix d'entrée rend donc un brut nul et un net négatif : le spread reste dû",
        breakevenWinrate: "seuil de rentabilité RÉALISÉ = perte moyenne / (gain moyen + perte moyenne). Le 1/(1+RR) n'a de sens qu'à risque constant, ce que le stop structurel interdit",
        entree:        "au marché à l'ouverture de B4, la bougie qui suit le motif — jamais d'ordre en attente, donc jamais de position ratée",
        cooldown:      "skipAfterTp > 0 : après un TP réel, les N prochains signaux sont sautés (repos). Chaque signal sauté est simulé à blanc — s'il aurait aussi gagné, le compteur repart à N. Les trades sautés NE SONT PAS dans `positions` (juste comptés) : skippedByCooldown = combien sautés, skippedWon = combien auraient gagné. Anti-lookahead : un signal n'est sauté que s'il entre après la sortie du gain qui a armé le repos",
        tradeUnique:   "uniqueTrade = true : une seule position à la fois. Tout motif survenant avant la clôture de la position en cours est ignoré (dans son sens comme à contre-sens) et n'apparaît nulle part — les positions listées ici sont donc déjà filtrées",
        stop:          "posé à la CLÔTURE de B4 : BUY → min(bas B3, bas B4) − marge ; SELL → max(haut B3, haut B4) + marge. Pendant B4 la position est non protégée, seul le TP est actif — le stop étant construit sous l'extrême de B4, il ne peut pas y être touché",
        stopPlafonne:  "slCapPts > 0 : PLAFOND DE PERTE en points, un vrai SL et non un break-even. Le stop retenu est le plus serré du structurel et de entrée ∓ slCapPts, donc risk0 ne dépasse jamais le plafond ; sortie 'sl', et slCapped dit si c'est le plafond qui a décidé du stop initial. Étant une distance connue dès l'entrée, il est le SEUL stop actif pendant B4 : sur cette bougie un TP n'est donc plus certain d'avoir précédé le stop (convention pessimiste, compté dans `ambiguite`). Un plafond plus large que le structurel ne change rien — il ne peut pas élargir le risque. ÉVOLUTION : absente de l'EA MT5",
        barsHeld:      "durée de vie de la position, en PÉRIODES du graphe (bougies) écoulées entre l'entrée et la sortie. 0 = ouverte et refermée dans B4, sa propre bougie d'entrée — donc entièrement dans la fenêtre où le stop n'existe pas encore. `onEntryBar` en donne le compte",
        entryTouches:  "combien de fois le prix est REVENU sur le niveau d'entrée pendant la vie de la position : une bougie dont l'amplitude contient ce niveau (bas <= entrée <= haut) compte pour une. La bougie d'entrée B4 est EXCLUE (elle s'ouvre au niveau, elle compterait toujours), la bougie de sortie est incluse. 0 = jamais repassée par son prix d'entrée",
        maxPullupPts:  "MFE — plus forte avancée dans le sens de la position, de l'entrée à la sortie ; bougie de sortie EXCLUE pour une sortie sur stop ('sl' ou 'be') ; plafonnée au TP",
        maxDrawdownPts:'MAE — plus forte avancée contre la position, bougie de sortie incluse (pessimiste), plafonnée à risk0',
        maeArmedPts:   "la même MAE, restreinte à la fenêtre où un stop STRUCTUREL existe (B5 → sortie) ; c'est elle qui doit servir à étudier un stop resserré, la chaleur prise pendant B4 ne pouvant déclencher aucun stop ; null si la position s'est résolue sur B4. Sous SL plafonné, la restriction perd son objet : le plafond, lui, couvre B4",
        ambiguite:     'stop et TP touchés dans la même bougie : le stop gagne (pessimiste)',
        du:            "dueAfterSl > 0 : REMBOURSER AVANT DE GAGNER. Toute position clôturée dans le rouge laisse sa perte NETTE sur une ardoise ; tout gain la rembourse en commençant par la plus ANCIENNE, et ce qu'il ne couvre pas entièrement reste dû à hauteur du reliquat. Dès que l'ardoise compte dueAfterSl pertes, la position suivante vise le remboursement (champ duePts) au lieu de son vrai TP — même si c'est plus PRÈS que son objectif normal. dueMode = 'full' : l'ardoise ENTIÈRE, qui s'éloigne à mesure qu'elle grossit et peut finir hors d'atteinte ; dueMode = 'step' : un BOND de dueAfterSl × la perte moyenne encore due, soit la taille de ce qui a armé le dû — le remboursement se fait alors en plusieurs fois, chacune atteignable. duePts est ce qui a été VISÉ, dueTotalPts l'ardoise entière au même instant : leur écart est ce qui restera à devoir. Le dû est lu à l'ENTRÉE et n'y bouge plus. « Perte » se juge au NET et non au statut : une sortie BE qui finit sous zéro (le spread) compte comme un SL. AVEC UN SPREAD, rembourser ne solde jamais tout à fait — le gain qui atteint le dû paie lui aussi son aller-retour. ANTI-ANTICIPATION : une sortie ne pèse sur le dû d'une entrée que si elle a eu lieu AVANT la bougie de cette entrée. LE BREAK-EVEN N'EST PAS TOUCHÉ : ses quatre déclencheurs s'arment aux mêmes distances que sur une position ordinaire — le dû déplace la cible, pas la protection. dueArmed compte les positions parties rembourser, dueRemainingPts / dueRemainingSl disent ce qui restait sur l'ardoise au bord des données. Le champ `rr` décrit toujours le TP RÉGLÉ et non l'objectif de remboursement : sur une position à dû, l'objectif visé est duePts, et `tp` en porte le prix. ÉVOLUTION : absente de l'EA MT5",
        breakEven:     "quatre déclencheurs indépendants aux effets différents. PROFIT (beTriggerPts > 0) et DURÉE (beBarsTrigger > 0) DÉPLACENT LE STOP au niveau BE = entrée ± beLevelPts (borné par le stop structurel) — profit dès que le gain atteint le seuil (évalué dès B4), durée dès que la position tient depuis ce nombre de bougies ; sortie sur ce stop → 'be'. SWING (beSwingBars > 0) DÉPLACE LE STOP SOUS LA STRUCTURE : au premier swing formé pendant la position (swing BAS en BUY, HAUT en SELL, extrême strictement au-delà des beSwingBars bougies de chaque côté, confirmé seulement à la clôture de la beSwingBars-ième bougie qui suit le pivot), le stop passe à swing ± slMarginPts — la marge du stop structurel, pas beLevelPts — sans jamais élargir le risque ; sortie sur ce stop → 'be'. Les trois ne déplacent le stop QU'UNE FOIS : le premier armé gagne. RETOURS (beTouchTrigger > 0) NE DÉPLACE RIEN, IL COUPE : dès que le prix est revenu ce nombre de fois sur l'entrée, la position est soldée AU PRIX D'ENTRÉE sur cette bougie → 'be', profitPoints brut = 0, cutAtEntry = true (le spread reste dû). Le TP ne bouge jamais. beReason = premier déclencheur armé ('profit'|'touch'|'bars'|'swing'). Un TP atteint sur la bougie de déclenchement l'emporte ; un stop en gap rempli au pire de l'open",
      },
      positions: positions.map(p => ({
        id:             p.id,
        label:          p.label,
        direction:      p.direction,
        status:         p.status,
        beActivated:    p.beActivated ?? false,
        beReason:       p.beReason ?? null,
        beDate:         iso(p.beTime),
        cutAtEntry:     p.cutAtEntry ?? false,
        entryTime:      p.entryTime,
        entryDate:      iso(p.entryTime),
        exitDate:       iso(p.exitTime),
        barsHeld:       p.barsHeld,
        entryTouches:   p.entryTouches,
        entryPrice:     p.entryPrice,
        exitPrice:      p.exitPrice,
        sl:             p.sl,
        sl0:            p.sl0,
        tp:             p.tp,
        // Risque propre à la position : la distance au stop structurel.
        risk0:          +p.risk0.toFixed(6),
        // Le RR du TP RÉGLÉ. Sur une position partie rembourser, ce n'est pas
        // l'objectif visé : c'est duePts qui l'est, et le champ tp porte le prix.
        rr:             p.risk0 > 0 ? +(params.tpPts / p.risk0).toFixed(4) : null,
        // Le dû visé par cette position (0 = elle jouait son vrai TP), l'ardoise
        // entière au même instant, et le nombre de pertes qu'elle comptait.
        duePts:         p.duePts != null ? +p.duePts.toFixed(6) : null,
        dueTotalPts:    p.dueTotalPts != null ? +p.dueTotalPts.toFixed(6) : null,
        dueCount:       p.dueCount ?? null,
        profitPoints:   +p.profitPoints.toFixed(6),
        profitR:        rOf(p.profitPoints, p.risk0),
        // Coût du trade et résultat réel. Le brut reste au-dessus : c'est lui qui
        // se relit sur le graphe, le net est ce qu'on encaisse.
        spreadPts:      p.spreadPts ?? 0,
        netPoints:      p.netPoints != null ? +p.netPoints.toFixed(6) : null,
        netR:           rOf(p.netPoints, p.risk0),
        maxPullupPts:   p.maxPullupPts   != null ? +p.maxPullupPts.toFixed(6)   : null,
        maxPullupR:     rOf(p.maxPullupPts, p.risk0),
        maxDrawdownPts: p.maxDrawdownPts != null ? +p.maxDrawdownPts.toFixed(6) : null,
        maxDrawdownR:   rOf(p.maxDrawdownPts, p.risk0),
        maeArmedPts:    p.maeArmedPts != null ? +p.maeArmedPts.toFixed(6) : null,
        maeArmedR:      rOf(p.maeArmedPts, p.risk0),
      })),
    };

    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `rfvg-rapport-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // ── KO : zones du motif et/ou positions simulées ───────────────────────────
  // Deux habits cumulables, comme le rFVG. La différence est sous le capot : les
  // positions viennent de calcKOPositions, qui n'est qu'un appel au MOTEUR
  // COMMUN (lib/signals/engine.js) — celui-là même qu'appellent la page /ko et
  // l'optimiseur. Il n'y a donc pas de seconde implémentation à tenir alignée,
  // et les statistiques affichées ici sortent de la même computeStats que le
  // rapport de la page.
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    const ko = patterns.find(p => p.type === 'KO' && p.enabled);

    const dropZones = () => {
      if (koPrimitiveRef.current) {
        try { series.detachPrimitive(koPrimitiveRef.current); } catch {}
        koPrimitiveRef.current = null;
      }
    };
    const dropPositions = () => {
      if (koPosPrimitiveRef.current) {
        try { series.detachPrimitive(koPosPrimitiveRef.current); } catch {}
        koPosPrimitiveRef.current = null;
      }
    };

    if (!ko || !candles?.length) { dropZones(); dropPositions(); setKoStats(null); koReportRef.current = null; return; }

    const display = ko.display ?? 'zone';
    const detectOpts = {
      direction:    ko.direction    ?? 'both',
      maPeriodFast: ko.maPeriodFast ?? 15,
      maPeriodSlow: ko.maPeriodSlow ?? 200,
      atrPeriod:    ko.atrPeriod    ?? 14,
      atrMult1:     ko.atrMult1     ?? 1.3,
      bodyRatio1:   ko.bodyRatio1   ?? 0.9,
      atrMult2:     ko.atrMult2     ?? 0.3,
      bodyRatio2:   ko.bodyRatio2   ?? 0.3,
      extLen:       ko.extLen       ?? 20,
    };

    if (display === 'position') {
      dropZones();
    } else {
      if (!koPrimitiveRef.current) {
        koPrimitiveRef.current = createFvgPrimitive();
        series.attachPrimitive(koPrimitiveRef.current);
      }
      koPrimitiveRef.current.update(calcKO(candles, detectOpts), {
        bullColor: ko.bullColor ?? '#26A69A',
        bearColor: ko.bearColor ?? '#EF5350',
        opacity:   ko.opacity   ?? 0.18,
        showLabel: ko.showLabel !== false,
        labelText: 'KO',
      });
    }

    if (display === 'zone') {
      dropPositions();
      setKoStats(null);
      koReportRef.current = null;
    } else {
      if (!koPosPrimitiveRef.current) {
        koPosPrimitiveRef.current = createTradesPrimitive();
        series.attachPrimitive(koPosPrimitiveRef.current);
      }
      const posOpts = {
        ...detectOpts,
        slMarginPts:    ko.slMarginPts    ?? 2,
        slCapPts:       ko.slCapPts       ?? 0,
        spreadPts:      ko.spreadPts      ?? 0,
        tpPts:          ko.tpPts          ?? 10,
        beTriggerPts:   ko.beTriggerPts   ?? 0,
        beTouchTrigger: ko.beTouchTrigger ?? 0,
        beBarsTrigger:  ko.beBarsTrigger  ?? 0,
        beSwingBars:    ko.beSwingBars    ?? 0,
        beLevelPts:     ko.beLevelPts     ?? 0,
        maxBars:        ko.maxBars        ?? 0,
        uniqueTrade:    ko.uniqueTrade === true,
        skipAfterTp:    ko.skipAfterTp ?? 0,
      };
      const positions = calcKOPositions(candles, posOpts);
      koPosPrimitiveRef.current.update(positions, null);

      // Le moniteur suit le même calcul que le dessin : il se met à jour tout
      // seul à chaque chargement de bougies (préchargement d'historique inclus).
      // Le P&L se compte en POINTS — le lot est fixe, c'est lui qui est
      // proportionnel au gain réel — et le seuil de rentabilité affiché est
      // celui RÉALISÉ, le 1/(1+RR) n'ayant de sens qu'à risque constant.
      const stats = computeStats(positions, { tpPts: posOpts.tpPts });
      setKoStats({
        total: positions.length, tp: stats.tp, sl: stats.sl, be: stats.be,
        timeout: stats.timeout, open: stats.open,
        winrate: stats.winrate, beThresh: stats.beThresh,
        expPts: stats.expPts, profitFactor: stats.profitFactor,
        beOn: posOpts.beTriggerPts > 0 || posOpts.beTouchTrigger > 0
           || posOpts.beBarsTrigger > 0 || posOpts.beSwingBars > 0,
        skippedByCooldown: positions.skippedByCooldown ?? 0,
        skippedWon:        positions.skippedWon ?? 0,
      });
      koReportRef.current = { params: posOpts, stats, positions };
    }
  }, [candles, patterns]);

  // Rapport JSON des positions KO — même structure que celui du rFVG (recap +
  // excursions par position, pour étudier où poser trailing et break-even), avec
  // les conventions propres au motif.
  const downloadKoReport = useCallback(() => {
    const rep = koReportRef.current;
    if (!rep) return;
    const { params, stats, positions } = rep;
    const iso = t => t != null ? new Date(t * 1000).toISOString() : null;
    // Le stop est structurel : chaque position a SON risque. Le R se normalise
    // donc position par position, il n'existe pas de SL global.
    const rOf = (pts, risk0) => pts != null && risk0 > 0 ? +(pts / risk0).toFixed(4) : null;
    const num = (v, d = 4) => v == null ? null : +v.toFixed(d);

    const doc = {
      pattern: "KO — positions simulées (entrée au marché à l'ouverture de la 3e bougie, stop structurel sous/sur l'extrême B2-B3)",
      generatedAt: new Date().toISOString(),
      params,
      stats: {
        total:   stats.total,
        tp:      stats.tp,
        sl:      stats.sl,
        be:      stats.be,
        timeout: stats.timeout,
        open:    stats.open,
        winrate: num(stats.winrate),
        // Seuil de rentabilité réalisé, pas un 1/(1+RR) : le risque varie.
        breakevenWinrate: num(stats.beThresh),
        expectancyPts:    num(stats.expPts),
        tStat:            num(stats.tStat),
        netPts:           num(stats.netPts),
        // JSON n'a pas d'infini : null quand il n'y a aucune perte.
        profitFactor: Number.isFinite(stats.profitFactor) ? num(stats.profitFactor) : null,
        maxDrawdownPts: num(stats.maxDD, 2),
        maxLossStreak:  stats.maxLossStreak,
        riskMedian:     num(stats.riskMed, 2),
        rrMedian:       num(stats.rrMed),
        barsHeldMedian: stats.barsHeldMedian,
        barsHeldMean:   num(stats.barsHeldMean, 2),
        barsHeldMax:    stats.barsHeldMax,
        onEntryBar:     stats.onEntryBar,
        entryTouchesMean: num(stats.entryTouchesMean, 2),
        entryTouchesMax:  stats.entryTouchesMax,
        neverReturned:    stats.neverReturned,
        skippedByCooldown: positions.skippedByCooldown ?? 0,
        skippedWon:        positions.skippedWon ?? 0,
      },
      conventions: {
        motif:         "2 bougies. B1 : impulsion PLEINE (corps ≥ atrMult1 × ATR ET corps/amplitude ≥ bodyRatio1) entièrement du côté opposé à son sens par rapport aux DEUX MM, mèches comprises. B2 : respiration, sens indifférent (corps ≤ atrMult2 × ATR ET corps/amplitude ≤ bodyRatio2). Un seul ATR de référence, lu AVANT B1",
        unites:        "P&L en POINTS : le lot est fixe, c'est lui qui est proportionnel au gain réel — compter en R supposerait qu'on redimensionne la position à chaque trade pour risquer le même montant. Les champs en R restent fournis à titre indicatif (points / risk0)",
        breakevenWinrate: "seuil de rentabilité RÉALISÉ = perte moyenne / (gain moyen + perte moyenne). Le 1/(1+RR) n'a de sens qu'à risque constant, ce que le stop structurel interdit",
        entree:        "au marché à l'ouverture de la 3e bougie, celle qui suit le motif — jamais d'ordre en attente, donc jamais de position ratée",
        stop:          "posé à la CLÔTURE de la bougie d'entrée : BUY → min(bas B2, bas B3) − marge ; SELL → max(haut B2, haut B3) + marge. B1, la grosse, n'entre PAS dans le stop. Pendant toute la bougie d'entrée la position est non protégée, seul le TP est actif — le stop étant construit sous son extrême, il ne peut pas y être touché",
        moteur:        "lib/signals/engine.js, le MÊME que la page /ko, l'optimiseur et les API — le graphe ne simule pas de son côté. Résolution intra-bougie : stop prioritaire quand stop et TP tombent dans la même bougie (pessimiste, convention). Le serveur sait en plus rejouer la bougie minute par minute (fills: 'm1')",
        barsHeld:      "durée de vie en bougies entre l'entrée et la sortie. 0 = ouverte et refermée dans sa propre bougie d'entrée, donc entièrement dans la fenêtre où le stop n'existe pas encore (`onEntryBar` en donne le compte)",
        entryTouches:  "combien de fois le prix est REVENU sur le niveau d'entrée pendant la vie de la position (bougie d'entrée exclue, bougie de sortie incluse). 0 = jamais repassée par son prix d'entrée",
        maxPullupPts:  "MFE — plus forte avancée dans le sens de la position ; bougie de sortie EXCLUE pour une sortie sur stop ('sl' ou 'be') ; plafonnée au TP",
        maxDrawdownPts:'MAE — plus forte avancée contre la position, bougie de sortie incluse (pessimiste), plafonnée à risk0',
        maeArmedPts:   "la même MAE, restreinte à la fenêtre où un stop existe (bougie d'entrée exclue) ; c'est elle qui doit servir à étudier un stop resserré ; null si la position s'est résolue dans sa bougie d'entrée",
        statuts:       "'tp' gain, 'sl' stop structurel, 'be' stop déplacé OU coupe sur retours à l'entrée (cutAtEntry), 'timeout' plafond de durée (maxBars), 'open' encore en vie au bord des données",
        spread:        "spreadPts > 0 : coût de l'aller-retour, en points, déduit de CHAQUE POSITION CLÔTURÉE — profitPoints reste le BRUT (celui qui se relit sur le graphe), netPoints = brut − spreadPts est ce qu'on encaisse, et c'est le net qui alimente toutes les statistiques. Une position encore ouverte au bord des données ne l'a pas payé (spreadPts = 0). Un BE coupé au prix d'entrée rend donc un brut nul et un net négatif : le spread reste dû",
      },
      positions: positions.map(p => ({
        id:             p.id,
        label:          p.label,
        direction:      p.direction,
        status:         p.status,
        beActivated:    p.beActivated ?? false,
        beReason:       p.beReason ?? null,
        beDate:         iso(p.beTime),
        cutAtEntry:     p.cutAtEntry ?? false,
        entryTime:      p.entryTime,
        entryDate:      iso(p.entryTime),
        exitDate:       iso(p.exitTime),
        barsHeld:       p.barsHeld,
        entryTouches:   p.entryTouches,
        entryPrice:     p.entryPrice,
        exitPrice:      p.exitPrice,
        sl:             p.sl,
        sl0:            p.sl0,
        tp:             p.tp,
        // Risque propre à la position : la distance au stop structurel.
        risk0:          num(p.risk0, 6),
        rr:             p.risk0 > 0 ? +(params.tpPts / p.risk0).toFixed(4) : null,
        profitPoints:   num(p.profitPoints, 6),
        profitR:        rOf(p.profitPoints, p.risk0),
        // Coût du trade et résultat réel (cf. convention `spread`).
        spreadPts:      p.spreadPts ?? 0,
        netPoints:      num(p.netPoints, 6),
        netR:           rOf(p.netPoints, p.risk0),
        maxPullupPts:   num(p.maxPullupPts, 6),
        maxPullupR:     rOf(p.maxPullupPts, p.risk0),
        maxDrawdownPts: num(p.maxDrawdownPts, 6),
        maxDrawdownR:   rOf(p.maxDrawdownPts, p.risk0),
        maeArmedPts:    num(p.maeArmedPts, 6),
        maeArmedR:      rOf(p.maeArmedPts, p.risk0),
      })),
    };

    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `ko-rapport-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // ── HBH / BHB zones (rectangles via series primitive) ──────────────────────
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    const hbh = patterns.find(p => p.type === 'HBH_BHB' && p.enabled);

    if (!hbh || !candles?.length) {
      if (hbhPrimitiveRef.current) {
        try { series.detachPrimitive(hbhPrimitiveRef.current); } catch {}
        hbhPrimitiveRef.current = null;
      }
      return;
    }

    if (!hbhPrimitiveRef.current) {
      hbhPrimitiveRef.current = createHbhPrimitive();
      series.attachPrimitive(hbhPrimitiveRef.current);
    }

    const zones = calcHBHBHB(candles, {
      direction: hbh.direction ?? 'both',
      engMult:   hbh.engMult   ?? 1.5,
      extLen:    hbh.extLen    ?? 20,
    });

    hbhPrimitiveRef.current.update(zones, {
      bullColor: hbh.bullColor ?? '#26A69A',
      bearColor: hbh.bearColor ?? '#EF5350',
      opacity:   hbh.opacity   ?? 0.18,
      showMid:   hbh.showMid   !== false,
      showLabel: hbh.showLabel !== false,
    });
  }, [candles, patterns]);

  // ── HM-BM : niveaux entrée/SL (mode « levels ») et/ou positions simulées
  //    (mode « position »), cumulables comme le rFVG. ─────────────────────────
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    const hmbm = patterns.find(p => p.type === 'HMBM' && p.enabled);

    const dropLevels = () => {
      if (hmbmPrimitiveRef.current) {
        try { series.detachPrimitive(hmbmPrimitiveRef.current); } catch {}
        hmbmPrimitiveRef.current = null;
      }
    };
    const dropPositions = () => {
      if (hmbmPosPrimitiveRef.current) {
        try { series.detachPrimitive(hmbmPosPrimitiveRef.current); } catch {}
        hmbmPosPrimitiveRef.current = null;
      }
    };

    if (!hmbm || !candles?.length) { dropLevels(); dropPositions(); setHmbmStats(null); hmbmReportRef.current = null; return; }

    const display = hmbm.display ?? 'levels';
    const detectOpts = {
      direction: hmbm.direction ?? 'both',
      maPeriod:  hmbm.maPeriod  ?? 75,
      atrPeriod: hmbm.atrPeriod ?? 14,
      mult1:     hmbm.mult1     ?? 1,
      mult2:     hmbm.mult2     ?? 0.5,
      extLen:    hmbm.extLen    ?? 5,
    };

    // Niveaux entrée / SL (primitive dédiée).
    if (display === 'position') {
      dropLevels();
    } else {
      if (!hmbmPrimitiveRef.current) {
        hmbmPrimitiveRef.current = createHmbmPrimitive();
        series.attachPrimitive(hmbmPrimitiveRef.current);
      }
      hmbmPrimitiveRef.current.update(calcHMBM(candles, detectOpts), {
        bullColor: hmbm.bullColor ?? '#26A69A',
        bearColor: hmbm.bearColor ?? '#EF5350',
        slColor:   hmbm.slColor   ?? '#B22222',
      });
    }

    // Positions simulées (même primitive que les trades du backtest).
    if (display === 'levels') {
      dropPositions();
      setHmbmStats(null);
      hmbmReportRef.current = null;
    } else {
      if (!hmbmPosPrimitiveRef.current) {
        hmbmPosPrimitiveRef.current = createTradesPrimitive();
        series.attachPrimitive(hmbmPosPrimitiveRef.current);
      }
      const tpPts   = hmbm.tpPts ?? 10;
      const posOpts = { ...detectOpts, tpPts, spreadPts: hmbm.spreadPts ?? 0 };
      const positions = calcHMBMPositions(candles, posOpts);
      hmbmPosPrimitiveRef.current.update(positions, null);

      let tp = 0, sl = 0, open = 0, sumR = 0, nR = 0;
      for (const p of positions) {
        if      (p.status === 'tp') tp++;
        else if (p.status === 'sl') sl++;
        else                        open++;
        // Espérance sur le NET : le spread est déjà déduit de la position.
        if (p.risk0 > 0) { sumR += (p.netPoints ?? p.profitPoints) / p.risk0; nR++; }
      }
      const winrate = (tp + sl) > 0 ? tp / (tp + sl) : null;
      const expR    = nR > 0 ? sumR / nR : null;
      setHmbmStats({ total: positions.length, tp, sl, open, winrate, expR, tpPts });
      hmbmReportRef.current = {
        params: posOpts,
        stats:  { total: positions.length, tp, sl, open, winrate, expR },
        positions,
      };
    }
  }, [candles, patterns]);

  // Rapport JSON des positions HM-BM : recap + excursions par position.
  const downloadHmbmReport = useCallback(() => {
    const rep = hmbmReportRef.current;
    if (!rep) return;
    const { params, stats, positions } = rep;
    const iso = t => t != null ? new Date(t * 1000).toISOString() : null;
    const r   = (pts, risk) => pts != null && risk > 0 ? +(pts / risk).toFixed(4) : null;

    const doc = {
      pattern:     'HM-BM — positions simulées (entrée marché à l’ouverture de X, SL = extrême M–X, pas de BE)',
      generatedAt: new Date().toISOString(),
      params,
      stats: {
        ...stats,
        winrate:      stats.winrate != null ? +stats.winrate.toFixed(4) : null,
        expectanceR:  stats.expR    != null ? +stats.expR.toFixed(4)    : null,
      },
      conventions: {
        entree:        'entrée au marché à l’ouverture de la bougie X (toujours prise, jamais « missed »)',
        sl:            'SL = extrême entre M et X ; risk0 = |entrée − SL|, variable selon le motif',
        tp:            'TP = entrée ± tpPts',
        suivi:         'la position est suivie à partir de X+1 (le SL n’est posé qu’à la clôture de X)',
        pessimisme:    'stop testé avant le TP ; stop et TP dans la même bougie → le stop gagne ; stop traversé en gap rempli au pire du niveau et de l’open',
        unites:        'excursions en points et en R (points / risk0)',
        spread:        "spreadPts > 0 : coût de l'aller-retour, en points, déduit de CHAQUE POSITION CLÔTURÉE — profitPoints reste le BRUT, netPoints = brut − spreadPts est ce qu'on encaisse. Une position encore ouverte au bord des données ne l'a pas payé (spreadPts = 0)",
        maxPullupPts:  'MFE — plus forte avancée favorable ; bougie de sortie exclue pour une sortie sur stop ; plafonné au TP',
        maxDrawdownPts:'MAE — plus forte avancée contre la position, bougie de sortie incluse ; plafonné à risk0',
      },
      positions: positions.map(p => ({
        id:             p.id,
        label:          p.label,
        direction:      p.direction,
        status:         p.status,
        entryDate:      iso(p.entryTime),
        exitDate:       iso(p.exitTime),
        barsHeld:       p.barsHeld,
        entryPrice:     p.entryPrice,
        exitPrice:      p.exitPrice,
        sl:             p.sl,
        tp:             p.tp,
        risk0:          +p.risk0.toFixed(6),
        profitPoints:   +p.profitPoints.toFixed(6),
        profitR:        r(p.profitPoints, p.risk0),
        // Coût du trade et résultat réel (cf. convention `spread`).
        spreadPts:      p.spreadPts ?? 0,
        netPoints:      p.netPoints != null ? +p.netPoints.toFixed(6) : null,
        netR:           r(p.netPoints, p.risk0),
        maxPullupPts:   +p.maxPullupPts.toFixed(6),
        maxPullupR:     r(p.maxPullupPts, p.risk0),
        maxDrawdownPts: +p.maxDrawdownPts.toFixed(6),
        maxDrawdownR:   r(p.maxDrawdownPts, p.risk0),
      })),
    };

    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `hmbm-rapport-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // ── HBHB / BHBH zones — only rendered in 'grouped' chart mode ──────────────
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    const hbhb = patterns.find(p => p.type === 'HBHB_BHBH' && p.enabled);

    if (!hbhb || !candles?.length || chartMode !== 'grouped') {
      if (hbhbPrimitiveRef.current) {
        try { series.detachPrimitive(hbhbPrimitiveRef.current); } catch {}
        hbhbPrimitiveRef.current = null;
      }
      return;
    }

    if (!hbhbPrimitiveRef.current) {
      hbhbPrimitiveRef.current = createHbhbPrimitive();
      series.attachPrimitive(hbhbPrimitiveRef.current);
    }

    const zones = calcHBHB(candles, {
      direction: hbhb.direction ?? 'both',
      bodyMult:  hbhb.bodyMult  ?? 1.5,
      extLen:    hbhb.extLen    ?? 20,
    });

    hbhbPrimitiveRef.current.update(zones, {
      bullColor: hbhb.bullColor ?? '#26A69A',
      bearColor: hbhb.bearColor ?? '#EF5350',
      opacity:   hbhb.opacity   ?? 0.18,
      showLabel: hbhb.showLabel !== false,
    });
  }, [candles, patterns, chartMode]);

  // ── Compression / Squeeze zones (rectangles + breakout arrow via primitive) ─
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    const sqz = patterns.find(p => p.type === 'COMPRESSION' && p.enabled);

    if (!sqz || !candles?.length) {
      if (compressionPrimitiveRef.current) {
        try { series.detachPrimitive(compressionPrimitiveRef.current); } catch {}
        compressionPrimitiveRef.current = null;
      }
      return;
    }

    if (!compressionPrimitiveRef.current) {
      compressionPrimitiveRef.current = createCompressionPrimitive();
      series.attachPrimitive(compressionPrimitiveRef.current);
    }

    const zones = calcCompression(candles, {
      mode:          sqz.mode          ?? 'atr',
      // ATR-flat method
      atrPeriod:     sqz.atrPeriod     ?? 14,
      flatTol:       sqz.flatTol       ?? 0.12,
      breakMult:     sqz.breakMult     ?? 1.8,
      // TTM Squeeze method
      length:        sqz.length        ?? 20,
      bbMult:        sqz.bbMult        ?? 2,
      kcMult:        sqz.kcMult         ?? 1.5,
      // shared
      minLength:     sqz.minLength     ?? 6,
      extendToBreak: sqz.extendToBreak !== false,
    });

    compressionPrimitiveRef.current.update(zones, {
      upColor:      sqz.upColor      ?? '#26A69A',
      downColor:    sqz.downColor    ?? '#EF5350',
      neutralColor: sqz.neutralColor ?? '#64748B',
      opacity:      sqz.opacity      ?? 0.18,
      showLabel:    sqz.showLabel    !== false,
      showArrow:    sqz.showArrow    !== false,
    });
  }, [candles, patterns]);

  // ── Shared style for the drag-handle dots ─────────────────────────────────
  const dotStyle = { width: 3, height: 3, borderRadius: '50%', background: '#4A5568' };

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      <div
        ref={mainWrapRef}
        style={{ position: 'relative', flex: 1, minHeight: 0, background: theme.bg.css }}
      >
        {/* LWC chart canvas (transparent background — mainWrapRef background shows through) */}
        <div ref={mainRef} style={{ position: 'absolute', inset: 0 }} />

        {/* Bouton capture d'écran → presse-papier */}
        <button
          onClick={takeScreenshot}
          title="Capturer le graphe (copié dans le presse-papier)"
          aria-label="Capturer le graphe"
          style={{
            position: 'absolute', top: 10, right: 14, zIndex: 11,
            display: 'flex', alignItems: 'center', gap: 6,
            height: 30, padding: shotState ? '0 11px' : '0 9px',
            borderRadius: 999,
            border: `1px solid ${shotState === 'error' ? 'rgba(239,83,80,0.5)' : 'rgba(167,139,250,0.35)'}`,
            background: shotState === 'copied'
              ? 'rgba(38,166,154,0.16)'
              : shotState === 'error'
                ? 'rgba(239,83,80,0.14)'
                : 'rgba(13,18,32,0.72)',
            color: shotState === 'copied' ? '#34D399' : shotState === 'error' ? '#EF5350' : '#C4B5FD',
            cursor: 'pointer',
            fontSize: 11, fontWeight: 700, fontFamily: 'Inter, system-ui, sans-serif',
            letterSpacing: '0.03em',
            backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
            transition: 'background 150ms, color 150ms, border-color 150ms',
          }}
        >
          {shotState === 'copied' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          )}
          {shotState === 'copied' ? 'Copié' : shotState === 'error' ? 'Échec' : 'Capture'}
        </button>

        {/* Rapports de la famille liq/rev. Les boutons s'empilent vers la gauche
            dans l'ordre rFVG → KO → HM-BM → liq → rev : chacun se décale de ceux
            affichés avant lui, sinon ils se recouvrent. */}
        {liqStats && (
          <ReportButton nom="liq" couleur="#6E8BEE" bord="rgba(43,79,216,0.55)" onClick={downloadLiqReport}
            right={118 + (rfvgStats ? 96 : 0) + (koStats ? 96 : 0) + (hmbmStats ? 96 : 0)} />
        )}
        {revStats && (
          <ReportButton nom="rev" couleur="#34D399" bord="rgba(52,211,153,0.55)" onClick={downloadRevReport}
            right={118 + (rfvgStats ? 96 : 0) + (koStats ? 96 : 0) + (hmbmStats ? 96 : 0) + (liqStats ? 96 : 0)} />
        )}
        {twinsStats && (
          <ReportButton nom="TB" couleur="#A78BFA" bord="rgba(167,139,250,0.55)" onClick={downloadTwinsReport}
            right={118 + (rfvgStats ? 96 : 0) + (koStats ? 96 : 0) + (hmbmStats ? 96 : 0) + (liqStats ? 96 : 0) + (revStats ? 96 : 0)} />
        )}
        {xfvgxStats && (
          <ReportButton nom="xFVG+" couleur="#E879F9" bord="rgba(232,121,249,0.55)" onClick={downloadXfvgxReport}
            right={118 + (rfvgStats ? 96 : 0) + (koStats ? 96 : 0) + (hmbmStats ? 96 : 0)
                   + (liqStats ? 96 : 0) + (revStats ? 96 : 0) + (twinsStats ? 96 : 0)} />
        )}
        {rsierStats && (
          <ReportButton nom="RSIER" couleur="#F59E0B" bord="rgba(245,158,11,0.55)" onClick={downloadRsierReport}
            right={118 + (rfvgStats ? 96 : 0) + (koStats ? 96 : 0) + (hmbmStats ? 96 : 0)
                   + (liqStats ? 96 : 0) + (revStats ? 96 : 0) + (twinsStats ? 96 : 0)
                   + (xfvgxStats ? 104 : 0)} />
        )}
        {harmoStats && (
          <ReportButton nom="TRENDER" couleur="#34D399" bord="rgba(52,211,153,0.55)" onClick={downloadHarmoReport}
            right={118 + (rfvgStats ? 96 : 0) + (koStats ? 96 : 0) + (hmbmStats ? 96 : 0)
                   + (liqStats ? 96 : 0) + (revStats ? 96 : 0) + (twinsStats ? 96 : 0)
                   + (xfvgxStats ? 104 : 0) + (rsierStats ? 110 : 0)} />
        )}

        {/* Rapport JSON des positions rFVG — le clic lit rfvgReportRef, mis à
            jour par l'effet à chaque chargement de bougies : toujours à jour. */}
        {rfvgStats && (
          <button
            onClick={downloadRfvgReport}
            title="Télécharger le rapport JSON des positions rFVG (recap, max pullup, max drawdown)"
            aria-label="Télécharger le rapport des positions rFVG"
            style={{
              position: 'absolute', top: 10, right: 118, zIndex: 11,
              display: 'flex', alignItems: 'center', gap: 6,
              height: 30, padding: '0 11px',
              borderRadius: 999,
              border: '1px solid rgba(251,146,60,0.4)',
              background: 'rgba(13,18,32,0.72)',
              color: '#FB923C',
              cursor: 'pointer',
              fontSize: 11, fontWeight: 700, fontFamily: 'Inter, system-ui, sans-serif',
              letterSpacing: '0.03em',
              backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
              boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="M7 10l5 5 5-5" />
              <path d="M12 15V3" />
            </svg>
            Rapports
          </button>
        )}

        {/* Moniteur rFVG : stats des positions simulées sur les bougies
            chargées. Alimenté par l'effet rFVG, donc recalculé automatiquement
            à chaque chargement. Winrate sur les positions résolues (TP + SL),
            comparé au seuil de rentabilité RÉALISÉ (perte moyenne rapportée au
            gain moyen + perte moyenne) : au-dessus vert, en dessous rouge. Tout
            est en points — le lot est fixe. */}
        {rfvgStats && (() => {
          const { total, tp, sl, be = 0, open, expPts, beThresh, profitFactor, beOn = false,
                  skippedByCooldown = 0, skippedWon = 0,
                  dueArmed = 0, dueRemainingPts = 0, dueRemainingSl = 0 } = rfvgStats;
          const showBe = beOn || be > 0;
          const resolved = tp + sl;
          const wr       = resolved > 0 ? tp / resolved : null;
          const wrColor  = wr == null || beThresh == null ? '#94A3B8' : wr >= beThresh ? '#26A69A' : '#EF5350';
          const row = { display: 'flex', justifyContent: 'space-between', gap: 14, fontSize: 11, lineHeight: '15px' };
          const key = { color: 'rgba(148,163,184,0.85)', fontWeight: 500 };
          return (
            <div
              style={{
                position: 'absolute', top: 10, left: 14, zIndex: 11,
                display: 'flex', flexDirection: 'column', gap: 3,
                minWidth: 172, padding: '9px 12px 10px', borderRadius: 10,
                border: '1px solid rgba(251,146,60,0.35)',
                background: 'rgba(13,18,32,0.78)',
                backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
                color: '#E2E8F0', fontFamily: 'Inter, system-ui, sans-serif',
                boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
                pointerEvents: 'none',
              }}
            >
              <div style={{ ...row, marginBottom: 3 }}>
                <span style={{ color: '#FB923C', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em' }}>
                  rFVG — POSITIONS
                </span>
                <span style={{ color: 'rgba(148,163,184,0.85)', fontWeight: 600 }}>{total}</span>
              </div>
              <div style={row}>
                <span style={key}>{showBe ? 'TP / BE / SL' : 'TP / SL'}</span>
                <span style={{ fontWeight: 700 }}>
                  <span style={{ color: '#26A69A' }}>{tp}</span>
                  {showBe && (
                    <>
                      <span style={{ color: 'rgba(148,163,184,0.6)' }}> / </span>
                      <span style={{ color: '#F59E0B' }}>{be}</span>
                    </>
                  )}
                  <span style={{ color: 'rgba(148,163,184,0.6)' }}> / </span>
                  <span style={{ color: '#EF5350' }}>{sl}</span>
                </span>
              </div>
              <div style={row}>
                <span style={key}>Winrate</span>
                <span style={{ color: wrColor, fontWeight: 700 }}>
                  {wr == null ? '—' : `${(wr * 100).toFixed(1)} %`}
                </span>
              </div>
              <div style={row}>
                <span style={key}>Espérance</span>
                <span style={{ color: expPts == null ? '#94A3B8' : expPts >= 0 ? '#26A69A' : '#EF5350', fontWeight: 700 }}>
                  {expPts == null ? '—' : `${expPts >= 0 ? '+' : ''}${expPts.toFixed(1)} pts`}
                </span>
              </div>
              <div style={row}>
                <span style={key}>Facteur de profit</span>
                <span style={{ fontWeight: 600 }}>
                  {profitFactor == null ? '—' : Number.isFinite(profitFactor) ? profitFactor.toFixed(2) : '∞'}
                  {beThresh != null && (
                    <span style={{ color: 'rgba(148,163,184,0.7)', fontWeight: 500 }}> (seuil {(beThresh * 100).toFixed(0)} %)</span>
                  )}
                </span>
              </div>
              {open > 0 && (
                <div style={row}>
                  <span style={key}>Ouvertes</span>
                  <span style={{ color: '#94A3B8', fontWeight: 600 }}>{open}</span>
                </div>
              )}
              {skippedByCooldown > 0 && (
                <div style={row}>
                  <span style={key}>Sautés (cooldown)</span>
                  <span style={{ color: '#94A3B8', fontWeight: 600 }}>
                    {skippedByCooldown}<span style={{ color: 'rgba(148,163,184,0.7)', fontWeight: 500 }}> · {skippedWon} gagnant(s)</span>
                  </span>
                </div>
              )}
              {/* Le dû — visible seulement quand il a servi. Deux chiffres :
                  combien de positions sont parties rembourser, et ce qui reste
                  sur l'ardoise au bord des données. Un reste qui ne descend
                  jamais dit que le seuil est trop haut ou que le motif ne
                  rembourse pas. Même affichage que le moniteur de la famille des
                  motifs (PatternMonitor). */}
              {(dueArmed > 0 || dueRemainingSl > 0) && (
                <div style={row}>
                  <span style={key}>Dû (armés · reste)</span>
                  <span style={{ fontWeight: 600 }}>
                    <span style={{ color: '#F59E0B' }}>{dueArmed}</span>
                    <span style={{ color: 'rgba(148,163,184,0.6)' }}> · </span>
                    <span style={{ color: dueRemainingSl > 0 ? '#EF5350' : '#26A69A' }}>
                      {dueRemainingPts.toFixed(1)} pts
                    </span>
                    <span style={{ color: 'rgba(148,163,184,0.7)', fontWeight: 500 }}> ({dueRemainingSl})</span>
                  </span>
                </div>
              )}
            </div>
          );
        })()}

        {liqStats && (
          <PatternMonitor nom="liq" couleur="#6E8BEE" stats={liqStats}
            rr={patterns.find(p => p.type === 'LIQ' && p.enabled)?.rr ?? 2}
            top={10 + (rfvgStats ? 112 : 0) + (koStats ? 112 : 0) + (hmbmStats ? 112 : 0)} />
        )}

        {/* Moniteur rev : même composant, décalé sous celui du liq. */}
        {revStats && (
          <PatternMonitor nom="rev" couleur="#34D399" stats={revStats}
            rr={patterns.find(p => p.type === 'REV' && p.enabled)?.rr ?? 2}
            top={10 + (rfvgStats ? 112 : 0) + (koStats ? 112 : 0) + (hmbmStats ? 112 : 0) + (liqStats ? 132 : 0)} />
        )}

        {/* Moniteur Twins Bars : même composant encore, sous celui du rev. Seule
            différence, le RR affiché — ce motif peut régler son TP en points, et
            n'a alors aucun RR visé : c'est le médian RÉALISÉ qui s'affiche. */}
        {twinsStats && (() => {
          const pat    = patterns.find(p => p.type === 'TWINS_BARS' && p.enabled);
          const enPts  = pat?.tpMode === 'points';
          const rrVal  = enPts
            ? (twinsStats.rrMed != null ? +twinsStats.rrMed.toFixed(2) : null)
            : (pat?.rr ?? 2);
          return (
            <PatternMonitor nom="TB" couleur="#A78BFA" stats={twinsStats}
              rr={rrVal} rrMedian={enPts}
              top={10 + (rfvgStats ? 112 : 0) + (koStats ? 112 : 0) + (hmbmStats ? 112 : 0)
                   + (liqStats ? 132 : 0) + (revStats ? 132 : 0)} />
          );
        })()}

        {/* Moniteur xFVG+ : SL et TP y sont tous deux fixes et en points, donc le
            RR est un simple rapport entre deux réglages — pas une médiane à
            deviner. */}
        {xfvgxStats && (() => {
          const pat   = patterns.find(p => p.type === 'XFVGX' && p.enabled);
          const slPts = pat?.slPts ?? 10;
          const tpPts = pat?.tpPts ?? 10;
          const rrVal = slPts > 0 ? +(tpPts / slPts).toFixed(2) : null;
          return (
            <PatternMonitor nom="xFVG+" couleur="#E879F9" stats={xfvgxStats}
              rr={rrVal}
              top={10 + (rfvgStats ? 112 : 0) + (koStats ? 112 : 0) + (hmbmStats ? 112 : 0)
                   + (liqStats ? 132 : 0) + (revStats ? 132 : 0) + (twinsStats ? 132 : 0)} />
          );
        })()}

        {/* Moniteur RSIER : dernier de la pile. Comme Twins Bars, son TP peut se
            régler en points — le RR affiché est alors le médian RÉALISÉ, faute de
            RR visé. */}
        {rsierStats && (() => {
          const pat   = patterns.find(p => p.type === 'RSIER' && p.enabled);
          const enPts = pat?.tpMode === 'points';
          const rrVal = enPts
            ? (rsierStats.rrMed != null ? +rsierStats.rrMed.toFixed(2) : null)
            : (pat?.rr ?? 2);
          return (
            <PatternMonitor nom="RSIER" couleur="#F59E0B" stats={rsierStats}
              rr={rrVal} rrMedian={enPts}
              top={10 + (rfvgStats ? 112 : 0) + (koStats ? 112 : 0) + (hmbmStats ? 112 : 0)
                   + (liqStats ? 132 : 0) + (revStats ? 132 : 0) + (twinsStats ? 132 : 0)
                   + (xfvgxStats ? 132 : 0)} />
          );
        })()}

        {/* Moniteur du motif TRENDER, dernier de la pile. SL et TP y étant fixes
            et indépendants, aucun RR n'est VISÉ : c'est toujours le RR réalisé
            médian qui s'affiche. */}
        {harmoStats && (() => {
          const rrVal = harmoStats.rrMed != null ? +harmoStats.rrMed.toFixed(2) : null;
          return (
            <PatternMonitor nom="TRENDER" couleur="#34D399" stats={harmoStats}
              rr={rrVal} rrMedian
              top={10 + (rfvgStats ? 112 : 0) + (koStats ? 112 : 0) + (hmbmStats ? 112 : 0)
                   + (liqStats ? 132 : 0) + (revStats ? 132 : 0) + (twinsStats ? 132 : 0)
                   + (xfvgxStats ? 132 : 0) + (rsierStats ? 132 : 0)} />
          );
        })()}

        {/* Rapport JSON des positions KO. Les boutons de rapport s'empilent vers
            la gauche dans l'ordre rFVG → KO → HM-BM. */}
        {koStats && (
          <button
            onClick={downloadKoReport}
            title="Télécharger le rapport JSON des positions KO (recap, max pullup, max drawdown)"
            aria-label="Télécharger le rapport des positions KO"
            style={{
              position: 'absolute', top: 10, right: rfvgStats ? 214 : 118, zIndex: 11,
              display: 'flex', alignItems: 'center', gap: 6,
              height: 30, padding: '0 11px',
              borderRadius: 999,
              border: '1px solid rgba(167,139,250,0.4)',
              background: 'rgba(13,18,32,0.72)',
              color: '#A78BFA',
              cursor: 'pointer',
              fontSize: 11, fontWeight: 700, fontFamily: 'Inter, system-ui, sans-serif',
              letterSpacing: '0.03em',
              backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
              boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="M7 10l5 5 5-5" />
              <path d="M12 15V3" />
            </svg>
            KO
          </button>
        )}

        {/* Moniteur KO : positions simulées sur les bougies chargées. Empilé sous
            le moniteur rFVG quand celui-ci est présent. Winrate comparé au seuil
            de rentabilité RÉALISÉ : au-dessus vert, en dessous rouge. */}
        {koStats && (() => {
          const { total, tp, sl, be = 0, timeout = 0, open, winrate, expPts, beThresh,
                  profitFactor, beOn = false, skippedByCooldown = 0, skippedWon = 0 } = koStats;
          const showBe = beOn || be > 0;
          const wrColor = winrate == null || beThresh == null ? '#94A3B8' : winrate >= beThresh ? '#26A69A' : '#EF5350';
          const row = { display: 'flex', justifyContent: 'space-between', gap: 14, fontSize: 11, lineHeight: '15px' };
          const key = { color: 'rgba(148,163,184,0.85)', fontWeight: 500 };
          return (
            <div
              style={{
                position: 'absolute', top: rfvgStats ? 122 : 10, left: 14, zIndex: 11,
                display: 'flex', flexDirection: 'column', gap: 3,
                minWidth: 172, padding: '9px 12px 10px', borderRadius: 10,
                border: '1px solid rgba(167,139,250,0.35)',
                background: 'rgba(13,18,32,0.78)',
                backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
                color: '#E2E8F0', fontFamily: 'Inter, system-ui, sans-serif',
                boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
                pointerEvents: 'none',
              }}
            >
              <div style={{ ...row, marginBottom: 3 }}>
                <span style={{ color: '#A78BFA', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em' }}>
                  KO — POSITIONS
                </span>
                <span style={{ color: 'rgba(148,163,184,0.85)', fontWeight: 600 }}>{total}</span>
              </div>
              <div style={row}>
                <span style={key}>{showBe ? 'TP / BE / SL' : 'TP / SL'}</span>
                <span style={{ fontWeight: 700 }}>
                  <span style={{ color: '#26A69A' }}>{tp}</span>
                  {showBe && (
                    <>
                      <span style={{ color: 'rgba(148,163,184,0.6)' }}> / </span>
                      <span style={{ color: '#F59E0B' }}>{be}</span>
                    </>
                  )}
                  <span style={{ color: 'rgba(148,163,184,0.6)' }}> / </span>
                  <span style={{ color: '#EF5350' }}>{sl}</span>
                </span>
              </div>
              <div style={row}>
                <span style={key}>Winrate</span>
                <span style={{ color: wrColor, fontWeight: 700 }}>
                  {winrate == null ? '—' : `${(winrate * 100).toFixed(1)} %`}
                </span>
              </div>
              <div style={row}>
                <span style={key}>Espérance</span>
                <span style={{ color: expPts == null ? '#94A3B8' : expPts >= 0 ? '#26A69A' : '#EF5350', fontWeight: 700 }}>
                  {expPts == null ? '—' : `${expPts >= 0 ? '+' : ''}${expPts.toFixed(1)} pts`}
                </span>
              </div>
              <div style={row}>
                <span style={key}>Facteur de profit</span>
                <span style={{ fontWeight: 600 }}>
                  {profitFactor == null ? '—' : Number.isFinite(profitFactor) ? profitFactor.toFixed(2) : '∞'}
                  {beThresh != null && (
                    <span style={{ color: 'rgba(148,163,184,0.7)', fontWeight: 500 }}> (seuil {(beThresh * 100).toFixed(0)} %)</span>
                  )}
                </span>
              </div>
              {timeout > 0 && (
                <div style={row}>
                  <span style={key}>Timeout</span>
                  <span style={{ color: '#94A3B8', fontWeight: 600 }}>{timeout}</span>
                </div>
              )}
              {open > 0 && (
                <div style={row}>
                  <span style={key}>Ouvertes</span>
                  <span style={{ color: '#94A3B8', fontWeight: 600 }}>{open}</span>
                </div>
              )}
              {skippedByCooldown > 0 && (
                <div style={row}>
                  <span style={key}>Sautés (cooldown)</span>
                  <span style={{ color: '#94A3B8', fontWeight: 600 }}>
                    {skippedByCooldown}<span style={{ color: 'rgba(148,163,184,0.7)', fontWeight: 500 }}> · {skippedWon} gagnant(s)</span>
                  </span>
                </div>
              )}
            </div>
          );
        })()}

        {/* Rapport JSON des positions HM-BM (recap + excursions). Placé à gauche
            du bouton rFVG quand les deux sont actifs. */}
        {hmbmStats && (
          <button
            onClick={downloadHmbmReport}
            title="Télécharger le rapport JSON des positions HM-BM (recap, max pullup, max drawdown)"
            aria-label="Télécharger le rapport des positions HM-BM"
            style={{
              position: 'absolute', top: 10,
              right: 118 + (rfvgStats ? 96 : 0) + (koStats ? 96 : 0), zIndex: 11,
              display: 'flex', alignItems: 'center', gap: 6,
              height: 30, padding: '0 11px',
              borderRadius: 999,
              border: '1px solid rgba(34,211,238,0.4)',
              background: 'rgba(13,18,32,0.72)',
              color: '#22D3EE',
              cursor: 'pointer',
              fontSize: 11, fontWeight: 700, fontFamily: 'Inter, system-ui, sans-serif',
              letterSpacing: '0.03em',
              backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
              boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="M7 10l5 5 5-5" />
              <path d="M12 15V3" />
            </svg>
            HM-BM
          </button>
        )}

        {/* Moniteur HM-BM : positions simulées. Empilé sous le moniteur rFVG
            quand celui-ci est présent. RR variable (SL = extrême M–X), on montre
            donc l'espérance en R plutôt qu'un RR fixe. */}
        {hmbmStats && (() => {
          const { total, tp, sl, open, winrate, expR } = hmbmStats;
          const wrColor  = winrate == null ? '#94A3B8' : winrate >= 0.5 ? '#26A69A' : '#EF5350';
          const expColor = expR == null ? '#94A3B8' : expR > 0 ? '#26A69A' : expR < 0 ? '#EF5350' : '#94A3B8';
          const row = { display: 'flex', justifyContent: 'space-between', gap: 14, fontSize: 11, lineHeight: '15px' };
          const key = { color: 'rgba(148,163,184,0.85)', fontWeight: 500 };
          return (
            <div
              style={{
                position: 'absolute',
                top: 10 + (rfvgStats ? 112 : 0) + (koStats ? 112 : 0), left: 14, zIndex: 11,
                display: 'flex', flexDirection: 'column', gap: 3,
                minWidth: 172, padding: '9px 12px 10px', borderRadius: 10,
                border: '1px solid rgba(34,211,238,0.35)',
                background: 'rgba(13,18,32,0.78)',
                backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
                color: '#E2E8F0', fontFamily: 'Inter, system-ui, sans-serif',
                boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
                pointerEvents: 'none',
              }}
            >
              <div style={{ ...row, marginBottom: 3 }}>
                <span style={{ color: '#22D3EE', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em' }}>
                  HM-BM — POSITIONS
                </span>
                <span style={{ color: 'rgba(148,163,184,0.85)', fontWeight: 600 }}>{total}</span>
              </div>
              <div style={row}>
                <span style={key}>TP / SL</span>
                <span style={{ fontWeight: 700 }}>
                  <span style={{ color: '#26A69A' }}>{tp}</span>
                  <span style={{ color: 'rgba(148,163,184,0.6)' }}> / </span>
                  <span style={{ color: '#EF5350' }}>{sl}</span>
                </span>
              </div>
              <div style={row}>
                <span style={key}>Winrate</span>
                <span style={{ color: wrColor, fontWeight: 700 }}>
                  {winrate == null ? '—' : `${(winrate * 100).toFixed(1)} %`}
                </span>
              </div>
              <div style={row}>
                <span style={key}>Espérance</span>
                <span style={{ color: expColor, fontWeight: 700 }}>
                  {expR == null ? '—' : `${expR.toFixed(3)} R`}
                </span>
              </div>
              {open > 0 && (
                <div style={row}>
                  <span style={key}>Ouvertes</span>
                  <span style={{ color: '#94A3B8', fontWeight: 600 }}>{open}</span>
                </div>
              )}
            </div>
          );
        })()}

        {/* Historique HTF insuffisant — TRENDER et RSIER lisent tous deux une
            unité supérieure, et tous deux restent MUETS tant qu'elle n'a pas
            assez de bougies : l'harmonie stricte exige les 3 HTF alignés, or la
            tendance vaut 0 avant que la Bollinger n'ait démarré ; le RSIER, lui,
            n'a pas de RSI du tout. Sans ce message, le graphe reste vide sans
            raison apparente. Empilés, parce que les deux peuvent parler ensemble. */}
        {(trenderWarmup || rsierWarmup || harmoWarmup) && (
          <div
            style={{
              position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
              zIndex: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            }}
          >
            {[
              trenderWarmup && { who: 'TRENDER (indicateur)', w: trenderWarmup },
              harmoWarmup   && { who: 'TRENDER (motif)',      w: harmoWarmup },
              rsierWarmup   && { who: 'RSIER',                w: rsierWarmup },
            ].filter(Boolean).map(({ who, w }) => (
              <div
                key={who}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 13px', borderRadius: 999,
                  border: '1px solid rgba(245,158,11,0.4)',
                  background: 'rgba(20,15,5,0.88)',
                  backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
                  color: '#FCD34D', fontSize: 11.5, fontWeight: 600,
                  fontFamily: 'Inter, system-ui, sans-serif',
                  boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
                }}
              >
                <span style={{ fontSize: 13 }}>⚠</span>
                <span>
                  {who} — historique insuffisant en {w.htf} :{' '}
                  <strong>{w.have}</strong> bougies chargées sur{' '}
                  <strong>{w.need}</strong>. Fais défiler vers la gauche pour en charger,
                  ou choisis une unité de temps plus courte.
                </span>
              </div>
            ))}
          </div>
        )}

        {/* RSI area overlay: darkens + suppresses grid lines via backdrop-filter.
            Placed ABOVE canvas (z-index 1) with pointer-events off.
            brightness(0.38) makes grid lines nearly invisible on the dark bg. */}
        {hasRSI && (
          <div
            style={{
              position:            'absolute',
              left:                0,
              right:               0,
              bottom:              0,
              height:              `${rsiH * 100}%`,
              backdropFilter:      'brightness(0.38)',
              WebkitBackdropFilter:'brightness(0.38)',
              pointerEvents:       'none',
              zIndex:              1,
            }}
          />
        )}

        {/* Drag handle between candle area and RSI area */}
        {hasRSI && (
          <div
            onPointerDown={onHandlePointerDown}
            style={{
              position:       'absolute',
              left:           0,
              right:          0,
              bottom:         `${rsiH * 100}%`,
              height:         6,
              cursor:         'ns-resize',
              background:     '#1A2540',
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'center',
              zIndex:         2,
              userSelect:     'none',
              transition:     'background 120ms',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#243155'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#1A2540'; }}
          >
            {[0,1,2,3,4].map(i => (
              <div key={i} style={{ ...dotStyle, marginLeft: i ? 3 : 0 }} />
            ))}
          </div>
        )}

        {onDrawingAdd && (
          <DrawingCanvas
            chartRef={chartRef}
            seriesRef={candleSeriesRef}
            containerRef={mainWrapRef}
            drawings={drawings}
            activeTool={activeTool}
            selectedId={selectedId}
            onDrawingAdd={onDrawingAdd}
            onDrawingUpdate={onDrawingUpdate}
            onDrawingRemove={onDrawingRemove}
            onDrawingSelect={onDrawingSelect}
            candles={candles}
            onRedrawTrigger={registerDrawingRedraw}
          />
        )}

        {tradeSetupActive && tradeSetupEntry != null && (
          <TradeSetup
            chartRef={chartRef}
            seriesRef={candleSeriesRef}
            containerRef={mainWrapRef}
            entryPrice={tradeSetupEntry}
            onConfirm={onTradeSetupConfirm}
            onCancel={onTradeSetupCancel}
          />
        )}
      </div>

      {/* ── Candle tooltip ──────────────────────────────────────────────── */}
      {tooltip && (
        <div
          ref={tooltipRef}
          className={styles.tooltip}
          style={{
            left:      tooltip.flipX ? tooltip.x - 8  : tooltip.x + 14,
            top:       Math.max(4, tooltip.y - 20),
            transform: tooltip.flipX ? 'translateX(-100%)' : 'none',
          }}
        >
          <div className={styles.ttHeader}>
            <span className={styles.ttDate}>{fmtTime(tooltip.time)}</span>
            <button className={styles.ttClose} onClick={() => setTooltip(null)}>×</button>
          </div>
          <div className={styles.ohlcGrid}>
            {[['O', fmtP(tooltip.candle.open)],['H', fmtP(tooltip.candle.high)],['L', fmtP(tooltip.candle.low)],['C', fmtP(tooltip.candle.close)]].map(([k, v]) => (
              <div key={k} className={styles.ohlcRow}>
                <span className={styles.ohlcKey}>{k}</span>
                <span className={styles.ohlcVal} style={k === 'H' ? { color: '#26A69A' } : k === 'L' ? { color: '#EF5350' } : k === 'C' ? { color: tooltip.candle.close >= tooltip.candle.open ? '#26A69A' : '#EF5350' } : undefined}>{v}</span>
              </div>
            ))}
          </div>
          {tooltip.candle.volume != null && (
            <div className={styles.volRow}>Vol  {fmtVol(tooltip.candle.volume)}</div>
          )}
          {(() => {
            const cv = cvdData?.get(tooltip.time);
            if (!cv) return null;
            const fmtD = (n) => (n >= 0 ? '+' : '') + n.toLocaleString();
            return (
              <>
                <hr className={styles.ttDivider} />
                <div className={styles.cvdGrid}>
                  {[['Ask ↑', cv.upTicks.toLocaleString(), '#26A69A'],['Bid ↓', cv.downTicks.toLocaleString(), '#EF5350'],['Δ bar', fmtD(cv.delta), cv.delta >= 0 ? '#26A69A' : '#EF5350'],['CVD', fmtD(cv.cvd), cv.cvd >= 0 ? '#26A69A' : '#EF5350']].map(([k, v, c]) => (
                    <div key={k} className={styles.cvdRow}>
                      <span className={styles.cvdKey}>{k}</span>
                      <span className={styles.cvdVal} style={{ color: c }}>{v}</span>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
          {tooltip.indValues.length > 0 && (
            <>
              <hr className={styles.ttDivider} />
              {tooltip.indValues.map((iv, i) => iv.type === 'EQ' ? (
                <EqTooltip key={i} iv={iv} />
              ) : (
                <div key={i} className={styles.indRow}>
                  <span className={styles.indDot} style={{ background: iv.color }} />
                  <span className={styles.indLabel}>{iv.label}</span>
                  {iv.type === 'BB' ? (
                    <span className={styles.bbVals}>
                      <span>↑{fmtP(iv.upper)}</span>
                      <span className={styles.bbSep}>─</span>
                      <span>{fmtP(iv.middle)}</span>
                      <span className={styles.bbSep}>─</span>
                      <span>↓{fmtP(iv.lower)}</span>
                    </span>
                  ) : (
                    <span
                      className={styles.indVal}
                      style={iv.type === 'RSI' ? {
                        color: iv.value >= iv.overbought ? '#EF5350' : iv.value <= iv.oversold ? '#26A69A' : undefined,
                      } : undefined}
                    >
                      {iv.type === 'RSI' ? iv.value.toFixed(2) : fmtP(iv.value)}
                    </span>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
