// LE KUMO — la surface entre les deux Senkou de l'Ichimoku.
//
// Les cinq LIGNES de l'indicateur sont des séries lightweight-charts ordinaires
// (étiquette de prix, marqueur de curseur, tout est gratuit). Ce que la
// bibliothèque ne sait pas faire, et la seule raison d'être de ce fichier :
// REMPLIR entre deux courbes, avec une couleur qui suit le SIGNE de leur écart.
//
// LE CROISEMENT EST L'ÉVÉNEMENT. Le kumo change de camp quand Senkou A passe
// sous Senkou B — et ce basculement tombe presque toujours au MILIEU d'une
// bougie, pas sur son bord. Le remplissage est donc découpé à l'intersection
// exacte des deux segments : le nuage se pince en pointe et repart de l'autre
// couleur au bon endroit. Colorier bougie par bougie donnerait un escalier
// mensonger de la largeur d'une bougie.
//
// CE QUI EST DESSINÉ : un aplat translucide, et rien d'autre. Le nuage est un
// FOND — un dégradé, une lueur ou une striation lui donneraient un poids visuel
// qu'il ne doit pas avoir : c'est son ÉPAISSEUR qui porte l'information, et
// elle ne se lit que sur une surface uniforme. Les bords, eux, sont déjà tracés
// par les deux séries Senkou.
//
// PERFORMANCE : la conversion temps → pixel ne porte que sur la plage visible
// (plus un point de marge de chaque côté, sinon le remplissage s'arrêterait au
// bord de l'écran), et les segments de même couleur sont peints en UN seul
// tracé. Un graphe de cent mille bougies coûte donc ce que coûte l'écran.
//
// CONTRAT D'UN POINT DE NUAGE : { time, a, b } — a = Senkou A, b = Senkou B,
// l'horodatage étant DÉJÀ décalé vers le futur par lib/ichimoku.js.

function rgba(hex, a) {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

class KumoRenderer {
  constructor() { this._d = null; }
  setData(d) { this._d = d; }

  draw(target) {
    const d = this._d;
    if (!d || d.pts.length < 2) return;

    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context;
      const hr  = scope.horizontalPixelRatio;
      const vr  = scope.verticalPixelRatio;
      const pts = d.pts;

      // Sens du nuage en un point. L'écran a son axe vers le bas : Senkou A
      // au-dessus de Senkou B, c'est ya < yb. L'égalité stricte ne tranche
      // rien — on prolonge le sens courant plutôt que d'ouvrir un tronçon vide.
      const sens = (p, prev) => (p.ya === p.yb ? prev : (p.ya < p.yb ? 'bull' : 'bear'));

      let cur = sens(pts[0], 'bull');
      let haut = [[pts[0].x, pts[0].ya]];
      let bas  = [[pts[0].x, pts[0].yb]];
      const tronçons = [];

      for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1];
        const q = pts[i];
        const s = sens(q, cur);

        if (s !== cur) {
          // L'intersection exacte des deux segments : là où l'écart s'annule.
          const d0 = p.ya - p.yb;
          const d1 = q.ya - q.yb;
          const t  = d0 / (d0 - d1);
          const xc = p.x  + (q.x  - p.x)  * t;
          const yc = p.ya + (q.ya - p.ya) * t;
          haut.push([xc, yc]);
          bas.push([xc, yc]);
          tronçons.push({ sens: cur, haut, bas });
          haut = [[xc, yc]];
          bas  = [[xc, yc]];
          cur  = s;
        }
        haut.push([q.x, q.ya]);
        bas.push([q.x, q.yb]);
      }
      tronçons.push({ sens: cur, haut, bas });

      for (const tr of tronçons) {
        if (tr.haut.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(tr.haut[0][0] * hr, tr.haut[0][1] * vr);
        for (let i = 1; i < tr.haut.length; i++) ctx.lineTo(tr.haut[i][0] * hr, tr.haut[i][1] * vr);
        for (let i = tr.bas.length - 1; i >= 0; i--) ctx.lineTo(tr.bas[i][0] * hr, tr.bas[i][1] * vr);
        ctx.closePath();
        ctx.fillStyle = rgba(tr.sens === 'bull' ? d.bullColor : d.bearColor, d.opacity);
        ctx.fill();
      }
    });
  }
}

class KumoPaneView {
  constructor(source) {
    this._source = source;
    this._renderer = new KumoRenderer();
  }

  zOrder() { return 'bottom'; }   // c'est un fond : les bougies passent devant

  update() {
    const { _chart: chart, _series: series, _cloud: cloud, _opts: opts } = this._source;
    if (!chart || !series || !opts.showCloud || cloud.length < 2) {
      this._renderer.setData(null);
      return;
    }

    const ts  = chart.timeScale();
    const vis = ts.getVisibleRange();

    // Ne convertir que ce qui est à l'écran, plus un point de part et d'autre :
    // c'est lui qui fait entrer le remplissage par le bord au lieu de le
    // laisser flotter en l'air.
    let from = 0, to = cloud.length - 1;
    if (vis) {
      from = Math.max(0, borneBasse(cloud, vis.from) - 1);
      to   = Math.min(cloud.length - 1, borneHaute(cloud, vis.to) + 1);
    }

    const pts = [];
    for (let i = from; i <= to; i++) {
      const z  = cloud[i];
      const x  = ts.timeToCoordinate(z.time);
      const ya = series.priceToCoordinate(z.a);
      const yb = series.priceToCoordinate(z.b);
      if (x == null || ya == null || yb == null) continue;
      pts.push({ x, ya, yb });
    }

    this._renderer.setData({
      pts,
      bullColor: opts.bullColor,
      bearColor: opts.bearColor,
      opacity:   opts.opacity,
    });
  }

  renderer() { return this._renderer; }
}

// Premier indice dont le temps est ≥ t, et dernier dont le temps est ≤ t.
function borneBasse(arr, t) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].time < t) lo = m + 1; else hi = m; }
  return lo;
}
function borneHaute(arr, t) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].time <= t) lo = m + 1; else hi = m; }
  return lo - 1;
}

class KumoPrimitive {
  constructor() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
    this._cloud = [];
    this._opts = { bullColor: '#26A69A', bearColor: '#EF5350', opacity: 0.16, showCloud: true };
    this._paneViews = [new KumoPaneView(this)];
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

  update(cloud, opts) {
    this._cloud = cloud ?? [];
    this._opts = { ...this._opts, ...opts };
    this._requestUpdate?.();
  }

  updateAllViews() {
    for (const v of this._paneViews) v.update();
  }

  paneViews() { return this._paneViews; }
}

export function createKumoPrimitive() {
  return new KumoPrimitive();
}
