// Primitive de rendu de l'indicateur RANGE (intervalle d'une période).
//
// Une boîte par créneau : [plus bas, plus haut] du créneau, du premier au
// dernier chandelier qu'il contient. Trois détails que ni une série ni un
// marqueur ne savent faire :
//   · le CADRE D'ESQUIVE (zone.marked === false) — l'intervalle du créneau qu'on
//     ne marquait pas, en pointillés et dans sa propre couleur, jamais celle du
//     marquage : les deux moitiés du cycle se lisent d'un coup d'œil ;
//   · la PROLONGATION d'une fenêtre marquée sur l'esquive — même intervalle,
//     remplissage affaibli, pour qu'on voie où le marquage s'arrête ;
//   · le trait MÉDIAN à 50 % de l'intervalle marqué, tracé sur toute la largeur.
//
// La zone en cours (celle qui contient la dernière bougie chargée) a des
// bordures pointillées : son intervalle peut encore grandir.
//
// Usage :
//   const p = createRangeZonePrimitive();
//   candleSeries.attachPrimitive(p);
//   p.update(zones, { color, bullColor, bearColor, skipColor, dirColor, opacity, showMid, showLabel });

function rgba(hex, a) {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

class RangeZoneRenderer {
  constructor() { this._d = null; }
  setData(d) { this._d = d; }

  draw(target) {
    const d = this._d;
    if (!d || !d.rects.length) return;

    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context;
      const hr  = scope.horizontalPixelRatio;
      const vr  = scope.verticalPixelRatio;
      const o   = d.opts;
      const lw  = Math.max(1, Math.round(vr));
      const dash = [Math.round(4 * hr), Math.round(3 * hr)];

      for (const r of d.rects) {
        const x1 = Math.round(r.x1 * hr);
        const x2 = Math.round(r.x2 * hr);
        const xE = r.xExt != null ? Math.round(r.xExt * hr) : null;
        const yT = Math.round(r.yTop * vr);
        const yB = Math.round(r.yBottom * vr);
        const w  = x2 - x1;
        const h  = yB - yT;
        if (w <= 0) continue;

        // Corps de la zone. Une fenêtre peut n'avoir qu'un seul prix (h == 0) :
        // le remplissage disparaît alors, mais les bordures restent lisibles.
        // Le cadre d'esquive est volontairement plus discret que le marquage :
        // c'est un repère de contexte, pas la zone qu'on suit.
        const fill = r.marked ? o.opacity : o.opacity * 0.35;
        if (fill > 0 && h > 0) {
          ctx.fillStyle = rgba(r.color, fill);
          ctx.fillRect(x1, yT, w, h);
        }

        // Prolongation sur l'esquive : mêmes bords, remplissage affaibli.
        if (xE != null && xE > x2) {
          if (o.opacity > 0 && h > 0) {
            ctx.fillStyle = rgba(r.color, o.opacity * 0.4);
            ctx.fillRect(x2, yT, xE - x2, h);
          }
          ctx.strokeStyle = rgba(r.color, 0.55);
          ctx.lineWidth = lw;
          ctx.setLineDash(dash);
          ctx.beginPath();
          ctx.moveTo(x2, yT + 0.5); ctx.lineTo(xE, yT + 0.5);
          ctx.moveTo(x2, yB - 0.5); ctx.lineTo(xE, yB - 0.5);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        const right = xE != null && xE > x2 ? xE : x2;

        // Trait médian, sur la boîte ET sa prolongation. Réservé au marquage :
        // sur l'esquive il doublerait le bruit sans rien ajouter.
        if (o.showMid && r.marked) {
          const yM = Math.round(r.yMid * vr) + 0.5;
          ctx.strokeStyle = rgba(r.color, 0.5);
          ctx.lineWidth = lw;
          ctx.setLineDash([Math.round(2 * hr), Math.round(4 * hr)]);
          ctx.beginPath();
          ctx.moveTo(x1, yM); ctx.lineTo(right, yM);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Bordures. Pointillées pour un cadre d'esquive, et pour toute zone
        // encore en cours — dans les deux cas la boîte n'est pas « acquise ».
        ctx.strokeStyle = rgba(r.color, r.marked ? 0.9 : 0.7);
        ctx.lineWidth = lw;
        if (r.live || !r.marked) ctx.setLineDash(dash);
        ctx.beginPath();
        ctx.moveTo(x1, yT + 0.5); ctx.lineTo(x2, yT + 0.5);
        ctx.moveTo(x1, yB - 0.5); ctx.lineTo(x2, yB - 0.5);
        ctx.moveTo(x1 + 0.5, yT); ctx.lineTo(x1 + 0.5, yB);
        ctx.moveTo(x2 - 0.5, yT); ctx.lineTo(x2 - 0.5, yB);
        ctx.stroke();
        ctx.setLineDash([]);

        // Étiquette sur les seules fenêtres marquées : sur un cycle encadré des
        // deux côtés, la doubler sur l'esquive rendrait la bande de texte
        // illisible, et l'heure de l'esquive se déduit de celle du marquage.
        if (o.showLabel && r.marked && r.label && w > 34 * hr) {
          ctx.fillStyle = rgba(r.color, 1);
          ctx.font = `${Math.round(10 * vr)}px Inter, system-ui, sans-serif`;
          ctx.textBaseline = 'bottom';
          ctx.textAlign = 'left';
          ctx.fillText(r.label, x1 + Math.round(3 * hr), yT - Math.round(3 * vr));
        }
      }
    });
  }
}

class RangeZonePaneView {
  constructor(source) {
    this._source = source;
    this._renderer = new RangeZoneRenderer();
  }

  zOrder() { return 'bottom'; } // derrière les bougies

  update() {
    const { _chart: chart, _series: series, _zones: zones, _opts: opts } = this._source;
    if (!chart || !series) { this._renderer.setData(null); return; }

    const ts = chart.timeScale();
    // La boîte couvre des bougies ENTIÈRES : sans la demi-bougie de marge, elle
    // s'arrêterait au centre de la première et de la dernière.
    const half = (ts.options().barSpacing ?? 6) / 2;

    const rects = [];
    for (const z of zones) {
      const a  = ts.timeToCoordinate(z.startTime);
      const b  = ts.timeToCoordinate(z.endTime);
      const yT = series.priceToCoordinate(z.top);
      const yB = series.priceToCoordinate(z.bottom);
      if (a == null || b == null || yT == null || yB == null) continue;

      const e = z.extendTime != null ? ts.timeToCoordinate(z.extendTime) : null;

      // L'esquive ne prend JAMAIS la couleur du marquage — ni la couleur fixe,
      // ni celle du sens : elle n'est pas la zone qu'on suit, et les confondre
      // d'un coup d'œil serait tout perdre du découpage.
      const color = !z.marked
        ? opts.skipColor
        : opts.dirColor ? (z.side === 'bull' ? opts.bullColor : opts.bearColor) : opts.color;

      rects.push({
        x1: a - half,
        x2: b + half,
        xExt: e != null ? e + half : null,
        yTop: yT, yBottom: yB,
        yMid: series.priceToCoordinate(z.mid) ?? (yT + yB) / 2,
        color,
        marked: z.marked !== false,
        live:  z.live,
        label: z.label,
      });
    }

    this._renderer.setData({ rects, opts });
  }

  renderer() { return this._renderer; }
}

class RangeZonePrimitive {
  constructor() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
    this._zones = [];
    this._opts = {
      color:     '#60A5FA',
      bullColor: '#26A69A',
      bearColor: '#EF5350',
      skipColor: '#94A3B8',
      dirColor:  false,
      opacity:   0.12,
      showMid:   true,
      showLabel: true,
    };
    this._paneViews = [new RangeZonePaneView(this)];
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

export function createRangeZonePrimitive() {
  return new RangeZonePrimitive();
}
