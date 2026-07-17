// Lightweight-charts series primitive for the EQ (Equilibrium Point) indicator.
//
// Draws, per balance zone:
//   · the value area as a translucent band, from the bar balance was recognised
//     to the bar it died on
//   · the equilibrium point as a solid line across that band
//   · the auction profile that produced the point, as a horizontal histogram
//     over the window it was built from — you see the shape, not just the level
//   · a break arrow where value was finally rejected
//
// and, per abandoned point, the naked POC: a dashed line running from the break
// until the market comes back and trades it again.
//
// A primitive recomputes its pixel coordinates on every chart redraw, so all of
// this stays glued to the candles through pan and zoom.
//
// Usage:
//   const p = createEquilibriumPrimitive();
//   candleSeries.attachPrimitive(p);
//   p.update({ zones, nakedPOCs }, { color, upColor, downColor, ... });
//   candleSeries.detachPrimitive(p);

const FONT = 'Inter, system-ui, sans-serif';

function rgba(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

class EqRenderer {
  constructor() { this._d = null; }
  setData(d) { this._d = d; }

  draw(target) {
    const d = this._d;
    if (!d) return;

    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context;
      const hr  = scope.horizontalPixelRatio;
      const vr  = scope.verticalPixelRatio;
      const W   = scope.bitmapSize.width;
      const o   = d.opts;

      for (const z of d.zones) {
        const x1 = Math.round(z.x1 * hr);
        const x2 = z.live ? W : Math.round(z.x2 * hr);
        const yH = Math.round(z.yVah * vr);
        const yL = Math.round(z.yVal * vr);
        const yP = Math.round(z.yPoc * vr);
        const w  = x2 - x1;
        const h  = yL - yH;
        if (w <= 0 || h <= 0) continue;

        // A dead balance is history: it fades, but it does not disappear —
        // the level it left behind is still where the market agreed on price.
        const live  = z.state === 'live';
        const alpha = live ? o.opacity : o.opacity * 0.5;
        const tint  = z.state === 'broken'
          ? (z.breakSide === 'up' ? o.upColor : o.downColor)
          : o.color;

        // ── Value area band ──────────────────────────────────────────────────
        ctx.fillStyle = rgba(tint, alpha);
        ctx.fillRect(x1, yH, w, h);

        ctx.strokeStyle = rgba(tint, Math.min(1, alpha + 0.35));
        ctx.lineWidth = Math.max(1, Math.round(vr));
        ctx.setLineDash([Math.round(3 * hr), Math.round(3 * hr)]);
        ctx.beginPath();
        ctx.moveTo(x1, yH + 0.5); ctx.lineTo(x2, yH + 0.5);
        ctx.moveTo(x1, yL - 0.5); ctx.lineTo(x2, yL - 0.5);
        ctx.stroke();
        ctx.setLineDash([]);

        // ── The equilibrium point ────────────────────────────────────────────
        ctx.strokeStyle = rgba(tint, live ? 0.95 : 0.6);
        ctx.lineWidth = Math.max(1, Math.round(1.6 * vr));
        ctx.beginPath();
        ctx.moveTo(x1, yP);
        ctx.lineTo(x2, yP);
        ctx.stroke();

        // ── The auction that built it ────────────────────────────────────────
        // Histogram grows right from the left edge of the formation window,
        // capped so it never runs past the bar where balance was recognised.
        if (o.showProfile && z.prof && z.px1 != null) {
          const px1 = Math.round(z.px1 * hr);
          const maxW = Math.max(0, x1 - px1);
          if (maxW > 6 * hr) {
            const rows = z.prof.rows;
            const n    = rows.length;
            const yTop = z.prof.yTop * vr;
            const yBot = z.prof.yBot * vr;
            const rowH = (yBot - yTop) / n;

            ctx.fillStyle = rgba(tint, live ? 0.30 : 0.16);
            for (let k = 0; k < n; k++) {
              const bw = rows[k] * maxW;
              if (bw < 1) continue;
              // rows[0] is the lowest price → bottom of the band
              const y = yBot - (k + 1) * rowH;
              ctx.fillRect(px1, y, bw, Math.max(1, rowH - 0.5 * vr));
            }
          }
        }

        // ── Label ────────────────────────────────────────────────────────────
        if (o.showLabel && h > 13 * vr) {
          const txt = `EQ ${Math.round(z.score)}${live ? '' : z.breakSide === 'up' ? ' ↑' : z.breakSide === 'down' ? ' ↓' : ''}`;
          ctx.font = `600 ${Math.round(10 * vr)}px ${FONT}`;
          ctx.textBaseline = 'top';
          ctx.textAlign = 'left';
          ctx.fillStyle = rgba(tint, 0.95);
          ctx.fillText(txt, x1 + Math.round(4 * hr), yH + Math.round(3 * vr));
        }

        // ── Break arrow ──────────────────────────────────────────────────────
        if (o.showBreak && z.state === 'broken' && z.xBreak != null) {
          const up = z.breakSide === 'up';
          const bx = Math.round(z.xBreak * hr);
          const by = up ? yH - Math.round(9 * vr) : yL + Math.round(9 * vr);
          const s  = Math.round(5 * vr);
          ctx.fillStyle = rgba(tint, 0.95);
          ctx.beginPath();
          if (up) { ctx.moveTo(bx, by - s); ctx.lineTo(bx + s, by + s); ctx.lineTo(bx - s, by + s); }
          else    { ctx.moveTo(bx, by + s); ctx.lineTo(bx + s, by - s); ctx.lineTo(bx - s, by - s); }
          ctx.closePath();
          ctx.fill();
        }
      }

      // ── Naked POCs: prices the market agreed on, then walked away from ─────
      if (o.showNaked) {
        for (const k of d.naked) {
          const x1 = Math.round(k.x1 * hr);
          const x2 = k.open ? W : Math.round(k.x2 * hr);
          const y  = Math.round(k.y * vr);
          if (x2 - x1 <= 0) continue;

          ctx.strokeStyle = rgba(o.nakedColor, k.open ? 0.75 : 0.3);
          ctx.lineWidth = Math.max(1, Math.round(vr));
          ctx.setLineDash([Math.round(2 * hr), Math.round(4 * hr)]);
          ctx.beginPath();
          ctx.moveTo(x1, y + 0.5);
          ctx.lineTo(x2, y + 0.5);
          ctx.stroke();
          ctx.setLineDash([]);

          if (o.showLabel && k.open) {
            ctx.font = `${Math.round(9 * vr)}px ${FONT}`;
            ctx.textBaseline = 'bottom';
            ctx.textAlign = 'right';
            ctx.fillStyle = rgba(o.nakedColor, 0.8);
            ctx.fillText('nPOC', x2 - Math.round(4 * hr), y - Math.round(2 * vr));
          }
        }
      }
    });
  }
}

class EqPaneView {
  constructor(source) {
    this._source = source;
    this._renderer = new EqRenderer();
  }

  zOrder() { return 'bottom'; } // behind the candles

  update() {
    const { _chart: chart, _series: series, _data: data, _opts: opts } = this._source;
    if (!chart || !series || !data) { this._renderer.setData(null); return; }

    const ts = chart.timeScale();
    const zones = [];

    for (const z of data.zones) {
      // The band runs from the bar balance was recognised — not from the start
      // of the window that formed it, which would overlap the zone before.
      const x1   = ts.timeToCoordinate(z.anchorTime);
      const x2   = ts.timeToCoordinate(z.endTime);
      const yPoc = series.priceToCoordinate(z.poc);
      const yVal = series.priceToCoordinate(z.val);
      const yVah = series.priceToCoordinate(z.vah);
      if (x1 == null || yPoc == null || yVal == null || yVah == null) continue;

      const live = z.state === 'live';
      if (!live && x2 == null) continue;

      // Profile geometry: the histogram spans the price grid the profile was
      // computed on, and lives in the window that produced it.
      let prof = null, px1 = null;
      if (opts.showProfile && z.profile) {
        const yTop = series.priceToCoordinate(z.profHi);
        const yBot = series.priceToCoordinate(z.profLo);
        px1 = ts.timeToCoordinate(z.startTime);
        if (yTop != null && yBot != null && px1 != null) prof = { rows: z.profile, yTop, yBot };
        else px1 = null;
      }

      zones.push({
        x1, x2, live, px1, prof,
        yPoc, yVal, yVah,
        state: z.state,
        breakSide: z.breakSide,
        score: z.score,
        xBreak: z.breakTime != null ? ts.timeToCoordinate(z.breakTime) : null,
      });
    }

    const naked = [];
    for (const k of data.nakedPOCs) {
      const x1 = ts.timeToCoordinate(k.startTime);
      const y  = series.priceToCoordinate(k.price);
      if (x1 == null || y == null) continue;
      const open = k.endTime == null;
      const x2 = open ? null : ts.timeToCoordinate(k.endTime);
      if (!open && x2 == null) continue;
      naked.push({ x1, x2, y, open });
    }

    this._renderer.setData({ zones, naked, opts });
  }

  renderer() { return this._renderer; }
}

class EquilibriumPrimitive {
  constructor() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
    this._data = null;
    this._opts = {
      color:      '#A78BFA',
      upColor:    '#26A69A',
      downColor:  '#EF5350',
      nakedColor: '#94A3B8',
      opacity:     0.14,
      showProfile: true,
      showNaked:   true,
      showBreak:   true,
      showLabel:   true,
    };
    this._paneViews = [new EqPaneView(this)];
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

  update(data, opts) {
    this._data = data ?? null;
    this._opts = { ...this._opts, ...opts };
    this._requestUpdate?.();
  }

  updateAllViews() {
    for (const v of this._paneViews) v.update();
  }

  paneViews() { return this._paneViews; }
}

export function createEquilibriumPrimitive() {
  return new EquilibriumPrimitive();
}
