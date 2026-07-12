import { useMemo } from 'react';

// Courbe d'équité en SVG pur (pas de lightweight-charts : plusieurs trades
// peuvent fermer à la même seconde, ce que LWC refuse — et un axe X en
// "numéro de trade" est plus lisible qu'un axe temps troué les week-ends).
//
// props :
//   points — [{ time, points, r }] cumulés, un par trade fermé
//   unit   — 'r' | 'points'

const W = 800, H = 220;
const PAD_L = 8, PAD_R = 8, PAD_T = 14, PAD_B = 8;

export default function EquityChart({ points, unit = 'r' }) {
  const geo = useMemo(() => {
    if (!points || points.length === 0) return null;

    const vals = points.map(p => unit === 'r' ? p.r : p.points);
    let min = Math.min(0, ...vals);
    let max = Math.max(0, ...vals);
    if (max === min) { max += 1; min -= 1; }
    const span = max - min;

    const x = i => points.length === 1
      ? W / 2
      : PAD_L + (i / (points.length - 1)) * (W - PAD_L - PAD_R);
    const y = v => PAD_T + (1 - (v - min) / span) * (H - PAD_T - PAD_B);

    const line = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = `${line} L${x(vals.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;

    const last = vals[vals.length - 1];
    return { line, area, zeroY: y(0), min, max, last, positive: last >= 0 };
  }, [points, unit]);

  if (!geo) return null;

  const color = geo.positive ? '#26A69A' : '#EF5350';
  const fmt = v => unit === 'r' ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}R` : `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Courbe d'équité">
        <defs>
          <linearGradient id="eq-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Ligne zéro */}
        <line
          x1={PAD_L} x2={W - PAD_R} y1={geo.zeroY} y2={geo.zeroY}
          stroke="#374151" strokeWidth="1" strokeDasharray="4 4"
        />

        <path d={geo.area} fill="url(#eq-fill)" />
        <path d={geo.line} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
      </svg>

      {/* Étiquettes min / max / dernier — en HTML pour rester nettes au resize */}
      <span style={lbl({ top: 2,  right: 6, color: 'var(--text-ghost)' })}>{fmt(geo.max)}</span>
      <span style={lbl({ bottom: 2, right: 6, color: 'var(--text-ghost)' })}>{fmt(geo.min)}</span>
      <span style={lbl({ top: 2, left: 6, color, fontSize: 13, fontWeight: 700 })}>{fmt(geo.last)}</span>
    </div>
  );
}

function lbl(pos) {
  return {
    position: 'absolute',
    fontSize: 10,
    fontFamily: 'var(--font-mono)',
    fontVariantNumeric: 'tabular-nums',
    pointerEvents: 'none',
    ...pos,
  };
}
