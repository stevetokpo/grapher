// Lightweight-charts series primitive that paints compression / squeeze zones
// (TTM Squeeze, see calcCompression in lib/patterns.js) as translucent boxes,
// plus a breakout arrow at the candle that closed through the box.
//
// Like FvgPrimitive, it recomputes its pixel coordinates on every chart redraw,
// so boxes and arrows stay glued to the candles through pan / zoom.
//
// Usage:
//   const p = createCompressionPrimitive();
//   candleSeries.attachPrimitive(p);
//   p.update(zones, { upColor, downColor, neutralColor, opacity, showLabel, showArrow });
//   candleSeries.detachPrimitive(p);

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function zoneColor(zone, opts) {
  if (zone.state !== 'fired') return opts.neutralColor;
  return zone.side === 'up' ? opts.upColor : opts.downColor;
}

class CompressionRenderer {
  constructor() { this._data = null; }
  setData(data) { this._data = data; }

  draw(target) {
    const data = this._data;
    if (!data) return;

    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context;
      const hr  = scope.horizontalPixelRatio;
      const vr  = scope.verticalPixelRatio;
      const fullW = scope.bitmapSize.width;

      for (const r of data.rects) {
        const x1 = Math.round(r.x1 * hr);
        const x2 = r.extendRight ? fullW : Math.round(r.x2 * hr);
        const yTop    = Math.round(r.yTop * vr);
        const yBottom = Math.round(r.yBottom * vr);
        const w = x2 - x1;
        const h = yBottom - yTop;
        if (w <= 0 || h <= 0) continue;

        const alpha = r.state === 'forming' ? data.opacity * 0.7 : data.opacity;

        ctx.fillStyle = hexToRgba(r.color, alpha);
        ctx.fillRect(x1, yTop, w, h);

        // top / bottom borders — dashed while still forming.
        ctx.strokeStyle = hexToRgba(r.color, Math.min(1, alpha + 0.45));
        ctx.lineWidth = Math.max(1, Math.round(vr));
        if (r.state === 'forming') ctx.setLineDash([Math.round(4 * hr), Math.round(3 * hr)]);
        ctx.beginPath();
        ctx.moveTo(x1, yTop + 0.5);    ctx.lineTo(x2, yTop + 0.5);
        ctx.moveTo(x1, yBottom - 0.5); ctx.lineTo(x2, yBottom - 0.5);
        ctx.stroke();
        ctx.setLineDash([]);

        if (data.showLabel && h > 14 * vr) {
          ctx.fillStyle = hexToRgba(r.color, Math.min(1, alpha + 0.6));
          ctx.font = `${Math.round(10 * vr)}px Inter, system-ui, sans-serif`;
          ctx.textBaseline = 'top';
          ctx.textAlign = 'left';
          ctx.fillText('SQZ', Math.max(x1, 0) + Math.round(3 * hr), yTop + Math.round(2 * vr));
        }
      }

      // Breakout arrows — drawn on top of the boxes.
      if (data.showArrow) {
        for (const a of data.arrows) {
          const x = Math.round(a.x * hr);
          const y = Math.round(a.y * vr);
          const s = Math.round(6 * vr);       // half-width / height of the triangle
          const dir = a.side === 'up' ? -1 : 1; // up breakout points up (negative y)
          const tipY = y + dir * (s + Math.round(3 * vr));

          ctx.fillStyle = a.color;
          ctx.beginPath();
          ctx.moveTo(x, tipY);                       // tip
          ctx.lineTo(x - s, tipY - dir * s * 1.6);   // base corners
          ctx.lineTo(x + s, tipY - dir * s * 1.6);
          ctx.closePath();
          ctx.fill();
        }
      }
    });
  }
}

class CompressionPaneView {
  constructor(source) {
    this._source = source;
    this._renderer = new CompressionRenderer();
  }

  zOrder() { return 'bottom'; } // behind the candles

  update() {
    const { _chart: chart, _series: series, _zones: zones, _opts: opts } = this._source;
    if (!chart || !series) { this._renderer.setData(null); return; }

    const ts = chart.timeScale();
    const rects = [];
    const arrows = [];

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
        color: zoneColor(z, opts),
        state: z.state,
      });

      if (z.state === 'fired' && z.breakTime != null) {
        const ax = ts.timeToCoordinate(z.breakTime);
        // anchor the arrow just past the broken edge of the box
        const ay = series.priceToCoordinate(z.side === 'up' ? z.top : z.bottom);
        if (ax != null && ay != null) {
          arrows.push({ x: ax, y: ay, side: z.side, color: zoneColor(z, opts) });
        }
      }
    }

    this._renderer.setData({
      rects, arrows,
      opacity:   opts.opacity,
      showLabel: opts.showLabel,
      showArrow: opts.showArrow,
    });
  }

  renderer() { return this._renderer; }
}

class CompressionPrimitive {
  constructor() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
    this._zones = [];
    this._opts = {
      upColor: '#26A69A', downColor: '#EF5350', neutralColor: '#64748B',
      opacity: 0.18, showLabel: true, showArrow: true,
    };
    this._paneViews = [new CompressionPaneView(this)];
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

export function createCompressionPrimitive() {
  return new CompressionPrimitive();
}
