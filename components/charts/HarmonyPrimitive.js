// Primitive de rendu pour l'indicateur TRENDER (Harmonie Multi-HTF).
//
// Deux couches que ni une série ligne ni un marqueur ne savent faire :
//   · le FOND coloré des zones d'harmonie — une bande verticale pleine hauteur,
//     l'équivalent du bgcolor() de Pine ;
//   · le trait « ≈ SL » — la base des Bollinger gelée à la détection, tracée à
//     l'horizontale sur toute la durée de la zone.
//
// Les triangles de début de zone et l'étiquette du HTF confirmateur, eux,
// passent par les marqueurs d'une série fantôme (cf. TradingChart) : c'est ce
// que fait déjà SWING, et ça évite de réimplémenter le placement du texte.
//
// Usage :
//   const p = createHarmonyPrimitive();
//   candleSeries.attachPrimitive(p);
//   p.update(zones, { bullColor, bearColor, bgTransp, showBg, showSlLn });

function rgba(hex, a) {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

class HarmonyRenderer {
  constructor() { this._d = null; }
  setData(d) { this._d = d; }

  draw(target) {
    const d = this._d;
    if (!d || !d.zones.length) return;

    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context;
      const hr  = scope.horizontalPixelRatio;
      const vr  = scope.verticalPixelRatio;
      const H   = scope.bitmapSize.height;
      const o   = d.opts;

      for (const z of d.zones) {
        const color = z.side === 'bull' ? o.bullColor : o.bearColor;
        const x1 = Math.round(z.x1 * hr);
        const x2 = Math.round(z.x2 * hr);
        const w  = Math.max(1, x2 - x1);

        // Fond pleine hauteur — bgcolor() de Pine. La transparence est donnée
        // dans la convention Pine (0 = opaque, 100 = invisible).
        if (o.showBg) {
          ctx.fillStyle = rgba(color, (100 - o.bgTransp) / 100);
          ctx.fillRect(x1, 0, w, H);
        }

        if (o.showSlLn && z.ySl != null) {
          const y = Math.round(z.ySl * vr);
          ctx.strokeStyle = o.slColor;
          ctx.lineWidth = Math.max(1, Math.round(2 * vr));
          ctx.beginPath();
          ctx.moveTo(x1, y + 0.5);
          ctx.lineTo(x2, y + 0.5);
          ctx.stroke();
        }
      }
    });
  }
}

class HarmonyPaneView {
  constructor(source) {
    this._source = source;
    this._renderer = new HarmonyRenderer();
  }

  zOrder() { return 'bottom'; } // derrière les bougies

  update() {
    const { _chart: chart, _series: series, _zones: zones, _opts: opts } = this._source;
    if (!chart || !series) { this._renderer.setData(null); return; }

    const ts   = chart.timeScale();
    // La zone couvre des bougies entières, pas des centres de bougie : on étend
    // d'une demi-bougie de chaque côté, sinon le fond s'arrête au milieu de la
    // première et de la dernière.
    const half = (ts.options().barSpacing ?? 6) / 2;

    const out = [];
    for (const z of zones) {
      const a = ts.timeToCoordinate(z.startTime);
      const b = ts.timeToCoordinate(z.endTime);
      if (a == null || b == null) continue;
      out.push({
        side: z.side,
        x1:   a - half,
        x2:   b + half,
        ySl:  z.slLevel != null ? series.priceToCoordinate(z.slLevel) : null,
      });
    }

    this._renderer.setData({ zones: out, opts });
  }

  renderer() { return this._renderer; }
}

class HarmonyPrimitive {
  constructor() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
    this._zones = [];
    this._opts = {
      bullColor: '#26A69A',
      bearColor: '#EF5350',
      slColor:   '#EF5350',
      bgTransp:  80,
      showBg:    true,
      showSlLn:  true,
    };
    this._paneViews = [new HarmonyPaneView(this)];
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

export function createHarmonyPrimitive() {
  return new HarmonyPrimitive();
}
