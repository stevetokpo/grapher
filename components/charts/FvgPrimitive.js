// Lightweight-charts series primitive that paints Fair Value Gap (FVG) and
// inverse FVG (iFVG) zones as translucent rectangles.
//
// Unlike the marker-based patterns (which ride on LWC line series), FVG zones
// are rectangles spanning both time and price. A series primitive recomputes
// its pixel coordinates on every chart redraw, so the boxes stay glued to the
// candles through pan / zoom with no manual redraw plumbing.
//
// Usage:
//   const p = createFvgPrimitive();
//   candleSeries.attachPrimitive(p);
//   p.update(zones, { bullColor, bearColor, opacity, showLabel, labelText });
//   candleSeries.detachPrimitive(p);
//
// Any gap family sharing the FVG zone shape ({ side, state, top, bottom,
// startTime, endTime }) can reuse it — the rFVG does, via labelText.
//
// A zone whose top and bottom are the SAME price is drawn as a thick coloured
// LINE instead of a box — there is nothing to fill. That is how a family offers
// a simplified view without a second primitive to maintain: the $$$ uses it to
// show the single edge its two boxes share. Thickness comes from the zone
// (`thickness`, default 3px).
//
// A zone may also carry an optional price level ({ swingTime, swingPrice }),
// drawn as an opaque WHITE line inside the box, from that bar to the box's
// right edge — a price to wait for, not another edge of the box, so it never
// takes the zone's colour. The xFVG uses it for the swing an "extra" pattern
// came back to; families that leave the field out draw exactly what they drew
// before.

const GREY  = '#64748B'; // mitigated / consumed gaps
const LEVEL = '#FFFFFF'; // optional price level inside a zone — opaque white, on purpose

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function zoneColor(zone, opts) {
  if (zone.state === 'mitigated') return GREY;
  return zone.side === 'bull' ? opts.bullColor : opts.bearColor;
}

// A zone may name itself (rFVG zones do — 'rFVG' or 'aFVG' depending on the mode);
// otherwise labelText names the family. An inverted gap gets the 'i' prefix.
function zoneLabel(zone, opts) {
  const base = zone.label ?? opts.labelText ?? 'FVG';
  if (zone.state === 'inverse')   return `i${base}`;
  if (zone.state === 'mitigated') return '';      // keep greyed gaps unlabelled (less noise)
  return base;
}

class FvgRenderer {
  constructor() { this._data = null; }
  setData(data) { this._data = data; }

  draw(target) {
    const data = this._data;
    if (!data || !data.rects.length) return;

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
        if (w <= 0) continue;

        // ZONE PLATE = UN TRAIT. Une bande dont les deux bords sont au même prix
        // n'a rien à remplir : elle se dessine comme un segment épais, dans la
        // couleur de la zone et à pleine opacité — un trait à 0,18 d'alpha ne se
        // verrait pas, alors qu'un aplat de 40 pixels à la même valeur, si.
        // C'est ce qui permet à un motif de proposer un affichage SIMPLIFIÉ
        // (le $$$ et son pivot) sans seconde primitive à entretenir.
        // Le cas couvre aussi les bandes si fines qu'elles s'arrondissent à zéro
        // pixel : elles disparaissaient en silence, elles se voient maintenant.
        if (h <= 0) {
          ctx.strokeStyle = hexToRgba(r.color, Math.min(1, data.opacity + 0.62));
          ctx.lineWidth = Math.max(1, Math.round((r.thickness ?? 3) * vr));
          ctx.beginPath();
          ctx.moveTo(x1, yTop + 0.5);
          ctx.lineTo(x2, yTop + 0.5);
          ctx.stroke();

          if (data.showLabel && r.label) {
            ctx.fillStyle = hexToRgba(r.color, 1);
            ctx.font = `${Math.round(10 * vr)}px Inter, system-ui, sans-serif`;
            ctx.textBaseline = 'bottom';
            ctx.fillText(r.label, x1 + Math.round(4 * hr), yTop - Math.round(3 * vr));
          }
          continue;
        }

        const baseAlpha = r.state === 'mitigated' ? data.opacity * 0.45 : data.opacity;

        ctx.fillStyle = hexToRgba(r.color, baseAlpha);
        ctx.fillRect(x1, yTop, w, h);

        // top / bottom borders
        ctx.strokeStyle = hexToRgba(r.color, Math.min(1, baseAlpha + 0.45));
        ctx.lineWidth = Math.max(1, Math.round(vr));
        if (r.state === 'inverse') ctx.setLineDash([Math.round(4 * hr), Math.round(3 * hr)]);
        ctx.beginPath();
        ctx.moveTo(x1, yTop + 0.5);    ctx.lineTo(x2, yTop + 0.5);
        ctx.moveTo(x1, yBottom - 0.5); ctx.lineTo(x2, yBottom - 0.5);
        ctx.stroke();
        ctx.setLineDash([]);

        // Le niveau, quand la zone en porte un : un trait plein, du pivot
        // jusqu'au bord droit de la boîte. Il part donc à gauche de la zone —
        // c'est justement ce qu'on veut voir, la structure d'avant que la zone
        // est venue reprendre.
        if (r.level) {
          const ly = Math.round(r.level.y * vr) + 0.5;
          if (ly > yTop && ly < yBottom) {
            // BLANC PLEIN, et pas la couleur de la zone : c'est un prix à
            // attendre, pas un bord de boîte. Il doit se détacher du remplissage
            // comme des bordures, quelle que soit la couleur du motif.
            ctx.strokeStyle = LEVEL;
            ctx.lineWidth = Math.max(1, Math.round(vr));
            ctx.beginPath();
            ctx.moveTo(Math.round(r.level.x * hr), ly);
            ctx.lineTo(x2, ly);
            ctx.stroke();
          }
        }

        if (data.showLabel && r.label && h > 14 * vr) {
          ctx.fillStyle = hexToRgba(r.color, Math.min(1, baseAlpha + 0.6));
          ctx.font = `${Math.round(10 * vr)}px Inter, system-ui, sans-serif`;
          ctx.textBaseline = 'top';
          ctx.textAlign = 'left';
          ctx.fillText(r.label, Math.max(x1, 0) + Math.round(3 * hr), yTop + Math.round(2 * vr));
        }
      }
    });
  }
}

class FvgPaneView {
  constructor(source) {
    this._source = source;
    this._renderer = new FvgRenderer();
  }

  zOrder() { return 'bottom'; } // behind the candles

  update() {
    const { _chart: chart, _series: series, _zones: zones, _opts: opts } = this._source;
    if (!chart || !series) { this._renderer.setData(null); return; }

    const ts = chart.timeScale();
    const rects = [];

    for (const z of zones) {
      const x1     = ts.timeToCoordinate(z.startTime);
      const yTop   = series.priceToCoordinate(z.top);
      const yBottom = series.priceToCoordinate(z.bottom);
      if (x1 == null || yTop == null || yBottom == null) continue;

      const extendRight = z.endTime == null;
      const x2 = extendRight ? null : ts.timeToCoordinate(z.endTime);
      if (!extendRight && x2 == null) continue;

      // Niveau optionnel tracé DANS la boîte, depuis la bougie qui l'a posé
      // jusqu'au bord droit de la zone. Le xFVG « extra » s'en sert pour montrer
      // le swing que l'impulsion a cassé et sur lequel la zone retombe. Une
      // famille qui ne pose pas swingPrice ne dessine rien de plus : le champ
      // est absent chez elle, et la boîte reste ce qu'elle était.
      let level = null;
      if (z.swingPrice != null && z.swingTime != null) {
        const lx = ts.timeToCoordinate(z.swingTime);
        const ly = series.priceToCoordinate(z.swingPrice);
        if (lx != null && ly != null) level = { x: lx, y: ly };
      }

      rects.push({
        x1, x2, extendRight,
        yTop, yBottom,
        color: zoneColor(z, opts),
        state: z.state,
        label: zoneLabel(z, opts),
        level,
        // Épaisseur du trait, quand la zone est plate. Ignorée sinon.
        thickness: z.thickness,
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

class FvgPrimitive {
  constructor() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
    this._zones = [];
    this._opts = { bullColor: '#26A69A', bearColor: '#EF5350', opacity: 0.18, showLabel: true, labelText: 'FVG' };
    this._paneViews = [new FvgPaneView(this)];
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

export function createFvgPrimitive() {
  return new FvgPrimitive();
}
