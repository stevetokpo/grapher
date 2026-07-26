// Series primitive pour le motif HM-BM : encadre le motif (bougies 1 & 2) d'une
// zone translucide, puis trace le NIVEAU D'ENTRÉE (ouverture de la bougie X) et
// le STOP LOSS (extrême entre M et X) comme segments horizontaux tirés à droite.
//
// Comme les autres primitives, elle recalcule ses pixels à chaque redraw : les
// zones et lignes restent collées aux bougies pendant pan / zoom.
//
// Usage :
//   const p = createHmbmPrimitive();
//   candleSeries.attachPrimitive(p);
//   p.update(motifs, { bullColor, bearColor, slColor, opacity, showLabel });
//
// Forme attendue par motif (cf. calcHMBM) :
//   { side, label, top, bottom, startTime, endTime,
//     entryTime, entryPrice, sl, slStartTime, levelEndTime }

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

class HmbmRenderer {
  constructor() { this._data = null; }
  setData(data) { this._data = data; }

  draw(target) {
    const data = this._data;
    if (!data || !data.items.length) return;

    target.useBitmapCoordinateSpace(scope => {
      const ctx   = scope.context;
      const hr    = scope.horizontalPixelRatio;
      const vr    = scope.verticalPixelRatio;
      const fullW = scope.bitmapSize.width;

      for (const it of data.items) {
        // ── Niveau d'entrée (ligne pleine, épaisse) ──────────────────────
        if (it.entry) {
          const e   = it.entry;
          const ex1 = Math.round(e.x1 * hr);
          const ex2 = e.extendRight ? fullW : Math.round(e.x2 * hr);
          const ey  = Math.round(e.y * vr) + 0.5;
          ctx.strokeStyle = hexToRgba(it.color, 1);
          ctx.lineWidth = Math.max(3, Math.round(3 * vr));
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(ex1, ey); ctx.lineTo(ex2, ey);
          ctx.stroke();
        }

        // ── Stop loss (ligne tiretée, épaisse) ───────────────────────────
        if (it.sl) {
          const s   = it.sl;
          const sx1 = Math.round(s.x1 * hr);
          const sx2 = s.extendRight ? fullW : Math.round(s.x2 * hr);
          const sy  = Math.round(s.y * vr) + 0.5;
          ctx.strokeStyle = hexToRgba(data.slColor, 1);
          ctx.lineWidth = Math.max(2, Math.round(2 * vr));
          ctx.setLineDash([Math.round(6 * hr), Math.round(4 * hr)]);
          ctx.beginPath();
          ctx.moveTo(sx1, sy); ctx.lineTo(sx2, sy);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    });
  }
}

class HmbmPaneView {
  constructor(source) {
    this._source = source;
    this._renderer = new HmbmRenderer();
  }

  zOrder() { return 'top'; }   // au-dessus des bougies : les lignes doivent rester visibles

  update() {
    const { _chart: chart, _series: series, _zones: motifs, _opts: opts } = this._source;
    if (!chart || !series) { this._renderer.setData(null); return; }

    const ts = chart.timeScale();
    const items = [];

    for (const p of motifs) {
      const color = p.side === 'bull' ? opts.bullColor : opts.bearColor;
      const item  = { color, label: p.label };

      // Fin des niveaux (entrée / SL)
      const extendRight = p.levelEndTime == null;
      const lx2 = extendRight ? null : ts.timeToCoordinate(p.levelEndTime);
      const okEnd = extendRight || lx2 != null;

      // Niveau d'entrée
      const ex1 = ts.timeToCoordinate(p.entryTime);
      const ey  = series.priceToCoordinate(p.entryPrice);
      if (okEnd && ex1 != null && ey != null) {
        item.entry = { x1: ex1, x2: lx2, extendRight, y: ey };
      }

      // Stop loss
      const sx1 = ts.timeToCoordinate(p.slStartTime);
      const sy  = series.priceToCoordinate(p.sl);
      if (okEnd && sx1 != null && sy != null) {
        item.sl = { x1: sx1, x2: lx2, extendRight, y: sy };
      }

      items.push(item);
    }

    this._renderer.setData({
      items,
      opacity:   opts.opacity,
      showLabel: opts.showLabel,
      slColor:   opts.slColor,
    });
  }

  renderer() { return this._renderer; }
}

class HmbmPrimitive {
  constructor() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
    this._zones = [];
    this._opts = { bullColor: '#26A69A', bearColor: '#EF5350', slColor: '#B22222', opacity: 0.18, showLabel: true };
    this._paneViews = [new HmbmPaneView(this)];
  }

  attached({ chart, series, requestUpdate }) {
    this._chart = chart;
    this._series = series;
    this._requestUpdate = requestUpdate;
  }

  detached() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }

  update(zones, opts) {
    this._zones = zones ?? [];
    this._opts = { ...this._opts, ...opts };
    this._requestUpdate?.();
  }

  updateAllViews() {
    for (const v of this._paneViews) v.update();
  }

  paneViews() { return this._paneViews; }
}

export function createHmbmPrimitive() {
  return new HmbmPrimitive();
}
