import { useMemo } from 'react';
import { resolveChartTheme } from '../../lib/chartTheme';

// Aperçu du thème — un vrai rendu, pas une vignette décorative : mêmes couleurs,
// mêmes règles de corps creux / mèches / grille / volume que le graphe. Le
// panneau de réglages montre donc exactement ce qui sera appliqué.

const W = 520, H = 196;
const PAD_R = 46, PAD_L = 6, TOP = 10;
const AXIS_H = 15;

// Marche aléatoire déterministe (LCG) : l'aperçu ne doit jamais bouger d'un
// rendu à l'autre, sinon comparer deux réglages devient impossible.
const BARS = (() => {
  let seed = 20260728;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const out = [];
  let price = 100;
  for (let i = 0; i < 26; i++) {
    const open  = price;
    const drift = (rnd() - 0.46) * 3.1;
    const close = open + drift;
    const high  = Math.max(open, close) + rnd() * 1.5;
    const low   = Math.min(open, close) - rnd() * 1.5;
    out.push({ open, high, low, close, vol: 0.25 + rnd() * 0.75 });
    price = close;
  }
  return out;
})();

const DASH = {
  solid:       null,
  dotted:      '1 3',
  dashed:      '5 4',
  largeDashed: '9 6',
};

export default function ChartPreview({ settings, label = 'XAUUSD · 1H' }) {
  const t = useMemo(() => resolveChartTheme(settings), [settings]);

  const volH   = t.volume.visible ? Math.round((H - AXIS_H - TOP) * t.volume.height) : 0;
  const plotB  = H - AXIS_H - volH - 4;          // bas de la zone de prix
  const plotW  = W - PAD_R - PAD_L;
  const step   = plotW / BARS.length;
  const bodyW  = Math.max(2, Math.min(step - 2, step * 0.68));

  const hi = Math.max(...BARS.map(b => b.high));
  const lo = Math.min(...BARS.map(b => b.low));
  const y  = v => plotB - ((v - lo) / (hi - lo)) * (plotB - TOP);
  const maxVol = Math.max(...BARS.map(b => b.vol));

  const gridDash = DASH[t.grid.style];
  const cross    = BARS.length - 7;              // position du curseur simulé
  const crossX   = PAD_L + cross * step + step / 2;
  const crossY   = y(BARS[cross].close);
  const showCross = t.crosshair.mode !== 'hidden';

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      style={{ display: 'block', borderRadius: 10, background: t.bg.css }}
      role="img"
      aria-label="Aperçu du thème du graphe"
    >
      {/* Grille */}
      {t.grid.horz && [0, 0.25, 0.5, 0.75, 1].map(f => {
        const gy = Math.round(TOP + f * (plotB - TOP)) + 0.5;
        return <line key={`h${f}`} x1={PAD_L} x2={W - PAD_R} y1={gy} y2={gy}
                     stroke={t.grid.color} strokeWidth="1" strokeDasharray={gridDash || undefined} />;
      })}
      {t.grid.vert && [0.15, 0.4, 0.65, 0.9].map(f => {
        const gx = Math.round(PAD_L + f * plotW) + 0.5;
        return <line key={`v${f}`} x1={gx} x2={gx} y1={TOP} y2={plotB}
                     stroke={t.grid.color} strokeWidth="1" strokeDasharray={gridDash || undefined} />;
      })}

      {/* Filigrane */}
      {t.watermark.visible && (
        <text
          x={(W - PAD_R + PAD_L) / 2} y={plotB / 2 + t.watermark.fontSize * 0.22}
          textAnchor="middle"
          fill={t.watermark.color}
          style={{ fontSize: Math.round(t.watermark.fontSize * 0.62), fontWeight: 700, fontFamily: t.layout.fontFamily, letterSpacing: '0.04em' }}
        >
          {label}
        </text>
      )}

      {/* Volume */}
      {t.volume.visible && BARS.map((b, i) => {
        const h  = Math.max(1, (b.vol / maxVol) * (volH - 4));
        const up = b.close >= b.open;
        return (
          <rect key={`vol${i}`}
                x={PAD_L + i * step + (step - bodyW) / 2}
                y={H - AXIS_H - h} width={bodyW} height={h}
                fill={up ? t.volume.upColor : t.volume.downColor} />
        );
      })}

      {/* Bougies */}
      {BARS.map((b, i) => {
        const up   = b.close >= b.open;
        const cx   = PAD_L + i * step + step / 2;
        const bx   = cx - bodyW / 2;
        const yO   = y(b.open), yC = y(b.close);
        const top  = Math.min(yO, yC);
        const hgt  = Math.max(1, Math.abs(yC - yO));
        const fill = up ? t.candle.upColor : t.candle.downColor;
        const edge = up ? t.candle.borderUpColor : t.candle.borderDownColor;
        return (
          <g key={i}>
            {t.candle.wickVisible && (
              <line x1={cx} x2={cx} y1={y(b.high)} y2={y(b.low)}
                    stroke={up ? t.candle.wickUpColor : t.candle.wickDownColor} strokeWidth="1" />
            )}
            <rect x={bx} y={top} width={bodyW} height={hgt}
                  fill={fill}
                  stroke={t.candle.borderVisible ? edge : 'none'}
                  strokeWidth={t.candle.borderVisible ? 1 : 0} />
          </g>
        );
      })}

      {/* Axes — tracés avant les étiquettes, qui doivent passer par-dessus */}
      {t.axis.visible && (
        <>
          {t.axis.borderVisible && (
            <line x1={W - PAD_R + 0.5} x2={W - PAD_R + 0.5} y1={TOP} y2={H - AXIS_H}
                  stroke={t.axis.borderColor} strokeWidth="1" />
          )}
          {[0.08, 0.36, 0.64, 0.92].map(f => (
            <text key={f} x={W - PAD_R + 5} y={TOP + f * (plotB - TOP) + 3}
                  fill={t.axis.textColor}
                  style={{ fontSize: Math.max(7, t.layout.fontSize - 2), fontFamily: t.layout.fontFamily }}>
              {(hi - f * (hi - lo)).toFixed(1)}
            </text>
          ))}
        </>
      )}
      {t.axis.borderVisible && (
        <line x1={PAD_L} x2={W - PAD_R} y1={H - AXIS_H + 0.5} y2={H - AXIS_H + 0.5}
              stroke={t.axis.borderColor} strokeWidth="1" />
      )}
      {['09:00', '13:00', '17:00', '21:00'].map((lbl, i) => (
        <text key={lbl} x={PAD_L + (0.13 + i * 0.25) * plotW} y={H - 4}
              textAnchor="middle" fill={t.axis.textColor}
              style={{ fontSize: Math.max(7, t.layout.fontSize - 2), fontFamily: t.layout.fontFamily }}>
          {t.axis.secondsVisible ? `${lbl}:00` : lbl}
        </text>
      ))}

      {/* Curseur simulé */}
      {showCross && (
        <g>
          <line x1={crossX} x2={crossX} y1={TOP} y2={plotB}
                stroke={t.crosshair.color} strokeWidth="1" strokeDasharray={DASH[t.crosshair.style] || undefined} />
          <line x1={PAD_L} x2={W - PAD_R} y1={crossY} y2={crossY}
                stroke={t.crosshair.color} strokeWidth="1" strokeDasharray={DASH[t.crosshair.style] || undefined} />
          <rect x={W - PAD_R + 1} y={crossY - 7} width={PAD_R - 4} height={14} rx="2" fill={t.crosshair.labelBg} />
          <text x={W - PAD_R + 5} y={crossY + 4}
                fill={t.dark ? '#E2E8F0' : '#F8FAFC'}
                style={{ fontSize: 9, fontFamily: t.layout.fontFamily, fontWeight: 600 }}>
            {BARS[cross].close.toFixed(2)}
          </text>
        </g>
      )}

      {/* Dernier prix */}
      {t.candle.priceLineVisible && (() => {
        const last = BARS[BARS.length - 1];
        const ly   = y(last.close);
        const c    = last.close >= last.open ? t.candle.bull : t.candle.bear;
        return (
          <g>
            <line x1={PAD_L} x2={W - PAD_R} y1={ly} y2={ly} stroke={c} strokeWidth="1" strokeDasharray="4 4" opacity="0.85" />
            <rect x={W - PAD_R + 1} y={ly - 7} width={PAD_R - 4} height={14} rx="2" fill={c} />
            <text x={W - PAD_R + 5} y={ly + 4} fill={t.dark ? '#08111C' : '#FFFFFF'}
                  style={{ fontSize: 9, fontFamily: t.layout.fontFamily, fontWeight: 700 }}>
              {last.close.toFixed(2)}
            </text>
          </g>
        );
      })()}

    </svg>
  );
}
