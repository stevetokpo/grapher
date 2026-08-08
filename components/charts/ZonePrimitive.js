// Primitive des zones de support et de résistance du ticker : des rectangles.
//
// Dessinée AU FOND ('bottom') : une zone est un décor de lecture, elle ne doit
// jamais masquer la bougie qui la traverse — or c'est précisément cette
// traversée qu'on regarde.
//
// Usage :
//   const p = createZonePrimitive();
//   series.attachPrimitive(p);
//   p.update(zones, { selectedId, draft, supportColor, resistanceColor, opacity });
//   series.detachPrimitive(p);
//
// Chaque zone : { id, top, bottom, kind, x1, x2, color?, dashed?, label? }
//   color    couleur imposée ; à défaut, celle du `kind` (support / résistance).
//   dashed   cadre en pointillés — sert aux motifs DÉTECTÉS, qu'on ne doit pas
//            confondre d'un coup d'œil avec les zones tracées à la main.
//   x1 / x2  bornes dans l'ABSCISSE DU GRAPHE (rang en mode tick, secondes
//            epoch sinon), déjà traduites depuis les millisecondes par
//            TickerChart — la primitive ne connaît pas les modes.
//            `null` = borne hors des données chargées : le rectangle court
//            jusqu'au bord de la vue plutôt que de disparaître.
//   Une zone sans x1 ni x2 traverse toute la largeur.

function rgba(hex, a) {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

class ZoneRenderer {
  constructor() { this._d = null; }
  setData(d) { this._d = d; }

  draw(target) {
    const d = this._d;
    if (!d || !d.bands.length) return;

    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context;
      const hr  = scope.horizontalPixelRatio;
      const vr  = scope.verticalPixelRatio;
      const W   = scope.bitmapSize.width;
      const lw  = Math.max(1, Math.round(vr));

      for (const b of d.bands) {
        const x1 = b.x1 == null ? 0 : Math.round(b.x1 * hr);
        const x2 = b.x2 == null ? W : Math.round(b.x2 * hr);
        // Un rectangle entièrement hors de la vue n'a rien à peindre, mais un
        // rectangle écrasé à zéro pixel de large en garde le droit : c'est un
        // repère, il doit rester saisissable.
        const w = Math.max(x2 - x1, 1);
        if (x2 < 0 || x1 > W) continue;

        let yT = Math.round(b.yTop * vr);
        let yB = Math.round(b.yBottom * vr);
        // Une bande écrasée par le dézoom doit rester visible : sous un pixel,
        // il n'y a plus rien à peindre, et le repère disparaîtrait sans que
        // rien ne l'ait effacé.
        if (yB - yT < lw) {
          const mid = (yT + yB) / 2;
          yT = Math.round(mid - lw / 2);
          yB = yT + lw;
        }

        ctx.fillStyle = rgba(b.color, b.draft ? d.opacity * 0.7 : d.opacity);
        ctx.fillRect(x1, yT, w, yB - yT);

        // Les deux bords portent le prix exact de la zone : c'est là que se
        // joue la cassure, le remplissage n'est qu'une aide à la lecture.
        // Le CADRE complet, pas seulement les deux horizontales : c'est ce qui
        // fait lire un rectangle délimité plutôt qu'une bande sans fin.
        ctx.strokeStyle = rgba(b.color, b.selected ? 0.95 : 0.65);
        ctx.lineWidth   = b.selected ? lw * 2 : lw;
        ctx.setLineDash(b.draft || b.dashed ? [Math.round(5 * hr), Math.round(4 * hr)] : []);
        const half = ctx.lineWidth / 2;
        ctx.strokeRect(x1 + half, yT + half, w - ctx.lineWidth, (yB - yT) - ctx.lineWidth);
        ctx.setLineDash([]);

        // L'étiquette ne s'écrit que si la boîte a de quoi la porter. Forcée
        // dans un rectangle trop petit, elle déborde sur ses voisines et
        // transforme une lecture en bouillie — c'est exactement ce qui arrive
        // quand plusieurs motifs se recouvrent.
        if (b.label && (yB - yT) >= Math.round(15 * vr) && w >= Math.round(46 * hr)) {
          const pad = Math.round(6 * hr) + x1;
          ctx.font = `${Math.round(10 * vr)}px 'JetBrains Mono', ui-monospace, monospace`;
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'left';
          const tw = ctx.measureText(b.label).width;
          const ly = (yT + yB) / 2;
          ctx.fillStyle = rgba(b.color, 0.16);
          ctx.fillRect(pad, ly - Math.round(8 * vr), tw + Math.round(12 * hr), Math.round(16 * vr));
          ctx.fillStyle = rgba(b.color, 0.95);
          ctx.fillText(b.label, pad + Math.round(6 * hr), ly);
        }
      }
    });
  }
}

class ZonePaneView {
  constructor(source) {
    this._source = source;
    this._renderer = new ZoneRenderer();
  }

  zOrder() { return 'bottom'; }

  update() {
    const { _series: series, _zones: zones, _opts: opts } = this._source;
    if (!series) { this._renderer.setData(null); return; }

    const ts = this._source._chart?.timeScale();

    const bands = [];
    const push = (z, draft) => {
      const yT = series.priceToCoordinate(z.top);
      const yB = series.priceToCoordinate(z.bottom);
      if (yT == null || yB == null) return;
      // x1/x2 sont des abscisses de graphe ; null (ou pas de timeScale) veut
      // dire « jusqu'au bord », ce que le rendu traduit en 0 ou en largeur.
      const cx = v => (v == null || !ts ? null : ts.timeToCoordinate(v));
      bands.push({
        x1: cx(z.x1),
        x2: cx(z.x2),
        yTop: Math.min(yT, yB),
        yBottom: Math.max(yT, yB),
        color: z.color ?? (z.kind === 'resistance' ? opts.resistanceColor : opts.supportColor),
        dashed: !!z.dashed,
        selected: !draft && z.id === opts.selectedId,
        draft,
        label: draft ? null : z.label,
      });
    };

    for (const z of zones) push(z, false);
    if (opts.draft) push(opts.draft, true);

    this._renderer.setData({ bands, opacity: opts.opacity });
  }

  renderer() { return this._renderer; }
}

class ZonePrimitive {
  constructor() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
    this._zones = [];
    this._opts = {
      supportColor:    '#26A69A',
      resistanceColor: '#EF5350',
      opacity:         0.13,
      selectedId:      null,
      draft:           null,
    };
    this._paneViews = [new ZonePaneView(this)];
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

export function createZonePrimitive() {
  return new ZonePrimitive();
}
