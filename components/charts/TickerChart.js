import { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, LineType, CrosshairMode } from 'lightweight-charts';
import { fmtClockMs, fmtDateMs, inferDigits } from '../../lib/ticker/resolutions';
import { calcMA, calcSwings } from '../../lib/indicators';
import { createZonePrimitive } from './ZonePrimitive';

// Graphe du ticker. Deux rendus dans un seul composant, parce que c'est une
// seule et même lecture du marché à deux échelles :
//
//   mode TICK    — escalier bid/ask. Un point = un tick. Le prix ne « monte »
//                  pas en diagonale entre deux ticks : il SAUTE. L'escalier
//                  (LineType.WithSteps) est donc le seul tracé qui ne raconte
//                  pas un mouvement qui n'a pas eu lieu.
//   mode 1s…1m   — chandeliers + histogramme du nombre de ticks.
//
// ── L'axe du temps en mode tick ──────────────────────────────────────────────
// lightweight-charts veut des abscisses strictement croissantes en SECONDES.
// Or plusieurs ticks tombent dans la même milliseconde : impossible de leur
// donner leur vraie date. On leur attribue donc un rang, et on réécrit les
// étiquettes d'axe et du curseur depuis l'horodatage réel.
//
// Ce rang est ANCRÉ, pas recalculé : le point d'ancrage garde le rang 0, et
// les pages plus anciennes reçoivent des rangs NÉGATIFS. Si l'on renumérotait
// à partir de zéro à chaque page chargée, tous les points changeraient
// d'abscisse d'un coup et la vue sauterait à chaque remontée dans l'histoire.
//
// C'est aussi ce qui rend la vue lisible : une seconde agitée peut porter des
// centaines de ticks, qui à l'échelle du temps se tasseraient sur une colonne
// d'un pixel. Au rang, chaque tick a sa place.

const PREFETCH_THRESHOLD = 60;   // marge, en points, avant le bord gauche

const COL = {
  bid:    '#26A69A',
  ask:    '#EF5350',
  mid:    '#60A5FA',
  last:   '#F59E0B',
  band:   'rgba(148,163,184,0.55)',
  grid:   '#161F33',
  border: '#243155',
  text:   '#64748B',
};

// Palette des moyennes mobiles, dans l'ordre où on les ajoute. Choisie pour se
// détacher du bleu du prix et des deux gris du spread.
const MA_COLORS = ['#F59E0B', '#A78BFA', '#34D399', '#F472B6'];
// Les FVG gardent le couple haussier/baissier de la plateforme ; les iFVG
// prennent des teintes voisines mais distinctes — même famille, autre statut.
const FVG_COLORS = {
  fvg:  { bull: '#26A69A', bear: '#EF5350' },
  ifvg: { bull: '#38BDF8', bear: '#F59E0B' },
};

const SWING_HIGH_COLOR = '#F59E0B';
const SWING_LOW_COLOR  = '#60A5FA';

// Prix d'un tick selon la source demandée.
function pick(row, src) {
  if (src === 'bid')  return row.bid;
  if (src === 'ask')  return row.ask;
  if (src === 'last') return row.last;
  if (row.bid == null || row.ask == null) return row.bid ?? row.ask ?? null;
  return (row.bid + row.ask) / 2;
}

// Rang du tick d'horodatage `us` dans un tableau trié (recherche dichotomique).
// Sert à retrouver l'ancre après l'ajout d'une page en tête.
function indexOfUs(rows, us) {
  let lo = 0, hi = rows.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].us === us) return mid;
    if (rows[mid].us < us) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}

// ── Les indicateurs sur des ticks ────────────────────────────────────────────
// Les indicateurs de la plateforme (lib/indicators.js) parlent BOUGIES : ils
// veulent { time, open, high, low, close }. En mode agrégé, les lignes en sont
// déjà. En mode tick, l'effet de données leur en fabrique : un tick est une
// bougie sans durée, donc open = high = low = close = son prix, et l'abscisse
// est le RANG du tracé — pas la date, qui n'est pas représentable ici.
//
// Ce n'est pas un artifice : ça donne aux deux indicateurs le sens qu'on attend
// d'eux sur un graphe au tick.
//   · SMA(20) = moyenne des 20 DERNIERS TICKS, pas des 20 dernières secondes.
//     Sa portée en temps se dilate donc quand le marché s'endort — c'est la
//     lecture juste sur un graphe dont l'abscisse est l'activité, pas l'horloge.
//   · Swing = tick strictement plus haut (ou bas) que ses N voisins de chaque
//     côté. Sur un palier de prix identiques il n'y a aucun pivot, et il n'en
//     est signalé aucun.

const FLAG_LABELS = [
  [32, 'BUY'], [64, 'SELL'], [8, 'LAST'], [16, 'VOL'], [2, 'BID'], [4, 'ASK'],
];

function flagText(flags) {
  const out = [];
  for (const [bit, label] of FLAG_LABELS) if (flags & bit) out.push(label);
  return out.length ? out.join(' · ') : '—';
}

export default function TickerChart({
  rows,
  isTick,
  src        = 'mid',
  showBand   = true,
  showVolume = true,
  digits,                 // décimales du prix TRACÉ (mid compris) ; à défaut, lues dans les données
  baseDigits,             // décimales des cotations brutes — bid, ask, spread
  maPeriods  = [],        // moyennes mobiles simples à tracer, une par période
  showSwings = false,
  swingLeft  = 5,
  swingRight = 5,
  zones       = [],       // rectangles support / résistance (hooks/useZones.js)
  fvgZones    = [],       // motifs FVG / iFVG détectés (lib/ticker/fvg.js)
  zoneTool    = false,    // mode tracé : le glissement dessine au lieu de déplacer
  zoneKind    = 'support',// sens CHOISI pour les prochaines zones
  selectedZoneId = null,
  onZoneCreate,
  onZoneSelect,
  viewKey    = '',        // change ⇒ jeu de données neuf ⇒ ancrage à refaire
  onLoadMore,
  prepended,
}) {
  const hostRef    = useRef(null);
  const chartRef   = useRef(null);
  const mainRef    = useRef(null);   // ligne principale (tick) ou chandeliers
  const bidRef     = useRef(null);
  const askRef     = useRef(null);
  const volRef     = useRef(null);

  const rowsRef    = useRef(rows);
  const isTickRef  = useRef(isTick);
  const srcRef     = useRef(src);
  const loadMoreRef = useRef(onLoadMore);

  // Ancrage des rangs (mode tick). anchorUs garde le rang anchorX.
  const anchorRef  = useRef({ us: null, offset: 0 });
  const viewKeyRef = useRef(viewKey);
  // Index date → ligne, pour l'infobulle du mode agrégé (un parcours linéaire
  // à chaque mouvement de souris sur 20 000 bougies se sentirait).
  const byTimeRef  = useRef(new Map());
  const digitsRef  = useRef(5);
  const maMapRef   = useRef(new Map());   // période → série
  const swingRef   = useRef(null);        // { highSeries, lowSeries }
  // Bougies des indicateurs, construites par l'effet de données — une seule
  // source pour la SMA et les swings, forcément d'accord avec le tracé.
  const barsRef    = useRef([]);
  const zoneRef    = useRef(null);        // primitive des zones tracées à la main
  const fvgRef     = useRef(null);        // primitive des motifs détectés
  const [draft, setDraft] = useState(null); // zone en cours de tracé
  const draftRef   = useRef(null);        // même valeur, lisible hors rendu
  const zoneKindRef = useRef(zoneKind);

  const [hover, setHover] = useState(null);

  useEffect(() => { rowsRef.current    = rows;       }, [rows]);
  useEffect(() => { isTickRef.current  = isTick;     }, [isTick]);
  useEffect(() => { srcRef.current     = src;        }, [src]);
  useEffect(() => { loadMoreRef.current = onLoadMore; }, [onLoadMore]);
  useEffect(() => { zoneKindRef.current = zoneKind; }, [zoneKind]);

  // Rang → ligne de données. Le rang est ancré, l'index dans le tableau ne
  // l'est pas : c'est ici que se fait la traduction.
  const rowAtX = useCallback((x) => {
    const i = Math.round(x) - anchorRef.current.offset;
    const list = rowsRef.current;
    return (i >= 0 && i < list.length) ? list[i] : null;
  }, []);

  // Abscisse écran → milliseconde réelle. On passe par l'index LOGIQUE plutôt
  // que par coordinateToTime : au-delà de la dernière bougie, l'heure n'existe
  // pas encore et la conversion rendrait null — or c'est précisément là qu'on
  // trace le plus souvent, sur le bord droit.
  const msAt = useCallback((clientX) => {
    const chart = chartRef.current;
    const host = hostRef.current;
    const list = rowsRef.current;
    if (!chart || !host || !list.length) return null;
    const logical = chart.timeScale().coordinateToLogical(clientX - host.getBoundingClientRect().left);
    if (logical == null) return null;
    const i = Math.max(0, Math.min(list.length - 1, Math.round(logical)));
    return isTickRef.current ? list[i].t : list[i].time * 1000;
  }, []);

  // ── Montage ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!hostRef.current) return;

    const chart = createChart(hostRef.current, {
      width:  hostRef.current.offsetWidth,
      height: hostRef.current.offsetHeight,
      layout: {
        background: { type: 'solid', color: 'rgba(0,0,0,0)' },
        textColor:  COL.text,
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        fontSize:   11,
      },
      grid: {
        vertLines: { color: COL.grid },
        horzLines: { color: COL.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { labelBackgroundColor: '#1E293B' },
        horzLine: { labelBackgroundColor: '#1E293B' },
      },
      rightPriceScale: {
        borderColor:  COL.border,
        scaleMargins: { top: 0.08, bottom: 0.22 },
      },
      timeScale: {
        borderColor:    COL.border,
        timeVisible:    true,
        secondsVisible: true,
        rightOffset:    4,
        // En mode tick, l'abscisse est un RANG : ni la date ni l'heure ne s'en
        // déduisent, il faut aller chercher la ligne de données.
        tickMarkFormatter: (time) => {
          if (!isTickRef.current) return null;   // null ⇒ lightweight-charts reprend la main
          const r = rowAtX(time);
          return r ? fmtClockMs(r.t, { millis: false }) : '';
        },
      },
      localization: {
        // Contrairement au formateur d'axe, celui-ci n'accepte PAS de repli :
        // il doit rendre une chaîne dans les deux modes.
        timeFormatter: (time) => {
          if (!isTickRef.current) {
            return `${fmtDateMs(time * 1000)} ${fmtClockMs(time * 1000, { millis: false })}`;
          }
          const r = rowAtX(time);
          return r ? `${fmtDateMs(r.t)} ${fmtClockMs(r.t)}` : '';
        },
      },
      handleScale: { axisPressedMouseMove: { time: true, price: true } },
    });

    chartRef.current = chart;

    chart.subscribeCrosshairMove(param => {
      if (!param.point || param.time == null || !hostRef.current) { setHover(null); return; }
      // En mode agrégé on ne se contente pas de ce que rend la série (OHLC) :
      // le nombre de ticks et le spread moyen ne sont dans aucune série, ils
      // viennent de la ligne d'origine, retrouvée par sa date.
      const row = isTickRef.current ? rowAtX(param.time) : byTimeRef.current.get(param.time);
      if (!row) { setHover(null); return; }

      const w = hostRef.current.offsetWidth;
      setHover({
        x: param.point.x,
        y: param.point.y,
        flip: param.point.x > w * 0.6,
        row,
      });
    });

    // Chargement de la page précédente quand on approche du bord gauche.
    let lock = false;
    chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if (!range || lock || !loadMoreRef.current) return;
      if (range.from < PREFETCH_THRESHOLD) {
        lock = true;
        Promise.resolve(loadMoreRef.current()).finally(() => {
          setTimeout(() => { lock = false; }, 400);
        });
      }
    });

    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        if (width && height) chart.applyOptions({ width, height });
      }
    });
    ro.observe(hostRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      mainRef.current = bidRef.current = askRef.current = volRef.current = null;
      // La comptabilité des indicateurs meurt AVEC le graphe. Sans cette ligne,
      // la table des moyennes survit au remontage et croit ses séries encore
      // vivantes : elle ne les recrée pas sur le nouveau graphe et continue de
      // les alimenter dans le vide. Aucune erreur, aucune trace — juste des
      // indicateurs qui ne s'affichent jamais.
      maMapRef.current.clear();
      swingRef.current = null;
      zoneRef.current = null;
      fvgRef.current = null;
    };
  }, [rowAtX]);

  // ── Séries : elles dépendent du mode, pas du reste ──────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Les décimales viennent de la page (lues sur les cotations brutes) ; le
    // repli ne sert qu'au cas où la couverture n'a pas encore répondu.
    const dg = digits ?? inferDigits(rows.map(r =>
      isTick ? (r.bid ?? r.ask ?? r.last) : r.close));
    digitsRef.current = dg;
    const priceFormat = {
      type: 'price',
      precision: dg,
      minMove: Number((1 / 10 ** dg).toFixed(dg)),
    };

    if (isTick) {
      // Les deux côtés du spread d'abord : ils passent SOUS la ligne
      // principale, qui reste lisible par-dessus.
      const mk = (color) => chart.addLineSeries({
        color,
        lineWidth: 1,
        lineType: LineType.WithSteps,
        priceFormat,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      bidRef.current = mk(COL.band);
      askRef.current = mk(COL.band);

      mainRef.current = chart.addLineSeries({
        color: COL[src] ?? COL.mid,
        lineWidth: 2,
        lineType: LineType.WithSteps,
        priceFormat,
        priceLineVisible: true,
        lastValueVisible: true,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 3,
      });
    } else {
      mainRef.current = chart.addCandlestickSeries({
        upColor: '#26A69A', downColor: '#EF5350',
        borderUpColor: '#26A69A', borderDownColor: '#EF5350',
        wickUpColor: '#26A69A', wickDownColor: '#EF5350',
        priceFormat,
      });
      volRef.current = chart.addHistogramSeries({
        priceFormat:  { type: 'volume' },
        priceScaleId: 'ticker_vol',
        color: 'rgba(96,165,250,0.35)',
      });
      chart.priceScale('ticker_vol').applyOptions({
        scaleMargins: { top: 0.84, bottom: 0 },
      });
    }

    // Les zones s'accrochent à la série principale : c'est elle qui porte
    // l'échelle des prix, et une bande de prix n'existe que par rapport à elle.
    // Elles sont donc recréées avec elle à chaque changement de mode.
    // Deux primitives distinctes sur la même série : les motifs DÉTECTÉS et
    // les zones TRACÉES ne se mélangent pas. Une seule liste rendrait la
    // sélection ambiguë — on ne sélectionne que ce qu'on a dessiné soi-même.
    fvgRef.current = createZonePrimitive();
    mainRef.current.attachPrimitive(fvgRef.current);
    zoneRef.current = createZonePrimitive();
    mainRef.current.attachPrimitive(zoneRef.current);

    return () => {
      for (const ref of [zoneRef, fvgRef]) {
        if (ref.current && mainRef.current) {
          try { mainRef.current.detachPrimitive(ref.current); } catch { /* série déjà retirée */ }
        }
        ref.current = null;
      }
      for (const ref of [mainRef, bidRef, askRef, volRef]) {
        if (ref.current) { try { chart.removeSeries(ref.current); } catch { /* graphe déjà démonté */ } }
        ref.current = null;
      }
    };
    // `rows` n'est lu que pour les décimales : le re-créer à chaque tick reçu
    // détruirait le zoom. Seuls le mode et la source refont les séries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTick, src]);

  // Les décimales arrivent avec la couverture, donc APRÈS le premier rendu.
  // On les applique aux séries en place : les recréer ferait perdre le zoom
  // une seconde après l'ouverture de la page, sans raison visible.
  useEffect(() => {
    if (digits == null) return;
    digitsRef.current = digits;
    const priceFormat = {
      type: 'price',
      precision: digits,
      minMove: Number((1 / 10 ** digits).toFixed(digits)),
    };
    for (const ref of [mainRef, bidRef, askRef]) ref.current?.applyOptions({ priceFormat });
  }, [digits]);

  // ── Données ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !mainRef.current) return;

    if (!rows.length) {
      mainRef.current.setData([]);
      bidRef.current?.setData([]);
      askRef.current?.setData([]);
      volRef.current?.setData([]);
      barsRef.current = [];
      return;
    }

    // Les lignes doivent être de la forme qu'attend le mode : un point brut
    // porte `us`, une bougie porte `time`. Le hook garantit déjà qu'elles ne
    // peuvent pas se croiser, mais lightweight-charts ne se contente pas d'un
    // rendu vide en cas d'erreur — il jette. On ne dessine rien plutôt que de
    // faire tomber la page, et l'effet repassera avec les bonnes données.
    const shapeOk = isTick ? rows[0].us != null : rows[0].time != null;
    if (!shapeOk) { barsRef.current = []; return; }

    if (isTick) {
      // Ancrage : un jeu de données neuf repart de zéro ; sinon on retrouve
      // l'ancre et on en déduit le décalage, pour que les points déjà affichés
      // gardent exactement l'abscisse qu'ils avaient.
      const a = anchorRef.current;
      if (viewKeyRef.current !== viewKey || a.us == null) {
        viewKeyRef.current = viewKey;
        anchorRef.current = { us: rows[0].us, offset: 0 };
      } else {
        const at = indexOfUs(rows, a.us);
        if (at < 0) anchorRef.current = { us: rows[0].us, offset: 0 };
        else        anchorRef.current = { us: a.us, offset: -at };
      }
      const off = anchorRef.current.offset;

      const main = new Array(rows.length);
      const bid  = new Array(rows.length);
      const ask  = new Array(rows.length);
      const bars = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const x = i + off;
        const p = pick(r, src);
        // Un point sans valeur ({time} seul) est un TROU pour la librairie :
        // la ligne s'interrompt au lieu de relier deux prix sans rapport.
        main[i] = p == null ? { time: x } : { time: x, value: p };
        bid[i]  = r.bid == null ? { time: x } : { time: x, value: r.bid };
        ask[i]  = r.ask == null ? { time: x } : { time: x, value: r.ask };
        // Les bougies des indicateurs se construisent dans CE parcours : les
        // recalculer ailleurs, c'est deux passes de plus sur 20 000 points
        // toutes les trois secondes, et deux occasions de diverger du tracé.
        if (p != null) bars.push({ time: x, open: p, high: p, low: p, close: p });
      }
      barsRef.current = bars;

      mainRef.current.setData(main);
      bidRef.current?.setData(showBand && src !== 'last' ? bid : []);
      askRef.current?.setData(showBand && src !== 'last' ? ask : []);
    } else {
      viewKeyRef.current = viewKey;
      const byTime = new Map();
      for (const r of rows) byTime.set(r.time, r);
      byTimeRef.current = byTime;
      // Une bougie agrégée EST déjà la bougie qu'attendent les indicateurs.
      barsRef.current = rows;

      mainRef.current.setData(rows.map(r => ({
        time: r.time, open: r.open, high: r.high, low: r.low, close: r.close,
      })));
      volRef.current?.setData(showVolume
        ? rows.map(r => ({
            time: r.time,
            value: r.ticks,
            color: r.close >= r.open ? 'rgba(38,166,154,0.35)' : 'rgba(239,83,80,0.35)',
          }))
        : []);
    }
  }, [rows, isTick, src, showBand, showVolume, viewKey]);

  // ── Moyennes mobiles ────────────────────────────────────────────────────
  // Déclaré APRÈS l'effet de données, et ce n'est pas un détail : les effets
  // s'exécutent dans l'ordre d'écriture, et c'est cet effet-là qui remplit
  // barsRef en même temps qu'il pose le tracé. Lire avant, ce serait travailler
  // sur les bougies du rendu précédent — donc décaler les indicateurs d'une
  // page entière après chaque remontée dans l'histoire.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const map    = maMapRef.current;
    const wanted = new Set(maPeriods);

    for (const [period, series] of map) {
      if (!wanted.has(period)) {
        try { chart.removeSeries(series); } catch { /* graphe déjà démonté */ }
        map.delete(period);
      }
    }

    const bars = barsRef.current;

    maPeriods.forEach((period, i) => {
      if (!map.has(period)) {
        map.set(period, chart.addLineSeries({
          color: MA_COLORS[i % MA_COLORS.length],
          lineWidth: 1.5,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: true,
          crosshairMarkerRadius: 3,
          title: `SMA(${period})`,
        }));
      } else {
        map.get(period).applyOptions({ color: MA_COLORS[i % MA_COLORS.length] });
      }
      map.get(period).setData(
        bars.length >= period ? calcMA(bars, { type: 'SMA', period, source: 'close' }) : [],
      );
    });

    // Rien à nettoyer ici : une moyenne qu'on retire est traitée plus haut, et
    // la mort du graphe est traitée dans SON cleanup, qui vide aussi la table.
  }, [rows, isTick, src, maPeriods, viewKey]);

  // ── Swings ──────────────────────────────────────────────────────────────
  // Deux séries invisibles qui ne portent que des marqueurs — même montage que
  // le graphe principal, pour que « SH » et « SL » se lisent pareil partout.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (!showSwings) {
      if (swingRef.current) {
        try {
          chart.removeSeries(swingRef.current.highSeries);
          chart.removeSeries(swingRef.current.lowSeries);
        } catch { /* graphe déjà démonté */ }
        swingRef.current = null;
      }
      return;
    }

    if (!swingRef.current) {
      const ghost = {
        color: 'rgba(0,0,0,0)', lineWidth: 0,
        priceLineVisible: false, lastValueVisible: false,
        crosshairMarkerVisible: false, title: '',
      };
      swingRef.current = {
        highSeries: chart.addLineSeries(ghost),
        lowSeries:  chart.addLineSeries(ghost),
      };
    }

    const { highSeries, lowSeries } = swingRef.current;
    const left  = Math.max(1, swingLeft);
    const right = Math.max(1, swingRight);
    const bars  = barsRef.current;

    if (bars.length < left + right + 1) {
      highSeries.setData([]); highSeries.setMarkers([]);
      lowSeries.setData([]);  lowSeries.setMarkers([]);
      return;
    }

    const { highs, lows } = calcSwings(bars, { leftBars: left, rightBars: right });

    highSeries.setData(highs);
    highSeries.setMarkers(highs.map(({ time }) => ({
      time, position: 'aboveBar', color: SWING_HIGH_COLOR, shape: 'arrowDown', text: 'SH',
    })));
    lowSeries.setData(lows);
    lowSeries.setMarkers(lows.map(({ time }) => ({
      time, position: 'belowBar', color: SWING_LOW_COLOR, shape: 'arrowUp', text: 'SL',
    })));
  }, [rows, isTick, src, showSwings, swingLeft, swingRight, viewKey]);

  // ── Zones de support / résistance ───────────────────────────────────────
  // Les zones sont rangées en MILLISECONDES réelles ; le graphe, lui, parle
  // rangs (mode tick) ou secondes (mode agrégé). La traduction se fait ici, et
  // ici seulement — la primitive ne connaît pas les modes.
  //
  // Une borne hors des données chargées devient `null` : le rectangle court
  // alors jusqu'au bord de la vue. C'est ce qui évite qu'un repère disparaisse
  // simplement parce qu'on a fait défiler le graphe au-delà de lui.
  const msToX = useCallback((ms) => {
    if (ms == null) return null;
    const list = rowsRef.current;
    if (!list.length) return null;
    const tick = isTickRef.current;
    const timeOf = r => (tick ? r.t : r.time * 1000);

    if (ms <= timeOf(list[0]))               return null;   // avant le chargé → bord gauche
    if (ms >= timeOf(list[list.length - 1])) return null;   // après → bord droit

    let lo = 0, hi = list.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (timeOf(list[mid]) < ms) lo = mid + 1; else hi = mid;
    }
    return tick ? lo + anchorRef.current.offset : list[lo].time;
  }, []);

  useEffect(() => {
    const resolve = z => ({ ...z, x1: msToX(z.fromMs), x2: msToX(z.toMs) });
    zoneRef.current?.update(zones.map(resolve), {
      selectedId: selectedZoneId,
      draft: draft ? resolve(draft) : null,
    });
  }, [zones, selectedZoneId, draft, isTick, src, rows, msToX]);

  // Motifs détectés. Le cadre en pointillés et l'étiquette les distinguent des
  // zones tracées : ce que la machine a trouvé ne doit jamais se confondre avec
  // ce qu'on a décidé soi-même.
  useEffect(() => {
    const resolved = fvgZones.map(z => ({
      ...z,
      x1: msToX(z.fromMs),
      x2: msToX(z.toMs),
      color: FVG_COLORS[z.kind][z.side],
      dashed: z.kind === 'ifvg',
      label: z.kind === 'ifvg' ? 'iFVG' : (z.filled ? 'FVG ·' : 'FVG'),
    }));
    fvgRef.current?.update(resolved, { opacity: 0.1 });
  }, [fvgZones, isTick, src, rows, msToX]);

  // Sélection au clic, hors mode tracé. On cherche la zone qui CONTIENT le
  // prix cliqué, la plus fine d'abord : deux bandes qui se recouvrent, c'est la
  // plus précise qu'on visait.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || zoneTool || !onZoneSelect) return;

    const onClick = param => {
      const series = mainRef.current;
      if (!param.point || !series) return;
      const price = series.coordinateToPrice(param.point.y);
      if (price == null) return;
      const ms = msAt(param.point.x + (hostRef.current?.getBoundingClientRect().left ?? 0));
      const inside = z =>
        price <= z.top && price >= z.bottom &&
        // Une zone sans bornes traverse tout ; sinon le clic doit tomber dedans.
        (z.fromMs == null || ms == null || (ms >= z.fromMs && ms <= z.toMs));
      const hit = zones
        .filter(inside)
        .sort((a, b) => (a.top - a.bottom) - (b.top - b.bottom))[0];
      onZoneSelect(hit ? hit.id : null);
    };

    chart.subscribeClick(onClick);
    return () => { try { chart.unsubscribeClick(onClick); } catch { /* graphe démonté */ } };
  }, [zones, zoneTool, onZoneSelect, msAt]);

  // ── Tracé d'une zone ────────────────────────────────────────────────────
  // Le glissement se fait sur un calque posé PAR-DESSUS le graphe. C'est lui
  // qui empêche le déplacement de la vue pendant le tracé : sans ce calque, un
  // glissement ferait les deux à la fois, et la zone atterrirait ailleurs.
  const priceAt = useCallback((clientY) => {
    const series = mainRef.current;
    const host = hostRef.current;
    if (!series || !host) return null;
    return series.coordinateToPrice(clientY - host.getBoundingClientRect().top);
  }, []);

  // Le tracé vit dans une REF, mise à jour au fil des mouvements ; l'état ne
  // sert qu'à redessiner. Un relâchement peut tomber avant que React n'ait
  // rejoué le rendu du dernier mouvement — la ref, elle, est toujours à jour.
  const setDraftNow = useCallback((d) => {
    draftRef.current = d;
    setDraft(d);
  }, []);

  const onPointerDown = useCallback((e) => {
    const p = priceAt(e.clientY);
    const t = msAt(e.clientX);
    if (p == null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraftNow({
      top: p, bottom: p, anchor: p,
      fromMs: t, toMs: t, anchorMs: t,
      kind: zoneKindRef.current,
    });
  }, [priceAt, msAt, setDraftNow]);

  const onPointerMove = useCallback((e) => {
    const d = draftRef.current;
    if (!d) return;
    const p = priceAt(e.clientY);
    if (p == null) return;
    const t = msAt(e.clientX);
    setDraftNow({
      ...d,
      top:    Math.max(d.anchor, p),
      bottom: Math.min(d.anchor, p),
      fromMs: t == null ? d.fromMs : Math.min(d.anchorMs ?? t, t),
      toMs:   t == null ? d.toMs   : Math.max(d.anchorMs ?? t, t),
    });
  }, [priceAt, msAt, setDraftNow]);

  const onPointerUp = useCallback(() => {
    // La création se fait ICI, et surtout PAS dans l'updater de setDraft :
    // React peut rejouer un updater (c'est le cas en développement), et un
    // effet de bord qui s'y trouve s'exécute alors deux fois — deux zones
    // identiques superposées, invisibles à l'œil, et un compteur qui double.
    const d = draftRef.current;
    setDraftNow(null);
    if (!d) return;

    const series = mainRef.current;
    // Une bande plus fine que quelques pixels est un clic, pas un tracé : la
    // créer donnerait une zone invisible et impossible à ressaisir.
    const yT = series?.priceToCoordinate(d.top);
    const yB = series?.priceToCoordinate(d.bottom);
    if (yT == null || yB == null || Math.abs(yB - yT) < 4) return;

    onZoneCreate?.({ top: d.top, bottom: d.bottom, fromMs: d.fromMs, toMs: d.toMs, kind: d.kind });
  }, [onZoneCreate, setDraftNow]);

  // Échap abandonne le tracé en cours — sans quoi un glissement mal parti se
  // termine forcément par une zone à supprimer.
  useEffect(() => {
    if (!draft) return;
    const onKey = e => { if (e.key === 'Escape') setDraftNow(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draft]);

  // ── Page ajoutée en tête : on rattrape la fenêtre visible ────────────────
  // En mode agrégé les abscisses sont de vraies dates et la librairie s'en
  // sort seule. En mode tick, les points ajoutés prennent des rangs négatifs :
  // la fenêtre, elle, reste exprimée en index de tableau et a donc reculé
  // d'autant de crans qu'on a chargé de points.
  useEffect(() => {
    if (!isTick || !prepended?.n || !chartRef.current) return;
    const ts = chartRef.current.timeScale();
    const r = ts.getVisibleLogicalRange();
    if (r) ts.setVisibleLogicalRange({ from: r.from + prepended.n, to: r.to + prepended.n });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepended]);

  // ── Infobulle ───────────────────────────────────────────────────────────
  const tip = hover?.row;
  const dg  = digitsRef.current;
  const bdg = baseDigits ?? dg;   // bid/ask/spread restent à la précision du broker
  const spread = tip && tip.bid != null && tip.ask != null ? tip.ask - tip.bid : null;

  return (
    <div ref={hostRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Calque de tracé — présent SEULEMENT en mode zone. Le reste du temps il
          n'existe pas, et rien ne s'interpose entre la souris et le graphe. */}
      {zoneTool && (
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setDraftNow(null)}
          style={{
            position: 'absolute', inset: 0, zIndex: 2,
            cursor: draft ? 'grabbing' : 'crosshair',
            touchAction: 'none',
          }}
        />
      )}

      {tip && (
        <div
          style={{
            position: 'absolute',
            left: hover.flip ? undefined : Math.min(hover.x + 16, 9999),
            right: hover.flip ? 16 : undefined,
            top: 12,
            zIndex: 4,
            pointerEvents: 'none',
            background: 'rgba(13,18,32,0.94)',
            border: '1px solid #243155',
            borderRadius: 6,
            padding: '8px 10px',
            font: "11px/1.55 'JetBrains Mono', ui-monospace, monospace",
            color: '#CBD5E1',
            whiteSpace: 'nowrap',
            boxShadow: '0 6px 24px rgba(0,0,0,0.45)',
          }}
        >
          {isTick ? (
            <>
              <div style={{ color: '#94A3B8', marginBottom: 4 }}>
                {fmtDateMs(tip.t)} {fmtClockMs(tip.t)}
              </div>
              <Row label="bid"  value={tip.bid} digits={bdg} color={COL.bid} />
              <Row label="ask"  value={tip.ask} digits={bdg} color={COL.ask} />
              {spread != null && <Row label="spread" value={spread} digits={bdg} color="#94A3B8" />}
              {tip.last != null && <Row label="last" value={tip.last} digits={bdg} color={COL.last} />}
              {tip.vol != null && <Row label="vol" value={tip.vol} raw color="#94A3B8" />}
              <div style={{ color: '#475569', marginTop: 4 }}>{flagText(tip.flags ?? 0)}</div>
            </>
          ) : (
            <>
              <div style={{ color: '#94A3B8', marginBottom: 4 }}>
                {fmtDateMs(tip.time * 1000)} {fmtClockMs(tip.time * 1000, { millis: false })}
              </div>
              <Row label="O" value={tip.open}  digits={dg} />
              <Row label="H" value={tip.high}  digits={dg} />
              <Row label="L" value={tip.low}   digits={dg} />
              <Row label="C" value={tip.close} digits={dg} color={tip.close >= tip.open ? COL.bid : COL.ask} />
              {tip.ticks != null && <Row label="ticks" value={tip.ticks} color="#94A3B8" raw />}
              {tip.spread != null && <Row label="spread" value={tip.spread} digits={bdg} color="#94A3B8" />}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, color = '#CBD5E1', digits = 5, raw = false }) {
  if (value == null) return null;
  return (
    <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
      <span style={{ color: '#64748B' }}>{label}</span>
      <span style={{ color }}>
        {raw ? String(value) : Number(value).toFixed(digits)}
      </span>
    </div>
  );
}
