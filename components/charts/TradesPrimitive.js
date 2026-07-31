// Primitive lightweight-charts qui peint les positions d'un backtest, à la
// manière de l'outil « position » de TradingView :
//
//   • bande VERTE  entrée → TP   (le gain visé)
//   • bande ROUGE  entrée → SL   (le risque pris)
//   • trait plein  (entrée, prix d'entrée) → (sortie, prix de sortie), coloré
//     par le résultat : c'est le trajet réellement parcouru par le trade
//   • pointillé rouge sur le SL INITIAL quand il a été déplacé (break-even) —
//     sinon la bande de risque affichée serait celle d'après coup, et le R du
//     trade (mesuré sur le risque initial) deviendrait illisible.
//
// Les bandes s'étendent de la bougie d'entrée à la bougie de sortie, et rien
// au-delà : une position ne se prolonge pas après sa clôture.
//
// Chaque trade attendu :
//   { id, direction, entryTime, entryPrice, exitTime, exitPrice,
//     sl, tp, risk0, profitPoints, exitReason }
//
// Champ optionnel `status` (positions simulées rFVG) : marque le milieu de la
// position d'un petit trait épais au niveau d'entrée — vert 'tp', rouge 'sl',
// ambre 'be' (sortie sur stop déplacé au break-even), gris 'missed' (ordre
// jamais pris). Pas de trait pour 'open' (position encore en vie au bord
// droit : l'issue n'existe pas encore). Une position 'missed' n'a jamais
// existé : ni trajet, ni point de sortie.
// entryTime / exitTime doivent déjà être ALIGNÉS sur des temps de bougie
// existants (timeToCoordinate ne sait pas placer un temps hors données) —
// c'est TradingChart qui s'en charge.

const BULL = '#26A69A';
const BEAR = '#EF5350';
const NEUTRAL = '#94A3B8';

function rgba(hex, a) {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

class TradesRenderer {
  constructor() { this._data = null; }
  setData(d) { this._data = d; }

  draw(target) {
    const data = this._data;
    if (!data || !data.items.length) return;

    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context;
      const hr  = scope.horizontalPixelRatio;
      const vr  = scope.verticalPixelRatio;
      const minW = Math.max(2, data.barSpacing * 0.8) * hr;

      for (const t of data.items) {
        const x1 = t.x1 * hr;
        const x2 = Math.max(t.x2 * hr, x1 + minW);   // un trade d'une bougie reste visible
        const w  = x2 - x1;
        const yEntry = t.yEntry * vr;

        // Bandes gain / risque. Faibles alphas : les bougies restent lisibles.
        const dim   = data.hasSelection && !t.selected;
        const bandA = dim ? 0.05 : t.selected ? 0.20 : 0.11;
        const lineA = dim ? 0.30 : 1;

        const band = (yOther, color) => {
          if (yOther == null) return;
          const y  = yOther * vr;
          const yT = Math.min(yEntry, y);
          const h  = Math.abs(y - yEntry);
          if (h < 0.5) return;
          ctx.fillStyle = rgba(color, bandA);
          ctx.fillRect(x1, yT, w, h);
          ctx.strokeStyle = rgba(color, bandA + 0.28);
          ctx.lineWidth = Math.max(1, Math.round(vr));
          ctx.beginPath();
          ctx.moveTo(x1, y);
          ctx.lineTo(x2, y);
          ctx.stroke();
        };

        band(t.yTp, BULL);
        band(t.ySl, BEAR);

        // SL initial, si le stop a bougé en cours de route (break-even).
        if (t.ySl0 != null) {
          ctx.strokeStyle = rgba(BEAR, lineA * 0.65);
          ctx.lineWidth = Math.max(1, Math.round(vr));
          ctx.setLineDash([Math.round(3 * hr), Math.round(3 * hr)]);
          ctx.beginPath();
          ctx.moveTo(x1, t.ySl0 * vr);
          ctx.lineTo(x2, t.ySl0 * vr);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Prix d'entrée.
        ctx.strokeStyle = rgba(NEUTRAL, lineA * 0.55);
        ctx.lineWidth = Math.max(1, Math.round(vr));
        ctx.setLineDash([Math.round(2 * hr), Math.round(2 * hr)]);
        ctx.beginPath();
        ctx.moveTo(x1, yEntry);
        ctx.lineTo(x2, yEntry);
        ctx.stroke();
        ctx.setLineDash([]);

        // Milieu de la position : petit trait épais au niveau d'entrée, coloré
        // par l'issue — vert TP, rouge SL, ambre BE, gris jamais prise. Une
        // position encore ouverte ('open') n'a pas d'issue : pas de trait.
        if (t.status && t.status !== 'open') {
          const midColor = t.status === 'tp' ? BULL : t.status === 'sl' ? BEAR
            : t.status === 'be' ? '#F59E0B' : NEUTRAL;
          const len = Math.min(w, Math.max(10 * hr, w * 0.35));
          const cx  = (x1 + x2) / 2;
          ctx.strokeStyle = rgba(midColor, lineA);
          ctx.lineWidth = Math.max(2, Math.round(3 * vr));
          ctx.beginPath();
          ctx.moveTo(cx - len / 2, yEntry);
          ctx.lineTo(cx + len / 2, yEntry);
          ctx.stroke();
        }

        // Jamais prise : l'ordre a expiré sans être touché, il n'y a ni trajet
        // parcouru ni point de sortie à dessiner.
        if (t.status === 'missed') continue;

        // Trajet entrée → sortie.
        const res = t.win ? BULL : BEAR;
        ctx.strokeStyle = rgba(res, lineA);
        ctx.lineWidth = Math.max(1, Math.round((t.selected ? 2 : 1.5) * vr));
        ctx.beginPath();
        ctx.moveTo(x1, yEntry);
        ctx.lineTo(x2, t.yExit * vr);
        ctx.stroke();

        ctx.fillStyle = rgba(res, lineA);
        ctx.beginPath();
        ctx.arc(x2, t.yExit * vr, Math.max(2, Math.round(2.5 * vr)), 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
}

class TradesPaneView {
  constructor(source) {
    this._source = source;
    this._renderer = new TradesRenderer();
  }

  zOrder() { return 'bottom'; } // derrière les bougies

  update() {
    const { _chart: chart, _series: series, _trades: trades, _selectedId: selectedId } = this._source;
    if (!chart || !series) { this._renderer.setData(null); return; }

    const ts    = chart.timeScale();
    const items = [];

    for (const t of trades) {
      // Une position sans date ni prix n'a rien à dessiner — un signal dont
      // l'ordre n'a jamais été rempli, par exemple. `timeToCoordinate(null)`
      // JETTE au lieu de rendre null, donc ce garde-fou vient avant l'appel et
      // non après : c'est ce qui a cassé le graphe la première fois.
      if (t.entryTime == null || t.exitTime == null
          || t.entryPrice == null || t.exitPrice == null) continue;

      const x1 = ts.timeToCoordinate(t.entryTime);
      const x2 = ts.timeToCoordinate(t.exitTime);
      const yEntry = series.priceToCoordinate(t.entryPrice);
      const yExit  = series.priceToCoordinate(t.exitPrice);
      if (x1 == null || x2 == null || yEntry == null || yExit == null) continue;

      // SL initial : reconstruit depuis le risque initial, et n'est tracé que
      // s'il diffère du SL final (stop déplacé).
      let ySl0 = null;
      if (t.risk0 > 0 && t.sl != null) {
        const sl0 = t.direction === 'BUY' ? t.entryPrice - t.risk0 : t.entryPrice + t.risk0;
        if (Math.abs(sl0 - t.sl) > 1e-9) ySl0 = series.priceToCoordinate(sl0);
      }

      items.push({
        x1, x2, yEntry, yExit,
        ySl: t.sl != null ? series.priceToCoordinate(t.sl) : null,
        yTp: t.tp != null ? series.priceToCoordinate(t.tp) : null,
        ySl0,
        // Gagnante au NET quand la position le porte : un gain brut plus petit
        // que le spread n'est pas un gain, et ne doit pas se peindre en vert.
        win: (t.netPoints ?? t.profitPoints ?? 0) >= 0,
        status: t.status ?? null,
        selected: t.id === selectedId,
      });
    }

    this._renderer.setData({
      items,
      barSpacing:   ts.options().barSpacing ?? 6,
      hasSelection: selectedId != null,
    });
  }

  renderer() { return this._renderer; }
}

class TradesPrimitive {
  constructor() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
    this._trades = [];
    this._selectedId = null;
    this._paneViews = [new TradesPaneView(this)];
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

  update(trades, selectedId) {
    this._trades = trades ?? [];
    this._selectedId = selectedId ?? null;
    this._requestUpdate?.();
  }

  updateAllViews() {
    for (const v of this._paneViews) v.update();
  }

  paneViews() { return this._paneViews; }
}

export function createTradesPrimitive() {
  return new TradesPrimitive();
}
