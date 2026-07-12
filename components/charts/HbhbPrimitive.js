// Lightweight-charts series primitive for HBHB / BHBH 4-candle pattern zones.
// Each zone is the high–low range of the pattern's 2nd candle, drawn as a
// translucent rectangle (teal = HBHB / red = BHBH). Same architecture as
// HbhPrimitive — recomputes pixel coords on every chart redraw via paneViews.
//
// Usage:
//   const p = createHbhbPrimitive();
//   candleSeries.attachPrimitive(p);
//   p.update(zones, { bullColor, bearColor, opacity, showLabel });
//   candleSeries.detachPrimitive(p);

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

class HbhbRenderer {
  constructor() { this._data = null; }
  setData(data) { this._data = data; }

  draw(target) {
    const data = this._data;
    if (!data || !data.rects.length) return;

    target.useBitmapCoordinateSpace(scope => {
      const ctx   = scope.context;
      const hr    = scope.horizontalPixelRatio;
      const vr    = scope.verticalPixelRatio;
      const fullW = scope.bitmapSize.width;

      for (const r of data.rects) {
        const x1      = Math.round(r.x1 * hr);
        const x2      = r.extendRight ? fullW : Math.round(r.x2 * hr);
        const yTop    = Math.round(r.yTop * vr);
        const yBottom = Math.round(r.yBottom * vr);
        const w = x2 - x1;
        const h = yBottom - yTop;
        if (w <= 0 || h <= 0) continue;

        ctx.fillStyle = hexToRgba(r.color, data.opacity);
        ctx.fillRect(x1, yTop, w, h);

        // top / bottom borders
        ctx.strokeStyle = hexToRgba(r.color, Math.min(1, data.opacity + 0.45));
        ctx.lineWidth = Math.max(1, Math.round(vr));
        ctx.beginPath();
        ctx.moveTo(x1, yTop + 0.5);    ctx.lineTo(x2, yTop + 0.5);
        ctx.moveTo(x1, yBottom - 0.5); ctx.lineTo(x2, yBottom - 0.5);
        ctx.stroke();

        if (data.showLabel && r.label && h > 14 * vr) {
          ctx.fillStyle = hexToRgba(r.color, Math.min(1, data.opacity + 0.6));
          ctx.font = `${Math.round(10 * vr)}px Inter, system-ui, sans-serif`;
          ctx.textBaseline = 'top';
          ctx.textAlign = 'left';
          ctx.fillText(r.label, Math.max(x1, 0) + Math.round(3 * hr), yTop + Math.round(2 * vr));
        }
      }
    });
  }
}

class HbhbPaneView {
  constructor(source) {
    this._source   = source;
    this._renderer = new HbhbRenderer();
  }

  zOrder() { return 'bottom'; }

  update() {
    const { _chart: chart, _series: series, _zones: zones, _opts: opts } = this._source;
    if (!chart || !series) { this._renderer.setData(null); return; }

    const ts    = chart.timeScale();
    const rects = [];

    for (const z of zones) {
      const x1      = ts.timeToCoordinate(z.startTime);
      const yTop    = series.priceToCoordinate(z.top);
      const yBottom = series.priceToCoordinate(z.bottom);
      if (x1 == null || yTop == null || yBottom == null) continue;

      const extendRight = z.endTime == null;
      const x2 = extendRight ? null : ts.timeToCoordinate(z.endTime);
      if (!extendRight && x2 == null) continue;

      rects.push({
        x1, x2, extendRight,
        yTop, yBottom,
        color: z.side === 'bull' ? opts.bullColor : opts.bearColor,
        label: z.side === 'bull' ? 'HBHB' : 'BHBH',
      });
    }

    this._renderer.setData({
      rects,
      opacity:   opts.opacity,
      showLabel: opts.showLabel,
    });
  }

  renderer() { return this._renderer; }
}

class HbhbPrimitive {
  constructor() {
    this._chart         = null;
    this._series        = null;
    this._requestUpdate = null;
    this._zones         = [];
    this._opts          = { bullColor: '#26A69A', bearColor: '#EF5350', opacity: 0.18, showLabel: true };
    this._paneViews     = [new HbhbPaneView(this)];
  }

  attached({ chart, series, requestUpdate }) {
    this._chart         = chart;
    this._series        = series;
    this._requestUpdate = requestUpdate;
  }

  detached() {
    this._chart         = null;
    this._series        = null;
    this._requestUpdate = null;
  }

  update(zones, opts) {
    this._zones = zones ?? [];
    this._opts  = { ...this._opts, ...opts };
    this._requestUpdate?.();
  }

  updateAllViews() {
    for (const v of this._paneViews) v.update();
  }

  paneViews() { return this._paneViews; }
}

export function createHbhbPrimitive() {
  return new HbhbPrimitive();
}
