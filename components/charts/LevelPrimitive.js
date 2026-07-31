// Primitive de NIVEAUX : des bandes horizontales, à un prix, sur une plage de
// temps. Leur épaisseur est une hauteur de PRIX (top/bottom), pas un nombre de
// pixels — c'est ce qui permet au reste du code de s'en servir comme d'une vraie
// zone : on peut la mesurer, et demander si le prix y est revenu. Un trait en
// pixels serait resté un objet purement graphique.
//
// La hauteur affichée est CELLE DES PRIX, sans réglage qui viendrait la corriger :
// une bande de 2 points doit se lire comme 2 points, sinon elle ne sert plus à
// mesurer quoi que ce soit. Seul un plancher d'UN pixel subsiste, sans quoi une
// bande fine disparaîtrait purement et simplement au dézoom — ce n'est pas un
// réglage, c'est la limite de l'écran.
//
// Le trait est dessiné AU-DESSUS des bougies (zOrder 'top') : un niveau qu'on
// cherche à voir franchir n'a aucun intérêt caché derrière la mèche qui le
// franchit. C'est la différence de fond avec les zones, qui vivent au fond du
// graphe pour laisser les bougies lisibles.
//
// Usage :
//   const p = createLevelPrimitive();
//   candleSeries.attachPrimitive(p);
//   p.update(levels, { bullColor, bearColor, opacity, showLabel });
//   candleSeries.detachPrimitive(p);
//
// Chaque niveau : { side, top, bottom, startTime, endTime, label? }
//   side  'bull' | 'bear' — choisit la couleur, rien d'autre.
//   label facultatif, écrit juste au-dessus de la bande, à sa gauche.

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

class LevelRenderer {
  constructor() { this._data = null; }
  setData(data) { this._data = data; }

  draw(target) {
    const data = this._data;
    if (!data || !data.lines.length) return;

    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context;
      const hr  = scope.horizontalPixelRatio;
      const vr  = scope.verticalPixelRatio;
      const fullW = scope.bitmapSize.width;

      // Plancher d'un pixel écran : en deçà, il n'y a plus rien à peindre.
      const minH = Math.max(1, Math.round(vr));

      for (const l of data.lines) {
        const x1 = Math.round(l.x1 * hr);
        const x2 = l.extendRight ? fullW : Math.round(l.x2 * hr);
        if (x2 - x1 <= 0) continue;

        // La hauteur vient des PRIX, et rien ne la retouche tant qu'elle tient
        // dans au moins un pixel.
        const yTop = Math.round(l.yTop * vr);
        const yBot = Math.round(l.yBottom * vr);
        let h = yBot - yTop;
        let y = yTop;
        if (h < minH) { y = Math.round((yTop + yBot) / 2 - minH / 2); h = minH; }

        ctx.fillStyle = hexToRgba(l.color, data.opacity);
        ctx.fillRect(x1, y, x2 - x1, h);

        if (data.showLabel && l.label) {
          ctx.fillStyle = hexToRgba(l.color, Math.min(1, data.opacity + 0.25));
          ctx.font = `${Math.round(10 * vr)}px Inter, system-ui, sans-serif`;
          ctx.textBaseline = 'bottom';
          ctx.textAlign = 'left';
          ctx.fillText(l.label, Math.max(x1, 0) + Math.round(3 * hr), y - Math.round(2 * vr));
        }
      }
    });
  }
}

class LevelPaneView {
  constructor(source) {
    this._source = source;
    this._renderer = new LevelRenderer();
  }

  zOrder() { return 'top'; }

  update() {
    const { _chart: chart, _series: series, _levels: levels, _opts: opts } = this._source;
    if (!chart || !series) { this._renderer.setData(null); return; }

    const ts = chart.timeScale();
    const lines = [];

    for (const l of levels) {
      const x1   = ts.timeToCoordinate(l.startTime);
      const yTop = series.priceToCoordinate(l.top);
      const yBot = series.priceToCoordinate(l.bottom);
      if (x1 == null || yTop == null || yBot == null) continue;

      const extendRight = l.endTime == null;
      const x2 = extendRight ? null : ts.timeToCoordinate(l.endTime);
      if (!extendRight && x2 == null) continue;

      lines.push({
        x1, x2, extendRight, yTop, yBottom: yBot,
        color: l.side === 'bull' ? opts.bullColor : opts.bearColor,
        label: l.label,
      });
    }

    this._renderer.setData({
      lines,
      opacity:   opts.opacity,
      showLabel: opts.showLabel,
    });
  }

  renderer() { return this._renderer; }
}

class LevelPrimitive {
  constructor() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
    this._levels = [];
    this._opts = {
      bullColor: '#26A69A', bearColor: '#EF5350',
      opacity: 0.9, showLabel: true,
    };
    this._paneViews = [new LevelPaneView(this)];
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

  update(levels, opts) {
    this._levels = levels ?? [];
    this._opts = { ...this._opts, ...opts };
    this._requestUpdate?.();
  }

  updateAllViews() {
    for (const v of this._paneViews) v.update();
  }

  paneViews() { return this._paneViews; }
}

export function createLevelPrimitive() {
  return new LevelPrimitive();
}
