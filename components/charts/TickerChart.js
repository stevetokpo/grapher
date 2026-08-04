import { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, LineType, CrosshairMode } from 'lightweight-charts';
import { fmtClockMs, fmtDateMs, inferDigits } from '../../lib/ticker/resolutions';

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

  const [hover, setHover] = useState(null);

  useEffect(() => { rowsRef.current    = rows;       }, [rows]);
  useEffect(() => { isTickRef.current  = isTick;     }, [isTick]);
  useEffect(() => { srcRef.current     = src;        }, [src]);
  useEffect(() => { loadMoreRef.current = onLoadMore; }, [onLoadMore]);

  // Rang → ligne de données. Le rang est ancré, l'index dans le tableau ne
  // l'est pas : c'est ici que se fait la traduction.
  const rowAtX = useCallback((x) => {
    const i = Math.round(x) - anchorRef.current.offset;
    const list = rowsRef.current;
    return (i >= 0 && i < list.length) ? list[i] : null;
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

    return () => {
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
      return;
    }

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
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const x = i + off;
        const p = pick(r, src);
        // Un point sans valeur ({time} seul) est un TROU pour la librairie :
        // la ligne s'interrompt au lieu de relier deux prix sans rapport.
        main[i] = p == null ? { time: x } : { time: x, value: p };
        bid[i]  = r.bid == null ? { time: x } : { time: x, value: r.bid };
        ask[i]  = r.ask == null ? { time: x } : { time: x, value: r.ask };
      }

      mainRef.current.setData(main);
      bidRef.current?.setData(showBand && src !== 'last' ? bid : []);
      askRef.current?.setData(showBand && src !== 'last' ? ask : []);
    } else {
      viewKeyRef.current = viewKey;
      const byTime = new Map();
      for (const r of rows) byTime.set(r.time, r);
      byTimeRef.current = byTime;

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
